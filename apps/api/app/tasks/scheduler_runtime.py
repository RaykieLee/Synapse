"""FastAPI-lifespan task polling loop with persistent run records."""
import asyncio
import hashlib
import json
import logging
import os
import socket
import uuid
from datetime import datetime, timezone

from app.database.session import get_session_factory
from app.tasks.dispatcher import dispatch_tenant_task
from app.tasks.scheduler_state import claim_due_tasks, complete_task_claim
from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun

logger = logging.getLogger(__name__)


def _claim_one(worker_id: str, lease_seconds: int) -> list[dict]:
    session = get_session_factory()()
    try:
        return claim_due_tasks(session, worker_id, lease_seconds=lease_seconds, limit=1)
    finally:
        session.close()


def _finish_claim(claim: dict, *, succeeded: bool) -> None:
    session = get_session_factory()()
    try:
        complete_task_claim(
            session,
            int(claim["task_id"]),
            int(claim["tenant_id"]),
            claim["lease_owner"],
            claim["lease_token"],
            succeeded=succeeded,
            now=datetime.now(timezone.utc),
        )
    finally:
        session.close()


def _execute_claim(claim: dict) -> None:
    run_id = None
    succeeded = False
    summary_json = None
    error_code = None
    try:
        run_id = _start_run(claim)
        session = get_session_factory()()
        try:
            result = dispatch_tenant_task(session, int(claim["task_id"]), int(claim["tenant_id"]))
            summary_json = json.dumps(
                _safe_result_summary(claim["execution_target"], result.get("result")),
                sort_keys=True,
                separators=(",", ":"),
            )
        except Exception as exc:
            session.rollback()
            error_code = _safe_error_code(exc)
        else:
            succeeded = True
        finally:
            session.close()
        _finish_run(run_id, succeeded=succeeded, summary_json=summary_json, error_code=error_code)
    except Exception as exc:
        # If even the start/end record cannot be persisted, don't run an
        # unrecorded handler and release the claim for a later retry.
        logger.error(
            "Scheduled task run record failed (task_id=%s tenant_id=%s code=%s)",
            claim["task_id"], claim["tenant_id"], _safe_error_code(exc),
        )
        if run_id is not None:
            try:
                _finish_run(run_id, succeeded=False, summary_json=None, error_code="RUN_RECORD_ERROR")
            except Exception:
                logger.error("Could not finalize failed run record (run_id=%s)", run_id)
        succeeded = False
    try:
        _finish_claim(claim, succeeded=succeeded)
    except Exception:
        logger.error("Could not complete scheduled task claim (task_id=%s tenant_id=%s)",
                     claim["task_id"], claim["tenant_id"])


def _start_run(claim: dict) -> int:
    session = get_session_factory()()
    try:
        row = TenantScheduledTaskRun(
            tenant_id=int(claim["tenant_id"]),
            task_id=int(claim["task_id"]),
            slot_at=datetime.fromisoformat(claim["claimed_slot_at"]),
            claim_token_hash=hashlib.sha256(claim["lease_token"].encode("utf-8")).hexdigest(),
            execution_target=claim["execution_target"],
            started_at=datetime.now(timezone.utc),
            status="running",
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.run_id
    finally:
        session.close()


def _finish_run(run_id: int, *, succeeded: bool, summary_json: str | None, error_code: str | None) -> None:
    session = get_session_factory()()
    try:
        row = session.get(TenantScheduledTaskRun, run_id)
        if row is None:
            raise LookupError("scheduled task run record disappeared")
        row.finished_at = datetime.now(timezone.utc)
        row.status = "succeeded" if succeeded else "failed"
        row.result_summary_json = summary_json if succeeded else None
        row.error_code = None if succeeded else (error_code or "HANDLER_ERROR")
        session.commit()
    finally:
        session.close()


def _safe_error_code(exc: Exception) -> str:
    value = getattr(exc, "code", None)
    if isinstance(value, str) and value and value.replace("_", "").isalnum():
        return value[:80].upper()
    return "HANDLER_ERROR"


def _safe_result_summary(target: str, result) -> dict:
    """Persist only target-specific numeric summaries, never arbitrary payloads."""
    if not isinstance(result, dict):
        return {}
    if target == "tenant.expire_pending_invitations":
        return {"expired_count": result.get("expired_count", 0)}
    if target == "tenant.reconcile_attachment_metadata":
        keys = ("metadata_count", "present_file_count", "consistent_file_count", "exception_count")
        return {key: result.get(key, 0) for key in keys}
    if target == "tenant.refresh_resource_summary":
        counts = result.get("counts")
        if isinstance(counts, dict):
            return {"counts": {str(key): value for key, value in counts.items() if isinstance(value, int)}}
    return {}


async def _thread_call_with_cancel_cleanup(call, *args, cleanup=None):
    """Keep the thread outcome visible so an interrupted claim can be released."""
    task = asyncio.create_task(asyncio.to_thread(call, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        result = await task
        if cleanup is not None:
            for item in result:
                try:
                    await asyncio.to_thread(cleanup, item)
                except Exception:
                    logger.exception("Could not release a scheduled task claim during shutdown")
        raise


async def run_scheduler_loop(
    stop_event: asyncio.Event,
    *,
    worker_id: str,
    poll_interval_seconds: float,
    lease_seconds: int,
) -> None:
    """Poll and process at most one claim at a time until shutdown is requested."""
    while not stop_event.is_set():
        try:
            claims = await _thread_call_with_cancel_cleanup(
                _claim_one,
                worker_id,
                lease_seconds,
                cleanup=lambda claim: _finish_claim(claim, succeeded=False),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduled task claim scan failed")
            claims = []

        if claims:
            claim = claims[0]
            if stop_event.is_set():
                try:
                    await asyncio.to_thread(_finish_claim, claim, succeeded=False)
                except Exception:
                    logger.exception("Could not release a scheduled task claim during shutdown")
                return
            # Shield the complete handler/lease transition from cancellation:
            # graceful shutdown waits for the in-flight unit to finish.
            execution = asyncio.create_task(asyncio.to_thread(_execute_claim, claim))
            try:
                await asyncio.shield(execution)
            except asyncio.CancelledError:
                await execution
                raise
            continue

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
        except asyncio.TimeoutError:
            pass


def make_worker_id(configured_prefix: str | None = None) -> str:
    """Return a process-unique lease owner, optionally under a configured prefix."""
    prefix = configured_prefix or socket.gethostname()
    suffix = f"{os.getpid()}-{uuid.uuid4()}"
    return f"{prefix[:80]}:{suffix}"[:160]

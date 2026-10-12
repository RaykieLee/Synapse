"""F19c real API + Vite + Playwright manual-trigger verification."""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

pytestmark = [
    pytest.mark.browser,
    pytest.mark.integration,
]

ROOT = Path(__file__).resolve().parents[4]
PNPM = shutil.which("pnpm") or shutil.which("pnpm.cmd") or "pnpm.cmd"


def _port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait(url: str, process: subprocess.Popen, log: Path, timeout: float = 40) -> None:
    import urllib.request

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(
                f"server exited ({process.returncode}): {log.read_text(errors='replace')}"
            )
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(0.25)
    raise AssertionError(f"server did not become ready: {log.read_text(errors='replace')}")


def test_f19c_manual_task_trigger_frontend_real_browser(tmp_path, monkeypatch):
    repo = ROOT
    web_dir = repo / "apps/web"
    api_dir = repo / "apps/api"
    db_path = tmp_path / "f19c-browser.sqlite"
    redis_port = os.environ.get("F19C_REDIS_PORT", "16381")
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "F19c-browser-verification-secret")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", "127.0.0.1")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", redis_port)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "9")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "10")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workspaces"))

    from app.auth.security import password_hash
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config(str(api_dir / "alembic.ini")), "head")

    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.tenant_task_schedule_state import TenantTaskScheduleState
    from app.models.user import User
    from app.tasks.scheduler_state import _fingerprint

    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(
            user_name="f19c-browser-owner",
            email="f19c-browser-owner@example.test",
            password_hash=password_hash("F19c-browser-password!"),
            status="active",
            del_flag=False,
        )
        admin = User(
            user_name="f19c-browser-admin",
            email="f19c-browser-admin@example.test",
            password_hash=password_hash("F19c-browser-password!"),
            status="active",
            del_flag=False,
        )
        member = User(
            user_name="f19c-browser-member",
            email="f19c-browser-member@example.test",
            password_hash=password_hash("F19c-browser-password!"),
            status="active",
            del_flag=False,
        )
        db.add_all([owner, admin, member])
        db.flush()

        alpha = Tenant(
            slug="f19c-browser-alpha",
            name="F19c Browser Alpha",
            status="active",
            settings_json="{}",
            membership_version=1,
        )
        beta = Tenant(
            slug="f19c-browser-beta",
            name="F19c Browser Beta",
            status="active",
            settings_json="{}",
            membership_version=1,
        )
        db.add_all([alpha, beta])
        db.flush()
        db.add_all(
            [
                TenantMember(
                    tenant_id=alpha.tenant_id,
                    user_id=owner.user_id,
                    status="active",
                    tenant_role="owner",
                    joined_at=now,
                ),
                TenantMember(
                    tenant_id=alpha.tenant_id,
                    user_id=admin.user_id,
                    status="active",
                    tenant_role="admin",
                    joined_at=now,
                ),
                TenantMember(
                    tenant_id=alpha.tenant_id,
                    user_id=member.user_id,
                    status="active",
                    tenant_role="member",
                    joined_at=now,
                ),
                TenantMember(
                    tenant_id=beta.tenant_id,
                    user_id=owner.user_id,
                    status="active",
                    tenant_role="owner",
                    joined_at=now,
                ),
            ]
        )

        def task(
            tenant_id: int,
            name: str,
            target: str,
            *,
            enabled: bool = True,
            parameters: str = "{}",
        ) -> TenantScheduledTask:
            return TenantScheduledTask(
                tenant_id=tenant_id,
                task_name=name,
                description="F19c browser fixture",
                execution_target=target,
                parameters_json=parameters,
                schedule_type="interval",
                interval_value=60,
                interval_unit="seconds",
                timezone="UTC",
                enabled=enabled,
                del_flag=False,
                created_by=owner.user_id,
                updated_by=owner.user_id,
                created_at=now,
                updated_at=now,
            )

        success_task = task(
            alpha.tenant_id,
            "F19c Browser Success",
            "tenant.reconcile_attachment_metadata",
        )
        failed_task = task(
            alpha.tenant_id,
            "F19c Browser Failure",
            "tenant.refresh_resource_summary",
            parameters='{"secret":"F19C-BROWSER-SENSITIVE"}',
        )
        disabled_task = task(
            alpha.tenant_id,
            "F19c Browser Disabled",
            "tenant.reconcile_attachment_metadata",
            enabled=False,
        )
        leased_task = task(
            alpha.tenant_id,
            "F19c Browser Leased",
            "tenant.reconcile_attachment_metadata",
        )
        double_task = task(
            alpha.tenant_id,
            "F19c Browser Double Click",
            "tenant.reconcile_attachment_metadata",
        )
        beta_task = task(
            beta.tenant_id,
            "F19c Browser Beta Task",
            "tenant.reconcile_attachment_metadata",
        )
        db.add_all(
            [success_task, failed_task, disabled_task, leased_task, double_task, beta_task]
        )
        db.flush()
        db.add(
            TenantTaskScheduleState(
                task_id=leased_task.task_id,
                tenant_id=alpha.tenant_id,
                definition_fingerprint=_fingerprint(leased_task),
                next_run_at=now,
                claimed_slot_at=now,
                lease_owner="f19c-browser-worker",
                lease_token="f19c-browser-lease",
                lease_until=now + timedelta(minutes=5),
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
        seed = {
            "tenant_a": str(alpha.tenant_id),
            "tenant_b": str(beta.tenant_id),
            "owner_id": str(owner.user_id),
            "member_id": str(member.user_id),
            "success_task": str(success_task.task_id),
            "failed_task": str(failed_task.task_id),
            "disabled_task": str(disabled_task.task_id),
            "leased_task": str(leased_task.task_id),
            "double_task": str(double_task.task_id),
            "beta_task": str(beta_task.task_id),
        }

    api_port, web_port = _port(), _port()
    api_log, web_log = tmp_path / "api.log", tmp_path / "web.log"
    api_file, web_file = api_log.open("w"), web_log.open("w")
    api_env = os.environ.copy()
    api = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(api_port),
        ],
        cwd=api_dir,
        env=api_env,
        stdout=api_file,
        stderr=subprocess.STDOUT,
    )
    web_env = os.environ.copy()
    web_env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{api_port}"
    web = subprocess.Popen(
        [
            PNPM,
            "exec",
            "vite",
            "--host",
            "127.0.0.1",
            "--port",
            str(web_port),
            "--strictPort",
        ],
        cwd=web_dir,
        env=web_env,
        stdout=web_file,
        stderr=subprocess.STDOUT,
    )
    build = subprocess.run(
        [PNPM, "build"],
        cwd=web_dir,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
    )
    build_output = build.stdout
    try:
        _wait(f"http://127.0.0.1:{api_port}/api/v1/health", api, api_log)
        _wait(f"http://127.0.0.1:{web_port}", web, web_log)
        env = os.environ.copy()
        env.update(
            {
                "WEB_BASE_URL": f"http://127.0.0.1:{web_port}",
                "TENANT_A_ID": seed["tenant_a"],
                "TENANT_B_ID": seed["tenant_b"],
                "OWNER_USER": "f19c-browser-owner",
                "ADMIN_USER": "f19c-browser-admin",
                "MEMBER_USER": "f19c-browser-member",
                "OWNER_ID": seed["owner_id"],
                "MEMBER_ID": seed["member_id"],
                "SUCCESS_TASK_ID": seed["success_task"],
                "FAILED_TASK_ID": seed["failed_task"],
                "DISABLED_TASK_ID": seed["disabled_task"],
                "LEASED_TASK_ID": seed["leased_task"],
                "DOUBLE_TASK_ID": seed["double_task"],
                "BETA_TASK_ID": seed["beta_task"],
            }
        )
        browser = subprocess.run(
            [PNPM, "exec", "node", "tests/verification/f19c_manual_task_trigger.mjs"],
            cwd=web_dir,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=240,
        )
        assert browser.returncode == 0, (
            f"Playwright failed:\n{browser.stdout}\n"
            f"API:\n{api_log.read_text(errors='replace')}\n"
            f"Vite:\n{web_log.read_text(errors='replace')}"
        )
        assert "F19c Playwright assertions passed" in browser.stdout
    finally:
        for process in (web, api):
            process.terminate()
        for process in (web, api):
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        api_file.close()
        web_file.close()
        get_engine().dispose()
        get_settings.cache_clear()
        get_engine.cache_clear()
        get_session_factory.cache_clear()

    assert build.returncode == 0, (
        f"pnpm build failed (browser E2E still completed):\n{build_output}"
    )

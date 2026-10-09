"""F19b real API + Vite + Playwright task-run history verification."""
from __future__ import annotations

import os
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config


ROOT = Path(__file__).resolve().parents[4]


def _port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait(url: str, process: subprocess.Popen, log: Path, timeout: float = 40) -> None:
    import urllib.request

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"server exited ({process.returncode}): {log.read_text(errors='replace')}")
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(.25)
    raise AssertionError(f"server did not become ready: {log.read_text(errors='replace')}")


def test_f19b_scheduled_task_runs_frontend_real_browser(tmp_path, monkeypatch):
    repo = ROOT
    web_dir = repo / "apps/web"
    api_dir = repo / "apps/api"
    db_path = tmp_path / "f19b.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "F19b-verification-only-secret-change-me")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", "127.0.0.1")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", "6380")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "9")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "10")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workspaces"))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config(str(api_dir / "alembic.ini")), "head")

    from app.auth.security import password_hash
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun
    from app.models.user import User

    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(user_name="f19b-owner", email="f19b-owner@example.test", password_hash=password_hash("F19b-test-password!"))
        admin = User(user_name="f19b-admin", email="f19b-admin@example.test", password_hash=password_hash("F19b-test-password!"))
        member = User(user_name="f19b-member", email="f19b-member@example.test", password_hash=password_hash("F19b-test-password!"))
        db.add_all([owner, admin, member]); db.flush()
        a = Tenant(slug="f18c-tenant-a", name="F18c Tenant A", status="active", settings_json="{}", membership_version=1)
        b = Tenant(slug="f18c-tenant-b", name="F18c Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([a, b]); db.flush()
        db.add_all([
            TenantMember(tenant_id=a.tenant_id, user_id=owner.user_id, status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=a.tenant_id, user_id=admin.user_id, status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=a.tenant_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=b.tenant_id, user_id=owner.user_id, status="active", tenant_role="owner", joined_at=now),
        ])
        primary = TenantScheduledTask(tenant_id=a.tenant_id, task_name="Alpha primary task", description="F19b fixture",
            execution_target="tenant.expire_pending_invitations", parameters_json='{"credential":"PARAMETER-SECRET-F19B"}',
            schedule_type="interval", cron_expression=None, interval_value=60, interval_unit="seconds", timezone="UTC",
            enabled=True, del_flag=False, created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
        secondary = TenantScheduledTask(tenant_id=a.tenant_id, task_name="Alpha secondary task", description="Another task",
            execution_target="tenant.refresh_resource_summary", parameters_json="{}", schedule_type="cron", cron_expression="0 2 * * *",
            interval_value=None, interval_unit=None, timezone="UTC", enabled=True, del_flag=False,
            created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
        beta = TenantScheduledTask(tenant_id=b.tenant_id, task_name="Beta primary task", description=None,
            execution_target="tenant.refresh_resource_summary", parameters_json="{}", schedule_type="cron", cron_expression="0 2 * * *",
            interval_value=None, interval_unit=None, timezone="UTC", enabled=True, del_flag=False,
            created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
        db.add_all([primary, secondary, beta]); db.flush()
        run_ids = []
        for index in range(21):
            status = ("succeeded", "failed", "running")[index % 3]
            started = datetime(2026, 10, 2, 8, index, tzinfo=timezone.utc)
            db.add(TenantScheduledTaskRun(tenant_id=a.tenant_id, task_id=primary.task_id, slot_at=started,
                claim_token_hash="CLAIM-TOKEN-F19B-HASH".ljust(64, "0"), execution_target=primary.execution_target,
                started_at=started, finished_at=None if status == "running" else started,
                status=status, result_summary_json='{"expired_count":3}' if status == "succeeded" else None,
                error_code="SAFE_HANDLER_ERROR" if status == "failed" else None))
        db.add(TenantScheduledTaskRun(tenant_id=b.tenant_id, task_id=beta.task_id,
            slot_at=datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc), claim_token_hash="BETA-CLAIM".ljust(64, "0"),
            execution_target=beta.execution_target, started_at=datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc),
            finished_at=datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc), status="succeeded",
            result_summary_json='{"tenant":"BETA-PRIVATE-SUMMARY"}'))
        db.commit()
        tenant_a_id, tenant_b_id = str(a.tenant_id), str(b.tenant_id)
        task_a_id = str(primary.task_id)

    api_port, web_port = _port(), _port()
    api_log, web_log = tmp_path / "api.log", tmp_path / "web.log"
    api_file, web_file = api_log.open("w"), web_log.open("w")
    api_env = os.environ.copy()
    api = subprocess.Popen([str(api_dir / ".venv/bin/uvicorn"), "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=api_dir, env=api_env, stdout=api_file, stderr=subprocess.STDOUT)
    web_env = os.environ.copy(); web_env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{api_port}"
    web = subprocess.Popen(["pnpm", "exec", "vite", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=web_dir, env=web_env, stdout=web_file, stderr=subprocess.STDOUT)
    build = subprocess.run(["pnpm", "build"], cwd=web_dir, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    build_output = build.stdout
    try:
        _wait(f"http://127.0.0.1:{api_port}/api/v1/health", api, api_log)
        _wait(f"http://127.0.0.1:{web_port}", web, web_log)
        env = os.environ.copy(); env.update({"WEB_BASE_URL": f"http://127.0.0.1:{web_port}", "TENANT_A_ID": tenant_a_id, "TENANT_B_ID": tenant_b_id})
        env["TASK_A_ID"] = task_a_id
        browser = subprocess.run(["pnpm", "exec", "node", "tests/verification/f19b_task_runs.mjs"], cwd=web_dir, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
        assert browser.returncode == 0, f"Playwright failed:\n{browser.stdout}\nAPI:\n{api_log.read_text(errors='replace')}\nVite:\n{web_log.read_text(errors='replace')}"
        assert "F19b Playwright assertions passed" in browser.stdout
    finally:
        for process in (web, api):
            process.terminate()
        for process in (web, api):
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        api_file.close(); web_file.close()

    assert build.returncode == 0, f"pnpm build failed (browser E2E still completed):\n{build_output}"

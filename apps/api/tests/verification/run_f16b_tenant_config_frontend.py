"""Build and browser-verify tenant parameter configuration on disposable services."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
FLOW = Path(__file__).with_name("f16b_tenant_config_frontend.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process):
    deadline = time.time() + 40
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited ({process.returncode}) before {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def terminate_process_tree(process):
    """Terminate a server and any child process holding temporary logs."""
    if process is None:
        return
    if process.poll() is None:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
            )
        else:
            process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def main():
    if os.environ.get("F16B_SKIP_BUILD") != "1":
        build = subprocess.run([PNPM, "build"], cwd=WEB)
        if build.returncode:
            return build.returncode
    with tempfile.TemporaryDirectory(prefix="synapse-f16b-") as temporary:
        temp = Path(temporary)
        database_url = f"sqlite:///{temp / 'f16b.sqlite'}"
        secret = "f16b-verification-only-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_config import TenantConfig
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        old_cwd = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        now = datetime.now(timezone.utc)
        factory = get_session_factory()
        with factory() as db:
            owner = User(user_name="f16b-owner", nick_name="F16b Owner", email="owner-f16b@example.test", password_hash="unused")
            admin = User(user_name="f16b-admin", nick_name="F16b Admin", email="admin-f16b@example.test", password_hash="unused")
            member = User(user_name="f16b-member", nick_name="F16b Member", email="member-f16b@example.test", password_hash="unused")
            db.add_all([owner, admin, member]); db.flush()
            a = Tenant(slug="f16b-alpha", name="F16b Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            b = Tenant(slug="f16b-beta", name="F16b Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([a, b]); db.flush()
            a_id, b_id = a.tenant_id, b.tenant_id
            db.add_all([
                TenantMember(tenant_id=a_id, user_id=owner.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=a_id, user_id=admin.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=a_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=b_id, user_id=owner.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=b_id, user_id=admin.user_id, status="active", tenant_role="owner", joined_at=now),
            ]); db.flush()

            rows = []
            for index in range(21):
                rows.append(TenantConfig(tenant_id=a_id, config_name=f"Alpha Config {index:02d}", config_key=f"alpha.key{index:02d}",
                    config_value=f"alpha-value-{index:02d}", group_name="alpha-group", is_frontend=index == 0,
                    is_sensitive=False, status="0", remark=None, created_by=owner.user_id, updated_by=owner.user_id,
                    created_at=now, updated_at=now))
            secret_value = "F16B-A-TENANT-SECRET"
            sensitive = TenantConfig(tenant_id=a_id, config_name="Alpha Secret", config_key="alpha.secret",
                config_value=secret_value, group_name="secrets", is_frontend=False, is_sensitive=True, status="0", remark=None,
                created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
            beta_value = "F16B-BETA-PRIVATE"
            beta = TenantConfig(tenant_id=b_id, config_name="Beta Config", config_key="beta.config", config_value=beta_value,
                group_name="beta-group", is_frontend=False, is_sensitive=True, status="0", remark=None,
                created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
            db.add_all([*rows, sensitive, beta]); db.commit()
            seed = {
                "tenant_a_id": str(a_id), "tenant_b_id": str(b_id),
                "owner_token": issue_token(owner.user_id, owner.token_version),
                "admin_token": issue_token(admin.user_id, admin.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
                "sensitive_a_id": str(sensitive.config_id), "sensitive_a_value": secret_value,
                "beta_config_id": str(beta.config_id), "beta_value": beta_value,
            }

        api_port, web_port = free_port(), free_port()
        env = os.environ.copy()
        env.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret,
                    "SYNAPSE_AGENTSCOPE_REDIS_HOST": "127.0.0.1",
                    "SYNAPSE_AGENTSCOPE_REDIS_PORT": os.environ.get("F16B_REDIS_PORT", "16381"),
                    "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp / "agentscope-workspaces"),
                    "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp / "api.log").open("w")
        web_log = (temp / "vite.log").open("w")
        api = None
        web = None
        try:
            api = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory",
                 "--host", "127.0.0.1", "--port", str(api_port)],
                cwd=API,
                env=env,
                stdout=api_log,
                stderr=api_log,
            )
            web = subprocess.Popen(
                [PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
                cwd=WEB,
                env=env,
                stdout=web_log,
                stderr=web_log,
            )
            seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
            seed_path = temp / "seed.json"
            seed_path.write_text(json.dumps(seed))
            try:
                wait_url(seed["api"] + "/health", api)
                wait_url(seed["web"], web)
            except Exception:
                print("API server log:\n", (temp / "api.log").read_text(errors="replace"), file=sys.stderr)
                print("Vite server log:\n", (temp / "vite.log").read_text(errors="replace"), file=sys.stderr)
                raise
            result = subprocess.run(
                ["node", str(FLOW.resolve()), str(seed_path)],
                cwd=WEB,
                env=env,
            )
            if result.returncode:
                print("API server log:\n", (temp / "api.log").read_text(errors="replace"), file=sys.stderr)
                print("Vite server log:\n", (temp / "vite.log").read_text(errors="replace"), file=sys.stderr)
            return result.returncode
        finally:
            terminate_process_tree(web)
            terminate_process_tree(api)
            api_log.close(); web_log.close()
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()


if __name__ == "__main__":
    raise SystemExit(main())

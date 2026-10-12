"""Build and browser-verify tenant dictionary management on disposable services."""
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
FLOW = Path(__file__).with_name("f15b_tenant_dictionary_frontend.mjs")
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
    if os.environ.get("F15B_SKIP_BUILD") != "1":
        build = subprocess.run([PNPM, "build"], cwd=WEB)
        if build.returncode:
            return build.returncode
    with tempfile.TemporaryDirectory(prefix="synapse-f15b-") as temporary:
        temp = Path(temporary)
        database_url = f"sqlite:///{temp / 'f15b.sqlite'}"
        secret = "f15b-verification-only-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_dictionary import TenantDictData, TenantDictType
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
            owner = User(user_name="f15b-owner", nick_name="F15b Owner", email="f15b-owner@example.test", password_hash="unused")
            admin = User(user_name="f15b-admin", nick_name="F15b Admin", email="f15b-admin@example.test", password_hash="unused")
            member = User(user_name="f15b-member", nick_name="F15b Member", email="f15b-member@example.test", password_hash="unused")
            db.add_all([owner, admin, member]); db.flush()
            tenant_a = Tenant(slug="f15b-alpha", name="F15b Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f15b-beta", name="F15b Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b]); db.flush()
            a_id, b_id = tenant_a.tenant_id, tenant_b.tenant_id
            db.add_all([
                TenantMember(tenant_id=a_id, user_id=owner.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=a_id, user_id=admin.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=a_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=b_id, user_id=admin.user_id, status="active", tenant_role="admin", joined_at=now),
            ]); db.flush()

            types_a = []
            for index in range(21):
                row = TenantDictType(tenant_id=a_id, dict_name="Alpha Colors" if index == 0 else f"Alpha Type {index:02d}",
                    dict_type="color" if index == 0 else f"alpha.type{index:02d}", order_num=(index + 1) * 10,
                    status="0", remark=None, created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
                types_a.append(row)
            removable = TenantDictType(tenant_id=a_id, dict_name="Alpha Empty", dict_type="alpha.empty", order_num=220,
                status="0", remark=None, created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now)
            type_b = TenantDictType(tenant_id=b_id, dict_name="Beta Colors", dict_type="color", order_num=10,
                status="0", remark=None, created_by=admin.user_id, updated_by=admin.user_id, created_at=now, updated_at=now)
            db.add_all([*types_a, removable, type_b]); db.flush()
            entries_a = []
            for index in range(21):
                entries_a.append(TenantDictData(tenant_id=a_id, dict_type_id=types_a[0].dict_type_id, dict_sort=(index + 1) * 10,
                    dict_label="Alpha Red" if index == 0 else f"Alpha Seed {index:02d}", dict_value=f"alpha-{index:02d}",
                    css_class=None, list_class=None, is_default="N", status="0", remark=None,
                    created_by=owner.user_id, updated_by=owner.user_id, created_at=now, updated_at=now))
            entry_b = TenantDictData(tenant_id=b_id, dict_type_id=type_b.dict_type_id, dict_sort=10,
                dict_label="Beta Red", dict_value="beta-red", css_class=None, list_class=None, is_default="N", status="0",
                remark=None, created_by=admin.user_id, updated_by=admin.user_id, created_at=now, updated_at=now)
            db.add_all([*entries_a, entry_b]); db.commit()
            seed = {
                "tenant_a_id": str(a_id), "tenant_b_id": str(b_id),
                "owner_token": issue_token(owner.user_id, owner.token_version),
                "admin_token": issue_token(admin.user_id, admin.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
                "type_a_id": str(types_a[0].dict_type_id), "type_a_next_id": str(types_a[1].dict_type_id),
                "empty_type_id": str(removable.dict_type_id), "type_b_id": str(type_b.dict_type_id),
                "entry_a_id": str(entries_a[0].dict_data_id), "entry_a_next_id": str(entries_a[1].dict_data_id),
            }

        api_port, web_port = free_port(), free_port()
        env = os.environ.copy()
        env.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret,
                    "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp / "api.log").open("w")
        web_log = (temp / "vite.log").open("w")
        api = None
        web = None
        try:
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
                cwd=API,
                env=env,
                stdout=api_log,
                stderr=api_log,
            )
            web = subprocess.Popen(
                [
                    PNPM,
                    "dev",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(web_port),
                    "--strictPort",
                ],
                cwd=WEB,
                env=env,
                stdout=web_log,
                stderr=web_log,
            )
            seed.update(
                {
                    "web": f"http://127.0.0.1:{web_port}",
                    "api": f"http://127.0.0.1:{api_port}/api/v1",
                }
            )
            seed_path = temp / "seed.json"
            seed_path.write_text(json.dumps(seed))
            try:
                wait_url(seed["api"] + "/health", api)
                wait_url(seed["web"], web)
            except Exception:
                print(
                    "API server log:\n",
                    (temp / "api.log").read_text(errors="replace"),
                    file=sys.stderr,
                )
                print(
                    "Vite server log:\n",
                    (temp / "vite.log").read_text(errors="replace"),
                    file=sys.stderr,
                )
                raise
            return subprocess.run(
                ["node", str(FLOW.resolve()), str(seed_path)],
                cwd=WEB,
                env=env,
            ).returncode
        finally:
            terminate_process_tree(web)
            terminate_process_tree(api)
            api_log.close()
            web_log.close()
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()


if __name__ == "__main__":
    raise SystemExit(main())

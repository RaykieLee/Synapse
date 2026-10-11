"""F21b2b4 live Redis + authenticated API verification for Skills."""
from __future__ import annotations

import asyncio
import io
import os
import shutil
import stat
import tarfile
import zipfile
from datetime import datetime, timezone

import pytest

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.integrations.agentscope_session_scope import (
    WorkspaceSessionStorage, bind_agentscope_context, reset_agentscope_context,
)
from app.tenancy.context import WorkspaceContext

pytestmark = [
    pytest.mark.redis,
    pytest.mark.windows_symlink,
]

def _ctx(tenant: int, workspace: int, actor: int) -> WorkspaceContext:
    return WorkspaceContext(actor, tenant, workspace, "member", "member", frozenset(), 1)


def test_f21b2b4_live_skill_scope_and_api(tmp_path, monkeypatch, request):
    import redis
    from agentscope.app.storage import RedisStorage, SkillRecord

    host = os.environ.get("F21B2B4_REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("F21B2B4_REDIS_PORT", "6380"))
    storage_db = int(os.environ.get("F21B2B4_REDIS_DB", "9"))
    try:
        redis.Redis(host=host, port=port, db=storage_db, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live Redis unavailable at {host}:{port}: {exc}")

    # Real API database and authenticated tenants/workspaces.
    db_path = tmp_path / "f21b2b4.sqlite"
    secret = "f21b2b4-test-secret"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", secret)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", str(storage_db))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "8")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workdirs"))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")
    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User

    now = datetime.now(timezone.utc)
    with get_session_factory()() as db:
        a1 = User(user_name="f21b2b4-a1", email="f21b2b4-a1@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
        a2 = User(user_name="f21b2b4-a2", email="f21b2b4-a2@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
        b1 = User(user_name="f21b2b4-b1", email="f21b2b4-b1@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
        db.add_all([a1, a2, b1]); db.flush()
        ta = Tenant(slug="f21b2b4-a", name="F21b2b4 A", status="active", settings_json="{}", membership_version=1)
        tb = Tenant(slug="f21b2b4-b", name="F21b2b4 B", status="active", settings_json="{}", membership_version=1)
        db.add_all([ta, tb]); db.flush()
        wa = Workspace(tenant_id=ta.tenant_id, slug="one", name="A One", status="active", settings_json="{}", created_by=a1.user_id)
        wa2 = Workspace(tenant_id=ta.tenant_id, slug="two", name="A Two", status="active", settings_json="{}", created_by=a1.user_id)
        wb = Workspace(tenant_id=tb.tenant_id, slug="one", name="B One", status="active", settings_json="{}", created_by=b1.user_id)
        db.add_all([wa, wa2, wb]); db.flush()
        db.add_all([
            TenantMember(tenant_id=ta.tenant_id, user_id=a1.user_id, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=ta.tenant_id, user_id=a2.user_id, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tb.tenant_id, user_id=b1.user_id, status="active", tenant_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wa.workspace_id, tenant_id=ta.tenant_id, user_id=a1.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wa.workspace_id, tenant_id=ta.tenant_id, user_id=a2.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wa2.workspace_id, tenant_id=ta.tenant_id, user_id=a1.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wb.workspace_id, tenant_id=tb.tenant_id, user_id=b1.user_id, status="active", workspace_role="member", joined_at=now),
        ]); db.commit()
        ids = {"a1": a1.user_id, "a2": a2.user_id, "b1": b1.user_id, "wa": wa.workspace_id, "wa2": wa2.workspace_id, "wb": wb.workspace_id, "ta": ta.tenant_id, "tb": tb.tenant_id}

    contexts = [_ctx(ids["ta"], ids["wa"], ids["a1"]), _ctx(ids["ta"], ids["wa"], ids["a2"]),
                _ctx(ids["ta"], ids["wa2"], ids["a1"]), _ctx(ids["tb"], ids["wb"], ids["b1"])]

    async def seed():
        async with RedisStorage(host=host, port=port, db=storage_db) as raw:
            proxy = WorkspaceSessionStorage(raw)
            out = []
            for i, ctx in enumerate(contexts):
                token = bind_agentscope_context(ctx)
                try:
                    row = SkillRecord(id="f21b2b4-main", user_id=str(ctx.actor_user_id), name=f"f21b2b4-{i}", description="scope test", markdown=f"body-{i}", hub_id="missing-hub", card_id="card")
                    out.append(await proxy.upsert_skill(str(ctx.actor_user_id), row))
                finally:
                    reset_agentscope_context(token)
            # Legacy raw record is deliberately not adopted by scoped storage.
            await raw.upsert_skill(str(ids["a1"]), SkillRecord(id="f21b2b4-legacy", user_id=str(ids["a1"]), name="legacy", markdown="legacy"))
            return out

    skill_ids = asyncio.run(seed())
    def cleanup_redis():
        async def clean():
            async with RedisStorage(host=host, port=port, db=storage_db) as raw:
                proxy = WorkspaceSessionStorage(raw)
                for ctx, skill_id in zip(contexts, skill_ids):
                    token = bind_agentscope_context(ctx)
                    try:
                        await proxy.delete_skill(str(ctx.actor_user_id), skill_id)
                    finally:
                        reset_agentscope_context(token)
                await raw.delete_skill(str(ids["a1"]), "f21b2b4-legacy")
        asyncio.run(clean())
    request.addfinalizer(cleanup_redis)
    assert len(set(skill_ids)) == 4
    import app.main as main_module
    from app.integrations.agentscope import create_agentscope_app as real_factory
    observed = {}
    def capture_child(settings):
        child = real_factory(settings)
        observed["child"] = child
        return child
    monkeypatch.setattr(main_module, "create_agentscope_app", capture_child)
    app = main_module.create_app()
    tokens = {k: issue_token(ids[k], 1) for k in ("a1", "a2", "b1")}
    def hdr(who, workspace):
        return {"Authorization": f"Bearer {tokens[who]}", "X-Workspace-ID": str(ids[workspace])}

    with TestClient(app, raise_server_exceptions=False) as client:
        url = "/api/v1/ai/skill"
        for who, ws, own, foreign in (("a1", "wa", skill_ids[0], skill_ids[1]),
                                      ("a2", "wa", skill_ids[1], skill_ids[0]),
                                      ("a1", "wa2", skill_ids[2], skill_ids[0]),
                                      ("b1", "wb", skill_ids[3], skill_ids[0])):
            headers = hdr(who, ws)
            listed = client.get(url, headers=headers)
            assert listed.status_code == 200, listed.text
            records = listed.json()
            assert [r["id"] for r in records] == [own], records
            assert all(r["id"] != "f21b2b4-legacy" for r in records)
            own_read = client.get(f"{url}/{own}", headers=headers)
            assert own_read.status_code == 200, own_read.text
            assert own_read.json()["markdown"].startswith("body-")
            assert client.get(f"{url}/{foreign}", headers=headers).status_code == 404
            assert client.delete(f"{url}/{foreign}", headers=headers).status_code == 404
            assert client.get(f"{url}/f21b2b4-legacy", headers=headers).status_code == 404

        # The library has descriptive metadata only; hub downloads cannot work
        # because the embedded factory registers no hub.
        agent_resp = client.post("/api/v1/ai/agent/", headers=hdr("a1", "wa"), json={"name": "f21b2b4-agent"})
        assert agent_resp.status_code == 201, agent_resp.text
        agent_id = agent_resp.json()["agent_id"]
        session_resp = client.post("/api/v1/ai/sessions/", headers=hdr("a1", "wa"), json={"agent_id": agent_id, "name": "f21b2b4-session"})
        assert session_resp.status_code == 201, session_resp.text
        params = {"agent_id": agent_id, "session_id": session_resp.json()["session_id"]}
        a2_agent_resp = client.post("/api/v1/ai/agent/", headers=hdr("a2", "wa"), json={"name": "f21b2b4-a2-agent"})
        assert a2_agent_resp.status_code == 201, a2_agent_resp.text
        a2_agent_id = a2_agent_resp.json()["agent_id"]
        a2_session_resp = client.post("/api/v1/ai/sessions/", headers=hdr("a2", "wa"), json={"agent_id": a2_agent_id, "name": "f21b2b4-a2-session"})
        assert a2_session_resp.status_code == 201, a2_session_resp.text
        from_lib = client.post("/api/v1/ai/workspace/skill/from-library", headers=hdr("a1", "wa"), params=params, json={"skill_ids": [skill_ids[1], skill_ids[0]]})
        assert from_lib.status_code == 201, from_lib.text
        payload = from_lib.json()
        assert len(payload.get("failed", {})) >= 2, payload
        assert any("not in your library" in str(item).lower() for item in payload.get("failed", {}).values()), payload

        # Deprecated host-path installation is closed regardless of supplied path.
        path_install = client.post("/api/v1/ai/workspace/skill", headers=hdr("a1", "wa"), params=params, json={"skill_path": "/etc/passwd"})
        assert path_install.status_code == 400, path_install.text
        assert "SKILL_PATH_INSTALL_DISABLED" in path_install.text

        available_empty = client.get("/api/v1/ai/workspace/skill", headers=hdr("a1", "wa"), params=params)

        # A valid folder upload creates an available Skill only in this actor's
        # current agent partition; another actor's workspace view stays empty.
        skill_md = b"---\nname: f21b2b4-safe\ndescription: safe package\n---\nSafe test instructions.\n"
        upload = client.post("/api/v1/ai/workspace/skill/upload", headers=hdr("a1", "wa"), params=params,
                             data={"manifest": '{"entries":[{"path":"f21b2b4-safe/SKILL.md","size":' + str(len(skill_md)) + '}]}'},
                             files=[("files", ("SKILL.md", skill_md, "text/markdown"))])
        assert upload.status_code in (200, 201), upload.text
        available_after_upload = client.get("/api/v1/ai/workspace/skill", headers=hdr("a1", "wa"), params=params)
        assert available_after_upload.status_code == 200, available_after_upload.text
        safe_rows = available_after_upload.json()
        assert any(row.get("name") == "f21b2b4-safe" and "Safe test instructions." in row.get("markdown", "") for row in safe_rows), safe_rows
        other_available = client.get("/api/v1/ai/workspace/skill", headers=hdr("a2", "wa"), params={"agent_id": a2_agent_id, "session_id": a2_session_resp.json()["session_id"]})
        assert other_available.status_code == 200, other_available.text
        assert not any(row.get("name") == "f21b2b4-safe" for row in other_available.json()), other_available.json()

        # Install a ZIP through the real ScopedLocalWorkspaceManager and real
        # confined filesystem backend (the public folder-upload route emits tar).
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as archive:
            archive.writestr("f21b2b4-zip/SKILL.md", "---\nname: f21b2b4-zip\ndescription: zip package\n---\nZIP instructions.\n")
        zip_blob = zip_buffer.getvalue()
        async def install_real_zip():
            from app.integrations.agentscope_session_scope import bind_agentscope_context, reset_agentscope_context
            ctx = _ctx(ids["ta"], ids["wa"], ids["a1"])
            token = bind_agentscope_context(ctx)
            try:
                manager = observed["child"].state.workspace_manager
                workspace = await manager.get_workspace(str(ids["a1"]), agent_id, params["session_id"])
                async def chunks():
                    yield zip_blob
                await workspace.add_skill_archive(chunks(), "zip", "f21b2b4-zip", agent_id=agent_id)
                rows = await workspace.list_skills(agent_id=agent_id)
                found = [row for row in rows if row.name == "f21b2b4-zip"]
                assert len(found) == 1, rows
                assert "ZIP instructions." in found[0].markdown
                await workspace.remove_skill("f21b2b4-zip", agent_id=agent_id)
                assert not any(row.name == "f21b2b4-zip" for row in await workspace.list_skills(agent_id=agent_id))
            finally:
                reset_agentscope_context(token)
        client.portal.call(install_real_zip)
        a2_zip_view = client.get("/api/v1/ai/workspace/skill", headers=hdr("a2", "wa"),
                                 params={"agent_id": a2_agent_id, "session_id": a2_session_resp.json()["session_id"]})
        assert a2_zip_view.status_code == 200, a2_zip_view.text
        assert not any(row.get("name") in {"f21b2b4-safe", "f21b2b4-zip"} for row in a2_zip_view.json()), a2_zip_view.json()

        removed = client.delete("/api/v1/ai/workspace/skill/f21b2b4-safe", headers=hdr("a1", "wa"), params=params)
        assert removed.status_code in (200, 204), removed.text
        available_after_remove = client.get("/api/v1/ai/workspace/skill", headers=hdr("a1", "wa"), params=params)
        assert available_after_remove.status_code == 200, available_after_remove.text
        assert not any(row.get("name") == "f21b2b4-safe" for row in available_after_remove.json()), available_after_remove.json()

        # Manifest validation rejects path traversal, absolute/drive paths, and oversize entries.
        for bad_path in ("../escape/SKILL.md", "/tmp/SKILL.md", "C:/outside/SKILL.md", "folder/../SKILL.md"):
            bad = client.post("/api/v1/ai/workspace/skill/upload", headers=hdr("a1", "wa"), params=params,
                              data={"manifest": '{"entries":[{"path":"' + bad_path + '","size":1}]}'},
                              files=[("files", (bad_path.split("/")[-1], b"x", "text/plain"))])
            assert bad.status_code == 422, (bad_path, bad.status_code, bad.text)
        oversized = client.post("/api/v1/ai/workspace/skill/upload", headers=hdr("a1", "wa"), params=params,
                                data={"manifest": '{"entries":[{"path":"large/SKILL.md","size":52428801}]}'},
                                files=[("files", ("SKILL.md", b"x", "text/markdown"))])
        assert oversized.status_code == 422, oversized.text
        assert available_empty.status_code == 200 and available_empty.json() == [], available_empty.text


def test_f21b2b4_archive_extractor_rejects_links_special_and_limits(tmp_path):
    """Exercise archive formats the multipart gateway cannot encode (links)."""
    from app.integrations.agentscope_workspace_scope import ScopedWorkspace

    class Backend:
        def __init__(self, root):
            self._root = os.path.realpath(root)
        def _resolve(self, path):
            return os.path.abspath(path if os.path.isabs(path) else os.path.join(self._root, path))
        def join_path(self, *parts):
            return os.path.join(*parts)
        async def file_exists(self, path):
            return os.path.exists(self._resolve(path))
        async def write_stream(self, path, stream):
            path = self._resolve(path)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as target:
                async for chunk in stream:
                    target.write(chunk)
        async def exec_shell(self, argv):
            if argv[0] == "mkdir":
                os.makedirs(self._resolve(argv[-1]), exist_ok=True)
            else:
                raise AssertionError(argv)
        async def delete_path(self, path):
            path = self._resolve(path)
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                try: os.remove(path)
                except FileNotFoundError: pass

    class Workspace:
        def __init__(self):
            self.workdir = str(tmp_path / "work")
            os.makedirs(self.workdir, exist_ok=True)
            self._backend = Backend(self.workdir)
            self._skill_lock = asyncio.Lock()
            self.installed = []
        def _declared_specs(self, agent_id, session_id):
            return []
        async def _find_skill_root(self, staging):
            for root, _, files in os.walk(staging):
                if "SKILL.md" in files:
                    return root
            raise ValueError("Skill root not found")
        async def _equip_partition(self, agent_id):
            path = os.path.join(self.workdir, "skills", agent_id or "default")
            os.makedirs(path, exist_ok=True)
            return path
        async def add_skill(self, path, *, agent_id=None):
            self.installed.append((path, agent_id))

    async def stream(blob):
        yield blob

    def zip_bytes(entries):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            for name, payload, mode in entries:
                info = zipfile.ZipInfo(name)
                if mode:
                    info.external_attr = mode << 16
                archive.writestr(info, payload)
        return out.getvalue()

    def tar_bytes(members):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w") as archive:
            for name, kind, payload in members:
                info = tarfile.TarInfo(name)
                if kind == "file":
                    info.size = len(payload)
                    archive.addfile(info, io.BytesIO(payload))
                elif kind == "symlink":
                    info.type = tarfile.SYMTYPE; info.linkname = "../outside"
                    archive.addfile(info)
                elif kind == "hardlink":
                    info.type = tarfile.LNKTYPE; info.linkname = "root/SKILL.md"
                    archive.addfile(info)
                elif kind == "fifo":
                    info.type = tarfile.FIFOTYPE
                    archive.addfile(info)
        return out.getvalue()

    async def scenario():
        base = Workspace()
        scoped = ScopedWorkspace(base, object(), "actor")
        safe_tar = tar_bytes([("pkg/SKILL.md", "file", b"---\nname: safe\n---\n")])
        await scoped.add_skill_archive(stream(safe_tar), "tar", "pkg", agent_id="agent")
        installed_dir = next((tmp_path / "work" / "skills" / "agent").iterdir())
        assert (installed_dir / "SKILL.md").read_bytes() == b"---\nname: safe\n---\n"
        bad_archives = [
            ("zip", zip_bytes([("../escape/SKILL.md", b"bad", stat.S_IFREG)])),
            ("zip", zip_bytes([("/absolute/SKILL.md", b"bad", stat.S_IFREG)])),
            ("zip", zip_bytes([("pkg/SKILL.md", b"../outside", stat.S_IFLNK)])),
            ("tar", tar_bytes([("../escape/SKILL.md", "file", b"bad")])),
            ("tar", tar_bytes([("/absolute/SKILL.md", "file", b"bad")])),
            ("tar", tar_bytes([("root/SKILL.md", "file", b"ok"), ("root/link", "symlink", b"")])),
            ("tar", tar_bytes([("root/SKILL.md", "file", b"ok"), ("root/hard", "hardlink", b"")])),
            ("tar", tar_bytes([("root/SKILL.md", "file", b"ok"), ("root/fifo", "fifo", b"")])),
        ]
        for fmt, blob in bad_archives:
            with pytest.raises((ValueError, OSError)):
                await scoped.add_skill_archive(stream(blob), fmt, "bad")
        too_large = zip_bytes([("pkg/SKILL.md", b"x" * 100, stat.S_IFREG)])
        with pytest.raises(ValueError, match="extraction limit"):
            await scoped.add_skill_archive(stream(too_large), "zip", "pkg", max_extracted_bytes=32)

    asyncio.run(scenario())

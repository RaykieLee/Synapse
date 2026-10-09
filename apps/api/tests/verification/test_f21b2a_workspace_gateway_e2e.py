"""F21b2a full Synapse gateway -> AgentScope workspace file API verification.

Run from apps/api with:
  F21B2A_REDIS_HOST=127.0.0.1 F21B2A_REDIS_PORT=6380 .venv/bin/pytest -q tests/verification/test_f21b2a_workspace_gateway_e2e.py

The Redis endpoint must be Redis 7+. Only Redis DBs 13 and 14 are used.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from fastapi.testclient import TestClient


def test_f21b2a_real_gateway_file_list_download_and_scope(tmp_path, monkeypatch):
    import os
    import redis

    redis_host = os.environ.get("F21B2A_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F21B2A_REDIS_PORT", "6380"))
    redis_client = redis.Redis(host=redis_host, port=redis_port, db=13, socket_connect_timeout=1)
    info = redis_client.info("server")
    version = str(info.get("redis_version", "0"))
    assert int(version.split(".")[0]) >= 7, f"F21b2a requires Redis 7+, got {version}"
    # Use dedicated DBs to avoid colliding with the application/test Redis data.
    redis_client.flushdb()
    redis.Redis(host=redis_host, port=redis_port, db=14).flushdb()

    db_path = tmp_path / "f21b2a-live.sqlite"
    workdir_root = tmp_path / "workspaces"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f21b2a-live-e2e-secret")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "13")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "14")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(workdir_root))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    from agentscope.app.deps import get_current_user_id, get_storage, get_workspace_service
    import app.main as main_module

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        actor_a = User(user_name="f21b2a-e2e-a", email="f21b2a-a@example.test", password_hash="unused", status="active", del_flag=False)
        actor_b = User(user_name="f21b2a-e2e-b", email="f21b2a-b@example.test", password_hash="unused", status="active", del_flag=False)
        owner_a = User(user_name="f21b2a-e2e-oa", email="f21b2a-oa@example.test", password_hash="unused")
        owner_b = User(user_name="f21b2a-e2e-ob", email="f21b2a-ob@example.test", password_hash="unused")
        db.add_all([actor_a, actor_b, owner_a, owner_b])
        db.flush()
        tenant_a = Tenant(slug="f21b2a-e2e-a", name="F21b2a E2E A", status="active", settings_json="{}", membership_version=101)
        tenant_b = Tenant(slug="f21b2a-e2e-b", name="F21b2a E2E B", status="active", settings_json="{}", membership_version=202)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        wa1 = Workspace(tenant_id=tenant_a.tenant_id, slug="one", name="A One", status="active", settings_json="{}", created_by=owner_a.user_id)
        wa2 = Workspace(tenant_id=tenant_a.tenant_id, slug="two", name="A Two", status="active", settings_json="{}", created_by=owner_a.user_id)
        wb1 = Workspace(tenant_id=tenant_b.tenant_id, slug="one", name="B One", status="active", settings_json="{}", created_by=owner_b.user_id)
        db.add_all([wa1, wa2, wb1])
        db.flush()
        aid, bid = actor_a.user_id, actor_b.user_id
        wid_a1, wid_a2, wid_b1 = wa1.workspace_id, wa2.workspace_id, wb1.workspace_id
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=aid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=bid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=bid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", tenant_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=aid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=bid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=aid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=bid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", workspace_role="owner", joined_at=now),
        ])
        db.commit()
        token_a = issue_token(aid, actor_a.token_version)
        token_b = issue_token(bid, actor_b.token_version)

    original_factory = main_module.create_agentscope_app
    state: dict[str, object] = {"child": None}

    def instrumented_factory(settings):
        child = original_factory(settings)
        state["child"] = child

        # Test-only fixture route. It still uses the actual Synapse gateway,
        # workspace service, storage wrapper, and scoped local manager to seed
        # a real file inside the session's resolved workdir.
        @child.post("/__f21b2a/seed/{agent_id}/{session_id}")
        async def seed(agent_id: str, session_id: str, request: Request,
                       user_id: str = Depends(get_current_user_id),
                       service=Depends(get_workspace_service), storage=Depends(get_storage)):
            context = request.state.synapse_context
            workspace = await service.resolve(user_id, agent_id, session_id)
            await workspace.get_backend().write_file(
                str(Path(workspace.workdir) / "sentinel.txt"),
                f"scope:{context.tenant_id}:{context.workspace_id}:{context.actor_user_id}".encode(),
            )
            outside = tmp_path / f"outside-{context.actor_user_id}-{context.workspace_id}.txt"
            outside.write_text("outside-secret", encoding="utf-8")
            (Path(workspace.workdir) / "escape-link").symlink_to(outside)
            record = await storage.get_session(user_id, agent_id, session_id)
            return {"actor_id": context.actor_user_id, "tenant_id": context.tenant_id,
                    "workspace_id": context.workspace_id, "workdir": workspace.workdir,
                    "runtime_workspace_id": record.config.workspace_id}

        @child.post("/__f21b2a/runtime-id/{agent_id}/{session_id}")
        async def runtime_id_probe(agent_id: str, session_id: str, foreign_runtime_id: str,
                                   request: Request, user_id: str = Depends(get_current_user_id)):
            context = request.state.synapse_context
            manager = request.app.state.workspace_manager
            try:
                await manager.get_workspace(user_id, agent_id, session_id, workspace_id=foreign_runtime_id)
            except Exception as exc:
                return {"rejected": True, "status": getattr(exc, "status_code", None),
                        "tenant_id": context.tenant_id, "workspace_id": context.workspace_id}
            return {"rejected": False}

        return child

    main_module.create_agentscope_app = instrumented_factory
    app = main_module.create_app()
    child = state["child"]
    assert child is not None

    headers = lambda token, wid: {"Authorization": f"Bearer {token}", "X-Workspace-ID": str(wid)}
    try:
        with TestClient(app) as client:
            base = "/api/v1/ai"
            def post_ok(path, *, token, wid, body):
                response = client.post(base + path, headers=headers(token, wid), json=body)
                assert response.status_code in (200, 201), (response.status_code, response.text)
                return response.json()

            scopes = [
                (token_a, wid_a1, "a1"),
                (token_a, wid_a2, "a2"),
                (token_b, wid_a1, "b-a1"),
                (token_b, wid_b1, "b1"),
            ]
            identities = {}
            for token, wid, name in scopes:
                agent = post_ok("/agent/", token=token, wid=wid, body={"name": f"F21b2a-{name}"})["agent_id"]
                session = post_ok("/sessions/", token=token, wid=wid, body={"agent_id": agent, "name": f"Session {name}"})["session_id"]
                seeded = post_ok(f"/__f21b2a/seed/{agent}/{session}", token=token, wid=wid, body={})
                assert (seeded["actor_id"], seeded["workspace_id"]) == (
                    aid if token == token_a else bid, wid,
                )
                root = Path(seeded["workdir"]).resolve()
                expected = (workdir_root.resolve() / f"tenant-{seeded['tenant_id']}" /
                            f"workspace-{wid}" / f"actor-{seeded['actor_id']}")
                assert root.is_relative_to(expected)
                identities[name] = {"agent": agent, "session": session, "token": token,
                                    "wid": wid, "root": root, "runtime": seeded["runtime_workspace_id"]}

            # Actual directory listing and download routes, behind the mounted
            # production Synapse JWT + membership gateway.
            own = identities["a1"]
            query = {"agent_id": own["agent"], "session_id": own["session"]}
            list_response = client.get(base + "/workspace/directories", params=query,
                                       headers=headers(own["token"], own["wid"]))
            assert list_response.status_code == 200, list_response.text
            assert "sentinel.txt" in [row["name"] for row in list_response.json()["entries"]]
            assert Path(list_response.json()["path"]).resolve() == own["root"]

            mint = client.post(base + "/workspace/files/download-token",
                               params={**query, "path": "sentinel.txt"},
                               headers=headers(own["token"], own["wid"]))
            assert mint.status_code == 200, mint.text
            download_token = mint.json()["token"]
            downloaded = client.get(base + "/workspace/files",
                                    params={**query, "path": "sentinel.txt", "token": download_token},
                                    headers=headers(own["token"], own["wid"]))
            assert downloaded.status_code == 200 and downloaded.text == f"scope:{1}:{wid_a1}:{aid}"

            # A valid token from actor A cannot use actor B's context, and a
            # session cannot be resolved in a different workspace selector.
            other_actor = identities["b-a1"]
            replay = client.get(base + "/workspace/files",
                                params={**query, "path": "sentinel.txt", "token": download_token},
                                headers=headers(other_actor["token"], other_actor["wid"]))
            assert replay.status_code in (401, 404), (replay.status_code, replay.text)
            wrong_workspace = client.get(base + "/workspace/directories", params=query,
                                         headers=headers(own["token"], wid_a2))
            assert wrong_workspace.status_code in (404, 403), (wrong_workspace.status_code, wrong_workspace.text)

            foreign = identities["a2"]
            runtime_attack = client.post(
                base + f"/__f21b2a/runtime-id/{own['agent']}/{own['session']}",
                params={"foreign_runtime_id": foreign["runtime"]},
                headers=headers(own["token"], own["wid"]),
            )
            assert runtime_attack.status_code == 200 and runtime_attack.json()["rejected"] is True
            assert runtime_attack.json()["status"] == 404

            # The file API resolves paths through the confined backend. Mint a
            # capability for each exact hostile path so rejection exercises
            # path confinement (rather than only token/path mismatch).
            outside = tmp_path / f"outside-{aid}-{wid_a1}.txt"
            hostile_paths = ["../outside.txt", str(outside), "C:\\outside\\secret", "escape-link"]
            for bad_path in hostile_paths:
                minted = client.post(base + "/workspace/files/download-token",
                                     params={**query, "path": bad_path},
                                     headers=headers(own["token"], own["wid"]))
                assert minted.status_code == 200, (bad_path, minted.status_code, minted.text)
                rejected = client.get(base + "/workspace/files",
                                      params={**query, "path": bad_path, "token": minted.json()["token"]},
                                      headers=headers(own["token"], own["wid"]))
                assert rejected.status_code == 400, (bad_path, rejected.status_code, rejected.text)
            for bad_path in ("../", str(outside), "C:\\outside"):
                rejected = client.get(base + "/workspace/directories",
                                      params={**query, "path": bad_path},
                                      headers=headers(own["token"], own["wid"]))
                assert rejected.status_code == 400, (bad_path, rejected.status_code, rejected.text)

            # A symlink is present in the resolved on-disk root and points to
            # a real outside file; both root mapping and endpoint rejection
            # are checked against the actual filesystem.
            link = own["root"] / "escape-link"
            assert link.is_symlink() and link.resolve() == outside.resolve()

            # Context checks are part of the same mounted gateway for every
            # business endpoint; missing selector and forged identity fail.
            no_selector = client.get(base + "/workspace/directories", params=query,
                                     headers={"Authorization": f"Bearer {own['token']}"})
            assert no_selector.status_code == 400
            forged = client.get(base + "/workspace/directories", params=query,
                                headers={**headers(own["token"], own["wid"]), "X-User-ID": str(bid)})
            assert forged.status_code == 400
    finally:
        main_module.create_agentscope_app = original_factory
        redis_client.flushdb()
        redis.Redis(host=redis_host, port=redis_port, db=14).flushdb()

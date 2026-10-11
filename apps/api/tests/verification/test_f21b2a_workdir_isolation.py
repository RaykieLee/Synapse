"""F21b2a: live in-process AgentScope local workdir isolation checks.

Run from apps/api with .venv/bin/pytest -q tests/verification/test_f21b2a_workdir_isolation.py
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from fastapi import HTTPException

from agentscope.app.workspace_manager import LocalWorkspaceManager
from agentscope.tool import Edit, Glob, Grep, Read, Write
from app.integrations.agentscope_session_scope import bind_agentscope_context, reset_agentscope_context
from app.integrations.agentscope_workspace_scope import ConfinedLocalBackend, ScopedLocalWorkspaceManager
from app.tenancy.context import WorkspaceContext

pytestmark = [
    pytest.mark.windows_symlink,
]

def ctx(tenant: int, workspace: int, actor: int) -> WorkspaceContext:
    return WorkspaceContext(actor, tenant, workspace, "member", "member", frozenset({"resource:read", "resource:create", "resource:update"}), 1)


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("tenant,workspace,actor", [(1, 10, 101), (1, 10, 102), (1, 11, 101), (2, 20, 201)])
def test_scope_paths_are_distinct(tmp_path, tenant, workspace, actor):
    async def scenario():
        mgr = ScopedLocalWorkspaceManager(LocalWorkspaceManager(str(tmp_path)))
        token = bind_agentscope_context(ctx(tenant, workspace, actor))
        try:
            ws = await mgr.get_workspace(str(actor), "shared-agent", "session")
            marker = Path(ws.workdir) / "scope.txt"
            await Write(backend=ws._backend).call(file_path=str(marker), content=f"{tenant}:{workspace}:{actor}")
            assert await ws._backend.read_file(str(marker)) == f"{tenant}:{workspace}:{actor}".encode()
            assert "tenant-" in ws.workdir and f"tenant-{tenant}" in ws.workdir
            assert f"workspace-{workspace}" in ws.workdir and f"actor-{actor}" in ws.workdir
        finally:
            reset_agentscope_context(token)
    run(scenario())


def test_tools_backend_scope_and_attacks(tmp_path):
    async def scenario():
        mgr = ScopedLocalWorkspaceManager(LocalWorkspaceManager(str(tmp_path)))
        contexts = [ctx(1, 10, 101), ctx(1, 10, 102), ctx(1, 11, 101), ctx(2, 20, 201)]
        workspaces = []
        for index, context in enumerate(contexts):
            token = bind_agentscope_context(context)
            workspaces.append(await mgr.get_workspace(str(context.actor_user_id), "agent/x", f"s{index}"))
            reset_agentscope_context(token)
        roots = {Path(ws.workdir) for ws in workspaces}
        assert len(roots) == 4
        a, same_workspace_other_actor, other_workspace, other_tenant = workspaces
        a_file = Path(a.workdir) / "nested" / "note.txt"
        write = Write(backend=a._backend)
        read = Read(backend=a._backend)
        edit = Edit(backend=a._backend)
        written = await write.call(file_path=str(a_file), content="private data")
        assert written is not None
        await read.call(file_path=str(a_file))
        edited = await edit.call(file_path=str(a_file), old_string="private", new_string="updated")
        assert edited is not None
        assert await a._backend.read_file(str(a_file)) == b"updated data"
        for foreign in (same_workspace_other_actor, other_workspace, other_tenant):
            assert not await foreign._backend.file_exists("nested/note.txt")
            assert "nested" not in await foreign._backend.list_dir(foreign.workdir)

        # Backend entry points all share the path guard.
        for path in ("../escape", str(tmp_path / "outside")):
            with pytest.raises(HTTPException) as exc:
                await a._backend.read_file(path)
            assert exc.value.status_code == 400
        outside = tmp_path / "outside.txt"
        outside.write_text("must not leak")
        link = Path(a.workdir) / "linked"
        link.symlink_to(outside)
        with pytest.raises(HTTPException):
            await a._backend.read_file(str(link))
        with pytest.raises(HTTPException):
            await a._backend.write_file(str(link), b"attack")
        with pytest.raises(PermissionError):
            await a._backend.exec_shell(["sh", "-c", "cat /etc/passwd"])
        with pytest.raises(PermissionError):
            await a._backend.exec_shell(["rg", "secret", str(tmp_path)])
        with pytest.raises(PermissionError):
            await a._backend.exec_shell(["python", "-c", "print(1)"])
        for search in (Glob(backend=a._backend), Grep(backend=a._backend)):
            with pytest.raises(PermissionError):
                await search.call(pattern="*", path=a.workdir) if isinstance(search, Glob) else await search.call(pattern="secret", path=a.workdir)

        # Public path resolution refuses absolute paths, traversal and symlink components.
        for path in ("../outside.txt", str(outside), "C:\\outside\\secret", "linked/secret"):
            with pytest.raises(HTTPException):
                a._backend.abspath(path, cwd=a.workdir)

        # Runtime IDs issued in one tenant/workspace/actor scope cannot be replayed in another.
        token = bind_agentscope_context(contexts[0])
        try:
            own_id = await mgr.assign_workspace_id(user_id="101", agent_id="agent", session_id="s")
        finally:
            reset_agentscope_context(token)
        token = bind_agentscope_context(contexts[1])
        try:
            with pytest.raises(HTTPException) as exc:
                await mgr.get_workspace("102", "agent", "s", workspace_id=own_id)
            assert exc.value.status_code == 404
        finally:
            reset_agentscope_context(token)

        # Delete remains confined, and a fresh manager reconstructs only the same actor's disk data.
        await a._backend.delete_path(str(a_file))
        assert not await a._backend.file_exists(str(a_file))
        fresh = ScopedLocalWorkspaceManager(LocalWorkspaceManager(str(tmp_path)))
        token = bind_agentscope_context(contexts[0])
        try:
            recovered = await fresh.get_workspace("101", "agent/x", "different-session")
            assert recovered.workdir == a.workdir
            with pytest.raises(HTTPException):
                await recovered._backend.file_exists(str(link))
            with pytest.raises(HTTPException):
                await recovered._backend.read_file(str(link))
        finally:
            reset_agentscope_context(token)
    run(scenario())


def test_workspace_file_http_routes_use_guard(tmp_path):
    """Exercise AgentScope's actual workspace file router over HTTP with isolated test auth."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from agentscope.app._router import workspace_router
    from agentscope.app.deps import get_current_user_id, get_workspace_service

    manager = ScopedLocalWorkspaceManager(LocalWorkspaceManager(str(tmp_path / "http")))
    context = ctx(7, 70, 707)
    bound = bind_agentscope_context(context)
    try:
        workspace = run(manager.get_workspace("707", "http-agent", "http-session"))
    finally:
        reset_agentscope_context(bound)
    marker = Path(workspace.workdir) / "http.txt"
    run(Write(backend=workspace._backend).call(file_path=str(marker), content="http-private"))

    class Service:
        async def resolve(self, user_id, agent_id, session_id):
            assert user_id == "707"
            assert agent_id == "http-agent" and session_id == "http-session"
            return workspace

        def sign_download_token(self, user_id, path):
            return ("test-token", 4102444800.0)

        def verify_download_token(self, token, path):
            if token != "test-token":
                raise ValueError("invalid token")
            return "707"

    app = FastAPI()
    app.include_router(workspace_router)
    app.dependency_overrides[get_current_user_id] = lambda: "707"
    app.dependency_overrides[get_workspace_service] = lambda: Service()
    with TestClient(app) as client:
        query = {"agent_id": "http-agent", "session_id": "http-session"}
        listing = client.get("/workspace/directories", params=query)
        assert listing.status_code == 200 and "http.txt" in [entry["name"] for entry in listing.json()["entries"]]
        for bad_path in ("../", str(tmp_path), "C:\\outside"):
            assert client.get("/workspace/directories", params={**query, "path": bad_path}).status_code == 400
        token_response = client.post("/workspace/files/download-token", params={**query, "path": "http.txt"})
        assert token_response.status_code == 200
        token = token_response.json()["token"]
        assert client.get("/workspace/files", params={**query, "path": "http.txt", "token": token}).text == "http-private"
        for bad_path in ("../outside.txt", str(tmp_path / "outside.txt"), "C:\\outside\\secret"):
            response = client.get("/workspace/files", params={**query, "path": bad_path, "token": token})
            assert response.status_code == 400, (bad_path, response.status_code, response.text)
        outside = tmp_path / "outside.txt"
        outside.write_text("nope")
        link = Path(workspace.workdir) / "escape-link"
        link.symlink_to(outside)
        response = client.get("/workspace/files", params={**query, "path": "escape-link", "token": token})
        assert response.status_code == 400

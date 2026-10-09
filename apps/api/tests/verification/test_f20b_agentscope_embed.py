"""Live same-process AgentScope/FastAPI mounting, auth override and lifespan test."""
import socket
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import Depends
from sqlalchemy import inspect


def test_f20b_agentscope_embed_live(tmp_path, monkeypatch):
    redis_host = __import__("os").environ.get("F20B_REDIS_HOST", "127.0.0.1")
    redis_port = int(__import__("os").environ.get("F20B_REDIS_PORT", "16379"))
    try:
        import redis
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.fail(f"F20b requires a live Redis endpoint at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f20b-agentscope.sqlite"
    secret = "f20b-live-verification-secret"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", secret)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "runtime-workspaces"))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")
    from app.models.user import User
    factory = get_session_factory()
    with factory() as db:
        user = User(user_name="f20b-owner", email="f20b-owner@example.test", password_hash="unused")
        db.add(user); db.commit()
        actor_id = user.user_id
        token_version = user.token_version

    from app.auth.security import issue_token
    token = issue_token(actor_id, token_version)
    import app.main as main_module
    from agentscope.app.deps import get_current_user_id

    original_factory = main_module.create_agentscope_app
    observed = {"child": None, "entered": 0, "exited": 0}

    def instrumented_factory(settings):
        child = original_factory(settings)
        observed["child"] = child
        original_lifespan = child.router.lifespan_context

        @asynccontextmanager
        async def counted_lifespan(app):
            observed["entered"] += 1
            try:
                async with original_lifespan(app):
                    yield
            finally:
                observed["exited"] += 1

        child.router.lifespan_context = counted_lifespan

        @child.get("/__f20b/identity")
        async def identity(user_id: str = Depends(get_current_user_id)):
            return {"user_id": user_id}

        return child

    main_module.create_agentscope_app = instrumented_factory
    app = main_module.create_app()
    child = observed["child"]
    assert child is not None
    assert any(getattr(route, "name", None) == "agentscope" and getattr(route, "path", None) == "/api/v1/ai" for route in app.routes)

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="f20b-uvicorn", daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 30
        with httpx.Client(timeout=4) as client:
            while time.monotonic() < deadline:
                if not thread.is_alive():
                    raise AssertionError("Uvicorn exited before startup finished")
                try:
                    root_health = client.get(base + "/api/v1/health")
                    if root_health.status_code == 200:
                        break
                except httpx.HTTPError:
                    time.sleep(0.1)
            else:
                raise AssertionError("Synapse root health did not become available")

            # Both roots answer through the same bound socket/port.
            assert root_health.json()["status"] == "ok"
            assert client.get(base + "/api/v1/health").status_code == 200

            # AgentScope health is authenticated and confirms lifespan-created state is ready.
            no_auth_health = client.get(base + "/api/v1/ai/health")
            assert no_auth_health.status_code == 401
            headers = {"Authorization": f"Bearer {token}", "X-User-ID": "999999-forged-client-id"}
            ai_health = client.get(base + "/api/v1/ai/health", headers=headers)
            assert ai_health.status_code == 200, ai_health.text
            health_data = ai_health.json()
            assert health_data["status"] == "ok", health_data
            assert all(value != "not_ready" for value in health_data["components"].values())

            # A test-only child route exposes the dependency result to prove the mounted
            # child uses the Synapse JWT override rather than a forged X-User-ID header.
            no_auth_identity = client.get(base + "/api/v1/ai/__f20b/identity", headers={"X-User-ID": "999999"})
            assert no_auth_identity.status_code == 401
            identity = client.get(base + "/api/v1/ai/__f20b/identity", headers=headers)
            assert identity.status_code == 200, identity.text
            assert identity.json() == {"user_id": str(actor_id)}
            assert observed["entered"] == 1
    finally:
        server.should_exit = True
        thread.join(timeout=15)
        main_module.create_agentscope_app = original_factory

    assert not thread.is_alive(), "Uvicorn did not stop cleanly"
    assert observed["entered"] == 1
    assert observed["exited"] == 1, "AgentScope child lifespan should exit exactly once"
    storage = child.state.storage
    bus = child.state.message_bus
    assert storage.get_client() is None and storage._owned_pool is None
    assert bus.get_client() is None and bus._owned_pool is None
    workspace_path = tmp_path / "runtime-workspaces"
    assert Path(child.state.workspace_manager._basedir) == workspace_path.resolve()

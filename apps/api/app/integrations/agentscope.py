"""Construct the AgentScope ASGI sub-application for Synapse embedding."""
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status

from app.auth.errors import install_error_handlers
from app.core.config import Settings
from app.integrations.agentscope_gateway import AgentScopeWorkspaceGateway
from app.integrations.agentscope_session_scope import WorkspaceSessionStorage
from app.integrations.agentscope_wakeup import install_scoped_wakeup_runtime
from app.integrations.agentscope_workspace_scope import ScopedLocalWorkspaceManager
from app.tenancy.context import WorkspaceContext


def _authenticated_agentscope_user_id(request: Request) -> str:
    """Map the gateway's verified actor to AgentScope's owner identity."""
    context = getattr(request.state, "synapse_context", None)
    if not isinstance(context, WorkspaceContext):
        raise HTTPException(status_code=401, detail={"code": "AUTHENTICATION_REQUIRED"})
    return str(context.actor_user_id)


def _install_scoped_credential_runtime_resolution() -> None:
    """Decrypt credentials only on ResourceAccessService runtime lookup."""
    from agentscope.app.access import ResourceKind
    from agentscope.app._service import ResourceAccessService

    if getattr(ResourceAccessService, "_synapse_credential_runtime", False):
        return

    async def resolve_credential(self: Any, viewer_id: str, credential_id: str) -> Any:
        record = await self._storage.get_credential_for_runtime(viewer_id, credential_id)
        if record is not None:
            return record
        # Credentials are intentionally actor-private in this embedding;
        # cross-owner ResourceAccessPolicy refs do not override scope.
        raise self._not_found(ResourceKind.CREDENTIAL, credential_id)

    ResourceAccessService.resolve_credential = resolve_credential
    ResourceAccessService._synapse_credential_runtime = True


def create_agentscope_app(settings: Settings) -> FastAPI:
    """Build AgentScope with persistent local workdirs and Redis backends.

    F21b resource adapters scope sessions, agent definitions, MCP/Skill
    metadata, model credentials, and local workdirs. Other AgentScope resource
    classes remain separate work.
    """
    install_scoped_wakeup_runtime()
    from agentscope.app import create_app as create_agent_service
    from agentscope.app._service import AgentView
    from agentscope.app.deps import get_current_user_id, get_storage
    from agentscope.app.message_bus import RedisMessageBus
    from agentscope.app.storage import RedisStorage, StorageBase
    from agentscope.app.workspace_manager import LocalWorkspaceManager

    _install_scoped_credential_runtime_resolution()

    redis_password = settings.agentscope_redis_password.get_secret_value() if settings.agentscope_redis_password else None
    storage = RedisStorage(
        host=settings.agentscope_redis_host,
        port=settings.agentscope_redis_port,
        db=settings.agentscope_storage_redis_db,
        password=redis_password,
    )
    scoped_storage = WorkspaceSessionStorage(
        storage,
        credential_encryption_key=(
            settings.agentscope_credential_encryption_key.get_secret_value()
            if settings.agentscope_credential_encryption_key
            else None
        ),
    )
    message_bus = RedisMessageBus(
        host=settings.agentscope_redis_host,
        port=settings.agentscope_redis_port,
        db=settings.agentscope_bus_redis_db,
        password=redis_password,
    )
    workspace_manager = ScopedLocalWorkspaceManager(
        LocalWorkspaceManager(basedir=str(settings.agentscope_workspace_path)),
    )
    app = create_agent_service(
        storage=scoped_storage,
        message_bus=message_bus,
        workspace_manager=workspace_manager,
        enable_index_worker=False,
        enable_channel_worker=False,
        enable_scheduler=False,
        download_secret=(
            settings.agentscope_download_secret.get_secret_value()
            if settings.agentscope_download_secret
            else None
        ),
        title="Synapse AI",
    )
    # The parent Synapse API uses this same scoped adapter for F27b ownership
    # checks; no second Redis namespace or unscoped storage is created.
    app.state.synapse_scoped_storage = scoped_storage
    # The child app resolves its own dependencies. Replace AgentScope's
    # client-controlled X-User-ID dependency with Synapse JWT/session auth.
    from agentscope.app.deps import get_current_user_id

    app.dependency_overrides[get_current_user_id] = _authenticated_agentscope_user_id
    app.add_middleware(AgentScopeWorkspaceGateway, session_storage=scoped_storage)
    install_error_handlers(app)

    # AgentScope currently has no GET /agent/{agent_id} route (PATCH and
    # DELETE exist). Keep this read endpoint in the same child app so it
    # inherits the Synapse gateway, verified Workspace context, dependency
    # overrides, and public /api/v1/ai prefix.
    agent_detail_router = APIRouter(tags=["agent"])

    @agent_detail_router.get(
        "/agent/{agent_id}",
        response_model=AgentView,
        summary="Get an agent definition in the current Workspace",
    )
    async def get_agent_detail(
        agent_id: str,
        user_id: str = Depends(get_current_user_id),
        scoped_storage: StorageBase = Depends(get_storage),
    ) -> AgentView:
        record = await scoped_storage.get_agent(user_id, agent_id)
        if record is None or record.user_id != user_id or record.id != agent_id:
            # The storage adapter only resolves IDs in the verified
            # tenant/workspace/actor namespace; return the same result for
            # foreign, legacy, and nonexistent IDs.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "RESOURCE_NOT_FOUND"},
            )
        return AgentView.model_validate(
            {**record.model_dump(), "editable": True},
        )

    app.include_router(agent_detail_router)
    return app

"""Construct the AgentScope ASGI sub-application for Synapse embedding."""
from functools import wraps
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status

from app.auth.errors import install_error_handlers
from app.core.config import Settings
from app.integrations.agentscope_gateway import AgentScopeWorkspaceGateway
from app.integrations.agentscope_session_scope import (
    WorkspaceSessionStorage,
    bind_agentscope_context,
    reset_agentscope_context,
    resolve_knowledge_resource_context,
)
from app.integrations.agentscope_wakeup import install_scoped_wakeup_runtime
from app.integrations.agentscope_workspace_scope import ScopedLocalWorkspaceManager
from app.tenancy.context import WorkspaceContext


def _build_optional_agentscope_components(
    settings: Settings,
    scoped_storage: Any,
) -> dict[str, Any]:
    """Build optional AgentScope components from explicit local settings.

    The defaults stay disabled so unit tests and deployments without the
    external services retain the previous startup behavior. The local demo
    enables these components through ``apps/api/.env``.
    """
    components: dict[str, Any] = {
        "knowledge_base_manager": None,
        "blob_store": None,
        "mcp_hubs": None,
        "skill_hubs": None,
        "channels": None,
        "enable_index_worker": False,
        "enable_channel_worker": False,
        "enable_scheduler": settings.agentscope_scheduler_enabled,
    }

    if settings.agentscope_knowledge_enabled:
        from agentscope.app.rag.blob_store import LocalBlobStore
        from agentscope.app.rag.knowledge_base_manager import (
            CollectionPerKbManager,
        )
        from agentscope.rag import QdrantStore

        if settings.agentscope_qdrant_url:
            vector_store = QdrantStore(url=settings.agentscope_qdrant_url)
        elif settings.agentscope_qdrant_path:
            vector_store = QdrantStore(path=str(settings.agentscope_qdrant_path))
        else:
            raise RuntimeError(
                "AgentScope knowledge is enabled but no Qdrant URL or path "
                "is configured",
            )

        components["knowledge_base_manager"] = CollectionPerKbManager(
            storage=scoped_storage,
            vector_store=vector_store,
        )
        components["blob_store"] = LocalBlobStore(
            root_dir=settings.agentscope_blob_path,
        )
        components["enable_index_worker"] = True

    if settings.agentscope_hubs_enabled:
        from agentscope.app.hub import ClawSkillHub, GitHubMCPHub

        github_token = (
            settings.agentscope_github_token.get_secret_value()
            if settings.agentscope_github_token
            else None
        )
        clawhub_token = (
            settings.agentscope_clawhub_token.get_secret_value()
            if settings.agentscope_clawhub_token
            else None
        )
        components["mcp_hubs"] = [GitHubMCPHub(api_token=github_token)]
        components["skill_hubs"] = [ClawSkillHub(api_token=clawhub_token)]

    if settings.agentscope_channel_enabled:
        from agentscope.app.channel import (
            DingTalkChannel,
            DiscordChannel,
            FeishuChannel,
        )

        components["channels"] = [
            DingTalkChannel,
            DiscordChannel,
            FeishuChannel,
        ]
        components["enable_channel_worker"] = True

    return components


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


def _install_scoped_index_runtime() -> None:
    """Restore Workspace context around AgentScope's background index worker."""
    from agentscope.app._service import IndexWorker

    if getattr(IndexWorker, "_synapse_workspace_scope", False):
        return

    original_process = IndexWorker.process

    @wraps(original_process)
    async def process(
        self: Any,
        user_id: str,
        knowledge_base_id: str,
        document_id: str,
    ) -> Any:
        context = resolve_knowledge_resource_context(user_id, knowledge_base_id)
        if context is None:
            # Fail closed for stale, foreign, or legacy unscoped records.
            return None
        token = bind_agentscope_context(context)
        try:
            return await original_process(
                self,
                user_id=user_id,
                knowledge_base_id=knowledge_base_id,
                document_id=document_id,
            )
        finally:
            reset_agentscope_context(token)

    IndexWorker.process = process
    IndexWorker._synapse_workspace_scope = True


def create_agentscope_app(settings: Settings) -> FastAPI:
    """Build AgentScope with persistent local workdirs and Redis backends.

    F21b resource adapters scope sessions, agent definitions, MCP/Skill
    metadata, model credentials, and local workdirs. Other AgentScope resource
    classes remain separate work.
    """
    install_scoped_wakeup_runtime()
    _install_scoped_index_runtime()
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
    optional_components = _build_optional_agentscope_components(
        settings,
        scoped_storage,
    )
    app = create_agent_service(
        storage=scoped_storage,
        message_bus=message_bus,
        workspace_manager=workspace_manager,
        **optional_components,
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

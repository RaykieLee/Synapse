"""AgentScope ownership adapter for F27b team definitions."""

from __future__ import annotations

from anyio import from_thread

from app.integrations.agentscope_session_scope import (
    WorkspaceSessionStorage,
    bind_agentscope_context,
    reset_agentscope_context,
)
from app.services.team_orchestration import AgentAuthorization, AgentAuthorizationUnavailable
from app.tenancy.context import WorkspaceContext


class AgentScopeAgentAuthorization(AgentAuthorization):
    """Resolve agent ownership from the already scoped AgentScope storage."""

    def __init__(self, storage: WorkspaceSessionStorage):
        self.storage = storage

    def validate(
        self,
        *,
        tenant_id: int,
        workspace_id: int,
        actor_user_id: int,
        agent_ids: set[str],
    ) -> None:
        if not agent_ids:
            return
        context = WorkspaceContext(
            actor_user_id=actor_user_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            tenant_role="member",
            workspace_role="member",
            permission_set=frozenset(),
            membership_version=0,
        )
        token = bind_agentscope_context(context)
        try:
            try:
                # Sync FastAPI routes run in AnyIO workers; reuse the lifespan
                # loop that owns this storage's Redis connections and context.
                owned_ids = set(from_thread.run(self._list_agent_ids, actor_user_id))
            except RuntimeError as exc:
                raise AgentAuthorizationUnavailable(
                    "AgentScope ownership lookup is unavailable"
                ) from exc
        finally:
            reset_agentscope_context(token)

        missing = agent_ids - owned_ids
        if missing:
            raise AgentAuthorizationUnavailable(
                "One or more agents are not owned by the current Workspace actor"
            )

    async def _list_agent_ids(self, actor_user_id: int) -> list[str]:
        records = await self.storage.list_agents(str(actor_user_id))
        return [str(record.id) for record in records]

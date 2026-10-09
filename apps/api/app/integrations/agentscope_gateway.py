"""Synapse authentication and collaboration-Workspace gateway for AgentScope."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote

from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.security.utils import get_authorization_scheme_param
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app.auth.dependencies import get_current_user
from app.auth.errors import problem
from app.database.session import get_session_factory
from app.integrations.agentscope_session_scope import bind_agentscope_context, reset_agentscope_context
from app.integrations.agentscope_session_scope import WorkspaceSessionStorage
from app.models.user import User
from app.tenancy.context import WorkspaceContext, get_workspace_context


class AgentScopeWorkspaceGateway:
    """Require live Synapse JWT/cookie and Workspace membership on every child request.

    `X-Workspace-ID` is only a requested context selector. Actor and tenant
    identities are always resolved from the active account and Workspace row.
    """

    def __init__(self, app: Any, session_storage: WorkspaceSessionStorage | None = None) -> None:
        self.app = app
        self.session_storage = session_storage

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        scope_type = scope.get("type")
        if scope_type == "websocket":
            # There are no pinned AgentScope websocket routes. Reject the protocol
            # until an authenticated, revocation-aware message loop is designed.
            await send({"type": "websocket.close", "code": 4403, "reason": "AI_WEBSOCKET_UNAVAILABLE"})
            return
        if scope_type != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        try:
            workspace_context = await run_in_threadpool(self._resolve_context, scope, request)
        except HTTPException as exc:
            await self._http_problem(scope, receive, send, exc.status_code, _error_code(exc), _error_detail(exc))
            return
        except Exception:
            await self._http_problem(scope, receive, send, 500, "INTERNAL_ERROR", "Internal server error")
            return

        # Put the immutable, server-derived authority object on ASGI state before
        # any AgentScope router/dependency executes.
        scope.setdefault("state", {})["synapse_context"] = workspace_context

        context_token = bind_agentscope_context(workspace_context)
        try:
            try:
                await self._validate_session_status_agent(scope, request, workspace_context)
            except HTTPException as exc:
                await self._http_problem(scope, receive, send, exc.status_code, _error_code(exc), _error_detail(exc))
                return
            # Await the complete ASGI response call, not just route dispatch.
            # For StreamingResponse this includes iteration of the response
            # body. ContextVars are inherited by Starlette's stream task and
            # AgentScope's Redis feeder task; the token is reset only after
            # normal completion, disconnect cancellation, or an exception.
            await self.app(scope, receive, send)
        finally:
            reset_agentscope_context(context_token)

    async def _validate_session_status_agent(
        self, scope: dict[str, Any], request: Request, context: WorkspaceContext,
    ) -> None:
        """Hide status and run-lock state when agent_id does not own the session.

        AgentScope's status service probes the session lock before loading the
        session record. Validate the scoped record and its agent first so an
        otherwise valid session ID cannot reveal status under a wrong agent ID.
        This guard is intentionally limited to the status route; SSE keeps its
        existing per-session storage and authorization checks.
        """
        if self.session_storage is None or scope.get("method") != "GET":
            return
        path = unquote(scope.get("path", ""))
        match = re.fullmatch(r"(?:.*/)?sessions/([^/]+)/status", path.lstrip("/"))
        if match is None:
            return
        agent_id = request.query_params.get("agent_id")
        if not agent_id:
            return  # Let AgentScope return its normal required-query validation.
        session_id = match.group(1)
        record = await self.session_storage.get_session(
            str(context.actor_user_id), agent_id, session_id,
        )
        if record is None or record.id != session_id or record.agent_id != agent_id:
            raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND"})

    @staticmethod
    def _resolve_context(scope: dict[str, Any], request: Request) -> WorkspaceContext:
        headers = scope.get("headers", [])
        user_headers = [value for name, value in headers if name.lower() == b"x-user-id"]
        tenant_headers = [value for name, value in headers if name.lower() == b"x-tenant-id"]
        workspace_headers = [value for name, value in headers if name.lower() == b"x-workspace-id"]
        if user_headers:
            raise HTTPException(status_code=400, detail={"code": "IDENTITY_HEADER_FORBIDDEN"})
        if tenant_headers:
            raise HTTPException(status_code=400, detail={"code": "TENANT_CONTEXT_FORBIDDEN"})
        if len(workspace_headers) > 1:
            raise HTTPException(status_code=400, detail={"code": "CONTEXT_MISMATCH"})
        workspace_id = workspace_headers[0].decode("latin-1") if workspace_headers else None

        authorization = request.headers.get("authorization")
        scheme, parameter = get_authorization_scheme_param(authorization)
        credentials = (
            HTTPAuthorizationCredentials(scheme=scheme, credentials=parameter)
            if scheme.lower() == "bearer" and parameter
            else None
        )
        db = get_session_factory()()
        try:
            user: User = get_current_user(request, credentials=credentials, db=db)
            return get_workspace_context(request, x_workspace_id=workspace_id, user=user, db=db)
        finally:
            db.close()

    @staticmethod
    async def _http_problem(scope: dict[str, Any], receive: Any, send: Any,
                            status_code: int, code: str, detail: str | None) -> None:
        response: Response = problem(status_code, code, detail)
        await response(scope, receive, send)


def _error_code(exc: HTTPException) -> str:
    detail = exc.detail
    return detail.get("code", "REQUEST_ERROR") if isinstance(detail, dict) else "REQUEST_ERROR"


def _error_detail(exc: HTTPException) -> str | None:
    detail = exc.detail
    return detail.get("detail") if isinstance(detail, dict) else (detail if isinstance(detail, str) else None)

"""FastAPI adapters for trusted tenant and Workspace contexts."""

from typing import NoReturn

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.tenancy.resolver import (
    ContextResolutionError,
    TenantContext,
    WorkspaceContext,
    _ROLE_PERMISSIONS,
    _TENANT_ROLE_PERMISSIONS,
    resolve_tenant_context,
    resolve_workspace_context,
)


_HTTP_STATUS_BY_CONTEXT_ERROR = {
    "RESOURCE_NOT_FOUND": 404,
    "WORKSPACE_CONTEXT_REQUIRED": 400,
    "CONTEXT_MISMATCH": 400,
    "MEMBERSHIP_INACTIVE": 403,
    "WORKSPACE_MEMBERSHIP_REQUIRED": 403,
    "TENANT_INACTIVE": 409,
    "WORKSPACE_INACTIVE": 409,
    "FORBIDDEN": 403,
}


def _fail(status: int, code: str) -> NoReturn:
    raise HTTPException(status_code=status, detail={"code": code})


def _raise_context_error(error: ContextResolutionError) -> NoReturn:
    try:
        status = _HTTP_STATUS_BY_CONTEXT_ERROR[error.code]
    except KeyError as exc:
        raise RuntimeError(f"No HTTP status mapping for tenancy error {error.code!r}") from exc
    raise HTTPException(status_code=status, detail={"code": error.code}) from error


def get_workspace_context(
    request: Request,
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkspaceContext:
    """Validate a workspace hint and derive all authority from database memberships.

    Path-bound APIs must also supply X-Workspace-ID; a mismatch is rejected. Platform
    administration grants no workspace membership or access to tenant business data.
    """
    try:
        return resolve_workspace_context(
            db=db,
            actor_user_id=user.user_id,
            path_workspace_id=request.path_params.get("workspace_id"),
            x_workspace_id=x_workspace_id,
        )
    except ContextResolutionError as exc:
        _raise_context_error(exc)


def get_tenant_context(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TenantContext:
    """Resolve a tenant path ID through the current user's active membership.

    This dependency deliberately does not accept a tenant header or grant a
    platform-admin bypass. The tenant ID is route context only; membership is
    checked on every request and inactive tenants fail closed.
    """
    try:
        return resolve_tenant_context(
            db=db,
            actor_user_id=user.user_id,
            raw_tenant_id=request.path_params.get("tenant_id"),
        )
    except ContextResolutionError as exc:
        _raise_context_error(exc)


def require_tenant_permission(permission: str):
    """Build a FastAPI dependency requiring one tenant-scoped permission."""
    def dependency(context: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if permission not in context.permission_set:
            _fail(403, "FORBIDDEN")
        return context
    return dependency


def require_workspace_permission(permission: str):
    def dependency(context: WorkspaceContext = Depends(get_workspace_context)) -> WorkspaceContext:
        if permission not in context.permission_set:
            _fail(403, "FORBIDDEN")
        return context
    return dependency

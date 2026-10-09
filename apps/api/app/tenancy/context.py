"""Trusted, immutable actor and workspace authorization context."""
from dataclasses import dataclass
import json
from typing import FrozenSet

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole
from app.models.user import User


@dataclass(frozen=True)
class WorkspaceContext:
    actor_user_id: int
    tenant_id: int
    workspace_id: int
    tenant_role: str
    workspace_role: str
    permission_set: FrozenSet[str]
    membership_version: int


@dataclass(frozen=True)
class TenantContext:
    actor_user_id: int
    tenant_id: int
    tenant_role: str
    permission_set: FrozenSet[str]
    membership_version: int


_ROLE_PERMISSIONS = {
    "owner": frozenset({"resource:read", "resource:create", "resource:update", "resource:delete", "workspace:update", "workspace_member:manage", "workspace:transfer_ownership"}),
    "admin": frozenset({"resource:read", "resource:create", "resource:update", "resource:delete", "workspace:update", "workspace_member:manage"}),
    "member": frozenset({"resource:read", "resource:create", "resource:update"}),
    "viewer": frozenset({"resource:read"}),
}

_TENANT_ROLE_PERMISSIONS = {
    "owner": frozenset({"tenant:read", "tenant:update", "tenant:archive", "tenant_member:manage"}),
    "admin": frozenset({"tenant:read", "tenant:update", "tenant_member:manage"}),
    "member": frozenset({"tenant:read"}),
}


def _fail(status: int, code: str):
    raise HTTPException(status_code=status, detail={"code": code})


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
    path_id = request.path_params.get("workspace_id")
    if path_id is not None:
        try:
            path_id = int(path_id)
        except (ValueError, TypeError):
            _fail(404, "RESOURCE_NOT_FOUND")
        if x_workspace_id is None:
            _fail(400, "WORKSPACE_CONTEXT_REQUIRED")
        if not x_workspace_id.isdecimal() or int(x_workspace_id) != path_id:
            _fail(400, "CONTEXT_MISMATCH")
    elif x_workspace_id is None:
        _fail(400, "WORKSPACE_CONTEXT_REQUIRED")
    elif not x_workspace_id.isdecimal():
        _fail(400, "CONTEXT_MISMATCH")
    workspace_id = path_id if path_id is not None else int(x_workspace_id)
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    tenant = db.get(Tenant, workspace.tenant_id)
    if tenant is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    tenant_member = db.scalar(select(TenantMember).where(
        TenantMember.tenant_id == tenant.tenant_id, TenantMember.user_id == user.user_id))
    if not tenant_member or tenant_member.status != "active":
        _fail(403, "MEMBERSHIP_INACTIVE")
    membership = db.scalar(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace.workspace_id,
        WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.user_id == user.user_id))
    if not membership or membership.status != "active":
        _fail(403, "WORKSPACE_MEMBERSHIP_REQUIRED")
    if tenant.status != "active":
        _fail(409, "TENANT_INACTIVE")
    if workspace.status != "active":
        _fail(409, "WORKSPACE_INACTIVE")
    return WorkspaceContext(user.user_id, tenant.tenant_id, workspace.workspace_id,
                            tenant_member.tenant_role, membership.workspace_role,
                            _ROLE_PERMISSIONS.get(membership.workspace_role, frozenset()),
                            tenant.membership_version)


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
    raw_tenant_id = request.path_params.get("tenant_id")
    try:
        tenant_id = int(raw_tenant_id)
    except (TypeError, ValueError):
        _fail(404, "RESOURCE_NOT_FOUND")
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    member = db.scalar(select(TenantMember).where(
        TenantMember.tenant_id == tenant.tenant_id,
        TenantMember.user_id == user.user_id,
    ))
    if member is None or member.status != "active":
        _fail(403, "MEMBERSHIP_INACTIVE")
    if tenant.status != "active":
        _fail(409, "TENANT_INACTIVE")
    permissions = _TENANT_ROLE_PERMISSIONS.get(member.tenant_role, frozenset())
    # Custom roles only replace the tenant-level permission set of ordinary
    # members. Built-in owners/admins and all Workspace authorization stay
    # governed by their existing independent role fields.
    if member.tenant_role == "member":
        assignment = db.scalar(select(TenantMemberRole).where(
            TenantMemberRole.tenant_id == tenant.tenant_id,
            TenantMemberRole.user_id == user.user_id,
        ))
        if assignment is not None:
            role = db.scalar(select(TenantRole).where(
                TenantRole.tenant_id == tenant.tenant_id,
                TenantRole.role_id == assignment.role_id,
                TenantRole.status == "active",
                TenantRole.del_flag.is_(False),
            ))
            if role is not None:
                try:
                    custom_permissions = json.loads(role.permissions_json or "[]")
                    if isinstance(custom_permissions, list) and all(isinstance(p, str) for p in custom_permissions):
                        permissions = frozenset(custom_permissions)
                except (TypeError, ValueError):
                    # A malformed persisted permission set grants nothing.
                    permissions = frozenset()
    return TenantContext(
        actor_user_id=user.user_id,
        tenant_id=tenant.tenant_id,
        tenant_role=member.tenant_role,
        permission_set=permissions,
        membership_version=tenant.membership_version,
    )


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

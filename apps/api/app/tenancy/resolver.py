"""Framework-neutral resolution of trusted tenant and Workspace contexts."""

from dataclasses import dataclass
import json
from typing import FrozenSet, NoReturn

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole


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


class ContextResolutionError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


_ROLE_PERMISSIONS = {
    "owner": frozenset({
        "resource:read", "resource:create", "resource:update", "resource:delete",
        "workspace:update", "workspace_member:manage", "workspace:transfer_ownership",
    }),
    "admin": frozenset({
        "resource:read", "resource:create", "resource:update", "resource:delete",
        "workspace:update", "workspace_member:manage",
    }),
    "member": frozenset({"resource:read", "resource:create", "resource:update"}),
    "viewer": frozenset({"resource:read"}),
}

_TENANT_ROLE_PERMISSIONS = {
    "owner": frozenset({"tenant:read", "tenant:update", "tenant:archive", "tenant_member:manage"}),
    "admin": frozenset({"tenant:read", "tenant:update", "tenant_member:manage"}),
    "member": frozenset({"tenant:read"}),
}


def _fail(code: str) -> NoReturn:
    raise ContextResolutionError(code)


def resolve_workspace_context(
    db: Session,
    actor_user_id: int,
    path_workspace_id: str | int | None,
    x_workspace_id: str | None,
) -> WorkspaceContext:
    if path_workspace_id is not None:
        try:
            workspace_id = int(path_workspace_id)
        except (ValueError, TypeError):
            _fail("RESOURCE_NOT_FOUND")
        if x_workspace_id is None:
            _fail("WORKSPACE_CONTEXT_REQUIRED")
        if not x_workspace_id.isdecimal() or int(x_workspace_id) != workspace_id:
            _fail("CONTEXT_MISMATCH")
    elif x_workspace_id is None:
        _fail("WORKSPACE_CONTEXT_REQUIRED")
    elif not x_workspace_id.isdecimal():
        _fail("CONTEXT_MISMATCH")
    else:
        workspace_id = int(x_workspace_id)
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        _fail("RESOURCE_NOT_FOUND")
    tenant = db.get(Tenant, workspace.tenant_id)
    if tenant is None:
        _fail("RESOURCE_NOT_FOUND")
    tenant_member = db.scalar(select(TenantMember).where(
        TenantMember.tenant_id == tenant.tenant_id,
        TenantMember.user_id == actor_user_id,
    ))
    if tenant_member is None or tenant_member.status != "active":
        _fail("MEMBERSHIP_INACTIVE")
    membership = db.scalar(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace.workspace_id,
        WorkspaceMember.tenant_id == tenant.tenant_id,
        WorkspaceMember.user_id == actor_user_id,
    ))
    if membership is None or membership.status != "active":
        _fail("WORKSPACE_MEMBERSHIP_REQUIRED")
    if tenant.status != "active":
        _fail("TENANT_INACTIVE")
    if workspace.status != "active":
        _fail("WORKSPACE_INACTIVE")
    return WorkspaceContext(
        actor_user_id=actor_user_id,
        tenant_id=tenant.tenant_id,
        workspace_id=workspace.workspace_id,
        tenant_role=tenant_member.tenant_role,
        workspace_role=membership.workspace_role,
        permission_set=_ROLE_PERMISSIONS.get(membership.workspace_role, frozenset()),
        membership_version=tenant.membership_version,
    )


def resolve_tenant_context(
    db: Session,
    actor_user_id: int,
    raw_tenant_id: str | int | None,
) -> TenantContext:
    try:
        tenant_id = int(raw_tenant_id)
    except (TypeError, ValueError):
        _fail("RESOURCE_NOT_FOUND")
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        _fail("RESOURCE_NOT_FOUND")
    member = db.scalar(select(TenantMember).where(
        TenantMember.tenant_id == tenant.tenant_id,
        TenantMember.user_id == actor_user_id,
    ))
    if member is None or member.status != "active":
        _fail("MEMBERSHIP_INACTIVE")
    if tenant.status != "active":
        _fail("TENANT_INACTIVE")

    permissions = _TENANT_ROLE_PERMISSIONS.get(member.tenant_role, frozenset())
    if member.tenant_role == "member":
        assignment = db.scalar(select(TenantMemberRole).where(
            TenantMemberRole.tenant_id == tenant.tenant_id,
            TenantMemberRole.user_id == actor_user_id,
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
                    if isinstance(custom_permissions, list) and all(
                        isinstance(permission, str) for permission in custom_permissions
                    ):
                        permissions = frozenset(custom_permissions)
                except (TypeError, ValueError):
                    permissions = frozenset()

    return TenantContext(
        actor_user_id=actor_user_id,
        tenant_id=tenant.tenant_id,
        tenant_role=member.tenant_role,
        permission_set=permissions,
        membership_version=tenant.membership_version,
    )

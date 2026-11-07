"""Focused tests for framework-neutral tenancy context resolution."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole
from app.models.user import User
from app.tenancy.resolver import (
    ContextResolutionError,
    resolve_tenant_context,
    resolve_workspace_context,
)


_TABLES = (
    User.__table__,
    Tenant.__table__,
    TenantMember.__table__,
    Workspace.__table__,
    WorkspaceMember.__table__,
    TenantRole.__table__,
    TenantMemberRole.__table__,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=list(_TABLES))
    try:
        with Session(engine) as session:
            yield session
    finally:
        Base.metadata.drop_all(engine, tables=list(_TABLES))
        engine.dispose()


def _create_scope(
    db: Session,
    *,
    tenant_status: str = "active",
    workspace_status: str = "active",
    tenant_member_status: str = "active",
    workspace_member_status: str = "active",
    tenant_role: str = "member",
    workspace_role: str = "member",
    platform_role: str = "user",
):
    actor = User(
        user_name="resolver-actor",
        password_hash="unused",
        status="active",
        platform_role=platform_role,
    )
    tenant = Tenant(
        slug="resolver-tenant",
        name="Resolver Tenant",
        status=tenant_status,
        membership_version=17,
    )
    db.add_all((actor, tenant))
    db.flush()

    workspace = Workspace(
        tenant_id=tenant.tenant_id,
        slug="resolver-workspace",
        name="Resolver Workspace",
        status=workspace_status,
        created_by=actor.user_id,
    )
    tenant_member = TenantMember(
        tenant_id=tenant.tenant_id,
        user_id=actor.user_id,
        status=tenant_member_status,
        tenant_role=tenant_role,
    )
    db.add_all((workspace, tenant_member))
    db.flush()

    workspace_member = WorkspaceMember(
        workspace_id=workspace.workspace_id,
        tenant_id=tenant.tenant_id,
        user_id=actor.user_id,
        status=workspace_member_status,
        workspace_role=workspace_role,
    )
    db.add(workspace_member)
    db.flush()
    return actor, tenant, workspace, tenant_member, workspace_member


def _assert_resolution_error(call, code: str) -> None:
    with pytest.raises(ContextResolutionError) as error:
        call()
    assert error.value.code == code


def test_resolves_workspace_and_tenant_context_from_active_memberships(db: Session) -> None:
    actor, tenant, workspace, _, _ = _create_scope(db)

    workspace_context = resolve_workspace_context(
        db,
        actor.user_id,
        str(workspace.workspace_id),
        str(workspace.workspace_id),
    )
    assert workspace_context.actor_user_id == actor.user_id
    assert workspace_context.tenant_id == tenant.tenant_id
    assert workspace_context.workspace_id == workspace.workspace_id
    assert workspace_context.tenant_role == "member"
    assert workspace_context.workspace_role == "member"
    assert workspace_context.permission_set == frozenset({
        "resource:read", "resource:create", "resource:update",
    })
    assert workspace_context.membership_version == 17

    tenant_context = resolve_tenant_context(db, actor.user_id, str(tenant.tenant_id))
    assert tenant_context.actor_user_id == actor.user_id
    assert tenant_context.tenant_id == tenant.tenant_id
    assert tenant_context.tenant_role == "member"
    assert tenant_context.permission_set == frozenset({"tenant:read"})
    assert tenant_context.membership_version == 17


def test_workspace_selector_preserves_required_mismatch_and_privacy_errors(db: Session) -> None:
    actor, _, workspace, _, _ = _create_scope(db)
    workspace_id = workspace.workspace_id

    invalid_selectors = (
        ("not-an-id", None, "RESOURCE_NOT_FOUND"),
        (str(workspace_id), None, "WORKSPACE_CONTEXT_REQUIRED"),
        (str(workspace_id), str(workspace_id + 1), "CONTEXT_MISMATCH"),
        (None, None, "WORKSPACE_CONTEXT_REQUIRED"),
        (None, "not-an-id", "CONTEXT_MISMATCH"),
        (None, str(workspace_id + 100), "RESOURCE_NOT_FOUND"),
    )
    for path_id, header_id, code in invalid_selectors:
        _assert_resolution_error(
            lambda: resolve_workspace_context(db, actor.user_id, path_id, header_id),
            code,
        )


@pytest.mark.parametrize(
    ("tenant_status", "workspace_status", "tenant_member_status", "workspace_member_status", "code"),
    (
        ("active", "active", "suspended", "active", "MEMBERSHIP_INACTIVE"),
        ("active", "active", "active", "removed", "WORKSPACE_MEMBERSHIP_REQUIRED"),
        ("suspended", "active", "active", "active", "TENANT_INACTIVE"),
        ("active", "archived", "active", "active", "WORKSPACE_INACTIVE"),
    ),
)
def test_workspace_resolution_fails_closed_on_inactive_scope(
    db: Session,
    tenant_status: str,
    workspace_status: str,
    tenant_member_status: str,
    workspace_member_status: str,
    code: str,
) -> None:
    actor, _, workspace, _, _ = _create_scope(
        db,
        tenant_status=tenant_status,
        workspace_status=workspace_status,
        tenant_member_status=tenant_member_status,
        workspace_member_status=workspace_member_status,
    )

    _assert_resolution_error(
        lambda: resolve_workspace_context(
            db,
            actor.user_id,
            None,
            str(workspace.workspace_id),
        ),
        code,
    )


def test_tenant_context_uses_active_custom_role_for_members_only(db: Session) -> None:
    actor, tenant, _, _, _ = _create_scope(db)
    role = TenantRole(
        tenant_id=tenant.tenant_id,
        role_name="Reporting",
        role_key="reporting",
        status="active",
        permissions_json='["tenant:read", "report:export"]',
        created_by=actor.user_id,
        updated_by=actor.user_id,
    )
    db.add(role)
    db.flush()
    db.add(TenantMemberRole(
        tenant_id=tenant.tenant_id,
        user_id=actor.user_id,
        role_id=role.role_id,
        assigned_by=actor.user_id,
    ))
    db.flush()

    context = resolve_tenant_context(db, actor.user_id, tenant.tenant_id)

    assert context.permission_set == frozenset({"tenant:read", "report:export"})


def test_tenant_context_rejects_inactive_membership_tenant_and_missing_tenant(db: Session) -> None:
    actor, tenant, _, tenant_member, _ = _create_scope(db)

    tenant_member.status = "suspended"
    _assert_resolution_error(
        lambda: resolve_tenant_context(db, actor.user_id, tenant.tenant_id),
        "MEMBERSHIP_INACTIVE",
    )

    tenant_member.status = "active"
    tenant.status = "suspended"
    _assert_resolution_error(
        lambda: resolve_tenant_context(db, actor.user_id, tenant.tenant_id),
        "TENANT_INACTIVE",
    )

    _assert_resolution_error(
        lambda: resolve_tenant_context(db, actor.user_id, "not-an-id"),
        "RESOURCE_NOT_FOUND",
    )

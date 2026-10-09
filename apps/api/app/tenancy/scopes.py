"""SQLAlchemy query and insert helpers bound to trusted tenancy contexts.

These helpers intentionally require contexts produced by the authorization
dependencies. They never accept tenant/workspace IDs from request data alone.
"""
from typing import Any, TypeVar

from sqlalchemy.sql import Select

from app.tenancy.context import TenantContext, WorkspaceContext

TSelect = TypeVar("TSelect", bound=Select[Any])


def _columns(model: type, *names: str) -> tuple[Any, ...]:
    values = []
    for name in names:
        value = getattr(model, name, None)
        if value is None:
            raise TypeError(
                f"{model.__name__} must define tenancy column {name!r} "
                "before it can be queried with this scope helper"
            )
        values.append(value)
    return tuple(values)


def workspace_scope(statement: TSelect, model: type, context: WorkspaceContext) -> TSelect:
    """Add both tenant and workspace ownership filters to a SQLAlchemy SELECT.

    Models must persist both `tenant_id` and `workspace_id`; filtering both
    protects against malformed/cross-tenant foreign-key combinations.
    """
    tenant_column, workspace_column = _columns(model, "tenant_id", "workspace_id")
    return statement.where(
        tenant_column == context.tenant_id,
        workspace_column == context.workspace_id,
    )


def tenant_scope(statement: TSelect, model: type, context: TenantContext) -> TSelect:
    """Add the verified tenant boundary to a tenant-owned SELECT."""
    (tenant_column,) = _columns(model, "tenant_id")
    return statement.where(tenant_column == context.tenant_id)


def personal_scope(statement: TSelect, model: type, context: WorkspaceContext) -> TSelect:
    """Scope a personal resource by actor and its captured tenant/workspace.

    Personal ownership is always required, even when the current actor is a
    workspace owner/admin. Sharing must use a separate explicit grant query.
    """
    owner_column, tenant_column, workspace_column = _columns(
        model, "owner_user_id", "tenant_id", "workspace_id"
    )
    return statement.where(
        owner_column == context.actor_user_id,
        tenant_column == context.tenant_id,
        workspace_column == context.workspace_id,
    )


def workspace_values(context: WorkspaceContext, **values: Any) -> dict[str, Any]:
    """Build trusted ownership fields for a new workspace-owned row.

    Callers may pass resource fields, but cannot override ownership columns.
    """
    reserved = {"tenant_id", "workspace_id", "created_by"}
    if reserved.intersection(values):
        names = ", ".join(sorted(reserved.intersection(values)))
        raise ValueError(f"Cannot override server-owned fields: {names}")
    return {
        **values,
        "tenant_id": context.tenant_id,
        "workspace_id": context.workspace_id,
        "created_by": context.actor_user_id,
    }


def personal_values(context: WorkspaceContext, **values: Any) -> dict[str, Any]:
    """Build trusted private-resource owner and scope fields for insertion."""
    reserved = {"owner_user_id", "tenant_id", "workspace_id", "created_by"}
    if reserved.intersection(values):
        names = ", ".join(sorted(reserved.intersection(values)))
        raise ValueError(f"Cannot override server-owned fields: {names}")
    return {
        **values,
        "owner_user_id": context.actor_user_id,
        "tenant_id": context.tenant_id,
        "workspace_id": context.workspace_id,
        "created_by": context.actor_user_id,
    }

"""Allowlisted tenant resource summary refresh handler."""
import json
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.attachment import Attachment
from app.models.tenant import Tenant, TenantMember, Workspace
from app.models.tenant_config import TenantConfig
from app.models.tenant_department import TenantDepartment
from app.models.tenant_dictionary import TenantDictData, TenantDictType
from app.models.tenant_menu import TenantMenu
from app.models.tenant_resource_summary import TenantResourceSummary
from app.models.tenant_role import TenantRole
from app.models.tenant_scheduled_task import TenantScheduledTask
from app.models.user import User

TASK_TARGET = "tenant.refresh_resource_summary"
SUMMARY_SCHEMA_VERSION = 1


def _count(db: Session, model, tenant_id: int, *conditions) -> int:
    value = db.scalar(
        select(func.count()).select_from(model).where(model.tenant_id == tenant_id, *conditions)
    )
    return int(value or 0)


def _counts_for_tenant(db: Session, tenant_id: int) -> dict[str, int]:
    active_user_members = db.scalar(
        select(func.count())
        .select_from(TenantMember)
        .join(User, User.user_id == TenantMember.user_id)
        .where(
            TenantMember.tenant_id == tenant_id,
            TenantMember.status == "active",
            User.status == "active",
            User.del_flag.is_(False),
        )
    )
    active_dictionary_values = db.scalar(
        select(func.count())
        .select_from(TenantDictData)
        .join(
            TenantDictType,
            (TenantDictType.dict_type_id == TenantDictData.dict_type_id)
            & (TenantDictType.tenant_id == TenantDictData.tenant_id),
        )
        .where(
            TenantDictData.tenant_id == tenant_id,
            TenantDictData.status == "0",
            TenantDictType.status == "0",
        )
    )
    return {
        "active_user_member_count": int(active_user_members or 0),
        "active_workspace_count": _count(db, Workspace, tenant_id, Workspace.status == "active"),
        "attachment_count": _count(db, Attachment, tenant_id),
        "active_dictionary_type_count": _count(db, TenantDictType, tenant_id, TenantDictType.status == "0"),
        "active_dictionary_value_count": int(active_dictionary_values or 0),
        "active_config_count": _count(db, TenantConfig, tenant_id, TenantConfig.status == "0"),
        "active_department_count": _count(db, TenantDepartment, tenant_id,
                                           TenantDepartment.status == "0", TenantDepartment.del_flag.is_(False)),
        "active_custom_role_count": _count(db, TenantRole, tenant_id,
                                            TenantRole.status == "active", TenantRole.del_flag.is_(False)),
        "active_menu_count": _count(db, TenantMenu, tenant_id,
                                     TenantMenu.status == "0", TenantMenu.visible == "0", TenantMenu.del_flag.is_(False)),
        "enabled_scheduled_task_count": _count(db, TenantScheduledTask, tenant_id,
                                               TenantScheduledTask.enabled.is_(True), TenantScheduledTask.del_flag.is_(False)),
    }


def refresh_resource_summary(
    db: Session,
    tenant_id: int,
    *,
    now: datetime | None = None,
) -> dict:
    """Recompute and atomically replace the summary row for one trusted tenant.

    `tenant_id` must come from trusted persisted task context, never directly
    from public request input. Every source query is explicitly tenant-filtered.
    Repeated or concurrent invocations replace the complete counts document via
    a database upsert, so readers never see a partially updated set of counts.
    """
    if type(tenant_id) is not int or tenant_id < 1:
        raise ValueError("tenant_id must be a positive integer")
    if db.scalar(select(Tenant.tenant_id).where(Tenant.tenant_id == tenant_id)) is None:
        raise LookupError("scheduled task tenant does not exist")

    refreshed_at = now or datetime.now(timezone.utc)
    if refreshed_at.tzinfo is None:
        refreshed_at = refreshed_at.replace(tzinfo=timezone.utc)
    else:
        refreshed_at = refreshed_at.astimezone(timezone.utc)
    counts = _counts_for_tenant(db, tenant_id)
    values = {
        "tenant_id": tenant_id,
        "counts_json": json.dumps(counts, sort_keys=True, separators=(",", ":")),
        "schema_version": SUMMARY_SCHEMA_VERSION,
        "refreshed_at": refreshed_at,
    }

    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        statement = sqlite_insert(TenantResourceSummary).values(**values).on_conflict_do_update(
            index_elements=[TenantResourceSummary.tenant_id],
            set_={key: value for key, value in values.items() if key != "tenant_id"},
        )
    elif dialect == "postgresql":
        statement = postgresql_insert(TenantResourceSummary).values(**values).on_conflict_do_update(
            index_elements=[TenantResourceSummary.tenant_id],
            set_={key: value for key, value in values.items() if key != "tenant_id"},
        )
    else:
        raise RuntimeError(f"Unsupported database dialect for tenant summary upsert: {dialect}")

    db.execute(statement)
    db.commit()
    return {
        "task_target": TASK_TARGET,
        "tenant_id": str(tenant_id),
        "schema_version": SUMMARY_SCHEMA_VERSION,
        "refreshed_at": refreshed_at.isoformat(),
        "counts": counts,
    }

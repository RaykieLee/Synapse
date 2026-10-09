"""Owner/admin management of tenant custom-role menu grants."""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant import Tenant
from app.models.tenant_menu import TenantMenu
from app.models.tenant_role import TenantRole
from app.models.tenant_role_menu import TenantRoleMenu
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/roles/{role_id}/menus", tags=["tenant role menus"])
_MENU_ID = re.compile(r"^[1-9][0-9]*$")


class ReplaceRoleMenus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_ids: list[str] = Field(max_length=500)

    @field_validator("menu_ids")
    @classmethod
    def menu_ids_are_positive_unique_ids(cls, values: list[str]) -> list[str]:
        if any(not _MENU_ID.fullmatch(value) for value in values):
            raise ValueError("Menu IDs must be positive decimal strings")
        if len(values) != len(set(values)):
            raise ValueError("Menu IDs must be unique")
        return values


def _fail(status_code: int, code: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code})


def _authorize(context: TenantContext) -> None:
    # Menu grants are security-sensitive and cannot be delegated through a
    # custom role's own tenant permission set.
    if context.tenant_role not in {"owner", "admin"}:
        _fail(403, "FORBIDDEN")


def _role_statement(role_id: int, context: TenantContext):
    return tenant_scope(
        select(TenantRole).where(
            TenantRole.role_id == role_id,
            TenantRole.status == "active",
            TenantRole.del_flag.is_(False),
        ),
        TenantRole,
        context,
    )


def _get_role(db: Session, role_id: int, context: TenantContext, *, lock: bool = False) -> TenantRole:
    statement = _role_statement(role_id, context)
    if lock:
        statement = statement.with_for_update()
    role = db.scalar(statement)
    if role is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return role


def _lock_role_for_replace(db: Session, role_id: int, context: TenantContext) -> TenantRole:
    # `FOR UPDATE` serializes writers on PostgreSQL. SQLite ignores it, so a
    # no-op UPDATE acquires its database write lock before reading the old set.
    lock_statement = tenant_scope(
        update(TenantRole).where(
            TenantRole.role_id == role_id,
            TenantRole.status == "active",
            TenantRole.del_flag.is_(False),
        ).values(updated_at=TenantRole.updated_at),
        TenantRole,
        context,
    )
    result = None
    for attempt in range(3):
        try:
            result = db.execute(lock_statement)
            break
        except OperationalError as exc:
            db.rollback()
            # SQLite's deferred read transaction can lose the race to upgrade
            # to a writer after get_tenant_context has read membership data.
            # Roll back that snapshot and retry the lock against the latest DB
            # state; other errors/backends are allowed to propagate.
            code = getattr(exc.orig, "sqlite_errorcode", None)
            sqlite_busy = db.get_bind().dialect.name == "sqlite" and (
                (code is not None and (code & 0xFF) in {5, 6})
                or "locked" in str(exc.orig).lower()
            )
            if not sqlite_busy or attempt == 2:
                raise
    assert result is not None
    if result.rowcount == 0:
        _fail(404, "RESOURCE_NOT_FOUND")
    return _get_role(db, role_id, context, lock=True)


def _assignment_statement(role_id: int, context: TenantContext):
    return tenant_scope(
        select(TenantRoleMenu).where(TenantRoleMenu.role_id == role_id),
        TenantRoleMenu,
        context,
    )


def _assigned_ids(db: Session, role_id: int, context: TenantContext) -> list[str]:
    statement = tenant_scope(
        select(TenantRoleMenu.menu_id).where(TenantRoleMenu.role_id == role_id),
        TenantRoleMenu,
        context,
    ).order_by(TenantRoleMenu.menu_id)
    return [str(menu_id) for menu_id in db.scalars(statement).all()]


def _validate_menus(db: Session, context: TenantContext, menu_ids: list[str]) -> list[TenantMenu]:
    if not menu_ids:
        return []
    numeric_ids = [int(value) for value in menu_ids]
    statement = tenant_scope(
        select(TenantMenu).where(
            TenantMenu.menu_id.in_(numeric_ids),
            TenantMenu.status == "0",
            TenantMenu.del_flag.is_(False),
        ).with_for_update(),
        TenantMenu,
        context,
    )
    menus = list(db.scalars(statement).all())
    if len(menus) != len(numeric_ids):
        # Same response for absent, foreign-tenant, disabled, and deleted IDs.
        _fail(404, "RESOURCE_NOT_FOUND")
    return menus


def _advance_membership_version(db: Session, tenant_id: int) -> None:
    db.execute(update(Tenant).where(Tenant.tenant_id == tenant_id).values(
        membership_version=Tenant.membership_version + 1,
    ))


@router.get("")
def get_role_menus(
    role_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    role = _get_role(db, role_id, context)
    # Return the persisted association IDs as-is. If a menu was later disabled
    # or soft-deleted, the owner can still see the stale link and replace it.
    return {
        "tenant_id": str(context.tenant_id),
        "role_id": str(role.role_id),
        "menu_ids": _assigned_ids(db, role.role_id, context),
    }


@router.put("")
def replace_role_menus(
    body: ReplaceRoleMenus,
    role_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    role = _lock_role_for_replace(db, role_id, context)
    requested_ids = sorted(body.menu_ids, key=int)
    _validate_menus(db, context, requested_ids)
    current_ids = _assigned_ids(db, role.role_id, context)
    if requested_ids == current_ids:
        return {"tenant_id": str(context.tenant_id), "role_id": str(role.role_id), "menu_ids": current_ids}

    db.execute(delete(TenantRoleMenu).where(
        TenantRoleMenu.tenant_id == context.tenant_id,
        TenantRoleMenu.role_id == role.role_id,
    ))
    now = datetime.now(timezone.utc)
    db.add_all([
        TenantRoleMenu(
            tenant_id=context.tenant_id,
            role_id=role.role_id,
            menu_id=int(menu_id),
            created_by=context.actor_user_id,
            created_at=now,
        )
        for menu_id in requested_ids
    ])
    _advance_membership_version(db, context.tenant_id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "ROLE_MENU_CONFLICT"}) from exc
    return {"tenant_id": str(context.tenant_id), "role_id": str(role.role_id), "menu_ids": requested_ids}

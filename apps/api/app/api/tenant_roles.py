"""Tenant-scoped CRUD for custom role definitions and permission grants."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant_role import TenantRole
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant import Tenant
from app.tenancy.context import TenantContext, require_tenant_permission
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/roles", tags=["tenant roles"])

ROLE_KEY_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"
RESERVED_ROLE_KEYS = {"owner", "admin", "member", "viewer", "platform_admin"}
# Keep custom tenant roles within the tenant-level permission vocabulary. The
# system and Workspace role names remain separate, even when spelled alike.
TENANT_PERMISSIONS = frozenset({
    "tenant:read",
    "tenant:update",
    "tenant:archive",
    "tenant_member:manage",
})


class RoleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role_name: str = Field(min_length=1, max_length=30)
    role_key: str = Field(min_length=1, max_length=64, pattern=ROLE_KEY_PATTERN)
    role_sort: int = Field(default=0, ge=0)
    status: str = Field(default="active", pattern="^(active|disabled)$")
    permissions: list[str] = Field(default_factory=list, max_length=64)
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("role_name")
    @classmethod
    def role_name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Role name cannot be blank")
        return value

    @field_validator("role_key")
    @classmethod
    def role_key_not_reserved(cls, value: str) -> str:
        if value in RESERVED_ROLE_KEYS:
            raise ValueError("Built-in role keys are reserved")
        return value

    @field_validator("permissions")
    @classmethod
    def permissions_are_supported(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Permission values must be unique")
        unsupported = set(value) - TENANT_PERMISSIONS
        if unsupported:
            raise ValueError("Unsupported tenant permission")
        return sorted(value)


class RolePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role_name: str | None = Field(default=None, min_length=1, max_length=30)
    role_key: str | None = Field(default=None, min_length=1, max_length=64, pattern=ROLE_KEY_PATTERN)
    role_sort: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")
    permissions: list[str] | None = Field(default=None, max_length=64)
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("role_name")
    @classmethod
    def role_name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Role name cannot be blank")
        return value

    @field_validator("role_key")
    @classmethod
    def role_key_not_reserved(cls, value: str | None) -> str | None:
        if value is not None and value in RESERVED_ROLE_KEYS:
            raise ValueError("Built-in role keys are reserved")
        return value

    @field_validator("permissions")
    @classmethod
    def permissions_are_supported(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        if len(value) != len(set(value)):
            raise ValueError("Permission values must be unique")
        if set(value) - TENANT_PERMISSIONS:
            raise ValueError("Unsupported tenant permission")
        return sorted(value)


def _fail(status_code: int, code: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _data(role: TenantRole) -> dict:
    return {
        "role_id": str(role.role_id),
        "tenant_id": str(role.tenant_id),
        "scope": "tenant",
        "role_name": role.role_name,
        "role_key": role.role_key,
        "role_sort": role.role_sort,
        "status": role.status,
        "permissions": json.loads(role.permissions_json or "[]"),
        "remark": role.remark,
        "created_by": str(role.created_by),
        "updated_by": str(role.updated_by),
        "created_at": _iso(role.created_at),
        "updated_at": _iso(role.updated_at),
    }


def _role_statement(role_id: int, context: TenantContext):
    return tenant_scope(
        select(TenantRole).where(
            TenantRole.role_id == role_id,
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


def _check_unique(db: Session, context: TenantContext, field: str, value: str, exclude_id: int | None = None) -> None:
    column = TenantRole.role_name if field == "role_name" else TenantRole.role_key
    statement = tenant_scope(
        select(TenantRole.role_id).where(
            column == value,
            TenantRole.del_flag.is_(False),
        ),
        TenantRole,
        context,
    )
    if exclude_id is not None:
        statement = statement.where(TenantRole.role_id != exclude_id)
    if db.scalar(statement) is not None:
        _fail(409, "ROLE_CONFLICT")


@router.get("")
def list_roles(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^(active|disabled)$"),
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    db: Session = Depends(get_db),
):
    statement = tenant_scope(
        select(TenantRole).where(TenantRole.del_flag.is_(False)), TenantRole, context,
    )
    if search and search.strip():
        term = f"%{search.strip()}%"
        statement = statement.where(TenantRole.role_name.ilike(term) | TenantRole.role_key.ilike(term))
    if status:
        statement = statement.where(TenantRole.status == status)
    count_statement = tenant_scope(
        select(func.count(TenantRole.role_id)).where(TenantRole.del_flag.is_(False)),
        TenantRole,
        context,
    )
    if search and search.strip():
        term = f"%{search.strip()}%"
        count_statement = count_statement.where(TenantRole.role_name.ilike(term) | TenantRole.role_key.ilike(term))
    if status:
        count_statement = count_statement.where(TenantRole.status == status)
    total = db.scalar(count_statement) or 0
    roles = db.scalars(statement.order_by(TenantRole.role_sort, TenantRole.role_id)
                       .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_data(role) for role in roles], "total": total,
            "page": page, "page_size": page_size}


@router.post("", status_code=201)
def create_role(
    body: RoleCreate,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    db: Session = Depends(get_db),
):
    _check_unique(db, context, "role_name", body.role_name)
    _check_unique(db, context, "role_key", body.role_key)
    now = _now()
    role = TenantRole(
        tenant_id=context.tenant_id,
        role_name=body.role_name,
        role_key=body.role_key,
        role_sort=body.role_sort,
        status=body.status,
        permissions_json=json.dumps(body.permissions, separators=(",", ":")),
        remark=body.remark,
        created_by=context.actor_user_id,
        updated_by=context.actor_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(role)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "ROLE_CONFLICT"}) from exc
    db.refresh(role)
    return _data(role)


@router.get("/{role_id}")
def get_role(
    role_id: int,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    db: Session = Depends(get_db),
):
    return _data(_get_role(db, role_id, context))


@router.patch("/{role_id}")
def patch_role(
    role_id: int,
    body: RolePatch,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    db: Session = Depends(get_db),
):
    role = _get_role(db, role_id, context, lock=True)
    values = body.model_dump(exclude_unset=True)
    if not values:
        _fail(422, "VALIDATION_ERROR")
    for field in ("role_name", "role_key", "role_sort", "status", "permissions"):
        if field in values and values[field] is None:
            _fail(422, "VALIDATION_ERROR")
    for field in ("role_name", "role_key"):
        if field in values and values[field] != getattr(role, field):
            _check_unique(db, context, field, values[field], exclude_id=role.role_id)
    if "permissions" in values:
        values["permissions_json"] = json.dumps(values.pop("permissions"), separators=(",", ":"))
    for field, value in values.items():
        setattr(role, field, value)
    role.updated_by = context.actor_user_id
    role.updated_at = _now()
    # Role permission/status changes alter effective member grants. Invalidate
    # tenant permission snapshots only when this role is currently assigned.
    if db.scalar(select(TenantMemberRole.assignment_id).where(
        TenantMemberRole.tenant_id == context.tenant_id,
        TenantMemberRole.role_id == role.role_id,
    ).limit(1)) is not None:
        db.execute(update(Tenant).where(Tenant.tenant_id == context.tenant_id).values(
            membership_version=Tenant.membership_version + 1,
        ))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "ROLE_CONFLICT"}) from exc
    db.refresh(role)
    return _data(role)


@router.delete("/{role_id}", status_code=204)
def delete_role(
    role_id: int,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    db: Session = Depends(get_db),
):
    role = _get_role(db, role_id, context, lock=True)
    role.del_flag = True
    role.updated_by = context.actor_user_id
    role.updated_at = _now()
    if db.scalar(select(TenantMemberRole.assignment_id).where(
        TenantMemberRole.tenant_id == context.tenant_id,
        TenantMemberRole.role_id == role.role_id,
    ).limit(1)) is not None:
        db.execute(update(Tenant).where(Tenant.tenant_id == context.tenant_id).values(
            membership_version=Tenant.membership_version + 1,
        ))
    db.commit()
    return Response(status_code=204)

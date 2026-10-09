"""Tenant-scoped parameter configuration with explicit sensitive-value handling."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant_config import TenantConfig
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/configs", tags=["tenant configs"])
CONFIG_KEY_PATTERN = r"^[A-Za-z][A-Za-z0-9_.-]{0,99}$"


class ConfigCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config_name: str = Field(min_length=1, max_length=100)
    config_key: str = Field(min_length=1, max_length=100, pattern=CONFIG_KEY_PATTERN)
    config_value: str = Field(max_length=10000)
    group_name: str = Field(default="", max_length=100)
    is_frontend: bool = False
    is_sensitive: bool = False
    status: str = Field(default="0", pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("config_name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Configuration name cannot be blank")
        return value


class ConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config_name: str | None = Field(default=None, min_length=1, max_length=100)
    config_key: str | None = Field(default=None, min_length=1, max_length=100, pattern=CONFIG_KEY_PATTERN)
    config_value: str | None = Field(default=None, max_length=10000)
    group_name: str | None = Field(default=None, max_length=100)
    is_frontend: bool | None = None
    is_sensitive: bool | None = None
    status: str | None = Field(default=None, pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("config_name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Configuration name cannot be blank")
        return value


def _fail(status_code: int, code: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code})


def _authorize(context: TenantContext) -> None:
    if context.tenant_role not in {"owner", "admin"}:
        _fail(403, "FORBIDDEN")


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


def _statement(context: TenantContext, config_id: int | None = None):
    statement = tenant_scope(select(TenantConfig), TenantConfig, context)
    if config_id is not None:
        statement = statement.where(TenantConfig.config_id == config_id)
    return statement


def _get_config(db: Session, context: TenantContext, config_id: int, *, lock: bool = False) -> TenantConfig:
    statement = _statement(context, config_id)
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return row


def _check_unique_key(db: Session, context: TenantContext, config_key: str, exclude_id: int | None = None) -> None:
    statement = tenant_scope(
        select(TenantConfig.config_id).where(TenantConfig.config_key == config_key),
        TenantConfig,
        context,
    )
    if exclude_id is not None:
        statement = statement.where(TenantConfig.config_id != exclude_id)
    if db.scalar(statement) is not None:
        _fail(409, "CONFIG_KEY_CONFLICT")


def _data(row: TenantConfig, *, reveal_sensitive: bool = False) -> dict:
    redact = row.is_sensitive and not reveal_sensitive
    return {
        "config_id": str(row.config_id),
        "tenant_id": str(row.tenant_id),
        "config_name": row.config_name,
        "config_key": row.config_key,
        "config_value": None if redact else row.config_value,
        "value_redacted": redact,
        "group_name": row.group_name,
        "is_frontend": row.is_frontend,
        "is_sensitive": row.is_sensitive,
        "status": row.status,
        "remark": row.remark,
        "created_by": str(row.created_by),
        "updated_by": str(row.updated_by),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "CONFIG_KEY_CONFLICT"}) from exc


@router.get("/public")
def list_public_configs(
    response: Response,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    """Return only enabled, frontend-enabled, explicitly non-sensitive values."""
    response.headers["Cache-Control"] = "private, no-store"
    rows = db.scalars(tenant_scope(
        select(TenantConfig).where(
            TenantConfig.is_frontend.is_(True),
            TenantConfig.is_sensitive.is_(False),
            TenantConfig.status == "0",
        ),
        TenantConfig,
        context,
    ).order_by(TenantConfig.group_name, TenantConfig.config_key)).all()
    return {
        "tenant_id": str(context.tenant_id),
        "items": [{"key": row.config_key, "value": row.config_value, "group": row.group_name} for row in rows],
    }


@router.get("")
def list_configs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    config_name: str | None = Query(default=None, max_length=100),
    config_key: str | None = Query(default=None, max_length=100),
    group_name: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    is_sensitive: bool | None = Query(default=None),
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    statement = _statement(context)
    count_statement = tenant_scope(select(func.count(TenantConfig.config_id)), TenantConfig, context)
    for column, raw in ((TenantConfig.config_name, config_name), (TenantConfig.config_key, config_key), (TenantConfig.group_name, group_name)):
        if raw and raw.strip():
            condition = column.ilike(f"%{raw.strip()}%")
            statement = statement.where(condition)
            count_statement = count_statement.where(condition)
    if status is not None:
        statement = statement.where(TenantConfig.status == status)
        count_statement = count_statement.where(TenantConfig.status == status)
    if is_sensitive is not None:
        statement = statement.where(TenantConfig.is_sensitive.is_(is_sensitive))
        count_statement = count_statement.where(TenantConfig.is_sensitive.is_(is_sensitive))
    total = db.scalar(count_statement) or 0
    rows = db.scalars(statement.order_by(TenantConfig.created_at.desc(), TenantConfig.config_id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_data(row) for row in rows], "total": total, "page": page, "page_size": page_size}


@router.post("", status_code=201)
def create_config(
    body: ConfigCreate,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    if body.is_sensitive and body.is_frontend:
        _fail(422, "SENSITIVE_CONFIG_CANNOT_BE_FRONTEND")
    _check_unique_key(db, context, body.config_key)
    now = _now()
    row = TenantConfig(
        tenant_id=context.tenant_id,
        **body.model_dump(),
        created_by=context.actor_user_id,
        updated_by=context.actor_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    _commit(db)
    db.refresh(row)
    return _data(row)


@router.get("/{config_id}")
def get_config(
    config_id: int,
    response: Response,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    row = _get_config(db, context, config_id)
    response.headers["Cache-Control"] = "private, no-store"
    return _data(row, reveal_sensitive=True)


@router.patch("/{config_id}")
def patch_config(
    config_id: int,
    body: ConfigPatch,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    row = _get_config(db, context, config_id, lock=True)
    values = body.model_dump(exclude_unset=True)
    if not values:
        _fail(422, "VALIDATION_ERROR")
    if any(value is None and field not in {"remark"} for field, value in values.items()):
        _fail(422, "VALIDATION_ERROR")
    if "config_key" in values and values["config_key"] != row.config_key:
        _check_unique_key(db, context, values["config_key"], exclude_id=row.config_id)
    is_sensitive = values.get("is_sensitive", row.is_sensitive)
    is_frontend = values.get("is_frontend", row.is_frontend)
    if is_sensitive and is_frontend:
        _fail(422, "SENSITIVE_CONFIG_CANNOT_BE_FRONTEND")
    for field, value in values.items():
        setattr(row, field, value)
    row.updated_by = context.actor_user_id
    row.updated_at = _now()
    _commit(db)
    db.refresh(row)
    # Mutation responses never echo a secret, even for an authorized manager.
    return _data(row)


@router.delete("/{config_id}", status_code=204)
def delete_config(
    config_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    row = _get_config(db, context, config_id, lock=True)
    db.delete(row)
    _commit(db)
    return Response(status_code=204)

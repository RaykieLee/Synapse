"""Tenant-scoped dictionary type and value management."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant_dictionary import TenantDictData, TenantDictType
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/dict", tags=["tenant dictionaries"])
DICT_TYPE_PATTERN = r"^[A-Za-z][A-Za-z0-9_.-]{0,99}$"


class DictTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dict_name: str = Field(min_length=1, max_length=100)
    dict_type: str = Field(min_length=1, max_length=100, pattern=DICT_TYPE_PATTERN)
    order_num: int = Field(default=0, ge=0)
    status: str = Field(default="0", pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Dictionary name cannot be blank")
        return value


class DictTypePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dict_name: str | None = Field(default=None, min_length=1, max_length=100)
    dict_type: str | None = Field(default=None, min_length=1, max_length=100, pattern=DICT_TYPE_PATTERN)
    order_num: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Dictionary name cannot be blank")
        return value


class DictDataCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dict_sort: int = Field(default=0, ge=0)
    dict_label: str = Field(min_length=1, max_length=100)
    dict_value: str = Field(min_length=1, max_length=100)
    css_class: str | None = Field(default=None, max_length=100)
    list_class: str | None = Field(default=None, max_length=100)
    is_default: str = Field(default="N", pattern="^[YN]$")
    status: str = Field(default="0", pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_label", "dict_value")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Dictionary label and value cannot be blank")
        return value


class DictDataPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dict_sort: int | None = Field(default=None, ge=0)
    dict_label: str | None = Field(default=None, min_length=1, max_length=100)
    dict_value: str | None = Field(default=None, min_length=1, max_length=100)
    css_class: str | None = Field(default=None, max_length=100)
    list_class: str | None = Field(default=None, max_length=100)
    is_default: str | None = Field(default=None, pattern="^[YN]$")
    status: str | None = Field(default=None, pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_label", "dict_value")
    @classmethod
    def non_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Dictionary label and value cannot be blank")
        return value


class DictOrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dict_data_id: str = Field(pattern=r"^[1-9][0-9]*$")
    dict_sort: int = Field(ge=0)


class DictReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[DictOrderItem] = Field(min_length=1, max_length=1000)


class DictTypeOrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dict_type_id: str = Field(pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(ge=0)


class DictTypeReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[DictTypeOrderItem] = Field(min_length=1, max_length=1000)


def _fail(status: int, code: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code})


def require_dict_manager(context: TenantContext = Depends(get_tenant_context)) -> TenantContext:
    # The contract grants dictionary administration only to built-in tenant
    # owners/admins; custom member roles cannot widen this management surface.
    if context.tenant_role not in {"owner", "admin"}:
        _fail(403, "FORBIDDEN")
    return context


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)).isoformat()


def _type_statement(context: TenantContext, dict_type_id: int | None = None):
    statement = tenant_scope(select(TenantDictType), TenantDictType, context)
    if dict_type_id is not None:
        statement = statement.where(TenantDictType.dict_type_id == dict_type_id)
    return statement


def _data_statement(context: TenantContext, dict_type_id: int, dict_data_id: int | None = None):
    statement = tenant_scope(
        select(TenantDictData).where(TenantDictData.dict_type_id == dict_type_id),
        TenantDictData,
        context,
    )
    if dict_data_id is not None:
        statement = statement.where(TenantDictData.dict_data_id == dict_data_id)
    return statement


def _get_type(db: Session, context: TenantContext, dict_type_id: int) -> TenantDictType:
    row = db.scalar(_type_statement(context, dict_type_id))
    if row is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return row


def _get_data(db: Session, context: TenantContext, dict_type_id: int, dict_data_id: int) -> TenantDictData:
    row = db.scalar(_data_statement(context, dict_type_id, dict_data_id))
    if row is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return row


def _type_data(row: TenantDictType) -> dict:
    return {
        "dict_type_id": str(row.dict_type_id), "tenant_id": str(row.tenant_id),
        "dict_name": row.dict_name, "dict_type": row.dict_type, "order_num": row.order_num,
        "status": row.status, "remark": row.remark, "created_by": str(row.created_by),
        "updated_by": str(row.updated_by), "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _entry_data(row: TenantDictData, dict_type: str) -> dict:
    return {
        "dict_data_id": str(row.dict_data_id), "tenant_id": str(row.tenant_id),
        "dict_type_id": str(row.dict_type_id), "dict_type": dict_type,
        "dict_sort": row.dict_sort, "dict_label": row.dict_label, "dict_value": row.dict_value,
        "css_class": row.css_class, "list_class": row.list_class, "is_default": row.is_default,
        "status": row.status, "remark": row.remark, "created_by": str(row.created_by),
        "updated_by": str(row.updated_by), "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _commit(db: Session, conflict_code: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": conflict_code}) from exc


@router.get("/types")
def list_dict_types(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    dict_name: str | None = Query(default=None, max_length=100),
    dict_type: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    statement = _type_statement(context)
    count_statement = tenant_scope(select(func.count(TenantDictType.dict_type_id)), TenantDictType, context)
    for column, raw in ((TenantDictType.dict_name, dict_name), (TenantDictType.dict_type, dict_type)):
        if raw and raw.strip():
            filter_ = column.ilike(f"%{raw.strip()}%")
            statement = statement.where(filter_)
            count_statement = count_statement.where(filter_)
    if status is not None:
        statement = statement.where(TenantDictType.status == status)
        count_statement = count_statement.where(TenantDictType.status == status)
    total = db.scalar(count_statement) or 0
    rows = db.scalars(statement.order_by(TenantDictType.order_num, TenantDictType.dict_type_id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_type_data(row) for row in rows], "total": total, "page": page, "page_size": page_size}


@router.post("/types/reorder")
def reorder_dict_types(
    body: DictTypeReorder,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    ids = [int(item.dict_type_id) for item in body.items]
    if len(ids) != len(set(ids)):
        _fail(422, "DUPLICATE_DICT_TYPE_ID")
    rows = list(db.scalars(_type_statement(context).with_for_update()).all())
    if set(ids) != {row.dict_type_id for row in rows}:
        _fail(409, "DICT_TYPE_REORDER_SET_MISMATCH")
    by_id = {row.dict_type_id: row for row in rows}
    for item in body.items:
        row = by_id[int(item.dict_type_id)]
        row.order_num = item.order_num
        row.updated_by = context.actor_user_id
        row.updated_at = _now()
    _commit(db, "DICT_TYPE_CONFLICT")
    return {"updated": len(rows)}


@router.post("/types", status_code=201)
def create_dict_type(
    body: DictTypeCreate,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    now = _now()
    row = TenantDictType(tenant_id=context.tenant_id, **body.model_dump(), created_by=context.actor_user_id,
                         updated_by=context.actor_user_id, created_at=now, updated_at=now)
    db.add(row)
    _commit(db, "DICT_TYPE_CONFLICT")
    db.refresh(row)
    return _type_data(row)


@router.get("/types/{dict_type_id}")
def get_dict_type(
    dict_type_id: int,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    return _type_data(_get_type(db, context, dict_type_id))


@router.patch("/types/{dict_type_id}")
def patch_dict_type(
    dict_type_id: int,
    body: DictTypePatch,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    row = _get_type(db, context, dict_type_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(row, name, value)
    row.updated_by = context.actor_user_id
    row.updated_at = _now()
    _commit(db, "DICT_TYPE_CONFLICT")
    db.refresh(row)
    return _type_data(row)


@router.delete("/types/{dict_type_id}", status_code=204)
def delete_dict_type(
    dict_type_id: int,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    row = _get_type(db, context, dict_type_id)
    has_values = db.scalar(_data_statement(context, dict_type_id).limit(1)) is not None
    if has_values:
        _fail(409, "DICT_TYPE_HAS_DATA")
    db.delete(row)
    _commit(db, "DICT_TYPE_CONFLICT")


@router.get("/types/{dict_type_id}/data")
def list_dict_data(
    dict_type_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    dict_label: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    type_row = _get_type(db, context, dict_type_id)
    statement = _data_statement(context, dict_type_id)
    count_statement = tenant_scope(
        select(func.count(TenantDictData.dict_data_id)).where(TenantDictData.dict_type_id == dict_type_id),
        TenantDictData, context,
    )
    if dict_label and dict_label.strip():
        filter_ = TenantDictData.dict_label.ilike(f"%{dict_label.strip()}%")
        statement = statement.where(filter_)
        count_statement = count_statement.where(filter_)
    if status is not None:
        statement = statement.where(TenantDictData.status == status)
        count_statement = count_statement.where(TenantDictData.status == status)
    total = db.scalar(count_statement) or 0
    rows = db.scalars(statement.order_by(TenantDictData.dict_sort, TenantDictData.dict_data_id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_entry_data(row, type_row.dict_type) for row in rows], "total": total,
            "page": page, "page_size": page_size}


@router.post("/types/{dict_type_id}/data", status_code=201)
def create_dict_data(
    dict_type_id: int,
    body: DictDataCreate,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    type_row = _get_type(db, context, dict_type_id)
    now = _now()
    row = TenantDictData(tenant_id=context.tenant_id, dict_type_id=type_row.dict_type_id,
                         **body.model_dump(), created_by=context.actor_user_id,
                         updated_by=context.actor_user_id, created_at=now, updated_at=now)
    db.add(row)
    _commit(db, "DICT_VALUE_CONFLICT")
    db.refresh(row)
    return _entry_data(row, type_row.dict_type)


@router.post("/types/{dict_type_id}/data/reorder")
def reorder_dict_data(
    dict_type_id: int,
    body: DictReorder,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    _get_type(db, context, dict_type_id)
    ids = [int(item.dict_data_id) for item in body.items]
    if len(ids) != len(set(ids)):
        _fail(422, "DUPLICATE_DICT_DATA_ID")
    rows = list(db.scalars(_data_statement(context, dict_type_id).with_for_update()).all())
    if set(ids) != {row.dict_data_id for row in rows}:
        _fail(409, "DICT_REORDER_SET_MISMATCH")
    by_id = {row.dict_data_id: row for row in rows}
    for item in body.items:
        row = by_id[int(item.dict_data_id)]
        row.dict_sort = item.dict_sort
        row.updated_by = context.actor_user_id
        row.updated_at = _now()
    _commit(db, "DICT_VALUE_CONFLICT")
    return {"updated": len(rows)}


@router.get("/types/{dict_type_id}/data/{dict_data_id}")
def get_dict_data(
    dict_type_id: int,
    dict_data_id: int,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    type_row = _get_type(db, context, dict_type_id)
    return _entry_data(_get_data(db, context, dict_type_id, dict_data_id), type_row.dict_type)


@router.patch("/types/{dict_type_id}/data/{dict_data_id}")
def patch_dict_data(
    dict_type_id: int,
    dict_data_id: int,
    body: DictDataPatch,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    type_row = _get_type(db, context, dict_type_id)
    row = _get_data(db, context, dict_type_id, dict_data_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(row, name, value)
    row.updated_by = context.actor_user_id
    row.updated_at = _now()
    _commit(db, "DICT_VALUE_CONFLICT")
    db.refresh(row)
    return _entry_data(row, type_row.dict_type)


@router.delete("/types/{dict_type_id}/data/{dict_data_id}", status_code=204)
def delete_dict_data(
    dict_type_id: int,
    dict_data_id: int,
    context: TenantContext = Depends(require_dict_manager),
    db: Session = Depends(get_db),
):
    row = _get_data(db, context, dict_type_id, dict_data_id)
    db.delete(row)
    _commit(db, "DICT_VALUE_CONFLICT")

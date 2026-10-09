"""Tenant-scoped department hierarchy management."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant_department import TenantDepartment
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/departments", tags=["tenant departments"])


class DepartmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dept_name: str = Field(min_length=1, max_length=30)
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(default=0, ge=0)
    leader: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=11)
    email: str | None = Field(default=None, max_length=50)
    status: str = Field(default="0", pattern="^[01]$")

    @field_validator("dept_name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Department name cannot be blank")
        return value


class DepartmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dept_name: str | None = Field(default=None, min_length=1, max_length=30)
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int | None = Field(default=None, ge=0)
    leader: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=11)
    email: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, pattern="^[01]$")

    @field_validator("dept_name")
    @classmethod
    def non_blank_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Department name cannot be blank")
        return value


class DepartmentOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    department_id: str = Field(pattern=r"^[1-9][0-9]*$")
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(ge=0)


class DepartmentReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[DepartmentOrder] = Field(min_length=1, max_length=500)


def _fail(status: int, code: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code})


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


def _department_statement(context: TenantContext, department_id: int | None = None):
    statement = select(TenantDepartment).where(TenantDepartment.del_flag.is_(False))
    if department_id is not None:
        statement = statement.where(TenantDepartment.department_id == department_id)
    return tenant_scope(statement, TenantDepartment, context)


def _get_department(db: Session, context: TenantContext, department_id: int, *, lock: bool = False) -> TenantDepartment:
    statement = _department_statement(context, department_id)
    if lock:
        statement = statement.with_for_update()
    department = db.scalar(statement)
    if department is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return department


def _parent(db: Session, context: TenantContext, parent_id: str | None) -> int | None:
    if parent_id is None:
        return None
    parent = _get_department(db, context, int(parent_id))
    if parent.status != "0":
        _fail(409, "DEPARTMENT_PARENT_INACTIVE")
    return parent.department_id


def _data(department: TenantDepartment, children: list[dict] | None = None) -> dict:
    return {
        "department_id": str(department.department_id),
        "tenant_id": str(department.tenant_id),
        "parent_id": None if department.parent_id is None else str(department.parent_id),
        "ancestors": department.ancestors,
        "dept_name": department.dept_name,
        "order_num": department.order_num,
        "leader": department.leader,
        "phone": department.phone,
        "email": department.email,
        "status": department.status,
        "created_by": str(department.created_by),
        "updated_by": str(department.updated_by),
        "created_at": _iso(department.created_at),
        "updated_at": _iso(department.updated_at),
        **({"children": children or []} if children is not None else {}),
    }


def _check_acyclic(parents: dict[int, int | None]) -> None:
    for node_id in parents:
        seen: set[int] = set()
        current: int | None = node_id
        while current is not None:
            if current in seen:
                _fail(409, "DEPARTMENT_CYCLE")
            seen.add(current)
            current = parents.get(current)


def _active_departments(db: Session, context: TenantContext, *, lock: bool = False) -> list[TenantDepartment]:
    statement = tenant_scope(
        select(TenantDepartment).where(TenantDepartment.del_flag.is_(False)),
        TenantDepartment,
        context,
    ).order_by(TenantDepartment.parent_id, TenantDepartment.order_num, TenantDepartment.department_id)
    if lock:
        statement = statement.with_for_update()
    return list(db.scalars(statement).all())


def _refresh_ancestors(departments: list[TenantDepartment]) -> None:
    by_id = {department.department_id: department for department in departments}
    cache: dict[int, str] = {}

    def resolve(department_id: int) -> str:
        if department_id in cache:
            return cache[department_id]
        department = by_id[department_id]
        if department.parent_id is None:
            value = "0"
        else:
            parent_path = resolve(department.parent_id)
            value = f"{parent_path},{department.parent_id}" if parent_path != "0" else f"0,{department.parent_id}"
        cache[department_id] = value
        return value

    for department in departments:
        department.ancestors = resolve(department.department_id)


def _check_name(db: Session, context: TenantContext, dept_name: str, exclude_id: int | None = None) -> None:
    statement = tenant_scope(
        select(TenantDepartment.department_id).where(
            TenantDepartment.dept_name == dept_name,
            TenantDepartment.del_flag.is_(False),
        ),
        TenantDepartment,
        context,
    )
    if exclude_id is not None:
        statement = statement.where(TenantDepartment.department_id != exclude_id)
    if db.scalar(statement) is not None:
        _fail(409, "DEPARTMENT_NAME_CONFLICT")


def _build_tree(departments: list[TenantDepartment]) -> list[dict]:
    by_id = {department.department_id: _data(department, []) for department in departments}
    roots: list[dict] = []
    for department in departments:
        node = by_id[department.department_id]
        if department.parent_id is None:
            roots.append(node)
        elif department.parent_id in by_id:
            by_id[department.parent_id]["children"].append(node)
    return roots


@router.get("")
def list_departments(
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    statement = _department_statement(context)
    if search and search.strip():
        statement = statement.where(TenantDepartment.dept_name.ilike(f"%{search.strip()}%"))
    if status is not None:
        statement = statement.where(TenantDepartment.status == status)
    rows = db.scalars(statement.order_by(TenantDepartment.parent_id, TenantDepartment.order_num, TenantDepartment.department_id)).all()
    return {"items": [_data(department) for department in rows], "total": len(rows)}


@router.get("/tree")
def get_department_tree(
    include_disabled: bool = Query(default=True),
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    departments = _active_departments(db, context)
    _check_acyclic({department.department_id: department.parent_id for department in departments})
    if not include_disabled:
        departments = [department for department in departments if department.status == "0"]
    return {"items": _build_tree(departments)}


@router.get("/{department_id}")
def get_department(
    department_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    return _data(_get_department(db, context, department_id))


@router.post("", status_code=201)
def create_department(
    body: DepartmentCreate,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    parent_id = _parent(db, context, body.parent_id)
    _check_name(db, context, body.dept_name)
    parent = _get_department(db, context, parent_id) if parent_id is not None else None
    ancestors = "0" if parent is None else f"{parent.ancestors},{parent.department_id}" if parent.ancestors != "0" else f"0,{parent.department_id}"
    now = _now()
    department = TenantDepartment(
        tenant_id=context.tenant_id,
        parent_id=parent_id,
        ancestors=ancestors,
        dept_name=body.dept_name,
        order_num=body.order_num,
        leader=body.leader,
        phone=body.phone,
        email=body.email,
        status=body.status,
        created_by=context.actor_user_id,
        updated_by=context.actor_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(department)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "DEPARTMENT_CONFLICT"}) from exc
    db.refresh(department)
    return _data(department)


@router.patch("/{department_id}")
def patch_department(
    department_id: int,
    body: DepartmentPatch,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    department = _get_department(db, context, department_id, lock=True)
    values = body.model_dump(exclude_unset=True)
    if not values:
        _fail(422, "VALIDATION_ERROR")
    if any(value is None and field not in {"parent_id", "leader", "phone", "email"} for field, value in values.items()):
        _fail(422, "VALIDATION_ERROR")
    if "dept_name" in values and values["dept_name"] != department.dept_name:
        _check_name(db, context, values["dept_name"], exclude_id=department_id)
    if "parent_id" in values:
        values["parent_id"] = _parent(db, context, values["parent_id"])
    active = _active_departments(db, context, lock=True)
    parents = {row.department_id: row.parent_id for row in active}
    parents[department_id] = values.get("parent_id", department.parent_id)
    _check_acyclic(parents)
    for field, value in values.items():
        setattr(department, field, value)
    department.updated_by = context.actor_user_id
    department.updated_at = _now()
    _refresh_ancestors(active)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "DEPARTMENT_CONFLICT"}) from exc
    db.refresh(department)
    return _data(department)


@router.post("/reorder")
def reorder_departments(
    body: DepartmentReorder,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    requested_ids = [int(item.department_id) for item in body.items]
    if len(requested_ids) != len(set(requested_ids)):
        _fail(422, "VALIDATION_ERROR")
    departments = _active_departments(db, context, lock=True)
    by_id = {department.department_id: department for department in departments}
    if any(department_id not in by_id for department_id in requested_ids):
        _fail(404, "RESOURCE_NOT_FOUND")
    parent_updates = {int(item.department_id): _parent(db, context, item.parent_id) for item in body.items}
    parents = {department.department_id: department.parent_id for department in departments}
    parents.update(parent_updates)
    _check_acyclic(parents)
    for item in body.items:
        department = by_id[int(item.department_id)]
        department.parent_id = parent_updates[department.department_id]
        department.order_num = item.order_num
        department.updated_by = context.actor_user_id
        department.updated_at = _now()
    _refresh_ancestors(departments)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "DEPARTMENT_CONFLICT"}) from exc
    return {"updated": len(body.items)}


@router.delete("/{department_id}", status_code=204)
def delete_department(
    department_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    department = _get_department(db, context, department_id, lock=True)
    child_id = db.scalar(tenant_scope(
        select(TenantDepartment.department_id).where(
            TenantDepartment.parent_id == department_id,
            TenantDepartment.del_flag.is_(False),
        ).limit(1),
        TenantDepartment,
        context,
    ))
    if child_id is not None:
        _fail(409, "DEPARTMENT_HAS_CHILDREN")
    department.del_flag = True
    department.updated_by = context.actor_user_id
    department.updated_at = _now()
    db.commit()
    return Response(status_code=204)

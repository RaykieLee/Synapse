"""Application service for tenant-owned department hierarchies."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant_department import TenantDepartment
from app.schemas.tenant_departments import (
    DepartmentCreate,
    DepartmentPatch,
    DepartmentReorder,
)
from app.services.errors import (
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class DepartmentConflict(ConflictError):
    code = "DEPARTMENT_CONFLICT"


class DepartmentNameConflict(ConflictError):
    code = "DEPARTMENT_NAME_CONFLICT"


class DepartmentParentInactive(ConflictError):
    code = "DEPARTMENT_PARENT_INACTIVE"


class DepartmentCycle(ConflictError):
    code = "DEPARTMENT_CYCLE"


class DepartmentHasChildren(ConflictError):
    code = "DEPARTMENT_HAS_CHILDREN"


class EmptyDepartmentPatch(DomainValidationError):
    code = "VALIDATION_ERROR"


class DuplicateDepartmentOrder(DomainValidationError):
    code = "VALIDATION_ERROR"


@dataclass(frozen=True)
class DepartmentResult:
    department_id: str
    tenant_id: str
    parent_id: str | None
    ancestors: str
    dept_name: str
    order_num: int
    leader: str | None
    phone: str | None
    email: str | None
    status: str
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None
    children: tuple[DepartmentResult, ...] = ()


@dataclass(frozen=True)
class DepartmentListResult:
    items: tuple[DepartmentResult, ...]
    total: int


@dataclass(frozen=True)
class DepartmentTreeResult:
    items: tuple[DepartmentResult, ...]


@dataclass(frozen=True)
class DepartmentReorderResult:
    updated: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


class TenantDepartmentService:
    """Business use cases for tenant department hierarchy management."""

    def __init__(self, db: Session):
        self.db = db

    def list_departments(
        self,
        context: TenantContext,
        *,
        search: str | None,
        status: str | None,
    ) -> DepartmentListResult:
        self._authorize(context)
        statement = self._department_statement(context)
        if search and search.strip():
            statement = statement.where(
                TenantDepartment.dept_name.ilike(f"%{search.strip()}%")
            )
        if status is not None:
            statement = statement.where(TenantDepartment.status == status)
        departments = self.db.scalars(
            statement.order_by(
                TenantDepartment.parent_id,
                TenantDepartment.order_num,
                TenantDepartment.department_id,
            )
        ).all()
        return DepartmentListResult(
            items=tuple(self._result(department) for department in departments),
            total=len(departments),
        )

    def get_department_tree(
        self,
        context: TenantContext,
        *,
        include_disabled: bool,
    ) -> DepartmentTreeResult:
        self._authorize(context)
        departments = self._all_departments(context)
        self._check_acyclic(
            {department.department_id: department.parent_id for department in departments}
        )
        if not include_disabled:
            departments = [
                department
                for department in departments
                if department.status == "0"
            ]
        return DepartmentTreeResult(items=tuple(self._build_tree(departments)))

    def get_department(
        self,
        department_id: int,
        context: TenantContext,
    ) -> DepartmentResult:
        self._authorize(context)
        return self._result(self._get_department(department_id, context))

    def create_department(
        self,
        body: DepartmentCreate,
        context: TenantContext,
    ) -> DepartmentResult:
        self._authorize(context)
        parent_id = self._parent(context, body.parent_id)
        self._check_name(context, body.dept_name)
        parent = (
            self._get_department(parent_id, context)
            if parent_id is not None
            else None
        )
        ancestors = (
            "0"
            if parent is None
            else (
                f"{parent.ancestors},{parent.department_id}"
                if parent.ancestors != "0"
                else f"0,{parent.department_id}"
            )
        )
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
        self.db.add(department)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise DepartmentConflict("Department conflicts with existing data") from exc
        self.db.refresh(department)
        return self._result(department)

    def update_department(
        self,
        department_id: int,
        body: DepartmentPatch,
        context: TenantContext,
    ) -> DepartmentResult:
        self._authorize(context)
        department = self._get_department(department_id, context, lock=True)
        values = body.model_dump(exclude_unset=True)
        if not values:
            raise EmptyDepartmentPatch("At least one department field is required")
        nullable_fields = {"parent_id", "leader", "phone", "email"}
        if any(
            value is None and field not in nullable_fields
            for field, value in values.items()
        ):
            raise EmptyDepartmentPatch("Department field cannot be null")
        if (
            "dept_name" in values
            and values["dept_name"] != department.dept_name
        ):
            self._check_name(
                context,
                values["dept_name"],
                exclude_id=department_id,
            )
        if "parent_id" in values:
            values["parent_id"] = self._parent(context, values["parent_id"])
        departments = self._all_departments(context, lock=True)
        parents = {
            row.department_id: row.parent_id
            for row in departments
        }
        parents[department_id] = values.get("parent_id", department.parent_id)
        self._check_acyclic(parents)
        for field, value in values.items():
            setattr(department, field, value)
        department.updated_by = context.actor_user_id
        department.updated_at = _now()
        self._refresh_ancestors(departments)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise DepartmentConflict("Department conflicts with existing data") from exc
        self.db.refresh(department)
        return self._result(department)

    def reorder_departments(
        self,
        body: DepartmentReorder,
        context: TenantContext,
    ) -> DepartmentReorderResult:
        self._authorize(context)
        requested_ids = [int(item.department_id) for item in body.items]
        if len(requested_ids) != len(set(requested_ids)):
            raise DuplicateDepartmentOrder("Department IDs must be unique")
        departments = self._all_departments(context, lock=True)
        by_id = {
            department.department_id: department
            for department in departments
        }
        if any(department_id not in by_id for department_id in requested_ids):
            raise NotFoundError("Tenant department not found")
        parent_updates = {
            int(item.department_id): self._parent(context, item.parent_id)
            for item in body.items
        }
        parents = {
            department.department_id: department.parent_id
            for department in departments
        }
        parents.update(parent_updates)
        self._check_acyclic(parents)
        for item in body.items:
            department = by_id[int(item.department_id)]
            department.parent_id = parent_updates[department.department_id]
            department.order_num = item.order_num
            department.updated_by = context.actor_user_id
            department.updated_at = _now()
        self._refresh_ancestors(departments)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise DepartmentConflict("Department conflicts with existing data") from exc
        return DepartmentReorderResult(updated=len(body.items))

    def delete_department(
        self,
        department_id: int,
        context: TenantContext,
    ) -> None:
        self._authorize(context)
        department = self._get_department(department_id, context, lock=True)
        child_id = self.db.scalar(
            tenant_scope(
                select(TenantDepartment.department_id)
                .where(
                    TenantDepartment.parent_id == department_id,
                    TenantDepartment.del_flag.is_(False),
                )
                .limit(1),
                TenantDepartment,
                context,
            )
        )
        if child_id is not None:
            raise DepartmentHasChildren("Department has active children")
        department.del_flag = True
        department.updated_by = context.actor_user_id
        department.updated_at = _now()
        self.db.flush()

    def _authorize(self, context: TenantContext) -> None:
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    def _department_statement(
        self,
        context: TenantContext,
        department_id: int | None = None,
    ):
        statement = select(TenantDepartment).where(
            TenantDepartment.del_flag.is_(False)
        )
        if department_id is not None:
            statement = statement.where(
                TenantDepartment.department_id == department_id
            )
        return tenant_scope(statement, TenantDepartment, context)

    def _get_department(
        self,
        department_id: int,
        context: TenantContext,
        *,
        lock: bool = False,
    ) -> TenantDepartment:
        statement = self._department_statement(context, department_id)
        if lock:
            statement = statement.with_for_update()
        department = self.db.scalar(statement)
        if department is None:
            raise NotFoundError("Tenant department not found")
        return department

    def _parent(
        self,
        context: TenantContext,
        parent_id: str | None,
    ) -> int | None:
        if parent_id is None:
            return None
        parent = self._get_department(int(parent_id), context)
        if parent.status != "0":
            raise DepartmentParentInactive("Department parent is inactive")
        return parent.department_id

    def _all_departments(
        self,
        context: TenantContext,
        *,
        lock: bool = False,
    ) -> list[TenantDepartment]:
        statement = tenant_scope(
            select(TenantDepartment)
            .where(TenantDepartment.del_flag.is_(False))
            .order_by(
                TenantDepartment.parent_id,
                TenantDepartment.order_num,
                TenantDepartment.department_id,
            ),
            TenantDepartment,
            context,
        )
        if lock:
            statement = statement.with_for_update()
        return list(self.db.scalars(statement).all())

    def _refresh_ancestors(
        self,
        departments: list[TenantDepartment],
    ) -> None:
        by_id = {
            department.department_id: department
            for department in departments
        }
        cache: dict[int, str] = {}

        def resolve(department_id: int) -> str:
            if department_id in cache:
                return cache[department_id]
            department = by_id[department_id]
            if department.parent_id is None:
                value = "0"
            else:
                parent_path = resolve(department.parent_id)
                value = (
                    f"{parent_path},{department.parent_id}"
                    if parent_path != "0"
                    else f"0,{department.parent_id}"
                )
            cache[department_id] = value
            return value

        for department in departments:
            department.ancestors = resolve(department.department_id)

    def _check_name(
        self,
        context: TenantContext,
        dept_name: str,
        *,
        exclude_id: int | None = None,
    ) -> None:
        statement = tenant_scope(
            select(TenantDepartment.department_id).where(
                TenantDepartment.dept_name == dept_name,
                TenantDepartment.del_flag.is_(False),
            ),
            TenantDepartment,
            context,
        )
        if exclude_id is not None:
            statement = statement.where(
                TenantDepartment.department_id != exclude_id
            )
        if self.db.scalar(statement) is not None:
            raise DepartmentNameConflict("Department name is already used")

    @staticmethod
    def _check_acyclic(parents: dict[int, int | None]) -> None:
        for node_id in parents:
            seen: set[int] = set()
            current: int | None = node_id
            while current is not None:
                if current in seen:
                    raise DepartmentCycle("Department hierarchy contains a cycle")
                seen.add(current)
                current = parents.get(current)

    @staticmethod
    def _build_tree(
        departments: list[TenantDepartment],
    ) -> list[DepartmentResult]:
        by_id = {
            department.department_id: TenantDepartmentService._result(department)
            for department in departments
        }
        children: dict[int, list[DepartmentResult]] = {
            department.department_id: []
            for department in departments
        }
        roots: list[int] = []
        for department in departments:
            if department.parent_id is None:
                roots.append(department.department_id)
            elif department.parent_id in children:
                children[department.parent_id].append(
                    department.department_id
                )

        def build(department_id: int) -> DepartmentResult:
            return replace(
                by_id[department_id],
                children=tuple(
                    build(child_id)
                    for child_id in children[department_id]
                ),
            )

        return [build(department_id) for department_id in roots]

    @staticmethod
    def _result(department: TenantDepartment) -> DepartmentResult:
        return DepartmentResult(
            department_id=str(department.department_id),
            tenant_id=str(department.tenant_id),
            parent_id=(
                None
                if department.parent_id is None
                else str(department.parent_id)
            ),
            ancestors=department.ancestors,
            dept_name=department.dept_name,
            order_num=department.order_num,
            leader=department.leader,
            phone=department.phone,
            email=department.email,
            status=department.status,
            created_by=str(department.created_by),
            updated_by=str(department.updated_by),
            created_at=_aware(department.created_at),
            updated_at=_aware(department.updated_at),
        )

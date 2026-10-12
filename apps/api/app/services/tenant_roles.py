"""Application service for tenant-scoped custom role definitions."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole
from app.schemas.tenant_roles import RoleCreate, RolePatch
from app.services.errors import (
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from app.services.results import PageResult
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class RoleConflict(ConflictError):
    code = "ROLE_CONFLICT"


class EmptyRolePatch(DomainValidationError):
    code = "VALIDATION_ERROR"


@dataclass(frozen=True)
class TenantRoleResult:
    role_id: str
    tenant_id: str
    scope: str
    role_name: str
    role_key: str
    role_sort: int
    status: str
    permissions: tuple[str, ...]
    remark: str | None
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TenantRoleService:
    """Business use cases for tenant custom role definitions."""

    def __init__(self, db: Session):
        self.db = db

    def list_roles(
        self,
        context: TenantContext,
        *,
        page: int,
        page_size: int,
        search: str | None,
        status: str | None,
    ) -> PageResult[TenantRoleResult]:
        self._require_management(context)
        filters = [TenantRole.del_flag.is_(False)]
        if search and search.strip():
            escaped_search = (
                search.strip()
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            term = f"%{escaped_search}%"
            filters.append(
                TenantRole.role_name.ilike(term, escape="\\")
                | TenantRole.role_key.ilike(term, escape="\\")
            )
        if status:
            filters.append(TenantRole.status == status)

        statement = tenant_scope(
            select(TenantRole).where(*filters),
            TenantRole,
            context,
        )
        count_statement = tenant_scope(
            select(func.count(TenantRole.role_id)).where(*filters),
            TenantRole,
            context,
        )
        total = self.db.scalar(count_statement) or 0
        roles = self.db.scalars(
            statement.order_by(TenantRole.role_sort, TenantRole.role_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return PageResult(
            items=tuple(self._result(role) for role in roles),
            total=total,
            page=page,
            page_size=page_size,
        )

    def create_role(
        self,
        body: RoleCreate,
        context: TenantContext,
    ) -> TenantRoleResult:
        self._require_management(context)
        self._check_unique(context, "role_name", body.role_name)
        self._check_unique(context, "role_key", body.role_key)
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
        self.db.add(role)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise RoleConflict("Role name or key is already used") from exc
        self.db.refresh(role)
        return self._result(role)

    def get_role(self, role_id: int, context: TenantContext) -> TenantRoleResult:
        self._require_management(context)
        return self._result(self._get_role(role_id, context))

    def update_role(
        self,
        role_id: int,
        body: RolePatch,
        context: TenantContext,
    ) -> TenantRoleResult:
        self._require_management(context)
        role = self._get_role(role_id, context, lock=True)
        values = body.model_dump(exclude_unset=True)
        if not values or any(
            field in values and values[field] is None
            for field in ("role_name", "role_key", "role_sort", "status", "permissions")
        ):
            raise EmptyRolePatch("At least one role field is required")
        for field in ("role_name", "role_key"):
            if field in values and values[field] != getattr(role, field):
                self._check_unique(
                    context,
                    field,
                    values[field],
                    exclude_id=role.role_id,
                )
        if "permissions" in values:
            values["permissions_json"] = json.dumps(
                values.pop("permissions"),
                separators=(",", ":"),
            )
        for field, value in values.items():
            setattr(role, field, value)
        role.updated_by = context.actor_user_id
        role.updated_at = _now()
        self._bump_membership_version_if_assigned(context, role.role_id)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise RoleConflict("Role name or key is already used") from exc
        self.db.refresh(role)
        return self._result(role)

    def delete_role(self, role_id: int, context: TenantContext) -> None:
        self._require_management(context)
        role = self._get_role(role_id, context, lock=True)
        role.del_flag = True
        role.updated_by = context.actor_user_id
        role.updated_at = _now()
        self._bump_membership_version_if_assigned(context, role.role_id)
        self.db.flush()

    def _require_management(self, context: TenantContext) -> None:
        if "tenant_member:manage" not in context.permission_set:
            raise ForbiddenError("Tenant role management requires permission")

    def _role_statement(self, role_id: int, context: TenantContext):
        return tenant_scope(
            select(TenantRole).where(
                TenantRole.role_id == role_id,
                TenantRole.del_flag.is_(False),
            ),
            TenantRole,
            context,
        )

    def _get_role(
        self,
        role_id: int,
        context: TenantContext,
        *,
        lock: bool = False,
    ) -> TenantRole:
        statement = self._role_statement(role_id, context)
        if lock:
            statement = statement.with_for_update()
        role = self.db.scalar(statement)
        if role is None:
            raise NotFoundError("Tenant role not found")
        return role

    def _check_unique(
        self,
        context: TenantContext,
        field: str,
        value: str,
        *,
        exclude_id: int | None = None,
    ) -> None:
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
        if self.db.scalar(statement) is not None:
            raise RoleConflict("Role name or key is already used")

    def _bump_membership_version_if_assigned(
        self,
        context: TenantContext,
        role_id: int,
    ) -> None:
        assigned = self.db.scalar(
            select(TenantMemberRole.assignment_id)
            .where(
                TenantMemberRole.tenant_id == context.tenant_id,
                TenantMemberRole.role_id == role_id,
            )
            .limit(1)
        )
        if assigned is not None:
            self.db.execute(
                update(Tenant)
                .where(Tenant.tenant_id == context.tenant_id)
                .values(membership_version=Tenant.membership_version + 1)
            )

    @staticmethod
    def _result(role: TenantRole) -> TenantRoleResult:
        try:
            permissions = tuple(json.loads(role.permissions_json or "[]"))
        except (TypeError, ValueError):
            permissions = ()
        return TenantRoleResult(
            role_id=str(role.role_id),
            tenant_id=str(role.tenant_id),
            scope="tenant",
            role_name=role.role_name,
            role_key=role.role_key,
            role_sort=role.role_sort,
            status=role.status,
            permissions=permissions,
            remark=role.remark,
            created_by=str(role.created_by),
            updated_by=str(role.updated_by),
            created_at=role.created_at,
            updated_at=role.updated_at,
        )

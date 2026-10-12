"""Application service for tenant member custom-role assignments."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, TenantMember
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole
from app.models.user import User, utcnow
from app.schemas.tenant_member_roles import RoleAssignment
from app.services.errors import ConflictError, ForbiddenError, NotFoundError
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class BuiltinRoleProtected(ConflictError):
    code = "BUILTIN_ROLE_PROTECTED"


class MembershipInactive(ConflictError):
    code = "MEMBERSHIP_INACTIVE"


class MembershipRoleUnsupported(ConflictError):
    code = "MEMBERSHIP_ROLE_UNSUPPORTED"


class UserInactive(ConflictError):
    code = "USER_INACTIVE"


class RoleAssignmentConflict(ConflictError):
    code = "ROLE_ASSIGNMENT_CONFLICT"


@dataclass(frozen=True)
class CustomRoleAssignmentRoleResult:
    role_id: str
    tenant_id: str
    role_name: str
    role_key: str
    status: str
    permissions: tuple[str, ...]


@dataclass(frozen=True)
class MemberCustomRoleResult:
    user_id: str
    role: CustomRoleAssignmentRoleResult | None
    assigned_by: str | None = None
    assigned_at: datetime | None = None


def _iso_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class TenantMemberRoleService:
    """Business use cases for assigning one custom role to a tenant member."""

    def __init__(self, db: Session):
        self.db = db

    def get_assignment(
        self,
        user_id: int,
        context: TenantContext,
    ) -> MemberCustomRoleResult:
        self._authorize_read(context, user_id)
        self._get_member(context, user_id)
        assignment = self._get_assignment(context, user_id)
        if assignment is None:
            return MemberCustomRoleResult(user_id=str(user_id), role=None)

        role = self._get_active_role_for_assignment(context, assignment.role_id)
        if role is None:
            return MemberCustomRoleResult(user_id=str(user_id), role=None)
        return self._result(assignment, role)

    def assign_role(
        self,
        user_id: int,
        body: RoleAssignment,
        context: TenantContext,
    ) -> MemberCustomRoleResult:
        self._authorize_manage(context)
        self._get_member(context, user_id, lock=True)
        role = self._get_role(context, int(body.role_id), lock=True)
        assignment = self._get_assignment(context, user_id)
        if assignment is not None and assignment.role_id == role.role_id:
            return self._result(assignment, role)

        candidate = assignment
        try:
            # The savepoint keeps a concurrent unique-key loser queryable
            # without rolling back the request-scoped transaction.
            with self.db.begin_nested():
                if candidate is None:
                    candidate = TenantMemberRole(
                        tenant_id=context.tenant_id,
                        user_id=user_id,
                        role_id=role.role_id,
                        assigned_by=context.actor_user_id,
                    )
                    self.db.add(candidate)
                else:
                    candidate.role_id = role.role_id
                    candidate.assigned_by = context.actor_user_id
                    candidate.assigned_at = utcnow()
                self._advance_version(context.tenant_id)
                self.db.flush()
        except IntegrityError as exc:
            current = self._get_assignment(context, user_id)
            if current is not None and current.role_id == role.role_id:
                current_role = self._get_active_role_for_assignment(
                    context,
                    current.role_id,
                )
                if current_role is not None:
                    return self._result(current, current_role)
            raise RoleAssignmentConflict("Member role assignment conflicted") from exc

        assert candidate is not None
        self.db.refresh(candidate)
        return self._result(candidate, role)

    def revoke_role(
        self,
        user_id: int,
        context: TenantContext,
    ) -> None:
        self._authorize_manage(context)
        self._get_member(context, user_id, lock=True)
        assignment = self._get_assignment(context, user_id)
        if assignment is None:
            return
        self.db.delete(assignment)
        self._advance_version(context.tenant_id)
        self.db.flush()

    def _authorize_manage(self, context: TenantContext) -> None:
        # Custom grants must never delegate the ability to manage assignments.
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    def _authorize_read(self, context: TenantContext, user_id: int) -> None:
        if context.tenant_role in {"owner", "admin"}:
            return
        if context.tenant_role == "member" and context.actor_user_id == user_id:
            return
        raise ForbiddenError("Member role assignment is not readable")

    def _get_member(
        self,
        context: TenantContext,
        user_id: int,
        *,
        lock: bool = False,
    ) -> TenantMember:
        statement = tenant_scope(
            select(TenantMember).where(TenantMember.user_id == user_id),
            TenantMember,
            context,
        )
        if lock:
            statement = statement.with_for_update()
        membership = self.db.scalar(statement)
        if membership is None:
            raise NotFoundError("Tenant member not found")
        if membership.status != "active":
            raise MembershipInactive("Tenant membership is inactive")

        user = self.db.scalar(select(User).where(User.user_id == user_id))
        if user is None or user.status != "active" or user.del_flag:
            raise UserInactive("User is inactive")
        if membership.tenant_role in {"owner", "admin"}:
            raise BuiltinRoleProtected("Built-in tenant roles cannot receive custom roles")
        if membership.tenant_role != "member":
            raise MembershipRoleUnsupported("Tenant membership role is unsupported")
        return membership

    def _get_assignment(
        self,
        context: TenantContext,
        user_id: int,
    ) -> TenantMemberRole | None:
        statement = tenant_scope(
            select(TenantMemberRole).where(TenantMemberRole.user_id == user_id),
            TenantMemberRole,
            context,
        )
        return self.db.scalar(statement)

    def _get_role(
        self,
        context: TenantContext,
        role_id: int,
        *,
        lock: bool = False,
    ) -> TenantRole:
        statement = tenant_scope(
            select(TenantRole).where(
                TenantRole.role_id == role_id,
                TenantRole.status == "active",
                TenantRole.del_flag.is_(False),
            ),
            TenantRole,
            context,
        )
        if lock:
            statement = statement.with_for_update()
        role = self.db.scalar(statement)
        if role is None:
            raise NotFoundError("Tenant role not found")
        return role

    def _get_active_role_for_assignment(
        self,
        context: TenantContext,
        role_id: int,
    ) -> TenantRole | None:
        return self.db.scalar(
            tenant_scope(
                select(TenantRole).where(
                    TenantRole.role_id == role_id,
                    TenantRole.status == "active",
                    TenantRole.del_flag.is_(False),
                ),
                TenantRole,
                context,
            )
        )

    def _advance_version(self, tenant_id: int) -> None:
        self.db.execute(
            update(Tenant)
            .where(Tenant.tenant_id == tenant_id)
            .values(membership_version=Tenant.membership_version + 1)
        )

    @staticmethod
    def _result(
        assignment: TenantMemberRole,
        role: TenantRole,
    ) -> MemberCustomRoleResult:
        try:
            permissions = tuple(json.loads(role.permissions_json or "[]"))
        except (TypeError, ValueError):
            permissions = ()
        return MemberCustomRoleResult(
            user_id=str(assignment.user_id),
            role=CustomRoleAssignmentRoleResult(
                role_id=str(role.role_id),
                tenant_id=str(role.tenant_id),
                role_name=role.role_name,
                role_key=role.role_key,
                status=role.status,
                permissions=permissions,
            ),
            assigned_by=str(assignment.assigned_by),
            assigned_at=_iso_utc(assignment.assigned_at),
        )

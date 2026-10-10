"""Application service for tenants and tenant membership."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Generic, TypeVar

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.user import User
from app.schemas.tenants import MemberCreate, MemberPatch, TenantCreate, TenantPatch
from app.services.errors import ConflictError, DomainValidationError, ForbiddenError, NotFoundError


class TenantSlugConflict(ConflictError):
    code = "SLUG_CONFLICT"


class MembershipExists(ConflictError):
    code = "MEMBERSHIP_EXISTS"


class LastOwnerRequired(ConflictError):
    code = "LAST_OWNER_REQUIRED"


class TenantValidityError(DomainValidationError):
    code = "VALIDITY_RANGE"


class TargetUserUnavailable(DomainValidationError):
    code = "VALIDATION_ERROR"


T = TypeVar("T")


@dataclass(frozen=True)
class PageResult(Generic[T]):
    items: tuple[T, ...]
    total: int
    page: int
    page_size: int


@dataclass(frozen=True)
class ActorContext:
    user_id: int
    platform_role: str | None = None


@dataclass(frozen=True)
class WorkspaceResult:
    workspace_id: str
    tenant_id: str
    slug: str
    name: str
    icon: str | None
    status: str
    workspace_role: str


@dataclass(frozen=True)
class TenantResult:
    tenant_id: str
    slug: str
    name: str
    status: str
    valid_from: datetime | None
    valid_until: datetime | None
    settings: dict
    tenant_role: str | None
    membership_version: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class TenantWithWorkspacesResult(TenantResult):
    workspaces: tuple[WorkspaceResult, ...]


@dataclass(frozen=True)
class TenantCreatedResult(TenantResult):
    default_workspace: WorkspaceResult


@dataclass(frozen=True)
class TenantContextUserResult:
    user_id: str
    user_name: str
    nick_name: str | None


@dataclass(frozen=True)
class TenantContextResult:
    user: TenantContextUserResult
    tenants: tuple[TenantWithWorkspacesResult, ...]
    recent_workspace_id: None
    context_version: int


@dataclass(frozen=True)
class MemberResult:
    user_id: str
    user_name: str
    nick_name: str | None
    email: str | None
    status: str
    tenant_role: str
    joined_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """Treat naive SQLite timestamps as UTC so they can compare with request input."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


class TenantService:
    """Business use cases for tenant lifecycle and tenant membership."""

    def __init__(self, db: Session):
        self.db = db

    def create_tenant(self, body: TenantCreate, actor: ActorContext) -> TenantCreatedResult:
        owner_id = int(body.first_owner_user_id)
        owner = self.db.get(User, owner_id)
        if not owner or owner.del_flag or owner.status != "active":
            raise TargetUserUnavailable("Selected owner is unavailable")
        self._validate_validity(body.valid_from, body.valid_until)

        try:
            tenant = Tenant(
                slug=body.slug,
                name=body.name,
                status="active",
                valid_from=body.valid_from,
                valid_until=body.valid_until,
                settings_json="{}",
                membership_version=1,
            )
            self.db.add(tenant)
            self.db.flush()

            now = _now()
            self.db.add(
                TenantMember(
                    tenant_id=tenant.tenant_id,
                    user_id=owner_id,
                    status="active",
                    tenant_role="owner",
                    joined_at=now,
                )
            )
            self.db.flush()

            workspace = Workspace(
                tenant_id=tenant.tenant_id,
                slug="default",
                name="默认空间",
                status="active",
                settings_json="{}",
                created_by=actor.user_id,
            )
            self.db.add(workspace)
            self.db.flush()

            self.db.add(
                WorkspaceMember(
                    workspace_id=workspace.workspace_id,
                    tenant_id=tenant.tenant_id,
                    user_id=owner_id,
                    status="active",
                    workspace_role="owner",
                    joined_at=now,
                )
            )
            self.db.flush()

            return TenantCreatedResult(
                **self._tenant_values(tenant, "owner"),
                default_workspace=self._workspace_result(workspace, "owner"),
            )
        except IntegrityError as exc:
            raise TenantSlugConflict("Tenant slug is already used") from exc

    def get_context(self, actor: ActorContext) -> TenantContextResult:
        user = self.db.get(User, actor.user_id)
        if user is None:
            raise NotFoundError("User not found")

        rows = self.db.execute(
            select(Tenant, TenantMember)
            .join(TenantMember, TenantMember.tenant_id == Tenant.tenant_id)
            .where(
                TenantMember.user_id == actor.user_id,
                TenantMember.status == "active",
                Tenant.status == "active",
            )
        ).all()
        tenants = tuple(
            self._tenant_with_workspaces(tenant, member.tenant_role, actor.user_id)
            for tenant, member in rows
        )
        context_version = max((tenant.membership_version for tenant, _ in rows), default=0)
        return TenantContextResult(
            user=TenantContextUserResult(
                user_id=str(user.user_id),
                user_name=user.user_name,
                nick_name=user.nick_name,
            ),
            tenants=tenants,
            recent_workspace_id=None,
            context_version=context_version,
        )

    def list_tenants(
        self,
        actor: ActorContext,
        *,
        page: int,
        page_size: int,
        name: str | None,
        status: str | None,
    ) -> PageResult[TenantWithWorkspacesResult]:
        query = (
            select(Tenant, TenantMember.tenant_role)
            .join(TenantMember, TenantMember.tenant_id == Tenant.tenant_id)
            .where(
                TenantMember.user_id == actor.user_id,
                TenantMember.status == "active",
                Tenant.status == "active",
            )
        )
        if name:
            query = query.where(Tenant.name.ilike(f"%{name}%"))
        # Ordinary member listings never expose inactive tenants, even when an
        # inactive status is explicitly requested as a filter.
        if status and status != "active":
            query = query.where(Tenant.status == status)

        total = self.db.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.db.execute(
            query.order_by(Tenant.tenant_id).offset((page - 1) * page_size).limit(page_size)
        ).all()
        items = tuple(
            self._tenant_with_workspaces(tenant, role, actor.user_id)
            for tenant, role in rows
        )
        return PageResult(items=items, total=total, page=page, page_size=page_size)

    def list_platform_tenants(
        self,
        *,
        page: int,
        page_size: int,
        name: str | None,
        status: str | None,
    ) -> PageResult[TenantResult]:
        query = select(Tenant)
        count_query = select(func.count()).select_from(Tenant)
        if status:
            query = query.where(Tenant.status == status)
            count_query = count_query.where(Tenant.status == status)
        if name:
            query = query.where(Tenant.name.ilike(f"%{name}%"))
            count_query = count_query.where(Tenant.name.ilike(f"%{name}%"))

        total = self.db.scalar(count_query) or 0
        rows = self.db.scalars(
            query.order_by(Tenant.tenant_id).offset((page - 1) * page_size).limit(page_size)
        ).all()
        items = tuple(self._tenant_result(tenant) for tenant in rows)
        return PageResult(items=items, total=total, page=page, page_size=page_size)

    def get_tenant(self, tenant_id: int, actor: ActorContext) -> TenantResult:
        tenant = self._tenant(tenant_id)
        role = self._role(tenant_id, actor.user_id)
        if role is None and actor.platform_role != "platform_admin":
            raise NotFoundError("Tenant not found")
        return self._tenant_result(tenant, role)

    def update_tenant(
        self,
        tenant_id: int,
        body: TenantPatch,
        actor: ActorContext,
    ) -> TenantResult:
        tenant = self._tenant(tenant_id)
        fields = body.model_dump(exclude_unset=True)
        role = self._role(tenant_id, actor.user_id)
        platform = actor.platform_role == "platform_admin"
        if not platform and role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant management requires owner or admin")
        if "status" in fields and not platform:
            raise ForbiddenError("Only platform administrators can change tenant status")

        self._validate_validity(
            fields.get("valid_from", tenant.valid_from),
            fields.get("valid_until", tenant.valid_until),
        )
        for key, value in fields.items():
            if key == "settings":
                tenant.settings_json = json.dumps(value, ensure_ascii=False)
            else:
                setattr(tenant, key, value)
        tenant.updated_at = _now()
        tenant.membership_version += int("status" in fields)
        self.db.flush()
        self.db.refresh(tenant)
        return self._tenant_result(tenant, role)

    def list_members(
        self,
        tenant_id: int,
        actor: ActorContext,
        *,
        page: int,
        page_size: int,
    ) -> PageResult[MemberResult]:
        self._tenant(tenant_id)
        self._require_role(tenant_id, actor.user_id, {"owner", "admin", "member"})
        query = (
            select(TenantMember, User)
            .join(User, User.user_id == TenantMember.user_id)
            .where(TenantMember.tenant_id == tenant_id)
        )
        total = self.db.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.db.execute(
            query.order_by(TenantMember.tenant_member_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        items = tuple(self._member_result(member, user) for member, user in rows)
        return PageResult(items=items, total=total, page=page, page_size=page_size)

    def add_member(
        self,
        tenant_id: int,
        body: MemberCreate,
        actor: ActorContext,
    ) -> MemberResult:
        self._tenant(tenant_id)
        actor_role = self._require_role(tenant_id, actor.user_id, {"owner", "admin"})
        if body.tenant_role == "owner" and actor_role != "owner":
            raise ForbiddenError("Only an owner can assign the owner role")

        target = self.db.get(User, int(body.user_id))
        if not target or target.del_flag or target.status != "active":
            raise TargetUserUnavailable("Selected member is unavailable")

        member = self._member(tenant_id, target.user_id)
        now = _now()
        if member:
            if member.status == "active":
                raise MembershipExists("Tenant membership already exists")
            if body.tenant_role == "owner" and actor_role != "owner":
                raise ForbiddenError("Only an owner can assign the owner role")
            member.status = "active"
            member.tenant_role = body.tenant_role
            member.joined_at = now
            member.updated_at = now
        else:
            member = TenantMember(
                tenant_id=tenant_id,
                user_id=target.user_id,
                status="active",
                tenant_role=body.tenant_role,
                joined_at=now,
            )
            self.db.add(member)

        tenant = self._tenant(tenant_id)
        tenant.membership_version += 1
        # Rejoining never revokes previously revoked workspace access.
        self.db.flush()
        self.db.refresh(member)
        return self._member_result(member, target)

    def update_member(
        self,
        tenant_id: int,
        user_id: int,
        body: MemberPatch,
        actor: ActorContext,
    ) -> MemberResult:
        tenant = self.db.scalar(
            select(Tenant).where(Tenant.tenant_id == tenant_id).with_for_update()
        )
        if tenant is None:
            raise NotFoundError("Tenant not found")
        actor_role = self._require_role(tenant_id, actor.user_id, {"owner", "admin"})
        target = self._member(tenant_id, user_id)
        if target is None:
            raise NotFoundError("Tenant member not found")

        fields = body.model_dump(exclude_unset=True)
        if target.tenant_role == "owner" and actor_role != "owner":
            raise ForbiddenError("Only an owner can manage an owner")
        if fields.get("tenant_role") == "owner" and actor_role != "owner":
            raise ForbiddenError("Only an owner can assign the owner role")

        if fields.get("status") in {"removed", "suspended"} and target.tenant_role == "owner":
            self._require_other_owner(tenant_id, user_id)
        if fields.get("tenant_role") in {"admin", "member"} and target.tenant_role == "owner":
            self._require_other_owner(tenant_id, user_id)

        deactivating = fields.get("status") in {"removed", "suspended"} and target.status == "active"
        if deactivating:
            owned_spaces = self.db.scalars(
                select(WorkspaceMember).where(
                    WorkspaceMember.tenant_id == tenant_id,
                    WorkspaceMember.user_id == user_id,
                    WorkspaceMember.status == "active",
                    WorkspaceMember.workspace_role == "owner",
                ).with_for_update()
            ).all()
            for membership in owned_spaces:
                another = self.db.scalar(
                    select(func.count()).select_from(WorkspaceMember).where(
                        WorkspaceMember.workspace_id == membership.workspace_id,
                        WorkspaceMember.tenant_id == tenant_id,
                        WorkspaceMember.status == "active",
                        WorkspaceMember.workspace_role == "owner",
                        WorkspaceMember.user_id != user_id,
                    )
                ) or 0
                if another == 0:
                    raise LastOwnerRequired("Workspace requires another owner")

        old_status, old_role = target.status, target.tenant_role
        for key, value in fields.items():
            setattr(target, key, value)
        target.updated_at = tenant.updated_at = _now()
        if fields and (old_status != target.status or old_role != target.tenant_role):
            tenant.membership_version += 1
        if target.status != "active" and old_status == "active":
            self.db.query(WorkspaceMember).filter(
                WorkspaceMember.tenant_id == tenant_id,
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.status == "active",
            ).update(
                {"status": "removed", "updated_at": _now()},
                synchronize_session=False,
            )
        self.db.flush()
        self.db.refresh(target)
        account = self.db.get(User, user_id)
        return self._member_result(target, account)

    def _tenant(self, tenant_id: int) -> Tenant:
        tenant = self.db.get(Tenant, tenant_id)
        if tenant is None:
            raise NotFoundError("Tenant not found")
        return tenant

    def _member(self, tenant_id: int, user_id: int) -> TenantMember | None:
        return self.db.scalar(
            select(TenantMember).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.user_id == user_id,
            )
        )

    def _role(self, tenant_id: int, user_id: int) -> str | None:
        member = self._member(tenant_id, user_id)
        return member.tenant_role if member and member.status == "active" else None

    def _require_role(self, tenant_id: int, user_id: int, roles: set[str]) -> str:
        role = self._role(tenant_id, user_id)
        if role not in roles:
            raise ForbiddenError("Tenant membership role is not allowed")
        return role

    def _require_other_owner(self, tenant_id: int, user_id: int) -> None:
        other_owners = self.db.scalar(
            select(func.count()).select_from(TenantMember).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.tenant_role == "owner",
                TenantMember.status == "active",
                TenantMember.user_id != user_id,
            )
        ) or 0
        if other_owners == 0:
            raise LastOwnerRequired("Tenant requires another owner")

    def _workspaces(self, tenant_id: int, user_id: int) -> tuple[WorkspaceResult, ...]:
        rows = self.db.execute(
            select(Workspace, WorkspaceMember.workspace_role)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.workspace_id)
            .where(
                Workspace.tenant_id == tenant_id,
                Workspace.status == "active",
                WorkspaceMember.tenant_id == tenant_id,
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.status == "active",
            )
            .order_by(Workspace.workspace_id)
        ).all()
        return tuple(self._workspace_result(workspace, role) for workspace, role in rows)

    def _tenant_values(self, tenant: Tenant, role: str | None = None) -> dict:
        return {
            "tenant_id": str(tenant.tenant_id),
            "slug": tenant.slug,
            "name": tenant.name,
            "status": tenant.status,
            "valid_from": tenant.valid_from,
            "valid_until": tenant.valid_until,
            "settings": json.loads(tenant.settings_json or "{}"),
            "tenant_role": role,
            "membership_version": tenant.membership_version,
            "created_at": tenant.created_at,
            "updated_at": tenant.updated_at,
        }

    def _tenant_result(self, tenant: Tenant, role: str | None = None) -> TenantResult:
        return TenantResult(**self._tenant_values(tenant, role))

    def _tenant_with_workspaces(
        self,
        tenant: Tenant,
        role: str | None,
        user_id: int,
    ) -> TenantWithWorkspacesResult:
        return TenantWithWorkspacesResult(
            **self._tenant_values(tenant, role),
            workspaces=self._workspaces(tenant.tenant_id, user_id),
        )

    def _workspace_result(self, workspace: Workspace, role: str) -> WorkspaceResult:
        return WorkspaceResult(
            workspace_id=str(workspace.workspace_id),
            tenant_id=str(workspace.tenant_id),
            slug=workspace.slug,
            name=workspace.name,
            icon=workspace.icon,
            status=workspace.status,
            workspace_role=role,
        )

    def _member_result(self, member: TenantMember, user: User) -> MemberResult:
        return MemberResult(
            user_id=str(user.user_id),
            user_name=user.user_name,
            nick_name=user.nick_name,
            email=user.email,
            status=member.status,
            tenant_role=member.tenant_role,
            joined_at=member.joined_at,
            created_at=member.created_at,
            updated_at=member.updated_at,
        )

    def _validate_validity(
        self,
        valid_from: datetime | None,
        valid_until: datetime | None,
    ) -> None:
        start, end = _aware(valid_from), _aware(valid_until)
        if start and end and end <= start:
            raise TenantValidityError("Tenant validity end must be after start")

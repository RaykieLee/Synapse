"""Application service for workspace lifecycle and workspace membership."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.user import User
from app.schemas.workspaces import (
    TransferOwnership,
    WorkspaceCreate,
    WorkspaceMemberPut,
    WorkspacePatch,
)
from app.services.errors import (
    BadRequestError,
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from app.services.results import ActorContext, PageResult


class WorkspaceSlugConflict(ConflictError):
    code = "SLUG_CONFLICT"


class TenantInactive(ConflictError):
    code = "TENANT_INACTIVE"


class WorkspaceInactive(ConflictError):
    code = "WORKSPACE_INACTIVE"


class LastWorkspaceOwnerRequired(ConflictError):
    code = "LAST_OWNER_REQUIRED"


class WorkspaceContextRequired(BadRequestError):
    code = "WORKSPACE_CONTEXT_REQUIRED"


class WorkspaceContextMismatch(BadRequestError):
    code = "CONTEXT_MISMATCH"


class MembershipInactive(ForbiddenError):
    code = "MEMBERSHIP_INACTIVE"


class WorkspaceMembershipRequired(ForbiddenError):
    code = "WORKSPACE_MEMBERSHIP_REQUIRED"


class TargetUserUnavailable(DomainValidationError):
    code = "VALIDATION_ERROR"


@dataclass(frozen=True)
class WorkspaceResult:
    workspace_id: str
    tenant_id: str
    slug: str
    name: str
    icon: str | None
    status: str
    settings: dict
    workspace_role: str | None
    membership_version: int
    created_by: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class WorkspaceMemberResult:
    user_id: str
    user_name: str
    nick_name: str | None
    email: str | None
    status: str
    workspace_role: str
    joined_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class WorkspaceMembershipResult:
    user_id: str
    status: str
    workspace_role: str
    membership_version: int


@dataclass(frozen=True)
class WorkspaceMemberRemovalResult:
    user_id: str
    status: str
    membership_version: int


@dataclass(frozen=True)
class WorkspaceTransferResult:
    workspace_id: str
    previous_owner_user_id: str
    new_owner_user_id: str
    membership_version: int


@dataclass(frozen=True)
class _WorkspaceAccess:
    workspace: Workspace
    tenant: Tenant
    tenant_member: TenantMember
    workspace_member: WorkspaceMember


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WorkspaceService:
    """Business use cases for workspace metadata, members, and ownership."""

    def __init__(self, db: Session):
        self.db = db

    def list_workspaces(
        self,
        actor: ActorContext,
        *,
        tenant_id: int | None,
        page: int,
        page_size: int,
        include_archived: bool,
    ) -> PageResult[WorkspaceResult]:
        query = (
            select(Workspace, Tenant, WorkspaceMember.workspace_role)
            .join(
                WorkspaceMember,
                (WorkspaceMember.workspace_id == Workspace.workspace_id)
                & (WorkspaceMember.tenant_id == Workspace.tenant_id),
            )
            .join(Tenant, Tenant.tenant_id == Workspace.tenant_id)
            .join(
                TenantMember,
                (TenantMember.tenant_id == Tenant.tenant_id)
                & (TenantMember.user_id == actor.user_id),
            )
            .where(
                WorkspaceMember.user_id == actor.user_id,
                WorkspaceMember.status == "active",
                TenantMember.status == "active",
                Tenant.status == "active",
            )
        )
        if include_archived:
            query = query.where(
                (Workspace.status == "active")
                | (
                    (Workspace.status == "archived")
                    & WorkspaceMember.workspace_role.in_(("owner", "admin"))
                )
            )
        else:
            query = query.where(Workspace.status == "active")
        if tenant_id is not None:
            query = query.where(Workspace.tenant_id == tenant_id)

        total = self.db.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.db.execute(
            query.order_by(Workspace.workspace_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        items = tuple(self._result(workspace, role, tenant) for workspace, tenant, role in rows)
        return PageResult(items=items, total=total, page=page, page_size=page_size)

    def create_workspace(
        self,
        tenant_id: int,
        body: WorkspaceCreate,
        actor: ActorContext,
    ) -> WorkspaceResult:
        tenant = self._tenant(tenant_id, lock=True)
        if tenant.status != "active":
            raise TenantInactive("Tenant is inactive")
        tenant_member = self._tenant_member(tenant_id, actor.user_id)
        if tenant_member is None or tenant_member.status != "active":
            raise MembershipInactive("Tenant membership is inactive")
        if tenant_member.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

        try:
            workspace = Workspace(
                tenant_id=tenant_id,
                slug=body.slug,
                name=body.name,
                icon=body.icon,
                status="active",
                settings_json="{}",
                created_by=actor.user_id,
            )
            self.db.add(workspace)
            self.db.flush()
            member = WorkspaceMember(
                workspace_id=workspace.workspace_id,
                tenant_id=tenant_id,
                user_id=actor.user_id,
                status="active",
                workspace_role="owner",
                joined_at=_now(),
            )
            self.db.add(member)
            tenant.membership_version += 1
            self.db.flush()
            return self._result(workspace, "owner", tenant)
        except IntegrityError as exc:
            raise WorkspaceSlugConflict("Workspace slug is already used") from exc

    def get_workspace(
        self,
        workspace_id: int,
        header_workspace_id: str | None,
        actor: ActorContext,
    ) -> WorkspaceResult:
        access = self._access(workspace_id, header_workspace_id, actor)
        self._reject_archived_for_regular_member(access)
        return self._result(
            access.workspace,
            access.workspace_member.workspace_role,
            access.tenant,
        )

    def update_workspace(
        self,
        workspace_id: int,
        body: WorkspacePatch,
        header_workspace_id: str | None,
        actor: ActorContext,
    ) -> WorkspaceResult:
        access = self._access(
            workspace_id,
            header_workspace_id,
            actor,
            lock_workspace=True,
            lock_tenant=True,
        )
        if access.workspace_member.workspace_role not in {"owner", "admin"}:
            raise ForbiddenError("Workspace owner or admin role is required")

        fields = body.model_dump(exclude_unset=True)
        old_status = access.workspace.status
        for key, value in fields.items():
            attribute = "settings_json" if key == "settings" else key
            serialized = json.dumps(value, ensure_ascii=False) if key == "settings" else value
            setattr(access.workspace, attribute, serialized)
        access.workspace.updated_at = access.tenant.updated_at = _now()
        if old_status != access.workspace.status:
            access.tenant.membership_version += 1
        self.db.flush()
        return self._result(
            access.workspace,
            access.workspace_member.workspace_role,
            access.tenant,
        )

    def list_members(
        self,
        workspace_id: int,
        header_workspace_id: str | None,
        actor: ActorContext,
        *,
        page: int,
        page_size: int,
    ) -> PageResult[WorkspaceMemberResult]:
        access = self._access(workspace_id, header_workspace_id, actor)
        self._reject_archived_for_regular_member(access)
        query = (
            select(WorkspaceMember, User)
            .join(User, User.user_id == WorkspaceMember.user_id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.tenant_id == access.tenant.tenant_id,
            )
        )
        total = self.db.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.db.execute(
            query.order_by(WorkspaceMember.workspace_member_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        items = tuple(self._member_result(member, account) for member, account in rows)
        return PageResult(items=items, total=total, page=page, page_size=page_size)

    def put_member(
        self,
        workspace_id: int,
        user_id: int,
        body: WorkspaceMemberPut,
        header_workspace_id: str | None,
        actor: ActorContext,
    ) -> WorkspaceMemberRemovalResult:
        access = self._access(workspace_id, header_workspace_id, actor, lock_tenant=True)
        if access.workspace.status != "active":
            raise WorkspaceInactive("Workspace is inactive")
        actor_role = access.workspace_member.workspace_role
        if actor_role not in {"owner", "admin"}:
            raise ForbiddenError("Workspace owner or admin role is required")

        target_member = self._tenant_member(access.tenant.tenant_id, user_id)
        target_user = self.db.get(User, user_id)
        if (
            target_member is None
            or target_member.status != "active"
            or target_user is None
            or target_user.del_flag
            or target_user.status != "active"
        ):
            raise TargetUserUnavailable("Selected user is unavailable")

        target = self._workspace_member(workspace_id, user_id, lock=True)
        if target is not None and target.workspace_role == "owner" and actor_role != "owner":
            raise ForbiddenError("Only a workspace owner can manage an owner")
        if body.workspace_role == "owner" and actor_role != "owner":
            raise ForbiddenError("Only a workspace owner can assign an owner")

        now = _now()
        if target is None:
            target = WorkspaceMember(
                workspace_id=workspace_id,
                tenant_id=access.tenant.tenant_id,
                user_id=user_id,
                status="active",
                workspace_role=body.workspace_role,
                joined_at=now,
            )
            self.db.add(target)
        else:
            if (
                target.status == "active"
                and target.workspace_role == "owner"
                and body.workspace_role != "owner"
                and self._owner_count(workspace_id, except_user_id=user_id) == 0
            ):
                raise LastWorkspaceOwnerRequired("Workspace requires another owner")
            target.status = "active"
            target.workspace_role = body.workspace_role
            target.joined_at = target.joined_at or now
            target.updated_at = now

        access.tenant.membership_version += 1
        self.db.flush()
        return WorkspaceMembershipResult(
            user_id=str(user_id),
            status=target.status,
            workspace_role=target.workspace_role,
            membership_version=access.tenant.membership_version,
        )

    def remove_member(
        self,
        workspace_id: int,
        user_id: int,
        header_workspace_id: str | None,
        actor: ActorContext,
    ) -> WorkspaceMembershipResult:
        access = self._access(workspace_id, header_workspace_id, actor, lock_tenant=True)
        if access.workspace.status != "active":
            raise WorkspaceInactive("Workspace is inactive")
        actor_role = access.workspace_member.workspace_role
        if actor_role not in {"owner", "admin"}:
            raise ForbiddenError("Workspace owner or admin role is required")

        target = self._workspace_member(
            workspace_id,
            user_id,
            tenant_id=access.tenant.tenant_id,
            lock=True,
        )
        if target is None:
            raise NotFoundError("Workspace member not found")
        if target.workspace_role == "owner" and actor_role != "owner":
            raise ForbiddenError("Only a workspace owner can manage an owner")
        if (
            target.status == "active"
            and target.workspace_role == "owner"
            and self._owner_count(workspace_id, except_user_id=user_id) == 0
        ):
            raise LastWorkspaceOwnerRequired("Workspace requires another owner")

        target.status = "removed"
        target.updated_at = _now()
        access.tenant.membership_version += 1
        self.db.flush()
        return WorkspaceMemberRemovalResult(
            user_id=str(user_id),
            status="removed",
            membership_version=access.tenant.membership_version,
        )

    def transfer_ownership(
        self,
        workspace_id: int,
        body: TransferOwnership,
        header_workspace_id: str | None,
        actor: ActorContext,
    ) -> WorkspaceTransferResult:
        access = self._access(
            workspace_id,
            header_workspace_id,
            actor,
            lock_workspace=True,
            lock_tenant=True,
        )
        if access.workspace.status != "active":
            raise WorkspaceInactive("Workspace is inactive")
        if access.workspace_member.workspace_role != "owner":
            raise ForbiddenError("Only a workspace owner can transfer ownership")

        target_id = int(body.new_owner_user_id)
        if target_id == actor.user_id:
            raise TargetUserUnavailable("New owner must be another user")
        target_member = self._tenant_member(access.tenant.tenant_id, target_id)
        target = self._workspace_member(workspace_id, target_id, lock=True)
        if target_member is None or target_member.status != "active":
            raise TargetUserUnavailable("New owner must be an active tenant member")
        if target is None or target.status != "active":
            raise TargetUserUnavailable("New owner must be an active workspace member")

        current = self._workspace_member(workspace_id, actor.user_id, lock=True)
        now = _now()
        target.workspace_role = "owner"
        target.updated_at = now
        current.workspace_role = "admin"
        current.updated_at = now
        access.tenant.membership_version += 1
        self.db.flush()
        return WorkspaceTransferResult(
            workspace_id=str(workspace_id),
            previous_owner_user_id=str(actor.user_id),
            new_owner_user_id=str(target_id),
            membership_version=access.tenant.membership_version,
        )

    def _access(
        self,
        workspace_id: int,
        header_workspace_id: str | None,
        actor: ActorContext,
        *,
        lock_workspace: bool = False,
        lock_tenant: bool = False,
    ) -> _WorkspaceAccess:
        if header_workspace_id is None:
            raise WorkspaceContextRequired("X-Workspace-ID is required")
        if not header_workspace_id.isdecimal() or int(header_workspace_id) != workspace_id:
            raise WorkspaceContextMismatch("Workspace context does not match the path")

        workspace_query = select(Workspace).where(Workspace.workspace_id == workspace_id)
        if lock_workspace:
            workspace_query = workspace_query.with_for_update()
        workspace = self.db.scalar(workspace_query)
        if workspace is None:
            raise NotFoundError("Workspace not found")

        tenant_query = select(Tenant).where(Tenant.tenant_id == workspace.tenant_id)
        if lock_tenant:
            tenant_query = tenant_query.with_for_update()
        tenant = self.db.scalar(tenant_query)
        if tenant is None:
            raise NotFoundError("Tenant not found")
        if tenant.status != "active":
            raise TenantInactive("Tenant is inactive")

        tenant_member = self._tenant_member(tenant.tenant_id, actor.user_id)
        workspace_member = self._workspace_member(workspace_id, actor.user_id)
        if tenant_member is None or tenant_member.status != "active":
            raise MembershipInactive("Tenant membership is inactive")
        if workspace_member is None or workspace_member.status != "active":
            raise WorkspaceMembershipRequired("Workspace membership is inactive")
        return _WorkspaceAccess(workspace, tenant, tenant_member, workspace_member)

    def _tenant(self, tenant_id: int, *, lock: bool = False) -> Tenant:
        query = select(Tenant).where(Tenant.tenant_id == tenant_id)
        if lock:
            query = query.with_for_update()
        tenant = self.db.scalar(query)
        if tenant is None:
            raise NotFoundError("Tenant not found")
        return tenant

    def _tenant_member(self, tenant_id: int, user_id: int) -> TenantMember | None:
        return self.db.scalar(
            select(TenantMember).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.user_id == user_id,
            )
        )

    def _workspace_member(
        self,
        workspace_id: int,
        user_id: int,
        *,
        tenant_id: int | None = None,
        lock: bool = False,
    ) -> WorkspaceMember | None:
        conditions = [
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        ]
        if tenant_id is not None:
            conditions.append(WorkspaceMember.tenant_id == tenant_id)
        query = select(WorkspaceMember).where(*conditions)
        if lock:
            query = query.with_for_update()
        return self.db.scalar(query)

    def _owner_count(self, workspace_id: int, *, except_user_id: int | None = None) -> int:
        query = (
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.status == "active",
                WorkspaceMember.workspace_role == "owner",
            )
        )
        if except_user_id is not None:
            query = query.where(WorkspaceMember.user_id != except_user_id)
        return self.db.scalar(query) or 0

    def _reject_archived_for_regular_member(self, access: _WorkspaceAccess) -> None:
        if access.workspace.status == "archived" and access.workspace_member.workspace_role not in {
            "owner",
            "admin",
        }:
            raise WorkspaceInactive("Workspace is inactive")

    def _result(
        self,
        workspace: Workspace,
        role: str | None,
        tenant: Tenant,
    ) -> WorkspaceResult:
        return WorkspaceResult(
            workspace_id=str(workspace.workspace_id),
            tenant_id=str(workspace.tenant_id),
            slug=workspace.slug,
            name=workspace.name,
            icon=workspace.icon,
            status=workspace.status,
            settings=json.loads(workspace.settings_json or "{}"),
            workspace_role=role,
            membership_version=tenant.membership_version,
            created_by=str(workspace.created_by),
            created_at=workspace.created_at,
            updated_at=workspace.updated_at,
        )

    def _member_result(
        self,
        member: WorkspaceMember,
        account: User,
    ) -> WorkspaceMemberResult:
        return WorkspaceMemberResult(
            user_id=str(member.user_id),
            user_name=account.user_name,
            nick_name=account.nick_name,
            email=account.email,
            status=member.status,
            workspace_role=member.workspace_role,
            joined_at=member.joined_at,
            created_at=member.created_at,
            updated_at=member.updated_at,
        )

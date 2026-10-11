"""Application service for tenant invitation lifecycle."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.security import password_hash
from app.models.tenant import Tenant, TenantInvitation, TenantMember
from app.models.user import User
from app.schemas.tenant_invitations import (
    InvitationAccept,
    InvitationCreate,
    InvitationRegister,
)
from app.services.errors import (
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from app.services.results import ActorContext


class TenantInactive(ConflictError):
    code = "TENANT_INACTIVE"


class AccountInactive(ForbiddenError):
    code = "ACCOUNT_INACTIVE"


class AlreadyTenantMember(ConflictError):
    code = "ALREADY_TENANT_MEMBER"


class InvitationPending(ConflictError):
    code = "INVITATION_PENDING"


class InvitationNotFound(NotFoundError):
    code = "INVITATION_NOT_FOUND"


class InvitationNotPending(ConflictError):
    code = "INVITATION_NOT_PENDING"


class InvitationRequiresExistingAccount(ConflictError):
    code = "INVITATION_REQUIRES_EXISTING_ACCOUNT"


class InvitationTargetMismatch(ForbiddenError):
    code = "INVITATION_TARGET_MISMATCH"


class AccountConflict(ConflictError):
    code = "ACCOUNT_CONFLICT"


class TargetUserUnavailable(DomainValidationError):
    code = "VALIDATION_ERROR"


@dataclass(frozen=True)
class InvitationResult:
    invitation_id: str
    tenant_id: str
    email: str | None
    target_user_id: str | None
    tenant_role: str
    status: str
    expired: bool
    expires_at: datetime
    invited_by: str
    created_at: datetime


@dataclass(frozen=True)
class CreatedInvitationResult:
    invitation: InvitationResult
    token: str


@dataclass(frozen=True)
class InvitationListResult:
    items: tuple[InvitationResult, ...]


@dataclass(frozen=True)
class RegisteredUserResult:
    user_id: str
    user_name: str
    nick_name: str | None
    email: str | None
    phonenumber: str | None
    sex: str | None
    avatar: str | None
    status: str
    platform_role: str | None


@dataclass(frozen=True)
class TenantMembershipResult:
    tenant_id: str
    user_id: str
    status: str
    tenant_role: str
    joined_at: datetime
    workspace_memberships_created: int


@dataclass(frozen=True)
class InvitationRegistrationResult:
    user: RegisteredUserResult
    membership: TenantMembershipResult
    token_version: int


@dataclass(frozen=True)
class InvitationExpiredResult:
    """A committed terminal state transition that maps to HTTP 410."""

    code: str = "INVITATION_EXPIRED"
    detail: str = "Invitation has expired"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class TenantInvitationService:
    """Business use cases for issuing, revoking, and claiming invitations."""

    def __init__(self, db: Session):
        self.db = db

    def create_invitation(
        self,
        tenant_id: int,
        body: InvitationCreate,
        actor: ActorContext,
    ) -> CreatedInvitationResult:
        tenant, actor_membership = self._authorized_tenant(
            tenant_id,
            actor.user_id,
            {"owner", "admin"},
        )
        if tenant.status != "active":
            raise TenantInactive("Tenant is inactive")
        if actor_membership.tenant_role == "admin" and body.tenant_role != "member":
            raise ForbiddenError("Tenant admins can only invite members")

        target: User | None = None
        email = body.email
        if body.user_id is not None:
            target = self.db.get(User, int(body.user_id))
            if not target or target.del_flag or target.status != "active":
                raise TargetUserUnavailable("Invitation target is unavailable")
            email = target.email.strip().lower() if target.email else None
        elif email is not None:
            target = self.db.scalar(
                select(User).where(
                    func.lower(User.email) == email,
                    User.del_flag.is_(False),
                )
            )
            if target and target.status != "active":
                raise AccountInactive("Invitation target account is inactive")

        if target:
            existing = self.db.scalar(
                select(TenantMember).where(
                    TenantMember.tenant_id == tenant_id,
                    TenantMember.user_id == target.user_id,
                )
            )
            if existing and existing.status == "active":
                raise AlreadyTenantMember("User is already a tenant member")

        now = _now()
        destination_clause = (
            TenantInvitation.target_user_id == target.user_id
            if target
            else TenantInvitation.email == email
        )
        pending = self.db.scalar(
            select(TenantInvitation).where(
                TenantInvitation.tenant_id == tenant_id,
                TenantInvitation.status == "pending",
                TenantInvitation.expires_at > now,
                destination_clause,
            )
        )
        if pending:
            raise InvitationPending("An equivalent invitation is pending")

        token = secrets.token_urlsafe(32)
        invitation = TenantInvitation(
            tenant_id=tenant_id,
            email=email,
            target_user_id=target.user_id if target else None,
            tenant_role=body.tenant_role,
            token_hash=_digest(token),
            status="pending",
            expires_at=now + timedelta(hours=body.expires_in_hours),
            invited_by=actor.user_id,
            created_at=now,
        )
        self.db.add(invitation)
        self.db.flush()
        self.db.refresh(invitation)
        return CreatedInvitationResult(
            invitation=self._invitation_result(invitation),
            token=token,
        )

    def list_invitations(
        self,
        tenant_id: int,
        actor: ActorContext,
    ) -> InvitationListResult:
        self._authorized_tenant(tenant_id, actor.user_id, {"owner", "admin"})
        invitations = self.db.scalars(
            select(TenantInvitation)
            .where(
                TenantInvitation.tenant_id == tenant_id,
                TenantInvitation.status == "pending",
            )
            .order_by(TenantInvitation.invitation_id.desc())
        ).all()
        return InvitationListResult(
            items=tuple(
                self._invitation_result(invitation) for invitation in invitations
            )
        )

    def revoke_invitation(
        self,
        tenant_id: int,
        invitation_id: int,
        actor: ActorContext,
    ) -> None:
        self._authorized_tenant(tenant_id, actor.user_id, {"owner", "admin"})
        invitation = self.db.scalar(
            select(TenantInvitation)
            .where(
                TenantInvitation.tenant_id == tenant_id,
                TenantInvitation.invitation_id == invitation_id,
            )
            .with_for_update()
        )
        if invitation is None:
            raise NotFoundError("Invitation not found")
        if invitation.status != "pending":
            raise InvitationNotPending("Invitation is not pending")
        invitation.status = "revoked"
        invitation.revoked_at = _now()
        self.db.flush()

    def register_and_accept(
        self, body: InvitationRegister
    ) -> InvitationRegistrationResult | InvitationExpiredResult:
        """Register only the recipient named by a live unbound email invitation."""

        now = _now()
        invitation = self._invitation_by_token(body.token)
        if invitation.status != "pending":
            raise InvitationNotPending("Invitation is not pending")
        if self._mark_expired(invitation, now):
            return InvitationExpiredResult()

        if not invitation.email or invitation.target_user_id is not None:
            raise InvitationRequiresExistingAccount(
                "Invitation is bound to an existing account"
            )

        tenant = self.db.scalar(
            select(Tenant)
            .where(Tenant.tenant_id == invitation.tenant_id)
            .with_for_update()
        )
        if tenant is None:
            raise NotFoundError("Tenant not found")
        if tenant.status != "active":
            raise TenantInactive("Tenant is inactive")

        email = invitation.email.strip().lower()
        # Never create a second global identity for an existing email, including
        # disabled or soft-deleted accounts; those must use their existing account.
        existing_user = self.db.scalar(
            select(User).where(func.lower(User.email) == email)
        )
        if existing_user is not None:
            if existing_user.del_flag or existing_user.status != "active":
                raise AccountInactive("Existing account is inactive")
            raise InvitationRequiresExistingAccount(
                "Invitation is bound to an existing account"
            )

        self._claim_invitation(invitation, now)

        user = User(
            user_name=body.user_name,
            nick_name=body.nick_name,
            email=email,
            password_hash=password_hash(body.password),
            status="active",
            del_flag=False,
            platform_role="user",
            token_version=0,
            created_at=now,
            updated_at=now,
        )
        self.db.add(user)
        try:
            self.db.flush()
            self.db.add(
                TenantMember(
                    tenant_id=invitation.tenant_id,
                    user_id=user.user_id,
                    status="active",
                    tenant_role=invitation.tenant_role,
                    joined_at=now,
                    created_at=now,
                    updated_at=now,
                )
            )
            self.db.execute(
                update(TenantInvitation)
                .where(
                    TenantInvitation.invitation_id == invitation.invitation_id,
                    TenantInvitation.status == "accepted",
                )
                .values(accepted_by=user.user_id)
            )
            self.db.execute(
                update(Tenant)
                .where(Tenant.tenant_id == tenant.tenant_id)
                .values(membership_version=Tenant.membership_version + 1)
            )
            self.db.flush()
        except IntegrityError as exc:
            raise AccountConflict("Account fields conflict with an existing user") from exc

        return InvitationRegistrationResult(
            user=self._user_result(user),
            membership=TenantMembershipResult(
                tenant_id=str(tenant.tenant_id),
                user_id=str(user.user_id),
                status="active",
                tenant_role=invitation.tenant_role,
                joined_at=now,
                workspace_memberships_created=0,
            ),
            token_version=user.token_version,
        )

    def accept_invitation(
        self,
        body: InvitationAccept,
        actor: User,
    ) -> TenantMembershipResult | InvitationExpiredResult:
        now = _now()
        invitation = self._invitation_by_token(body.token)
        if invitation.status != "pending":
            raise InvitationNotPending("Invitation is not pending")
        if self._mark_expired(invitation, now):
            return InvitationExpiredResult()

        tenant = self.db.get(Tenant, invitation.tenant_id)
        if tenant is None:
            raise NotFoundError("Tenant not found")
        if tenant.status != "active":
            raise TenantInactive("Tenant is inactive")
        if actor.status != "active" or actor.del_flag:
            raise AccountInactive("Account is inactive")
        if invitation.target_user_id is not None:
            if invitation.target_user_id != actor.user_id:
                raise InvitationTargetMismatch("Invitation belongs to another user")
        elif not actor.email or actor.email.strip().lower() != (
            invitation.email or ""
        ).lower():
            raise InvitationTargetMismatch("Invitation belongs to another email")

        membership = self.db.scalar(
            select(TenantMember)
            .where(
                TenantMember.tenant_id == invitation.tenant_id,
                TenantMember.user_id == actor.user_id,
            )
            .with_for_update()
        )
        if membership and membership.status == "active":
            raise AlreadyTenantMember("User is already a tenant member")

        self._claim_invitation(invitation, now, accepted_by=actor.user_id)

        if membership:
            membership.status = "active"
            membership.tenant_role = invitation.tenant_role
            membership.joined_at = now
            membership.updated_at = now
        else:
            membership = TenantMember(
                tenant_id=invitation.tenant_id,
                user_id=actor.user_id,
                status="active",
                tenant_role=invitation.tenant_role,
                joined_at=now,
                created_at=now,
                updated_at=now,
            )
            self.db.add(membership)
        tenant.membership_version += 1
        self.db.flush()
        self.db.refresh(membership)
        return TenantMembershipResult(
            tenant_id=str(tenant.tenant_id),
            user_id=str(actor.user_id),
            status=membership.status,
            tenant_role=membership.tenant_role,
            joined_at=_aware(membership.joined_at),
            workspace_memberships_created=0,
        )

    def _authorized_tenant(
        self,
        tenant_id: int,
        user_id: int,
        roles: set[str],
    ) -> tuple[Tenant, TenantMember]:
        tenant = self.db.get(Tenant, tenant_id)
        if tenant is None:
            raise NotFoundError("Tenant not found")
        membership = self.db.scalar(
            select(TenantMember).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.user_id == user_id,
            )
        )
        if (
            not membership
            or membership.status != "active"
            or membership.tenant_role not in roles
        ):
            raise ForbiddenError("Tenant invitation management is forbidden")
        return tenant, membership

    def _invitation_by_token(self, token: str) -> TenantInvitation:
        invitation = self.db.scalar(
            select(TenantInvitation)
            .where(TenantInvitation.token_hash == _digest(token))
            .with_for_update()
        )
        if invitation is None:
            raise InvitationNotFound("Invitation not found")
        return invitation

    def _mark_expired(self, invitation: TenantInvitation, now: datetime) -> bool:
        if _aware(invitation.expires_at) <= now:
            invitation.status = "expired"
            self.db.flush()
            return True
        return False

    def _claim_invitation(
        self,
        invitation: TenantInvitation,
        now: datetime,
        *,
        accepted_by: int | None = None,
    ) -> None:
        values = {"status": "accepted", "accepted_at": now}
        if accepted_by is not None:
            values["accepted_by"] = accepted_by
        # Keep the conditional UPDATE as the cross-process one-time gate. SQLite
        # returns naive timestamps, so ORM predicate evaluation must be disabled.
        claim = (
            update(TenantInvitation)
            .where(
                TenantInvitation.invitation_id == invitation.invitation_id,
                TenantInvitation.status == "pending",
                TenantInvitation.expires_at > now,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        if self.db.execute(claim).rowcount != 1:
            raise InvitationNotPending("Invitation is not pending")

    def _invitation_result(self, invitation: TenantInvitation) -> InvitationResult:
        expires_at = _aware(invitation.expires_at)
        return InvitationResult(
            invitation_id=str(invitation.invitation_id),
            tenant_id=str(invitation.tenant_id),
            email=invitation.email,
            target_user_id=(
                str(invitation.target_user_id)
                if invitation.target_user_id is not None
                else None
            ),
            tenant_role=invitation.tenant_role,
            status=invitation.status,
            expired=expires_at <= _now(),
            expires_at=expires_at,
            invited_by=str(invitation.invited_by),
            created_at=_aware(invitation.created_at),
        )

    def _user_result(self, user: User) -> RegisteredUserResult:
        return RegisteredUserResult(
            user_id=str(user.user_id),
            user_name=user.user_name,
            nick_name=user.nick_name,
            email=user.email,
            phonenumber=user.phonenumber,
            sex=user.sex,
            avatar=user.avatar,
            status=user.status,
            platform_role=user.platform_role,
        )

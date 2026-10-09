"""Tenant invitation lifecycle. No mail delivery is performed here."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.security import issue_token, password_hash
from app.database.session import get_db
from app.models.tenant import Tenant, TenantInvitation, TenantMember
from app.models.user import User

router = APIRouter(tags=["tenant invitations"])


class InvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str | None = Field(default=None, max_length=254)
    user_id: str | None = Field(default=None, pattern=r"^[0-9]+$")
    tenant_role: str = Field(default="member", pattern="^(admin|member)$")
    expires_in_hours: int = Field(default=168, ge=1, le=720)

    @model_validator(mode="after")
    def exactly_one_target(self):
        if (self.email is None) == (self.user_id is None):
            raise ValueError("Provide exactly one of email or user_id")
        if self.email is not None:
            self.email = self.email.strip().lower()
            if not self.email or "@" not in self.email or len(self.email) > 254:
                raise ValueError("A valid email address is required")
        return self


class InvitationAccept(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=256)


class InvitationRegister(BaseModel):
    """Create an account only through an unbound email invitation."""
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=256)
    user_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=256)
    nick_name: str = Field(default="", max_length=100)

    @field_validator("user_name")
    @classmethod
    def username_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Username cannot be blank")
        return value


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _fail(status: int, code: str):
    raise HTTPException(status_code=status, detail={"code": code})


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user_data(user: User) -> dict:
    return {
        "user_id": str(user.user_id), "user_name": user.user_name,
        "nick_name": user.nick_name, "email": user.email,
        "phonenumber": user.phonenumber, "sex": user.sex,
        "avatar": user.avatar, "status": user.status,
        "platform_role": user.platform_role,
    }


def _expire_if_needed(invitation: TenantInvitation, now: datetime, db: Session) -> None:
    if _aware(invitation.expires_at) <= now:
        invitation.status = "expired"
        db.commit()
        _fail(410, "INVITATION_EXPIRED")


def _authorized_tenant(db: Session, tenant_id: int, user: User, roles: set[str]) -> tuple[Tenant, TenantMember]:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    membership = db.scalar(select(TenantMember).where(
        TenantMember.tenant_id == tenant_id, TenantMember.user_id == user.user_id))
    if not membership or membership.status != "active" or membership.tenant_role not in roles:
        _fail(403, "FORBIDDEN")
    return tenant, membership


def _invitation_data(invitation: TenantInvitation) -> dict:
    expires = _aware(invitation.expires_at)
    return {
        "invitation_id": str(invitation.invitation_id),
        "tenant_id": str(invitation.tenant_id),
        "email": invitation.email,
        "target_user_id": str(invitation.target_user_id) if invitation.target_user_id is not None else None,
        "tenant_role": invitation.tenant_role,
        "status": invitation.status,
        "expired": expires <= _now(),
        "expires_at": expires.isoformat(),
        "invited_by": str(invitation.invited_by),
        "created_at": _aware(invitation.created_at).isoformat(),
    }


@router.post("/tenants/{tenant_id}/invitations", status_code=201)
def create_invitation(tenant_id: int, body: InvitationCreate,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant, actor_membership = _authorized_tenant(db, tenant_id, user, {"owner", "admin"})
    if tenant.status != "active":
        _fail(409, "TENANT_INACTIVE")
    if actor_membership.tenant_role == "admin" and body.tenant_role != "member":
        _fail(403, "FORBIDDEN")

    target: User | None = None
    email = body.email
    if body.user_id is not None:
        target = db.get(User, int(body.user_id))
        if not target or target.del_flag or target.status != "active":
            _fail(422, "VALIDATION_ERROR")
        email = target.email.strip().lower() if target.email else None
    elif email is not None:
        target = db.scalar(select(User).where(func.lower(User.email) == email, User.del_flag.is_(False)))
        if target and target.status != "active":
            _fail(409, "ACCOUNT_INACTIVE")

    if target:
        existing = db.scalar(select(TenantMember).where(
            TenantMember.tenant_id == tenant_id, TenantMember.user_id == target.user_id))
        if existing and existing.status == "active":
            _fail(409, "ALREADY_TENANT_MEMBER")

    now = _now()
    destination_clause = (TenantInvitation.target_user_id == target.user_id) if target else (
        TenantInvitation.email == email)
    pending = db.scalar(select(TenantInvitation).where(
        TenantInvitation.tenant_id == tenant_id, TenantInvitation.status == "pending",
        TenantInvitation.expires_at > now, destination_clause))
    if pending:
        _fail(409, "INVITATION_PENDING")

    token = secrets.token_urlsafe(32)
    invitation = TenantInvitation(
        tenant_id=tenant_id, email=email, target_user_id=target.user_id if target else None,
        tenant_role=body.tenant_role, token_hash=_digest(token), status="pending",
        expires_at=now + timedelta(hours=body.expires_in_hours), invited_by=user.user_id,
        created_at=now,
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    return {**_invitation_data(invitation), "token": token,
            "invite_link": f"/invite/accept?token={quote(token)}"}


@router.get("/tenants/{tenant_id}/invitations")
def list_invitations(tenant_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _authorized_tenant(db, tenant_id, user, {"owner", "admin"})
    invitations = db.scalars(select(TenantInvitation).where(
        TenantInvitation.tenant_id == tenant_id, TenantInvitation.status == "pending"
    ).order_by(TenantInvitation.invitation_id.desc())).all()
    return {"items": [_invitation_data(invitation) for invitation in invitations]}


@router.delete("/tenants/{tenant_id}/invitations/{invitation_id}", status_code=204)
def revoke_invitation(tenant_id: int, invitation_id: int, user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    _authorized_tenant(db, tenant_id, user, {"owner", "admin"})
    invitation = db.scalar(select(TenantInvitation).where(
        TenantInvitation.tenant_id == tenant_id,
        TenantInvitation.invitation_id == invitation_id).with_for_update())
    if invitation is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    if invitation.status != "pending":
        _fail(409, "INVITATION_NOT_PENDING")
    invitation.status = "revoked"
    invitation.revoked_at = _now()
    db.commit()
    return None


@router.post("/tenant-invitations/register-and-accept", status_code=201)
def register_and_accept_invitation(body: InvitationRegister, response: Response,
                                   db: Session = Depends(get_db)):
    """Register only the email recipient named by a live tenant invitation.

    The new global User, tenant membership, invitation claim and membership
    version change are committed as one transaction. No body-supplied email
    or tenant ID is accepted: both are derived from the unguessable token.
    """
    now = _now()
    invitation = db.scalar(select(TenantInvitation).where(
        TenantInvitation.token_hash == _digest(body.token),
    ).with_for_update())
    if invitation is None:
        _fail(404, "INVITATION_NOT_FOUND")
    if invitation.status != "pending":
        _fail(409, "INVITATION_NOT_PENDING")
    _expire_if_needed(invitation, now, db)

    # Registration is only for email invitations that were not already pinned
    # to an existing account. Existing-account invitations must use the normal
    # authenticated acceptance path.
    if not invitation.email or invitation.target_user_id is not None:
        _fail(409, "INVITATION_REQUIRES_EXISTING_ACCOUNT")

    tenant = db.scalar(select(Tenant).where(
        Tenant.tenant_id == invitation.tenant_id,
    ).with_for_update())
    if tenant is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    if tenant.status != "active":
        _fail(409, "TENANT_INACTIVE")

    email = invitation.email.strip().lower()
    # Never create a second global identity for an email address already in
    # use, including a disabled or soft-deleted account. That account must
    # authenticate through the existing path or be handled by an administrator.
    existing_user = db.scalar(select(User).where(
        func.lower(User.email) == email,
    ))
    if existing_user is not None:
        if existing_user.del_flag or existing_user.status != "active":
            _fail(403, "ACCOUNT_INACTIVE")
        _fail(409, "INVITATION_REQUIRES_EXISTING_ACCOUNT")

    # Claim in SQL (rather than Python-side ORM synchronization): this compare
    # is the cross-process one-time gate, also when SQLite drops timezone info.
    claim = update(TenantInvitation).where(
        TenantInvitation.invitation_id == invitation.invitation_id,
        TenantInvitation.status == "pending",
        TenantInvitation.expires_at > now,
    ).values(status="accepted", accepted_at=now)
    claimed = db.execute(claim.execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        _fail(409, "INVITATION_NOT_PENDING")

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
    db.add(user)
    try:
        db.flush()
        db.add(TenantMember(
            tenant_id=invitation.tenant_id,
            user_id=user.user_id,
            status="active",
            tenant_role=invitation.tenant_role,
            joined_at=now,
            created_at=now,
            updated_at=now,
        ))
        db.execute(update(TenantInvitation).where(
            TenantInvitation.invitation_id == invitation.invitation_id,
            TenantInvitation.status == "accepted",
        ).values(accepted_by=user.user_id))
        db.execute(update(Tenant).where(
            Tenant.tenant_id == tenant.tenant_id,
        ).values(membership_version=Tenant.membership_version + 1))
        db.commit()
    except IntegrityError as exc:
        # A concurrent signup may win a unique username/email race. Rolling
        # back also restores the invitation to pending; no partial account or
        # membership is left behind.
        db.rollback()
        raise HTTPException(409, detail={"code": "ACCOUNT_CONFLICT"}) from exc

    db.refresh(user)
    access_token = issue_token(user.user_id, user.token_version)
    response.set_cookie(
        "synapse_session", access_token,
        httponly=True, secure=True, samesite="lax", max_age=3600,
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _user_data(user),
        "tenant": {
            "tenant_id": str(tenant.tenant_id),
            "user_id": str(user.user_id),
            "status": "active",
            "tenant_role": invitation.tenant_role,
            "joined_at": now.isoformat(),
            "workspace_memberships_created": 0,
        },
    }


@router.post("/tenant-invitations/accept")
def accept_invitation(body: InvitationAccept, user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    now = _now()
    digest = _digest(body.token)
    invitation = db.scalar(select(TenantInvitation).where(
        TenantInvitation.token_hash == digest).with_for_update())
    if invitation is None:
        _fail(404, "INVITATION_NOT_FOUND")
    if invitation.status != "pending":
        _fail(409, "INVITATION_NOT_PENDING")
    if _aware(invitation.expires_at) <= now:
        invitation.status = "expired"
        db.commit()
        _fail(410, "INVITATION_EXPIRED")

    tenant = db.get(Tenant, invitation.tenant_id)
    if tenant is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    if tenant.status != "active":
        _fail(409, "TENANT_INACTIVE")
    if user.status != "active" or user.del_flag:
        _fail(403, "ACCOUNT_INACTIVE")
    if invitation.target_user_id is not None:
        if invitation.target_user_id != user.user_id:
            _fail(403, "INVITATION_TARGET_MISMATCH")
    elif not user.email or user.email.strip().lower() != (invitation.email or "").lower():
        _fail(403, "INVITATION_TARGET_MISMATCH")

    membership = db.scalar(select(TenantMember).where(
        TenantMember.tenant_id == invitation.tenant_id, TenantMember.user_id == user.user_id).with_for_update())
    if membership and membership.status == "active":
        _fail(409, "ALREADY_TENANT_MEMBER")

    # Claim the token atomically before changing membership; only one concurrent
    # acceptor can transition a pending invitation to accepted.
    claim_statement = update(TenantInvitation).where(
        TenantInvitation.invitation_id == invitation.invitation_id,
        TenantInvitation.status == "pending", TenantInvitation.expires_at > now,
    ).values(status="accepted", accepted_by=user.user_id, accepted_at=now)
    # SQLite returns timezone-naive values for DateTime(timezone=True). The
    # default "evaluate" synchronizer compares loaded expires_at to aware UTC
    # `now` in Python and raises TypeError. Keep the conditional UPDATE as the
    # atomic claim, without evaluating its predicate against ORM objects.
    claim_statement = claim_statement.execution_options(
        synchronize_session=False,
    )
    claimed = db.execute(claim_statement)
    if claimed.rowcount != 1:
        db.rollback()
        _fail(409, "INVITATION_NOT_PENDING")

    if membership:
        membership.status = "active"
        membership.tenant_role = invitation.tenant_role
        membership.joined_at = now
        membership.updated_at = now
    else:
        membership = TenantMember(tenant_id=invitation.tenant_id, user_id=user.user_id,
                                  status="active", tenant_role=invitation.tenant_role,
                                  joined_at=now, created_at=now, updated_at=now)
        db.add(membership)
    tenant.membership_version += 1
    db.commit()
    db.refresh(membership)
    return {"tenant_id": str(tenant.tenant_id), "user_id": str(user.user_id),
            "status": membership.status, "tenant_role": membership.tenant_role,
            "joined_at": _aware(membership.joined_at).isoformat(),
            "workspace_memberships_created": 0}

"""Tenant-owner/admin APIs for assigning one custom role to a tenant member."""
import json
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant import Tenant, TenantMember
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole
from app.models.user import User
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/members/{user_id}/custom-role", tags=["tenant member roles"])


class RoleAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role_id: str = Field(pattern=r"^[1-9][0-9]*$")


def _fail(status: int, code: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code})


def _authorize(context: TenantContext) -> None:
    # Only built-in tenant owners/admins may assign roles. A custom permission
    # grant must never delegate this authority.
    if context.tenant_role not in {"owner", "admin"}:
        _fail(403, "FORBIDDEN")


def _authorize_read(context: TenantContext, user_id: int) -> None:
    # Active ordinary members may inspect only their own assignment. This is
    # read-only self-service; it never grants access to another member or
    # delegates assignment/revocation authority.
    if context.tenant_role in {"owner", "admin"}:
        return
    if context.tenant_role == "member" and context.actor_user_id == user_id:
        return
    _fail(403, "FORBIDDEN")


def _member(db: Session, context: TenantContext, user_id: int, *, lock: bool = False) -> TenantMember:
    statement = tenant_scope(
        select(TenantMember).where(TenantMember.user_id == user_id), TenantMember, context,
    )
    if lock:
        statement = statement.with_for_update()
    membership = db.scalar(statement)
    if membership is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    if membership.status != "active":
        _fail(409, "MEMBERSHIP_INACTIVE")
    user = db.scalar(select(User).where(User.user_id == user_id))
    if user is None or user.status != "active" or user.del_flag:
        _fail(409, "USER_INACTIVE")
    if membership.tenant_role in {"owner", "admin"}:
        _fail(409, "BUILTIN_ROLE_PROTECTED")
    if membership.tenant_role != "member":
        _fail(409, "MEMBERSHIP_ROLE_UNSUPPORTED")
    return membership


def _assignment(db: Session, context: TenantContext, user_id: int) -> TenantMemberRole | None:
    statement = tenant_scope(
        select(TenantMemberRole).where(TenantMemberRole.user_id == user_id),
        TenantMemberRole,
        context,
    )
    return db.scalar(statement)


def _role(db: Session, context: TenantContext, role_id: int, *, lock: bool = False) -> TenantRole:
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
    role = db.scalar(statement)
    if role is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return role


def _advance_version(db: Session, tenant_id: int) -> None:
    db.execute(update(Tenant).where(Tenant.tenant_id == tenant_id).values(
        membership_version=Tenant.membership_version + 1,
    ))


def _iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _response(assignment: TenantMemberRole | None, role: TenantRole | None) -> dict:
    if assignment is None or role is None:
        return {"user_id": None if assignment is None else str(assignment.user_id), "role": None}
    return {
        "user_id": str(assignment.user_id),
        "role": {
            "role_id": str(role.role_id),
            "tenant_id": str(role.tenant_id),
            "role_name": role.role_name,
            "role_key": role.role_key,
            "status": role.status,
            "permissions": json.loads(role.permissions_json or "[]"),
        },
        "assigned_by": str(assignment.assigned_by),
        "assigned_at": _iso(assignment.assigned_at),
    }


@router.get("")
def get_member_custom_role(
    user_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize_read(context, user_id)
    _member(db, context, user_id)
    assignment = _assignment(db, context, user_id)
    if assignment is None:
        return {"user_id": str(user_id), "role": None}
    # Disabled/deleted definitions immediately lose their grants and appear
    # unassigned for effective authorization purposes.
    role = db.scalar(tenant_scope(
        select(TenantRole).where(
            TenantRole.role_id == assignment.role_id,
            TenantRole.status == "active",
            TenantRole.del_flag.is_(False),
        ), TenantRole, context,
    ))
    if role is None:
        return {"user_id": str(user_id), "role": None}
    return _response(assignment, role)


@router.put("", status_code=200)
def assign_member_custom_role(
    body: RoleAssignment,
    user_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    _member(db, context, user_id, lock=True)
    role = _role(db, context, int(body.role_id), lock=True)
    assignment = _assignment(db, context, user_id)
    if assignment is not None and assignment.role_id == role.role_id:
        return _response(assignment, role)
    if assignment is None:
        assignment = TenantMemberRole(
            tenant_id=context.tenant_id,
            user_id=user_id,
            role_id=role.role_id,
            assigned_by=context.actor_user_id,
        )
        db.add(assignment)
    else:
        assignment.role_id = role.role_id
        assignment.assigned_by = context.actor_user_id
        from app.models.user import utcnow
        assignment.assigned_at = utcnow()
    _advance_version(db, context.tenant_id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Concurrent retries assigning the same role are semantically
        # idempotent even when the unique member constraint wins the race.
        current = _assignment(db, context, user_id)
        if current is not None and current.role_id == role.role_id:
            return _response(current, role)
        raise HTTPException(409, detail={"code": "ROLE_ASSIGNMENT_CONFLICT"}) from exc
    db.refresh(assignment)
    return _response(assignment, role)


@router.delete("", status_code=204)
def revoke_member_custom_role(
    user_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    _member(db, context, user_id, lock=True)
    assignment = _assignment(db, context, user_id)
    if assignment is not None:
        db.delete(assignment)
        _advance_version(db, context.tenant_id)
        db.commit()
    return Response(status_code=204)

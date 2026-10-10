import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, require_platform_admin
from app.database.session import get_db
from app.models.user import User
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember

router = APIRouter(tags=["tenants"])
SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class TenantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=1, max_length=64, pattern=SLUG)
    name: str = Field(min_length=1, max_length=120)
    first_owner_user_id: str = Field(pattern=r"^[0-9]+$")
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class TenantPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = Field(default=None, pattern="^(active|suspended|archived)$")
    settings: dict | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str = Field(pattern=r"^[0-9]+$")
    tenant_role: str = Field(default="member", pattern="^(owner|admin|member)$")


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_role: str | None = Field(default=None, pattern="^(owner|admin|member)$")
    status: str | None = Field(default=None, pattern="^(active|suspended|removed)$")


def _now(): return datetime.now(timezone.utc)
def _problem(status: int, code: str): raise HTTPException(status, detail={"code": code})
def _tenant(db: Session, tenant_id: int) -> Tenant:
    row = db.get(Tenant, tenant_id)
    if not row: _problem(404, "RESOURCE_NOT_FOUND")
    return row
def _member(db: Session, tenant_id: int, user_id: int) -> TenantMember | None:
    return db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_id, TenantMember.user_id == user_id))
def _role(db: Session, tenant_id: int, user: User) -> str | None:
    row = _member(db, tenant_id, user.user_id)
    return row.tenant_role if row and row.status == "active" else None
def _require_role(db: Session, tenant_id: int, user: User, roles: set[str]) -> str:
    role = _role(db, tenant_id, user)
    if role not in roles: _problem(403, "FORBIDDEN")
    return role
def _iso(dt): return dt.isoformat() if dt else None
def _aware(dt: datetime | None) -> datetime | None:
    # SQLite may return naive datetimes; treat stored values as UTC so they
    # can be compared with tz-aware request payloads.
    if dt is None or dt.tzinfo is not None: return dt
    return dt.replace(tzinfo=timezone.utc)
def _validate_validity(valid_from: datetime | None, valid_until: datetime | None):
    a, b = _aware(valid_from), _aware(valid_until)
    if a and b and b <= a: _problem(422, "VALIDITY_RANGE")
def _tenant_data(t: Tenant, role: str | None = None):
    return {"tenant_id": str(t.tenant_id), "slug": t.slug, "name": t.name, "status": t.status,
            "valid_from": _iso(t.valid_from), "valid_until": _iso(t.valid_until),
            "settings": json.loads(t.settings_json or "{}"), "tenant_role": role,
            "membership_version": t.membership_version, "created_at": _iso(t.created_at), "updated_at": _iso(t.updated_at)}
def _workspace_data(w: Workspace, role: str):
    return {"workspace_id": str(w.workspace_id), "tenant_id": str(w.tenant_id), "slug": w.slug,
            "name": w.name, "icon": w.icon, "status": w.status, "workspace_role": role}
def _member_data(m: TenantMember, u: User):
    return {"user_id": str(u.user_id), "user_name": u.user_name, "nick_name": u.nick_name, "email": u.email,
            "status": m.status, "tenant_role": m.tenant_role, "joined_at": _iso(m.joined_at),
            "created_at": _iso(m.created_at), "updated_at": _iso(m.updated_at)}


@router.post("/tenants", status_code=201)
def create_tenant(body: TenantCreate, admin: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    owner_id = int(body.first_owner_user_id)
    owner = db.get(User, owner_id)
    if not owner or owner.del_flag or owner.status != "active": _problem(422, "VALIDATION_ERROR")
    _validate_validity(body.valid_from, body.valid_until)
    try:
        tenant = Tenant(slug=body.slug, name=body.name, status="active", valid_from=body.valid_from,
                        valid_until=body.valid_until, settings_json="{}", membership_version=1)
        db.add(tenant); db.flush()
        now = _now()
        db.add(TenantMember(tenant_id=tenant.tenant_id, user_id=owner_id, status="active", tenant_role="owner", joined_at=now))
        db.flush()
        workspace = Workspace(tenant_id=tenant.tenant_id, slug="default", name="默认空间", status="active", settings_json="{}", created_by=admin.user_id)
        db.add(workspace); db.flush()
        db.add(WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant.tenant_id, user_id=owner_id,
                               status="active", workspace_role="owner", joined_at=now))
        db.commit(); db.refresh(tenant)
        return {**_tenant_data(tenant, "owner"), "default_workspace": _workspace_data(workspace, "owner")}
    except IntegrityError as exc:
        db.rollback(); _problem(409, "SLUG_CONFLICT")


@router.get("/me/context")
def my_context(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Tenant, TenantMember).join(TenantMember, TenantMember.tenant_id == Tenant.tenant_id)
                      .where(TenantMember.user_id == user.user_id, TenantMember.status == "active", Tenant.status == "active")).all()
    tenants = []
    for tenant, member in rows:
        spaces = db.execute(select(Workspace, WorkspaceMember.workspace_role).join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.workspace_id)
                            .where(Workspace.tenant_id == tenant.tenant_id, Workspace.status == "active",
                                   WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.user_id == user.user_id,
                                   WorkspaceMember.status == "active")).all()
        tenants.append({**_tenant_data(tenant, member.tenant_role), "workspaces": [_workspace_data(w, role) for w, role in spaces]})
    return {"user": {"user_id": str(user.user_id), "user_name": user.user_name, "nick_name": user.nick_name},
            "tenants": tenants, "recent_workspace_id": None,
            "context_version": max([t.membership_version for t, _ in rows], default=0)}


@router.get("/tenants")
def list_tenants(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                 name: str | None = Query(default=None, max_length=120),
                 status: str | None = Query(default=None, pattern="^(active|suspended|archived)$"),
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = select(Tenant, TenantMember.tenant_role).join(TenantMember, TenantMember.tenant_id == Tenant.tenant_id).where(
        TenantMember.user_id == user.user_id, TenantMember.status == "active", Tenant.status == "active")
    if name:
        query = query.where(Tenant.name.ilike(f"%{name}%"))
    # Ordinary member listings never expose inactive tenants, even when an
    # inactive status is explicitly requested as a filter.
    if status and status != "active":
        query = query.where(Tenant.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(Tenant.tenant_id).offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    for tenant, role in rows:
        spaces = db.execute(select(Workspace, WorkspaceMember.workspace_role).join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.workspace_id)
                            .where(Workspace.tenant_id == tenant.tenant_id, Workspace.status == "active", WorkspaceMember.user_id == user.user_id,
                                   WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.status == "active")).all()
        items.append({**_tenant_data(tenant, role), "workspaces": [_workspace_data(w, r) for w, r in spaces]})
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/platform/tenants")
def platform_list_tenants(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(default=None, pattern="^(active|suspended|archived)$"),
    name: str | None = Query(default=None, max_length=120),
    admin: User = Depends(require_platform_admin), db: Session = Depends(get_db),
):
    """List tenants for platform operations without creating tenant membership."""
    query = select(Tenant)
    count_query = select(func.count()).select_from(Tenant)
    if status:
        query = query.where(Tenant.status == status)
        count_query = count_query.where(Tenant.status == status)
    if name:
        query = query.where(Tenant.name.ilike(f"%{name}%"))
        count_query = count_query.where(Tenant.name.ilike(f"%{name}%"))
    total = db.scalar(count_query) or 0
    rows = db.scalars(query.order_by(Tenant.tenant_id).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_tenant_data(tenant) for tenant in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/tenants/{tenant_id}")
def get_tenant(tenant_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant = _tenant(db, tenant_id)
    role = _role(db, tenant_id, user)
    if role is None and user.platform_role != "platform_admin": _problem(404, "RESOURCE_NOT_FOUND")
    return _tenant_data(tenant, role)


@router.patch("/tenants/{tenant_id}")
def patch_tenant(tenant_id: int, body: TenantPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant = _tenant(db, tenant_id); fields = body.model_dump(exclude_unset=True)
    role = _role(db, tenant_id, user)
    platform = user.platform_role == "platform_admin"
    if not platform and role not in {"owner", "admin"}: _problem(403, "FORBIDDEN")
    if "status" in fields and not platform: _problem(403, "FORBIDDEN")
    _validate_validity(fields.get("valid_from", tenant.valid_from), fields.get("valid_until", tenant.valid_until))
    for key, value in fields.items():
        setattr(tenant, "settings_json" if key == "settings" else key, json.dumps(value, ensure_ascii=False) if key == "settings" else value)
    tenant.updated_at = _now(); tenant.membership_version += int("status" in fields)
    db.commit(); db.refresh(tenant)
    return _tenant_data(tenant, role)


@router.get("/tenants/{tenant_id}/members")
def list_members(tenant_id: int, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _tenant(db, tenant_id); _require_role(db, tenant_id, user, {"owner", "admin", "member"})
    query = select(TenantMember, User).join(User, User.user_id == TenantMember.user_id).where(TenantMember.tenant_id == tenant_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(TenantMember.tenant_member_id).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_member_data(m, u) for m, u in rows], "total": total, "page": page, "page_size": page_size}


@router.post("/tenants/{tenant_id}/members", status_code=201)
def add_member(tenant_id: int, body: MemberCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _tenant(db, tenant_id); actor_role = _require_role(db, tenant_id, user, {"owner", "admin"})
    if body.tenant_role == "owner" and actor_role != "owner": _problem(403, "FORBIDDEN")
    target = db.get(User, int(body.user_id))
    if not target or target.del_flag or target.status != "active": _problem(422, "VALIDATION_ERROR")
    m = _member(db, tenant_id, target.user_id); now = _now()
    if m:
        if m.status == "active": _problem(409, "MEMBERSHIP_EXISTS")
        if body.tenant_role == "owner" and actor_role != "owner": _problem(403, "FORBIDDEN")
        m.status = "active"; m.tenant_role = body.tenant_role; m.joined_at = now; m.updated_at = now
    else:
        m = TenantMember(tenant_id=tenant_id, user_id=target.user_id, status="active", tenant_role=body.tenant_role, joined_at=now)
        db.add(m)
    tenant = _tenant(db, tenant_id); tenant.membership_version += 1
    # Rejoining never revives previously revoked workspace access.
    db.commit(); db.refresh(m)
    return _member_data(m, target)


@router.patch("/tenants/{tenant_id}/members/{user_id}")
def patch_member(tenant_id: int, user_id: int, body: MemberPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_id == tenant_id).with_for_update())
    if not tenant: _problem(404, "RESOURCE_NOT_FOUND")
    actor_role = _require_role(db, tenant_id, user, {"owner", "admin"})
    target = _member(db, tenant_id, user_id)
    if not target: _problem(404, "RESOURCE_NOT_FOUND")
    fields = body.model_dump(exclude_unset=True)
    if target.tenant_role == "owner" and actor_role != "owner": _problem(403, "FORBIDDEN")
    if fields.get("tenant_role") == "owner" and actor_role != "owner": _problem(403, "FORBIDDEN")
    if fields.get("status") in {"removed", "suspended"} and target.tenant_role == "owner":
        other_owners = db.scalar(select(func.count()).select_from(TenantMember).where(
            TenantMember.tenant_id == tenant_id, TenantMember.tenant_role == "owner", TenantMember.status == "active",
            TenantMember.user_id != user_id)) or 0
        if not other_owners: _problem(409, "LAST_OWNER_REQUIRED")
    if fields.get("tenant_role") in {"admin", "member"} and target.tenant_role == "owner":
        other_owners = db.scalar(select(func.count()).select_from(TenantMember).where(
            TenantMember.tenant_id == tenant_id, TenantMember.tenant_role == "owner", TenantMember.status == "active",
            TenantMember.user_id != user_id)) or 0
        if not other_owners: _problem(409, "LAST_OWNER_REQUIRED")
    deactivating = fields.get("status") in {"removed", "suspended"} and target.status == "active"
    if deactivating:
        owned_spaces = db.scalars(select(WorkspaceMember).where(WorkspaceMember.tenant_id == tenant_id,
            WorkspaceMember.user_id == user_id, WorkspaceMember.status == "active", WorkspaceMember.workspace_role == "owner").with_for_update()).all()
        for membership in owned_spaces:
            another = db.scalar(select(func.count()).select_from(WorkspaceMember).where(
                WorkspaceMember.workspace_id == membership.workspace_id, WorkspaceMember.tenant_id == tenant_id,
                WorkspaceMember.status == "active", WorkspaceMember.workspace_role == "owner",
                WorkspaceMember.user_id != user_id)) or 0
            if another == 0: _problem(409, "LAST_OWNER_REQUIRED")
    old_status, old_role = target.status, target.tenant_role
    for k, v in fields.items(): setattr(target, k, v)
    target.updated_at = tenant.updated_at = _now()
    if fields and (old_status != target.status or old_role != target.tenant_role): tenant.membership_version += 1
    if target.status != "active" and old_status == "active":
        db.query(WorkspaceMember).filter(WorkspaceMember.tenant_id == tenant_id, WorkspaceMember.user_id == user_id,
             WorkspaceMember.status == "active").update({"status": "removed", "updated_at": _now()}, synchronize_session=False)
    db.commit(); db.refresh(target)
    account = db.get(User, user_id)
    return _member_data(target, account)

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.user import User
from app.tenancy.context import WorkspaceContext, get_workspace_context, require_workspace_permission

router = APIRouter(tags=["workspaces"])
SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=1, max_length=64, pattern=SLUG)
    name: str = Field(min_length=1, max_length=120)
    icon: str | None = Field(default=None, max_length=64)


class WorkspacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    settings: dict | None = None


class WorkspaceMemberPut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace_role: str = Field(pattern="^(owner|admin|member|viewer)$")


class TransferOwnership(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_owner_user_id: str = Field(pattern=r"^[0-9]+$")


def _fail(status: int, code: str):
    raise HTTPException(status_code=status, detail={"code": code})


def _now(): return datetime.now(timezone.utc)
def _iso(value): return value.isoformat() if value else None


def _data(workspace: Workspace, role: str | None, tenant: Tenant):
    return {"workspace_id": str(workspace.workspace_id), "tenant_id": str(workspace.tenant_id),
            "slug": workspace.slug, "name": workspace.name, "icon": workspace.icon,
            "status": workspace.status, "settings": json.loads(workspace.settings_json or "{}"),
            "workspace_role": role, "membership_version": tenant.membership_version,
            "created_by": str(workspace.created_by), "created_at": _iso(workspace.created_at),
            "updated_at": _iso(workspace.updated_at)}


def _management(request: Request, x_workspace_id: str | None, db: Session, user: User):
    """Authorize metadata/member management, including archived workspace recovery."""
    raw = request.path_params.get("workspace_id")
    try: workspace_id = int(raw)
    except (TypeError, ValueError): _fail(404, "RESOURCE_NOT_FOUND")
    if x_workspace_id is None: _fail(400, "WORKSPACE_CONTEXT_REQUIRED")
    if not x_workspace_id.isdecimal() or int(x_workspace_id) != workspace_id: _fail(400, "CONTEXT_MISMATCH")
    workspace = db.get(Workspace, workspace_id)
    if not workspace: _fail(404, "RESOURCE_NOT_FOUND")
    tenant = db.get(Tenant, workspace.tenant_id)
    if not tenant: _fail(404, "RESOURCE_NOT_FOUND")
    if tenant.status != "active": _fail(409, "TENANT_INACTIVE")
    tm = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant.tenant_id, TenantMember.user_id == user.user_id))
    wm = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id,
                     WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.user_id == user.user_id))
    if not tm or tm.status != "active": _fail(403, "MEMBERSHIP_INACTIVE")
    if not wm or wm.status != "active": _fail(403, "WORKSPACE_MEMBERSHIP_REQUIRED")
    return workspace, tenant, tm, wm


@router.get("/workspaces")
def list_workspaces(tenant_id: str | None = Query(default=None, pattern=r"^[0-9]+$"),
                    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                    include_archived: bool = Query(default=False),
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = select(Workspace, Tenant, WorkspaceMember.workspace_role).join(
        WorkspaceMember, (WorkspaceMember.workspace_id == Workspace.workspace_id) & (WorkspaceMember.tenant_id == Workspace.tenant_id)
    ).join(Tenant, Tenant.tenant_id == Workspace.tenant_id).join(
        TenantMember, (TenantMember.tenant_id == Tenant.tenant_id) & (TenantMember.user_id == user.user_id)
    ).where(WorkspaceMember.user_id == user.user_id, WorkspaceMember.status == "active",
            TenantMember.status == "active", Tenant.status == "active")
    if include_archived:
        query = query.where(
            (Workspace.status == "active") |
            ((Workspace.status == "archived") & WorkspaceMember.workspace_role.in_(("owner", "admin")))
        )
    else:
        query = query.where(Workspace.status == "active")
    if tenant_id is not None: query = query.where(Workspace.tenant_id == int(tenant_id))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(Workspace.workspace_id).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_data(w, role, tenant) for w, tenant, role in rows], "total": total,
            "page": page, "page_size": page_size}


@router.post("/tenants/{tenant_id}/workspaces", status_code=201)
def create_workspace(tenant_id: int, body: WorkspaceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_id == tenant_id).with_for_update())
    if tenant is None: _fail(404, "RESOURCE_NOT_FOUND")
    if tenant.status != "active": _fail(409, "TENANT_INACTIVE")
    tm = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_id, TenantMember.user_id == user.user_id))
    if not tm or tm.status != "active": _fail(403, "MEMBERSHIP_INACTIVE")
    if tm.tenant_role not in {"owner", "admin"}: _fail(403, "FORBIDDEN")
    try:
        workspace = Workspace(tenant_id=tenant_id, slug=body.slug, name=body.name, icon=body.icon,
                              status="active", settings_json="{}", created_by=user.user_id)
        db.add(workspace); db.flush()
        member = WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant_id, user_id=user.user_id,
                                 status="active", workspace_role="owner", joined_at=_now())
        db.add(member); tenant.membership_version += 1
        db.commit(); db.refresh(workspace)
        return _data(workspace, "owner", tenant)
    except IntegrityError:
        db.rollback(); _fail(409, "SLUG_CONFLICT")


@router.get("/workspaces/{workspace_id}")
def get_workspace(workspace_id: int, request: Request, x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspace, tenant, tm, wm = _management(request, x_workspace_id, db, user)
    if workspace.status == "archived" and wm.workspace_role not in {"owner", "admin"}: _fail(409, "WORKSPACE_INACTIVE")
    return _data(workspace, wm.workspace_role, tenant)


@router.patch("/workspaces/{workspace_id}")
def patch_workspace(workspace_id: int, body: WorkspacePatch, request: Request,
                    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspace, tenant, tm, wm = _management(request, x_workspace_id, db, user)
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_id == tenant.tenant_id).with_for_update())
    if wm.workspace_role not in {"owner", "admin"}: _fail(403, "FORBIDDEN")
    fields = body.model_dump(exclude_unset=True)
    old_status = workspace.status
    for key, value in fields.items():
        setattr(workspace, "settings_json" if key == "settings" else key,
                json.dumps(value, ensure_ascii=False) if key == "settings" else value)
    workspace.updated_at = tenant.updated_at = _now()
    if old_status != workspace.status: tenant.membership_version += 1
    db.commit(); db.refresh(workspace)
    return _data(workspace, wm.workspace_role, tenant)


@router.get("/workspaces/{workspace_id}/members")
def list_workspace_members(workspace_id: int, request: Request, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                           x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspace, tenant, tm, wm = _management(request, x_workspace_id, db, user)
    if workspace.status == "archived" and wm.workspace_role not in {"owner", "admin"}: _fail(409, "WORKSPACE_INACTIVE")
    query = select(WorkspaceMember, User).join(User, User.user_id == WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.tenant_id == tenant.tenant_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(WorkspaceMember.workspace_member_id).offset((page - 1) * page_size).limit(page_size)).all()
    items = [{"user_id": str(m.user_id), "user_name": account.user_name, "nick_name": account.nick_name,
              "email": account.email, "status": m.status, "workspace_role": m.workspace_role,
              "joined_at": _iso(m.joined_at), "created_at": _iso(m.created_at), "updated_at": _iso(m.updated_at)}
             for m, account in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _owner_count(db: Session, workspace_id: int, except_user_id: int | None = None):
    query = select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.status == "active", WorkspaceMember.workspace_role == "owner")
    if except_user_id is not None: query = query.where(WorkspaceMember.user_id != except_user_id)
    return db.scalar(query) or 0


def _member_actor(wm: WorkspaceMember, tenant_role: str):
    # Authorization is workspace-scoped; tenant roles never grant space membership powers.
    return wm.workspace_role


@router.put("/workspaces/{workspace_id}/members/{user_id}")
def put_workspace_member(workspace_id: int, user_id: int, body: WorkspaceMemberPut, request: Request,
                         x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspace, tenant, tm, wm = _management(request, x_workspace_id, db, user)
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_id == tenant.tenant_id).with_for_update())
    if workspace.status != "active": _fail(409, "WORKSPACE_INACTIVE")
    actor_role = _member_actor(wm, tm.tenant_role)
    if actor_role not in {"owner", "admin"}: _fail(403, "FORBIDDEN")
    target_tm = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant.tenant_id, TenantMember.user_id == user_id))
    target_user = db.get(User, user_id)
    if not target_tm or target_tm.status != "active" or not target_user or target_user.del_flag or target_user.status != "active":
        _fail(422, "VALIDATION_ERROR")
    target = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id).with_for_update())
    if target and target.workspace_role == "owner" and actor_role != "owner": _fail(403, "FORBIDDEN")
    if body.workspace_role == "owner" and actor_role != "owner": _fail(403, "FORBIDDEN")
    if target is None:
        target = WorkspaceMember(workspace_id=workspace_id, tenant_id=tenant.tenant_id, user_id=user_id,
                                 status="active", workspace_role=body.workspace_role, joined_at=_now())
        db.add(target)
    else:
        if target.status == "active" and target.workspace_role == "owner" and body.workspace_role != "owner" and not _owner_count(db, workspace_id, user_id):
            _fail(409, "LAST_OWNER_REQUIRED")
        target.status = "active"; target.workspace_role = body.workspace_role; target.joined_at = target.joined_at or _now(); target.updated_at = _now()
    tenant.membership_version += 1
    db.commit(); db.refresh(target)
    return {"user_id": str(user_id), "status": target.status, "workspace_role": target.workspace_role,
            "membership_version": tenant.membership_version}


@router.delete("/workspaces/{workspace_id}/members/{user_id}")
def delete_workspace_member(workspace_id: int, user_id: int, request: Request,
                            x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspace, tenant, tm, wm = _management(request, x_workspace_id, db, user)
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_id == tenant.tenant_id).with_for_update())
    if workspace.status != "active": _fail(409, "WORKSPACE_INACTIVE")
    actor_role = _member_actor(wm, tm.tenant_role)
    if actor_role not in {"owner", "admin"}: _fail(403, "FORBIDDEN")
    target = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id,
                         WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.user_id == user_id).with_for_update())
    if not target: _fail(404, "RESOURCE_NOT_FOUND")
    if target.workspace_role == "owner":
        if actor_role != "owner": _fail(403, "FORBIDDEN")
    if target.status == "active" and target.workspace_role == "owner":
        if not _owner_count(db, workspace_id, user_id): _fail(409, "LAST_OWNER_REQUIRED")
    target.status = "removed"; target.updated_at = _now(); tenant.membership_version += 1
    db.commit()
    return {"user_id": str(user_id), "status": "removed", "membership_version": tenant.membership_version}


@router.post("/workspaces/{workspace_id}/transfer-ownership")
def transfer_ownership(workspace_id: int, body: TransferOwnership, request: Request,
                       x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workspace, tenant, tm, wm = _management(request, x_workspace_id, db, user)
    workspace = db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id).with_for_update())
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_id == workspace.tenant_id).with_for_update())
    if workspace.status != "active": _fail(409, "WORKSPACE_INACTIVE")
    if wm.workspace_role != "owner": _fail(403, "FORBIDDEN")
    target_id = int(body.new_owner_user_id)
    if target_id == user.user_id: _fail(422, "VALIDATION_ERROR")
    target_tm = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant.tenant_id,
                               TenantMember.user_id == target_id, TenantMember.status == "active"))
    target = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id,
                       WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.user_id == target_id).with_for_update())
    if not target_tm: _fail(422, "VALIDATION_ERROR")
    if not target or target.status != "active": _fail(422, "VALIDATION_ERROR")
    current = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id,
                          WorkspaceMember.tenant_id == tenant.tenant_id, WorkspaceMember.user_id == user.user_id).with_for_update())
    target.workspace_role = "owner"; target.updated_at = _now()
    current.workspace_role = "admin"; current.updated_at = _now()
    tenant.membership_version += 1
    db.commit()
    return {"workspace_id": str(workspace_id), "previous_owner_user_id": str(user.user_id),
            "new_owner_user_id": str(target_id), "membership_version": tenant.membership_version}

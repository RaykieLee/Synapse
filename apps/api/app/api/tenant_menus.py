"""Tenant-scoped menu tree management; system navigation is separate."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant import Tenant
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_menu import TenantMenu
from app.models.tenant_role import TenantRole
from app.models.tenant_role_menu import TenantRoleMenu
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/menus", tags=["tenant menus"])


class MenuFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_name: str = Field(min_length=1, max_length=50)
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(default=0, ge=0)
    path: str = Field(default="", max_length=200)
    component: str | None = Field(default=None, max_length=255)
    query: str | None = Field(default=None, max_length=255)
    is_frame: int = Field(default=1, ge=0, le=1)
    is_cache: int = Field(default=0, ge=0, le=1)
    menu_type: str = Field(default="M", pattern="^[MCF]$")
    visible: str = Field(default="0", pattern="^[01]$")
    status: str = Field(default="0", pattern="^[01]$")
    perms: str | None = Field(default=None, max_length=100)
    icon: str = Field(default="#", max_length=100)
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("menu_name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Menu name cannot be blank")
        return value


class MenuCreate(MenuFields):
    pass


class MenuPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_name: str | None = Field(default=None, min_length=1, max_length=50)
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int | None = Field(default=None, ge=0)
    path: str | None = Field(default=None, max_length=200)
    component: str | None = Field(default=None, max_length=255)
    query: str | None = Field(default=None, max_length=255)
    is_frame: int | None = Field(default=None, ge=0, le=1)
    is_cache: int | None = Field(default=None, ge=0, le=1)
    menu_type: str | None = Field(default=None, pattern="^[MCF]$")
    visible: str | None = Field(default=None, pattern="^[01]$")
    status: str | None = Field(default=None, pattern="^[01]$")
    perms: str | None = Field(default=None, max_length=100)
    icon: str | None = Field(default=None, max_length=100)
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("menu_name")
    @classmethod
    def non_blank_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Menu name cannot be blank")
        return value


class MenuOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_id: str = Field(pattern=r"^[1-9][0-9]*$")
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(ge=0)


class MenuReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[MenuOrder] = Field(min_length=1, max_length=500)


def _fail(status: int, code: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code})


def _authorize(context: TenantContext) -> None:
    if context.tenant_role not in {"owner", "admin"}:
        _fail(403, "FORBIDDEN")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _menu_statement(context: TenantContext, menu_id: int | None = None):
    statement = select(TenantMenu).where(TenantMenu.del_flag.is_(False))
    if menu_id is not None:
        statement = statement.where(TenantMenu.menu_id == menu_id)
    return tenant_scope(statement, TenantMenu, context)


def _get_menu(db: Session, context: TenantContext, menu_id: int, *, lock: bool = False) -> TenantMenu:
    statement = _menu_statement(context, menu_id)
    if lock:
        statement = statement.with_for_update()
    menu = db.scalar(statement)
    if menu is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return menu


def _parent(db: Session, context: TenantContext, parent_id: str | None) -> int | None:
    if parent_id is None:
        return None
    parent = _get_menu(db, context, int(parent_id))
    if parent.status != "0":
        _fail(409, "MENU_PARENT_INACTIVE")
    return parent.menu_id


def _data(menu: TenantMenu, children: list[dict] | None = None) -> dict:
    return {
        "menu_id": str(menu.menu_id),
        "tenant_id": str(menu.tenant_id),
        "menu_name": menu.menu_name,
        "parent_id": None if menu.parent_id is None else str(menu.parent_id),
        "order_num": menu.order_num,
        "path": menu.path,
        "component": menu.component,
        "query": menu.query,
        "is_frame": menu.is_frame,
        "is_cache": menu.is_cache,
        "menu_type": menu.menu_type,
        "visible": menu.visible,
        "status": menu.status,
        "perms": menu.perms,
        "icon": menu.icon,
        "remark": menu.remark,
        "created_by": str(menu.created_by),
        "updated_by": str(menu.updated_by),
        "created_at": _iso(menu.created_at),
        "updated_at": _iso(menu.updated_at),
        **({"children": children or []} if children is not None else {}),
    }


def _check_acyclic(parents: dict[int, int | None]) -> None:
    for node in parents:
        seen: set[int] = set()
        current: int | None = node
        while current is not None:
            if current in seen:
                _fail(409, "MENU_CYCLE")
            seen.add(current)
            current = parents.get(current)


def _active_menus(db: Session, context: TenantContext, *, lock: bool = False) -> list[TenantMenu]:
    statement = tenant_scope(
        select(TenantMenu).where(TenantMenu.del_flag.is_(False)), TenantMenu, context,
    ).order_by(TenantMenu.parent_id, TenantMenu.order_num, TenantMenu.menu_id)
    if lock:
        statement = statement.with_for_update()
    return list(db.scalars(statement).all())


def _build_tree(menus: list[TenantMenu]) -> list[dict]:
    by_id = {menu.menu_id: _data(menu, []) for menu in menus}
    roots: list[dict] = []
    for menu in menus:
        node = by_id[menu.menu_id]
        if menu.parent_id is None:
            roots.append(node)
        elif menu.parent_id in by_id:
            by_id[menu.parent_id]["children"].append(node)
    return roots


def _navigation_data(menu: TenantMenu, children: list[dict]) -> dict:
    """Return only the route/navigation fields needed by the current client."""
    return {
        "menu_id": str(menu.menu_id),
        "parent_id": None if menu.parent_id is None else str(menu.parent_id),
        "menu_name": menu.menu_name,
        "order_num": menu.order_num,
        "path": menu.path,
        "component": menu.component,
        "query": menu.query,
        "is_frame": menu.is_frame,
        "is_cache": menu.is_cache,
        "menu_type": menu.menu_type,
        "visible": menu.visible,
        "perms": menu.perms,
        "icon": menu.icon,
        "children": children,
    }


def _build_navigation_tree(menus: list[TenantMenu]) -> list[dict]:
    by_id = {menu.menu_id: _navigation_data(menu, []) for menu in menus}
    roots: list[dict] = []
    for menu in menus:
        node = by_id[menu.menu_id]
        if menu.parent_id is None:
            roots.append(node)
        elif menu.parent_id in by_id:
            by_id[menu.parent_id]["children"].append(node)
    return roots


@router.get("")
def list_menus(
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    statement = _menu_statement(context)
    if search and search.strip():
        statement = statement.where(TenantMenu.menu_name.ilike(f"%{search.strip()}%"))
    if status is not None:
        statement = statement.where(TenantMenu.status == status)
    menus = db.scalars(statement.order_by(TenantMenu.parent_id, TenantMenu.order_num, TenantMenu.menu_id)).all()
    return {"items": [_data(menu) for menu in menus], "total": len(menus)}


@router.get("/tree")
def get_menu_tree(
    include_disabled: bool = Query(default=True),
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    menus = _active_menus(db, context)
    _check_acyclic({menu.menu_id: menu.parent_id for menu in menus})
    if not include_disabled:
        menus = [menu for menu in menus if menu.status == "0"]
        visible_ids = {menu.menu_id for menu in menus}
        # Do not return a visible child without its disabled ancestor.
        menus = [menu for menu in menus if menu.parent_id is None or menu.parent_id in visible_ids]
    return {"items": _build_tree(menus)}


@router.get("/visible-tree")
def get_current_member_menu_tree(
    response: Response,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    """Return only active navigation entries authorized for this actor."""
    response.headers["Cache-Control"] = "private, no-store"
    if context.tenant_role in {"owner", "admin"}:
        allowed_ids: set[int] | None = None
    elif context.tenant_role == "member":
        assignment = db.scalar(tenant_scope(
            select(TenantMemberRole).where(TenantMemberRole.user_id == context.actor_user_id),
            TenantMemberRole,
            context,
        ))
        if assignment is None:
            allowed_ids = set()
        else:
            role = db.scalar(tenant_scope(
                select(TenantRole).where(
                    TenantRole.role_id == assignment.role_id,
                    TenantRole.status == "active",
                    TenantRole.del_flag.is_(False),
                ),
                TenantRole,
                context,
            ))
            if role is None:
                allowed_ids = set()
            else:
                allowed_ids = set(db.scalars(tenant_scope(
                    select(TenantRoleMenu.menu_id).where(TenantRoleMenu.role_id == role.role_id),
                    TenantRoleMenu,
                    context,
                )).all())
    else:
        # Unknown tenant role values fail closed without disclosing menu data.
        allowed_ids = set()

    menus = list(db.scalars(tenant_scope(
        select(TenantMenu).where(
            TenantMenu.status == "0",
            TenantMenu.visible == "0",
            TenantMenu.menu_type.in_(("M", "C")),
            TenantMenu.del_flag.is_(False),
        ),
        TenantMenu,
        context,
    ).order_by(TenantMenu.parent_id, TenantMenu.order_num, TenantMenu.menu_id)).all())
    if allowed_ids is not None:
        menus = [menu for menu in menus if menu.menu_id in allowed_ids]

    # A child is returned only when every ancestor is itself eligible for this
    # actor. This prevents an assigned child from revealing a hidden, disabled,
    # deleted, or unauthorized parent.
    by_id = {menu.menu_id: menu for menu in menus}
    eligible_ids = set(by_id)
    memo: dict[int, bool] = {}

    def has_visible_ancestors(menu_id: int, visiting: set[int] | None = None) -> bool:
        if menu_id in memo:
            return memo[menu_id]
        menu = by_id.get(menu_id)
        if menu is None:
            return False
        if menu.parent_id is None:
            memo[menu_id] = True
            return True
        visiting = set() if visiting is None else visiting
        if menu_id in visiting or menu.parent_id not in eligible_ids:
            memo[menu_id] = False
            return False
        visiting.add(menu_id)
        value = has_visible_ancestors(menu.parent_id, visiting)
        visiting.remove(menu_id)
        memo[menu_id] = value
        return value

    menus = [menu for menu in menus if has_visible_ancestors(menu.menu_id)]
    tenant = db.get(Tenant, context.tenant_id)
    version = context.membership_version if tenant is None else tenant.membership_version
    return {
        "tenant_id": str(context.tenant_id),
        "membership_version": version,
        "items": _build_navigation_tree(menus),
    }


@router.get("/{menu_id}")
def get_menu(
    menu_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    return _data(_get_menu(db, context, menu_id))


@router.post("", status_code=201)
def create_menu(
    body: MenuCreate,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    parent_id = _parent(db, context, body.parent_id)
    menu = TenantMenu(
        tenant_id=context.tenant_id,
        parent_id=parent_id,
        menu_name=body.menu_name,
        order_num=body.order_num,
        path=body.path,
        component=body.component,
        query=body.query,
        is_frame=body.is_frame,
        is_cache=body.is_cache,
        menu_type=body.menu_type,
        visible=body.visible,
        status=body.status,
        perms=body.perms,
        icon=body.icon,
        remark=body.remark,
        created_by=context.actor_user_id,
        updated_by=context.actor_user_id,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(menu)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "MENU_CONFLICT"}) from exc
    db.refresh(menu)
    return _data(menu)


@router.patch("/{menu_id}")
def patch_menu(
    menu_id: int,
    body: MenuPatch,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    menu = _get_menu(db, context, menu_id, lock=True)
    values = body.model_dump(exclude_unset=True)
    if not values:
        _fail(422, "VALIDATION_ERROR")
    nullable_fields = {"parent_id", "component", "query", "perms", "remark"}
    if any(value is None and field not in nullable_fields for field, value in values.items()):
        _fail(422, "VALIDATION_ERROR")
    if "parent_id" in values:
        values["parent_id"] = _parent(db, context, values["parent_id"])
    active = _active_menus(db, context, lock=True)
    parents = {row.menu_id: row.parent_id for row in active}
    parents[menu_id] = values.get("parent_id", menu.parent_id)
    _check_acyclic(parents)
    for field, value in values.items():
        setattr(menu, field, value)
    menu.updated_by = context.actor_user_id
    menu.updated_at = _now()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "MENU_CONFLICT"}) from exc
    db.refresh(menu)
    return _data(menu)


@router.post("/reorder")
def reorder_menus(
    body: MenuReorder,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    requested_ids = [int(item.menu_id) for item in body.items]
    if len(requested_ids) != len(set(requested_ids)):
        _fail(422, "VALIDATION_ERROR")
    active = _active_menus(db, context, lock=True)
    by_id = {menu.menu_id: menu for menu in active}
    if any(menu_id not in by_id for menu_id in requested_ids):
        _fail(404, "RESOURCE_NOT_FOUND")
    parent_updates = {int(item.menu_id): _parent(db, context, item.parent_id) for item in body.items}
    parents = {menu.menu_id: menu.parent_id for menu in active}
    parents.update(parent_updates)
    _check_acyclic(parents)
    for item in body.items:
        menu = by_id[int(item.menu_id)]
        menu.parent_id = parent_updates[menu.menu_id]
        menu.order_num = item.order_num
        menu.updated_by = context.actor_user_id
        menu.updated_at = _now()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "MENU_CONFLICT"}) from exc
    return {"updated": len(body.items)}


@router.delete("/{menu_id}", status_code=204)
def delete_menu(
    menu_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    menu = _get_menu(db, context, menu_id, lock=True)
    child = db.scalar(tenant_scope(
        select(TenantMenu.menu_id).where(
            TenantMenu.parent_id == menu_id,
            TenantMenu.del_flag.is_(False),
        ).limit(1),
        TenantMenu,
        context,
    ))
    if child is not None:
        _fail(409, "MENU_HAS_CHILDREN")
    menu.del_flag = True
    menu.updated_by = context.actor_user_id
    menu.updated_at = _now()
    db.commit()
    return Response(status_code=204)

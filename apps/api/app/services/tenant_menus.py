"""Application service for tenant-owned menus and navigation trees."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_menu import TenantMenu
from app.models.tenant_role import TenantRole
from app.models.tenant_role_menu import TenantRoleMenu
from app.schemas.tenant_menus import MenuCreate, MenuPatch, MenuReorder
from app.services.errors import ConflictError, DomainValidationError, ForbiddenError, NotFoundError
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class MenuConflict(ConflictError):
    code = "MENU_CONFLICT"


class MenuParentInactive(ConflictError):
    code = "MENU_PARENT_INACTIVE"


class MenuCycle(ConflictError):
    code = "MENU_CYCLE"


class MenuHasChildren(ConflictError):
    code = "MENU_HAS_CHILDREN"


class EmptyMenuPatch(DomainValidationError):
    code = "VALIDATION_ERROR"


class DuplicateMenuOrder(DomainValidationError):
    code = "VALIDATION_ERROR"


@dataclass(frozen=True)
class MenuResult:
    menu_id: str
    tenant_id: str
    menu_name: str
    parent_id: str | None
    order_num: int
    path: str
    component: str | None
    query: str | None
    is_frame: int
    is_cache: int
    menu_type: str
    visible: str
    status: str
    perms: str | None
    icon: str
    remark: str | None
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None
    children: tuple[MenuResult, ...] = ()


@dataclass(frozen=True)
class MenuListResult:
    items: tuple[MenuResult, ...]
    total: int


@dataclass(frozen=True)
class MenuTreeResult:
    items: tuple[MenuResult, ...]


@dataclass(frozen=True)
class NavigationMenuResult:
    menu_id: str
    parent_id: str | None
    menu_name: str
    order_num: int
    path: str
    component: str | None
    query: str | None
    is_frame: int
    is_cache: int
    menu_type: str
    perms: str | None
    icon: str
    children: tuple[NavigationMenuResult, ...] = ()


@dataclass(frozen=True)
class VisibleMenuTreeResult:
    tenant_id: str
    membership_version: int
    items: tuple[NavigationMenuResult, ...]


@dataclass(frozen=True)
class MenuReorderResult:
    updated: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


class TenantMenuService:
    """Business use cases for tenant menu administration and navigation."""

    def __init__(self, db: Session):
        self.db = db

    def list_menus(
        self,
        context: TenantContext,
        *,
        search: str | None,
        status: str | None,
    ) -> MenuListResult:
        self._authorize(context)
        statement = self._menu_statement(context)
        if search and search.strip():
            statement = statement.where(TenantMenu.menu_name.ilike(f"%{search.strip()}%"))
        if status is not None:
            statement = statement.where(TenantMenu.status == status)
        menus = self.db.scalars(
            statement.order_by(
                TenantMenu.parent_id,
                TenantMenu.order_num,
                TenantMenu.menu_id,
            )
        ).all()
        return MenuListResult(
            items=tuple(self._menu_result(menu) for menu in menus),
            total=len(menus),
        )

    def get_menu_tree(
        self,
        context: TenantContext,
        *,
        include_disabled: bool,
    ) -> MenuTreeResult:
        self._authorize(context)
        menus = self._active_menus(context)
        self._check_acyclic({menu.menu_id: menu.parent_id for menu in menus})
        if not include_disabled:
            menus = [menu for menu in menus if menu.status == "0"]
            visible_ids = {menu.menu_id for menu in menus}
            # Do not return a visible child without its disabled ancestor.
            menus = [
                menu
                for menu in menus
                if menu.parent_id is None or menu.parent_id in visible_ids
            ]
        return MenuTreeResult(items=tuple(self._build_tree(menus)))

    def get_visible_menu_tree(
        self,
        context: TenantContext,
    ) -> VisibleMenuTreeResult:
        allowed_ids = self._allowed_menu_ids(context)
        menus = list(
            self.db.scalars(
                tenant_scope(
                    select(TenantMenu).where(
                        TenantMenu.status == "0",
                        TenantMenu.visible == "0",
                        TenantMenu.menu_type.in_(("M", "C")),
                        TenantMenu.del_flag.is_(False),
                    ),
                    TenantMenu,
                    context,
                ).order_by(
                    TenantMenu.parent_id,
                    TenantMenu.order_num,
                    TenantMenu.menu_id,
                )
            ).all()
        )
        if allowed_ids is not None:
            menus = [menu for menu in menus if menu.menu_id in allowed_ids]

        # A child is returned only when every ancestor is eligible for this
        # actor. This prevents an assigned child from revealing a hidden,
        # disabled, deleted, or unauthorized parent.
        by_id = {menu.menu_id: menu for menu in menus}
        eligible_ids = set(by_id)
        memo: dict[int, bool] = {}

        def has_visible_ancestors(
            menu_id: int,
            visiting: set[int] | None = None,
        ) -> bool:
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
        tenant = self.db.get(Tenant, context.tenant_id)
        version = context.membership_version if tenant is None else tenant.membership_version
        return VisibleMenuTreeResult(
            tenant_id=str(context.tenant_id),
            membership_version=version,
            items=tuple(self._build_navigation_tree(menus)),
        )

    def get_menu(
        self,
        menu_id: int,
        context: TenantContext,
    ) -> MenuResult:
        self._authorize(context)
        return self._menu_result(self._get_menu(context, menu_id))

    def create_menu(
        self,
        body: MenuCreate,
        context: TenantContext,
    ) -> MenuResult:
        self._authorize(context)
        parent_id = self._parent(context, body.parent_id)
        now = _now()
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
            created_at=now,
            updated_at=now,
        )
        self.db.add(menu)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise MenuConflict("Menu conflicts with existing data") from exc
        self.db.refresh(menu)
        return self._menu_result(menu)

    def update_menu(
        self,
        menu_id: int,
        body: MenuPatch,
        context: TenantContext,
    ) -> MenuResult:
        self._authorize(context)
        menu = self._get_menu(context, menu_id, lock=True)
        values = body.model_dump(exclude_unset=True)
        if not values:
            raise EmptyMenuPatch("At least one menu field is required")
        nullable_fields = {"parent_id", "component", "query", "perms", "remark"}
        if any(
            value is None and field not in nullable_fields
            for field, value in values.items()
        ):
            raise EmptyMenuPatch("Menu field cannot be null")
        if "parent_id" in values:
            values["parent_id"] = self._parent(context, values["parent_id"])
        active = self._active_menus(context, lock=True)
        parents = {row.menu_id: row.parent_id for row in active}
        parents[menu_id] = values.get("parent_id", menu.parent_id)
        self._check_acyclic(parents)
        for field, value in values.items():
            setattr(menu, field, value)
        menu.updated_by = context.actor_user_id
        menu.updated_at = _now()
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise MenuConflict("Menu conflicts with existing data") from exc
        self.db.refresh(menu)
        return self._menu_result(menu)

    def reorder_menus(
        self,
        body: MenuReorder,
        context: TenantContext,
    ) -> MenuReorderResult:
        self._authorize(context)
        requested_ids = [int(item.menu_id) for item in body.items]
        if len(requested_ids) != len(set(requested_ids)):
            raise DuplicateMenuOrder("Menu IDs must be unique")
        active = self._active_menus(context, lock=True)
        by_id = {menu.menu_id: menu for menu in active}
        if any(menu_id not in by_id for menu_id in requested_ids):
            raise NotFoundError("Tenant menu not found")
        parent_updates = {
            int(item.menu_id): self._parent(context, item.parent_id)
            for item in body.items
        }
        parents = {menu.menu_id: menu.parent_id for menu in active}
        parents.update(parent_updates)
        self._check_acyclic(parents)
        for item in body.items:
            menu = by_id[int(item.menu_id)]
            menu.parent_id = parent_updates[menu.menu_id]
            menu.order_num = item.order_num
            menu.updated_by = context.actor_user_id
            menu.updated_at = _now()
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise MenuConflict("Menu conflicts with existing data") from exc
        return MenuReorderResult(updated=len(body.items))

    def delete_menu(
        self,
        menu_id: int,
        context: TenantContext,
    ) -> None:
        self._authorize(context)
        menu = self._get_menu(context, menu_id, lock=True)
        child = self.db.scalar(
            tenant_scope(
                select(TenantMenu.menu_id).where(
                    TenantMenu.parent_id == menu_id,
                    TenantMenu.del_flag.is_(False),
                ).limit(1),
                TenantMenu,
                context,
            )
        )
        if child is not None:
            raise MenuHasChildren("Menu has active children")
        menu.del_flag = True
        menu.updated_by = context.actor_user_id
        menu.updated_at = _now()
        self.db.flush()

    def _authorize(self, context: TenantContext) -> None:
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    def _menu_statement(
        self,
        context: TenantContext,
        menu_id: int | None = None,
    ):
        statement = select(TenantMenu).where(TenantMenu.del_flag.is_(False))
        if menu_id is not None:
            statement = statement.where(TenantMenu.menu_id == menu_id)
        return tenant_scope(statement, TenantMenu, context)

    def _get_menu(
        self,
        context: TenantContext,
        menu_id: int,
        *,
        lock: bool = False,
    ) -> TenantMenu:
        statement = self._menu_statement(context, menu_id)
        if lock:
            statement = statement.with_for_update()
        menu = self.db.scalar(statement)
        if menu is None:
            raise NotFoundError("Tenant menu not found")
        return menu

    def _parent(
        self,
        context: TenantContext,
        parent_id: str | None,
    ) -> int | None:
        if parent_id is None:
            return None
        parent = self._get_menu(context, int(parent_id))
        if parent.status != "0":
            raise MenuParentInactive("Menu parent is inactive")
        return parent.menu_id

    def _active_menus(
        self,
        context: TenantContext,
        *,
        lock: bool = False,
    ) -> list[TenantMenu]:
        statement = tenant_scope(
            select(TenantMenu)
            .where(TenantMenu.del_flag.is_(False))
            .order_by(
                TenantMenu.parent_id,
                TenantMenu.order_num,
                TenantMenu.menu_id,
            ),
            TenantMenu,
            context,
        )
        if lock:
            statement = statement.with_for_update()
        return list(self.db.scalars(statement).all())

    def _allowed_menu_ids(self, context: TenantContext) -> set[int] | None:
        if context.tenant_role in {"owner", "admin"}:
            return None
        if context.tenant_role != "member":
            return set()
        assignment = self.db.scalar(
            tenant_scope(
                select(TenantMemberRole).where(
                    TenantMemberRole.user_id == context.actor_user_id
                ),
                TenantMemberRole,
                context,
            )
        )
        if assignment is None:
            return set()
        role = self.db.scalar(
            tenant_scope(
                select(TenantRole).where(
                    TenantRole.role_id == assignment.role_id,
                    TenantRole.status == "active",
                    TenantRole.del_flag.is_(False),
                ),
                TenantRole,
                context,
            )
        )
        if role is None:
            return set()
        return set(
            self.db.scalars(
                tenant_scope(
                    select(TenantRoleMenu.menu_id).where(
                        TenantRoleMenu.role_id == role.role_id
                    ),
                    TenantRoleMenu,
                    context,
                )
            ).all()
        )

    @staticmethod
    def _check_acyclic(parents: dict[int, int | None]) -> None:
        for node in parents:
            seen: set[int] = set()
            current: int | None = node
            while current is not None:
                if current in seen:
                    raise MenuCycle("Menu hierarchy contains a cycle")
                seen.add(current)
                current = parents.get(current)

    @staticmethod
    def _build_tree(menus: list[TenantMenu]) -> list[MenuResult]:
        by_id = {
            menu.menu_id: TenantMenuService._menu_result(menu)
            for menu in menus
        }
        children: dict[int, list[MenuResult]] = {menu.menu_id: [] for menu in menus}
        roots: list[int] = []
        for menu in menus:
            if menu.parent_id is None:
                roots.append(menu.menu_id)
            elif menu.parent_id in children:
                children[menu.parent_id].append(by_id[menu.menu_id])
        return [
            replace(by_id[menu_id], children=tuple(children[menu_id]))
            for menu_id in roots
        ]

    @staticmethod
    def _build_navigation_tree(
        menus: list[TenantMenu],
    ) -> list[NavigationMenuResult]:
        by_id = {
            menu.menu_id: TenantMenuService._navigation_result(menu)
            for menu in menus
        }
        children: dict[int, list[NavigationMenuResult]] = {
            menu.menu_id: [] for menu in menus
        }
        roots: list[int] = []
        for menu in menus:
            if menu.parent_id is None:
                roots.append(menu.menu_id)
            elif menu.parent_id in children:
                children[menu.parent_id].append(by_id[menu.menu_id])
        return [
            replace(by_id[menu_id], children=tuple(children[menu_id]))
            for menu_id in roots
        ]

    @staticmethod
    def _menu_result(menu: TenantMenu) -> MenuResult:
        return MenuResult(
            menu_id=str(menu.menu_id),
            tenant_id=str(menu.tenant_id),
            menu_name=menu.menu_name,
            parent_id=None if menu.parent_id is None else str(menu.parent_id),
            order_num=menu.order_num,
            path=menu.path,
            component=menu.component,
            query=menu.query,
            is_frame=menu.is_frame,
            is_cache=menu.is_cache,
            menu_type=menu.menu_type,
            visible=menu.visible,
            status=menu.status,
            perms=menu.perms,
            icon=menu.icon,
            remark=menu.remark,
            created_by=str(menu.created_by),
            updated_by=str(menu.updated_by),
            created_at=_aware(menu.created_at),
            updated_at=_aware(menu.updated_at),
        )

    @staticmethod
    def _navigation_result(menu: TenantMenu) -> NavigationMenuResult:
        return NavigationMenuResult(
            menu_id=str(menu.menu_id),
            parent_id=None if menu.parent_id is None else str(menu.parent_id),
            menu_name=menu.menu_name,
            order_num=menu.order_num,
            path=menu.path,
            component=menu.component,
            query=menu.query,
            is_frame=menu.is_frame,
            is_cache=menu.is_cache,
            menu_type=menu.menu_type,
            perms=menu.perms,
            icon=menu.icon,
        )

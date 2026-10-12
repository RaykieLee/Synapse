"""Application service for tenant custom-role menu grants."""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant
from app.models.tenant_menu import TenantMenu
from app.models.tenant_role import TenantRole
from app.models.tenant_role_menu import TenantRoleMenu
from app.schemas.tenant_role_menus import ReplaceRoleMenus
from app.services.errors import ConflictError, ForbiddenError, NotFoundError
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class RoleMenuConflict(ConflictError):
    code = "ROLE_MENU_CONFLICT"


@dataclass(frozen=True)
class RoleMenusResult:
    tenant_id: str
    role_id: str
    menu_ids: tuple[str, ...]


class TenantRoleMenuService:
    """Business use cases for replacing one role's tenant menu grants."""

    def __init__(self, db: Session):
        self.db = db

    def get_role_menus(
        self,
        role_id: int,
        context: TenantContext,
    ) -> RoleMenusResult:
        self._authorize(context)
        role = self._get_role(role_id, context)
        # Persisted stale links remain visible so an owner/admin can replace
        # them with currently active menu IDs.
        return self._result(
            context,
            role.role_id,
            self._assigned_ids(role.role_id, context),
        )

    def replace_role_menus(
        self,
        role_id: int,
        body: ReplaceRoleMenus,
        context: TenantContext,
    ) -> RoleMenusResult:
        self._authorize(context)
        role = self._lock_role_for_replace(role_id, context)
        requested_ids = sorted(body.menu_ids, key=int)
        self._validate_menus(context, requested_ids)
        current_ids = self._assigned_ids(role.role_id, context)
        if requested_ids == current_ids:
            return self._result(context, role.role_id, current_ids)

        self.db.execute(
            delete(TenantRoleMenu).where(
                TenantRoleMenu.tenant_id == context.tenant_id,
                TenantRoleMenu.role_id == role.role_id,
            )
        )
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                TenantRoleMenu(
                    tenant_id=context.tenant_id,
                    role_id=role.role_id,
                    menu_id=int(menu_id),
                    created_by=context.actor_user_id,
                    created_at=now,
                )
                for menu_id in requested_ids
            ]
        )
        self._advance_membership_version(context.tenant_id)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise RoleMenuConflict("Role menu grants conflicted") from exc
        return self._result(context, role.role_id, requested_ids)

    def _authorize(self, context: TenantContext) -> None:
        # Custom permissions must never delegate menu-grant administration.
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    def _role_statement(self, role_id: int, context: TenantContext):
        return tenant_scope(
            select(TenantRole).where(
                TenantRole.role_id == role_id,
                TenantRole.status == "active",
                TenantRole.del_flag.is_(False),
            ),
            TenantRole,
            context,
        )

    def _get_role(
        self,
        role_id: int,
        context: TenantContext,
        *,
        lock: bool = False,
    ) -> TenantRole:
        statement = self._role_statement(role_id, context)
        if lock:
            statement = statement.with_for_update()
        role = self.db.scalar(statement)
        if role is None:
            raise NotFoundError("Tenant role not found")
        return role

    def _lock_role_for_replace(
        self,
        role_id: int,
        context: TenantContext,
    ) -> TenantRole:
        # PostgreSQL serializes writers with FOR UPDATE. SQLite ignores that
        # clause, so a no-op UPDATE acquires the write lock before reading the
        # old set. The savepoint lets a busy snapshot be retried without an
        # explicit request-level rollback.
        lock_statement = tenant_scope(
            update(TenantRole)
            .where(
                TenantRole.role_id == role_id,
                TenantRole.status == "active",
                TenantRole.del_flag.is_(False),
            )
            .values(updated_at=TenantRole.updated_at),
            TenantRole,
            context,
        )
        result = None
        for attempt in range(3):
            try:
                with self.db.begin_nested():
                    result = self.db.execute(lock_statement)
                    self.db.flush()
                break
            except OperationalError as exc:
                code = getattr(exc.orig, "sqlite_errorcode", None)
                sqlite_busy = self.db.get_bind().dialect.name == "sqlite" and (
                    (code is not None and (code & 0xFF) in {5, 6})
                    or "locked" in str(exc.orig).lower()
                )
                if not sqlite_busy or attempt == 2:
                    raise
        assert result is not None
        if result.rowcount == 0:
            raise NotFoundError("Tenant role not found")
        return self._get_role(role_id, context, lock=True)

    def _assigned_ids(
        self,
        role_id: int,
        context: TenantContext,
    ) -> list[str]:
        statement = tenant_scope(
            select(TenantRoleMenu.menu_id)
            .where(TenantRoleMenu.role_id == role_id)
            .order_by(TenantRoleMenu.menu_id),
            TenantRoleMenu,
            context,
        )
        return [str(menu_id) for menu_id in self.db.scalars(statement).all()]

    def _validate_menus(
        self,
        context: TenantContext,
        menu_ids: list[str],
    ) -> list[TenantMenu]:
        if not menu_ids:
            return []
        numeric_ids = [int(value) for value in menu_ids]
        statement = tenant_scope(
            select(TenantMenu)
            .where(
                TenantMenu.menu_id.in_(numeric_ids),
                TenantMenu.status == "0",
                TenantMenu.del_flag.is_(False),
            )
            .with_for_update(),
            TenantMenu,
            context,
        )
        menus = list(self.db.scalars(statement).all())
        if len(menus) != len(numeric_ids):
            # Absent, foreign, disabled and deleted IDs share one safe result.
            raise NotFoundError("Tenant menu not found")
        return menus

    def _advance_membership_version(self, tenant_id: int) -> None:
        self.db.execute(
            update(Tenant)
            .where(Tenant.tenant_id == tenant_id)
            .values(membership_version=Tenant.membership_version + 1)
        )

    @staticmethod
    def _result(
        context: TenantContext,
        role_id: int,
        menu_ids: list[str],
    ) -> RoleMenusResult:
        return RoleMenusResult(
            tenant_id=str(context.tenant_id),
            role_id=str(role_id),
            menu_ids=tuple(menu_ids),
        )

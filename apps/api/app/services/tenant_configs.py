"""Application service for tenant-owned parameter configurations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant_config import TenantConfig
from app.schemas.tenant_configs import ConfigCreate, ConfigPatch
from app.services.errors import (
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from app.services.results import PageResult
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class ConfigKeyConflict(ConflictError):
    code = "CONFIG_KEY_CONFLICT"


class SensitiveConfigCannotBeFrontend(DomainValidationError):
    code = "SENSITIVE_CONFIG_CANNOT_BE_FRONTEND"


@dataclass(frozen=True)
class TenantConfigResult:
    config_id: str
    tenant_id: str
    config_name: str
    config_key: str
    config_value: str | None
    value_redacted: bool
    group_name: str
    is_frontend: bool
    is_sensitive: bool
    status: str
    remark: str | None
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class PublicConfigItemResult:
    key: str
    value: str
    group: str


@dataclass(frozen=True)
class PublicConfigResult:
    tenant_id: str
    items: tuple[PublicConfigItemResult, ...]


class TenantConfigService:
    """Business use cases for tenant parameter configuration administration."""

    def __init__(self, db: Session):
        self.db = db

    def list_public_configs(self, context: TenantContext) -> PublicConfigResult:
        rows = self.db.scalars(
            tenant_scope(
                select(TenantConfig).where(
                    TenantConfig.is_frontend.is_(True),
                    TenantConfig.is_sensitive.is_(False),
                    TenantConfig.status == "0",
                ),
                TenantConfig,
                context,
            ).order_by(TenantConfig.group_name, TenantConfig.config_key)
        ).all()
        return PublicConfigResult(
            tenant_id=str(context.tenant_id),
            items=tuple(
                PublicConfigItemResult(
                    key=row.config_key,
                    value=row.config_value,
                    group=row.group_name,
                )
                for row in rows
            ),
        )

    def list_configs(
        self,
        context: TenantContext,
        *,
        page: int,
        page_size: int,
        config_name: str | None,
        config_key: str | None,
        group_name: str | None,
        status: str | None,
        is_sensitive: bool | None,
    ) -> PageResult[TenantConfigResult]:
        self._authorize(context)
        statement = self._statement(context)
        count_statement = tenant_scope(
            select(func.count(TenantConfig.config_id)),
            TenantConfig,
            context,
        )
        for column, raw in (
            (TenantConfig.config_name, config_name),
            (TenantConfig.config_key, config_key),
            (TenantConfig.group_name, group_name),
        ):
            if raw and raw.strip():
                condition = column.ilike(f"%{raw.strip()}%")
                statement = statement.where(condition)
                count_statement = count_statement.where(condition)
        if status is not None:
            statement = statement.where(TenantConfig.status == status)
            count_statement = count_statement.where(TenantConfig.status == status)
        if is_sensitive is not None:
            statement = statement.where(TenantConfig.is_sensitive.is_(is_sensitive))
            count_statement = count_statement.where(TenantConfig.is_sensitive.is_(is_sensitive))

        total = self.db.scalar(count_statement) or 0
        rows = self.db.scalars(
            statement.order_by(TenantConfig.created_at.desc(), TenantConfig.config_id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return PageResult(
            items=tuple(self._result(row) for row in rows),
            total=total,
            page=page,
            page_size=page_size,
        )

    def create_config(
        self,
        body: ConfigCreate,
        context: TenantContext,
    ) -> TenantConfigResult:
        self._authorize(context)
        self._validate_visibility(body.is_sensitive, body.is_frontend)
        self._check_unique_key(context, body.config_key)
        now = _now()
        row = TenantConfig(
            tenant_id=context.tenant_id,
            **body.model_dump(),
            created_by=context.actor_user_id,
            updated_by=context.actor_user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._flush()
        self.db.refresh(row)
        return self._result(row)

    def get_config(
        self,
        config_id: int,
        context: TenantContext,
    ) -> TenantConfigResult:
        self._authorize(context)
        return self._result(self._get_config(context, config_id), reveal_sensitive=True)

    def update_config(
        self,
        config_id: int,
        body: ConfigPatch,
        context: TenantContext,
    ) -> TenantConfigResult:
        self._authorize(context)
        row = self._get_config(context, config_id, lock=True)
        values = body.model_dump(exclude_unset=True)
        if not values or any(
            value is None and field != "remark"
            for field, value in values.items()
        ):
            raise DomainValidationError("At least one valid configuration field is required")
        if "config_key" in values and values["config_key"] != row.config_key:
            self._check_unique_key(context, values["config_key"], exclude_id=row.config_id)
        is_sensitive = values.get("is_sensitive", row.is_sensitive)
        is_frontend = values.get("is_frontend", row.is_frontend)
        self._validate_visibility(is_sensitive, is_frontend)
        for field, value in values.items():
            setattr(row, field, value)
        row.updated_by = context.actor_user_id
        row.updated_at = _now()
        self._flush()
        self.db.refresh(row)
        # Mutation responses never echo a secret, even for an authorized manager.
        return self._result(row)

    def delete_config(self, config_id: int, context: TenantContext) -> None:
        self._authorize(context)
        row = self._get_config(context, config_id, lock=True)
        self.db.delete(row)
        self._flush()

    def _authorize(self, context: TenantContext) -> None:
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    def _statement(
        self,
        context: TenantContext,
        config_id: int | None = None,
        *,
        lock: bool = False,
    ):
        statement = tenant_scope(select(TenantConfig), TenantConfig, context)
        if config_id is not None:
            statement = statement.where(TenantConfig.config_id == config_id)
        if lock:
            statement = statement.with_for_update()
        return statement

    def _get_config(
        self,
        context: TenantContext,
        config_id: int,
        *,
        lock: bool = False,
    ) -> TenantConfig:
        row = self.db.scalar(self._statement(context, config_id, lock=lock))
        if row is None:
            raise NotFoundError("Tenant configuration not found")
        return row

    def _check_unique_key(
        self,
        context: TenantContext,
        config_key: str,
        *,
        exclude_id: int | None = None,
    ) -> None:
        statement = tenant_scope(
            select(TenantConfig.config_id).where(
                TenantConfig.config_key == config_key
            ),
            TenantConfig,
            context,
        )
        if exclude_id is not None:
            statement = statement.where(TenantConfig.config_id != exclude_id)
        if self.db.scalar(statement) is not None:
            raise ConfigKeyConflict("Configuration key already exists")

    @staticmethod
    def _validate_visibility(is_sensitive: bool, is_frontend: bool) -> None:
        if is_sensitive and is_frontend:
            raise SensitiveConfigCannotBeFrontend(
                "Sensitive configurations cannot be frontend-visible"
            )

    def _flush(self) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise ConfigKeyConflict("Configuration key already exists") from exc

    @staticmethod
    def _result(
        row: TenantConfig,
        *,
        reveal_sensitive: bool = False,
    ) -> TenantConfigResult:
        redact = row.is_sensitive and not reveal_sensitive
        return TenantConfigResult(
            config_id=str(row.config_id),
            tenant_id=str(row.tenant_id),
            config_name=row.config_name,
            config_key=row.config_key,
            config_value=None if redact else row.config_value,
            value_redacted=redact,
            group_name=row.group_name,
            is_frontend=row.is_frontend,
            is_sensitive=row.is_sensitive,
            status=row.status,
            remark=row.remark,
            created_by=str(row.created_by),
            updated_by=str(row.updated_by),
            created_at=_aware(row.created_at),
            updated_at=_aware(row.updated_at),
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)

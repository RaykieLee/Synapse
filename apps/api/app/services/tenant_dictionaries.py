"""Application service for tenant-owned dictionary types and values."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant_dictionary import TenantDictData, TenantDictType
from app.schemas.tenant_dictionaries import (
    DictDataCreate,
    DictDataPatch,
    DictReorder,
    DictTypeCreate,
    DictTypePatch,
    DictTypeReorder,
)
from app.services.errors import (
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from app.services.results import PageResult
from app.tenancy.context import TenantContext
from app.tenancy.scopes import tenant_scope


class DictTypeConflict(ConflictError):
    code = "DICT_TYPE_CONFLICT"


class DictValueConflict(ConflictError):
    code = "DICT_VALUE_CONFLICT"


class DictTypeHasData(ConflictError):
    code = "DICT_TYPE_HAS_DATA"


class DictTypeReorderSetMismatch(ConflictError):
    code = "DICT_TYPE_REORDER_SET_MISMATCH"


class DictReorderSetMismatch(ConflictError):
    code = "DICT_REORDER_SET_MISMATCH"


class DuplicateDictTypeId(DomainValidationError):
    code = "DUPLICATE_DICT_TYPE_ID"


class DuplicateDictDataId(DomainValidationError):
    code = "DUPLICATE_DICT_DATA_ID"


@dataclass(frozen=True)
class DictTypeResult:
    dict_type_id: str
    tenant_id: str
    dict_name: str
    dict_type: str
    order_num: int
    status: str
    remark: str | None
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class DictDataResult:
    dict_data_id: str
    tenant_id: str
    dict_type_id: str
    dict_type: str
    dict_sort: int
    dict_label: str
    dict_value: str
    css_class: str | None
    list_class: str | None
    is_default: str
    status: str
    remark: str | None
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class DictReorderResult:
    updated: int


class TenantDictionaryService:
    """Business use cases for tenant dictionary administration."""

    def __init__(self, db: Session):
        self.db = db

    def list_dict_types(
        self,
        context: TenantContext,
        *,
        page: int,
        page_size: int,
        dict_name: str | None,
        dict_type: str | None,
        status: str | None,
    ) -> PageResult[DictTypeResult]:
        self._authorize(context)
        statement = self._type_statement(context)
        count_statement = tenant_scope(
            select(func.count(TenantDictType.dict_type_id)),
            TenantDictType,
            context,
        )
        for column, raw in (
            (TenantDictType.dict_name, dict_name),
            (TenantDictType.dict_type, dict_type),
        ):
            if raw and raw.strip():
                filter_ = column.ilike(f"%{raw.strip()}%")
                statement = statement.where(filter_)
                count_statement = count_statement.where(filter_)
        if status is not None:
            statement = statement.where(TenantDictType.status == status)
            count_statement = count_statement.where(TenantDictType.status == status)
        total = self.db.scalar(count_statement) or 0
        rows = self.db.scalars(
            statement.order_by(TenantDictType.order_num, TenantDictType.dict_type_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return PageResult(
            items=tuple(self._type_result(row) for row in rows),
            total=total,
            page=page,
            page_size=page_size,
        )

    def reorder_dict_types(
        self,
        body: DictTypeReorder,
        context: TenantContext,
    ) -> DictReorderResult:
        self._authorize(context)
        ids = [int(item.dict_type_id) for item in body.items]
        if len(ids) != len(set(ids)):
            raise DuplicateDictTypeId("Dictionary type IDs must be unique")
        rows = list(self.db.scalars(self._type_statement(context, lock=True)).all())
        if set(ids) != {row.dict_type_id for row in rows}:
            raise DictTypeReorderSetMismatch("Dictionary type reorder set does not match tenant data")
        by_id = {row.dict_type_id: row for row in rows}
        for item in body.items:
            row = by_id[int(item.dict_type_id)]
            row.order_num = item.order_num
            row.updated_by = context.actor_user_id
            row.updated_at = _now()
        self._flush(DictTypeConflict)
        return DictReorderResult(updated=len(rows))

    def create_dict_type(
        self,
        body: DictTypeCreate,
        context: TenantContext,
    ) -> DictTypeResult:
        self._authorize(context)
        now = _now()
        row = TenantDictType(
            tenant_id=context.tenant_id,
            **body.model_dump(),
            created_by=context.actor_user_id,
            updated_by=context.actor_user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._flush(DictTypeConflict)
        self.db.refresh(row)
        return self._type_result(row)

    def get_dict_type(
        self,
        dict_type_id: int,
        context: TenantContext,
    ) -> DictTypeResult:
        self._authorize(context)
        return self._type_result(self._get_type(context, dict_type_id))

    def update_dict_type(
        self,
        dict_type_id: int,
        body: DictTypePatch,
        context: TenantContext,
    ) -> DictTypeResult:
        self._authorize(context)
        row = self._get_type(context, dict_type_id, lock=True)
        for name, value in body.model_dump(exclude_unset=True).items():
            setattr(row, name, value)
        row.updated_by = context.actor_user_id
        row.updated_at = _now()
        self._flush(DictTypeConflict)
        self.db.refresh(row)
        return self._type_result(row)

    def delete_dict_type(
        self,
        dict_type_id: int,
        context: TenantContext,
    ) -> None:
        self._authorize(context)
        row = self._get_type(context, dict_type_id, lock=True)
        has_values = self.db.scalar(
            self._data_statement(context, dict_type_id).limit(1)
        ) is not None
        if has_values:
            raise DictTypeHasData("Dictionary type still has values")
        self.db.delete(row)
        self._flush(DictTypeConflict)

    def list_dict_data(
        self,
        dict_type_id: int,
        context: TenantContext,
        *,
        page: int,
        page_size: int,
        dict_label: str | None,
        status: str | None,
    ) -> PageResult[DictDataResult]:
        self._authorize(context)
        type_row = self._get_type(context, dict_type_id)
        statement = self._data_statement(context, dict_type_id)
        count_statement = tenant_scope(
            select(func.count(TenantDictData.dict_data_id)).where(
                TenantDictData.dict_type_id == dict_type_id
            ),
            TenantDictData,
            context,
        )
        if dict_label and dict_label.strip():
            filter_ = TenantDictData.dict_label.ilike(f"%{dict_label.strip()}%")
            statement = statement.where(filter_)
            count_statement = count_statement.where(filter_)
        if status is not None:
            statement = statement.where(TenantDictData.status == status)
            count_statement = count_statement.where(TenantDictData.status == status)
        total = self.db.scalar(count_statement) or 0
        rows = self.db.scalars(
            statement.order_by(TenantDictData.dict_sort, TenantDictData.dict_data_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return PageResult(
            items=tuple(self._data_result(row, type_row.dict_type) for row in rows),
            total=total,
            page=page,
            page_size=page_size,
        )

    def create_dict_data(
        self,
        dict_type_id: int,
        body: DictDataCreate,
        context: TenantContext,
    ) -> DictDataResult:
        self._authorize(context)
        type_row = self._get_type(context, dict_type_id)
        now = _now()
        row = TenantDictData(
            tenant_id=context.tenant_id,
            dict_type_id=type_row.dict_type_id,
            **body.model_dump(),
            created_by=context.actor_user_id,
            updated_by=context.actor_user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._flush(DictValueConflict)
        self.db.refresh(row)
        return self._data_result(row, type_row.dict_type)

    def reorder_dict_data(
        self,
        dict_type_id: int,
        body: DictReorder,
        context: TenantContext,
    ) -> DictReorderResult:
        self._authorize(context)
        self._get_type(context, dict_type_id)
        ids = [int(item.dict_data_id) for item in body.items]
        if len(ids) != len(set(ids)):
            raise DuplicateDictDataId("Dictionary data IDs must be unique")
        rows = list(
            self.db.scalars(
                self._data_statement(context, dict_type_id, lock=True)
            ).all()
        )
        if set(ids) != {row.dict_data_id for row in rows}:
            raise DictReorderSetMismatch("Dictionary data reorder set does not match type data")
        by_id = {row.dict_data_id: row for row in rows}
        for item in body.items:
            row = by_id[int(item.dict_data_id)]
            row.dict_sort = item.dict_sort
            row.updated_by = context.actor_user_id
            row.updated_at = _now()
        self._flush(DictValueConflict)
        return DictReorderResult(updated=len(rows))

    def get_dict_data(
        self,
        dict_type_id: int,
        dict_data_id: int,
        context: TenantContext,
    ) -> DictDataResult:
        self._authorize(context)
        type_row = self._get_type(context, dict_type_id)
        return self._data_result(
            self._get_data(context, dict_type_id, dict_data_id),
            type_row.dict_type,
        )

    def update_dict_data(
        self,
        dict_type_id: int,
        dict_data_id: int,
        body: DictDataPatch,
        context: TenantContext,
    ) -> DictDataResult:
        self._authorize(context)
        type_row = self._get_type(context, dict_type_id)
        row = self._get_data(context, dict_type_id, dict_data_id, lock=True)
        for name, value in body.model_dump(exclude_unset=True).items():
            setattr(row, name, value)
        row.updated_by = context.actor_user_id
        row.updated_at = _now()
        self._flush(DictValueConflict)
        self.db.refresh(row)
        return self._data_result(row, type_row.dict_type)

    def delete_dict_data(
        self,
        dict_type_id: int,
        dict_data_id: int,
        context: TenantContext,
    ) -> None:
        self._authorize(context)
        row = self._get_data(context, dict_type_id, dict_data_id, lock=True)
        self.db.delete(row)
        self._flush(DictValueConflict)

    def _authorize(self, context: TenantContext) -> None:
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    def _type_statement(
        self,
        context: TenantContext,
        dict_type_id: int | None = None,
        *,
        lock: bool = False,
    ):
        statement = tenant_scope(select(TenantDictType), TenantDictType, context)
        if dict_type_id is not None:
            statement = statement.where(TenantDictType.dict_type_id == dict_type_id)
        if lock:
            statement = statement.with_for_update()
        return statement

    def _data_statement(
        self,
        context: TenantContext,
        dict_type_id: int,
        dict_data_id: int | None = None,
        *,
        lock: bool = False,
    ):
        statement = tenant_scope(
            select(TenantDictData).where(TenantDictData.dict_type_id == dict_type_id),
            TenantDictData,
            context,
        )
        if dict_data_id is not None:
            statement = statement.where(TenantDictData.dict_data_id == dict_data_id)
        if lock:
            statement = statement.with_for_update()
        return statement

    def _get_type(
        self,
        context: TenantContext,
        dict_type_id: int,
        *,
        lock: bool = False,
    ) -> TenantDictType:
        row = self.db.scalar(self._type_statement(context, dict_type_id, lock=lock))
        if row is None:
            raise NotFoundError("Tenant dictionary type not found")
        return row

    def _get_data(
        self,
        context: TenantContext,
        dict_type_id: int,
        dict_data_id: int,
        *,
        lock: bool = False,
    ) -> TenantDictData:
        row = self.db.scalar(
            self._data_statement(
                context,
                dict_type_id,
                dict_data_id,
                lock=lock,
            )
        )
        if row is None:
            raise NotFoundError("Tenant dictionary data not found")
        return row

    def _flush(self, conflict_type: type[ConflictError]) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise conflict_type("Dictionary data conflicts with existing data") from exc

    @staticmethod
    def _type_result(row: TenantDictType) -> DictTypeResult:
        return DictTypeResult(
            dict_type_id=str(row.dict_type_id),
            tenant_id=str(row.tenant_id),
            dict_name=row.dict_name,
            dict_type=row.dict_type,
            order_num=row.order_num,
            status=row.status,
            remark=row.remark,
            created_by=str(row.created_by),
            updated_by=str(row.updated_by),
            created_at=_aware(row.created_at),
            updated_at=_aware(row.updated_at),
        )

    @staticmethod
    def _data_result(row: TenantDictData, dict_type: str) -> DictDataResult:
        return DictDataResult(
            dict_data_id=str(row.dict_data_id),
            tenant_id=str(row.tenant_id),
            dict_type_id=str(row.dict_type_id),
            dict_type=dict_type,
            dict_sort=row.dict_sort,
            dict_label=row.dict_label,
            dict_value=row.dict_value,
            css_class=row.css_class,
            list_class=row.list_class,
            is_default=row.is_default,
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

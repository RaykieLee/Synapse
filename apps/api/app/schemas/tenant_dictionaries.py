"""HTTP contracts for tenant-owned dictionary types and values."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


DICT_TYPE_PATTERN = r"^[A-Za-z][A-Za-z0-9_.-]{0,99}$"


class DictTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dict_name: str = Field(min_length=1, max_length=100)
    dict_type: str = Field(min_length=1, max_length=100, pattern=DICT_TYPE_PATTERN)
    order_num: int = Field(default=0, ge=0)
    status: str = Field(default="0", pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Dictionary name cannot be blank")
        return value


class DictTypePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dict_name: str | None = Field(default=None, min_length=1, max_length=100)
    dict_type: str | None = Field(default=None, min_length=1, max_length=100, pattern=DICT_TYPE_PATTERN)
    order_num: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Dictionary name cannot be blank")
        return value


class DictDataCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dict_sort: int = Field(default=0, ge=0)
    dict_label: str = Field(min_length=1, max_length=100)
    dict_value: str = Field(min_length=1, max_length=100)
    css_class: str | None = Field(default=None, max_length=100)
    list_class: str | None = Field(default=None, max_length=100)
    is_default: str = Field(default="N", pattern="^[YN]$")
    status: str = Field(default="0", pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_label", "dict_value")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Dictionary label and value cannot be blank")
        return value


class DictDataPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dict_sort: int | None = Field(default=None, ge=0)
    dict_label: str | None = Field(default=None, min_length=1, max_length=100)
    dict_value: str | None = Field(default=None, min_length=1, max_length=100)
    css_class: str | None = Field(default=None, max_length=100)
    list_class: str | None = Field(default=None, max_length=100)
    is_default: str | None = Field(default=None, pattern="^[YN]$")
    status: str | None = Field(default=None, pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("dict_label", "dict_value")
    @classmethod
    def non_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Dictionary label and value cannot be blank")
        return value


class DictOrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dict_data_id: str = Field(pattern=r"^[1-9][0-9]*$")
    dict_sort: int = Field(ge=0)


class DictReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DictOrderItem] = Field(min_length=1, max_length=1000)


class DictTypeOrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dict_type_id: str = Field(pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(ge=0)


class DictTypeReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DictTypeOrderItem] = Field(min_length=1, max_length=1000)


class DictTypeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class DictTypePageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[DictTypeResponse]
    total: int
    page: int
    page_size: int


class DictDataResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class DictDataPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[DictDataResponse]
    total: int
    page: int
    page_size: int


class DictReorderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    updated: int


class DictTypeReorderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    updated: int

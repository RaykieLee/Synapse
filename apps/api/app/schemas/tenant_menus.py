"""HTTP contracts for tenant-owned menu metadata and navigation trees."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class MenuResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class MenuTreeNodeResponse(MenuResponse):
    children: list[MenuTreeNodeResponse]


class MenuListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[MenuResponse]
    total: int


class MenuTreeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[MenuTreeNodeResponse]


class NavigationMenuResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
    children: list[NavigationMenuResponse]


class VisibleMenuTreeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tenant_id: str
    membership_version: int
    items: list[NavigationMenuResponse]


class MenuReorderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    updated: int

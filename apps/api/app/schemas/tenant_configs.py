"""HTTP contracts for tenant-owned parameter configurations."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


CONFIG_KEY_PATTERN = r"^[A-Za-z][A-Za-z0-9_.-]{0,99}$"


class ConfigCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config_name: str = Field(min_length=1, max_length=100)
    config_key: str = Field(min_length=1, max_length=100, pattern=CONFIG_KEY_PATTERN)
    config_value: str = Field(max_length=10000)
    group_name: str = Field(default="", max_length=100)
    is_frontend: bool = False
    is_sensitive: bool = False
    status: str = Field(default="0", pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("config_name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Configuration name cannot be blank")
        return value


class ConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config_name: str | None = Field(default=None, min_length=1, max_length=100)
    config_key: str | None = Field(default=None, min_length=1, max_length=100, pattern=CONFIG_KEY_PATTERN)
    config_value: str | None = Field(default=None, max_length=10000)
    group_name: str | None = Field(default=None, max_length=100)
    is_frontend: bool | None = None
    is_sensitive: bool | None = None
    status: str | None = Field(default=None, pattern="^[01]$")
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("config_name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Configuration name cannot be blank")
        return value


class ConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class ConfigPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[ConfigResponse]
    total: int
    page: int
    page_size: int


class PublicConfigItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str
    group: str


class PublicConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tenant_id: str
    items: list[PublicConfigItemResponse]

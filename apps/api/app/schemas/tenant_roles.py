"""HTTP contracts for tenant-scoped custom roles."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


ROLE_KEY_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"
RESERVED_ROLE_KEYS = {"owner", "admin", "member", "viewer", "platform_admin"}
TENANT_PERMISSIONS = frozenset(
    {
        "tenant:read",
        "tenant:update",
        "tenant:archive",
        "tenant_member:manage",
    }
)


class RoleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_name: str = Field(min_length=1, max_length=30)
    role_key: str = Field(min_length=1, max_length=64, pattern=ROLE_KEY_PATTERN)
    role_sort: int = Field(default=0, ge=0)
    status: str = Field(default="active", pattern="^(active|disabled)$")
    permissions: list[str] = Field(default_factory=list, max_length=64)
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("role_name")
    @classmethod
    def role_name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Role name cannot be blank")
        return value

    @field_validator("role_key")
    @classmethod
    def role_key_not_reserved(cls, value: str) -> str:
        if value in RESERVED_ROLE_KEYS:
            raise ValueError("Built-in role keys are reserved")
        return value

    @field_validator("permissions")
    @classmethod
    def permissions_are_supported(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Permission values must be unique")
        unsupported = set(value) - TENANT_PERMISSIONS
        if unsupported:
            raise ValueError("Unsupported tenant permission")
        return sorted(value)


class RolePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_name: str | None = Field(default=None, min_length=1, max_length=30)
    role_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=ROLE_KEY_PATTERN,
    )
    role_sort: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")
    permissions: list[str] | None = Field(default=None, max_length=64)
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("role_name")
    @classmethod
    def role_name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Role name cannot be blank")
        return value

    @field_validator("role_key")
    @classmethod
    def role_key_not_reserved(cls, value: str | None) -> str | None:
        if value is not None and value in RESERVED_ROLE_KEYS:
            raise ValueError("Built-in role keys are reserved")
        return value

    @field_validator("permissions")
    @classmethod
    def permissions_are_supported(
        cls, value: list[str] | None
    ) -> list[str] | None:
        if value is None:
            return value
        if len(value) != len(set(value)):
            raise ValueError("Permission values must be unique")
        if set(value) - TENANT_PERMISSIONS:
            raise ValueError("Unsupported tenant permission")
        return sorted(value)


class TenantRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role_id: str
    tenant_id: str
    scope: str
    role_name: str
    role_key: str
    role_sort: int
    status: str
    permissions: list[str]
    remark: str | None
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None


class TenantRolePageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[TenantRoleResponse]
    total: int
    page: int
    page_size: int

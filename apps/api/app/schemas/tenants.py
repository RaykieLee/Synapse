"""HTTP request and response contracts for the tenant domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class TenantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=64, pattern=SLUG)
    name: str = Field(min_length=1, max_length=120)
    first_owner_user_id: str = Field(pattern=r"^[0-9]+$")
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class TenantPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = Field(default=None, pattern="^(active|suspended|archived)$")
    settings: dict | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(pattern=r"^[0-9]+$")
    tenant_role: str = Field(default="member", pattern="^(owner|admin|member)$")


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_role: str | None = Field(default=None, pattern="^(owner|admin|member)$")
    status: str | None = Field(default=None, pattern="^(active|suspended|removed)$")


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    tenant_id: str
    slug: str
    name: str
    icon: str | None
    status: str
    workspace_role: str


class TenantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tenant_id: str
    slug: str
    name: str
    status: str
    valid_from: datetime | None
    valid_until: datetime | None
    settings: dict
    tenant_role: str | None
    membership_version: int
    created_at: datetime
    updated_at: datetime


class TenantWithWorkspacesResponse(TenantResponse):
    workspaces: list[WorkspaceResponse]


class TenantCreatedResponse(TenantResponse):
    default_workspace: WorkspaceResponse


class TenantContextUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    user_name: str
    nick_name: str | None


class TenantContextResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: TenantContextUserResponse
    tenants: list[TenantWithWorkspacesResponse]
    recent_workspace_id: None
    context_version: int


class TenantPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[TenantWithWorkspacesResponse]
    total: int
    page: int
    page_size: int


class PlatformTenantPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[TenantResponse]
    total: int
    page: int
    page_size: int


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    user_name: str
    nick_name: str | None
    email: str | None
    status: str
    tenant_role: str
    joined_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MemberPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[MemberResponse]
    total: int
    page: int
    page_size: int

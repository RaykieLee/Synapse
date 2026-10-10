"""HTTP request and response contracts for workspace management."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=64, pattern=SLUG)
    name: str = Field(min_length=1, max_length=120)
    icon: str | None = Field(default=None, max_length=64)


class WorkspacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    settings: dict | None = None


class WorkspaceMemberPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_role: str = Field(pattern="^(owner|admin|member|viewer)$")


class TransferOwnership(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_owner_user_id: str = Field(pattern=r"^[0-9]+$")


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    tenant_id: str
    slug: str
    name: str
    icon: str | None
    status: str
    settings: dict
    workspace_role: str | None
    membership_version: int
    created_by: str
    created_at: datetime
    updated_at: datetime


class WorkspacePageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[WorkspaceResponse]
    total: int
    page: int
    page_size: int


class WorkspaceMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    user_name: str
    nick_name: str | None
    email: str | None
    status: str
    workspace_role: str
    joined_at: datetime | None
    created_at: datetime
    updated_at: datetime


class WorkspaceMemberPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[WorkspaceMemberResponse]
    total: int
    page: int
    page_size: int


class WorkspaceMembershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    status: str
    workspace_role: str
    membership_version: int


class WorkspaceMemberRemovalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    status: str
    membership_version: int


class WorkspaceTransferResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    previous_owner_user_id: str
    new_owner_user_id: str
    membership_version: int

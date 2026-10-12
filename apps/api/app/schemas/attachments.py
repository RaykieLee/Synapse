"""HTTP contracts for workspace-scoped attachment operations."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


AttachmentScopeKind = Literal["workspace", "personal"]


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    attachment_id: str
    tenant_id: str
    workspace_id: str
    scope_kind: AttachmentScopeKind
    owner_user_id: str | None
    filename: str
    media_type: str
    size_bytes: int
    created_by: str
    created_at: datetime


class AttachmentPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[AttachmentResponse]
    total: int
    page: int
    page_size: int

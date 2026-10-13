"""HTTP contracts for provider, credential, and model binding management."""

from __future__ import annotations

from datetime import datetime
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProviderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider_type: str
    credential_type: str
    label: str
    capabilities: list[str]
    credential_schema_version: int
    supports_custom_model_id: bool
    supports_base_url: bool


class CredentialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: str = Field(default="openai_chat", max_length=64)
    name: str = Field(min_length=1, max_length=100)
    api_key: str = Field(min_length=1, max_length=4096)
    base_url: str = Field(min_length=1, max_length=500)
    organization: str | None = Field(default=None, max_length=200)

    @field_validator("name", "api_key", "base_url")
    @classmethod
    def no_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be blank")
        return value


class CredentialPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    organization: str | None = Field(default=None, max_length=200)


class CredentialResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    credential_id: str
    workspace_id: str
    provider_type: str
    name: str
    endpoint_host: str
    has_secret: bool
    owner: bool
    created_at: datetime
    updated_at: datetime


class ModelBindingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential_id: str = Field(min_length=1, max_length=36)
    display_name: str = Field(min_length=1, max_length=100)
    kind: str = Field(default="chat", pattern="^chat$")
    provider_type: str = Field(default="openai_chat", max_length=64)
    model: str = Field(min_length=1, max_length=200)
    capabilities: dict[str, object] = Field(default_factory=dict)
    default_parameters: dict[str, object] = Field(default_factory=dict)

    @field_validator("display_name", "model")
    @classmethod
    def no_blank(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Value cannot be blank or contain control characters")
        return value

    @field_validator("capabilities", "default_parameters")
    @classmethod
    def reject_secret_like_data(cls, value: dict[str, object]) -> dict[str, object]:
        _validate_public_model_data(value)
        return value


class ModelBindingPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=200)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")
    capabilities: dict[str, object] | None = None
    default_parameters: dict[str, object] | None = None

    @field_validator("capabilities", "default_parameters")
    @classmethod
    def reject_secret_like_data(cls, value: dict[str, object] | None) -> dict[str, object] | None:
        if value is not None:
            _validate_public_model_data(value)
        return value


class ModelBindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_binding_id: str
    workspace_id: str
    display_name: str
    kind: str
    provider_type: str
    credential_status: str
    credential_provider: str
    model: str
    status: str
    capabilities: dict[str, object]
    default_parameters: dict[str, object]
    created_by: str
    created_at: datetime
    updated_at: datetime


class ModelBindingReference(BaseModel):
    kind: str
    resource_id: str
    label: str


class ModelBindingReferencesResponse(BaseModel):
    model_binding_id: str
    references: list[ModelBindingReference]


_SECRET_KEY_MARKERS = (
    "apikey",
    "authorization",
    "token",
    "secret",
    "credential",
    "endpoint",
    "baseurl",
    "password",
    "privatekey",
    "accesskey",
    "keymaterial",
)


def _validate_public_model_data(value: object, path: str = "root") -> None:
    if isinstance(value, dict):
        for raw_key, child in value.items():
            key = str(raw_key)
            normalized = re.sub(r"[^a-z0-9]", "", key.lower())
            if normalized == "key" or any(marker in normalized for marker in _SECRET_KEY_MARKERS):
                raise ValueError(f"Secret-like model metadata field is not allowed: {path}.{key}")
            _validate_public_model_data(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_public_model_data(child, f"{path}[{index}]")

"""Application service for the first F32 provider/model management slice."""

from __future__ import annotations

import json
import ipaddress
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.model_provider import ModelBinding, ModelCredential
from app.schemas.model_provider import (
    CredentialCreate,
    CredentialPatch,
    ModelBindingCreate,
    ModelBindingPatch,
)
from app.services.errors import ConflictError, DomainValidationError, ForbiddenError, NotFoundError
from app.services.results import PageResult
from app.tenancy.context import WorkspaceContext


class ModelNameConflict(ConflictError):
    code = "MODEL_NAME_CONFLICT"


class CredentialInUse(ConflictError):
    code = "CREDENTIAL_IN_USE"


class ModelBindingInUse(ConflictError):
    code = "MODEL_BINDING_IN_USE"


class UnsupportedProvider(DomainValidationError):
    code = "UNSUPPORTED_PROVIDER"


class EndpointNotAllowed(DomainValidationError):
    code = "MODEL_ENDPOINT_NOT_ALLOWED"


class CredentialConflict(ConflictError):
    code = "CREDENTIAL_CONFLICT"


@dataclass(frozen=True)
class ProviderResult:
    provider_type: str
    credential_type: str
    label: str
    capabilities: tuple[str, ...]
    credential_schema_version: int
    supports_custom_model_id: bool
    supports_base_url: bool


@dataclass(frozen=True)
class CredentialResult:
    credential_id: str
    workspace_id: str
    provider_type: str
    name: str
    endpoint_host: str
    has_secret: bool
    owner: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ModelBindingResult:
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


@dataclass(frozen=True)
class ModelBindingReferencesResult:
    model_binding_id: str
    references: tuple[dict[str, str], ...]


PROVIDERS = (
    ProviderResult(
        provider_type="openai_chat",
        credential_type="openai_credential",
        label="OpenAI-compatible Chat",
        capabilities=("chat",),
        credential_schema_version=1,
        supports_custom_model_id=True,
        supports_base_url=True,
    ),
)


class ModelProviderService:
    def __init__(self, db: Session):
        self.db = db

    def list_providers(self) -> tuple[ProviderResult, ...]:
        return PROVIDERS

    def list_credentials(self, context: WorkspaceContext) -> tuple[CredentialResult, ...]:
        rows = self.db.scalars(
            select(ModelCredential)
            .where(
                ModelCredential.tenant_id == context.tenant_id,
                ModelCredential.workspace_id == context.workspace_id,
                ModelCredential.owner_user_id == context.actor_user_id,
            )
            .order_by(ModelCredential.created_at.desc(), ModelCredential.credential_id.desc())
        ).all()
        return tuple(self._credential_result(row, context) for row in rows)

    def create_credential(self, body: CredentialCreate, context: WorkspaceContext) -> CredentialResult:
        self._require_permission(context, "resource:create")
        self._provider(body.provider_type)
        base_url = _validate_endpoint(body.base_url)
        now = _now()
        row = ModelCredential(
            credential_id=str(uuid4()),
            tenant_id=context.tenant_id,
            workspace_id=context.workspace_id,
            owner_user_id=context.actor_user_id,
            provider_type=body.provider_type,
            name=body.name,
            base_url=base_url,
            organization=body.organization,
            encrypted_api_key=self._encrypt(body.api_key),
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self._flush_credential()
        return self._credential_result(row, context)

    def update_credential(
        self,
        credential_id: str,
        body: CredentialPatch,
        context: WorkspaceContext,
    ) -> CredentialResult:
        self._require_permission(context, "resource:update")
        row = self._get_credential(credential_id, context, owner_only=True)
        values = body.model_dump(exclude_unset=True)
        if not values:
            raise DomainValidationError("At least one credential field is required")
        if "base_url" in values:
            values["base_url"] = _validate_endpoint(values["base_url"])
        if "api_key" in values:
            values["encrypted_api_key"] = self._encrypt(values.pop("api_key"))
        for field, value in values.items():
            setattr(row, field, value)
        row.updated_at = _now()
        self._flush_credential()
        return self._credential_result(row, context)

    def delete_credential(self, credential_id: str, context: WorkspaceContext) -> None:
        self._require_permission(context, "resource:delete")
        row = self._get_credential(credential_id, context, owner_only=True)
        if self.db.scalar(
            select(ModelBinding.model_binding_id).where(
                ModelBinding.tenant_id == context.tenant_id,
                ModelBinding.workspace_id == context.workspace_id,
                ModelBinding.credential_id == row.credential_id,
            )
        ):
            raise CredentialInUse("Credential is referenced by a model binding")
        self.db.delete(row)
        self.db.flush()

    def list_models(self, context: WorkspaceContext) -> PageResult[ModelBindingResult]:
        rows = self.db.scalars(
            select(ModelBinding)
            .where(
                ModelBinding.tenant_id == context.tenant_id,
                ModelBinding.workspace_id == context.workspace_id,
            )
            .order_by(ModelBinding.created_at.desc(), ModelBinding.model_binding_id.desc())
        ).all()
        return PageResult(
            items=tuple(self._binding_result(row, context) for row in rows),
            total=len(rows),
            page=1,
            page_size=max(len(rows), 1),
        )

    def list_model_references(
        self,
        model_binding_id: str,
        context: WorkspaceContext,
    ) -> ModelBindingReferencesResult:
        self._get_model(model_binding_id, context)
        # No runtime consumer is wired in this slice. Keeping this projection
        # explicit prevents future consumers from being silently orphaned.
        return ModelBindingReferencesResult(model_binding_id, ())

    def create_model(self, body: ModelBindingCreate, context: WorkspaceContext) -> ModelBindingResult:
        self._require_manager(context)
        self._require_permission(context, "resource:create")
        self._provider(body.provider_type)
        credential = self._get_credential(body.credential_id, context, owner_only=True)
        if credential.provider_type != body.provider_type:
            raise DomainValidationError("Credential provider does not match model provider")
        row = ModelBinding(
            model_binding_id=str(uuid4()),
            tenant_id=context.tenant_id,
            workspace_id=context.workspace_id,
            credential_id=credential.credential_id,
            display_name=body.display_name,
            kind=body.kind,
            provider_type=body.provider_type,
            model=body.model,
            status="active",
            capabilities_json=json.dumps(body.capabilities, separators=(",", ":")),
            default_parameters_json=json.dumps(body.default_parameters, separators=(",", ":")),
            created_by=context.actor_user_id,
            updated_by=context.actor_user_id,
            created_at=_now(),
            updated_at=_now(),
        )
        self.db.add(row)
        self._flush_model()
        return self._binding_result(row, context)

    def update_model(
        self,
        model_binding_id: str,
        body: ModelBindingPatch,
        context: WorkspaceContext,
    ) -> ModelBindingResult:
        self._require_manager(context)
        self._require_permission(context, "resource:update")
        row = self._get_model(model_binding_id, context)
        values = body.model_dump(exclude_unset=True)
        if not values:
            raise DomainValidationError("At least one model field is required")
        for field in ("display_name", "model"):
            if field in values:
                values[field] = values[field].strip()
                if not values[field] or any(ord(char) < 32 for char in values[field]):
                    raise DomainValidationError("Model values cannot be blank or contain control characters")
        if "capabilities" in values:
            row.capabilities_json = json.dumps(values.pop("capabilities"), separators=(",", ":"))
        if "default_parameters" in values:
            row.default_parameters_json = json.dumps(values.pop("default_parameters"), separators=(",", ":"))
        for field, value in values.items():
            setattr(row, field, value)
        row.updated_by = context.actor_user_id
        row.updated_at = _now()
        self._flush_model()
        return self._binding_result(row, context)

    def delete_model(self, model_binding_id: str, context: WorkspaceContext) -> None:
        self._require_manager(context)
        self._require_permission(context, "resource:delete")
        row = self._get_model(model_binding_id, context)
        references = self.list_model_references(model_binding_id, context).references
        if references:
            raise ModelBindingInUse("Model binding is referenced by another resource")
        self.db.delete(row)
        self.db.flush()

    def _provider(self, provider_type: str) -> ProviderResult:
        for provider in PROVIDERS:
            if provider.provider_type == provider_type:
                return provider
        raise UnsupportedProvider("Provider is not supported")

    def _get_credential(self, credential_id: str, context: WorkspaceContext, *, owner_only: bool) -> ModelCredential:
        conditions = [
            ModelCredential.credential_id == credential_id,
            ModelCredential.tenant_id == context.tenant_id,
            ModelCredential.workspace_id == context.workspace_id,
        ]
        if owner_only:
            conditions.append(ModelCredential.owner_user_id == context.actor_user_id)
        row = self.db.scalar(
            select(ModelCredential).where(*conditions)
        )
        if row is None:
            raise NotFoundError("Model credential not found")
        return row

    def _get_model(self, model_binding_id: str, context: WorkspaceContext) -> ModelBinding:
        row = self.db.scalar(
            select(ModelBinding).where(
                ModelBinding.model_binding_id == model_binding_id,
                ModelBinding.tenant_id == context.tenant_id,
                ModelBinding.workspace_id == context.workspace_id,
            )
        )
        if row is None:
            raise NotFoundError("Model binding not found")
        return row

    @staticmethod
    def _require_permission(context: WorkspaceContext, permission: str) -> None:
        if permission not in context.permission_set:
            raise ForbiddenError(f"Workspace permission {permission} is required")

    @staticmethod
    def _require_manager(context: WorkspaceContext) -> None:
        if context.workspace_role not in {"owner", "admin"}:
            raise ForbiddenError("Workspace owner or admin role is required")

    def _credential_result(self, row: ModelCredential, context: WorkspaceContext) -> CredentialResult:
        return CredentialResult(
            credential_id=row.credential_id,
            workspace_id=str(row.workspace_id),
            provider_type=row.provider_type,
            name=row.name,
            endpoint_host=urlparse(row.base_url).netloc,
            has_secret=bool(row.encrypted_api_key),
            owner=row.owner_user_id == context.actor_user_id,
            created_at=_aware(row.created_at),
            updated_at=_aware(row.updated_at),
        )

    def _binding_result(self, row: ModelBinding, context: WorkspaceContext) -> ModelBindingResult:
        credential = self.db.get(ModelCredential, row.credential_id)
        owner = credential is not None and credential.owner_user_id == context.actor_user_id
        credential_status = "available" if owner and credential is not None else "owner_only"
        if credential is None:
            credential_status = "unavailable"
        return ModelBindingResult(
            model_binding_id=row.model_binding_id,
            workspace_id=str(row.workspace_id),
            display_name=row.display_name,
            kind=row.kind,
            provider_type=row.provider_type,
            credential_status=credential_status,
            credential_provider=row.provider_type,
            model=row.model,
            status=row.status,
            capabilities=_json_object(row.capabilities_json),
            default_parameters=_json_object(row.default_parameters_json),
            created_by=str(row.created_by),
            created_at=_aware(row.created_at),
            updated_at=_aware(row.updated_at),
        )

    def _encrypt(self, value: str) -> str:
        key = get_settings().agentscope_credential_encryption_key
        if key is None:
            raise DomainValidationError("Credential encryption is not configured")
        try:
            return Fernet(key.get_secret_value().encode("ascii")).encrypt(value.encode("utf-8")).decode("ascii")
        except (ValueError, UnicodeEncodeError) as exc:
            raise DomainValidationError("Credential encryption key is invalid") from exc

    def _flush_credential(self) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise CredentialConflict("Credential conflicts with an existing record") from exc

    def _flush_model(self) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise ModelNameConflict("Model display name already exists") from exc


def _validate_endpoint(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise EndpointNotAllowed("Endpoint must not contain credentials or query parameters")
    if parsed.scheme != "https":
        if not (
            get_settings().env == "development"
            and parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1"}
        ):
            raise EndpointNotAllowed("Endpoint must use HTTPS")
    if not parsed.hostname or not parsed.netloc:
        raise EndpointNotAllowed("Endpoint URL is invalid")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"0.0.0.0", "::", "::0"}:
        raise EndpointNotAllowed("Unspecified endpoints are not allowed")
    try:
        addresses = {
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, parsed.port, type=socket.SOCK_STREAM)
        }
    except OSError as exc:
        if not _is_allowed_development_localhost(parsed.scheme, hostname):
            raise EndpointNotAllowed("Endpoint hostname could not be resolved") from exc
        addresses = set()
    if not addresses and not _is_allowed_development_localhost(parsed.scheme, hostname):
        raise EndpointNotAllowed("Endpoint hostname could not be resolved")
    # DNS rebinding still requires an egress proxy or pinned DNS policy; this
    # check rejects every address returned at validation time.
    if hostname not in {"localhost", "127.0.0.1"} and any(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
        for address in addresses
    ):
        raise EndpointNotAllowed("Private network endpoints are not allowed")
    return value.rstrip("/")


def _is_allowed_development_localhost(scheme: str, hostname: str) -> bool:
    return (
        get_settings().env == "development"
        and scheme == "http"
        and hostname in {"localhost", "127.0.0.1"}
    )


def _json_object(value: str) -> dict[str, object]:
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)

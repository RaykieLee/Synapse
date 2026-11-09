"""Application service for workspace-scoped local attachments."""

from __future__ import annotations

import io
import logging
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database.session import register_rollback_cleanup
from app.integrations.attachment_storage import LocalAttachmentStore
from app.models.attachment import Attachment
from app.schemas.attachments import AttachmentScopeKind
from app.services.attachment_storage import (
    AttachmentBody,
    AttachmentObjectMissing,
    AttachmentStorageRouter,
    AttachmentStorageScope,
    AttachmentStoreCleanupFailed,
    AttachmentStoreUnavailable,
)
from app.services.errors import ServiceError
from app.services.results import PageResult
from app.tenancy.context import WorkspaceContext
from app.tenancy.scopes import personal_scope, personal_values, workspace_scope, workspace_values
from app.core.config import get_settings


logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_CONTENT_TYPES = {
    ".png": ("image/png",),
    ".jpg": ("image/jpeg",),
    ".jpeg": ("image/jpeg",),
    ".gif": ("image/gif",),
    ".webp": ("image/webp",),
    ".pdf": ("application/pdf",),
    ".txt": ("text/plain",),
    ".csv": ("text/csv", "application/vnd.ms-excel", "text/plain"),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",),
    ".pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation",),
}
_OFFICE_PARTS = {
    ".docx": "word/document.xml",
    ".xlsx": "xl/workbook.xml",
    ".pptx": "ppt/presentation.xml",
}


class AttachmentServiceError(ServiceError):
    """Base class for errors that retain the attachment wire contract."""

    status_code = 500


class AttachmentForbidden(AttachmentServiceError):
    status_code = 403
    code = "FORBIDDEN"


class AttachmentNotFound(AttachmentServiceError):
    status_code = 404
    code = "RESOURCE_NOT_FOUND"


class AttachmentFileNotFound(AttachmentServiceError):
    status_code = 404
    code = "FILE_NOT_FOUND"


class AttachmentFileTooLarge(AttachmentServiceError):
    status_code = 413
    code = "FILE_TOO_LARGE"


class AttachmentUnsupportedFileType(AttachmentServiceError):
    status_code = 415
    code = "UNSUPPORTED_FILE_TYPE"


class AttachmentFileTypeMismatch(AttachmentServiceError):
    status_code = 415
    code = "FILE_TYPE_MISMATCH"


class AttachmentInvalidFileContent(AttachmentServiceError):
    status_code = 415
    code = "INVALID_FILE_CONTENT"


class AttachmentInvalidFilename(AttachmentServiceError):
    status_code = 422
    code = "INVALID_FILENAME"


class AttachmentFilenameTooLong(AttachmentServiceError):
    status_code = 422
    code = "FILENAME_TOO_LONG"


class AttachmentEmptyFile(AttachmentServiceError):
    status_code = 422
    code = "EMPTY_FILE"


class AttachmentFileCleanupFailed(AttachmentServiceError):
    status_code = 500
    code = "FILE_CLEANUP_FAILED"


class AttachmentStorageUnavailable(AttachmentServiceError):
    status_code = 503
    code = "ATTACHMENT_STORAGE_UNAVAILABLE"


@dataclass(frozen=True)
class AttachmentDownload:
    body: AttachmentBody
    media_type: str
    filename: str
    size_bytes: int


class AttachmentService:
    """Attachment use cases bound to one request-scoped database session."""

    def __init__(self, db: Session, storage: AttachmentStorageRouter):
        self.db = db
        self.storage = storage

    def upload(
        self,
        context: WorkspaceContext,
        *,
        payload: bytes,
        filename: str | None,
        declared_type: str | None,
        scope_kind: AttachmentScopeKind,
    ) -> Attachment:
        self._permission(context, "resource:create")
        original_filename, suffix = self._safe_filename(filename)
        if not payload:
            raise AttachmentEmptyFile()
        if len(payload) > MAX_UPLOAD_BYTES:
            raise AttachmentFileTooLarge()
        media_type = self._validated_media_type(
            original_filename,
            suffix,
            declared_type,
            payload,
        )

        attachment_id = str(uuid.uuid4())
        storage_key = uuid.uuid4().hex
        storage_backend = self.storage.default_backend
        try:
            store = self.storage.store_for(storage_backend)
        except AttachmentStoreUnavailable as exc:
            raise AttachmentStorageUnavailable() from exc
        scope = self._scope_for_values(
            tenant_id=context.tenant_id,
            workspace_id=context.workspace_id,
            scope_kind=scope_kind,
            owner_user_id=context.actor_user_id if scope_kind == "personal" else None,
        )
        object_written = False

        try:
            try:
                store.put(storage_key, scope, payload, media_type)
            except AttachmentStoreUnavailable as exc:
                raise AttachmentStorageUnavailable() from exc
            object_written = True
            # The request transaction owns the metadata commit. If it fails,
            # get_db() invokes this compensation callback after rollback.
            register_rollback_cleanup(
                self.db,
                lambda: self._cleanup_storage_object(store, storage_key, scope),
            )
            values = {
                "attachment_id": attachment_id,
                "scope_kind": scope_kind,
                "original_filename": original_filename,
                "media_type": media_type,
                "size_bytes": len(payload),
                "storage_backend": storage_backend,
                "storage_key": storage_key,
            }
            if scope_kind == "personal":
                row = Attachment(**personal_values(context, **values))
            else:
                row = Attachment(**workspace_values(context, **values))
            self.db.add(row)
            self.db.flush()
            return row
        except Exception:
            if object_written:
                self._cleanup_storage_object(store, storage_key, scope)
            raise

    def list_attachments(
        self,
        context: WorkspaceContext,
        *,
        scope_kind: AttachmentScopeKind,
        page: int,
        page_size: int,
    ) -> PageResult[Attachment]:
        self._permission(context, "resource:read")
        statement = self._statement(context, scope_kind)
        total = self.db.scalar(select(func.count()).select_from(statement.subquery())) or 0
        rows = self.db.scalars(
            statement.order_by(
                Attachment.created_at.desc(),
                Attachment.attachment_id,
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return PageResult(
            items=tuple(rows),
            total=total,
            page=page,
            page_size=page_size,
        )

    def download(
        self,
        context: WorkspaceContext,
        *,
        scope_kind: AttachmentScopeKind,
        attachment_id: str,
    ) -> AttachmentDownload:
        self._permission(context, "resource:read")
        row = self._get_attachment(context, scope_kind, attachment_id)
        try:
            body = self.storage.store_for(row.storage_backend).open(
                row.storage_key,
                self._scope_for_row(row),
            )
        except AttachmentObjectMissing as exc:
            raise AttachmentFileNotFound() from exc
        except AttachmentStoreUnavailable as exc:
            raise AttachmentStorageUnavailable() from exc
        return AttachmentDownload(
            body=body,
            media_type=row.media_type,
            filename=row.original_filename,
            size_bytes=row.size_bytes,
        )

    def delete(
        self,
        context: WorkspaceContext,
        *,
        scope_kind: AttachmentScopeKind,
        attachment_id: str,
    ) -> None:
        row = self._get_attachment(context, scope_kind, attachment_id)
        if scope_kind == "workspace":
            self._permission(context, "resource:delete")
        elif row.owner_user_id != context.actor_user_id:
            raise AttachmentNotFound()

        scope = self._scope_for_row(row)
        try:
            self.storage.store_for(row.storage_backend).delete(row.storage_key, scope)
            alternate_store = self.storage.alternate_store_for(row.storage_backend)
            if alternate_store is not None:
                alternate_store.delete(row.storage_key, scope)
        except AttachmentStoreCleanupFailed as exc:
            raise AttachmentFileCleanupFailed() from exc
        except AttachmentStoreUnavailable as exc:
            raise AttachmentStorageUnavailable() from exc
        statement = delete(Attachment).where(
            Attachment.attachment_id == row.attachment_id,
            Attachment.tenant_id == context.tenant_id,
            Attachment.workspace_id == context.workspace_id,
            Attachment.scope_kind == scope_kind,
        )
        if scope_kind == "personal":
            statement = statement.where(Attachment.owner_user_id == context.actor_user_id)
        self.db.execute(statement)
        self.db.flush()

    def _permission(self, context: WorkspaceContext, permission: str) -> None:
        if permission not in context.permission_set:
            raise AttachmentForbidden()

    def _statement(
        self,
        context: WorkspaceContext,
        scope_kind: AttachmentScopeKind,
        attachment_id: str | None = None,
    ):
        statement = select(Attachment)
        if scope_kind == "workspace":
            statement = workspace_scope(
                statement,
                Attachment,
                context,
            ).where(Attachment.scope_kind == "workspace")
        else:
            statement = personal_scope(
                statement,
                Attachment,
                context,
            ).where(Attachment.scope_kind == "personal")
        if attachment_id is not None:
            statement = statement.where(Attachment.attachment_id == attachment_id)
        return statement

    def _get_attachment(
        self,
        context: WorkspaceContext,
        scope_kind: AttachmentScopeKind,
        attachment_id: str,
    ) -> Attachment:
        row = self.db.scalar(self._statement(context, scope_kind, attachment_id))
        if row is None:
            raise AttachmentNotFound()
        return row

    @staticmethod
    def _scope_for_values(
        *,
        tenant_id: int,
        workspace_id: int,
        scope_kind: AttachmentScopeKind,
        owner_user_id: int | None,
    ) -> AttachmentStorageScope:
        return AttachmentStorageScope(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            scope_kind=scope_kind,
            owner_user_id=owner_user_id,
        )

    @classmethod
    def _scope_for_row(cls, row: Attachment) -> AttachmentStorageScope:
        return cls._scope_for_values(
            tenant_id=row.tenant_id,
            workspace_id=row.workspace_id,
            scope_kind=row.scope_kind,
            owner_user_id=row.owner_user_id,
        )

    @staticmethod
    def _safe_filename(filename: str | None) -> tuple[str, str]:
        raw = (filename or "").replace("\\", "/")
        raw = raw.rsplit("/", 1)[-1]
        raw = unicodedata.normalize("NFKC", raw)
        raw = "".join(
            char for char in raw if char >= " " and char != "\x7f"
        ).strip().strip(".")
        if not raw or raw in {".", ".."}:
            raise AttachmentInvalidFilename()
        if len(raw) > 255:
            raise AttachmentFilenameTooLong()
        suffix = Path(raw).suffix.lower()
        if suffix not in _CONTENT_TYPES:
            raise AttachmentUnsupportedFileType()
        return raw, suffix

    @staticmethod
    def _validated_media_type(
        filename: str,
        suffix: str,
        declared_type: str | None,
        payload: bytes,
    ) -> str:
        del filename
        expected = _CONTENT_TYPES[suffix]
        declared = (
            (declared_type or "application/octet-stream")
            .split(";", 1)[0]
            .strip()
            .lower()
        )
        if declared not in (*expected, "application/octet-stream"):
            raise AttachmentFileTypeMismatch()
        valid = False
        if suffix == ".png":
            valid = payload.startswith(b"\x89PNG\r\n\x1a\n")
        elif suffix in {".jpg", ".jpeg"}:
            valid = payload.startswith(b"\xff\xd8\xff")
        elif suffix == ".gif":
            valid = payload.startswith((b"GIF87a", b"GIF89a"))
        elif suffix == ".webp":
            valid = (
                len(payload) >= 12
                and payload[:4] == b"RIFF"
                and payload[8:12] == b"WEBP"
            )
        elif suffix == ".pdf":
            valid = payload.startswith(b"%PDF-")
        elif suffix in {".txt", ".csv"}:
            try:
                decoded = payload.decode("utf-8-sig")
                valid = "\x00" not in decoded
            except UnicodeDecodeError:
                valid = False
        elif suffix in _OFFICE_PARTS:
            try:
                with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                    names = set(archive.namelist())
                    valid = (
                        "[Content_Types].xml" in names
                        and _OFFICE_PARTS[suffix] in names
                    )
            except (OSError, zipfile.BadZipFile):
                valid = False
        if not valid:
            raise AttachmentInvalidFileContent()
        return expected[0]

    @staticmethod
    def _storage_path(storage_key: str) -> Path:
        return LocalAttachmentStore(
            get_settings().attachments_storage_path
        ).path_for_key(storage_key)

    @staticmethod
    def _cleanup_storage_object(
        store,
        storage_key: str,
        scope: AttachmentStorageScope,
    ) -> None:
        try:
            store.delete(storage_key, scope)
        except Exception:
            logger.warning(
                "Attachment storage cleanup failed; reconciliation may detect an untracked object"
            )


def aware_datetime(value: datetime) -> datetime:
    """Normalize SQLite's naive UTC values for the HTTP response schema."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value

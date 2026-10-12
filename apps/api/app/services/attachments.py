"""Application service for workspace-scoped local attachments."""

from __future__ import annotations

import io
import os
import re
import time
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
from app.models.attachment import Attachment
from app.schemas.attachments import AttachmentScopeKind
from app.services.errors import ServiceError
from app.services.results import PageResult
from app.tenancy.context import WorkspaceContext
from app.tenancy.scopes import personal_scope, personal_values, workspace_scope, workspace_values
from app.core.config import get_settings


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_STORAGE_KEY = re.compile(r"^[a-f0-9]{32}$")
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


@dataclass(frozen=True)
class AttachmentDownload:
    path: Path
    media_type: str
    filename: str


class AttachmentService:
    """Attachment use cases bound to one request-scoped database session."""

    def __init__(self, db: Session):
        self.db = db

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
        path = self._storage_path(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")

        try:
            temporary_path.write_bytes(payload)
            os.replace(temporary_path, path)
            # The request transaction owns the metadata commit. If that
            # commit fails after this method returns, get_db() invokes this
            # compensation callback after rolling the metadata back.
            register_rollback_cleanup(
                self.db,
                lambda: self._cleanup_upload_paths(temporary_path, path),
            )
            values = {
                "attachment_id": attachment_id,
                "scope_kind": scope_kind,
                "original_filename": original_filename,
                "media_type": media_type,
                "size_bytes": len(payload),
                "storage_key": storage_key,
            }
            if scope_kind == "personal":
                row = Attachment(**personal_values(context, **values))
            else:
                row = Attachment(**workspace_values(context, **values))
            self.db.add(row)
            try:
                self.db.flush()
            except Exception:
                self._cleanup_upload_paths(temporary_path, path)
                raise
            return row
        except Exception:
            self._cleanup_upload_paths(temporary_path, path)
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
        path = self._storage_path(row.storage_key)
        if not path.is_file():
            raise AttachmentFileNotFound()
        return AttachmentDownload(
            path=path,
            media_type=row.media_type,
            filename=row.original_filename,
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

        path = self._storage_path(row.storage_key)
        self._unlink_storage_file(path)
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
        try:
            path.parent.rmdir()
        except OSError:
            pass

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
        if not _STORAGE_KEY.fullmatch(storage_key):
            raise RuntimeError("Invalid persisted attachment storage key")
        root = get_settings().attachments_storage_path.expanduser().resolve()
        path = (root / storage_key[:2] / storage_key[2:]).resolve()
        if root not in path.parents:
            raise RuntimeError("Attachment path escaped configured storage root")
        return path

    @staticmethod
    def _cleanup_upload_paths(*paths: Path) -> None:
        for path in paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                # Cleanup is compensating work; the original request error
                # remains the authoritative failure.
                pass

    @staticmethod
    def _unlink_storage_file(path: Path) -> None:
        """Remove a stored object while tolerating a short Windows race."""
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError as initial_error:
            last_error = initial_error
        except OSError as exc:
            raise AttachmentFileCleanupFailed() from exc

        for delay in (0.01, 0.05, 0.1):
            try:
                path.stat()
            except FileNotFoundError:
                return
            except OSError as exc:
                raise AttachmentFileCleanupFailed() from exc

            time.sleep(delay)
            try:
                path.unlink(missing_ok=True)
            except FileNotFoundError:
                return
            except PermissionError as exc:
                last_error = exc
            except OSError as exc:
                raise AttachmentFileCleanupFailed() from exc
            else:
                return

        try:
            path.stat()
        except FileNotFoundError:
            return
        except OSError as exc:
            raise AttachmentFileCleanupFailed() from exc
        raise AttachmentFileCleanupFailed() from last_error


def aware_datetime(value: datetime) -> datetime:
    """Normalize SQLite's naive UTC values for the HTTP response schema."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value

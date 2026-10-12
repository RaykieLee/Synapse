"""Authenticated local file storage for tenant/workspace attachments."""
from __future__ import annotations

import io
import mimetypes
import os
import re
import time
import unicodedata
import uuid
import zipfile
from datetime import timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import get_db
from app.models.attachment import Attachment
from app.tenancy.context import WorkspaceContext, get_workspace_context
from app.tenancy.scopes import personal_scope, personal_values, workspace_scope, workspace_values

router = APIRouter(prefix="/workspaces/{workspace_id}/attachments", tags=["attachments"])
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


def _fail(status: int, code: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code})


def _permission(context: WorkspaceContext, permission: str) -> None:
    if permission not in context.permission_set:
        _fail(403, "FORBIDDEN")


def _safe_filename(filename: str | None) -> tuple[str, str]:
    raw = (filename or "").replace("\\", "/")
    raw = raw.rsplit("/", 1)[-1]
    raw = unicodedata.normalize("NFKC", raw)
    raw = "".join(char for char in raw if char >= " " and char != "\x7f").strip().strip(".")
    if not raw or raw in {".", ".."}:
        _fail(422, "INVALID_FILENAME")
    if len(raw) > 255:
        _fail(422, "FILENAME_TOO_LONG")
    suffix = Path(raw).suffix.lower()
    if suffix not in _CONTENT_TYPES:
        _fail(415, "UNSUPPORTED_FILE_TYPE")
    return raw, suffix


def _validated_media_type(filename: str, suffix: str, declared_type: str | None, payload: bytes) -> str:
    expected = _CONTENT_TYPES[suffix]
    declared = (declared_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if declared not in (*expected, "application/octet-stream"):
        _fail(415, "FILE_TYPE_MISMATCH")
    valid = False
    if suffix == ".png":
        valid = payload.startswith(b"\x89PNG\r\n\x1a\n")
    elif suffix in {".jpg", ".jpeg"}:
        valid = payload.startswith(b"\xff\xd8\xff")
    elif suffix == ".gif":
        valid = payload.startswith((b"GIF87a", b"GIF89a"))
    elif suffix == ".webp":
        valid = len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP"
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
                valid = "[Content_Types].xml" in names and _OFFICE_PARTS[suffix] in names
        except (OSError, zipfile.BadZipFile):
            valid = False
    if not valid:
        _fail(415, "INVALID_FILE_CONTENT")
    return expected[0]


def _storage_path(storage_key: str) -> Path:
    if not _STORAGE_KEY.fullmatch(storage_key):
        raise RuntimeError("Invalid persisted attachment storage key")
    root = get_settings().attachments_storage_path.expanduser().resolve()
    path = (root / storage_key[:2] / storage_key[2:]).resolve()
    if root not in path.parents:
        raise RuntimeError("Attachment path escaped configured storage root")
    return path


def _unlink_storage_file(path: Path) -> None:
    """Remove a stored object while tolerating a short Windows unlink race."""
    try:
        path.unlink(missing_ok=True)
        return
    except PermissionError as initial_error:
        last_error = initial_error
    except OSError as exc:
        raise HTTPException(status_code=500, detail={"code": "FILE_CLEANUP_FAILED"}) from exc

    for delay in (0.01, 0.05, 0.1):
        try:
            path.stat()
        except FileNotFoundError:
            return
        except OSError as exc:
            raise HTTPException(status_code=500, detail={"code": "FILE_CLEANUP_FAILED"}) from exc

        time.sleep(delay)
        try:
            path.unlink(missing_ok=True)
        except FileNotFoundError:
            return
        except PermissionError as exc:
            last_error = exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail={"code": "FILE_CLEANUP_FAILED"}) from exc
        else:
            return

    try:
        path.stat()
    except FileNotFoundError:
        return
    except OSError as exc:
        raise HTTPException(status_code=500, detail={"code": "FILE_CLEANUP_FAILED"}) from exc
    raise HTTPException(status_code=500, detail={"code": "FILE_CLEANUP_FAILED"}) from last_error


def _statement(context: WorkspaceContext, scope_kind: str, attachment_id: str | None = None):
    statement = select(Attachment)
    if scope_kind == "workspace":
        statement = workspace_scope(statement, Attachment, context).where(Attachment.scope_kind == "workspace")
    else:
        statement = personal_scope(statement, Attachment, context).where(Attachment.scope_kind == "personal")
    if attachment_id is not None:
        statement = statement.where(Attachment.attachment_id == attachment_id)
    return statement


def _get_attachment(db: Session, context: WorkspaceContext, scope_kind: str, attachment_id: str) -> Attachment:
    row = db.scalar(_statement(context, scope_kind, attachment_id))
    if row is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return row


def _data(row: Attachment) -> dict:
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {
        "attachment_id": row.attachment_id,
        "tenant_id": str(row.tenant_id),
        "workspace_id": str(row.workspace_id),
        "scope_kind": row.scope_kind,
        "owner_user_id": str(row.owner_user_id) if row.owner_user_id is not None else None,
        "filename": row.original_filename,
        "media_type": row.media_type,
        "size_bytes": row.size_bytes,
        "created_by": str(row.created_by),
        "created_at": created.isoformat(),
    }


@router.post("", status_code=201)
def upload_attachment(
    file: UploadFile = File(...),
    scope_kind: str = Form(default="workspace", pattern="^(workspace|personal)$"),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    _permission(context, "resource:create")
    original_filename, suffix = _safe_filename(file.filename)
    payload = file.file.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        _fail(422, "EMPTY_FILE")
    if len(payload) > MAX_UPLOAD_BYTES:
        _fail(413, "FILE_TOO_LARGE")
    media_type = _validated_media_type(original_filename, suffix, file.content_type, payload)
    attachment_id = str(uuid.uuid4())
    storage_key = uuid.uuid4().hex
    path = _storage_path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary_path.write_bytes(payload)
        os.replace(temporary_path, path)
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
        db.add(row)
        db.commit()
        db.refresh(row)
        return _data(row)
    except Exception:
        db.rollback()
        temporary_path.unlink(missing_ok=True)
        path.unlink(missing_ok=True)
        raise
    finally:
        file.file.close()


@router.get("")
def list_attachments(
    scope_kind: str = Query(default="workspace", pattern="^(workspace|personal)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    _permission(context, "resource:read")
    statement = _statement(context, scope_kind)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.scalars(statement.order_by(Attachment.created_at.desc(), Attachment.attachment_id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_data(row) for row in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{attachment_id}/download")
def download_attachment(
    attachment_id: str,
    scope_kind: str = Query(default="workspace", pattern="^(workspace|personal)$"),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    _permission(context, "resource:read")
    row = _get_attachment(db, context, scope_kind, attachment_id)
    path = _storage_path(row.storage_key)
    if not path.is_file():
        _fail(404, "FILE_NOT_FOUND")
    return FileResponse(path, media_type=row.media_type, filename=row.original_filename,
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(
    attachment_id: str,
    scope_kind: str = Query(default="workspace", pattern="^(workspace|personal)$"),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    row = _get_attachment(db, context, scope_kind, attachment_id)
    if scope_kind == "workspace":
        _permission(context, "resource:delete")
    elif row.owner_user_id != context.actor_user_id:
        _fail(404, "RESOURCE_NOT_FOUND")
    path = _storage_path(row.storage_key)
    _unlink_storage_file(path)
    # Keep the row available for an API retry if unlink fails. Delete the row
    # conditionally after unlink so concurrent requests are idempotent. If the
    # DB commit fails after unlink, the retained row points at a missing file;
    # the next DELETE treats that as success and removes the metadata.
    statement = delete(Attachment).where(
        Attachment.attachment_id == row.attachment_id,
        Attachment.tenant_id == context.tenant_id,
        Attachment.workspace_id == context.workspace_id,
        Attachment.scope_kind == scope_kind,
    )
    if scope_kind == "personal":
        statement = statement.where(Attachment.owner_user_id == context.actor_user_id)
    db.execute(statement)
    db.commit()
    try:
        path.parent.rmdir()
    except OSError:
        pass
    return None

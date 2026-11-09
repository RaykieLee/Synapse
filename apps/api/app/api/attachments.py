"""HTTP adapter for workspace-scoped attachment operations."""

from __future__ import annotations

from datetime import timezone
from typing import NoReturn
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import get_db
from app.integrations.attachment_storage import create_attachment_storage
from app.models.attachment import Attachment
from app.schemas.attachments import (
    AttachmentPageResponse,
    AttachmentResponse,
    AttachmentScopeKind,
)
from app.services.attachments import (
    MAX_UPLOAD_BYTES,
    AttachmentService,
    AttachmentServiceError,
    AttachmentStorageUnavailable,
)
from app.services.attachment_storage import AttachmentStoreUnavailable
from app.tenancy.context import WorkspaceContext, get_workspace_context


router = APIRouter(prefix="/workspaces/{workspace_id}/attachments", tags=["attachments"])


def _service(db: Session) -> AttachmentService:
    try:
        storage = create_attachment_storage(get_settings())
    except AttachmentStoreUnavailable as exc:
        raise AttachmentStorageUnavailable() from exc
    return AttachmentService(db, storage)


def _raise_attachment_error(error: AttachmentServiceError) -> NoReturn:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code},
    ) from error


def _response(row: Attachment) -> AttachmentResponse:
    created_at = row.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return AttachmentResponse(
        attachment_id=row.attachment_id,
        tenant_id=str(row.tenant_id),
        workspace_id=str(row.workspace_id),
        scope_kind=row.scope_kind,
        owner_user_id=(
            str(row.owner_user_id) if row.owner_user_id is not None else None
        ),
        filename=row.original_filename,
        media_type=row.media_type,
        size_bytes=row.size_bytes,
        created_by=str(row.created_by),
        created_at=created_at,
    )


def _stream_body(body):
    try:
        while chunk := body.read(64 * 1024):
            yield chunk
    finally:
        body.close()


def _content_disposition(filename: str) -> str:
    fallback = filename.encode("ascii", "ignore").decode("ascii")
    fallback = fallback.replace("\\", "").replace('"', "") or "attachment"
    encoded = quote(filename, safe="")
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{encoded}'


@router.post("", response_model=AttachmentResponse, status_code=201)
def upload_attachment(
    file: UploadFile = File(...),
    scope_kind: AttachmentScopeKind = Form(default="workspace"),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    try:
        payload = file.file.read(MAX_UPLOAD_BYTES + 1)
        row = _service(db).upload(
            context,
            payload=payload,
            filename=file.filename,
            declared_type=file.content_type,
            scope_kind=scope_kind,
        )
        return _response(row)
    except AttachmentServiceError as error:
        _raise_attachment_error(error)
    finally:
        file.file.close()


@router.get("", response_model=AttachmentPageResponse)
def list_attachments(
    scope_kind: AttachmentScopeKind = Query(default="workspace"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    try:
        result = _service(db).list_attachments(
            context,
            scope_kind=scope_kind,
            page=page,
            page_size=page_size,
        )
        return AttachmentPageResponse(
            items=[_response(row) for row in result.items],
            total=result.total,
            page=result.page,
            page_size=result.page_size,
        )
    except AttachmentServiceError as error:
        _raise_attachment_error(error)


@router.get("/{attachment_id}/download")
def download_attachment(
    attachment_id: str,
    scope_kind: AttachmentScopeKind = Query(default="workspace"),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    try:
        download = _service(db).download(
            context,
            scope_kind=scope_kind,
            attachment_id=attachment_id,
        )
        return StreamingResponse(
            _stream_body(download.body),
            media_type=download.media_type,
            headers={
                "Content-Disposition": _content_disposition(download.filename),
                "Content-Length": str(download.size_bytes),
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except AttachmentServiceError as error:
        _raise_attachment_error(error)


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(
    attachment_id: str,
    scope_kind: AttachmentScopeKind = Query(default="workspace"),
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    try:
        _service(db).delete(
            context,
            scope_kind=scope_kind,
            attachment_id=attachment_id,
        )
    except AttachmentServiceError as error:
        _raise_attachment_error(error)

"""Read-only tenant-scoped local and S3 attachment consistency handler."""
import re
import stat

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.integrations.attachment_storage import create_attachment_storage
from app.models.attachment import Attachment
from app.services.attachment_storage import (
    AttachmentObjectInventory,
    AttachmentObjectMissing,
    AttachmentStorageRouter,
    AttachmentStorageScope,
    AttachmentStoreUnavailable,
)
from app.models.tenant import Tenant

TASK_TARGET = "tenant.reconcile_attachment_metadata"
_STORAGE_KEY = re.compile(r"^[a-f0-9]{32}$")


def reconcile_attachment_metadata(
    db: Session,
    tenant_id: int,
    *,
    storage: AttachmentStorageRouter | None = None,
) -> dict:
    """Check metadata-referenced objects for one trusted tenant only.

    This handler is deliberately read-only. It does not traverse the shared
    local storage tree; S3 inventory is restricted to one tenant prefix. It does
    not modify metadata or remove objects. `tenant_id` must come from trusted
    persisted task context, never directly from request input.
    """
    if type(tenant_id) is not int or tenant_id < 1:
        raise ValueError("tenant_id must be a positive integer")
    if db.scalar(select(Tenant.tenant_id).where(Tenant.tenant_id == tenant_id)) is None:
        raise LookupError("scheduled task tenant does not exist")

    settings = get_settings()
    storage = storage or create_attachment_storage(settings)
    root = settings.attachments_storage_path.expanduser().resolve()
    rows = db.scalars(
        select(Attachment).where(Attachment.tenant_id == tenant_id)
        .order_by(Attachment.attachment_id)
    ).yield_per(500)

    exception_ids: dict[str, list[str]] = {
        "invalid_storage_key": [],
        "invalid_storage_backend": [],
        "invalid_storage_scope": [],
        "storage_path_outside_root": [],
        "missing_file": [],
        "not_regular_file": [],
        "unreadable_file": [],
        "size_mismatch": [],
        "storage_unavailable": [],
    }
    metadata_count = 0
    present_files = 0
    consistent_files = 0
    tracked_s3_objects: set[tuple[str, AttachmentStorageScope]] = set()

    for row in rows:
        metadata_count += 1
        attachment_id = row.attachment_id
        storage_key = row.storage_key
        if not isinstance(storage_key, str) or not _STORAGE_KEY.fullmatch(storage_key):
            exception_ids["invalid_storage_key"].append(attachment_id)
            continue
        if row.storage_backend == "s3":
            scope = AttachmentStorageScope(
                tenant_id=row.tenant_id,
                workspace_id=row.workspace_id,
                scope_kind=row.scope_kind,
                owner_user_id=row.owner_user_id,
            )
            tracked_s3_objects.add((storage_key, scope))
            try:
                object_size = storage.store_for("s3").size(storage_key, scope)
            except RuntimeError:
                tracked_s3_objects.discard((storage_key, scope))
                exception_ids["invalid_storage_scope"].append(attachment_id)
                continue
            except AttachmentObjectMissing:
                exception_ids["missing_file"].append(attachment_id)
                continue
            except AttachmentStoreUnavailable:
                exception_ids["storage_unavailable"].append(attachment_id)
                continue
            present_files += 1
            if object_size != row.size_bytes:
                exception_ids["size_mismatch"].append(attachment_id)
                continue
            consistent_files += 1
            continue
        if row.storage_backend != "local":
            exception_ids["invalid_storage_backend"].append(attachment_id)
            continue
        shard_path = root / storage_key[:2]
        candidate = shard_path / storage_key[2:]
        try:
            if shard_path.is_symlink() or candidate.is_symlink():
                exception_ids["not_regular_file"].append(attachment_id)
                continue
        except OSError:
            exception_ids["unreadable_file"].append(attachment_id)
            continue
        try:
            path = candidate.resolve()
        except (OSError, RuntimeError):
            exception_ids["storage_path_outside_root"].append(attachment_id)
            continue
        if root not in path.parents:
            exception_ids["storage_path_outside_root"].append(attachment_id)
            continue
        try:
            file_stat = path.stat()
        except FileNotFoundError:
            exception_ids["missing_file"].append(attachment_id)
            continue
        except OSError:
            exception_ids["unreadable_file"].append(attachment_id)
            continue
        if not stat.S_ISREG(file_stat.st_mode):
            exception_ids["not_regular_file"].append(attachment_id)
            continue
        present_files += 1
        if file_stat.st_size != row.size_bytes:
            exception_ids["size_mismatch"].append(attachment_id)
            continue
        consistent_files += 1

    s3_orphan_object_count = None
    s3_orphan_scan_status = "not_configured"
    if storage.s3 is not None:
        if isinstance(storage.s3, AttachmentObjectInventory):
            try:
                s3_orphan_object_count = storage.s3.count_orphan_objects(
                    tenant_id,
                    tracked_s3_objects,
                )
            except AttachmentStoreUnavailable:
                s3_orphan_scan_status = "unavailable"
            else:
                s3_orphan_scan_status = "complete"
        else:
            s3_orphan_scan_status = "unsupported"

    exception_count = sum(len(ids) for ids in exception_ids.values())
    return {
        "task_target": TASK_TARGET,
        "tenant_id": str(tenant_id),
        "metadata_count": metadata_count,
        "present_file_count": present_files,
        "consistent_file_count": consistent_files,
        "exception_count": exception_count,
        "exception_ids": exception_ids,
        "s3_orphan_object_count": s3_orphan_object_count,
        "s3_orphan_scan_status": s3_orphan_scan_status,
        "read_only": True,
    }

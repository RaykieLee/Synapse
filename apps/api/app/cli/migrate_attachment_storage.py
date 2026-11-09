"""Copy attachment objects between local and S3 storage with verification."""

from __future__ import annotations

import argparse
import hashlib
import hmac

from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.database.session import get_session_factory
from app.integrations.attachment_storage import create_attachment_storage
from app.models.attachment import Attachment
from app.services.attachment_storage import (
    AttachmentStorageScope,
    AttachmentStoreError,
    AttachmentStoreUnavailable,
)
from app.services.attachments import MAX_UPLOAD_BYTES


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "s3"), default="s3")
    parser.add_argument("--tenant-id", type=int)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="copy, verify, and update metadata; without this flag the command is a dry run",
    )
    return parser


def _scope_for_row(row: Attachment) -> AttachmentStorageScope:
    return AttachmentStorageScope(
        tenant_id=row.tenant_id,
        workspace_id=row.workspace_id,
        scope_kind=row.scope_kind,
        owner_user_id=row.owner_user_id,
    )


def _pending_rows(factory, target: str, tenant_id: int | None, limit: int):
    filters = [Attachment.storage_backend != target]
    if tenant_id is not None:
        filters.append(Attachment.tenant_id == tenant_id)
    with factory() as db:
        total = db.scalar(
            select(func.count()).select_from(Attachment).where(*filters)
        ) or 0
        rows = db.execute(
            select(Attachment.attachment_id, Attachment.storage_backend)
            .where(*filters)
            .order_by(Attachment.attachment_id)
            .limit(limit)
        ).all()
    return total, [(row.attachment_id, row.storage_backend) for row in rows]


def _read_all(body) -> bytes:
    try:
        return body.read(MAX_UPLOAD_BYTES + 1)
    finally:
        body.close()


def _migrate_one(factory, storage, attachment_id: str, target: str) -> str:
    with factory() as db:
        row = db.get(Attachment, attachment_id)
        if row is None or row.storage_backend == target:
            return "skipped"

        source_backend = row.storage_backend
        source = storage.store_for(source_backend)
        destination = storage.store_for(target)
        scope = _scope_for_row(row)
        payload = _read_all(source.open(row.storage_key, scope))
        if len(payload) != row.size_bytes or len(payload) > MAX_UPLOAD_BYTES:
            raise ValueError("source object size does not match metadata")

        expected_digest = hashlib.sha256(payload).digest()
        destination.put(row.storage_key, scope, payload, row.media_type)
        copied = _read_all(destination.open(row.storage_key, scope))
        if len(copied) != len(payload) or not hmac.compare_digest(
            hashlib.sha256(copied).digest(), expected_digest
        ):
            raise ValueError("destination object verification failed")

        result = db.execute(
            update(Attachment)
            .where(
                Attachment.attachment_id == attachment_id,
                Attachment.tenant_id == row.tenant_id,
                Attachment.workspace_id == row.workspace_id,
                Attachment.storage_backend == source_backend,
            )
            .values(storage_backend=target)
        )
        if result.rowcount != 1:
            current = db.get(Attachment, attachment_id)
            db.rollback()
            if current is None or current.storage_backend != target:
                destination.delete(row.storage_key, scope)
            return "skipped"
        db.commit()
        return "migrated"


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.limit < 1:
        parser.error("--limit must be positive")
    if args.tenant_id is not None and args.tenant_id < 1:
        parser.error("--tenant-id must be positive")

    factory = get_session_factory()
    total, pending = _pending_rows(factory, args.target, args.tenant_id, args.limit)
    mode = "APPLY" if args.apply else "DRY_RUN"
    print(
        f"mode={mode} target={args.target} pending={total} "
        f"selected={len(pending)} limit={args.limit}"
    )
    if not args.apply:
        print("No objects or metadata were changed. Re-run with --apply to migrate this batch.")
        return 0
    if not pending:
        return 0

    storage = create_attachment_storage(get_settings())
    try:
        storage.store_for(args.target)
        for _, source_backend in pending:
            storage.store_for(source_backend)
    except AttachmentStoreUnavailable as exc:
        raise SystemExit("The source or target attachment storage backend is not configured") from exc

    migrated = 0
    skipped = 0
    failed = 0
    for attachment_id, _ in pending:
        try:
            result = _migrate_one(factory, storage, attachment_id, args.target)
        except (AttachmentStoreError, OSError, ValueError):
            failed += 1
            print(f"failed attachment_id={attachment_id}")
            continue
        migrated += result == "migrated"
        skipped += result == "skipped"

    print(f"migrated={migrated} skipped={skipped} failed={failed}")
    print("Source objects are retained; this command never deletes source data.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

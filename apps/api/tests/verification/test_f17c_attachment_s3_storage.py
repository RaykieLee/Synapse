"""F17c S3-compatible attachment storage and migration verification."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from botocore.config import Config as BotocoreConfig
from pydantic import SecretStr

from app.core.config import Settings, get_settings
from app.database.session import get_engine, get_session_factory
from app.integrations.attachment_storage import LocalAttachmentStore, S3AttachmentStore
from app.models.attachment import Attachment
from app.models.tenant import Tenant, Workspace
from app.models.user import User
from app.services.attachment_storage import (
    AttachmentObjectMissing,
    AttachmentStorageRouter,
    AttachmentStorageScope,
    AttachmentStoreUnavailable,
)
from app.services.attachments import AttachmentService
from app.tasks.attachments import reconcile_attachment_metadata
from app.cli.migrate_attachment_storage import _migrate_one, _pending_rows


class MemoryS3Store:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, AttachmentStorageScope], bytes] = {}
        self.unavailable = False

    def put(self, storage_key, scope, payload, media_type) -> None:
        del media_type
        self.objects[(storage_key, scope)] = bytes(payload)

    def open(self, storage_key, scope):
        if self.unavailable:
            raise AttachmentStoreUnavailable()
        try:
            return BytesIO(self.objects[(storage_key, scope)])
        except KeyError as exc:
            raise AttachmentObjectMissing() from exc

    def delete(self, storage_key, scope) -> None:
        self.objects.pop((storage_key, scope), None)

    def size(self, storage_key, scope) -> int:
        if self.unavailable:
            raise AttachmentStoreUnavailable()
        try:
            return len(self.objects[(storage_key, scope)])
        except KeyError as exc:
            raise AttachmentObjectMissing() from exc

    def count_orphan_objects(self, tenant_id, tracked_objects) -> int:
        if self.unavailable:
            raise AttachmentStoreUnavailable()
        return sum(
            1
            for storage_key, scope in self.objects
            if scope.tenant_id == tenant_id and (storage_key, scope) not in tracked_objects
        )


@pytest.fixture
def attachment_database(tmp_path, monkeypatch):
    db_path = tmp_path / "f17c.sqlite"
    root = (tmp_path / "attachments").resolve()
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f17c-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_ATTACHMENTS_STORAGE_PATH", str(root))
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    api_root = Path(__file__).resolve().parents[2]
    previous_cwd = os.getcwd()
    os.chdir(api_root)
    try:
        alembic = Config(str(api_root / "alembic.ini"))
        alembic.set_main_option(
            "script_location",
            str(api_root / "app/database/migrations"),
        )
        command.upgrade(alembic, "head")
    finally:
        os.chdir(previous_cwd)

    factory = get_session_factory()
    with factory() as db:
        actor = User(
            user_name="f17c-owner",
            email="f17c-owner@example.test",
            password_hash="unused",
        )
        tenant = Tenant(
            slug="f17c-tenant",
            name="F17c tenant",
            status="active",
            settings_json="{}",
        )
        db.add_all([actor, tenant])
        db.flush()
        workspace = Workspace(
            tenant_id=tenant.tenant_id,
            slug="f17c-workspace",
            name="F17c Workspace",
            status="active",
            settings_json="{}",
            created_by=actor.user_id,
        )
        db.add(workspace)
        db.flush()
        row = Attachment(
            attachment_id="f17c-local-attachment",
            tenant_id=tenant.tenant_id,
            workspace_id=workspace.workspace_id,
            scope_kind="workspace",
            owner_user_id=None,
            original_filename="migration.txt",
            media_type="text/plain",
            size_bytes=len(b"verified attachment body"),
            storage_backend="local",
            storage_key="a1" + "a" * 30,
            created_by=actor.user_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        tenant_id = tenant.tenant_id
        workspace_id = workspace.workspace_id
        actor_id = actor.user_id
        attachment_id = row.attachment_id
        storage_key = row.storage_key

    path = root / storage_key[:2] / storage_key[2:]
    path.parent.mkdir(parents=True)
    path.write_bytes(b"verified attachment body")
    yield factory, root, tenant_id, workspace_id, actor_id, attachment_id, storage_key
    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()


def test_attachment_storage_migration_is_verified_reversible_and_read_only(
    attachment_database,
):
    factory, root, tenant_id, workspace_id, actor_id, attachment_id, storage_key = attachment_database
    s3 = MemoryS3Store()
    storage = AttachmentStorageRouter(
        local=LocalAttachmentStore(root),
        s3=s3,
        default_backend="local",
    )

    pending, rows = _pending_rows(factory, "s3", tenant_id, 10)
    assert pending == 1 and rows == [(attachment_id, "local")]
    assert _migrate_one(factory, storage, attachment_id, "s3") == "migrated"
    assert s3.objects[(storage_key, AttachmentStorageScope(tenant_id, workspace_id, "workspace", None))] == b"verified attachment body"
    assert (root / storage_key[:2] / storage_key[2:]).read_bytes() == b"verified attachment body"

    with factory() as db:
        row = db.get(Attachment, attachment_id)
        assert row.storage_backend == "s3"
        result = reconcile_attachment_metadata(db, tenant_id, storage=storage)
        assert result["consistent_file_count"] == 1
        assert result["exception_count"] == 0
        assert result["s3_orphan_object_count"] == 0
        assert result["s3_orphan_scan_status"] == "complete"
        assert result["read_only"] is True
        assert not db.new and not db.dirty and not db.deleted

    assert _migrate_one(factory, storage, attachment_id, "local") == "migrated"
    with factory() as db:
        assert db.get(Attachment, attachment_id).storage_backend == "local"
        result = reconcile_attachment_metadata(db, tenant_id, storage=storage)
        assert result["consistent_file_count"] == 1
        assert result["exception_count"] == 0
        assert result["s3_orphan_object_count"] == 1
        assert result["s3_orphan_scan_status"] == "complete"
    assert s3.objects

    s3.objects.clear()
    with factory() as db:
        row = db.get(Attachment, attachment_id)
        row.storage_backend = "s3"
        db.commit()
        missing = reconcile_attachment_metadata(db, tenant_id, storage=storage)
        assert missing["exception_ids"]["missing_file"] == [attachment_id]
        assert missing["s3_orphan_object_count"] == 0
        s3.objects[(storage_key, AttachmentStorageScope(tenant_id, workspace_id, "workspace", None))] = b"verified attachment body"
        s3.unavailable = True
        unavailable = reconcile_attachment_metadata(db, tenant_id, storage=storage)
        assert unavailable["exception_ids"]["storage_unavailable"] == [attachment_id]
        assert unavailable["s3_orphan_object_count"] is None
        assert unavailable["s3_orphan_scan_status"] == "unavailable"


def test_s3_adapter_uses_path_style_and_scoped_object_keys(monkeypatch):
    import app.integrations.attachment_storage as integration

    captured = {}

    def fake_client(service_name, **kwargs):
        captured["service_name"] = service_name
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(integration.boto3, "client", fake_client)
    settings = Settings(
        _env_file=None,
        attachments_storage_backend="s3",
        attachments_s3_endpoint_url="http://rustfs:9000",
        attachments_s3_bucket="synapse-attachments",
        attachments_s3_access_key_id=SecretStr("access-key"),
        attachments_s3_secret_access_key=SecretStr("secret-key"),
    )
    S3AttachmentStore.from_settings(settings)

    assert captured["service_name"] == "s3"
    assert captured["endpoint_url"] == "http://rustfs:9000"
    assert captured["config"].signature_version == "s3v4"
    assert captured["config"].s3["addressing_style"] == "path"
    assert isinstance(captured["config"], BotocoreConfig)

    workspace_key = S3AttachmentStore._object_key(
        "a" * 32,
        AttachmentStorageScope(5, 7, "workspace", None),
    )
    personal_key = S3AttachmentStore._object_key(
        "b" * 32,
        AttachmentStorageScope(5, 7, "personal", 11),
    )
    assert workspace_key == (
        f"synapse/attachments/v1/tenants/5/workspaces/7/workspace-shared/{'a' * 32}"
    )
    assert personal_key == (
        f"synapse/attachments/v1/tenants/5/workspaces/7/personal/11/{'b' * 32}"
    )
    assert "//" not in workspace_key and "//" not in personal_key


def test_s3_inventory_counts_untracked_objects_only_within_tenant_prefix():
    scope = AttachmentStorageScope(5, 7, "workspace", None)
    tracked_key = S3AttachmentStore._object_key("a" * 32, scope)
    orphan_key = S3AttachmentStore._object_key("b" * 32, scope)
    another_tenant_key = S3AttachmentStore._object_key(
        "c" * 32,
        AttachmentStorageScope(6, 7, "workspace", None),
    )
    captured = {}

    class Paginator:
        def paginate(self, **kwargs):
            captured.update(kwargs)
            return [
                {
                    "Contents": [
                        {"Key": tracked_key},
                        {"Key": orphan_key},
                        {"Key": another_tenant_key},
                    ]
                }
            ]

    class Client:
        def get_paginator(self, operation):
            assert operation == "list_objects_v2"
            return Paginator()

    store = S3AttachmentStore(bucket="attachments", client=Client())
    count = store.count_orphan_objects(5, {("a" * 32, scope)})

    assert count == 1
    assert captured == {
        "Bucket": "attachments",
        "Prefix": "synapse/attachments/v1/tenants/5/",
    }


def test_s3_open_fails_before_returning_if_stream_read_is_incomplete():
    class Body:
        closed = False
        reads = 0

        def read(self, amount):
            del amount
            self.reads += 1
            if self.reads == 1:
                return b"partial"
            raise OSError("private key and endpoint details")

        def close(self):
            self.closed = True

    body = Body()

    class Client:
        def get_object(self, **kwargs):
            del kwargs
            return {"Body": body, "ContentLength": 99}

    store = S3AttachmentStore(bucket="attachments", client=Client())

    with pytest.raises(AttachmentStoreUnavailable):
        store.open("a" * 32, AttachmentStorageScope(5, 7, "workspace", None))

    assert body.closed


def test_upload_compensation_failure_logs_without_storage_details(monkeypatch):
    class FailedStore:
        def delete(self, storage_key, scope):
            del storage_key, scope
            raise RuntimeError("private bucket and object details")

    messages = []
    monkeypatch.setattr("app.services.attachments.logger.warning", messages.append)
    AttachmentService._cleanup_storage_object(
        FailedStore(),
        "a" * 32,
        AttachmentStorageScope(5, 7, "workspace", None),
    )

    assert messages == [
        "Attachment storage cleanup failed; reconciliation may detect an untracked object"
    ]

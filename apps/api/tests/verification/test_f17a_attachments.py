"""F17a local attachment storage verification through real FastAPI multipart routes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session


def test_f17a_attachment_storage_api_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f17a.sqlite"
    storage = tmp_path / "attachments"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f17a-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_ATTACHMENTS_STORAGE_PATH", str(storage))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0016_tenant_validity")
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    from app.models.attachment import Attachment

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        actors = [
            User(user_name="f17a-owner-a", email="f17a-owner-a@example.test", password_hash="unused"),
            User(user_name="f17a-uploader", email="f17a-uploader@example.test", password_hash="unused"),
            User(user_name="f17a-reader", email="f17a-reader@example.test", password_hash="unused"),
            User(user_name="f17a-owner-b", email="f17a-owner-b@example.test", password_hash="unused"),
            User(user_name="f17a-platform", email="f17a-platform@example.test", password_hash="unused", platform_role="platform_admin"),
        ]
        db.add_all(actors)
        db.flush()
        ids = {actor.user_name: actor.user_id for actor in actors}
        tenant_a = Tenant(slug="f17a-tenant-a", name="F17a tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f17a-tenant-b", name="F17a tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        for user_name, role in (("f17a-owner-a", "owner"), ("f17a-uploader", "member"), ("f17a-reader", "member")):
            db.add(TenantMember(tenant_id=tenant_a_id, user_id=ids[user_name], status="active", tenant_role=role, joined_at=now))
        db.add(TenantMember(tenant_id=tenant_b_id, user_id=ids["f17a-owner-b"], status="active", tenant_role="owner", joined_at=now))
        workspace_a = Workspace(tenant_id=tenant_a_id, slug="alpha", name="Alpha", status="active", settings_json="{}", created_by=ids["f17a-owner-a"])
        workspace_a2 = Workspace(tenant_id=tenant_a_id, slug="alpha-two", name="Alpha two", status="active", settings_json="{}", created_by=ids["f17a-owner-a"])
        workspace_b = Workspace(tenant_id=tenant_b_id, slug="beta", name="Beta", status="active", settings_json="{}", created_by=ids["f17a-owner-b"])
        db.add_all([workspace_a, workspace_a2, workspace_b])
        db.flush()
        workspace_ids = {"alpha": workspace_a.workspace_id, "alpha-two": workspace_a2.workspace_id, "beta": workspace_b.workspace_id}
        db.add_all([
            WorkspaceMember(workspace_id=workspace_a.workspace_id, tenant_id=tenant_a_id, user_id=ids["f17a-owner-a"], status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=workspace_a.workspace_id, tenant_id=tenant_a_id, user_id=ids["f17a-uploader"], status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=workspace_a.workspace_id, tenant_id=tenant_a_id, user_id=ids["f17a-reader"], status="active", workspace_role="viewer", joined_at=now),
            WorkspaceMember(workspace_id=workspace_a2.workspace_id, tenant_id=tenant_a_id, user_id=ids["f17a-owner-a"], status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=workspace_b.workspace_id, tenant_id=tenant_b_id, user_id=ids["f17a-owner-b"], status="active", workspace_role="owner", joined_at=now),
        ])
        db.commit()

    command.upgrade(alembic, "head")
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        inspector = inspect(connection)
        assert revision == ScriptDirectory.from_config(alembic).get_current_head()
        assert "attachments" in inspector.get_table_names()
        assert any(
            fk["constrained_columns"] == ["workspace_id", "tenant_id"]
            and fk["referred_table"] == "workspaces"
            and fk["referred_columns"] == ["workspace_id", "tenant_id"]
            for fk in inspector.get_foreign_keys("attachments")
        )
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1

    from app.auth.security import issue_token
    import app.main as main_module
    from fastapi import FastAPI
    # F17a is scoped to storage/API behavior. This environment lacks AgentScope
    # and its optional runtime deps, so replace only the unrelated mounted child.
    monkeypatch.setattr(main_module, "create_agentscope_app", lambda _settings: FastAPI())
    tokens = {name: issue_token(user_id, 0) for name, user_id in ids.items()}
    app = main_module.create_app()
    api = f"/api/v1/workspaces/{workspace_ids['alpha']}/attachments"
    with TestClient(app, raise_server_exceptions=False) as client:
        def req(method, path, actor, workspace_id=None, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            if workspace_id is not None:
                headers["X-Workspace-ID"] = str(workspace_id)
            return getattr(client, method)(path, headers=headers, **kwargs)

        def upload(actor, filename, content, media_type="text/plain", scope="workspace", workspace_id=None):
            return req("post", f"/api/v1/workspaces/{workspace_id or workspace_ids['alpha']}/attachments", actor,
                       workspace_id or workspace_ids["alpha"], data={"scope_kind": scope},
                       files={"file": (filename, content, media_type)})

        # Tenant/workspace boundary and permission matrix: platform status is not membership.
        assert req("get", api, "f17a-platform", workspace_ids["alpha"]).status_code == 403
        assert req("get", f"/api/v1/workspaces/{workspace_ids['beta']}/attachments", "f17a-owner-a", workspace_ids["beta"]).status_code == 403
        assert req("get", api, "f17a-owner-a", workspace_ids["alpha-two"]).status_code == 400
        assert req("get", api, "f17a-reader", workspace_ids["alpha"]).status_code == 200
        assert req("post", api, "f17a-reader", workspace_ids["alpha"], files={"file": ("x.txt", b"x", "text/plain")}).status_code == 403

        # Workspace upload/list/download/delete and metadata/disk consistency.
        created = upload("f17a-uploader", "../report.txt", b"attachment body")
        assert created.status_code == 201, created.text
        item = created.json()
        assert item["filename"] == "report.txt" and item["scope_kind"] == "workspace"
        assert item["tenant_id"] == str(tenant_a_id) and item["workspace_id"] == str(workspace_ids["alpha"])
        assert item["size_bytes"] == len(b"attachment body") and "storage_key" not in item
        with factory() as db:
            row = db.get(Attachment, item["attachment_id"])
            disk_path = storage / row.storage_key[:2] / row.storage_key[2:]
            assert row.owner_user_id is None and row.created_by == ids["f17a-uploader"]
            assert disk_path.read_bytes() == b"attachment body"
        listing = req("get", api, "f17a-reader", workspace_ids["alpha"]).json()
        assert listing["total"] == 1 and listing["items"][0]["attachment_id"] == item["attachment_id"]
        download = req("get", f"{api}/{item['attachment_id']}/download", "f17a-reader", workspace_ids["alpha"])
        assert download.status_code == 200 and download.content == b"attachment body"
        assert download.headers.get("cache-control") == "private, no-store"
        assert download.headers.get("x-content-type-options") == "nosniff"
        assert req("get", f"/api/v1/workspaces/{workspace_ids['alpha-two']}/attachments/{item['attachment_id']}/download", "f17a-owner-a", workspace_ids["alpha-two"]).status_code == 404
        assert req("get", f"/api/v1/workspaces/{workspace_ids['beta']}/attachments/{item['attachment_id']}/download", "f17a-owner-b", workspace_ids["beta"]).status_code == 404
        assert req("delete", f"{api}/{item['attachment_id']}", "f17a-uploader", workspace_ids["alpha"]).status_code == 403
        # Persisted storage keys are validated before path resolution; corrupted traversal keys cannot read outside the root.
        safe_storage_key = row.storage_key
        with factory() as db:
            db.get(Attachment, item["attachment_id"]).storage_key = "../outside"
            db.commit()
        unsafe_download = req("get", f"{api}/{item['attachment_id']}/download", "f17a-owner-a", workspace_ids["alpha"])
        assert unsafe_download.status_code == 500 and b"attachment body" not in unsafe_download.content
        with factory() as db:
            db.get(Attachment, item["attachment_id"]).storage_key = safe_storage_key
            db.commit()
        assert req("delete", f"{api}/{item['attachment_id']}", "f17a-owner-a", workspace_ids["alpha"]).status_code == 204
        assert not disk_path.exists()
        with factory() as db:
            assert db.get(Attachment, item["attachment_id"]) is None

        # Personal files remain private even to workspace owner/admin and list stays empty for others.
        personal = upload("f17a-uploader", "private.txt", b"private body", scope="personal")
        assert personal.status_code == 201, personal.text
        private_item = personal.json()
        assert private_item["scope_kind"] == "personal" and private_item["owner_user_id"] == str(ids["f17a-uploader"])
        assert req("get", f"{api}?scope_kind=personal", "f17a-owner-a", workspace_ids["alpha"]).json()["total"] == 0
        assert req("get", f"/api/v1/workspaces/{workspace_ids['alpha-two']}/attachments/{private_item['attachment_id']}/download?scope_kind=personal", "f17a-owner-a", workspace_ids["alpha-two"]).status_code == 404
        assert req("get", f"{api}/{private_item['attachment_id']}/download?scope_kind=personal", "f17a-owner-a", workspace_ids["alpha"]).status_code == 404
        assert req("delete", f"{api}/{private_item['attachment_id']}?scope_kind=personal", "f17a-owner-a", workspace_ids["alpha"]).status_code == 404
        assert req("get", f"{api}?scope_kind=personal", "f17a-uploader", workspace_ids["alpha"]).json()["total"] == 1
        with factory() as db:
            row = db.get(Attachment, private_item["attachment_id"])
            private_path = storage / row.storage_key[:2] / row.storage_key[2:]
        assert req("delete", f"{api}/{private_item['attachment_id']}?scope_kind=personal", "f17a-uploader", workspace_ids["alpha"]).status_code == 204
        assert not private_path.exists()

        # Content/extension validation, empty files, and traversal-safe display name.
        assert upload("f17a-uploader", "bad.exe", b"x").status_code == 415
        mismatch = upload("f17a-uploader", "mismatch.pdf", b"%PDF-1.7 body", "text/plain")
        assert mismatch.status_code == 415 and mismatch.json()["code"] == "FILE_TYPE_MISMATCH"
        invalid_pdf = upload("f17a-uploader", "bad.pdf", b"not a pdf", "application/pdf")
        assert invalid_pdf.status_code == 415 and invalid_pdf.json()["code"] == "INVALID_FILE_CONTENT"
        assert upload("f17a-uploader", "empty.txt", b"").status_code == 422
        safe_name = upload("f17a-uploader", "../..\\outside.txt", b"safe")
        assert safe_name.status_code == 201 and safe_name.json()["filename"] == "outside.txt"
        assert req("delete", f"{api}/{safe_name.json()['attachment_id']}", "f17a-owner-a", workspace_ids["alpha"]).status_code == 204

        # A valid maximum-size file succeeds; one byte over the limit is rejected before persistence.
        max_content = b"a" * (25 * 1024 * 1024)
        maximum = upload("f17a-uploader", "max.txt", max_content)
        assert maximum.status_code == 201, maximum.text
        max_id = maximum.json()["attachment_id"]
        with factory() as db:
            row = db.get(Attachment, max_id)
            max_path = storage / row.storage_key[:2] / row.storage_key[2:]
            assert row.size_bytes == 25 * 1024 * 1024 and max_path.stat().st_size == row.size_bytes
        assert req("delete", f"{api}/{max_id}", "f17a-owner-a", workspace_ids["alpha"]).status_code == 204
        oversized = upload("f17a-uploader", "over.txt", b"b" * (25 * 1024 * 1024 + 1))
        assert oversized.status_code == 413 and oversized.json()["code"] == "FILE_TOO_LARGE"
        assert not any(storage.rglob("*.tmp"))

        # Inactive membership/workspace is rechecked on every request; stale workspace rows do not grant access.
        with factory() as db:
            membership = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_a_id,
                                                              TenantMember.user_id == ids["f17a-uploader"]))
            membership.status = "removed"
            db.commit()
        assert req("get", api, "f17a-uploader", workspace_ids["alpha"]).status_code == 403
        with factory() as db:
            membership = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_a_id,
                                                              TenantMember.user_id == ids["f17a-uploader"]))
            membership.status = "active"
            ws = db.get(Workspace, workspace_ids["alpha"])
            ws.status = "archived"
            db.commit()
        assert req("get", api, "f17a-uploader", workspace_ids["alpha"]).status_code == 409
        with factory() as db:
            db.get(Workspace, workspace_ids["alpha"]).status = "active"
            db.get(Tenant, tenant_a_id).status = "suspended"
            db.commit()
        inactive_tenant = req("get", api, "f17a-uploader", workspace_ids["alpha"])
        assert inactive_tenant.status_code == 409 and inactive_tenant.json()["code"] == "TENANT_INACTIVE"
        with factory() as db:
            db.get(Tenant, tenant_a_id).status = "active"
            db.commit()

        # An unlink error retains both metadata and file so DELETE can be retried.
        cleanup_target = upload("f17a-uploader", "cleanup.txt", b"cleanup")
        assert cleanup_target.status_code == 201
        cleanup_id = cleanup_target.json()["attachment_id"]
        with factory() as db:
            row = db.get(Attachment, cleanup_id)
            cleanup_path = storage / row.storage_key[:2] / row.storage_key[2:]
        original_unlink = Path.unlink
        def fail_for_target(path, *args, **kwargs):
            if path == cleanup_path:
                raise OSError("injected disk cleanup failure")
            return original_unlink(path, *args, **kwargs)
        with monkeypatch.context() as patch:
            patch.setattr(Path, "unlink", fail_for_target)
            failed_delete = req("delete", f"{api}/{cleanup_id}", "f17a-owner-a", workspace_ids["alpha"])
        assert failed_delete.status_code == 500 and failed_delete.json()["code"] == "FILE_CLEANUP_FAILED"
        with factory() as db:
            assert db.get(Attachment, cleanup_id) is not None
        assert cleanup_path.exists()
        retry_delete = req("delete", f"{api}/{cleanup_id}", "f17a-owner-a", workspace_ids["alpha"])
        assert retry_delete.status_code == 204
        with factory() as db:
            assert db.get(Attachment, cleanup_id) is None
        assert not cleanup_path.exists()

        # A missing disk file is an idempotent cleanup case; metadata is still deleted.
        missing_target = upload("f17a-uploader", "missing.txt", b"gone")
        assert missing_target.status_code == 201
        missing_id = missing_target.json()["attachment_id"]
        with factory() as db:
            row = db.get(Attachment, missing_id)
            missing_path = storage / row.storage_key[:2] / row.storage_key[2:]
        original_unlink(missing_path)
        missing_delete = req("delete", f"{api}/{missing_id}", "f17a-owner-a", workspace_ids["alpha"])
        assert missing_delete.status_code == 204
        with factory() as db:
            assert db.get(Attachment, missing_id) is None

        # Windows may report ACCESS_DENIED when another concurrent DELETE has
        # already unlinked the file. Simulate that exact post-unlink state.
        race_target = upload("f17a-uploader", "unlink-race.txt", b"already removed")
        assert race_target.status_code == 201
        race_id = race_target.json()["attachment_id"]
        with factory() as db:
            row = db.get(Attachment, race_id)
            race_path = storage / row.storage_key[:2] / row.storage_key[2:]
        original_unlink(race_path)

        def permission_error_for_missing_target(path, *args, **kwargs):
            if path == race_path:
                raise PermissionError(5, "Access is denied", str(path))
            return original_unlink(path, *args, **kwargs)

        with monkeypatch.context() as patch:
            patch.setattr(Path, "unlink", permission_error_for_missing_target)
            raced_delete = req("delete", f"{api}/{race_id}", "f17a-owner-a", workspace_ids["alpha"])
        assert raced_delete.status_code == 204
        with factory() as db:
            assert db.get(Attachment, race_id) is None

        # DB commit failure after physical unlink leaves the metadata retryable; a second DELETE finalizes it.
        retry_target = upload("f17a-uploader", "delete-commit-retry.txt", b"retry")
        assert retry_target.status_code == 201
        retry_id = retry_target.json()["attachment_id"]
        with factory() as db:
            row = db.get(Attachment, retry_id)
            retry_path = storage / row.storage_key[:2] / row.storage_key[2:]
        def fail_delete_commit(session):
            raise RuntimeError("injected attachment delete commit failure")
        with monkeypatch.context() as patch:
            patch.setattr(Session, "commit", fail_delete_commit)
            commit_failed = req("delete", f"{api}/{retry_id}", "f17a-owner-a", workspace_ids["alpha"])
        assert commit_failed.status_code == 500
        with factory() as db:
            assert db.get(Attachment, retry_id) is not None
        assert not retry_path.exists()
        retried = req("delete", f"{api}/{retry_id}", "f17a-owner-a", workspace_ids["alpha"])
        assert retried.status_code == 204
        with factory() as db:
            assert db.get(Attachment, retry_id) is None

        # Two concurrent DELETE requests that both resolve the row before unlink race are idempotent.
        concurrent_target = upload("f17a-uploader", "concurrent.txt", b"once")
        assert concurrent_target.status_code == 201
        concurrent_id = concurrent_target.json()["attachment_id"]
        with factory() as db:
            row = db.get(Attachment, concurrent_id)
            concurrent_path = storage / row.storage_key[:2] / row.storage_key[2:]
        import app.api.attachments as attachment_api
        original_get_attachment = attachment_api._get_attachment
        read_barrier = Barrier(2)
        def synchronize_get(db, context, scope_kind, attachment_id):
            result = original_get_attachment(db, context, scope_kind, attachment_id)
            if attachment_id == concurrent_id:
                read_barrier.wait(timeout=5)
            return result
        with monkeypatch.context() as patch:
            patch.setattr(attachment_api, "_get_attachment", synchronize_get)
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(req, "delete", f"{api}/{concurrent_id}", "f17a-owner-a", workspace_ids["alpha"])
                           for _ in range(2)]
                concurrent_responses = [future.result(timeout=15) for future in futures]
        assert [response.status_code for response in concurrent_responses] == [204, 204], [
            (response.status_code, response.text) for response in concurrent_responses
        ]
        with factory() as db:
            assert db.get(Attachment, concurrent_id) is None
        assert not concurrent_path.exists()
        assert not any(storage.rglob("*.tmp"))

        # DB commit failure after disk write must roll metadata and file back.
        def fail_commit(session):
            raise RuntimeError("injected metadata commit failure")
        with monkeypatch.context() as patch:
            patch.setattr(Session, "commit", fail_commit)
            failed_upload = upload("f17a-uploader", "rollback.txt", b"rollback")
        assert failed_upload.status_code == 500
        with factory() as db:
            assert db.scalar(select(Attachment).where(Attachment.original_filename == "rollback.txt")) is None
        # Successful uploads above have been deleted, so no payload path should remain. The directory may be empty.
        assert not any(path.is_file() and not path.name.endswith(".tmp") for path in storage.rglob("*")), list(storage.rglob("*"))

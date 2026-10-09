"""F18b3 read-only, tenant-scoped attachment reconciliation verification."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select


def test_f18b3_attachment_reconcile_is_read_only_and_tenant_scoped(tmp_path, monkeypatch):
    db_path = tmp_path / "f18b3.sqlite"
    storage_root = (tmp_path / "attachments-root").resolve()
    outside_root = (tmp_path / "outside-root").resolve()
    storage_root.mkdir()
    outside_root.mkdir()
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18b3-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_ATTACHMENTS_STORAGE_PATH", str(storage_root))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    old_cwd = os.getcwd()
    api_dir = Path(__file__).resolve().parents[2]
    os.chdir(api_dir)
    try:
        command.upgrade(Config("alembic.ini"), "head")
    finally:
        os.chdir(old_cwd)

    from app.models.attachment import Attachment
    from app.models.tenant import Tenant, Workspace
    from app.models.user import User
    from app.tasks.attachments import reconcile_attachment_metadata

    factory = get_session_factory()
    with factory() as db:
        actor_a = User(user_name="f18b3-actor-a", email="f18b3-a@example.test", password_hash="unused")
        actor_b = User(user_name="f18b3-actor-b", email="f18b3-b@example.test", password_hash="unused")
        db.add_all([actor_a, actor_b])
        db.flush()
        tenant_a = Tenant(slug="f18b3-alpha", name="F18b3 Alpha", status="active", settings_json="{}")
        tenant_b = Tenant(slug="f18b3-beta", name="F18b3 Beta", status="active", settings_json="{}")
        db.add_all([tenant_a, tenant_b])
        db.flush()
        workspace_a = Workspace(tenant_id=tenant_a.tenant_id, slug="alpha", name="Alpha", status="active", settings_json="{}", created_by=actor_a.user_id)
        workspace_b = Workspace(tenant_id=tenant_b.tenant_id, slug="beta", name="Beta", status="active", settings_json="{}", created_by=actor_b.user_id)
        db.add_all([workspace_a, workspace_b])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        workspace_a_id, workspace_b_id = workspace_a.workspace_id, workspace_b.workspace_id
        creator_a, creator_b = actor_a.user_id, actor_b.user_id

        keys = {
            "good": "a1" + "a" * 30,
            "missing": "b2" + "b" * 30,
            "mismatch": "c3" + "c" * 30,
            "symlink": "d4" + "d" * 30,
            "directory": "e5" + "e" * 30,
            "outside": "f6" + "f" * 30,
            "tenant_b": "g7" + "g" * 30,
        }

        def file_path(key: str) -> Path:
            return storage_root / key[:2] / key[2:]

        # A valid regular file and one of each metadata/file inconsistency.
        good_path = file_path(keys["good"])
        good_path.parent.mkdir(parents=True)
        good_path.write_bytes(b"valid")
        mismatch_path = file_path(keys["mismatch"])
        mismatch_path.parent.mkdir(parents=True)
        mismatch_path.write_bytes(b"wrong length")

        symlink_target = outside_root / "symlink-target.txt"
        symlink_target.write_bytes(b"outside through link")
        (storage_root / keys["symlink"][:2]).symlink_to(outside_root, target_is_directory=True)

        directory_path = file_path(keys["directory"])
        directory_path.mkdir(parents=True)
        # This file is an orphan with no metadata. The handler must not find or
        # report it by scanning the storage tree.
        orphan_path = outside_root / "orphan-no-metadata.txt"
        orphan_path.write_bytes(b"untracked")

        def attachment(tenant_id: int, workspace_id: int, created_by: int, key: str,
                       attachment_id: str, size: int) -> Attachment:
            return Attachment(
                attachment_id=attachment_id, tenant_id=tenant_id, workspace_id=workspace_id,
                scope_kind="workspace", owner_user_id=None, original_filename=f"{attachment_id}.txt",
                media_type="text/plain", size_bytes=size, storage_key=key,
                created_by=created_by, created_at=datetime(2026, 10, 2, tzinfo=timezone.utc),
            )

        rows = [
            attachment(tenant_a_id, workspace_a_id, creator_a, keys["good"], "f18b3-a-good", 5),
            attachment(tenant_a_id, workspace_a_id, creator_a, keys["missing"], "f18b3-a-missing", 7),
            attachment(tenant_a_id, workspace_a_id, creator_a, keys["mismatch"], "f18b3-a-size", 1),
            attachment(tenant_a_id, workspace_a_id, creator_a, keys["symlink"], "f18b3-a-symlink", len(b"outside through link")),
            attachment(tenant_a_id, workspace_a_id, creator_a, keys["directory"], "f18b3-a-directory", 1),
            attachment(tenant_a_id, workspace_a_id, creator_a, "../escape", "f18b3-a-key", 1),
            attachment(tenant_a_id, workspace_a_id, creator_a, keys["outside"], "f18b3-a-outside", 1),
            attachment(tenant_b_id, workspace_b_id, creator_b, keys["tenant_b"], "f18b3-b-good", 5),
        ]
        tenant_b_path = file_path(keys["tenant_b"])
        tenant_b_path.parent.mkdir(parents=True)
        tenant_b_path.write_bytes(b"beta!")
        db.add_all(rows)
        db.commit()
        before_rows = {
            row.attachment_id: (row.tenant_id, row.workspace_id, row.storage_key, row.size_bytes)
            for row in db.scalars(select(Attachment).order_by(Attachment.attachment_id)).all()
        }

    symlink_path = storage_root / keys["symlink"][:2]
    inspected_paths = [good_path, mismatch_path, symlink_path, symlink_target, directory_path, orphan_path, tenant_b_path]
    before_fs = {str(path): (path.is_symlink(), path.is_dir(), path.stat().st_size if path.exists() else None,
                             path.stat().st_mtime_ns if path.exists() else None,
                             path.read_bytes() if path.is_file() and not path.is_symlink() else None)
                 for path in inspected_paths}
    outside_candidate = file_path(keys["outside"])
    original_resolve = Path.resolve
    original_iterdir, original_glob, original_rglob = Path.iterdir, Path.glob, Path.rglob
    original_scandir, original_walk = os.scandir, os.walk
    scan_calls: list[str] = []

    def track(name, original):
        def wrapper(self, *args, **kwargs):
            scan_calls.append(f"Path.{name}:{self}")
            return original(self, *args, **kwargs)
        return wrapper

    def guarded_resolve(path, *args, **kwargs):
        # There is no ordinary persistent path that passes the earlier
        # symlink check and resolves outside a canonical root. Inject only this
        # one candidate's resolver result to exercise the handler's explicit
        # containment-defense branch (e.g. a resolution race).
        if path == outside_candidate:
            return outside_root / "resolver-escaped.txt"
        return original_resolve(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", guarded_resolve)
    monkeypatch.setattr(Path, "iterdir", track("iterdir", original_iterdir))
    monkeypatch.setattr(Path, "glob", track("glob", original_glob))
    monkeypatch.setattr(Path, "rglob", track("rglob", original_rglob))
    monkeypatch.setattr(os, "scandir", lambda *args, **kwargs: (scan_calls.append("os.scandir"), original_scandir(*args, **kwargs))[1])
    monkeypatch.setattr(os, "walk", lambda *args, **kwargs: (scan_calls.append("os.walk"), original_walk(*args, **kwargs))[1])

    with factory() as db:
        result = reconcile_attachment_metadata(db, tenant_a_id)
        assert not db.new and not db.dirty and not db.deleted

    assert result == {
        "task_target": "tenant.reconcile_attachment_metadata",
        "tenant_id": str(tenant_a_id),
        "metadata_count": 7,
        "present_file_count": 2,
        "consistent_file_count": 1,
        "exception_count": 6,
        "exception_ids": {
            "invalid_storage_key": ["f18b3-a-key"],
            "storage_path_outside_root": ["f18b3-a-outside"],
            "missing_file": ["f18b3-a-missing"],
            "not_regular_file": ["f18b3-a-directory", "f18b3-a-symlink"],
            "unreadable_file": [],
            "size_mismatch": ["f18b3-a-size"],
        },
        "read_only": True,
    }
    assert not scan_calls, f"handler traversed storage directories: {scan_calls}"

    monkeypatch.setattr(Path, "resolve", original_resolve)
    monkeypatch.setattr(Path, "iterdir", original_iterdir)
    monkeypatch.setattr(Path, "glob", original_glob)
    monkeypatch.setattr(Path, "rglob", original_rglob)
    monkeypatch.setattr(os, "scandir", original_scandir)
    monkeypatch.setattr(os, "walk", original_walk)
    with factory() as db:
        after_rows = {
            row.attachment_id: (row.tenant_id, row.workspace_id, row.storage_key, row.size_bytes)
            for row in db.scalars(select(Attachment).order_by(Attachment.attachment_id)).all()
        }
    after_fs = {str(path): (path.is_symlink(), path.is_dir(), path.stat().st_size if path.exists() else None,
                            path.stat().st_mtime_ns if path.exists() else None,
                            path.read_bytes() if path.is_file() and not path.is_symlink() else None)
                for path in inspected_paths}
    assert after_rows == before_rows
    assert after_fs == before_fs
    assert not file_path(keys["outside"]).exists()
    assert orphan_path.read_bytes() == b"untracked"
    assert tenant_b_path.read_bytes() == b"beta!"

    for invalid in (0, -1, True, 1.5, "1", None):
        with factory() as db, pytest.raises(ValueError, match="positive integer"):
            reconcile_attachment_metadata(db, invalid)
    with factory() as db, pytest.raises(LookupError, match="tenant does not exist"):
        reconcile_attachment_metadata(db, 999_999_999)

    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

"""F18b1 direct verification of the tenant invitation expiry task handler."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select


def test_f18b1_expire_invitations_scoped_boundary_idempotent_and_concurrent(tmp_path, monkeypatch):
    db_path = tmp_path / "f18b1-invitations.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18b1-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    previous_cwd = __import__("os").getcwd()
    api_dir = __import__("pathlib").Path(__file__).resolve().parents[2]
    __import__("os").chdir(api_dir)
    try:
        command.upgrade(Config("alembic.ini"), "head")
    finally:
        __import__("os").chdir(previous_cwd)

    from app.models.tenant import Tenant, TenantInvitation
    from app.models.user import User
    from app.tasks.tenant_invitations import expire_pending_invitations

    cutoff = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
    past = cutoff - timedelta(microseconds=1)
    future = cutoff + timedelta(microseconds=1)
    factory = get_session_factory()
    with factory() as db:
        owner_a = User(user_name="f18b1-owner-a", email="f18b1-owner-a@example.test", password_hash="unused")
        owner_b = User(user_name="f18b1-owner-b", email="f18b1-owner-b@example.test", password_hash="unused")
        invitee = User(user_name="f18b1-invitee", email="f18b1-invitee@example.test", password_hash="unused")
        db.add_all([owner_a, owner_b, invitee])
        db.flush()
        tenant_a = Tenant(slug="f18b1-alpha", name="F18b1 Alpha", status="active", settings_json="{}")
        tenant_b = Tenant(slug="f18b1-beta", name="F18b1 Beta", status="active", settings_json="{}")
        db.add_all([tenant_a, tenant_b])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id

        def invitation(tenant_id: int, suffix: str, status: str, expires_at: datetime):
            return TenantInvitation(
                tenant_id=tenant_id, email=f"{suffix}@example.test", target_user_id=None,
                tenant_role="member", token_hash=(suffix.encode().hex() * 2)[:64],
                status=status, expires_at=expires_at, invited_by=(owner_a.user_id if tenant_id == tenant_a_id else owner_b.user_id),
            )

        rows = [
            invitation(tenant_a_id, "f18b1-a-past", "pending", past),
            invitation(tenant_a_id, "f18b1-a-equal", "pending", cutoff),
            invitation(tenant_a_id, "f18b1-a-future", "pending", future),
            invitation(tenant_a_id, "f18b1-a-accepted", "accepted", past),
            invitation(tenant_a_id, "f18b1-a-revoked", "revoked", past),
            invitation(tenant_a_id, "f18b1-a-expired", "expired", past),
            invitation(tenant_b_id, "f18b1-b-past", "pending", past),
        ]
        db.add_all(rows)
        db.commit()
        ids = {row.email.split("@")[0]: row.invitation_id for row in rows}

    # Exactly-at-cutoff is expired (<=), strictly future remains pending, and
    # all state changes remain scoped to Tenant A.
    with factory() as db:
        assert expire_pending_invitations(db, tenant_a_id, now=cutoff) == 2
    with factory() as db:
        statuses = {row.email.split("@")[0]: row.status for row in db.scalars(
            select(TenantInvitation).order_by(TenantInvitation.invitation_id)
        ).all()}
    assert statuses == {
        "f18b1-a-past": "expired",
        "f18b1-a-equal": "expired",
        "f18b1-a-future": "pending",
        "f18b1-a-accepted": "accepted",
        "f18b1-a-revoked": "revoked",
        "f18b1-a-expired": "expired",
        "f18b1-b-past": "pending",
    }
    # The same invocation is idempotent and counts only rows it transitions.
    with factory() as db:
        assert expire_pending_invitations(db, tenant_a_id, now=cutoff) == 0

    # Concurrent invocations race over one expired pending row. The conditional
    # UPDATE should report one transition total, with no duplicate state effect.
    concurrent_row = invitation(tenant_a_id, "f18b1-a-concurrent", "pending", past)
    with factory() as db:
        db.add(concurrent_row)
        db.commit()
        concurrent_id = concurrent_row.invitation_id
    barrier = Barrier(2)

    def invoke_concurrently():
        with factory() as db:
            barrier.wait(timeout=10)
            return expire_pending_invitations(db, tenant_a_id, now=cutoff)

    with ThreadPoolExecutor(max_workers=2) as pool:
        counts = list(pool.map(lambda _index: invoke_concurrently(), range(2)))
    assert sorted(counts) == [0, 1]
    with factory() as db:
        concurrent_saved = db.get(TenantInvitation, concurrent_id)
        assert concurrent_saved is not None and concurrent_saved.status == "expired"

    # Invalid identifier shapes are rejected before SQL; a positive but absent
    # tenant produces the documented controlled LookupError.
    for invalid in (0, -1, True, 1.5, "1", None):
        with factory() as db, pytest.raises(ValueError, match="positive integer"):
            expire_pending_invitations(db, invalid, now=cutoff)
    with factory() as db, pytest.raises(LookupError, match="tenant does not exist"):
        expire_pending_invitations(db, 999_999_999, now=cutoff)

    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

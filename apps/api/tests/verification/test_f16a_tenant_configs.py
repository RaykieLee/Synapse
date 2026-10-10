"""F16a verification for tenant config migration, scope, CRUD and secret redaction."""
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select


def test_f16a_tenant_config_api_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f16a-tenant-configs.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f16a-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0016_tenant_validity")
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_dictionary import TenantDictType
    from app.models.user import User

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f16a-owner-a", email="owner-a-f16a@example.test", password_hash="unused"),
            User(user_name="f16a-admin-a", email="admin-a-f16a@example.test", password_hash="unused"),
            User(user_name="f16a-member-a", email="member-a-f16a@example.test", password_hash="unused"),
            User(user_name="f16a-owner-b", email="owner-b-f16a@example.test", password_hash="unused"),
            User(user_name="f16a-admin-b", email="admin-b-f16a@example.test", password_hash="unused"),
            User(user_name="f16a-member-b", email="member-b-f16a@example.test", password_hash="unused"),
        ]
        db.add_all(users); db.flush()
        user_ids = {user.user_name: user.user_id for user in users}
        a = Tenant(slug="f16a-tenant-a", name="F16a Tenant A", status="active", settings_json="{}", membership_version=1)
        b = Tenant(slug="f16a-tenant-b", name="F16a Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([a, b]); db.flush()
        tenant_a_id, tenant_b_id = a.tenant_id, b.tenant_id
        db.add_all([
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f16a-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f16a-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f16a-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f16a-owner-b"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f16a-admin-b"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f16a-member-b"], status="active", tenant_role="member", joined_at=now),
        ])
        # Existing dictionary rows must survive the following migration.
        legacy_type = TenantDictType(tenant_id=tenant_a_id, dict_name="F16a Legacy Dictionary", dict_type="f16a.legacy",
            order_num=10, status="0", remark=None, created_by=user_ids["f16a-owner-a"], updated_by=user_ids["f16a-owner-a"],
            created_at=now, updated_at=now)
        db.add(legacy_type); db.commit()
        legacy_type_id = legacy_type.dict_type_id

    command.upgrade(alembic, "head")
    from app.models.tenant_config import TenantConfig
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == ScriptDirectory.from_config(alembic).get_current_head()
        inspector = inspect(connection)
        assert "tenant_configs" in inspector.get_table_names()
        uniques = inspector.get_unique_constraints("tenant_configs")
        assert any(item["column_names"] == ["tenant_id", "config_key"] for item in uniques)
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    with factory() as db:
        assert db.get(TenantDictType, legacy_type_id).dict_type == "f16a.legacy"

    from app.auth.security import issue_token
    from fastapi import FastAPI
    import app.main as main_module
    # The target API is the real FastAPI app; this test supplies only a minimal
    # mounted child for the unrelated AgentScope integration and its Redis deps.
    main_module.create_agentscope_app = lambda _settings: FastAPI()
    token_names = {"owner_a": "f16a-owner-a", "admin_a": "f16a-admin-a", "member_a": "f16a-member-a",
                   "owner_b": "f16a-owner-b", "admin_b": "f16a-admin-b", "member_b": "f16a-member-b"}
    tokens = {name: issue_token(user_ids[username], 0) for name, username in token_names.items()}
    client = TestClient(main_module.create_app())

    def request(method, path, as_user, *, json=None, params=None):
        return client.request(method, f"/api/v1{path}", headers={"Authorization": f"Bearer {tokens[as_user]}"}, json=json, params=params)

    base_a = f"/tenants/{tenant_a_id}/configs"
    base_b = f"/tenants/{tenant_b_id}/configs"
    secret_a = "F16A-ALPHA-MUST-NEVER-LEAK"
    secret_b = "F16A-BETA-PRIVATE"

    # Owner and admin can create a public setting and a secret. Write responses redact secrets.
    public_a = request("post", base_a, "owner_a", json={"config_name": "Alpha Public", "config_key": "runtime.color",
        "config_value": "blue", "group_name": "runtime", "is_frontend": True, "is_sensitive": False, "status": "0"})
    assert public_a.status_code == 201 and public_a.json()["config_value"] == "blue"
    sensitive_a = request("post", base_a, "admin_a", json={"config_name": "Alpha Secret", "config_key": "runtime.secret",
        "config_value": secret_a, "group_name": "runtime", "is_frontend": False, "is_sensitive": True, "status": "0"})
    assert sensitive_a.status_code == 201
    assert sensitive_a.json()["config_value"] is None and sensitive_a.json()["value_redacted"] is True
    secret_a_id = sensitive_a.json()["config_id"]
    public_a_id = public_a.json()["config_id"]

    # A sensitive frontend setting is rejected and duplicate keys conflict only within one tenant.
    forbidden_combo = request("post", base_a, "owner_a", json={"config_name": "Invalid", "config_key": "runtime.bad",
        "config_value": "bad", "is_frontend": True, "is_sensitive": True})
    assert forbidden_combo.status_code == 422
    duplicate = request("post", base_a, "owner_a", json={"config_name": "Duplicate", "config_key": "runtime.color",
        "config_value": "red"})
    assert duplicate.status_code == 409 and duplicate.json()["code"] == "CONFIG_KEY_CONFLICT"
    public_b = request("post", base_b, "owner_b", json={"config_name": "Beta Public", "config_key": "runtime.color",
        "config_value": "amber", "group_name": "runtime", "is_frontend": True})
    assert public_b.status_code == 201 and public_b.json()["tenant_id"] == str(tenant_b_id)
    sensitive_b = request("post", base_b, "admin_b", json={"config_name": "Beta Secret", "config_key": "runtime.secret",
        "config_value": secret_b, "is_sensitive": True})
    assert sensitive_b.status_code == 201 and sensitive_b.json()["config_value"] is None

    # Management list is filtered and sensitive values stay redacted for managers.
    listing = request("get", base_a, "owner_a", params={"config_key": "runtime", "page": 1, "page_size": 20})
    assert listing.status_code == 200 and listing.json()["total"] == 2
    assert all(row["tenant_id"] == str(tenant_a_id) for row in listing.json()["items"])
    listed_secret = next(row for row in listing.json()["items"] if row["config_id"] == secret_a_id)
    assert listed_secret["config_value"] is None and listed_secret["value_redacted"] is True
    sensitive_filter = request("get", base_a, "admin_a", params={"is_sensitive": True})
    assert sensitive_filter.status_code == 200 and sensitive_filter.json()["total"] == 1

    # Secret detail is available only to managers and must not be cacheable.
    detail = request("get", f"{base_a}/{secret_a_id}", "admin_a")
    assert detail.status_code == 200 and detail.json()["config_value"] == secret_a
    assert detail.headers.get("cache-control") == "private, no-store"
    public_detail = request("get", f"{base_a}/{public_a_id}", "owner_a")
    assert public_detail.status_code == 200 and public_detail.headers.get("cache-control") == "private, no-store"

    # Member can call only the public projection; it excludes disabled, backend-only and sensitive rows.
    disabled = request("post", base_a, "owner_a", json={"config_name": "Alpha Disabled", "config_key": "runtime.disabled",
        "config_value": "off", "is_frontend": True, "status": "1"})
    backend_only = request("post", base_a, "owner_a", json={"config_name": "Alpha Backend", "config_key": "runtime.backend",
        "config_value": "backend", "is_frontend": False})
    assert disabled.status_code == backend_only.status_code == 201
    public_response = request("get", f"{base_a}/public", "member_a")
    assert public_response.status_code == 200
    assert public_response.headers.get("cache-control") == "private, no-store"
    assert public_response.json() == {"tenant_id": str(tenant_a_id), "items": [{"key": "runtime.color", "value": "blue", "group": "runtime"}]}
    public_b_response = request("get", f"{base_b}/public", "member_b")
    assert public_b_response.json()["items"] == [{"key": "runtime.color", "value": "amber", "group": "runtime"}]
    assert request("get", base_a, "member_a").status_code == 403
    assert request("get", f"{base_a}/{secret_a_id}", "member_a").status_code == 403
    assert request("post", base_a, "member_a", json={"config_name": "No", "config_key": "runtime.no", "config_value": "no"}).status_code == 403

    # Mutation response must never echo a stored secret. Same-tenant key conflicts and validation remain active.
    patch_secret = request("patch", f"{base_a}/{secret_a_id}", "admin_a", json={"config_value": "F16A-ROTATED-SECRET"})
    assert patch_secret.status_code == 200 and patch_secret.json()["config_value"] is None
    assert patch_secret.json()["value_redacted"] is True
    assert request("patch", f"{base_a}/{secret_a_id}", "owner_a", json={"config_key": "runtime.color"}).status_code == 409
    assert request("patch", f"{base_a}/{secret_a_id}", "owner_a", json={"is_frontend": True}).status_code == 422
    assert request("get", f"{base_a}/{secret_a_id}", "owner_a").json()["config_value"] == "F16A-ROTATED-SECRET"

    # Cross-tenant identifiers are indistinguishable from missing records; disable hides public value.
    assert request("get", f"{base_a}/{sensitive_b.json()['config_id']}", "admin_a").status_code == 404
    assert request("patch", f"{base_a}/{public_b.json()['config_id']}", "owner_a", json={"config_value": "cross"}).status_code == 404
    assert request("delete", f"{base_a}/{public_b.json()['config_id']}", "owner_a").status_code == 404
    disable_public = request("patch", f"{base_a}/{public_a_id}", "admin_a", json={"status": "1"})
    assert disable_public.status_code == 200 and disable_public.json()["config_value"] == "blue"
    assert request("get", f"{base_a}/public", "member_a").json()["items"] == []
    assert request("delete", f"{base_a}/{public_a_id}", "owner_a").status_code == 204
    assert request("get", f"{base_a}/{public_a_id}", "owner_a").status_code == 404

    client.close()

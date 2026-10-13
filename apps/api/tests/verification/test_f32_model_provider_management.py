"""F32 contracts and real SQLite/FastAPI control-plane HTTP regressions.

AgentScope/provider endpoint and reference fixtures do not execute the runtime,
Redis, tools, or a real model provider.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import inspect
from pathlib import Path
import socket
from uuid import UUID

from alembic import command
from alembic.config import Config
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


_F32_SECRET = "F32-HTTP-provider-secret-fixture"
_F32_ROTATED_SECRET = "F32-HTTP-rotated-secret-fixture"
# Endpoint fixture only: no provider requests or AgentScope runtime execution.
_F32_ENDPOINT = "http://localhost:8765/v1"


def _assert_secret_redaction(response):
    for forbidden in (_F32_SECRET, _F32_ROTATED_SECRET, '"api_key"', '"encrypted_api_key"'):
        assert forbidden not in response.text


def _assert_problem(response, status, code):
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["status"] == status
    assert response.json()["code"] == code
    assert response.json()["request_id"].startswith("req_")
    _assert_secret_redaction(response)


@dataclass
class _F32HTTP:
    client: TestClient
    session_factory: sessionmaker[Session]
    workspace_id: str
    other_workspace_id: str
    user_ids: dict[str, int]
    tokens: dict[str, str]
    encryption_key: bytes

    def request(self, method, path, actor="owner", *, workspace_id=None, headers=None, **kwargs):
        workspace_id = workspace_id or self.workspace_id
        request_headers = {
            "Authorization": f"Bearer {self.tokens[actor]}",
            "X-Workspace-ID": workspace_id,
        }
        request_headers.update(headers or {})
        response = self.client.request(
            method,
            f"/api/v1/workspaces/{workspace_id}/ai/{path}",
            headers=request_headers,
            **kwargs,
        )
        _assert_secret_redaction(response)
        return response

    def create_credential(self, actor="owner"):
        response = self.request(
            "POST", "credentials", actor,
            json={"name": "HTTP provider fixture", "api_key": _F32_SECRET, "base_url": _F32_ENDPOINT},
        )
        assert response.status_code == 201, response.text
        return response.json()

    def create_model(self, credential_id):
        response = self.request(
            "POST", "models",
            json={
                "credential_id": credential_id,
                "display_name": "Company Chat",
                "model": "company/chat-v3:2026-10-13",
                "capabilities": {"tool_calling": "unknown"},
                "default_parameters": {"temperature": 0.2},
            },
        )
        assert response.status_code == 201, response.text
        assert credential_id not in response.text
        return response.json()


@pytest.fixture
def f32_http(tmp_path, monkeypatch):
    """Real app, JWT authentication, memberships and request-owned transactions.

    AgentScope runtime and scheduler lifespans are disabled, not replaced with
    simulated successful executions. Only disposable SQLite and fixture keys
    are used; no shared database, Redis or provider is accessed.
    """
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    encryption_key = Fernet.generate_key()
    for name, value in {
        "SYNAPSE_DATABASE_URL": f"sqlite:///{tmp_path / 'f32-http.sqlite'}",
        "SYNAPSE_JWT_SECRET": "f32-http-isolated-jwt-fixture",
        "SYNAPSE_ENV": "development",
        "SYNAPSE_API_PREFIX": "/api/v1",
        "SYNAPSE_DEBUG": "false",
        "SYNAPSE_AGENTSCOPE_ENABLED": "false",
        "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
        "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY": encryption_key.decode("ascii"),
    }.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    api_dir = Path(__file__).resolve().parents[2]
    config = Config(str(api_dir / "alembic.ini"))
    config.set_main_option("script_location", str(api_dir / "app/database/migrations"))
    engine = get_engine()
    try:
        command.upgrade(config, "0018_model_provider_management")
        from app.auth.security import issue_token
        from app.main import create_app
        from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
        from app.models.user import User

        factory = get_session_factory()
        roles = {"owner": "owner", "admin": "admin", "member": "member", "viewer": "viewer"}
        with factory.begin() as db:
            users = {
                name: User(
                    user_name=f"f32-http-{name}", password_hash="unused", status="active",
                    platform_role="platform_admin" if name == "outsider" else "user",
                )
                for name in (*roles, "outsider")
            }
            db.add_all(users.values())
            db.flush()
            user_ids = {name: user.user_id for name, user in users.items()}
            workspace_ids = []
            for slug in ("alpha", "beta"):
                tenant = Tenant(slug=f"f32-http-{slug}", name=slug, status="active", membership_version=1)
                db.add(tenant)
                db.flush()
                workspace = Workspace(
                    tenant_id=tenant.tenant_id, slug=slug, name=slug,
                    status="active", created_by=user_ids["owner"],
                )
                db.add(workspace)
                db.flush()
                workspace_ids.append(str(workspace.workspace_id))
                for name, role in roles.items():
                    db.add(TenantMember(
                        tenant_id=tenant.tenant_id, user_id=user_ids[name], status="active",
                        tenant_role="owner" if name == "owner" else "member",
                    ))
                    db.add(WorkspaceMember(
                        workspace_id=workspace.workspace_id, tenant_id=tenant.tenant_id,
                        user_id=user_ids[name], status="active", workspace_role=role,
                    ))
        tokens = {name: issue_token(user_id, 0) for name, user_id in user_ids.items()}
        with TestClient(create_app(), raise_server_exceptions=False) as client:
            yield _F32HTTP(client, factory, *workspace_ids, user_ids, tokens, encryption_key)
    finally:
        engine.dispose()
        get_session_factory.cache_clear()
        get_engine.cache_clear()
        get_settings.cache_clear()


def test_f32_custom_model_is_scoped_and_credential_secret_is_write_only(monkeypatch):
    # Use a real Fernet key so the test does not depend on deployment settings.
    from cryptography.fernet import Fernet

    monkeypatch.setenv(
        "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY",
        Fernet.generate_key().decode(),
    )
    from app.core.config import get_settings
    from app.database.base import Base
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    from app.schemas.model_provider import (
        CredentialCreate,
        ModelBindingCreate,
        ModelBindingPatch,
    )
    from app.services.model_provider import (
        EndpointNotAllowed,
        ModelBindingInUse,
        ModelBindingReferencesResult,
        ModelProviderService,
    )
    from app.tenancy.context import WorkspaceContext

    get_settings.cache_clear()
    real_getaddrinfo = socket.getaddrinfo

    def endpoint_dns_fixture(host, port, *args, **kwargs):
        # DNS fixture only; the public endpoint does not represent a model run.
        if host == "llm.example.test":
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", 443))]
        return real_getaddrinfo(host, port, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", endpoint_dns_fixture)
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    now = datetime.now(timezone.utc)
    with Session(engine) as db:
        owner = User(user_name="f32-owner", password_hash="unused")
        member = User(user_name="f32-member", password_hash="unused")
        db.add_all([owner, member])
        db.flush()
        tenant = Tenant(
            slug="f32-tenant",
            name="F32",
            status="active",
            settings_json="{}",
            membership_version=1,
        )
        db.add(tenant)
        db.flush()
        workspace = Workspace(
            tenant_id=tenant.tenant_id,
            slug="f32-workspace",
            name="F32 Workspace",
            status="active",
            settings_json="{}",
            created_by=owner.user_id,
        )
        db.add(workspace)
        db.flush()
        db.add_all(
            [
                TenantMember(
                    tenant_id=tenant.tenant_id,
                    user_id=owner.user_id,
                    status="active",
                    tenant_role="owner",
                    joined_at=now,
                ),
                TenantMember(
                    tenant_id=tenant.tenant_id,
                    user_id=member.user_id,
                    status="active",
                    tenant_role="member",
                    joined_at=now,
                ),
                WorkspaceMember(
                    workspace_id=workspace.workspace_id,
                    tenant_id=tenant.tenant_id,
                    user_id=owner.user_id,
                    status="active",
                    workspace_role="owner",
                    joined_at=now,
                ),
                WorkspaceMember(
                    workspace_id=workspace.workspace_id,
                    tenant_id=tenant.tenant_id,
                    user_id=member.user_id,
                    status="active",
                    workspace_role="member",
                    joined_at=now,
                ),
            ]
        )
        db.commit()
        owner_context = WorkspaceContext(
            owner.user_id,
            tenant.tenant_id,
            workspace.workspace_id,
            "owner",
            "owner",
            frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}),
            1,
        )
        member_context = WorkspaceContext(
            member.user_id,
            tenant.tenant_id,
            workspace.workspace_id,
            "member",
            "member",
            frozenset({"resource:read", "resource:create", "resource:update"}),
            1,
        )
        service = ModelProviderService(db)
        credential = service.create_credential(
            CredentialCreate(
                name="Company Gateway",
                api_key="do-not-return",
                base_url="https://llm.example.test/v1",
            ),
            owner_context,
        )
        assert credential.has_secret is True
        assert not hasattr(credential, "api_key")
        binding = service.create_model(
            ModelBindingCreate(
                credential_id=credential.credential_id,
                display_name="Company Chat",
                model="company-chat-v3",
                provider_type="openai_chat",
            ),
            owner_context,
        )
        assert not hasattr(binding, "credential_id")
        assert binding.credential_status == "available"
        member_binding = service.list_models(member_context).items[0]
        assert member_binding.credential_status == "owner_only"
        assert not hasattr(member_binding, "credential_id")
        service.update_model(
            binding.model_binding_id,
            ModelBindingPatch(status="disabled"),
            owner_context,
        )
        from app.services.model_provider import CredentialInUse

        try:
            service.delete_credential(credential.credential_id, owner_context)
        except CredentialInUse:
            pass
        else:
            raise AssertionError("Disabled model references must still block credential deletion")
        assert service.list_model_references(binding.model_binding_id, owner_context).references == ()
        # AgentScope reference fixture only; runtime reference discovery is pending.
        monkeypatch.setattr(
            service,
            "list_model_references",
            lambda model_binding_id, context: ModelBindingReferencesResult(
                model_binding_id,
                ({"kind": "agent", "resource_id": "agent-1", "label": "Agent"},),
            ),
        )
        try:
            service.delete_model(binding.model_binding_id, owner_context)
        except ModelBindingInUse:
            pass
        else:
            raise AssertionError("Referenced model bindings must not be silently orphaned")
        for endpoint in ("https://10.0.0.5/v1", "https://172.16.0.5/v1", "https://192.168.0.5/v1"):
            try:
                service.create_credential(
                    CredentialCreate(
                        name="blocked",
                        api_key="secret",
                        base_url=endpoint,
                    ),
                    owner_context,
                )
            except EndpointNotAllowed:
                pass
            else:
                raise AssertionError(f"Private endpoint was accepted: {endpoint}")


def test_f32_rejects_secret_like_model_metadata():
    from pydantic import ValidationError

    from app.schemas.model_provider import ModelBindingCreate, ModelBindingPatch

    base = {
        "credential_id": "credential-1",
        "display_name": "Safe model",
        "model": "model-v1",
    }
    for field in ("default_parameters", "capabilities"):
        for value in (
            {"api_key": "secret"},
            {"nested": {"authorization": "Bearer secret"}},
            {"items": [{"endpoint": "https://example.test"}]},
        ):
            try:
                ModelBindingCreate(**base, **{field: value})
            except ValidationError:
                pass
            else:
                raise AssertionError(f"Secret-like {field} value was accepted: {value}")
            try:
                ModelBindingPatch(**{field: value})
            except ValidationError:
                pass
            else:
                raise AssertionError(f"Secret-like patch {field} value was accepted: {value}")


def test_f32_provider_registry_requires_workspace_context():
    from app.api.model_provider import router
    from app.tenancy.context import get_workspace_context

    route = next(item for item in router.routes if item.path == "/workspaces/{workspace_id}/ai/providers")
    dependencies = {dependency.call for dependency in route.dependant.dependencies}
    assert get_workspace_context in dependencies
    assert "context" in inspect.signature(route.endpoint).parameters


def test_f32_endpoint_dns_failure_fails_closed_but_keeps_development_localhost(monkeypatch):
    from app.core.config import get_settings
    from app.services import model_provider

    get_settings.cache_clear()
    monkeypatch.setenv("SYNAPSE_ENV", "development")
    monkeypatch.setattr(
        model_provider.socket,
        "getaddrinfo",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            socket.gaierror("temporary name resolution failure")
        ),
    )

    try:
        model_provider._validate_endpoint("https://unresolved.example.test/v1")
    except model_provider.EndpointNotAllowed as exc:
        assert str(exc) == "Endpoint hostname could not be resolved"
    else:
        raise AssertionError("Unresolved external endpoint was accepted")

    assert model_provider._validate_endpoint("http://localhost:8080/v1") == "http://localhost:8080/v1"


def test_f32_http_providers_are_authenticated_and_serializable(f32_http):
    path = f"/api/v1/workspaces/{f32_http.workspace_id}/ai/providers"
    _assert_problem(
        f32_http.client.get(path, headers={"X-Workspace-ID": f32_http.workspace_id}),
        401, "AUTHENTICATION_REQUIRED",
    )
    for actor in ("owner", "admin", "member", "viewer"):
        response = f32_http.request("GET", "providers", actor)
        assert response.status_code == 200, response.text
        assert response.json() == [{
            "provider_type": "openai_chat", "credential_type": "openai_credential",
            "label": "OpenAI-compatible Chat", "capabilities": ["chat"],
            "credential_schema_version": 1, "supports_custom_model_id": True,
            "supports_base_url": True,
        }]
    _assert_problem(f32_http.request("GET", "providers", "outsider"), 403, "MEMBERSHIP_INACTIVE")


def test_f32_http_credential_crud_is_persisted_and_secret_redacted(f32_http):
    from app.models.model_provider import ModelCredential

    credential = f32_http.create_credential()
    credential_id = credential["credential_id"]
    assert str(UUID(credential_id)) == credential_id
    assert credential["workspace_id"] == f32_http.workspace_id
    assert credential["endpoint_host"] == "localhost:8765"
    assert credential["has_secret"] is True and credential["owner"] is True
    for field in ("created_at", "updated_at"):
        assert datetime.fromisoformat(credential[field]).utcoffset().total_seconds() == 0
    assert set(credential) == {
        "credential_id", "workspace_id", "provider_type", "name", "endpoint_host",
        "has_secret", "owner", "created_at", "updated_at",
    }
    response = f32_http.request("GET", "credentials")
    assert response.status_code == 200, response.text
    assert response.json() == [credential]
    response = f32_http.request(
        "PATCH", f"credentials/{credential_id}",
        json={"name": "Rotated connection", "api_key": _F32_ROTATED_SECRET},
    )
    assert response.status_code == 200, response.text
    assert response.json()["credential_id"] == credential_id
    assert response.json()["name"] == "Rotated connection"
    with f32_http.session_factory() as db:
        row = db.get(ModelCredential, credential_id)
        assert row.owner_user_id == f32_http.user_ids["owner"]
        assert row.workspace_id == int(f32_http.workspace_id)
        assert _F32_ROTATED_SECRET not in row.encrypted_api_key
        assert Fernet(f32_http.encryption_key).decrypt(row.encrypted_api_key.encode()).decode() == _F32_ROTATED_SECRET
    response = f32_http.request("DELETE", f"credentials/{credential_id}")
    assert response.status_code == 204 and response.content == b""
    assert f32_http.request("GET", "credentials").json() == []
    with f32_http.session_factory() as db:
        assert db.get(ModelCredential, credential_id) is None


def test_f32_http_custom_model_crud_preserves_ids_and_public_projection(f32_http):
    credential_id = f32_http.create_credential()["credential_id"]
    binding = f32_http.create_model(credential_id)
    binding_id = binding["model_binding_id"]
    assert str(UUID(binding_id)) == binding_id
    assert binding["workspace_id"] == f32_http.workspace_id
    assert binding["model"] == "company/chat-v3:2026-10-13"
    assert binding["status"] == "active"
    assert binding["credential_status"] == "available"
    assert binding["created_by"] == str(f32_http.user_ids["owner"])
    assert binding["capabilities"] == {"tool_calling": "unknown"}
    assert binding["default_parameters"] == {"temperature": 0.2}
    response = f32_http.request("GET", "models")
    assert response.status_code == 200, response.text
    assert response.json() == [binding]
    response = f32_http.request("GET", "models", "member")
    assert response.status_code == 200, response.text
    assert response.json()[0]["credential_status"] == "owner_only"
    assert credential_id not in response.text and '"credential_id"' not in response.text
    response = f32_http.request(
        "PATCH", f"models/{binding_id}",
        json={"model": "company/chat-v4:custom", "status": "disabled"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["model_binding_id"] == binding_id
    assert response.json()["model"] == "company/chat-v4:custom"
    assert response.json()["status"] == "disabled"
    assert credential_id not in response.text
    response = f32_http.request("GET", f"models/{binding_id}/references")
    assert response.status_code == 200, response.text
    assert response.json() == {"model_binding_id": binding_id, "references": []}
    _assert_problem(f32_http.request("DELETE", f"credentials/{credential_id}"), 409, "CREDENTIAL_IN_USE")
    response = f32_http.request("DELETE", f"models/{binding_id}")
    assert response.status_code == 204 and response.content == b""
    assert f32_http.request("GET", "models").json() == []
    response = f32_http.request("DELETE", f"credentials/{credential_id}")
    assert response.status_code == 204 and response.content == b""


def test_f32_http_member_credentials_are_private_even_from_managers(f32_http):
    member_credential = f32_http.create_credential("member")
    credential_id = member_credential["credential_id"]
    response = f32_http.request("PATCH", f"credentials/{credential_id}", "member", json={"name": "Member rotated"})
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Member rotated"
    _assert_problem(f32_http.request("DELETE", f"credentials/{credential_id}", "member"), 403, "FORBIDDEN")
    for actor in ("owner", "admin", "viewer"):
        response = f32_http.request("GET", "credentials", actor)
        assert response.status_code == 200, response.text
        assert response.json() == []
    for actor in ("owner", "admin"):
        _assert_problem(
            f32_http.request("PATCH", f"credentials/{credential_id}", actor, json={"name": "Foreign mutation"}),
            404, "RESOURCE_NOT_FOUND",
        )
        _assert_problem(f32_http.request("DELETE", f"credentials/{credential_id}", actor), 404, "RESOURCE_NOT_FOUND")
        _assert_problem(
            f32_http.request("POST", "models", actor, json={
                "credential_id": credential_id, "display_name": "Foreign credential", "model": "custom-id",
            }),
            404, "RESOURCE_NOT_FOUND",
        )
    response = f32_http.request("GET", "credentials", "member")
    assert response.json()[0]["name"] == "Member rotated"


def test_f32_http_viewers_cannot_mutate_existing_own_credentials(f32_http):
    from app.models.model_provider import ModelCredential
    from app.models.tenant import WorkspaceMember
    from sqlalchemy import select

    credential_id = f32_http.create_credential("member")["credential_id"]
    with f32_http.session_factory.begin() as db:
        membership = db.scalar(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == int(f32_http.workspace_id),
            WorkspaceMember.user_id == f32_http.user_ids["member"],
        ))
        membership.workspace_role = "viewer"
    for actor in ("viewer", "member"):
        _assert_problem(
            f32_http.request("POST", "credentials", actor, json={
                "name": "Viewer creation", "api_key": _F32_SECRET, "base_url": _F32_ENDPOINT,
            }),
            403, "FORBIDDEN",
        )
        _assert_problem(
            f32_http.request("PATCH", f"credentials/{credential_id}", actor, json={"api_key": _F32_ROTATED_SECRET}),
            403, "FORBIDDEN",
        )
        _assert_problem(f32_http.request("DELETE", f"credentials/{credential_id}", actor), 403, "FORBIDDEN")
    response = f32_http.request("GET", "credentials", "member")
    assert response.status_code == 200, response.text
    assert response.json()[0]["credential_id"] == credential_id
    with f32_http.session_factory() as db:
        rows = db.scalars(select(ModelCredential)).all()
        assert len(rows) == 1 and rows[0].credential_id == credential_id
        assert Fernet(f32_http.encryption_key).decrypt(rows[0].encrypted_api_key.encode()).decode() == _F32_SECRET


@pytest.mark.parametrize("actor", ["member", "viewer"])
def test_f32_http_readonly_model_roles_cannot_mutate(f32_http, actor):
    credential_id = f32_http.create_credential()["credential_id"]
    binding_id = f32_http.create_model(credential_id)["model_binding_id"]
    _assert_problem(
        f32_http.request("POST", "models", actor, json={
            "credential_id": credential_id, "display_name": "Unauthorized model", "model": "custom-id",
        }),
        403, "FORBIDDEN",
    )
    _assert_problem(
        f32_http.request("PATCH", f"models/{binding_id}", actor, json={"status": "disabled"}),
        403, "FORBIDDEN",
    )
    _assert_problem(f32_http.request("DELETE", f"models/{binding_id}", actor), 403, "FORBIDDEN")
    response = f32_http.request("GET", "models", actor)
    assert response.status_code == 200, response.text
    assert response.json()[0]["status"] == "active"
    assert response.json()[0]["credential_status"] == "owner_only"
    assert credential_id not in response.text


def test_f32_http_header_mismatch_and_foreign_workspace_fail_closed(f32_http):
    credential_id = f32_http.create_credential()["credential_id"]
    binding_id = f32_http.create_model(credential_id)["model_binding_id"]
    operations = [
        ("GET", "providers", {}),
        ("GET", "credentials", {}),
        ("GET", "models", {}),
        ("POST", "credentials", {"name": "Mismatch", "api_key": _F32_SECRET, "base_url": _F32_ENDPOINT}),
        ("PATCH", f"credentials/{credential_id}", {"name": "Mismatch"}),
        ("DELETE", f"credentials/{credential_id}", {}),
        ("POST", "models", {"credential_id": credential_id, "display_name": "Mismatch", "model": "custom-id"}),
        ("PATCH", f"models/{binding_id}", {"status": "disabled"}),
        ("DELETE", f"models/{binding_id}", {}),
        ("GET", f"models/{binding_id}/references", {}),
    ]
    for method, path, body in operations:
        kwargs = {"json": body} if body else {}
        _assert_problem(
            f32_http.request(method, path, headers={"X-Workspace-ID": f32_http.other_workspace_id}, **kwargs),
            400, "CONTEXT_MISMATCH",
        )
    for path in ("credentials", "models"):
        response = f32_http.request("GET", path, workspace_id=f32_http.other_workspace_id)
        assert response.status_code == 200 and response.json() == []
    for method, path, body in operations[4:]:
        kwargs = {"json": body} if body else {}
        _assert_problem(
            f32_http.request(method, path, workspace_id=f32_http.other_workspace_id, **kwargs),
            404, "RESOURCE_NOT_FOUND",
        )
    assert len(f32_http.request("GET", "credentials").json()) == 1
    assert f32_http.request("GET", "models").json()[0]["status"] == "active"


def test_f32_http_agentscope_reference_fixture_protects_model_delete(f32_http, monkeypatch):
    """Reference projection fixture only; real AgentScope consumer discovery is pending."""
    from app.services.model_provider import ModelBindingReferencesResult, ModelProviderService

    credential_id = f32_http.create_credential()["credential_id"]
    binding_id = f32_http.create_model(credential_id)["model_binding_id"]
    monkeypatch.setattr(
        ModelProviderService, "list_model_references",
        lambda self, model_binding_id, context: ModelBindingReferencesResult(
            model_binding_id,
            ({"kind": "agent", "resource_id": "agentscope-reference-fixture", "label": "Fixture only"},),
        ),
    )
    response = f32_http.request("GET", f"models/{binding_id}/references")
    assert response.status_code == 200, response.text
    assert response.json()["references"][0]["resource_id"] == "agentscope-reference-fixture"
    _assert_problem(f32_http.request("DELETE", f"models/{binding_id}"), 409, "MODEL_BINDING_IN_USE")
    assert f32_http.request("GET", "models").json()[0]["model_binding_id"] == binding_id

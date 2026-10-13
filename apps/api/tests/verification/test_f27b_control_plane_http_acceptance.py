"""Independent F27b HTTP acceptance against FastAPI and migrated SQLite."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier
from types import SimpleNamespace

import pytest
from alembic import command
from alembic.config import Config
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import UniqueConstraint, event, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.base import Base
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.team_orchestration import (
    TeamMemberDefinition,
    TeamRun,
    TeamTaskDefinition,
)
from app.models.user import User
from app.schemas.team_orchestration import TeamStart
from app.services.errors import ConflictError
from app.services.results import ActorContext
from app.services.team_orchestration import (
    InvalidTeamDefinition,
    RunAlreadyActive,
    TeamOrchestrationService,
)


class ControlledAgentAuthorization:
    """Labeled fixture: only these synthetic AgentScope IDs are accepted."""

    label = "controlled AgentAuthorization fixture"

    def validate(
        self,
        *,
        tenant_id: int,
        workspace_id: int,
        actor_user_id: int,
        agent_ids: set[str],
    ) -> None:
        assert tenant_id > 0
        assert workspace_id > 0
        assert actor_user_id > 0
        if not agent_ids <= {"fixture-leader", "fixture-worker"}:
            raise AssertionError(f"unexpected fixture agent: {sorted(agent_ids)}")


def _seed(factory):
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(
            user_name="f27b-independent-owner",
            email="f27b-independent-owner@example.test",
            password_hash="unused",
        )
        member = User(
            user_name="f27b-independent-member",
            email="f27b-independent-member@example.test",
            password_hash="unused",
        )
        viewer = User(
            user_name="f27b-independent-viewer",
            email="f27b-independent-viewer@example.test",
            password_hash="unused",
        )
        db.add_all([owner, member, viewer])
        db.flush()
        tenant = Tenant(slug="f27b-independent-tenant", name="F27b independent")
        db.add(tenant)
        db.flush()
        workspace = Workspace(
            tenant_id=tenant.tenant_id,
            slug="f27b-independent-workspace",
            name="F27b independent workspace",
            status="active",
            created_by=owner.user_id,
        )
        other_workspace = Workspace(
            tenant_id=tenant.tenant_id,
            slug="f27b-independent-other",
            name="F27b other workspace",
            status="active",
            created_by=owner.user_id,
        )
        db.add_all([workspace, other_workspace])
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
                TenantMember(
                    tenant_id=tenant.tenant_id,
                    user_id=viewer.user_id,
                    status="active",
                    tenant_role="member",
                    joined_at=now,
                ),
            ]
        )
        for user, role in (
            (owner, "owner"),
            (member, "member"),
            (viewer, "viewer"),
        ):
            db.add(
                WorkspaceMember(
                    workspace_id=workspace.workspace_id,
                    tenant_id=tenant.tenant_id,
                    user_id=user.user_id,
                    status="active",
                    workspace_role=role,
                    joined_at=now,
                )
            )
        db.add(
            WorkspaceMember(
                workspace_id=other_workspace.workspace_id,
                tenant_id=tenant.tenant_id,
                user_id=owner.user_id,
                status="active",
                workspace_role="owner",
                joined_at=now,
            )
        )
        db.commit()
        return {
            "owner": owner.user_id,
            "member": member.user_id,
            "viewer": viewer.user_id,
            "tenant": tenant.tenant_id,
            "workspace": workspace.workspace_id,
            "other_workspace": other_workspace.workspace_id,
        }


def _team_body(name="Independent HTTP team", task_prefix="independent"):
    foundation_task = f"{task_prefix}-foundation"
    report_task = f"{task_prefix}-report"
    return {
        "name": name,
        "description": "independent F27b acceptance",
        "members": [
            {"agent_id": "fixture-leader", "role": "lead", "is_leader": True},
            {"agent_id": "fixture-worker", "role": "worker", "is_leader": False},
        ],
        "tasks": [
            {
                "task_id": foundation_task,
                "subject": "Foundation",
                "owner_member_id": "fixture-worker",
            },
            {
                "task_id": report_task,
                "subject": "Report",
                "owner_member_id": "fixture-leader",
                "depends_on": [foundation_task],
            },
        ],
    }


@pytest.fixture
def http_control_plane(tmp_path, monkeypatch):
    db_path = tmp_path / "f27b-independent-http.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f27b-independent-http-secret")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.main import create_app

    factory = get_session_factory()
    ids = _seed(factory)
    app = create_app()
    app.state.team_agent_authorization = ControlledAgentAuthorization()
    tokens = {
        role: issue_token(user_id, 0)
        for role, user_id in ids.items()
        if role in {"owner", "member", "viewer"}
    }
    try:
        yield app, factory, ids, tokens
    finally:
        get_engine().dispose()
        get_session_factory.cache_clear()
        get_engine.cache_clear()
        get_settings.cache_clear()


def _headers(token, workspace_id, **extra):
    return {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": str(workspace_id),
        **extra,
    }


def _assert_no_500(response, expected):
    assert response.status_code == expected, response.text
    assert response.status_code != 500


def test_real_http_auth_context_roles_patch_runs_events_and_sqlite_invariants(
    http_control_plane,
):
    app, factory, ids, tokens = http_control_plane
    workspace_id = ids["workspace"]
    other_workspace_id = ids["other_workspace"]
    base = f"/api/v1/workspaces/{workspace_id}/teams"
    owner_headers = _headers(tokens["owner"], workspace_id)
    member_headers = _headers(tokens["member"], workspace_id)
    viewer_headers = _headers(tokens["viewer"], workspace_id)

    with TestClient(app) as client:
        missing_auth = client.get(base, headers={"X-Workspace-ID": str(workspace_id)})
        _assert_no_500(missing_auth, 401)

        missing_header = client.get(
            base, headers={"Authorization": owner_headers["Authorization"]}
        )
        _assert_no_500(missing_header, 400)
        assert missing_header.json()["code"] == "WORKSPACE_CONTEXT_REQUIRED"

        wrong_header = client.get(
            base,
            headers=_headers(tokens["owner"], other_workspace_id),
        )
        _assert_no_500(wrong_header, 400)
        assert wrong_header.json()["code"] == "CONTEXT_MISMATCH"

        created = client.post(base, headers=owner_headers, json=_team_body())
        _assert_no_500(created, 201)
        created_body = created.json()
        team_id = created_body["team_id"]
        assert len(created_body["members"]) == 2
        assert len(created_body["tasks"]) == 2

        listed_for_member = client.get(base, headers=member_headers)
        _assert_no_500(listed_for_member, 200)
        assert listed_for_member.json()["total"] == 1
        listed_for_viewer = client.get(base, headers=viewer_headers)
        _assert_no_500(listed_for_viewer, 200)
        assert listed_for_viewer.json()["items"][0]["team_id"] == team_id

        foreign_workspace = client.get(
            f"/api/v1/workspaces/{other_workspace_id}/teams/{team_id}",
            headers=_headers(tokens["owner"], other_workspace_id),
        )
        _assert_no_500(foreign_workspace, 404)

        cross_actor_patch = client.patch(
            f"{base}/{team_id}",
            headers=member_headers,
            json={"name": "member must not own this draft"},
        )
        _assert_no_500(cross_actor_patch, 403)
        viewer_patch = client.patch(
            f"{base}/{team_id}",
            headers=viewer_headers,
            json={"name": "viewer must not edit"},
        )
        _assert_no_500(viewer_patch, 403)

        patched = client.patch(
            f"{base}/{team_id}",
            headers=owner_headers,
            json={"name": "independent patched team"},
        )
        _assert_no_500(patched, 200)
        patched_body = patched.json()
        assert len(patched_body["members"]) == 2
        assert len(patched_body["tasks"]) == 2
        assert patched_body["name"] == "independent patched team"

        started = client.post(
            f"{base}/{team_id}/runs",
            headers=_headers(tokens["owner"], workspace_id, **{"Idempotency-Key": "first"}),
            json={"team_version": patched_body["version"]},
        )
        _assert_no_500(started, 202)
        run_body = started.json()
        run_id = run_body["team_run_id"]
        assert run_body["execution_mode"] == "durable_control_only"
        assert started.headers["Location"] == f"{base}/{team_id}/runs/{run_id}"

        repeated = client.post(
            f"{base}/{team_id}/runs",
            headers=_headers(tokens["owner"], workspace_id, **{"Idempotency-Key": "first"}),
            json={"team_version": patched_body["version"]},
        )
        _assert_no_500(repeated, 202)
        assert repeated.json()["team_run_id"] == run_id

        second_key_while_active = client.post(
            f"{base}/{team_id}/runs",
            headers=_headers(tokens["owner"], workspace_id, **{"Idempotency-Key": "second"}),
            json={"team_version": patched_body["version"]},
        )
        _assert_no_500(second_key_while_active, 409)
        assert second_key_while_active.json()["code"] == "RUN_ALREADY_ACTIVE"

        member_start = client.post(
            f"{base}/{team_id}/runs",
            headers=_headers(tokens["member"], workspace_id, **{"Idempotency-Key": "member"}),
            json={"team_version": patched_body["version"]},
        )
        _assert_no_500(member_start, 403)
        viewer_start = client.post(
            f"{base}/{team_id}/runs",
            headers=_headers(tokens["viewer"], workspace_id, **{"Idempotency-Key": "viewer"}),
            json={"team_version": patched_body["version"]},
        )
        _assert_no_500(viewer_start, 403)
        member_interrupt = client.post(
            f"{base}/{team_id}/runs/{run_id}/interrupt",
            headers=member_headers,
            json={"expected_run_version": run_body["run_version"]},
        )
        _assert_no_500(member_interrupt, 403)
        viewer_interrupt = client.post(
            f"{base}/{team_id}/runs/{run_id}/interrupt",
            headers=viewer_headers,
            json={"expected_run_version": run_body["run_version"]},
        )
        _assert_no_500(viewer_interrupt, 403)

        visible_run = client.get(
            f"{base}/{team_id}/runs/{run_id}", headers=member_headers
        )
        _assert_no_500(visible_run, 200)
        assert visible_run.json()["workspace_id"] == str(workspace_id)

        interrupted = client.post(
            f"{base}/{team_id}/runs/{run_id}/interrupt",
            headers=owner_headers,
            json={
                "expected_run_version": run_body["run_version"],
                "reason": "independent acceptance",
            },
        )
        _assert_no_500(interrupted, 200)
        interrupted_body = interrupted.json()
        assert interrupted_body["status"] == "interrupt_requested"
        assert interrupted_body["capabilities"]["interrupt_confirmation_pending"] is True
        assert all(task["state"] == "pending" for task in interrupted_body["tasks"])

        repeated_interrupt = client.post(
            f"{base}/{team_id}/runs/{run_id}/interrupt",
            headers=owner_headers,
            json={"expected_run_version": interrupted_body["run_version"]},
        )
        _assert_no_500(repeated_interrupt, 200)
        assert repeated_interrupt.json()["run_version"] == interrupted_body["run_version"]

        events = client.get(f"{base}/{team_id}/runs/{run_id}/events", headers=viewer_headers)
        _assert_no_500(events, 200)
        event_types = [event["event_type"] for event in events.json()["items"]]
        assert event_types == ["run_preparing", "run_started", "interrupt_requested"]

        stream = client.get(
            f"{base}/{team_id}/runs/{run_id}/events?stream=true",
            headers=viewer_headers,
        )
        _assert_no_500(stream, 200)
        assert stream.headers["content-type"].startswith("text/event-stream")
        assert "event: run_started" in stream.text

        cross_actor_get = client.get(
            f"{base}/{team_id}", headers=member_headers
        )
        _assert_no_500(cross_actor_get, 200)

        with factory() as db:
            run = db.get(TeamRun, run_id)
            assert run is not None
            run.status = "completed"
            db.commit()

        second_run = client.post(
            f"{base}/{team_id}/runs",
            headers=_headers(tokens["owner"], workspace_id, **{"Idempotency-Key": "terminal-second-run"}),
            json={"team_version": patched_body["version"]},
        )
        _assert_no_500(second_run, 202)
        assert second_run.json()["team_run_id"] != run_id

        # This checks the sequential two-session conflict. The simultaneous
        # HTTP race is covered independently below.
        race_team = client.post(
            base,
            headers=owner_headers,
            json=_team_body("SQLite two-session team", task_prefix="sqlite-race"),
        )
        _assert_no_500(race_team, 201)
        race_team_body = race_team.json()
        with factory() as first_db, factory() as second_db:
            authorization = ControlledAgentAuthorization()
            first_service = TeamOrchestrationService(first_db, authorization)
            second_service = TeamOrchestrationService(second_db, authorization)
            actor = ActorContext(user_id=ids["owner"])
            first = first_service.start_run(
                workspace_id,
                race_team_body["team_id"],
                TeamStart(team_version=race_team_body["version"]),
                "sqlite-key-a",
                str(workspace_id),
                actor,
            )
            first_db.commit()
            with pytest.raises(RunAlreadyActive):
                second_service.start_run(
                    workspace_id,
                    race_team_body["team_id"],
                    TeamStart(team_version=race_team_body["version"]),
                    "sqlite-key-b",
                    str(workspace_id),
                    actor,
                )
            active_rows = second_db.scalars(
                select(TeamRun).where(
                    TeamRun.team_id == race_team_body["team_id"],
                    TeamRun.status.in_(("preparing", "running", "interrupt_requested")),
                )
            ).all()
            assert [row.run_id for row in active_rows] == [first.team_run_id]

        # Composite migration FKs reject a run whose team and Workspace belong
        # to different tenants, with SQLite foreign-key enforcement enabled.
        with factory() as db:
            mismatched = TeamRun(
                run_id="run_mismatched-tenant",
                team_id=team_id,
                tenant_id=ids["tenant"] + 999,
                workspace_id=workspace_id,
                created_by=ids["owner"],
                team_version=patched_body["version"],
                status="completed",
                idempotency_key="mismatched",
                snapshot_json="{}",
            )
            db.add(mismatched)
            with pytest.raises(IntegrityError):
                db.flush()
            db.rollback()


def test_http_team_local_ids_duplicate_errors_and_stable_member_patch(http_control_plane):
    app, _, ids, tokens = http_control_plane
    base = f"/api/v1/workspaces/{ids['workspace']}/teams"
    headers = _headers(tokens["owner"], ids["workspace"])
    with TestClient(app) as client:
        first = client.post(base, headers=headers, json=_team_body("First team"))
        second = client.post(base, headers=headers, json=_team_body("Second team"))
        _assert_no_500(first, 201)
        _assert_no_500(second, 201)
        before = first.json()
        other = second.json()
        assert before["team_id"] != other["team_id"]
        assert {t["task_id"] for t in before["tasks"]} == {
            t["task_id"] for t in other["tasks"]
        }
        for actor in ("member", "viewer"):
            denied = client.post(
                base, headers=_headers(tokens[actor], ids["workspace"]),
                json=_team_body(f"{actor} cannot create"),
            )
            _assert_no_500(denied, 403)

        duplicate = _team_body("Duplicate task IDs")
        duplicate["tasks"][1]["task_id"] = duplicate["tasks"][0]["task_id"]
        rejected = client.post(base, headers=headers, json=duplicate)
        _assert_no_500(rejected, 400)
        assert rejected.json()["code"] == "INVALID_TEAM_DEFINITION"
        assert client.get(base, headers=headers).json()["total"] == 2

        task_inputs = [
            {key: value for key, value in task.items() if key not in {"state", "attempt"}}
            for task in before["tasks"]
        ]
        task_inputs[0]["subject"] = "Updated with returned member ID"
        team_path = f"{base}/{before['team_id']}"
        patched = client.patch(team_path, headers=headers, json={"tasks": task_inputs})
        _assert_no_500(patched, 200)
        after = patched.json()
        assert after["members"] == before["members"]
        assert after["tasks"][0]["owner_member_id"] == task_inputs[0]["owner_member_id"]

        member_inputs = [
            {key: value for key, value in member.items() if key != "member_id"}
            for member in reversed(before["members"])
        ]
        members_only = client.patch(team_path, headers=headers, json={"members": member_inputs})
        _assert_no_500(members_only, 200)
        assert members_only.json()["tasks"] == after["tasks"]
        assert {m["agent_id"]: m["member_id"] for m in members_only.json()["members"]} == {
            m["agent_id"]: m["member_id"] for m in before["members"]
        }
        persisted_before_rejection = client.get(team_path, headers=headers).json()

        foreign_owner = dict(task_inputs[0], owner_member_id=other["members"][0]["member_id"])
        rejected = client.patch(team_path, headers=headers, json={"tasks": [foreign_owner]})
        _assert_no_500(rejected, 400)
        assert rejected.json()["code"] == "INVALID_TEAM_DEFINITION"
        assert client.get(team_path, headers=headers).json() == persisted_before_rejection


def _schema_signature(engine, table_name):
    inspector = inspect(engine)
    return {
        "columns": [(c["name"], str(c["type"]), c["nullable"], c["default"])
                    for c in inspector.get_columns(table_name)],
        "pk": inspector.get_pk_constraint(table_name),
        "foreign_keys": sorted(inspector.get_foreign_keys(table_name), key=repr),
        "unique": sorted(inspector.get_unique_constraints(table_name), key=repr),
        "checks": sorted(inspector.get_check_constraints(table_name), key=repr),
        "indexes": sorted([
            {**index, "dialect_options": {
                key: str(value) for key, value in index.get("dialect_options", {}).items()
            }} for index in inspector.get_indexes(table_name)
        ], key=repr),
    }


def test_http_duplicate_team_names_return_conflict_and_rollback(http_control_plane):
    app, factory, ids, tokens = http_control_plane
    base = f"/api/v1/workspaces/{ids['workspace']}/teams"
    headers = _headers(tokens["owner"], ids["workspace"])
    with TestClient(app) as client:
        first = client.post(base, headers=headers, json=_team_body("Reserved name"))
        second = client.post(base, headers=headers, json=_team_body("Other name"))
        _assert_no_500(first, 201)
        _assert_no_500(second, 201)
        first_path = f"{base}/{first.json()['team_id']}"
        second_path = f"{base}/{second.json()['team_id']}"
        before_first = client.get(first_path, headers=headers).json()
        before_second = client.get(second_path, headers=headers).json()

        duplicate_create = client.post(base, headers=headers, json=_team_body("Reserved name"))
        _assert_no_500(duplicate_create, 409)
        assert duplicate_create.json()["code"] == "CONFLICT"
        duplicate_patch = client.patch(second_path, headers=headers, json={
            "name": "Reserved name",
            "tasks": [{
                "task_id": "replacement", "subject": "Must roll back",
                "owner_member_id": before_second["members"][0]["member_id"],
            }],
        })
        _assert_no_500(duplicate_patch, 409)
        assert duplicate_patch.json()["code"] == "CONFLICT"
        assert client.get(first_path, headers=headers).json() == before_first
        assert client.get(second_path, headers=headers).json() == before_second
        assert client.get(base, headers=headers).json()["total"] == 2
        with factory() as db:
            assert len(db.scalars(select(TeamMemberDefinition)).all()) == 4
            assert len(db.scalars(select(TeamTaskDefinition)).all()) == 4


def test_integrity_diagnostic_mapping_is_narrow_for_sqlite_and_postgres():
    # These driver diagnostic objects are labeled fixtures, not a live PG test.
    class DriverDiagnostic(Exception):
        def __init__(self, constraint_name):
            super().__init__("PostgreSQL diagnostic fixture")
            self.diag = SimpleNamespace(constraint_name=constraint_name)

    active_sqlite = IntegrityError("INSERT team_runs", {}, RuntimeError(
        "UNIQUE constraint failed: team_runs.team_id"
    ))
    active_pg = IntegrityError("INSERT team_runs", {}, DriverDiagnostic(
        "uq_team_runs_one_active"
    ))
    for error in (active_sqlite, active_pg):
        assert TeamOrchestrationService._is_one_active_run_integrity_error(error)

    name_sqlite = IntegrityError("INSERT team_definitions", {}, RuntimeError(
        "UNIQUE constraint failed: team_definitions.workspace_id, "
        "team_definitions.created_by, team_definitions.name"
    ))
    name_pg = IntegrityError("INSERT team_definitions", {}, DriverDiagnostic(
        "uq_team_definitions_workspace_actor_name"
    ))
    for error in (name_sqlite, name_pg):
        with pytest.raises(ConflictError) as captured:
            TeamOrchestrationService._raise_team_name_conflict(error)
        assert captured.value.__cause__ is error
        assert not TeamOrchestrationService._is_one_active_run_integrity_error(error)

    unrelated = [
        IntegrityError("uq_team_runs_one_active", {}, RuntimeError("FOREIGN KEY constraint failed")),
        IntegrityError("INSERT team_runs", {}, RuntimeError(
            "UNIQUE constraint failed: team_runs.team_id, team_runs.idempotency_key"
        )),
        IntegrityError("INSERT team_tasks", {}, RuntimeError(
            "UNIQUE constraint failed: team_task_definitions.task_id, team_task_definitions.team_id"
        )),
        IntegrityError("INSERT team_runs", {}, DriverDiagnostic("fk_team_runs_team_scope")),
    ]
    for error in unrelated:
        assert not TeamOrchestrationService._is_one_active_run_integrity_error(error)
        TeamOrchestrationService._raise_team_name_conflict(error)




@pytest.mark.parametrize("from_0016", [False, True], ids=["fresh-head", "0016-to-head"])
def test_alembic_team_schema_matches_metadata_and_preserves_preexisting_tables(
    tmp_path, monkeypatch, from_0016,
):
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    db_path = tmp_path / "f27b-schema.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    engine = get_engine()
    preserved = {}
    try:
        if from_0016:
            command.upgrade(Config("alembic.ini"), "0016_tenant_validity")
            preserved = {
                name: _schema_signature(engine, name)
                for name in inspect(engine).get_table_names()
            }
            seed = _seed(get_session_factory())
        command.upgrade(Config("alembic.ini"), "head")
        for name, signature in preserved.items():
            assert _schema_signature(engine, name) == signature, name
        if from_0016:
            with get_session_factory()() as db:
                assert db.get(User, seed["owner"]).user_name == "f27b-independent-owner"
                assert db.get(Workspace, seed["workspace"]).tenant_id == seed["tenant"]
                assert len(db.scalars(select(WorkspaceMember)).all()) == 4
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                "0018_model_provider_management"
            )
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        inspector = inspect(engine)
        for table_name in (
            "team_definitions", "team_member_definitions", "team_task_definitions", "team_runs",
        ):
            table = Base.metadata.tables[table_name]
            actual_columns = inspector.get_columns(table_name)
            assert [(c["name"], str(c["type"]), c["nullable"]) for c in actual_columns] == [
                (c.name, str(c.type), c.nullable) for c in table.columns
            ]
            assert inspector.get_pk_constraint(table_name)["constrained_columns"] == [
                c.name for c in table.primary_key.columns
            ]
            expected_fks = {
                (fk.name, tuple(e.parent.name for e in fk.elements),
                 tuple(e.target_fullname for e in fk.elements), fk.ondelete)
                for fk in table.foreign_key_constraints
            }
            actual_fks = {
                (fk["name"], tuple(fk["constrained_columns"]),
                 tuple(f"{fk['referred_table']}.{column}" for column in fk["referred_columns"]),
                 fk["options"].get("ondelete"))
                for fk in inspector.get_foreign_keys(table_name)
            }
            assert actual_fks == expected_fks, table_name
            assert {
                (c["name"], tuple(c["column_names"]))
                for c in inspector.get_unique_constraints(table_name)
            } == {
                (c.name, tuple(column.name for column in c.columns))
                for c in table.constraints if isinstance(c, UniqueConstraint)
            }
            assert {
                (i["name"], tuple(i["column_names"]), bool(i["unique"]),
                 str(i.get("dialect_options", {}).get("sqlite_where", "")))
                for i in inspector.get_indexes(table_name)
            } == {
                (i.name, tuple(c.name for c in i.columns), bool(i.unique),
                 str(i.dialect_options["sqlite"]["where"])
                 if i.dialect_options["sqlite"]["where"] is not None else "")
                for i in table.indexes
            }
    finally:
        engine.dispose()
        get_session_factory.cache_clear()
        get_engine.cache_clear()
        get_settings.cache_clear()


def test_migrated_sqlite_rejects_valid_foreign_workspace_and_task_owner(http_control_plane):
    app, factory, ids, tokens = http_control_plane
    base = f"/api/v1/workspaces/{ids['workspace']}/teams"
    headers = _headers(tokens["owner"], ids["workspace"])
    with TestClient(app) as client:
        first = client.post(base, headers=headers, json=_team_body("FK first"))
        second = client.post(base, headers=headers, json=_team_body("FK second"))
        _assert_no_500(first, 201)
        _assert_no_500(second, 201)
    with factory() as db:
        with pytest.raises(IntegrityError, match="FOREIGN KEY constraint failed"):
            with db.begin_nested():
                db.add(TeamRun(
                    run_id="wrong-existing-workspace", team_id=first.json()["team_id"],
                    tenant_id=ids["tenant"], workspace_id=ids["other_workspace"],
                    created_by=ids["owner"], team_version=1, status="completed",
                    idempotency_key="wrong-workspace", snapshot_json="{}",
                ))
                db.flush()
        with pytest.raises(IntegrityError, match="FOREIGN KEY constraint failed"):
            with db.begin_nested():
                db.add(TeamTaskDefinition(
                    task_id="wrong-existing-owner", team_id=second.json()["team_id"],
                    subject="Foreign owner", owner_member_id=first.json()["members"][0]["member_id"],
                ))
                db.flush()
        assert db.scalar(select(TeamRun)) is None
        assert len(db.scalars(select(TeamTaskDefinition)).all()) == 4


def test_request_rollback_restores_children_after_post_flush_failure(http_control_plane):
    from app.api.team_orchestration import service as service_dependency
    from app.database.session import get_db

    app, factory, ids, tokens = http_control_plane
    base = f"/api/v1/workspaces/{ids['workspace']}/teams"
    headers = _headers(tokens["owner"], ids["workspace"])

    class FailAfterFlush(TeamOrchestrationService):
        def _team_result(self, team):
            super()._team_result(team)
            raise InvalidTeamDefinition("Controlled failure after the real SQLite flush")

    def failing_service(db: Session = Depends(get_db)):
        return FailAfterFlush(db, ControlledAgentAuthorization())

    with TestClient(app) as client:
        created = client.post(base, headers=headers, json=_team_body())
        _assert_no_500(created, 201)
        before = created.json()
        path = f"{base}/{before['team_id']}"
        persisted_before_failure = client.get(path, headers=headers).json()
        app.dependency_overrides[service_dependency] = failing_service
        try:
            failed = client.patch(path, headers=headers, json={
                "name": "Must roll back", "tasks": [{
                    "task_id": "replacement", "subject": "Must roll back",
                    "owner_member_id": before["members"][0]["member_id"],
                }],
            })
            _assert_no_500(failed, 400)
            assert failed.json()["code"] == "INVALID_TEAM_DEFINITION"
        finally:
            app.dependency_overrides.pop(service_dependency)
        restored = client.get(path, headers=headers)
        _assert_no_500(restored, 200)
        assert restored.json() == persisted_before_failure
        with factory() as db:
            assert len(db.scalars(select(TeamMemberDefinition)).all()) == 2
            assert len(db.scalars(select(TeamTaskDefinition)).all()) == 2


def test_simultaneous_http_starts_return_conflict_with_one_active_sqlite_row(http_control_plane):
    from app.database.session import get_engine

    app, factory, ids, tokens = http_control_plane
    base = f"/api/v1/workspaces/{ids['workspace']}/teams"
    headers = _headers(tokens["owner"], ids["workspace"])
    barrier = Barrier(2, timeout=10)
    driver_errors = []

    def capture_driver_error(context):
        driver_errors.append(str(context.original_exception))

    class SynchronizedAuthorization(ControlledAgentAuthorization):
        def validate(self, **context):
            super().validate(**context)
            # Both real request sessions have observed no active run before
            # this seam. SQLite then arbitrates the actual competing inserts.
            barrier.wait()

    with TestClient(app, raise_server_exceptions=False) as client:
        created = client.post(base, headers=headers, json=_team_body())
        _assert_no_500(created, 201)
        team = created.json()
        app.state.team_agent_authorization = SynchronizedAuthorization()

        def start(key):
            return client.post(
                f"{base}/{team['team_id']}/runs",
                headers={**headers, "Idempotency-Key": key},
                json={"team_version": team["version"]},
            )

        engine = get_engine()
        event.listen(engine, "handle_error", capture_driver_error)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(start, ("race-key-a", "race-key-b")))
        finally:
            event.remove(engine, "handle_error", capture_driver_error)
        with factory() as db:
            active = db.scalars(select(TeamRun).where(
                TeamRun.team_id == team["team_id"],
                TeamRun.status.in_(("preparing", "running", "interrupt_requested")),
            )).all()
            assert len(active) == 1
        print({"status_codes": sorted(response.status_code for response in responses),
               "sqlite_errors": driver_errors, "persisted_active_rows": len(active)})
        assert sorted(response.status_code for response in responses) == [202, 409], [
            (response.status_code, response.text) for response in responses
        ]
        conflict = next(response for response in responses if response.status_code == 409)
        assert conflict.json()["code"] == "RUN_ALREADY_ACTIVE"
        assert driver_errors == ["UNIQUE constraint failed: team_runs.team_id"]

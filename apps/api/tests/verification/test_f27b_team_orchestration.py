"""Focused F27b durable team control-plane tests."""

import asyncio
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.base import Base
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.user import User
from app.models.team_orchestration import TeamRun
from app.schemas.team_orchestration import (
    TeamCreate,
    TeamInterrupt,
    TeamMemberInput,
    TeamPatch,
    TeamStart,
    TeamTaskInput,
)
from app.services.results import ActorContext
from app.services.team_orchestration import InvalidTeamDefinition, TeamOrchestrationService


class _AllowlistedAgents:
    def validate(self, *, tenant_id: int, workspace_id: int, actor_user_id: int, agent_ids: set[str]) -> None:
        assert agent_ids <= {"agent-leader", "agent-worker"}


def _seed(db: Session):
    now = datetime.now(timezone.utc)
    user = User(user_name="f27b-owner", password_hash="test", status="active")
    db.add(user)
    db.flush()
    tenant = Tenant(slug="f27b-tenant", name="F27b Tenant", status="active")
    db.add(tenant)
    db.flush()
    workspace = Workspace(tenant_id=tenant.tenant_id, slug="f27b-workspace", name="F27b Workspace", status="active", created_by=user.user_id)
    db.add(workspace)
    db.flush()
    db.add_all([
        TenantMember(tenant_id=tenant.tenant_id, user_id=user.user_id, status="active", tenant_role="owner", joined_at=now),
        WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant.tenant_id, user_id=user.user_id, status="active", workspace_role="owner", joined_at=now),
    ])
    db.commit()
    return user, tenant, workspace


def test_team_run_is_durable_idempotent_and_interruptible():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user, tenant, workspace = _seed(db)
        service = TeamOrchestrationService(db, _AllowlistedAgents())
        actor = ActorContext(user_id=user.user_id)
        team = service.create_team(
            workspace.workspace_id,
            TeamCreate(
                name="Research team",
                description="F27b",
                members=[
                    TeamMemberInput(agent_id="agent-leader", role="leader", is_leader=True),
                    TeamMemberInput(agent_id="agent-worker", role="researcher"),
                ],
                tasks=[
                    TeamTaskInput(task_id="task-research", subject="Research", owner_member_id="agent-worker"),
                ],
            ),
            str(workspace.workspace_id),
            actor,
        )
        assert team.status == "draft"
        assert len(team.members) == 2
        assert len(team.tasks) == 1

        started = service.start_run(
            workspace.workspace_id,
            team.team_id,
            TeamStart(team_version=team.version),
            "same-request",
            str(workspace.workspace_id),
            actor,
        )
        repeated = service.start_run(
            workspace.workspace_id,
            team.team_id,
            TeamStart(team_version=team.version),
            "same-request",
            str(workspace.workspace_id),
            actor,
        )
        assert repeated.team_run_id == started.team_run_id
        interrupted = service.interrupt_run(
            workspace.workspace_id,
            team.team_id,
            started.team_run_id,
            TeamInterrupt(expected_run_version=started.run_version, reason="test"),
            str(workspace.workspace_id),
            actor,
        )
        assert interrupted.status == "interrupt_requested"
        assert interrupted.tasks[0].state == "pending"
        assert interrupted.capabilities.can_interrupt is False
        assert interrupted.capabilities.interrupt_confirmation_pending is True
        events = service.events(workspace.workspace_id, team.team_id, started.team_run_id, str(workspace.workspace_id), actor)
        assert [event.event_type for event in events] == ["run_preparing", "run_started", "interrupt_requested"]

        repeated = service.interrupt_run(
            workspace.workspace_id,
            team.team_id,
            started.team_run_id,
            TeamInterrupt(expected_run_version=interrupted.run_version, reason="duplicate"),
            str(workspace.workspace_id),
            actor,
        )
        assert repeated.status == "interrupt_requested"
        assert repeated.run_version == interrupted.run_version
        assert service.events(
            workspace.workspace_id,
            team.team_id,
            started.team_run_id,
            str(workspace.workspace_id),
            actor,
        ) == events


def test_team_scope_rejects_foreign_workspace():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user, _, workspace = _seed(db)
        service = TeamOrchestrationService(db, _AllowlistedAgents())
        actor = ActorContext(user_id=user.user_id)
        team = service.create_team(
            workspace.workspace_id,
            TeamCreate(
                name="Scoped team",
                members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
                tasks=[TeamTaskInput(subject="One task", owner_member_id="agent-leader")],
            ),
            str(workspace.workspace_id),
            actor,
        )
        from app.services.errors import NotFoundError

        try:
            service.get_team(workspace.workspace_id + 999, team.team_id, str(workspace.workspace_id + 999), actor)
        except NotFoundError:
            pass
        else:
            raise AssertionError("foreign workspace must not read the team")


def test_agentscope_adapter_requires_exact_scoped_agent_existence():
    from unittest.mock import AsyncMock

    from app.integrations.team_agent_authorization import AgentScopeAgentAuthorization

    storage = type("Storage", (), {})()
    storage.list_agents = AsyncMock(
        return_value=[type("Agent", (), {"id": "synapse-agent-t1-w2-u3-agent-a"})()]
    )
    adapter = AgentScopeAgentAuthorization(storage)
    async def scenario():
        from anyio import to_thread

        await to_thread.run_sync(lambda: adapter.validate(
            tenant_id=1, workspace_id=2, actor_user_id=3,
            agent_ids={"synapse-agent-t1-w2-u3-agent-a"},
        ))
        try:
            await to_thread.run_sync(lambda: adapter.validate(
                tenant_id=1, workspace_id=2, actor_user_id=3, agent_ids={"agent-not-owned"},
            ))
        except Exception as exc:
            assert type(exc).__name__ == "AgentAuthorizationUnavailable"
        else:
            raise AssertionError("unknown agent must fail closed")

    asyncio.run(scenario())


def test_team_run_rejects_empty_selection_and_non_closed_dependencies():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user, _, workspace = _seed(db)
        service = TeamOrchestrationService(db, _AllowlistedAgents())
        actor = ActorContext(user_id=user.user_id)
        team = service.create_team(
            workspace.workspace_id,
            TeamCreate(
                name="Dependency team",
                members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
                tasks=[
                    TeamTaskInput(task_id="task-a", subject="A", owner_member_id="agent-leader"),
                    TeamTaskInput(
                        task_id="task-b",
                        subject="B",
                        owner_member_id="agent-leader",
                        depends_on=["task-a"],
                    ),
                ],
            ),
            str(workspace.workspace_id),
            actor,
        )

        with pytest.raises(InvalidTeamDefinition, match="dependency closure"):
            service.start_run(
                workspace.workspace_id,
                team.team_id,
                TeamStart(team_version=team.version, task_ids=["task-b"]),
                "non-closed",
                str(workspace.workspace_id),
                actor,
            )

        empty = TeamStart.model_construct(team_version=team.version, task_ids=[])
        with pytest.raises(InvalidTeamDefinition, match="At least one task"):
            service.start_run(
                workspace.workspace_id,
                team.team_id,
                empty,
                "empty-selection",
                str(workspace.workspace_id),
                actor,
            )


def test_normal_member_cannot_create_or_edit_another_actor_draft_team():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner, tenant, workspace = _seed(db)
        member = User(user_name="f27b-member", password_hash="test", status="active")
        db.add(member)
        db.flush()
        now = datetime.now(timezone.utc)
        db.add_all([
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
                user_id=member.user_id,
                status="active",
                workspace_role="member",
                joined_at=now,
            ),
        ])
        db.commit()
        owner_service = TeamOrchestrationService(db, _AllowlistedAgents())
        owner_actor = ActorContext(user_id=owner.user_id)
        member_service = TeamOrchestrationService(db, _AllowlistedAgents())
        member_actor = ActorContext(user_id=member.user_id)
        body = TeamCreate(
            name="Owner team",
            members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
            tasks=[TeamTaskInput(subject="Task", owner_member_id="agent-leader")],
        )
        team = owner_service.create_team(
            workspace.workspace_id, body, str(workspace.workspace_id), owner_actor
        )

        from app.services.team_orchestration import TeamControlForbidden

        with pytest.raises(TeamControlForbidden):
            member_service.create_team(
                workspace.workspace_id,
                body.model_copy(update={"name": "Member team"}),
                str(workspace.workspace_id),
                member_actor,
            )
        with pytest.raises(TeamControlForbidden):
            member_service.update_team(
                workspace.workspace_id,
                team.team_id,
                TeamPatch(name="Hijacked team"),
                str(workspace.workspace_id),
                member_actor,
            )


def test_active_run_database_invariant_and_integrity_conflict_mapping():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user, _, workspace = _seed(db)
        workspace_id = workspace.workspace_id
        service = TeamOrchestrationService(db, _AllowlistedAgents())
        actor = ActorContext(user_id=user.user_id)
        team = service.create_team(
            workspace.workspace_id,
            TeamCreate(
                name="Single-run team",
                members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
                tasks=[TeamTaskInput(subject="Task", owner_member_id="agent-leader")],
            ),
            str(workspace.workspace_id),
            actor,
        )
        started = service.start_run(
            workspace.workspace_id,
            team.team_id,
                TeamStart(team_version=team.version),
            "first",
            str(workspace.workspace_id),
            actor,
        )
        duplicate = TeamRun(
            run_id="run_duplicate",
            team_id=team.team_id,
            tenant_id=int(team.tenant_id),
            workspace_id=workspace_id,
            created_by=user.user_id,
            team_version=team.version,
            status="running",
            idempotency_key="second",
            snapshot_json="{}",
        )
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
        conflict_team = service.create_team(
            workspace_id,
            TeamCreate(
                name="Conflict mapping team",
                members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
                tasks=[TeamTaskInput(subject="Task", owner_member_id="agent-leader")],
            ),
            str(workspace_id),
            actor,
        )
        db.commit()
        conflict_db = Session(engine, autoflush=False)
        conflict_service = TeamOrchestrationService(conflict_db, _AllowlistedAgents())

        with patch.object(
            conflict_db,
            "flush",
            side_effect=IntegrityError(
                "active run",
                {},
                Exception("UNIQUE constraint failed: uq_team_runs_one_active"),
            ),
        ):
            from app.services.team_orchestration import RunAlreadyActive

            with pytest.raises(RunAlreadyActive):
                conflict_service.start_run(
                    workspace_id,
                    conflict_team.team_id,
                    TeamStart(team_version=conflict_team.version),
                    "concurrent",
                    str(workspace_id),
                    actor,
                )
        conflict_db.close()
        assert started.status == "running"


def test_terminal_run_allows_a_new_run_and_non_active_conflicts_propagate():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user, _, workspace = _seed(db)
        workspace_id = workspace.workspace_id
        service = TeamOrchestrationService(db, _AllowlistedAgents())
        actor = ActorContext(user_id=user.user_id)
        team = service.create_team(
            workspace_id,
            TeamCreate(
                name="History team",
                members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
                tasks=[TeamTaskInput(subject="Task", owner_member_id="agent-leader")],
            ),
            str(workspace_id),
            actor,
        )
        first = service.start_run(
            workspace_id,
            team.team_id,
            TeamStart(team_version=team.version),
            "first",
            str(workspace_id),
            actor,
        )
        historical = db.get(TeamRun, first.team_run_id)
        historical.status = "completed"
        db.commit()

        second = service.start_run(
            workspace_id,
            team.team_id,
            TeamStart(team_version=team.version),
            "second",
            str(workspace_id),
            actor,
        )
        assert second.team_run_id != first.team_run_id
        second_run = db.get(TeamRun, second.team_run_id)
        second_run.status = "completed"
        db.commit()

        conflict_db = Session(engine, autoflush=False)
        conflict_service = TeamOrchestrationService(conflict_db, _AllowlistedAgents())
        foreign_key_error = IntegrityError(
            "INSERT INTO team_runs",
            {},
            RuntimeError("FOREIGN KEY constraint failed"),
        )
        with patch.object(conflict_db, "flush", side_effect=foreign_key_error):
            with pytest.raises(IntegrityError):
                conflict_service.start_run(
                    workspace_id,
                    team.team_id,
                    TeamStart(team_version=team.version),
                    "third",
                    str(workspace_id),
                    actor,
                )
        conflict_db.close()


def test_team_control_plane_real_http_paths_use_workspace_context_and_typed_wire_contract(
    tmp_path, monkeypatch
):
    """Real HTTP coverage; AgentAuthorization is a controlled allowlist fixture."""
    db_path = tmp_path / "f27b-http.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f27b-http-verification-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    import app.main as main_module

    monkeypatch.setattr(main_module, "create_agentscope_app", lambda _settings: FastAPI())
    factory = get_session_factory()
    with factory() as db:
        owner = User(
            user_name="f27b-http-owner",
            email="f27b-http-owner@example.test",
            password_hash="unused",
            token_version=0,
        )
        db.add(owner)
        db.flush()
        tenant = Tenant(slug="f27b-http-tenant", name="F27b HTTP Tenant", status="active")
        db.add(tenant)
        db.flush()
        workspace = Workspace(
            tenant_id=tenant.tenant_id,
            slug="f27b-http-workspace",
            name="F27b HTTP Workspace",
            status="active",
            created_by=owner.user_id,
        )
        db.add(workspace)
        db.flush()
        now = datetime.now(timezone.utc)
        db.add_all(
            [
                TenantMember(
                    tenant_id=tenant.tenant_id,
                    user_id=owner.user_id,
                    status="active",
                    tenant_role="owner",
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
            ]
        )
        db.commit()
        user_id = owner.user_id
        workspace_id = workspace.workspace_id

    app = main_module.create_app()
    app.state.team_agent_authorization = _AllowlistedAgents()
    token = issue_token(user_id, 0)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": str(workspace_id),
    }
    base = f"/api/v1/workspaces/{workspace_id}/teams"
    body = {
        "name": "HTTP team",
        "description": "real route coverage",
        "members": [
            {"agent_id": "agent-leader", "role": "leader", "is_leader": True},
        ],
        "tasks": [
            {"task_id": "http-task", "subject": "HTTP task", "owner_member_id": "agent-leader"},
        ],
    }

    with TestClient(app) as client:
        missing_context = client.get(base, headers={"Authorization": headers["Authorization"]})
        assert missing_context.status_code == 400
        assert "WORKSPACE_CONTEXT_REQUIRED" in missing_context.text

        created = client.post(base, headers=headers, json=body)
        assert created.status_code == 201, created.text
        created_body = created.json()
        assert created_body["workspace_id"] == str(workspace_id)
        assert created_body["tenant_id"].isdecimal()
        team_id = created_body["team_id"]

        listed = client.get(base, headers=headers)
        assert listed.status_code == 200, listed.text
        assert listed.json()["total"] == 1
        assert listed.json()["items"][0]["team_id"] == team_id

        started = client.post(
            f"{base}/{team_id}/runs",
            headers={**headers, "Idempotency-Key": "http-run"},
            json={"team_version": created_body["version"]},
        )
        assert started.status_code == 202, started.text
        started_body = started.json()
        assert started_body["team_run_id"].startswith("run_")
        assert started.headers["Location"].endswith(started_body["team_run_id"])

        run = client.get(
            f"{base}/{team_id}/runs/{started_body['team_run_id']}",
            headers=headers,
        )
        assert run.status_code == 200, run.text
        assert run.json()["workspace_id"] == str(workspace_id)
        assert run.json()["capabilities"]["can_interrupt"] is True

        interrupted = client.post(
            f"{base}/{team_id}/runs/{started_body['team_run_id']}/interrupt",
            headers=headers,
            json={"expected_run_version": started_body["run_version"], "reason": "http-test"},
        )
        assert interrupted.status_code == 200, interrupted.text
        assert interrupted.json()["status"] == "interrupt_requested"
        assert interrupted.json()["capabilities"]["interrupt_confirmation_pending"] is True

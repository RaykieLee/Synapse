"""Team-local IDs and ownership invariants against real SQLite.

Agent ownership is a controlled fixture; no worker/model execution.
"""
from datetime import timedelta
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.base import Base
from app.database.session import _enable_sqlite_foreign_keys
from app.models.team_orchestration import TeamRun, TeamTaskDefinition
from app.models.tenant import Workspace
from app.schemas.team_orchestration import TeamCreate, TeamMemberInput, TeamPatch, TeamTaskInput
from app.services.results import ActorContext
from app.services.errors import ConflictError
from app.services.team_orchestration import InvalidTeamDefinition, TeamOrchestrationService
from tests.verification.test_f27b_team_orchestration import _AllowlistedAgents, _seed


@pytest.fixture
def team_service(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'invariants.sqlite'}")
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user, tenant, workspace = _seed(db)
        yield TeamOrchestrationService(db, _AllowlistedAgents()), ActorContext(user.user_id), tenant, workspace
    engine.dispose()


def _definition(name, tasks=None):
    return TeamCreate(
        name=name,
        members=[TeamMemberInput(agent_id="agent-leader", is_leader=True)],
        tasks=tasks if tasks is not None else [TeamTaskInput(task_id="analysis", subject="Analyze", owner_member_id="agent-leader")],
    )


def _create(fixture, name, tasks=None):
    service, actor, _, workspace = fixture
    return service.create_team(workspace.workspace_id, _definition(name, tasks), str(workspace.workspace_id), actor)


def test_client_task_ids_can_be_reused_by_different_teams(team_service):
    first = _create(team_service, "First")
    second = _create(team_service, "Second")
    assert first.team_id != second.team_id
    assert first.tasks[0].task_id == second.tasks[0].task_id == "analysis"


def test_duplicate_task_ids_fail_with_domain_error(team_service):
    tasks = [TeamTaskInput(task_id="duplicate", subject=name, owner_member_id="agent-leader") for name in ("One", "Two")]
    with pytest.raises(InvalidTeamDefinition):
        _create(team_service, "Duplicates", tasks)


def test_duplicate_team_name_returns_domain_conflict(team_service):
    _create(team_service, "Duplicate name")
    with pytest.raises(ConflictError):
        _create(team_service, "Duplicate name")


def test_patch_can_use_the_member_id_returned_by_api(team_service):
    service, actor, _, workspace = team_service
    before = _create(team_service, "Editable")
    after = service.update_team(
        workspace.workspace_id, before.team_id,
        TeamPatch(tasks=[TeamTaskInput(task_id="analysis", subject="Updated", owner_member_id=before.members[0].member_id)]),
        str(workspace.workspace_id), actor,
    )
    assert after.tasks[0].subject == "Updated"
    assert after.tasks[0].owner_member_id == after.members[0].member_id
    assert after.members[0].member_id == before.members[0].member_id


def test_reloaded_team_timestamps_keep_utc_offset(team_service):
    service, actor, _, workspace = team_service
    created = _create(team_service, "UTC team")
    service.db.commit()
    loaded = service.get_team(workspace.workspace_id, created.team_id, str(workspace.workspace_id), actor)
    assert loaded.created_at.utcoffset() == timedelta(0)
    assert loaded.updated_at.utcoffset() == timedelta(0)


def test_run_cannot_claim_a_different_workspace_in_same_tenant(team_service):
    service, actor, tenant, workspace = team_service
    team = _create(team_service, "Run scope")
    other = Workspace(tenant_id=tenant.tenant_id, slug="other", name="Other", created_by=actor.user_id, status="active")
    service.db.add(other)
    service.db.flush()
    service.db.add(TeamRun(
        run_id="wrong-workspace", team_id=team.team_id, tenant_id=tenant.tenant_id,
        workspace_id=other.workspace_id, created_by=actor.user_id, team_version=team.version,
        status="running", idempotency_key="wrong-workspace", snapshot_json="{}",
    ))
    with pytest.raises(IntegrityError):
        service.db.flush()


def test_task_cannot_reference_another_teams_member(team_service):
    service, *_ = team_service
    first = _create(team_service, "Task owner one")
    second = _create(team_service, "Task owner two", [])
    service.db.add(TeamTaskDefinition(
        task_id="foreign-owner", team_id=second.team_id, subject="Invalid owner",
        owner_member_id=first.members[0].member_id,
    ))
    with pytest.raises(IntegrityError):
        service.db.flush()

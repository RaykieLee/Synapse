"""Application service for the F27b-1 durable team control plane."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Protocol
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, Workspace, WorkspaceMember, TenantMember
from app.models.tenant_member_role import TenantMemberRole
from app.models.tenant_role import TenantRole
from app.models.team_orchestration import (
    TeamDefinition,
    TeamMemberDefinition,
    TeamRun,
    TeamTaskDefinition,
)
from app.schemas.team_orchestration import (
    TeamCreate,
    TeamInterrupt,
    TeamMemberInput,
    TeamPatch,
    TeamStart,
    TeamTaskInput,
)
from app.services.errors import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.services.results import ActorContext


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    # SQLite can return naive values even for DateTime(timezone=True); restore
    # the UTC offset at the service DTO boundary.
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


class TeamVersionConflict(ConflictError):
    code = "VERSION_CONFLICT"


class RunAlreadyActive(ConflictError):
    code = "RUN_ALREADY_ACTIVE"


class InvalidTeamDefinition(BadRequestError):
    code = "INVALID_TEAM_DEFINITION"


class TeamControlForbidden(ForbiddenError):
    code = "TEAM_CONTROL_FORBIDDEN"


class AgentAuthorizationUnavailable(ForbiddenError):
    code = "AGENT_AUTHORIZATION_UNAVAILABLE"


class AgentAuthorization(Protocol):
    """Repository-owned seam for resolving AgentScope agent ownership."""

    def validate(
        self,
        *,
        tenant_id: int,
        workspace_id: int,
        actor_user_id: int,
        agent_ids: set[str],
    ) -> None:
        ...


class RejectUnverifiedAgentAuthorization:
    """Fail closed until the AgentScope adapter supplies an ownership check."""

    def validate(self, *, tenant_id: int, workspace_id: int, actor_user_id: int, agent_ids: set[str]) -> None:
        if agent_ids:
            raise AgentAuthorizationUnavailable(
                "Agent ownership could not be verified for this Workspace"
            )


@dataclass(frozen=True)
class TeamAccess:
    team: TeamDefinition
    workspace: Workspace
    tenant: Tenant
    role: str


@dataclass(frozen=True)
class TeamMemberResult:
    member_id: str
    agent_id: str
    role: str
    is_leader: bool


@dataclass(frozen=True)
class TeamTaskResult:
    task_id: str
    subject: str
    description: str
    owner_member_id: str
    depends_on: tuple[str, ...]
    allow_failure: bool
    state: str = "draft"
    attempt: int = 0


@dataclass(frozen=True)
class TeamResult:
    team_id: str
    workspace_id: str
    tenant_id: str
    name: str
    description: str
    status: str
    visibility: str
    version: int
    created_by: str
    created_at: datetime
    updated_at: datetime
    members: tuple[TeamMemberResult, ...]
    tasks: tuple[TeamTaskResult, ...]


@dataclass(frozen=True)
class TeamRunAcceptedResult:
    team_id: str
    team_run_id: str
    team_version: int
    run_version: int
    status: str
    accepted_at: datetime
    execution_mode: str


@dataclass(frozen=True)
class TeamRunMemberResult:
    member_id: str
    agent_id: str
    status: str
    session_id: str | None


@dataclass(frozen=True)
class TeamRunTaskResult:
    task_id: str
    subject: str
    description: str
    owner_member_id: str
    depends_on: tuple[str, ...]
    allow_failure: bool
    state: str
    attempt: int


@dataclass(frozen=True)
class TeamRunCapabilitiesResult:
    can_pause: bool
    can_resume: bool
    can_interrupt: bool
    interrupt_confirmation_pending: bool
    can_retry: bool
    can_execute: bool


@dataclass(frozen=True)
class TeamRunResult:
    team_run_id: str
    team_id: str
    workspace_id: str
    team_version: int
    run_version: int
    status: str
    progress: dict
    members: tuple[TeamRunMemberResult, ...]
    tasks: tuple[TeamRunTaskResult, ...]
    capabilities: TeamRunCapabilitiesResult
    execution_mode: str
    last_error: dict | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class TeamEventResult:
    event_id: str
    sequence: int
    event_type: str
    team_id: str
    team_run_id: str
    occurred_at: datetime
    payload: dict


class TeamOrchestrationService:
    """Owns Workspace-shared team invariants and durable state transitions.

    Every active Workspace member can read team definitions and run snapshots.
    Owner/admin membership is required for start and interrupt controls.
    """

    def __init__(self, db: Session, agent_authorization: AgentAuthorization | None = None):
        self.db = db
        self.agent_authorization = agent_authorization or RejectUnverifiedAgentAuthorization()

    def list_teams(self, workspace_id: int, header_workspace_id: str | None, actor: ActorContext):
        access = self._workspace_access(workspace_id, header_workspace_id, actor)
        teams = self.db.scalars(
            select(TeamDefinition).where(
                TeamDefinition.workspace_id == access.workspace.workspace_id,
                TeamDefinition.tenant_id == access.tenant.tenant_id,
            ).order_by(TeamDefinition.created_at.desc())
        ).all()
        return tuple(self._team_result(team) for team in teams)

    def get_team(self, workspace_id: int, team_id: str, header_workspace_id: str | None, actor: ActorContext):
        access = self._access(workspace_id, header_workspace_id, actor, team_id=team_id)
        return self._team_result(access.team)

    def create_team(self, workspace_id: int, body: TeamCreate, header_workspace_id: str | None, actor: ActorContext):
        access = self._workspace_access(workspace_id, header_workspace_id, actor)
        self._authorize_team_create(access, actor)
        self._validate_definition(body.members, body.tasks)
        self._validate_agents(access, {member.agent_id for member in body.members}, actor)
        team_id = f"team_{uuid4().hex}"
        team = TeamDefinition(
            team_id=team_id, tenant_id=access.tenant.tenant_id, workspace_id=workspace_id,
            created_by=actor.user_id, updated_by=actor.user_id, name=body.name,
            description=body.description, status="draft",
        )
        self.db.add(team)
        try:
            self._replace_children(team_id, body.members, body.tasks)
            self._flush_team()
        except IntegrityError as exc:
            self._raise_team_name_conflict(exc)
            raise
        return self._team_result(team)

    def update_team(self, workspace_id: int, team_id: str, body: TeamPatch, header_workspace_id: str | None, actor: ActorContext):
        access = self._access(workspace_id, header_workspace_id, actor, team_id=team_id, lock=True)
        self._authorize_team_update(access, actor)
        if access.team.status != "draft":
            raise InvalidTeamDefinition("Only draft teams can be edited")
        if body.expected_version is not None and body.expected_version != access.team.version:
            raise TeamVersionConflict("Team version is stale")
        members = body.members
        tasks = body.tasks
        if members is not None or tasks is not None:
            existing_members = self._member_inputs(team_id) if members is None else members
            existing_tasks = self._task_inputs(team_id) if tasks is None else tasks
            aliases = {
                row.member_id: row.agent_id
                for row in self.db.scalars(select(TeamMemberDefinition).where(TeamMemberDefinition.team_id == team_id)).all()
            }
            existing_tasks = [
                item.model_copy(update={"owner_member_id": aliases.get(item.owner_member_id, item.owner_member_id)})
                for item in existing_tasks
            ]
            self._validate_definition(existing_members, existing_tasks)
            self._validate_agents(access, {member.agent_id for member in existing_members}, actor)
            self._replace_children(team_id, existing_members, existing_tasks)
        if body.name is not None:
            access.team.name = body.name
        if body.description is not None:
            access.team.description = body.description
        access.team.version += 1
        access.team.updated_by = actor.user_id
        access.team.updated_at = _now()
        self._flush_team()
        return self._team_result(access.team)

    def start_run(self, workspace_id: int, team_id: str, body: TeamStart, idempotency_key: str | None, header_workspace_id: str | None, actor: ActorContext):
        if not idempotency_key:
            raise InvalidTeamDefinition("Idempotency-Key is required")
        access = self._access(workspace_id, header_workspace_id, actor, team_id=team_id, lock=True)
        if access.role not in {"owner", "admin"}:
            raise TeamControlForbidden("Workspace owner or admin role is required")
        existing = self.db.scalar(select(TeamRun).where(TeamRun.team_id == team_id, TeamRun.idempotency_key == idempotency_key))
        if existing is not None:
            return self._accepted(existing)
        active = self.db.scalar(
            select(TeamRun).where(
                TeamRun.team_id == team_id,
                TeamRun.status.in_(("preparing", "running", "interrupt_requested")),
            )
        )
        if active is not None:
            raise RunAlreadyActive("This team already has an active run")
        if body.team_version != access.team.version:
            raise TeamVersionConflict("Team version is stale")
        if access.team.status != "draft":
            raise InvalidTeamDefinition("Only draft teams can start")
        members = self.db.scalars(select(TeamMemberDefinition).where(TeamMemberDefinition.team_id == team_id)).all()
        tasks = self.db.scalars(select(TeamTaskDefinition).where(TeamTaskDefinition.team_id == team_id)).all()
        self._validate_agents(access, {member.agent_id for member in members}, actor)
        self._validate_runtime(members, tasks, body.task_ids)
        snapshot = self._snapshot(access.team, members, tasks, body.task_ids)
        run = TeamRun(
            run_id=f"run_{uuid4().hex}", team_id=team_id, tenant_id=access.tenant.tenant_id,
            workspace_id=workspace_id, created_by=actor.user_id, team_version=access.team.version,
            status="running", idempotency_key=idempotency_key, snapshot_json=json.dumps(snapshot),
        )
        self.db.add(run)
        self._append_event(run, "run_preparing", {})
        self._append_event(run, "run_started", {"execution_mode": "durable_control_only"})
        try:
            self.db.flush()
        except IntegrityError as exc:
            if self._is_one_active_run_integrity_error(exc):
                raise RunAlreadyActive("This team already has an active run") from exc
            raise
        return self._accepted(run)

    def get_run(self, workspace_id: int, team_id: str, run_id: str, header_workspace_id: str | None, actor: ActorContext):
        self._access(workspace_id, header_workspace_id, actor, team_id=team_id)
        run = self._run(team_id, run_id)
        return self._run_result(run)

    def interrupt_run(self, workspace_id: int, team_id: str, run_id: str, body: TeamInterrupt, header_workspace_id: str | None, actor: ActorContext):
        access = self._access(workspace_id, header_workspace_id, actor, team_id=team_id, lock=True)
        if access.role not in {"owner", "admin"}:
            raise TeamControlForbidden("Workspace owner or admin role is required")
        run = self._run(team_id, run_id, lock=True)
        if body.expected_run_version is not None and body.expected_run_version != run.run_version:
            raise TeamVersionConflict("Run version is stale")
        if run.status == "interrupt_requested":
            return self._run_result(run)
        if run.status in {"interrupted", "completed", "failed", "cancelled"}:
            return self._run_result(run)
        run.status = "interrupt_requested"
        run.run_version += 1
        self._append_event(run, "interrupt_requested", {"reason": body.reason})
        self.db.flush()
        return self._run_result(run)

    def events(self, workspace_id: int, team_id: str, run_id: str, header_workspace_id: str | None, actor: ActorContext):
        self._access(workspace_id, header_workspace_id, actor, team_id=team_id)
        return tuple(
            TeamEventResult(
                event_id=event["event_id"],
                sequence=event["sequence"],
                event_type=event["event_type"],
                team_id=event["team_id"],
                team_run_id=event["team_run_id"],
                occurred_at=datetime.fromisoformat(event["occurred_at"]),
                payload=event["payload"],
            )
            for event in json.loads(self._run(team_id, run_id).events_json)
        )

    def _workspace_access(self, workspace_id: int, header_workspace_id: str | None, actor: ActorContext):
        if header_workspace_id != str(workspace_id):
            raise BadRequestError("Workspace context does not match the path")
        workspace = self.db.get(Workspace, workspace_id)
        if workspace is None:
            raise NotFoundError("Workspace not found")
        tenant = self.db.get(Tenant, workspace.tenant_id)
        membership = self.db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == actor.user_id))
        tenant_membership = self.db.scalar(select(TenantMember).where(TenantMember.tenant_id == workspace.tenant_id, TenantMember.user_id == actor.user_id))
        if tenant is None or tenant.status != "active" or workspace.status != "active" or not membership or membership.status != "active" or not tenant_membership or tenant_membership.status != "active":
            raise ForbiddenError("Workspace membership is inactive")
        return TeamAccess(None, workspace, tenant, membership.workspace_role)

    def _authorize_team_create(self, access: TeamAccess, actor: ActorContext) -> None:
        if access.role in {"owner", "admin"}:
            return
        if "team:create" in self._actor_permissions(access.tenant.tenant_id, actor.user_id):
            return
        raise TeamControlForbidden(
            "Workspace owner or admin role, or team:create permission, is required"
        )

    def _authorize_team_update(self, access: TeamAccess, actor: ActorContext) -> None:
        if access.role in {"owner", "admin"}:
            return
        if access.team.created_by != actor.user_id:
            raise TeamControlForbidden(
                "Only the team creator or an authorized Workspace administrator can edit this team"
            )
        if "team:update" not in self._actor_permissions(access.tenant.tenant_id, actor.user_id):
            raise TeamControlForbidden(
                "team:update permission is required to edit this team"
            )

    def _actor_permissions(self, tenant_id: int, user_id: int) -> frozenset[str]:
        assignment = self.db.scalar(
            select(TenantMemberRole).where(
                TenantMemberRole.tenant_id == tenant_id,
                TenantMemberRole.user_id == user_id,
            )
        )
        if assignment is None:
            return frozenset()
        role = self.db.scalar(
            select(TenantRole).where(
                TenantRole.tenant_id == tenant_id,
                TenantRole.role_id == assignment.role_id,
                TenantRole.status == "active",
                TenantRole.del_flag.is_(False),
            )
        )
        if role is None:
            return frozenset()
        try:
            permissions = json.loads(role.permissions_json or "[]")
        except (TypeError, ValueError):
            return frozenset()
        if not isinstance(permissions, list) or not all(
            isinstance(permission, str) for permission in permissions
        ):
            return frozenset()
        return frozenset(permissions)

    @staticmethod
    def _is_one_active_run_integrity_error(exc: IntegrityError) -> bool:
        # SQLite reports partial-index violations in the driver message, while
        # PostgreSQL exposes the constraint through the DBAPI diagnostics.
        orig = getattr(exc, "orig", None)
        diag = getattr(orig, "diag", None)
        constraint = getattr(diag, "constraint_name", None)
        if constraint == "uq_team_runs_one_active":
            return True
        return (
            "uq_team_runs_one_active" in str(orig)
            or str(orig).strip() == "UNIQUE constraint failed: team_runs.team_id"
        )

    def _flush_team(self) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            self._raise_team_name_conflict(exc)
            raise

    @staticmethod
    def _raise_team_name_conflict(exc: IntegrityError) -> None:
        orig = getattr(exc, "orig", None)
        constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
        if constraint == "uq_team_definitions_workspace_actor_name" or str(orig).strip() == (
            "UNIQUE constraint failed: team_definitions.workspace_id, "
            "team_definitions.created_by, team_definitions.name"
        ):
            raise ConflictError("A team with this name already exists for this actor") from exc

    def _access(self, workspace_id: int, header_workspace_id: str | None, actor: ActorContext, *, team_id: str, lock: bool = False):
        base = self._workspace_access(workspace_id, header_workspace_id, actor)
        query = select(TeamDefinition).where(TeamDefinition.team_id == team_id, TeamDefinition.workspace_id == workspace_id, TeamDefinition.tenant_id == base.tenant.tenant_id)
        if lock:
            query = query.with_for_update()
        team = self.db.scalar(query)
        if team is None:
            raise NotFoundError("Team not found")
        return TeamAccess(team, base.workspace, base.tenant, base.role)

    def _run(self, team_id: str, run_id: str, lock: bool = False):
        query = select(TeamRun).where(TeamRun.team_id == team_id, TeamRun.run_id == run_id)
        if lock:
            query = query.with_for_update()
        run = self.db.scalar(query)
        if run is None:
            raise NotFoundError("Team run not found")
        return run

    def _validate_definition(self, members, tasks):
        leaders = [member for member in members if member.is_leader]
        member_ids = {member.member_id for member in members if hasattr(member, "member_id")} | {member.agent_id for member in members}
        if len(leaders) != 1:
            raise InvalidTeamDefinition("Exactly one leader is required")
        if len({member.agent_id for member in members}) != len(members):
            raise InvalidTeamDefinition("An agent can only appear once in a team")
        task_ids = {task.task_id for task in tasks if getattr(task, "task_id", None)}
        explicit_ids = [task.task_id for task in tasks if getattr(task, "task_id", None)]
        if len(task_ids) != len(explicit_ids):
            raise InvalidTeamDefinition("Task IDs must be unique within a team")
        for task in tasks:
            if task.owner_member_id not in member_ids and task.owner_member_id not in {member.agent_id for member in members}:
                raise InvalidTeamDefinition("Task owner must be a team member")
            dependencies = task.depends_on if hasattr(task, "depends_on") else json.loads(task.depends_on_json)
            if dependencies and not getattr(task, "task_id", None):
                raise InvalidTeamDefinition("Tasks with dependencies require task_id values")
            if any(dep not in task_ids for dep in dependencies):
                raise InvalidTeamDefinition("Task dependency must reference a task in this team")
        graph = {
            task.task_id: set(task.depends_on if hasattr(task, "depends_on") else json.loads(task.depends_on_json))
            for task in tasks if getattr(task, "task_id", None)
        }
        visiting: set[str] = set()
        visited: set[str] = set()
        def visit(node: str):
            if node in visiting:
                raise InvalidTeamDefinition("Task dependencies contain a cycle")
            if node in visited:
                return
            visiting.add(node)
            for dep in graph.get(node, set()):
                visit(dep)
            visiting.remove(node)
            visited.add(node)
        for node in graph:
            visit(node)

    def _validate_runtime(self, members, tasks, selected):
        if not members:
            raise InvalidTeamDefinition("At least one member is required")
        if not tasks:
            raise InvalidTeamDefinition("At least one task is required")
        if selected is None:
            return
        if not selected:
            raise InvalidTeamDefinition("At least one task must be selected")
        selected_ids = set(selected)
        if len(selected_ids) != len(selected):
            raise InvalidTeamDefinition("Selected task IDs must be unique")
        task_map = {task.task_id: task for task in tasks}
        unknown = selected_ids - task_map.keys()
        if unknown:
            raise InvalidTeamDefinition("Selected task does not belong to this team")
        missing_dependencies = {
            dependency
            for task_id in selected_ids
            for dependency in json.loads(task_map[task_id].depends_on_json)
            if dependency not in selected_ids
        }
        if missing_dependencies:
            raise InvalidTeamDefinition(
                "Selected tasks must include their full dependency closure"
            )

    def _validate_agents(self, access: TeamAccess, agent_ids: set[str], actor: ActorContext):
        self.agent_authorization.validate(
            tenant_id=access.tenant.tenant_id,
            workspace_id=access.workspace.workspace_id,
            actor_user_id=actor.user_id,
            agent_ids=agent_ids,
        )

    def _replace_children(self, team_id, members, tasks):
        previous_ids = {
            row.agent_id: row.member_id
            for row in self.db.scalars(select(TeamMemberDefinition).where(TeamMemberDefinition.team_id == team_id)).all()
        }
        self.db.query(TeamTaskDefinition).filter_by(team_id=team_id).delete()
        self.db.query(TeamMemberDefinition).filter_by(team_id=team_id).delete()
        self.db.flush()
        member_map = {}
        for item in members:
            member_id = previous_ids.get(item.agent_id) or f"member_{uuid4().hex}"
            member_map[item.agent_id] = member_id
            self.db.add(TeamMemberDefinition(member_id=member_id, team_id=team_id, agent_id=item.agent_id, role=item.role, is_leader=item.is_leader))
        self.db.flush()
        for item in tasks:
            owner = member_map.get(item.owner_member_id, item.owner_member_id)
            task_id = getattr(item, "task_id", None) or f"task_{uuid4().hex}"
            depends_on = item.depends_on if hasattr(item, "depends_on") else json.loads(item.depends_on_json)
            self.db.add(TeamTaskDefinition(task_id=task_id, team_id=team_id, subject=item.subject, description=item.description, owner_member_id=owner, depends_on_json=json.dumps(depends_on), allow_failure=item.allow_failure))

    def _member_inputs(self, team_id):
        rows = self.db.scalars(
            select(TeamMemberDefinition).where(TeamMemberDefinition.team_id == team_id)
        ).all()
        return [
            TeamMemberInput(agent_id=row.agent_id, role=row.role, is_leader=row.is_leader)
            for row in rows
        ]

    def _task_inputs(self, team_id):
        members = {
            row.member_id: row.agent_id
            for row in self.db.scalars(
                select(TeamMemberDefinition).where(TeamMemberDefinition.team_id == team_id)
            ).all()
        }
        rows = self.db.scalars(
            select(TeamTaskDefinition).where(TeamTaskDefinition.team_id == team_id)
        ).all()
        return [
            TeamTaskInput(
                task_id=row.task_id,
                subject=row.subject,
                description=row.description,
                owner_member_id=members.get(row.owner_member_id, row.owner_member_id),
                depends_on=json.loads(row.depends_on_json),
                allow_failure=row.allow_failure,
            )
            for row in rows
        ]

    def _snapshot(self, team, members, tasks, selected):
        task_rows = [{
            "task_id": task.task_id, "subject": task.subject, "description": task.description,
            "owner_member_id": task.owner_member_id, "depends_on": json.loads(task.depends_on_json),
            "allow_failure": task.allow_failure, "state": "pending", "attempt": 0,
        } for task in tasks if selected is None or task.task_id in selected]
        return {
            "team_id": team.team_id,
            "members": [{"member_id": m.member_id, "agent_id": m.agent_id, "status": "pending", "session_id": None} for m in members],
            "tasks": task_rows,
            "last_error": None,
            "execution_mode": "durable_control_only",
        }

    def _append_event(self, run, event_type: str, payload: dict):
        events = json.loads(run.events_json or "[]")
        events.append({"event_id": f"evt_{uuid4().hex}", "sequence": len(events) + 1, "event_type": event_type, "team_id": run.team_id, "team_run_id": run.run_id, "occurred_at": _now().isoformat(), "payload": payload})
        run.events_json = json.dumps(events)

    def _team_result(self, team) -> TeamResult:
        members = self.db.scalars(select(TeamMemberDefinition).where(TeamMemberDefinition.team_id == team.team_id)).all()
        tasks = self.db.scalars(select(TeamTaskDefinition).where(TeamTaskDefinition.team_id == team.team_id)).all()
        return TeamResult(
            team_id=team.team_id,
            workspace_id=str(team.workspace_id),
            tenant_id=str(team.tenant_id),
            name=team.name,
            description=team.description,
            status=team.status,
            visibility="workspace_shared",
            version=team.version,
            created_by=str(team.created_by),
            created_at=_utc(team.created_at),
            updated_at=_utc(team.updated_at),
            members=tuple(
                TeamMemberResult(
                    member_id=member.member_id,
                    agent_id=member.agent_id,
                    role=member.role,
                    is_leader=member.is_leader,
                )
                for member in members
            ),
            tasks=tuple(
                TeamTaskResult(
                    task_id=task.task_id,
                    subject=task.subject,
                    description=task.description,
                    owner_member_id=task.owner_member_id,
                    depends_on=tuple(json.loads(task.depends_on_json)),
                    allow_failure=task.allow_failure,
                )
                for task in tasks
            ),
        )

    def _accepted(self, run) -> TeamRunAcceptedResult:
        return TeamRunAcceptedResult(
            team_id=run.team_id,
            team_run_id=run.run_id,
            team_version=run.team_version,
            run_version=run.run_version,
            status=run.status,
            accepted_at=_utc(run.created_at),
            execution_mode="durable_control_only",
        )

    def _run_result(self, run) -> TeamRunResult:
        snapshot = json.loads(run.snapshot_json)
        tasks = tuple(
            TeamRunTaskResult(
                task_id=task["task_id"],
                subject=task["subject"],
                description=task["description"],
                owner_member_id=task["owner_member_id"],
                depends_on=tuple(task["depends_on"]),
                allow_failure=task["allow_failure"],
                state=task["state"],
                attempt=task["attempt"],
            )
            for task in snapshot["tasks"]
        )
        counts = {state: sum(task.state == state for task in tasks) for state in {"pending", "running", "succeeded", "failed", "interrupted"}}
        total = len(tasks)
        progress = {"succeeded": counts["succeeded"], "running": counts["running"], "waiting": 0, "failed": counts["failed"], "pending": counts["pending"], "interrupted": counts["interrupted"], "percent": round(counts["succeeded"] * 100 / total) if total else 0}
        return TeamRunResult(
            team_run_id=run.run_id,
            team_id=run.team_id,
            workspace_id=str(run.workspace_id),
            team_version=run.team_version,
            run_version=run.run_version,
            status=run.status,
            progress=progress,
            members=tuple(TeamRunMemberResult(**member) for member in snapshot["members"]),
            tasks=tasks,
            capabilities=TeamRunCapabilitiesResult(
                can_pause=False,
                can_resume=False,
                can_interrupt=run.status in {"preparing", "running"},
                interrupt_confirmation_pending=run.status == "interrupt_requested",
                can_retry=False,
                can_execute=False,
            ),
            execution_mode=snapshot.get("execution_mode", "durable_control_only"),
            last_error=snapshot.get("last_error"),
            created_at=_utc(run.created_at),
            updated_at=_utc(run.updated_at),
        )

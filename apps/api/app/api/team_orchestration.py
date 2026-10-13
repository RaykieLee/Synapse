"""Workspace-scoped team orchestration endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.team_orchestration import (
    TeamCreate,
    TeamEventResponse,
    TeamInterrupt,
    TeamPageResponse,
    TeamPatch,
    TeamResponse,
    TeamRunAccepted,
    TeamRunResponse,
    TeamStart,
)
from app.services.results import ActorContext
from app.services.team_orchestration import TeamOrchestrationService
from app.tenancy.context import WorkspaceContext, get_workspace_context


router = APIRouter(prefix="/workspaces/{workspace_id}/teams", tags=["team orchestration"])


def service(request: Request, db: Session = Depends(get_db)) -> TeamOrchestrationService:
    return TeamOrchestrationService(
        db,
        getattr(request.app.state, "team_agent_authorization", None),
    )


def actor(user: User) -> ActorContext:
    return ActorContext(user_id=user.user_id, platform_role=user.platform_role)


def _workspace_args(context: WorkspaceContext) -> tuple[int, str]:
    return context.workspace_id, str(context.workspace_id)


@router.get("", response_model=TeamPageResponse)
def list_teams(
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    items = app_service.list_teams(workspace_id, header_workspace_id, actor(user))
    return TeamPageResponse(
        items=[TeamResponse.model_validate(asdict(item)) for item in items],
        total=len(items),
    )


@router.post("", status_code=201, response_model=TeamResponse)
def create_team(
    body: TeamCreate,
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    return TeamResponse.model_validate(
        asdict(app_service.create_team(workspace_id, body, header_workspace_id, actor(user)))
    )


@router.get("/{team_id}", response_model=TeamResponse)
def get_team(
    team_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    return TeamResponse.model_validate(
        asdict(app_service.get_team(workspace_id, team_id, header_workspace_id, actor(user)))
    )


@router.patch("/{team_id}", response_model=TeamResponse)
def update_team(
    team_id: str,
    body: TeamPatch,
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    return TeamResponse.model_validate(
        asdict(
            app_service.update_team(
                workspace_id, team_id, body, header_workspace_id, actor(user)
            )
        )
    )


@router.post("/{team_id}/runs", status_code=202, response_model=TeamRunAccepted)
def start_run(
    team_id: str,
    body: TeamStart,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    result = app_service.start_run(
        workspace_id, team_id, body, idempotency_key, header_workspace_id, actor(user)
    )
    response.headers["Location"] = (
        f"/api/v1/workspaces/{workspace_id}/teams/{team_id}/runs/{result.team_run_id}"
    )
    return TeamRunAccepted.model_validate(asdict(result))


@router.get("/{team_id}/runs/{run_id}", response_model=TeamRunResponse)
def get_run(
    team_id: str,
    run_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    return TeamRunResponse.model_validate(
        asdict(
            app_service.get_run(
                workspace_id, team_id, run_id, header_workspace_id, actor(user)
            )
        )
    )


@router.post("/{team_id}/runs/{run_id}/interrupt", response_model=TeamRunResponse)
def interrupt_run(
    team_id: str,
    run_id: str,
    body: TeamInterrupt,
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    return TeamRunResponse.model_validate(
        asdict(
            app_service.interrupt_run(
                workspace_id, team_id, run_id, body, header_workspace_id, actor(user)
            )
        )
    )


@router.get("/{team_id}/runs/{run_id}/events")
def run_events(
    team_id: str,
    run_id: str,
    stream: bool = Query(default=False),
    context: WorkspaceContext = Depends(get_workspace_context),
    user: User = Depends(get_current_user),
    app_service: TeamOrchestrationService = Depends(service),
):
    workspace_id, header_workspace_id = _workspace_args(context)
    events = app_service.events(
        workspace_id, team_id, run_id, header_workspace_id, actor(user)
    )
    if not stream:
        return {
            "items": [TeamEventResponse.model_validate(asdict(item)) for item in events],
            "total": len(events),
        }

    def event_stream():
        for item in events:
            event = TeamEventResponse.model_validate(asdict(item))
            yield (
                f"id: {event.event_id}\nevent: {event.event_type}"
                f"\ndata: {event.model_dump_json()}\n\n"
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")

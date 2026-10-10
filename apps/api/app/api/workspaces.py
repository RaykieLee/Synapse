from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.workspaces import (
    TransferOwnership,
    WorkspaceCreate,
    WorkspaceMemberRemovalResponse,
    WorkspaceMemberPageResponse,
    WorkspaceMemberPut,
    WorkspaceMembershipResponse,
    WorkspacePageResponse,
    WorkspacePatch,
    WorkspaceResponse,
    WorkspaceTransferResponse,
)
from app.services.results import ActorContext
from app.services.workspaces import WorkspaceService


router = APIRouter(tags=["workspaces"])


def get_workspace_service(db: Session = Depends(get_db)) -> WorkspaceService:
    return WorkspaceService(db)


def _actor(user: User) -> ActorContext:
    return ActorContext(user_id=user.user_id, platform_role=user.platform_role)


@router.get("/workspaces", response_model=WorkspacePageResponse)
def list_workspaces(
    tenant_id: str | None = Query(default=None, pattern=r"^[0-9]+$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    include_archived: bool = Query(default=False),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.list_workspaces(
        _actor(user),
        tenant_id=int(tenant_id) if tenant_id is not None else None,
        page=page,
        page_size=page_size,
        include_archived=include_archived,
    )


@router.post(
    "/tenants/{tenant_id}/workspaces",
    status_code=201,
    response_model=WorkspaceResponse,
)
def create_workspace(
    tenant_id: int,
    body: WorkspaceCreate,
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.create_workspace(tenant_id, body, _actor(user))


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def get_workspace(
    workspace_id: int,
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.get_workspace(workspace_id, x_workspace_id, _actor(user))


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def patch_workspace(
    workspace_id: int,
    body: WorkspacePatch,
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.update_workspace(workspace_id, body, x_workspace_id, _actor(user))


@router.get(
    "/workspaces/{workspace_id}/members",
    response_model=WorkspaceMemberPageResponse,
)
def list_workspace_members(
    workspace_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.list_members(
        workspace_id,
        x_workspace_id,
        _actor(user),
        page=page,
        page_size=page_size,
    )


@router.put(
    "/workspaces/{workspace_id}/members/{user_id}",
    response_model=WorkspaceMembershipResponse,
)
def put_workspace_member(
    workspace_id: int,
    user_id: int,
    body: WorkspaceMemberPut,
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.put_member(
        workspace_id,
        user_id,
        body,
        x_workspace_id,
        _actor(user),
    )


@router.delete(
    "/workspaces/{workspace_id}/members/{user_id}",
    response_model=WorkspaceMemberRemovalResponse,
)
def delete_workspace_member(
    workspace_id: int,
    user_id: int,
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.remove_member(workspace_id, user_id, x_workspace_id, _actor(user))


@router.post(
    "/workspaces/{workspace_id}/transfer-ownership",
    response_model=WorkspaceTransferResponse,
)
def transfer_ownership(
    workspace_id: int,
    body: TransferOwnership,
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
    user: User = Depends(get_current_user),
    service: WorkspaceService = Depends(get_workspace_service),
):
    return service.transfer_ownership(
        workspace_id,
        body,
        x_workspace_id,
        _actor(user),
    )

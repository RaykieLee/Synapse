"""HTTP routes for tenant invitation lifecycle."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.errors import problem
from app.auth.security import issue_token
from app.database.session import get_db
from app.models.user import User
from app.schemas.tenant_invitations import (
    CreatedInvitationResponse,
    InvitationAccept,
    InvitationAcceptResponse,
    InvitationCreate,
    InvitationPageResponse,
    InvitationRegister,
    InvitationRegisterResponse,
)
from app.services.errors import GoneError
from app.services.results import ActorContext
from app.services.tenant_invitations import (
    CreatedInvitationResult,
    TenantInvitationService,
)


router = APIRouter(tags=["tenant invitations"])


def get_invitation_service(db: Session = Depends(get_db)) -> TenantInvitationService:
    return TenantInvitationService(db)


def _actor(user: User) -> ActorContext:
    return ActorContext(user_id=user.user_id, platform_role=user.platform_role)


def _created_response(result: CreatedInvitationResult) -> CreatedInvitationResponse:
    return CreatedInvitationResponse(
        **vars(result.invitation),
        token=result.token,
        invite_link=f"/invite/accept?token={quote(result.token)}",
    )


@router.post(
    "/tenants/{tenant_id}/invitations",
    status_code=201,
    response_model=CreatedInvitationResponse,
)
def create_invitation(
    tenant_id: int,
    body: InvitationCreate,
    user: User = Depends(get_current_user),
    service: TenantInvitationService = Depends(get_invitation_service),
):
    return _created_response(service.create_invitation(tenant_id, body, _actor(user)))


@router.get(
    "/tenants/{tenant_id}/invitations",
    response_model=InvitationPageResponse,
)
def list_invitations(
    tenant_id: int,
    user: User = Depends(get_current_user),
    service: TenantInvitationService = Depends(get_invitation_service),
):
    return service.list_invitations(tenant_id, _actor(user))


@router.delete(
    "/tenants/{tenant_id}/invitations/{invitation_id}",
    status_code=204,
)
def revoke_invitation(
    tenant_id: int,
    invitation_id: int,
    user: User = Depends(get_current_user),
    service: TenantInvitationService = Depends(get_invitation_service),
):
    service.revoke_invitation(tenant_id, invitation_id, _actor(user))
    return None


@router.post(
    "/tenant-invitations/register-and-accept",
    status_code=201,
    response_model=InvitationRegisterResponse,
)
def register_and_accept_invitation(
    body: InvitationRegister,
    response: Response,
    request: Request,
    service: TenantInvitationService = Depends(get_invitation_service),
):
    try:
        result = service.register_and_accept(body)
    except GoneError as exc:
        # Returning rather than re-raising lets the request dependency commit the
        # terminal expired status while still producing the 410 problem response.
        return _problem_response(request, exc)

    access_token = issue_token(
        int(result.user.user_id),
        result.token_version,
    )
    response.set_cookie(
        "synapse_session",
        access_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=3600,
    )
    return InvitationRegisterResponse(
        access_token=access_token,
        token_type="bearer",
        user=result.user,
        tenant=result.membership,
    )


@router.post(
    "/tenant-invitations/accept",
    response_model=InvitationAcceptResponse,
)
def accept_invitation(
    body: InvitationAccept,
    request: Request,
    user: User = Depends(get_current_user),
    service: TenantInvitationService = Depends(get_invitation_service),
):
    try:
        return service.accept_invitation(body, user)
    except GoneError as exc:
        return _problem_response(request, exc)


def _problem_response(request: Request, exc: GoneError):
    return problem(
        410,
        exc.code,
        str(exc) or None,
        request_id=getattr(request.state, "request_id", None),
    )

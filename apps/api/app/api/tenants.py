from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, require_platform_admin
from app.database.session import get_db
from app.models.user import User
from app.schemas.tenants import (
    MemberCreate,
    MemberPageResponse,
    MemberPatch,
    MemberResponse,
    PlatformTenantPageResponse,
    TenantContextResponse,
    TenantCreatedResponse,
    TenantCreate,
    TenantPageResponse,
    TenantPatch,
    TenantResponse,
)
from app.services.tenants import ActorContext, TenantService


router = APIRouter(tags=["tenants"])


def get_tenant_service(db: Session = Depends(get_db)) -> TenantService:
    return TenantService(db)


def _actor(user: User) -> ActorContext:
    return ActorContext(user_id=user.user_id, platform_role=user.platform_role)


@router.post("/tenants", status_code=201, response_model=TenantCreatedResponse)
def create_tenant(
    body: TenantCreate,
    admin: User = Depends(require_platform_admin),
    service: TenantService = Depends(get_tenant_service),
):
    return service.create_tenant(body, _actor(admin))


@router.get("/me/context", response_model=TenantContextResponse)
def my_context(
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.get_context(_actor(user))


@router.get("/tenants", response_model=TenantPageResponse)
def list_tenants(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    name: str | None = Query(default=None, max_length=120),
    status: str | None = Query(default=None, pattern="^(active|suspended|archived)$"),
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.list_tenants(
        _actor(user),
        page=page,
        page_size=page_size,
        name=name,
        status=status,
    )


@router.get("/platform/tenants", response_model=PlatformTenantPageResponse)
def platform_list_tenants(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(default=None, pattern="^(active|suspended|archived)$"),
    name: str | None = Query(default=None, max_length=120),
    admin: User = Depends(require_platform_admin),
    service: TenantService = Depends(get_tenant_service),
):
    """List tenants for platform operations without creating tenant membership."""
    return service.list_platform_tenants(
        page=page,
        page_size=page_size,
        name=name,
        status=status,
    )


@router.get("/tenants/{tenant_id}", response_model=TenantResponse)
def get_tenant(
    tenant_id: int,
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.get_tenant(tenant_id, _actor(user))


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
def patch_tenant(
    tenant_id: int,
    body: TenantPatch,
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.update_tenant(tenant_id, body, _actor(user))


@router.get("/tenants/{tenant_id}/members", response_model=MemberPageResponse)
def list_members(
    tenant_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.list_members(
        tenant_id,
        _actor(user),
        page=page,
        page_size=page_size,
    )


@router.post("/tenants/{tenant_id}/members", status_code=201, response_model=MemberResponse)
def add_member(
    tenant_id: int,
    body: MemberCreate,
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.add_member(tenant_id, body, _actor(user))


@router.patch(
    "/tenants/{tenant_id}/members/{user_id}",
    response_model=MemberResponse,
)
def patch_member(
    tenant_id: int,
    user_id: int,
    body: MemberPatch,
    user: User = Depends(get_current_user),
    service: TenantService = Depends(get_tenant_service),
):
    return service.update_member(tenant_id, user_id, body, _actor(user))

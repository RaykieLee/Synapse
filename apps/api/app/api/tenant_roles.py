"""HTTP routes for tenant-scoped custom role definitions."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_roles import (
    RoleCreate,
    RolePatch,
    TenantRolePageResponse,
    TenantRoleResponse,
)
from app.services.tenant_roles import TenantRoleService
from app.tenancy.context import TenantContext, require_tenant_permission

router = APIRouter(prefix="/tenants/{tenant_id}/roles", tags=["tenant roles"])


def get_tenant_role_service(db: Session = Depends(get_db)) -> TenantRoleService:
    return TenantRoleService(db)


@router.get("", response_model=TenantRolePageResponse)
def list_roles(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^(active|disabled)$"),
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    service: TenantRoleService = Depends(get_tenant_role_service),
):
    return service.list_roles(
        context,
        page=page,
        page_size=page_size,
        search=search,
        status=status,
    )


@router.post("", status_code=201, response_model=TenantRoleResponse)
def create_role(
    body: RoleCreate,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    service: TenantRoleService = Depends(get_tenant_role_service),
):
    return service.create_role(body, context)


@router.get("/{role_id}", response_model=TenantRoleResponse)
def get_role(
    role_id: int,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    service: TenantRoleService = Depends(get_tenant_role_service),
):
    return service.get_role(role_id, context)


@router.patch("/{role_id}", response_model=TenantRoleResponse)
def patch_role(
    role_id: int,
    body: RolePatch,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    service: TenantRoleService = Depends(get_tenant_role_service),
):
    return service.update_role(role_id, body, context)


@router.delete("/{role_id}", status_code=204)
def delete_role(
    role_id: int,
    context: TenantContext = Depends(require_tenant_permission("tenant_member:manage")),
    service: TenantRoleService = Depends(get_tenant_role_service),
):
    service.delete_role(role_id, context)
    return Response(status_code=204)

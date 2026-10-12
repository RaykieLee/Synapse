"""HTTP routes for tenant custom-role menu grants."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_role_menus import (
    ReplaceRoleMenus,
    RoleMenusResponse,
)
from app.services.tenant_role_menus import TenantRoleMenuService
from app.tenancy.context import TenantContext, get_tenant_context

router = APIRouter(
    prefix="/tenants/{tenant_id}/roles/{role_id}/menus",
    tags=["tenant role menus"],
)


def get_tenant_role_menu_service(
    db: Session = Depends(get_db),
) -> TenantRoleMenuService:
    return TenantRoleMenuService(db)


@router.get("", response_model=RoleMenusResponse)
def get_role_menus(
    role_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantRoleMenuService = Depends(get_tenant_role_menu_service),
):
    return service.get_role_menus(role_id, context)


@router.put("", response_model=RoleMenusResponse)
def replace_role_menus(
    body: ReplaceRoleMenus,
    role_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantRoleMenuService = Depends(get_tenant_role_menu_service),
):
    return service.replace_role_menus(role_id, body, context)

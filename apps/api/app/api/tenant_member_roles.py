"""HTTP routes for tenant member custom-role assignments."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_member_roles import (
    MemberCustomRoleResponse,
    RoleAssignment,
)
from app.services.tenant_member_roles import TenantMemberRoleService
from app.tenancy.context import TenantContext, get_tenant_context

router = APIRouter(
    prefix="/tenants/{tenant_id}/members/{user_id}/custom-role",
    tags=["tenant member roles"],
)


def get_tenant_member_role_service(
    db: Session = Depends(get_db),
) -> TenantMemberRoleService:
    return TenantMemberRoleService(db)


@router.get("", response_model=MemberCustomRoleResponse)
def get_member_custom_role(
    user_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMemberRoleService = Depends(get_tenant_member_role_service),
):
    return service.get_assignment(user_id, context)


@router.put("", status_code=200, response_model=MemberCustomRoleResponse)
def assign_member_custom_role(
    body: RoleAssignment,
    user_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMemberRoleService = Depends(get_tenant_member_role_service),
):
    return service.assign_role(user_id, body, context)


@router.delete("", status_code=204)
def revoke_member_custom_role(
    user_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMemberRoleService = Depends(get_tenant_member_role_service),
):
    service.revoke_role(user_id, context)
    return Response(status_code=204)

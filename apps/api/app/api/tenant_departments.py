"""HTTP routes for tenant-owned department hierarchies."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_departments import (
    DepartmentCreate,
    DepartmentListResponse,
    DepartmentPatch,
    DepartmentReorder,
    DepartmentReorderResponse,
    DepartmentResponse,
    DepartmentTreeResponse,
)
from app.services.tenant_departments import TenantDepartmentService
from app.tenancy.context import TenantContext, get_tenant_context

router = APIRouter(
    prefix="/tenants/{tenant_id}/departments",
    tags=["tenant departments"],
)


def get_tenant_department_service(
    db: Session = Depends(get_db),
) -> TenantDepartmentService:
    return TenantDepartmentService(db)


@router.get("", response_model=DepartmentListResponse)
def list_departments(
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    return service.list_departments(context, search=search, status=status)


@router.get("/tree", response_model=DepartmentTreeResponse)
def get_department_tree(
    include_disabled: bool = Query(default=True),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    return service.get_department_tree(
        context,
        include_disabled=include_disabled,
    )


@router.get("/{department_id}", response_model=DepartmentResponse)
def get_department(
    department_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    return service.get_department(department_id, context)


@router.post("", status_code=201, response_model=DepartmentResponse)
def create_department(
    body: DepartmentCreate,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    return service.create_department(body, context)


@router.patch("/{department_id}", response_model=DepartmentResponse)
def patch_department(
    department_id: int,
    body: DepartmentPatch,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    return service.update_department(department_id, body, context)


@router.post("/reorder", response_model=DepartmentReorderResponse)
def reorder_departments(
    body: DepartmentReorder,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    return service.reorder_departments(body, context)


@router.delete("/{department_id}", status_code=204)
def delete_department(
    department_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDepartmentService = Depends(get_tenant_department_service),
):
    service.delete_department(department_id, context)
    return Response(status_code=204)

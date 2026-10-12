"""HTTP routes for tenant-owned menus and navigation trees."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_menus import (
    MenuCreate,
    MenuListResponse,
    MenuPatch,
    MenuReorder,
    MenuReorderResponse,
    MenuResponse,
    MenuTreeResponse,
    VisibleMenuTreeResponse,
)
from app.services.tenant_menus import TenantMenuService
from app.tenancy.context import TenantContext, get_tenant_context

router = APIRouter(prefix="/tenants/{tenant_id}/menus", tags=["tenant menus"])


def get_tenant_menu_service(
    db: Session = Depends(get_db),
) -> TenantMenuService:
    return TenantMenuService(db)


@router.get("", response_model=MenuListResponse)
def list_menus(
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    return service.list_menus(context, search=search, status=status)


@router.get("/tree", response_model=MenuTreeResponse)
def get_menu_tree(
    include_disabled: bool = Query(default=True),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    return service.get_menu_tree(context, include_disabled=include_disabled)


@router.get("/visible-tree", response_model=VisibleMenuTreeResponse)
def get_current_member_menu_tree(
    response: Response,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    response.headers["Cache-Control"] = "private, no-store"
    return service.get_visible_menu_tree(context)


@router.get("/{menu_id}", response_model=MenuResponse)
def get_menu(
    menu_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    return service.get_menu(menu_id, context)


@router.post("", status_code=201, response_model=MenuResponse)
def create_menu(
    body: MenuCreate,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    return service.create_menu(body, context)


@router.patch("/{menu_id}", response_model=MenuResponse)
def patch_menu(
    menu_id: int,
    body: MenuPatch,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    return service.update_menu(menu_id, body, context)


@router.post("/reorder", response_model=MenuReorderResponse)
def reorder_menus(
    body: MenuReorder,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    return service.reorder_menus(body, context)


@router.delete("/{menu_id}", status_code=204)
def delete_menu(
    menu_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantMenuService = Depends(get_tenant_menu_service),
):
    service.delete_menu(menu_id, context)
    return Response(status_code=204)

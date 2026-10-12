"""HTTP routes for tenant-owned parameter configurations."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_configs import (
    ConfigCreate,
    ConfigPageResponse,
    ConfigPatch,
    ConfigResponse,
    PublicConfigResponse,
)
from app.services.tenant_configs import TenantConfigService
from app.tenancy.context import TenantContext, get_tenant_context

router = APIRouter(prefix="/tenants/{tenant_id}/configs", tags=["tenant configs"])


def get_tenant_config_service(
    db: Session = Depends(get_db),
) -> TenantConfigService:
    return TenantConfigService(db)


@router.get("/public", response_model=PublicConfigResponse)
def list_public_configs(
    response: Response,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantConfigService = Depends(get_tenant_config_service),
):
    response.headers["Cache-Control"] = "private, no-store"
    result = service.list_public_configs(context)
    return PublicConfigResponse.model_validate(result)


@router.get("", response_model=ConfigPageResponse)
def list_configs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    config_name: str | None = Query(default=None, max_length=100),
    config_key: str | None = Query(default=None, max_length=100),
    group_name: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    is_sensitive: bool | None = Query(default=None),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantConfigService = Depends(get_tenant_config_service),
):
    result = service.list_configs(
        context,
        page=page,
        page_size=page_size,
        config_name=config_name,
        config_key=config_key,
        group_name=group_name,
        status=status,
        is_sensitive=is_sensitive,
    )
    return ConfigPageResponse(
        items=[ConfigResponse.model_validate(item) for item in result.items],
        total=result.total,
        page=result.page,
        page_size=result.page_size,
    )


@router.post("", status_code=201, response_model=ConfigResponse)
def create_config(
    body: ConfigCreate,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantConfigService = Depends(get_tenant_config_service),
):
    return ConfigResponse.model_validate(service.create_config(body, context))


@router.get("/{config_id}", response_model=ConfigResponse)
def get_config(
    config_id: int,
    response: Response,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantConfigService = Depends(get_tenant_config_service),
):
    response.headers["Cache-Control"] = "private, no-store"
    return ConfigResponse.model_validate(service.get_config(config_id, context))


@router.patch("/{config_id}", response_model=ConfigResponse)
def patch_config(
    config_id: int,
    body: ConfigPatch,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantConfigService = Depends(get_tenant_config_service),
):
    return ConfigResponse.model_validate(
        service.update_config(config_id, body, context)
    )


@router.delete("/{config_id}", status_code=204)
def delete_config(
    config_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantConfigService = Depends(get_tenant_config_service),
):
    service.delete_config(config_id, context)
    return Response(status_code=204)

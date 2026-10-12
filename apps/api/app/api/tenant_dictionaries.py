"""HTTP routes for tenant-owned dictionary types and values."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.tenant_dictionaries import (
    DictDataCreate,
    DictDataPageResponse,
    DictDataPatch,
    DictDataResponse,
    DictReorder,
    DictReorderResponse,
    DictTypeCreate,
    DictTypePageResponse,
    DictTypePatch,
    DictTypeReorder,
    DictTypeReorderResponse,
    DictTypeResponse,
)
from app.services.tenant_dictionaries import TenantDictionaryService
from app.tenancy.context import TenantContext, get_tenant_context

router = APIRouter(prefix="/tenants/{tenant_id}/dict", tags=["tenant dictionaries"])


def get_tenant_dictionary_service(
    db: Session = Depends(get_db),
) -> TenantDictionaryService:
    return TenantDictionaryService(db)


@router.get("/types", response_model=DictTypePageResponse)
def list_dict_types(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    dict_name: str | None = Query(default=None, max_length=100),
    dict_type: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.list_dict_types(
        context,
        page=page,
        page_size=page_size,
        dict_name=dict_name,
        dict_type=dict_type,
        status=status,
    )


@router.post("/types/reorder", response_model=DictTypeReorderResponse)
def reorder_dict_types(
    body: DictTypeReorder,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.reorder_dict_types(body, context)


@router.post("/types", status_code=201, response_model=DictTypeResponse)
def create_dict_type(
    body: DictTypeCreate,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.create_dict_type(body, context)


@router.get("/types/{dict_type_id}", response_model=DictTypeResponse)
def get_dict_type(
    dict_type_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.get_dict_type(dict_type_id, context)


@router.patch("/types/{dict_type_id}", response_model=DictTypeResponse)
def patch_dict_type(
    dict_type_id: int,
    body: DictTypePatch,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.update_dict_type(dict_type_id, body, context)


@router.delete("/types/{dict_type_id}", status_code=204)
def delete_dict_type(
    dict_type_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    service.delete_dict_type(dict_type_id, context)
    return Response(status_code=204)


@router.get("/types/{dict_type_id}/data", response_model=DictDataPageResponse)
def list_dict_data(
    dict_type_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    dict_label: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^[01]$"),
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.list_dict_data(
        dict_type_id,
        context,
        page=page,
        page_size=page_size,
        dict_label=dict_label,
        status=status,
    )


@router.post(
    "/types/{dict_type_id}/data",
    status_code=201,
    response_model=DictDataResponse,
)
def create_dict_data(
    dict_type_id: int,
    body: DictDataCreate,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.create_dict_data(dict_type_id, body, context)


@router.post(
    "/types/{dict_type_id}/data/reorder",
    response_model=DictReorderResponse,
)
def reorder_dict_data(
    dict_type_id: int,
    body: DictReorder,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.reorder_dict_data(dict_type_id, body, context)


@router.get(
    "/types/{dict_type_id}/data/{dict_data_id}",
    response_model=DictDataResponse,
)
def get_dict_data(
    dict_type_id: int,
    dict_data_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.get_dict_data(dict_type_id, dict_data_id, context)


@router.patch(
    "/types/{dict_type_id}/data/{dict_data_id}",
    response_model=DictDataResponse,
)
def patch_dict_data(
    dict_type_id: int,
    dict_data_id: int,
    body: DictDataPatch,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    return service.update_dict_data(
        dict_type_id,
        dict_data_id,
        body,
        context,
    )


@router.delete("/types/{dict_type_id}/data/{dict_data_id}", status_code=204)
def delete_dict_data(
    dict_type_id: int,
    dict_data_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: TenantDictionaryService = Depends(get_tenant_dictionary_service),
):
    service.delete_dict_data(dict_type_id, dict_data_id, context)
    return Response(status_code=204)

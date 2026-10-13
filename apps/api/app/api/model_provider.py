"""F32 provider, credential, and custom model routes."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.model_provider import (
    CredentialCreate,
    CredentialPatch,
    CredentialResponse,
    ModelBindingCreate,
    ModelBindingPatch,
    ModelBindingReferencesResponse,
    ModelBindingResponse,
    ProviderResponse,
)
from app.services.model_provider import ModelProviderService
from app.tenancy.context import WorkspaceContext, get_workspace_context

router = APIRouter(prefix="/workspaces/{workspace_id}/ai", tags=["model providers"])


def get_service(db: Session = Depends(get_db)) -> ModelProviderService:
    return ModelProviderService(db)


@router.get("/providers", response_model=list[ProviderResponse])
def list_providers(
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    # The registry is workspace-scoped even though its current entries are static.
    del context
    return [ProviderResponse.model_validate(item) for item in service.list_providers()]


@router.get("/credentials", response_model=list[CredentialResponse])
def list_credentials(
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    return [CredentialResponse.model_validate(item) for item in service.list_credentials(context)]


@router.post("/credentials", status_code=status.HTTP_201_CREATED, response_model=CredentialResponse)
def create_credential(
    body: CredentialCreate,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    return CredentialResponse.model_validate(service.create_credential(body, context))


@router.patch("/credentials/{credential_id}", response_model=CredentialResponse)
def update_credential(
    credential_id: str,
    body: CredentialPatch,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    return CredentialResponse.model_validate(service.update_credential(credential_id, body, context))


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_credential(
    credential_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    service.delete_credential(credential_id, context)


@router.get("/models", response_model=list[ModelBindingResponse])
def list_models(
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    result = service.list_models(context)
    return [ModelBindingResponse.model_validate(item) for item in result.items]


@router.post("/models", status_code=status.HTTP_201_CREATED, response_model=ModelBindingResponse)
def create_model(
    body: ModelBindingCreate,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    return ModelBindingResponse.model_validate(service.create_model(body, context))


@router.patch("/models/{model_binding_id}", response_model=ModelBindingResponse)
def update_model(
    model_binding_id: str,
    body: ModelBindingPatch,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    return ModelBindingResponse.model_validate(service.update_model(model_binding_id, body, context))


@router.get(
    "/models/{model_binding_id}/references",
    response_model=ModelBindingReferencesResponse,
)
def list_model_references(
    model_binding_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    result = service.list_model_references(model_binding_id, context)
    return ModelBindingReferencesResponse(
        model_binding_id=result.model_binding_id,
        references=list(result.references),
    )


@router.delete("/models/{model_binding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(
    model_binding_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    service: ModelProviderService = Depends(get_service),
):
    service.delete_model(model_binding_id, context)

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "synapse-api"


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


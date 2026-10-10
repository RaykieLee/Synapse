"""HTTP routes for platform administration of global users."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import require_platform_admin
from app.database.session import get_db
from app.models.user import User
from app.schemas.users import (
    PasswordReset,
    UserCreate,
    UserPageResponse,
    UserPatch,
    UserResponse,
)
from app.services.users import UserService


router = APIRouter(prefix="/users", tags=["users"])


def get_user_service(db: Session = Depends(get_db)) -> UserService:
    return UserService(db)


@router.get("", response_model=UserPageResponse)
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=254),
    _admin: User = Depends(require_platform_admin),
    service: UserService = Depends(get_user_service),
):
    return service.list_users(page=page, page_size=page_size, search=search)


@router.post("", status_code=201, response_model=UserResponse)
def create_user(
    body: UserCreate,
    _admin: User = Depends(require_platform_admin),
    service: UserService = Depends(get_user_service),
):
    return service.create_user(body)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    _admin: User = Depends(require_platform_admin),
    service: UserService = Depends(get_user_service),
):
    return service.get_user(user_id)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    body: UserPatch,
    _admin: User = Depends(require_platform_admin),
    service: UserService = Depends(get_user_service),
):
    return service.update_user(user_id, body)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    _admin: User = Depends(require_platform_admin),
    service: UserService = Depends(get_user_service),
):
    service.delete_user(user_id)
    return None


@router.post("/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: int,
    body: PasswordReset,
    _admin: User = Depends(require_platform_admin),
    service: UserService = Depends(get_user_service),
):
    service.reset_password(user_id, body)
    return None

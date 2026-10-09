"""Platform administration of global user accounts."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import require_platform_admin
from app.auth.security import password_hash
from app.database.session import get_db
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=256)
    nick_name: str = Field(default="", max_length=100)
    email: EmailStr | None = None
    phonenumber: str | None = Field(default=None, max_length=32)
    sex: str | None = Field(default=None, pattern="^[012]$")
    avatar: str | None = None

    @field_validator("user_name")
    @classmethod
    def username_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Username cannot be blank")
        return value


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nick_name: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    phonenumber: str | None = Field(default=None, max_length=32)
    sex: str | None = Field(default=None, pattern="^[012]$")
    avatar: str | None = None
    status: str | None = Field(default=None, pattern="^(active|disabled)$")


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_password: str = Field(min_length=12, max_length=256)


def _problem(status_code: int, code: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code})


def _user_data(user: User) -> dict:
    """Safe public account representation; never serialize the ORM model."""
    def iso_utc(value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat()

    return {
        "user_id": str(user.user_id),
        "user_name": user.user_name,
        "nick_name": user.nick_name,
        "email": user.email,
        "phonenumber": user.phonenumber,
        "sex": user.sex,
        "avatar": user.avatar,
        "status": user.status,
        "platform_role": user.platform_role,
        "created_at": iso_utc(user.created_at),
        "updated_at": iso_utc(user.updated_at),
    }


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None or user.del_flag:
        _problem(404, "RESOURCE_NOT_FOUND")
    return user


def _normalized_email(value: str | None) -> str | None:
    return value.strip().lower() if value else None


def _ensure_email_available(db: Session, email: str | None, excluding_user_id: int | None = None) -> None:
    if not email:
        return
    query = select(User.user_id).where(
        func.lower(User.email) == email.lower(), User.del_flag.is_(False),
    )
    if excluding_user_id is not None:
        query = query.where(User.user_id != excluding_user_id)
    if db.scalar(query) is not None:
        _problem(409, "USER_CONFLICT")


@router.get("")
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=254),
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    query = select(User).where(User.del_flag.is_(False))
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(or_(
            User.user_name.ilike(term), User.nick_name.ilike(term),
            User.email.ilike(term), User.phonenumber.ilike(term),
        ))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = db.scalars(query.order_by(User.user_id).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_user_data(user) for user in users], "total": total,
            "page": page, "page_size": page_size}


@router.post("", status_code=201)
def create_user(
    body: UserCreate,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    email = _normalized_email(str(body.email) if body.email else None)
    _ensure_email_available(db, email)
    user = User(
        user_name=body.user_name,
        nick_name=body.nick_name,
        email=email,
        phonenumber=body.phonenumber,
        sex=body.sex,
        avatar=body.avatar,
        password_hash=password_hash(body.password),
        status="active",
        del_flag=False,
        platform_role="user",
        token_version=0,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "USER_CONFLICT"}) from exc
    db.refresh(user)
    return _user_data(user)


@router.get("/{user_id}")
def get_user(
    user_id: int,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    return _user_data(_get_user(db, user_id))


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    body: UserPatch,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    user = _get_user(db, user_id)
    values = body.model_dump(exclude_unset=True)
    if not values:
        _problem(422, "VALIDATION_ERROR")
    if "email" in values:
        values["email"] = _normalized_email(str(values["email"]) if values["email"] else None)
        _ensure_email_available(db, values["email"], excluding_user_id=user_id)
    status_changed = "status" in values and values["status"] != user.status
    for field, value in values.items():
        setattr(user, field, value)
    if status_changed:
        user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "USER_CONFLICT"}) from exc
    db.refresh(user)
    return _user_data(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    user = _get_user(db, user_id)
    user.del_flag = True
    user.status = "disabled"
    user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


@router.post("/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: int,
    body: PasswordReset,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    user = _get_user(db, user_id)
    user.password_hash = password_hash(body.new_password)
    user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)

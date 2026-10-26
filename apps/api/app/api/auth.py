from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.security import issue_token, password_hash, verify_password
from app.core.config import get_settings
from app.database.session import get_db
from app.models.user import User

router = APIRouter(tags=["auth"])
SESSION_COOKIE = "synapse_session"


class LoginInput(BaseModel):
    user_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nick_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=254)
    phonenumber: str | None = Field(default=None, max_length=32)
    sex: str | None = Field(default=None, pattern="^[012]$")
    avatar: str | None = None


class PasswordInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


def user_data(user: User) -> dict:
    return {"user_id": str(user.user_id), "user_name": user.user_name, "nick_name": user.nick_name,
            "email": user.email, "phonenumber": user.phonenumber, "sex": user.sex, "avatar": user.avatar,
            "status": user.status, "platform_role": user.platform_role}


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    """Set a browser session without exposing the bearer token to page scripts."""
    settings = get_settings()
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
    if settings.auth_cookie_secure is not None:
        secure = settings.auth_cookie_secure
    else:
        secure = request.url.scheme == "https" or forwarded_proto == "https"
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=settings.jwt_ttl_minutes * 60,
        path="/",
    )


@router.post("/auth/login")
def login(body: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.user_name == body.user_name, User.del_flag.is_(False)))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail={"code": "INVALID_CREDENTIALS"})
    if user.status != "active":
        raise HTTPException(403, detail={"code": "ACCOUNT_INACTIVE"})
    if user.password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        user.password_hash = password_hash(body.password)
        db.commit()
    token = issue_token(user.user_id, user.token_version)
    set_session_cookie(response, request, token)
    return {"user": user_data(user)}


@router.post("/auth/logout", status_code=204)
def logout(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.status_code = 204
    return response


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return user_data(user)


@router.patch("/account/profile")
def update_profile(body: ProfileInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user_data(user)


@router.post("/account/password", status_code=204)
def change_password(body: PasswordInput, response: Response, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, detail={"code": "CURRENT_PASSWORD_INVALID"})
    user.password_hash = password_hash(body.new_password)
    user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.status_code = 204
    return response

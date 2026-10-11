"""Application service for global user account administration."""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.security import password_hash
from app.models.user import User
from app.schemas.users import PasswordReset, UserCreate, UserPatch
from app.services.errors import ConflictError, DomainValidationError, NotFoundError
from app.services.results import PageResult


class UserConflict(ConflictError):
    code = "USER_CONFLICT"


class EmptyUserPatch(DomainValidationError):
    code = "VALIDATION_ERROR"


@dataclass(frozen=True)
class UserResult:
    user_id: str
    user_name: str
    nick_name: str | None
    email: str | None
    phonenumber: str | None
    sex: str | None
    avatar: str | None
    status: str
    platform_role: str | None
    created_at: datetime | None
    updated_at: datetime | None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _normalized_email(value: str | None) -> str | None:
    return value.strip().lower() if value else None


class UserService:
    """Business use cases for platform-level account administration."""

    def __init__(self, db: Session):
        self.db = db

    def list_users(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None,
    ) -> PageResult[UserResult]:
        query = select(User).where(User.del_flag.is_(False))
        if search and search.strip():
            escaped = (
                search.strip()
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            term = f"%{escaped}%"
            query = query.where(
                or_(
                    User.user_name.ilike(term, escape="\\"),
                    User.nick_name.ilike(term, escape="\\"),
                    User.email.ilike(term, escape="\\"),
                    User.phonenumber.ilike(term, escape="\\"),
                )
            )
        total = self.db.scalar(select(func.count()).select_from(query.subquery())) or 0
        users = self.db.scalars(
            query.order_by(User.user_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return PageResult(
            items=tuple(self._user_result(user) for user in users),
            total=total,
            page=page,
            page_size=page_size,
        )

    def create_user(self, body: UserCreate) -> UserResult:
        email = _normalized_email(str(body.email) if body.email else None)
        self._ensure_email_available(email)
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
        self.db.add(user)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise UserConflict("User name or email is already used") from exc
        self.db.refresh(user)
        return self._user_result(user)

    def get_user(self, user_id: int) -> UserResult:
        return self._user_result(self._active_user(user_id))

    def update_user(self, user_id: int, body: UserPatch) -> UserResult:
        user = self._active_user(user_id)
        values = body.model_dump(exclude_unset=True)
        if not values:
            raise EmptyUserPatch("At least one profile field is required")
        if "email" in values:
            values["email"] = _normalized_email(
                str(values["email"]) if values["email"] else None
            )
            self._ensure_email_available(values["email"], excluding_user_id=user_id)

        status_changed = "status" in values and values["status"] != user.status
        for field, value in values.items():
            setattr(user, field, value)
        if status_changed:
            user.token_version += 1
        user.updated_at = _now()
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise UserConflict("User name or email is already used") from exc
        self.db.refresh(user)
        return self._user_result(user)

    def delete_user(self, user_id: int) -> None:
        user = self._active_user(user_id)
        user.del_flag = True
        user.status = "disabled"
        user.token_version += 1
        user.updated_at = _now()
        self.db.flush()

    def reset_password(self, user_id: int, body: PasswordReset) -> None:
        user = self._active_user(user_id)
        user.password_hash = password_hash(body.new_password)
        user.token_version += 1
        user.updated_at = _now()
        self.db.flush()

    def _active_user(self, user_id: int) -> User:
        user = self.db.get(User, user_id)
        if user is None or user.del_flag:
            raise NotFoundError("User not found")
        return user

    def _ensure_email_available(
        self,
        email: str | None,
        *,
        excluding_user_id: int | None = None,
    ) -> None:
        if not email:
            return
        query = select(User.user_id).where(
            func.lower(User.email) == email.lower(),
            User.del_flag.is_(False),
        )
        if excluding_user_id is not None:
            query = query.where(User.user_id != excluding_user_id)
        if self.db.scalar(query) is not None:
            raise UserConflict("Email is already used")

    def _user_result(self, user: User) -> UserResult:
        return UserResult(
            user_id=str(user.user_id),
            user_name=user.user_name,
            nick_name=user.nick_name,
            email=user.email,
            phonenumber=user.phonenumber,
            sex=user.sex,
            avatar=user.avatar,
            status=user.status,
            platform_role=user.platform_role,
            created_at=_aware(user.created_at),
            updated_at=_aware(user.updated_at),
        )

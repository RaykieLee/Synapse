"""HTTP request and response contracts for global user administration."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class UserPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[UserResponse]
    total: int
    page: int
    page_size: int

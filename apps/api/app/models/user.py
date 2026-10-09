from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    nick_name: Mapped[str] = mapped_column(String(100), default="")
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True)
    phonenumber: Mapped[str | None] = mapped_column(String(32))
    sex: Mapped[str | None] = mapped_column(String(1))
    avatar: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    del_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    platform_role: Mapped[str] = mapped_column(String(32), default="user")
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

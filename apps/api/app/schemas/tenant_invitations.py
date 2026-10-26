"""HTTP request and response contracts for tenant invitations."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class InvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str | None = Field(default=None, max_length=254)
    user_id: str | None = Field(default=None, pattern=r"^[0-9]+$")
    tenant_role: str = Field(default="member", pattern="^(admin|member)$")
    expires_in_hours: int = Field(default=168, ge=1, le=720)

    @model_validator(mode="after")
    def exactly_one_target(self):
        if (self.email is None) == (self.user_id is None):
            raise ValueError("Provide exactly one of email or user_id")
        if self.email is not None:
            self.email = self.email.strip().lower()
            if not self.email or "@" not in self.email or len(self.email) > 254:
                raise ValueError("A valid email address is required")
        return self


class InvitationAccept(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=32, max_length=256)


class InvitationRegister(BaseModel):
    """Create an account only through an unbound email invitation."""

    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=32, max_length=256)
    user_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=256)
    nick_name: str = Field(default="", max_length=100)

    @field_validator("user_name")
    @classmethod
    def username_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Username cannot be blank")
        return value


class InvitationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    invitation_id: str
    tenant_id: str
    email: str | None
    target_user_id: str | None
    tenant_role: str
    status: str
    expired: bool
    expires_at: datetime
    invited_by: str
    created_at: datetime


class CreatedInvitationResponse(InvitationResponse):
    token: str
    invite_link: str


class InvitationPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[InvitationResponse]


class RegisteredUserResponse(BaseModel):
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


class RegisteredTenantMembershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tenant_id: str
    user_id: str
    status: str
    tenant_role: str
    joined_at: datetime
    workspace_memberships_created: int


class InvitationRegisterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: RegisteredUserResponse
    tenant: RegisteredTenantMembershipResponse


class InvitationAcceptResponse(RegisteredTenantMembershipResponse):
    pass

"""HTTP contracts for tenant member custom-role assignments."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class RoleAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_id: str = Field(pattern=r"^[1-9][0-9]*$")


class CustomRoleAssignmentRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role_id: str
    tenant_id: str
    role_name: str
    role_key: str
    status: str
    permissions: list[str]


class AssignedMemberCustomRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    role: CustomRoleAssignmentRoleResponse
    assigned_by: str
    assigned_at: datetime


class UnassignedMemberCustomRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    role: None


MemberCustomRoleResponse = Annotated[
    AssignedMemberCustomRoleResponse | UnassignedMemberCustomRoleResponse,
    Field(union_mode="left_to_right"),
]

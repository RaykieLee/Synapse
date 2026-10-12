"""HTTP contracts for tenant custom-role menu grants."""

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


_MENU_ID = re.compile(r"^[1-9][0-9]*$")


class ReplaceRoleMenus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    menu_ids: list[str] = Field(max_length=500)

    @field_validator("menu_ids")
    @classmethod
    def menu_ids_are_positive_unique_ids(cls, values: list[str]) -> list[str]:
        if any(not _MENU_ID.fullmatch(value) for value in values):
            raise ValueError("Menu IDs must be positive decimal strings")
        if len(values) != len(set(values)):
            raise ValueError("Menu IDs must be unique")
        return values


class RoleMenusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tenant_id: str
    role_id: str
    menu_ids: list[str]

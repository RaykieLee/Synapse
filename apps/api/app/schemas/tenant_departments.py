"""HTTP contracts for tenant-owned department hierarchies."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DepartmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dept_name: str = Field(min_length=1, max_length=30)
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(default=0, ge=0)
    leader: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=11)
    email: str | None = Field(default=None, max_length=50)
    status: str = Field(default="0", pattern="^[01]$")

    @field_validator("dept_name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Department name cannot be blank")
        return value


class DepartmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dept_name: str | None = Field(default=None, min_length=1, max_length=30)
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int | None = Field(default=None, ge=0)
    leader: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=11)
    email: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, pattern="^[01]$")

    @field_validator("dept_name")
    @classmethod
    def non_blank_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Department name cannot be blank")
        return value


class DepartmentOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    department_id: str = Field(pattern=r"^[1-9][0-9]*$")
    parent_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]*$")
    order_num: int = Field(ge=0)


class DepartmentReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DepartmentOrder] = Field(min_length=1, max_length=500)


class DepartmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    department_id: str
    tenant_id: str
    parent_id: str | None
    ancestors: str
    dept_name: str
    order_num: int
    leader: str | None
    phone: str | None
    email: str | None
    status: str
    created_by: str
    updated_by: str
    created_at: datetime | None
    updated_at: datetime | None


class DepartmentTreeNodeResponse(DepartmentResponse):
    children: list[DepartmentTreeNodeResponse]


class DepartmentListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[DepartmentResponse]
    total: int


class DepartmentTreeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[DepartmentTreeNodeResponse]


class DepartmentReorderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    updated: int

"""HTTP contracts for durable team orchestration."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TeamMemberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=1, max_length=128)
    role: str = Field(default="", max_length=120)
    is_leader: bool = False


class TeamTaskInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str | None = Field(default=None, min_length=1, max_length=64)
    subject: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    owner_member_id: str = Field(min_length=1, max_length=128)
    depends_on: list[str] = Field(default_factory=list, max_length=50)
    allow_failure: bool = False


class TeamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=4000)
    members: list[TeamMemberInput] = Field(min_length=1, max_length=20)
    tasks: list[TeamTaskInput] = Field(default_factory=list, max_length=100)


class TeamPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=4000)
    members: list[TeamMemberInput] | None = Field(default=None, max_length=20)
    tasks: list[TeamTaskInput] | None = Field(default=None, max_length=100)
    expected_version: int | None = Field(default=None, ge=1)


class TeamStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    team_version: int = Field(ge=1)
    task_ids: list[str] | None = Field(default=None, min_length=1, max_length=100)


class TeamInterrupt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_run_version: int | None = Field(default=None, ge=1)
    reason: str = Field(default="user_requested", max_length=500)


class TeamMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    member_id: str
    agent_id: str
    role: str
    is_leader: bool


class TeamTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: str
    subject: str
    description: str
    owner_member_id: str
    depends_on: list[str]
    allow_failure: bool
    state: str = "draft"
    attempt: int = 0


class TeamResponse(BaseModel):
    team_id: str
    workspace_id: str
    tenant_id: str
    name: str
    description: str
    status: str
    visibility: str
    version: int
    created_by: str
    created_at: datetime
    updated_at: datetime
    members: list[TeamMemberResponse]
    tasks: list[TeamTaskResponse]


class TeamPageResponse(BaseModel):
    items: list[TeamResponse]
    total: int


class TeamRunResponse(BaseModel):
    team_run_id: str
    team_id: str
    workspace_id: str
    team_version: int
    run_version: int
    status: str
    progress: dict
    members: list["TeamRunMemberResponse"]
    tasks: list["TeamRunTaskResponse"]
    capabilities: "TeamRunCapabilitiesResponse"
    execution_mode: str
    last_error: dict | None = None
    created_at: datetime
    updated_at: datetime


class TeamRunAccepted(BaseModel):
    team_id: str
    team_run_id: str
    team_version: int
    run_version: int
    status: str
    accepted_at: datetime
    execution_mode: str


class TeamRunMemberResponse(BaseModel):
    member_id: str
    agent_id: str
    status: str
    session_id: str | None


class TeamRunTaskResponse(BaseModel):
    task_id: str
    subject: str
    description: str
    owner_member_id: str
    depends_on: list[str]
    allow_failure: bool
    state: str
    attempt: int


class TeamRunCapabilitiesResponse(BaseModel):
    can_pause: bool
    can_resume: bool
    can_interrupt: bool
    interrupt_confirmation_pending: bool
    can_retry: bool
    can_execute: bool


class TeamEventResponse(BaseModel):
    event_id: str
    sequence: int
    event_type: str
    team_id: str
    team_run_id: str
    occurred_at: datetime
    payload: dict

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base for SQLAlchemy 2 models migrated into Synapse."""


# Import every mapped model so Alembic's metadata includes tenant business tables.
from app.models.tenant_dictionary import TenantDictData, TenantDictType  # noqa: E402,F401
from app.models.attachment import Attachment  # noqa: E402,F401
from app.models.tenant_scheduled_task import TenantScheduledTask  # noqa: E402,F401
from app.models.tenant_resource_summary import TenantResourceSummary  # noqa: E402,F401
from app.models.tenant_task_schedule_state import TenantTaskScheduleState  # noqa: E402,F401
from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun  # noqa: E402,F401

from app.models.user import User  # noqa: E402,F401
from app.models.tenant import Tenant, TenantInvitation, TenantMember, Workspace, WorkspaceMember  # noqa: E402,F401

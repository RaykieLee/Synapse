"""Allowlisted tenant invitation maintenance handler for the future scheduler."""
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, TenantInvitation

TASK_TARGET = "tenant.expire_pending_invitations"


def expire_pending_invitations(
    db: Session,
    tenant_id: int,
    *,
    now: datetime | None = None,
) -> int:
    """Expire pending invitations already past their deadline for one tenant.

    `tenant_id` is trusted internal input from the persisted allowlisted task
    invocation. It must never be copied directly from a public request body.
    The single conditional UPDATE is tenant-scoped and safe to run repeatedly
    or concurrently; accepted/revoked/previously expired invitations are not
    changed. Returns the number of rows transitioned by this invocation.
    """
    if type(tenant_id) is not int or tenant_id < 1:
        raise ValueError("tenant_id must be a positive integer")
    if db.scalar(select(Tenant.tenant_id).where(Tenant.tenant_id == tenant_id)) is None:
        raise LookupError("scheduled task tenant does not exist")

    cutoff = now or datetime.now(timezone.utc)
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    else:
        cutoff = cutoff.astimezone(timezone.utc)

    statement = update(TenantInvitation).where(
        TenantInvitation.tenant_id == tenant_id,
        TenantInvitation.status == "pending",
        TenantInvitation.expires_at <= cutoff,
    ).values(status="expired").execution_options(synchronize_session=False)
    result = db.execute(statement)
    changed = max(result.rowcount or 0, 0)
    db.commit()
    return changed

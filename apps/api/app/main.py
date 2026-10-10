from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
import asyncio

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.auth import router as auth_router
from app.api.tenants import router as tenants_router
from app.api.workspaces import router as workspaces_router
from app.api.tenant_invitations import router as tenant_invitations_router
from app.api.users import router as users_router
from app.api.tenant_roles import router as tenant_roles_router
from app.api.tenant_member_roles import router as tenant_member_roles_router
from app.api.tenant_menus import router as tenant_menus_router
from app.api.tenant_role_menus import router as tenant_role_menus_router
from app.api.tenant_dictionaries import router as tenant_dictionaries_router
from app.api.tenant_departments import router as tenant_departments_router
from app.api.tenant_configs import router as tenant_configs_router
from app.api.attachments import router as attachments_router
from app.api.tenant_scheduled_tasks import router as tenant_scheduled_tasks_router
from app.auth.errors import install_error_handlers
from app.core.config import get_settings
from app.integrations.agentscope import create_agentscope_app
from app.tasks.scheduler_runtime import make_worker_id, run_scheduler_loop


@asynccontextmanager
async def _empty_lifespan() -> AsyncIterator[None]:
    yield


def create_app() -> FastAPI:
    """Build a fresh API application using the current service settings."""
    settings = get_settings()
    # Non-AI tests can exercise the platform without constructing AgentScope's
    # Redis clients or entering its async lifespan.
    agentscope_app = create_agentscope_app(settings) if settings.agentscope_enabled else FastAPI(
        title="Synapse AI (disabled)"
    )

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        # Starlette does not start mounted ASGI apps' lifespan automatically.
        # Enter it once under the unified Synapse process and unwind it on shutdown.
        child_lifespan = (
            agentscope_app.router.lifespan_context(agentscope_app)
            if settings.agentscope_enabled
            else _empty_lifespan()
        )
        async with child_lifespan:
            scheduler_task = None
            stop_scheduler = None
            if settings.scheduled_tasks_enabled:
                stop_scheduler = asyncio.Event()
                scheduler_task = asyncio.create_task(
                    run_scheduler_loop(
                        stop_scheduler,
                        worker_id=make_worker_id(settings.scheduled_task_worker_id),
                        poll_interval_seconds=settings.scheduled_task_poll_interval_seconds,
                        lease_seconds=settings.scheduled_task_lease_seconds,
                    ),
                    name="synapse-scheduled-task-poller",
                )
            try:
                yield
            finally:
                if scheduler_task is not None and stop_scheduler is not None:
                    # Wake an idle timer immediately. An active handler is
                    # allowed to settle its lease/completion before shutdown.
                    stop_scheduler.set()
                    await scheduler_task

    application = FastAPI(
        title="Synapse API",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )
    application.include_router(health_router, prefix=settings.api_prefix)
    application.include_router(auth_router, prefix=settings.api_prefix)
    application.include_router(tenants_router, prefix=settings.api_prefix)
    application.include_router(workspaces_router, prefix=settings.api_prefix)
    application.include_router(tenant_invitations_router, prefix=settings.api_prefix)
    application.include_router(users_router, prefix=settings.api_prefix)
    application.include_router(tenant_roles_router, prefix=settings.api_prefix)
    application.include_router(tenant_member_roles_router, prefix=settings.api_prefix)
    application.include_router(tenant_menus_router, prefix=settings.api_prefix)
    application.include_router(tenant_role_menus_router, prefix=settings.api_prefix)
    application.include_router(tenant_dictionaries_router, prefix=settings.api_prefix)
    application.include_router(tenant_departments_router, prefix=settings.api_prefix)
    application.include_router(tenant_configs_router, prefix=settings.api_prefix)
    application.include_router(attachments_router, prefix=settings.api_prefix)
    application.include_router(tenant_scheduled_tasks_router, prefix=settings.api_prefix)
    application.mount(f"{settings.api_prefix}/ai", agentscope_app, name="agentscope")
    install_error_handlers(application)
    return application

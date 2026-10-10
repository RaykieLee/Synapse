"""Pytest environment gates for the API verification suite."""

from pathlib import Path

import pytest


EXTERNAL_MARKERS = {
    "test_f18b3_attachment_reconcile.py": ("windows_symlink",),
    "test_f18b2c_scheduler_runtime.py": ("redis", "integration"),
    "test_f18c_scheduled_task_frontend.py": ("browser", "integration"),
    "test_f19a_scheduled_task_runs.py": ("redis",),
    "test_f19b_task_runs_frontend.py": ("browser", "integration"),
    "test_f20b_agentscope_embed.py": ("redis",),
    "test_f21a_agentscope_gateway.py": ("redis",),
    "test_f21b1_agentscope_session_isolation.py": ("redis",),
    "test_f21b2a_workdir_isolation.py": ("windows_symlink",),
    "test_f21b2a_workspace_gateway_e2e.py": (
        "redis",
        "windows_symlink",
        "integration",
    ),
    "test_f21b2b1_agent_resource_isolation.py": ("redis",),
    "test_f21b2b2_kb_metadata_isolation.py": ("redis",),
    "test_f21b2b3_mcp_isolation.py": ("redis",),
    "test_f21b2b4_skills_isolation.py": ("redis", "windows_symlink"),
    "test_f21b2b5_model_credential_isolation.py": ("redis",),
    "test_f21c_sse_auth_context.py": ("redis", "integration"),
    "test_f23a1_agent_detail.py": ("redis",),
}


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Attach environment markers before autouse fixtures select the app shape."""
    for item in items:
        markers = EXTERNAL_MARKERS.get(Path(item.path).name, ())
        for marker in markers:
            item.add_marker(getattr(pytest.mark, marker))


@pytest.fixture(autouse=True)
def _disable_external_lifespans(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    """Keep ordinary SQLite/API tests from opening Redis or scheduler workers."""
    marker_names = {marker.name for marker in request.node.iter_markers()}
    if marker_names & {"redis", "browser"}:
        return
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

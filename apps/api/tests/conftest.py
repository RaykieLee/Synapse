"""Pytest environment gates for the API verification suite."""

import pytest

@pytest.fixture(autouse=True)
def _disable_external_lifespans(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    """Keep ordinary SQLite/API tests from opening Redis or scheduler workers."""
    marker_names = {marker.name for marker in request.node.iter_markers()}
    if marker_names & {"redis", "browser"}:
        return
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

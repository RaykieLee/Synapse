# F32 Control-Plane Independent HTTP Acceptance

Execution date: 2026-10-13

Scope: read-only acceptance of the current worktree at baseline `77da0fa`, covering the F32 model-provider API/service/schema/tests and Workspace models page. No product files were edited. The only file added is this report. Existing uncommitted changes were preserved.

Fixture label: `AgentScope/provider HTTP fixture`

## Verdict

**F32 Phase 1 control-plane HTTP acceptance is blocked.**

The isolated FastAPI/SQLite scenarios did prove the security boundary and reference-conflict paths that can complete without serializing a service result. However, the normal authenticated provider, credential, and model success paths return `500 INTERNAL_ERROR` before a usable HTTP response is produced. The focused service tests pass, so this is an HTTP adapter defect not covered by the current unit-level acceptance test.

## Evidence

Environment:

- Disposable in-memory SQLite using `StaticPool`; no shared database or Redis.
- `SYNAPSE_AGENTSCOPE_ENABLED=false` and scheduled tasks disabled.
- Fernet key generated only for this process.
- No paid or real provider call; endpoint fixture was `http://localhost:8765/v1`.
- Actors: owner, member, viewer; one active Workspace plus a second Workspace for header mismatch checks.
- Secret sentinel was `F32-HTTP-AgentScope-provider-secret-20261013`; it was not present in any successful or error response.

Commands and results:

| Check | Result |
| --- | --- |
| `apps/api/.venv/Scripts/python.exe -m pytest tests/verification/test_f32_model_provider_management.py -q --tb=short` | **PASS: 4 passed** |
| Unauthenticated `GET /api/v1/workspaces/{workspace_id}/ai/providers` | **PASS: 401 `AUTHENTICATION_REQUIRED`** |
| Authenticated `GET .../ai/providers` | **FAIL: 500 `INTERNAL_ERROR`** |
| Authenticated `POST .../ai/credentials` with sentinel secret | **FAIL: 500 `INTERNAL_ERROR`**; no secret appeared in the response |
| Mismatched `X-Workspace-ID` versus path Workspace | **PASS: 400 `CONTEXT_MISMATCH`** |
| Injected `AgentScope` reference followed by HTTP model delete | **PASS: 409 `MODEL_BINDING_IN_USE`**; no secret in response |
| HTTP custom-model create/update/list flow | **BLOCKED** by credential/provider result serialization, so no success response or model ID could be obtained |

## Findings

### P0 — Authenticated F32 success responses are unusable over HTTP

`apps/api/app/api/model_provider.py:34`, `apps/api/app/api/model_provider.py:42`, `apps/api/app/api/model_provider.py:51`, `apps/api/app/api/model_provider.py:79`, `apps/api/app/api/model_provider.py:88`, and `apps/api/app/api/model_provider.py:98` call `PydanticModel.model_validate()` on frozen dataclass results such as `ProviderResult`, `CredentialResult`, and `ModelBindingResult`.

Those response schemas do not enable `from_attributes`, and the dataclasses are not converted to dictionaries. The real HTTP result is a Pydantic `ValidationError`, which the application masks as `500 INTERNAL_ERROR`. The provider route fails at `model_provider.py:34`; credential creation fails at `model_provider.py:51`.

Action: convert each dataclass with `dataclasses.asdict()`/an explicit mapping, or set the response models to accept attributes and validate with the corresponding supported mode. Add a `TestClient` success-path test so this cannot regress behind service-only tests.

### P1 — Viewer credential writes are not denied by the backend

`apps/api/app/services/model_provider.py:135-154` creates a credential from any valid `WorkspaceContext`; unlike model creation at `apps/api/app/services/model_provider.py:215-218`, it never calls `_require_manager()`. A viewer therefore reaches credential creation rather than receiving `403 FORBIDDEN` (the response serialization defect currently masks the final status as `500` in the HTTP harness).

The frontend hides the form for viewers at `apps/web/src/features/workspaces/models-page.tsx:30-32`, but that is not an authorization boundary.

Action: define the intended Phase 1 role policy and enforce it in the service/API. For the requested viewer-write acceptance, reject viewer credential create/update/delete with `403`; then add an HTTP test that bypasses the UI.

### P1 — HTTP custom-model acceptance is not currently executable

The service-level custom model and ownership test passes, including the non-secret projection and owner-only status. But `apps/api/app/api/model_provider.py:79` and `apps/api/app/api/model_provider.py:88` apply the same invalid dataclass-to-Pydantic conversion to list/create model responses. Consequently, the acceptance cannot prove over HTTP that an arbitrary model ID is created, updated, or returned to the Workspace page.

Action: fix the response adapter first, then rerun owner/member/viewer HTTP flows with a unique custom model ID and scan every response for the sentinel secret, `encrypted_api_key`, and raw credential identifiers.

### P2 — Reference protection is present but only a projection seam, not runtime discovery

The isolated HTTP delete check returned `409 MODEL_BINDING_IN_USE` when the service reference projection was injected with an `AgentScope` fixture reference. The focused service test also covers the guard. The production projection at `apps/api/app/services/model_provider.py:205-213` always returns an empty tuple because no runtime consumers are wired in this slice.

This is acceptable as a tested seam for the current control-plane slice, but it does not prove that real agents, sessions, schedules, or channels will be discovered before deletion.

Action: keep the `GET .../references` contract and add real consumer queries before calling deletion protection complete for the broader F32 acceptance plan.

## Scope conclusions

- Secret response safety: **partially evidenced**. The sentinel was absent from HTTP error and conflict responses, and the service test verifies write-only projections. A successful HTTP credential response could not be produced until the serialization defect is fixed.
- Personal credential ownership: **service-level pass; HTTP end-to-end blocked**. The service test verifies member `owner_only` projection and owner filtering.
- Workspace context: **HTTP pass for mismatch and unauthenticated rejection** on routes that resolve `get_workspace_context`.
- Viewer write denial: **fail at backend policy level** for credential writes; model writes are manager-protected.
- Custom model create/update: **HTTP blocked**, service-level custom model persistence passes.
- Reference-protected delete: **HTTP pass with isolated `AgentScope` reference fixture**, while real runtime reference discovery remains unimplemented.
- No real provider, paid endpoint, `.venv`, shared Redis, or product data was used or changed.

Recommended next sequence:

1. Fix all F32 response adapters and add HTTP success-path coverage.
2. Enforce the selected viewer credential-write policy server-side.
3. Rerun the owner/member/viewer and secret-sentinel HTTP matrix.
4. Wire real AgentScope consumer reference discovery before declaring model deletion protection complete.

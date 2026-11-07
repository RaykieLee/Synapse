# TENANCY-SEAM-001 Independent Verification — 2026-11-06

## Result

PASS for the focused backend seam and F06 contract scope. This does not accept the frontend UX behavior.

- Verifier task: `task_5f4d3334b9c1`; Orca dispatch: `ctx_378d05d02e65`.
- Orca launch requested and reported effective model: `gpt-6-luna`, effort `high`.
- The verifier made no file changes and left the pre-existing working-tree changes untouched.

## Evidence

From `apps/api`:

```text
.venv/Scripts/python.exe -m pytest tests/test_tenancy_context_resolver.py tests/verification/test_f06_workspace_backend.py -q
9 passed, 2 warnings in 6.11s
```

Warnings were the Starlette/httpx TestClient deprecation and Alembic's missing `path_separator` deprecation; neither failed the focused test run.

The verifier inspected `apps/api/app/tenancy/resolver.py` and `context.py` against `docs/tenancy-contract.md` and `docs/ux/architecture-authorization-context.md`. It confirmed that Workspace determines tenant scope; active `TenantMember` and `WorkspaceMember` relationships are checked independently; tenant and Workspace roles remain separate; platform-admin identity does not bypass business-scope membership; and custom tenant-role assignment and lookup constrain `tenant_id`.

The adapter mapping inspected was:

| Detail code | HTTP status | Evidence |
| --- | ---: | --- |
| `RESOURCE_NOT_FOUND` | 404 | Code mapping inspected; no end-to-end 404 assertion in this scope |
| `WORKSPACE_CONTEXT_REQUIRED` | 400 | Mapping inspected; selector/F06 paths cover missing context |
| `CONTEXT_MISMATCH` | 400 | Mapping inspected; selector/F06 paths cover mismatch |
| `MEMBERSHIP_INACTIVE` | 403 | Mapping inspected; resolver and F06 membership cases cover denial |
| `WORKSPACE_MEMBERSHIP_REQUIRED` | 403 | Mapping inspected; resolver and F06 membership cases cover denial |
| `TENANT_INACTIVE` | 409 | Mapping inspected; inactive-scope tests cover denial |
| `WORKSPACE_INACTIVE` | 409 | Mapping inspected; inactive-scope tests cover denial |
| `FORBIDDEN` | 403 | Mapping inspected; permission-denial paths are covered in F06 |

## Limits

- Not every HTTP/detail mapping is asserted end-to-end at the FastAPI adapter boundary; `RESOURCE_NOT_FOUND` 404 is specifically unexercised there.
- Frontend error-state mapping, cache invalidation, delayed Workspace switching, mobile behavior, and accessibility remain unimplemented or unaccepted; the UX document is a design contract only.
- Validation was limited to the two named test files. No full suite, build, lint, or external-provider check was run.

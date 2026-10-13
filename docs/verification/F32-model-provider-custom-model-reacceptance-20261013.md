# F32 Model Provider and Custom Model Re-acceptance Report

Execution date: 2026-10-13

Scope:

- Re-accept the fixes listed in `F32-model-provider-custom-model-acceptance-report.md`.
- Do not modify product source code.
- Verify backend contracts, migration chain, frontend build/lint, and the membership-version cache boundary.

## 1. Executive result

The five blocking defects from the previous F32 report are fixed at the contract and focused-test level:

| Previous blocker | Result | Evidence |
| --- | --- | --- |
| Provider registry bypassed Workspace authentication | PASS | `/providers` now depends on `get_workspace_context`; focused test passes. |
| `default_parameters` accepted nested secret-like fields | PASS | Recursive object/array validation rejects `api_key`, nested `authorization`, and nested `endpoint` values for create and patch. |
| Model binding deletion had no reference protection | PASS | References endpoint and service guard exist; focused test proves a referenced binding raises `ModelBindingInUse`. |
| Frontend cache key ignored `membership_version` | PASS | Query key includes membership version; focused frontend contract test is present. |
| Endpoint DNS failure was fail-open | PASS | DNS resolution errors and empty resolution results are rejected; development `localhost`/`127.0.0.1` remains allowed. |

The F32 first slice is accepted as a management/control-plane slice, not as complete provider execution. The recommended status remains:

```text
F32 | Model provider and custom model management
Status: first-slice control plane accepted; runtime/provider integration and browser dual-role acceptance remain open
```

## 2. Exact commands and results

All commands below were executed from the indicated directory.

### Backend

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m pytest -q tests/verification/test_f32_model_provider_management.py --tb=short
```

Result:

```text
4 passed in 1.79s
```

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m pytest -q --tb=short
```

Result:

```text
40 passed, 26 deselected, 42 warnings in 42.78s
```

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m compileall -q app
```

Result: passed with exit code `0`.

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m alembic heads
.\.venv\Scripts\python.exe -m alembic history
```

Result:

```text
0018_model_provider_management (head)
0017_team_orchestration -> 0018_model_provider_management
```

Fresh database migration:

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
$env:SYNAPSE_DATABASE_URL='sqlite:///C:/Users/Lenovo/AppData/Local/Temp/synapse-f32-verification.db'
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
```

Result: all migrations from `0001` through `0018` applied successfully; current revision was `0018_model_provider_management (head)`. The temporary database was removed after the check.

### Frontend

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\web
pnpm build
```

Result: passed; TypeScript and Vite build completed with `2859 modules transformed`.

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\web
pnpm exec eslint src/api/model-providers.ts src/features/workspaces/models-page.tsx src/features/workspaces/model-provider-query-key.ts src/features/workspaces/models-page.test.tsx 'src/routes/_authenticated/w/$workspaceId/models.tsx'
```

Result: passed with exit code `0`, no F32 lint errors or warnings.

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\web
pnpm exec vitest run src/features/workspaces/models-page.test.tsx
```

Result: blocked by the local test environment before tests ran. Playwright Chromium is not installed at:

```text
C:\Users\Lenovo\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe
```

This is not a product assertion failure. It leaves the browser-level membership cache test and interactive UI checks unverified on this machine.

### Repository hygiene

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo
git diff --check
```

Result: no whitespace errors. Git only reported existing LF/CRLF conversion warnings for tracked files.

## 3. Fixed-blocker evidence

### 3.1 Provider registry Workspace authentication

`apps/api/app/api/model_provider.py` now injects `get_workspace_context` into the provider registry route. The route is therefore subject to the same tenant, Workspace, actor, membership, and active-state checks as the credential and model routes.

The focused test verifies that the route dependency set contains `get_workspace_context`. This accepts the structural/API contract fix. A logged-in two-actor browser/API matrix remains separate work.

Result: PASS for the fixed blocker.

### 3.3a Endpoint DNS validation fails closed

Endpoint validation now rejects DNS resolution failures and empty resolution
results instead of treating them as an empty address set that can pass private
address checks. Development `localhost` and `127.0.0.1` remain explicitly
allowed.

Result: PASS for the fixed blocker at the focused service-test level. This is
still a creation-time URL/IP check and not a deployment-grade outbound egress
or DNS-pinning policy.

### 3.2 Recursive secret-field rejection

`ModelBindingCreate` and `ModelBindingPatch` recursively inspect dictionaries and arrays. The focused test rejects:

- top-level `api_key`;
- nested `authorization`;
- nested array `endpoint`.

The same validation is applied to both create and patch contracts. This prevents `default_parameters` and `capabilities` from becoming an alternate secret or endpoint storage channel.

Result: PASS for the fixed blocker.

### 3.3 Reference projection and delete protection

The API exposes:

```text
GET /workspaces/{workspace_id}/ai/models/{model_binding_id}/references
```

The service checks the reference projection before deleting a model binding and raises `ModelBindingInUse` when references exist. The focused test also verifies the credential deletion guard remains active for disabled bindings.

The current projection is intentionally empty because AgentScope runtime consumers are not yet wired into F32. The delete guard itself is tested with a controlled reference fixture.

Result: PASS for the fixed blocker; runtime consumer reference discovery remains an accepted boundary.

### 3.4 Membership-version cache isolation

`modelProviderQueryKey()` includes:

- actor ID;
- tenant ID;
- Workspace ID;
- Workspace `membership_version`.

The frontend contract test proves that changing membership version produces a different query key. The source lint and production build also pass.

The browser-level test could not start because the local Playwright Chromium executable is missing. Therefore the key design is accepted, while real browser cache invalidation and dual-role interaction remain unverified.

Result: PASS for the fixed blocker at the query-contract level; browser evidence pending.

## 4. Remaining blockers and accepted boundaries

These are not regressions in the four fixed defects, but they prevent calling F32 complete:

- AgentScope runtime binding is not implemented. `model_binding_id` is not yet resolved into an actual AgentScope runtime `type`, credential, endpoint, and model configuration for agents, sessions, SOPs, schedules, or channels.
- No fake-provider or real-provider connection test exists. Authentication failure, timeout, rate limit, model-not-found, retry, redirect, response-size, and request-timeout behavior remain unverified.
- DNS rebinding and deployment-grade egress policy are not fully solved. The
  current endpoint validation now fails closed on DNS errors, but remains a
  creation-time IP/URL check; it is not a complete outbound proxy or
  DNS-pinning policy.
- Browser dual-role acceptance is pending because Chromium is not installed in the local Playwright environment. This includes logged-in owner/member flows, narrow viewport, keyboard interaction, and slow-response cache behavior.
- Credential rotation/delete UI, connection-test UI, provider schema discovery, and audit event persistence remain outside the accepted first slice.
- The provider registry currently contains only the `openai_chat` entry. Custom model IDs are accepted for that provider's OpenAI-compatible endpoint.

## 5. Recommended status

Recommended ledger entry:

```text
F32 | 模型与凭据管理融合
状态：第一阶段控制面已通过复验；provider registry 认证、递归敏感字段拒绝、模型引用删除保护、membership-version 缓存隔离和 DNS 解析失败 fail-closed 已修复并通过定向验证；AgentScope runtime/provider 连接、完整 DNS/出站策略和浏览器双角色验收待后续阶段
```

Do not mark F32 as fully complete until at least the following are independently accepted:

1. binding-to-AgentScope runtime resolution with deterministic model/tool fixtures;
2. fake-provider connection and stable upstream error classification;
3. deployment-level DNS/egress policy;
4. logged-in owner/member browser acceptance with Chromium available.

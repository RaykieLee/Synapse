# F32 / F27b Frontend and UX Acceptance

Execution date: 2026-10-13

Scope:

- Independent frontend/UX acceptance of the current F32 model-provider/custom-model page and F27b team-control page.
- Product source files were read-only during this acceptance.
- Main fixed wakeup: NewtonF32backend.
- Team HTTP integration: PeirceTeamHTTP.
- This report does not claim real provider execution, real AgentScope worker execution, or broad all-feature acceptance.

## Verdict

**Not accepted as complete frontend/UX slices.**

The current implementation has a passing production build, focused browser-backed Vitest coverage for the F32 membership-version query-key contract, and clear control-plane disclosure on the F27b page. The acceptance still has blocking UX findings around permission-aware controls, credential revocation, localization, and accessibility/state handling.

The F27b page does not pretend that a real worker ran: it explicitly says saving a draft does not start a model and, after a run exists, says that no real AgentScope worker/model is connected and that interrupt confirmation still requires an executor. The backend run event also sets `execution_mode` to `durable_control_only`. This is the correct boundary for this phase, but the page should make the boundary and permissions consistent before acceptance.

## Commands and Results

All commands were run from `apps/web`.

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --browser.headless src/features/workspaces/models-page.test.tsx` | **PASS** — 1 file, 1 test |
| `pnpm exec eslint src/features/workspaces/models-page.tsx src/features/workspaces/models-page.test.tsx src/features/workspaces/teams-page.tsx src/api/model-providers.ts src/api/team-orchestration.ts src/features/workspaces/model-provider-query-key.ts` | **PASS** — no errors or warnings |
| `pnpm build` | **PASS** — TypeScript build and Vite build; 2859 modules transformed |

Chromium was already installed and the browser-backed Vitest test ran successfully. No Playwright installation was needed.

The existing `models-page.test.tsx` is a contract test for the query key only. It proves that changing `membership_version` changes the React Query scope; it does not exercise the rendered page, API fixtures, owner/member/viewer interaction, revoke flow, language switching, keyboard navigation, or narrow-screen layout.

## Findings

### P1 — F27b exposes controls to viewers and ordinary members before effective capability is known

Evidence:

- `apps/web/src/features/workspaces/teams-page.tsx:116-123` always renders the create-team form and enables `创建草稿` based only on local form values and whether an agent list is non-empty.
- `apps/web/src/features/workspaces/teams-page.tsx:127` renders `启动运行` for every selected draft team. It does not use a server-provided create/start capability.
- The backend requires owner/admin for start and interrupt (`apps/api/app/services/team_orchestration.py:265-270` and `312-315`); team creation may additionally require the custom `team:create` permission (`357-364`).

A viewer can therefore see and attempt actions that the server will reject, and a member with no custom team permission receives the same misleading affordance. This fails the F27b requirement that controls be shown only when the server-authorized capability allows them. The UI needs an explicit read-only/permission explanation and capability-aware gating; a 403 after clicking is not sufficient acceptance evidence.

### P1 — F32 credential revoke/rotate is not available in the web page

The API exposes credential patch and delete routes, but the web client only imports `createCredential`, `listCredentials`, and model-binding deletion. `apps/web/src/features/workspaces/models-page.tsx:5-13` and `90-95,130-141,172-174` show that credential rows have no rotate, revoke, or delete action. The page cannot complete the requested credential lifecycle acceptance:

- no owner-only rotate/replace-secret action;
- no owner-only revoke/delete action;
- no confirmation or in-use explanation;
- no post-revocation model status refresh for other members.

The page correctly avoids displaying the secret and labels the endpoint host, but that is only a partial credential lifecycle.

### P1 — New F32/F27b UI strings are not localized

The new page copy is mostly passed through `LocalizedText`, but the corresponding message keys are absent from `apps/web/src/lib/i18n.ts`. A direct lookup found missing translations for the F32 headings and actions (`模型与凭据`, `已注册提供商`, `我的凭据`, `添加凭据`, `Workspace 模型`, `上游模型 ID`, `添加模型`) and F27b copy such as `创建团队草稿`, `首期只允许使用当前 Workspace 可见的智能体；保存不会启动模型。`, and the control-only run disclosure.

The remaining untranslated literals are more extensive: F27b labels such as `状态`, `版本`, `成员`, `事件`, `负责人`, `启动运行`, and `中断运行` are rendered as plain text, not localized keys. In English mode, users will see a mixed Chinese/English page. This fails the stated i18n acceptance even though the production build passes.

### P1 — F27b does not provide the required destructive-action confirmation

The UX contract requires a second confirmation for destructive interruption. `teams-page.tsx:127` calls `interrupt.mutate()` directly from the destructive button. There is no confirmation dialog, reason field, impact statement, or focus-return behavior. The control-plane status text correctly says `interrupt_requested` is awaiting executor confirmation, but the initial user action is still one click with no confirmation.

### P2 — Loading and error states can present blank or misleading content

`models-page.tsx:39-49` creates provider, credential, and model queries but renders no query loading or query error state. A failed provider request can leave an apparently empty provider section while the credential/model forms remain visible. `teams-page.tsx:105-110` handles only team loading and empty state; it does not render a team-list error state, agent-list error state, or event-query error state. The F27b UX contract calls for distinct loading, 403, 404, 409, 422, 429, and 503 handling, not just a mutation alert.

### P2 — Accessibility semantics are incomplete for the new controls

- `models-page.tsx:168-169` renders `Label` and `Input` without an `htmlFor`/matching `id`; the model credential `<select>` at `156` has a `Label` without `htmlFor`.
- F27b status and event updates are ordinary text. There is no `aria-live` summary for run changes, no progressbar for progress, and no semantic live announcement for `interrupt_requested`.
- The team list buttons have usable visible names, and the create form has matching ids, so this is a partial rather than total accessibility failure.

### P2 — Narrow-screen layout is structurally stacked but not fully resilient

The new forms use responsive grids and the team page collapses its two-column layout below `xl`, which is a positive result for narrow screens. However, member `agent_id`, task owner IDs, event types, and raw status strings are rendered without truncation or wrapping controls in `teams-page.tsx:130-133`. Long identifiers can widen cards or become difficult to scan at 390px. The UX plan also calls for a sticky/clear mobile control area; the current controls remain in the card header and are not verified with a narrow-screen browser interaction test.

## Positive Evidence

- F32 model-provider query keys include actor, tenant, Workspace, and `membership_version` through `modelProviderQueryKey()`; the focused browser test passes.
- Workspace switching uses scoped query keys and removes old Workspace queries in the switcher. The relevant F32 key boundary is present.
- F32 model creation is manager-gated in the UI (`owner`/`admin`), while viewer users do not receive the model-creation form.
- F32 credential input is a password field, the page states that secrets are write-only, and the credential projection displays only host/secret-presence metadata.
- F27b explicitly labels the draft path as non-executing and the run path as `durable_control_only`/executor-confirmed. No UI text claims that a real worker or real model completed the task.
- F27b run interruption is not presented as immediately terminal; `interrupt_requested` is shown as waiting for executor confirmation.

## Fixture and Runtime Boundary

No real provider key, real upstream model call, or real AgentScope worker execution was used or claimed. Existing focused tests are contract/fixture-level evidence. Any future browser/API fixture must be labeled as a fixture or simulated provider/worker in the test and report; it must not be presented as C-level real-model acceptance.

## Acceptance Status

| Area | Current result |
| --- | --- |
| Build and focused lint | Pass |
| Existing F32 browser-backed Vitest test | Pass; query-key contract only |
| Workspace-switch query scoping | Present in source; no dual-role browser proof |
| F32 inspect/list/custom-model display | Partial; page and API wiring exist, but rendered interaction is not covered |
| F32 credential revoke/rotate | Not accepted; UI action is absent |
| F32 member/viewer permissions | Partial; model creation is hidden for viewer, but lifecycle actions are incomplete |
| F27b team list/create/start/interrupt UX | Not accepted; controls are exposed without effective capability gating |
| F27b control-only labeling | Pass for wording/boundary; no real worker claim observed |
| i18n | Not accepted; many new keys/literals remain untranslated |
| Accessibility | Not accepted; label associations/live status/progress semantics incomplete |
| Narrow screens | Partial static evidence only; browser interaction acceptance not demonstrated |
| Real provider / real worker execution | Out of scope and not claimed |

No product fixes were made. The only file owned by this acceptance is this report.

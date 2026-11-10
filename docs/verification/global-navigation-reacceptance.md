# Global Navigation Reacceptance

Date: 2026-11-10 (Asia/Shanghai)
Overall verdict: **FAILED**

Independent re-verification against the UX contract, implementation scope, and original acceptance. No product code or tests were edited; this report is the only file created for this task. Existing worktree changes are supplied state, not attributed to this verification.

## Per-check verdicts

| Check | Verdict | Evidence and limitations |
| --- | --- | --- |
| Navigation scopes and role separation | **PARTIAL (simulated/static)** | `AppSidebar` constructs platform, tenant, Workspace, and personal groups. Role helper tests pass for platform admin, tenant member/admin, and Workspace member/admin (`sidebar-data.test.ts:46`, `:54`, `:68`). The focused suite does not mount full `AppSidebar`; fixtures are simulated, with no real account authorization evidence. |
| Confirmed-context gating | **PASS (simulated/static only)** | Candidates are selected against confirmed scope and `navigation.isError` (`app-sidebar.tsx:336`); helper tests reject unverified/mismatched scope and distinguish confirmed-empty from unresolved (`sidebar-data.test.ts:110`, `:132`). This is frontend evidence, not server authorization evidence. |
| Same-scope stale-menu suppression | **PASS (simulated/static only)** | `selectFreshAuthorizedNavigationCandidates` receives query error state (`app-sidebar.tsx:336`, `sidebar-data.ts:61`). Regression test retains a previous menu object and asserts suppression after failure (`sidebar-data.test.ts:139`). Real sidebar/API integration was not mounted; no live request was made. |
| 403/context recovery and retry | **PASS (simulated component/helper only)** | Sidebar maps authorization/context failures to recovery status (`app-sidebar.tsx:435`). TeamSwitcher tests simulate 403 and `CONTEXT_MISMATCH`, hide stale options, show recovery copy, and exercise retry (`directory.team-switcher.test.tsx:239`, `:274`). No real 403 was returned by an authenticated service. |
| Mobile switcher at 320/390px | **PARTIAL (browser component test)** | Browser-backed tests assert viewport-wide dialog width and no document overflow at both widths (`directory.team-switcher.test.tsx:127`); Dialog uses `w-screen max-w-none` (`directory.tsx:305`). Drawer closure/route focus are tested at 390px (`directory.team-switcher.test.tsx:141`, `:164`), not 320px. `useSidebar` is mocked, so real Drawer integration is untested. |
| Breadcrumb ancestors and narrow-screen keyboard access | **PASS (component/browser test)** | Tests cover scope ancestry and keyboard access to a middle breadcrumb at 320px; the trail is scrollable and announces the destination (`app-header.breadcrumbs.test.tsx:30`, `:63`; `app-header.tsx:103`, `:255`). Route data is fixture-driven; authenticated navigation and all route variants were not exercised end-to-end. |
| Chinese/English Workspace switcher labels | **PASS (key labels only)** | Browser tests verify dialog heading, access hint, and search label/placeholder in both locales (`directory.team-switcher.test.tsx:184`); translation helper covers the search phrase (`i18n.test.ts:26`). Not every dynamic state/role/create/close label is asserted in both locales. |
| Chinese/English Quick Navigation labels | **NOT VERIFIED (test blocked)** | `command-search-messages.ts` has Chinese and English trigger, placeholder, scope and status entries. Its UI suite failed before collection because `/src/lib/api.ts` did not provide the named `ApiProblem` export. Static messages are not runtime localization evidence. |
| Keyboard focus and accessibility | **PARTIAL (component/browser test)** | Switcher tests verify initial input focus, keyboard selection, drawer-close callback and route focus at 390px; breadcrumb test verifies keyboard access at 320px (`directory.team-switcher.test.tsx:141`, `:164`; `app-header.breadcrumbs.test.tsx:63`). No screen reader/NVDA run, 320px switch completion, real Drawer focus-return, or zoom/touch-target audit was performed. |
| Real API permissions and tenant isolation | **NOT VERIFIED** | No authenticated browser, live API, real role fixture, or direct 401/403/404/409/context-mismatch request was used. Role, scope and failure cases are simulated or static. Navigation visibility is not authorization evidence. |
| Web build | **FAILED** | `pnpm build` stopped during `tsc -b`; Vite did not run. Errors are in `app-header.tsx(293,29)` (`Breadcrumb[].at` not in configured lib) and `directory.tsx(310,19)` (nullable `event.currentTarget`) / `(311,22)` (`querySelector` missing on `EventTarget`). These current navigation-file errors remain unresolved. |

## Exact validation results

Commands ran from `apps/web` unless noted.

```text
pnpm exec vitest run --browser.headless src/components/layout/app-header.breadcrumbs.test.tsx src/components/layout/data/sidebar-data.test.ts src/features/workspaces/directory.team-switcher.test.tsx src/features/workspaces/directory.quick-navigation.test.tsx src/features/workspaces/context.test.tsx src/lib/i18n.test.ts
```

Result: exit 0; 6 test files passed, 48 tests passed (Vitest 4.1.4, Chromium browser, 5.12s). The suites use mocked auth, directory, query and role fixtures; they are not real service permission tests.

```text
pnpm exec vitest run --browser.headless src/context/search-provider.test.tsx
```

Result: exit 1; 1 suite failed before collection, 0 tests ran. Import error: `The requested module '/src/lib/api.ts' does not provide an export named 'ApiProblem'` (Vitest 4.1.4, 16.33s). No Quick Navigation UI assertions from this suite count as passing.

```text
pnpm build
```

Result: exit 1 in `tsc -b`; Vite bundling did not start. Diagnostics: `src/components/layout/app-header.tsx(293,29): error TS2550: Property 'at' does not exist on type 'Breadcrumb[]'`; `src/features/workspaces/directory.tsx(310,19): error TS18047: 'event.currentTarget' is possibly 'null'`; `src/features/workspaces/directory.tsx(311,22): error TS2339: Property 'querySelector' does not exist on type 'EventTarget'`.

## Evidence boundaries and remaining work

- Mobile viewport tests run a browser-backed component harness at both widths. Drawer close/focus coverage is only at 390px and uses a mocked sidebar callback; repeat at 320px and in the real app shell.
- This reacceptance verifies simulated client behavior only. Obtain authenticated API/browser evidence for role boundaries, revocation and direct server authorization before accepting permission/isolation.
- The full bilingual Quick Navigation suite is blocked at import; repair is outside this verifier's scope. Switcher tests cover key labels, not every state/action in both locales.
- Fix the listed TypeScript errors and rerun focused suites plus `pnpm build`; no implementation or tests were changed here.

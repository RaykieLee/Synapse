# Global Navigation Final Reacceptance

Date: 2026-11-18 (Asia/Shanghai)
Scope: independently re-verify the reported global-navigation TypeScript and focus corrections on the current branch.
Targeted correction verdict: **PASS**. Overall global-navigation acceptance: **NOT ESTABLISHED**.

Reviewed `docs/tenancy-contract.md`, `docs/ux/global-navigation-information-architecture.md`, the prior global-navigation acceptance and reacceptance reports, and the current navigation implementation/test diffs. The tenancy contract keeps global accounts, TenantMember, and WorkspaceMember roles separate; Tenant membership does not grant Workspace access, role names do not cross scopes, and UI visibility does not replace server-side authorization. The UX contract additionally requires real scope authorization evidence, mobile/Drawer behavior, keyboard focus transitions, and screen-reader checks; the focused checks below do not satisfy those broader conditions.

The current worktree contains the corrections under review: `app-header.tsx` now indexes the final breadcrumb without `Array.at(-1)`; `directory.tsx` narrows the autofocus target before querying the dialog content; the breadcrumb browser test asserts the polite live announcement; and the switcher test checks the DOM active element. These are observations of supplied branch changes, not edits made by this verifier.

## Exact validation

Commands ran from `apps/web`.

```text
pnpm exec vitest run --browser.headless src/components/layout/app-header.breadcrumbs.test.tsx src/components/layout/data/sidebar-data.test.ts src/features/workspaces/directory.team-switcher.test.tsx
```

Initial result: exit 1 before Vitest started because pnpm attempted an automatic install and reported `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. With `CI=true`, pnpm then began restoring the ignored local `node_modules` tree; its first attempt stopped with `ENOENT` for `rolldown/package.json`. No test had run in either attempt.

After pnpm completed that local dependency restore, the same focused command with `CI=true` exited 0:

```text
Test Files  3 passed (3)
Tests       19 passed (19)
Vitest      4.1.4, Chromium browser
Duration    6.01s
```

This verifies the three requested focused files only. The tests use browser-backed component fixtures and mocks; they are not live-service or authenticated app-shell evidence.

```text
$env:CI = 'true'; pnpm exec tsc -b
```

Result: exit 0, no TypeScript diagnostics. This confirms the previously recorded diagnostics are no longer emitted by this project-reference build check: `Breadcrumb[].at` unavailable under the configured lib (`TS2550`) and `event.currentTarget` null / missing `querySelector` on `EventTarget` (`TS18047`, `TS2339`). This is a TypeScript check, not a Vite production build.

Quick Navigation's collection was checked separately, not counted as navigation acceptance:

```text
$env:CI = 'true'; pnpm exec vitest list src/context/search-provider.test.tsx
```

Result: exit 0. Vitest listed the `src/context/search-provider.test.tsx` cases, including the Quick Navigation suite and its added pending/error Tenant-context cases. This establishes that the test file now collects; this command executes no tests, and no result from the rest of that file is treated as a pass.

## Evidence and limits

| Item | Result | Evidence / limit |
| --- | --- | --- |
| Breadcrumb TypeScript correction | **PASS** | `apps/web/src/components/layout/app-header.tsx:293` no longer uses `.at(-1)`; `pnpm exec tsc -b` exits 0. |
| Workspace switcher autofocus typing | **PASS** | `apps/web/src/features/workspaces/directory.tsx:310` narrows `currentTarget` to `HTMLElement` before querying; TypeScript reports no error. Focus behavior is exercised only in the focused component tests. |
| Browser focus/live announcement checks | **PASS (focused component scope)** | The breadcrumb and switcher tests pass among the 19 requested tests; the breadcrumb test checks focus on a middle ancestor and a polite status announcement. This does not demonstrate real app-shell focus management. |
| Quick Navigation test collection | **PASS (collection only)** | Vitest lists the test cases, including the regressions previously blocked before collection by an `ApiProblem` import error. No tests from this file were run in this reacceptance. |
| Overall navigation acceptance | **NOT ESTABLISHED** | Prior acceptance/reacceptance reports recorded broader scope, stale-menu, responsive, and accessibility gaps. This task intentionally ran only the requested focused files and TypeScript check; unrelated test results are not acceptance evidence. |

Not tested in this reacceptance: real API authorization or Tenant/Workspace isolation; real app-shell Drawer integration and its close/focus behavior; physical mobile devices/touch behavior; or a screen reader/NVDA-equivalent pass. The mock-based tests and TypeScript success do not satisfy these UX or tenancy-contract criteria. The full Quick Navigation suite, complete navigation acceptance matrix, and production bundling were not run. No implementation or test failure was repaired.
*** End Patch

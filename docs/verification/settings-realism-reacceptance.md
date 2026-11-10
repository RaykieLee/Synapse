# Settings recovery fixes reacceptance

Date: 2026-11-10  
Overall: **Failed** — the focused browser suite passes, but Appearance commits are not atomic across both cookies and the settings providers fail TypeScript compilation.

## Scope and environment

- Read `AGENTS.md`, `docs/tenancy-contract.md`, `docs/ux/settings-realism.md`, `docs/verification/settings-realism-acceptance.md`, and the completed implementation dispatch `task_a902a36b113d`. Its report said the focused suite passed 15/15; this is an independent rerun.
- Browser: Vitest 4.1.4 / Playwright Chromium headless (`apps/web/vite.config.ts:38-41`). The application locale is English by default in the suite, with explicit Chinese unavailable-state cases (`settings-realism.test.tsx:54-63, 82-91`). No viewport override is configured; Playwright's default is 1280×720. No narrow viewport or assistive-technology checks ran.
- Commands (working directory `apps/web`): `pnpm vitest run src/features/settings/settings-realism.test.tsx --browser.headless`; `pnpm build`.
- Tests mock `@/lib/api`, `getCookie`, `setCookie`, and success toasts. Cookie helpers use `document.cookie` by default, while refusal/exception cases are mocks. The 401 case mocks auth-store reset followed by a rejected API call. No real API, authenticated account, database commit, or server readback was tested.

## Reverification

| Check | Verdict | Evidence and limits |
| --- | --- | --- |
| Appearance applies only after both cookies are confirmed | **Failed** | `AppearanceForm` calls `setTheme` before `setFont`, with the two-cookie post-check only afterward (`apps/web/src/features/settings/appearance/appearance-form.tsx:59-70`). Each provider setter commits its context state immediately after confirming its own cookie (`apps/web/src/context/theme-provider.tsx:112-114`; `font-provider.tsx:67-69`), so the first state applies before the second cookie is confirmed. This is rollback-based, not an atomic two-cookie commit. The success test checks the theme cookie, toast, and callback, but not both cookies or rendered appearance (`settings-realism.test.tsx:93-116`). |
| Appearance refusal, exceptions, partial failure | **Partial** | Silent font-write refusal asserts retained selections, enabled submit, restored theme cookie, and no success toast/callback (`settings-realism.test.tsx:118-144`). Thrown write and thrown theme-read mocks assert an alert, enabled submit, and no success feedback (`:173-202`); the read exception occurs before provider commit, so a post-commit read failure is not tested. A rollback-refusal case explicitly leaves the theme applied and reports `Partial result: theme applied; font not applied.` (`:146-171`). That is honest partial feedback, but the test does not assert the actual theme class/look. `aria-busy` depends on `status === 'saving'` (`appearance-form.tsx:114`); button re-enablement is indirect evidence, not a direct `aria-busy=false` assertion. |
| Profile 401/reset and account isolation | **Passed (mocked client behavior)** | The test retains Account A's draft in memory through a mocked auth reset, displays the unauthenticated alert, disables fields/save, and verifies only one API call with no success feedback (`settings-realism.test.tsx:245-269`). After remount, setting Account B shows B's value, not A's draft (`:271-275`). Submit checks current-user/draft identity (`profile-form.tsx:40, 71-73`); draft state is module-local memory keyed by account ID (`profile-draft.ts:11-46`), with no web-storage calls. This is not a real 401 or account-switch integration test.
| Ordinary success/failure paths | **Passed (mocked client behavior)** | Tests cover Profile success updating the auth-store user, ordinary Profile failure retaining the draft, password failure retaining the session without toast/navigation, and normal Appearance success (`settings-realism.test.tsx:93-116, 204-303`). API behavior is mocked; no server persistence is established.
| Focused browser suite | **Passed** | `pnpm vitest run src/features/settings/settings-realism.test.tsx --browser.headless` → 1 file passed, 15 tests passed, 3.89s, Chromium.
| Build/typecheck | **Failed — scoped blocker** | `pnpm build` exits 2 in `tsc -b`: `src/context/font-provider.tsx(36,76): error TS2554: Expected 0-1 arguments, but got 2.` and `src/context/theme-provider.tsx(39,77): error TS2554: Expected 0-1 arguments, but got 2.` Both new `Error(message, { cause })` calls conflict with `tsconfig.app.json`'s ES2020 target/libs (`tsconfig.app.json:2-6`); Vite build was not reached. This is an in-scope settings-provider blocker. The previously known sidebar/Workspace build failure is separate and is not counted as a settings result here. |

## Follow-up and limits

- Create a separate fix task for the two TypeScript errors and stage both cookie writes before applying provider state. Add focused checks for both confirmed cookies and the actual rendered appearance on success and failure.
- Real API 401, actual account switching, database persistence/readback, browser-level Cookie blocking, reload behavior, narrow-screen layouts, and keyboard/screen-reader accessibility remain unverified. Mock evidence is not real API persistence or full settings acceptance.

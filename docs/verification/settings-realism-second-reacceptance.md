# Settings Atomic Appearance: Second Reacceptance

Date: 2026-11-10  
Overall: **PARTIAL**

## Scope and inputs

- Read `AGENTS.md`, `docs/ux/settings-realism.md`, `docs/verification/settings-realism-acceptance.md`, and `docs/verification/settings-realism-reacceptance.md`.
- Read the implementation receipt in `docs/development-status.md:45` and the completed worker transcript for Orca task `task_4d00cf325b48` / dispatch `ctx_2f168ba015c7`. The implementation reported 16/16 focused Chromium tests, a successful web build, and `git diff --check`.
- The UX contract defines Appearance as a current-browser-only preference, not an account API, and requires the user-facing success state only after its local preference is applied (`docs/ux/settings-realism.md:21,54,112`). This reacceptance did not change product files.

## Commands and results

Working directory for both commands: `apps/web`.

| Command | Result |
| --- | --- |
| `pnpm vitest run src/features/settings/settings-realism.test.tsx --browser.headless` | **PASS** — Vitest 4.1.4, Chromium; 1 test file and 16 tests passed; duration 3.61s; exit code 0. |
| `pnpm build` | **PARTIAL / blocked by unrelated WIP** — exit code 2 during `tsc -b`; diagnostics only at `src/components/layout/app-header.tsx(183,31)` (`TS2322: Type 'undefined' is not assignable to type 'string'`) and `(237,29)` (`TS2550: Property 'at' does not exist on type 'Breadcrumb[]'`, ES2020 lib). The earlier `TS2554` diagnostics in `src/context/font-provider.tsx` and `src/context/theme-provider.tsx` did not recur. `vite build` was not reached, so this is not a successful full build. |

## Per-check verdicts

| Check | Verdict | Evidence and limitations |
| --- | --- | --- |
| Provider state waits for both appearance cookies | **PASS (source + mocked browser test)** | `AppearanceForm` stages theme and font cookies, reads back both selected values, then calls `applyTheme` and `applyFont` (`apps/web/src/features/settings/appearance/appearance-form.tsx:58-70`). The Chromium test checks provider state and root classes remain at their initial values during each `setCookie` call, then checks both provider values and both rendered classes after success (`apps/web/src/features/settings/settings-realism.test.tsx:104-150`). The setter spy uses the original cookie writer; this verifies the test browser context, not privacy-mode or browser-level cookie rejection. |
| Success renders theme and font together | **PASS (mocked browser client)** | The same test asserts both `data-theme=\dark\` and the selected `data-font`, with matching `dark` and `font-*` root classes only after submission (`settings-realism.test.tsx:140-150`). It also checks both cookie values, no appearance API request, the browser-local success message, and one callback. |
| Cookie refusal/error retains draft; no false success; `aria-busy=false` | **PARTIAL** | The staged-font readback failure case keeps the selected form values, reports both cookies restored, keeps provider state unchanged, asserts `aria-busy=\false\`, and suppresses toast/callback (`settings-realism.test.tsx:232-270`). A separate injected read failure asserts an explicit `Partial result` / unconfirmed-cookie message, retained selections, unchanged provider state, `aria-busy=\false\`, and no success toast/callback (`:191-230`). However, its `getCookie` exception is injected during provider staging; there is no distinct test injecting failure at the form-level paired readback after both `stageTheme` and `stageFont` return (`appearance-form.tsx:63-66`). Thus the exact paired-readback exception requested is not independently exercised, although the source catch/rollback path covers it. |
| Profile 401 draft and account isolation | **PASS (mocked client behavior only)** | The test mocks `api` to reset auth state and throw `Unauthorized`, then verifies the current account's draft remains visible but disabled, no success callback occurs, and a remounted Account B form displays B's value rather than Account A's draft (`settings-realism.test.tsx:345-375`). This is not a real HTTP 401, server session invalidation, or end-to-end account switch. |
| Provider TypeScript ES2020 errors | **PASS (narrow diagnostic check)** | The requested `pnpm build` invokes `tsc -b` and reports only the two unrelated `app-header.tsx` diagnostics above; the earlier provider `TS2554` errors are absent. Because TypeScript exits before Vite, the overall build remains blocked rather than passed. |

## Evidence boundaries

- **Mocked client vs. persistence:** The suite mocks `api`, cookie utility entry points, toast, and navigation. Profile API assertions and auth-store updates prove client behavior only, not persistence to a real API or database. Appearance is intentionally browser-local; its tests do not establish account persistence or cross-device sync.
- **401/account switching:** The auth reset and `Unauthorized` response are simulated inside the API mock. No real authentication middleware, backend 401, cookie/session revocation, or live account switch was exercised.
- **Browser Cookie blocking:** A no-op cookie-write mock and throwing read mocks exercise refusal/error handling. No Chromium Cookie policy, browser setting, private mode, or actual blocked-cookie environment was enabled.
- **Responsive/accessibility:** The configured browser run uses headless Chromium without a viewport matrix or assistive technology. Semantic role queries and explicit `aria-busy` assertions provide limited DOM-level evidence only; no mobile layout, keyboard-only, screen-reader, zoom, or contrast audit was run.
- **Build boundary:** `tsc -b` stops on the two `app-header.tsx` errors before Vite bundling. No inference is made that the full app builds successfully.

## Overall assessment

The provider state is staged until both preference values are confirmed, successful UI application updates theme and font together, the mocked Profile 401/account-isolation regression passes, and the prior provider `TS2554` errors are gone. Overall remains **PARTIAL** because the exact post-stage paired-readback exception lacks a distinct test, the full build is blocked by unrelated `app-header.tsx` errors, and real API/authentication, browser Cookie-blocking, responsive, and assistive-technology evidence remains absent.

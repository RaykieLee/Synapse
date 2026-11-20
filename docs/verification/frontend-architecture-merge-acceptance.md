# Frontend Architecture Merge Acceptance

Date: 2026-11-20

## Scope

- Merged `RaykieLee/前端技术栈选型` commit `9699c2a5` into the local `main` worktree, preserving the existing mainline navigation, attachment, and Workspace UX changes and the post-merge fixes in the worktree.
- Resolved the `docs/development-status.md` index conflict by retaining the current mainline ledger, updating F43 from its third focused reacceptance, and recording this merge.
- No push was performed.

## Evidence

- `pnpm run openapi:verify` — passed. The exported OpenAPI schema contains 67 paths and 126 component schemas; generated outputs are current. The command also completed `tsc -b` successfully.
- Focused Vitest browser suite — 15 files and 146 tests passed:
  `src/features/workspaces/context.test.tsx`, `src/features/workspaces/context.recovery.test.tsx`, `src/features/workspaces/directory.test.tsx`, `src/features/workspaces/directory.team-switcher.test.tsx`, `src/features/workspaces/models-page.test.tsx`, `src/features/workspaces/teams-page.test.tsx`, `src/features/agentscope-chat/session-state.test.ts`, `src/features/agentscope-chat/page.test.tsx`, `src/features/dashboard/index.test.tsx`, `src/features/tenants/roles-page.test.tsx`, `src/lib/permissions.test.ts`, `src/lib/query-keys.test.ts`, `src/lib/i18n.test.ts`, `src/context/search-provider.test.tsx`, and `src/components/layout/app-header.breadcrumbs.test.tsx`.
- `http://127.0.0.1:5176/` returned HTTP 200. Orca loaded the local app and rendered the sign-in screen; unauthenticated `/` redirects to `/sign-in?redirect=%2F`. This confirms the preview is reachable, not the authenticated application flow.

## Contract and Limits

- No backend endpoint, HTTP method, request/response wire contract, or server-side authorization rule was changed by this merge. OpenAPI-backed TypeScript models cover the core users, tenants, and workspaces APIs only; other API types and some parameter/role constraints remain handwritten.
- The focused Workspace, permissions, QueryKeys, reducer, i18n, Dashboard, and page tests use fixtures or mocked APIs. Live authorization revocation, natural stale-time revalidation, production API behavior, and real AgentScope API/SSE flows remain unverified.
- Tenant member roster visibility and granular tenant-admin role mapping still require contract confirmation. Query-key migration does not cover every feature directory, and Workspace Sessions lacks a dedicated page test.
- Dashboard summary data is still not connected to a real overview API. Full mobile-device and screen-reader checks, complete F43 source/license review, full-project build, and full-project lint were not performed as part of this acceptance.
- The earlier core complex-page report remains partial and predates the merged Workspace directory error-state fix. The current directory UI now renders a distinct alert and retry action for request failures, but the focused fixture test does not assert that visible state and it has not received independent reacceptance. Actor/backend-revocation coverage remains open.

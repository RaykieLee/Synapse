# Global Navigation Acceptance

Date: 2026-11-10 (Asia/Shanghai)  
Overall verdict: **FAILED**

Independent verification of the current integrated worktree against `docs/ux/global-navigation-information-architecture.md`. Reviewed `AGENTS.md`, `docs/tenancy-contract.md`, and sections 2, 3, and 7 of `docs/tenant-optimization-principles-and-gap-review.md`. No product code or tests were changed. The mobile switcher remains a Popover, and other gaps below prevent acceptance.

## Per-check verdicts

| Check | Verdict | Evidence and limitations |
| --- | --- | --- |
| Four navigation scopes | **PARTIAL** | `app-sidebar.tsx` always adds Personal; only adds platform links for `platform_role === 'platform_admin'`; ordinary users get “我的租户”; tenant navigation requires a directory tenant with non-null `tenant_role`; Workspace links require verified context. Attachments/models are in the Workspace group, not “system”. Active-scope headings are generic, not named with Tenant/Workspace. The no-Workspace state omits the explicit platform-admin-without-membership explanation. TeamSwitcher displays a stored recent Workspace as selected even off `/w/...`, rather than as a recent suggestion. |
| Confirmed-context gating | **PASS (static/model evidence)** | `app-sidebar.tsx` requires authenticated actor, successful directory queries, fetched non-fetching Workspace detail, matching Workspace/Tenant IDs, valid `membership_version`, and known Tenant. The menu query is disabled without this scope. `selectAuthorizedNavigationCandidates` rejects null/unverified scopes and mismatched tenant/version; its test distinguishes `null` from confirmed `[]`. This follows the UX contract's verify-Workspace-then-request-tenant-menu flow, but does not prove server authorization. |
| Regular user vs platform admin | **PASS (simulated/static only)** | `selectPlatformNavigationGroup(false)` returns no platform section; `true` exposes `/tenants` and `/users`. Tenant links depend on `tenant_role`; Workspace settings depend on `workspace_role`; platform role does not fabricate membership. Tests use simulated roles/API objects, not real authenticated accounts; no viewer or direct API permission checks are covered. |
| Directory/menu loading, empty, error, retry | **PARTIAL** | `NavigationStatus` distinguishes loading/empty/error with `status` or `alert`, and directory/menu errors have retry. `[]` differs from unverified `null`. However, every dynamic-menu error including 403 is labeled “Workspace 菜单加载失败”; revoked access/context errors are not mapped to the specified recovery state. Generic no-access copy also omits the platform-admin clarification. No UI transition test was run. |
| Stale menu clearing on scope change/revocation | **FAIL** | Scope keys include actor, Tenant, Workspace, and membership version; an effect removes the prior scoped query when scope changes. However, `candidates` comes from `navigation.data` and links are appended independently of `navigation.isError`. If a same-key refetch fails after prior success (including 403), React Query can retain the prior data, leaving old links visible beside the error/retry message. No test covers retained-data/refetch failure. |
| Breadcrumb structure and routing | **FAIL** | `app-header.tsx` has a named breadcrumb `<nav>`, ordered list, hidden separators, and `aria-current=page` final item. Directory-backed Tenant/Workspace names and generic fallbacks are used; Tenant links are omitted for non-members. Required scope ancestors are missing: `/tenants` has no Tenant/Platform parent; `/users` has no Platform parent; `/settings/...` has no Personal parent; `/w/{id}/...` omits “Workspace 工作台” and starts at Tenant. On narrow screens ancestors are only in an `overflow-x-auto` list; no compact ancestor menu exists. No 320/390 browser interaction was run. |
| Bilingual navigation labels | **FAIL** | Sidebar/header maps cover most section/status strings. In TeamSwitcher, the no-selection title and scope hints (`选择工作区`, `仅显示已加入的空间`, `登录后查看空间`) render as raw strings; CommandInput placeholder `搜索空间或租户…` is raw Chinese and has no matching translation entry. These visible labels remain Chinese in English mode. No end-to-end locale pass was run. |
| Mobile 320/390 px contract | **FAIL** | `directory.tsx` uses `Popover`/`PopoverContent`, not a viewport-wide Dialog/Sheet. Width `min(22rem, calc(100vw - 2rem))` is 288 CSS px at 320 px and 352 px at 390 px, anchored to the sidebar rather than viewport-wide. This directly violates the explicit Sheet/Dialog requirement. After selection, `switchTo` closes only the Popover, not the mobile sidebar Drawer/Sheet. No browser screenshots, long-label, scroll, zoom, or touch-target checks were produced. |
| Keyboard and screen reader | **PARTIAL / NOT ACCEPTED** | Radix Popover/cmdk and semantic buttons/links provide basic keyboard primitives; breadcrumbs explicitly mark the current page. But switching does not explicitly move focus to the destination heading or announce the new Tenant/Workspace, and leaves the mobile Drawer open. `NavGroup` passes `isActive` but does not explicitly set `aria-current` on nav links. No keyboard-only flow, focus test, or NVDA/equivalent run was performed. |
| Command entry | **DEFERRED (acceptable for this phase)** | No new command panel was implemented. The UX contract allows this as a separate phase; the existing Search control does not prove a scope-aware command surface. |
| Real service permission/isolation evidence | **NOT VERIFIED** | The focused test uses hard-coded simulated roles and API objects. No live API/browser evidence was obtained for platform admin without TenantMember, tenant member without WorkspaceMember, viewer/admin distinctions, or direct 401/403/404/409 and context-mismatch enforcement. Navigation visibility is not treated as authorization. |

## Exact validation results

Commands were run from `apps/web`:

```text
pnpm exec vitest run --browser.headless src/components/layout/data/sidebar-data.test.ts
```

Result: exit 0; 1 test file passed, 6 tests passed (Vitest 4.1.4, 2.37 s). The suite is explicitly named “simulated roles and API responses”; it does not mount `AppSidebar`/`TeamSwitcher` or exercise the service.

```text
pnpm build
```

Result: exit 1 during `tsc -b` (Vite build did not run):

```text
src/context/font-provider.tsx(36,76): error TS2554: Expected 0-1 arguments, but got 2.
src/context/theme-provider.tsx(39,77): error TS2554: Expected 0-1 arguments, but got 2.
```

These two files are modified in the integrated worktree but outside the navigation implementation scope. No Workspace recovery-file diagnostics appeared in this run; this is not feature acceptance. Other concurrent Workspace recovery changes are present under `src/features/workspaces/`, but were not edited or used as permission evidence. The build is recorded only as a limitation.

## Findings to hand back

1. Replace the mobile switcher Popover with a viewport-wide Dialog/Sheet, close the mobile navigation Drawer after selection, and move/announce focus at the new Workspace heading.
2. Discard retained menu data after failed/revoked requests, map 403/context failures to recovery states, and add a same-scope refetch-failure component test.
3. Restore scope-level breadcrumb ancestors and provide keyboard-accessible access to middle ancestors on small screens.
4. Localize switcher placeholders/hints and test UI/keyboard at 320 and 390 CSS px, including focus, scrolling, long names, empty/error, and screen-reader status.
5. Keep simulated-role tests separate from live API evidence for the global, TenantMember, and WorkspaceMember permission boundaries.

## Limits

No authenticated browser session or server permission fixture was used; viewport, focus, and screen-reader checks remain unperformed. Current `src/features/workspaces/` and `src/context/` files include concurrent changes; this report does not attribute them to the navigation implementation and does not alter them. No unrelated build error was repaired.


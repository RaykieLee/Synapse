# 前端模板与 Clerk 残留清理独立验收

- 验收日期：2026-11-19
- 验收基线：`5fe7dc7`
- 目标：`apps/web` 内 Clerk 删除、Dashboard 模板清理及相关依赖、路由、文案和构建配置。
UX 依据：`docs/ux/frontend-architecture-cleanup-dashboard.md`。本报告只新增验收文档，没有修改产品实现。

## 结论

**部分通过。** Clerk 路由、logo、依赖和 workspace build allowlist 已清理；Dashboard 生产组件已移除 Recent Sales、下载按钮、Reports/Notifications 模板 Tab 和随机业务图表，空态说明数据源尚未配置，页面区块标题及 Tabs 方向也已修正。指定的 Dashboard 浏览器测试、`tsc -b`、前端构建和冻结 lockfile 检查均通过。

仍有两项需要保留在验收记录中：

1. 若“Faker 清零”要求覆盖整个 `apps/web`，该项未通过：`@faker-js/faker` 仍在 package/lock 中，并由任务页的 `src/features/tasks/index.tsx` 导入 `src/features/tasks/data/tasks.ts` 使用。Dashboard 生产组件本身没有 Faker；任务数据文件不在本次分配的产品修改范围内，因此本次仅报告此残留。
2. 主要区块已有 `h2`/`h3`，但 `DashboardEmptyState` 的状态标题仍是普通 `<p>`。UX 审查要求空态标题也参与标题层级；该细项尚未满足或通过测试确认。

页面没有接入 Dashboard 数据 API，且 Dashboard feature 未挂载到正式路由。本次组件测试不代表实际 Workspace 首页或真实数据状态已完成验收。

## 逐项验证记录

以下命令均在指定工作树运行；标注 `apps/web` 的命令以该目录为当前目录。`rg` 无匹配时返回码 `1`，这里代表预期的零命中。

| 检查 | 命令与退出码 | 证据 | 局限 |
| --- | --- | --- | --- |
| UX 基线 | `Get-Content -Raw -Encoding UTF8 docs/ux/frontend-architecture-cleanup-dashboard.md`（仓库根目录），退出码 `0` | 对照数据未接入文案、语义标题、水平 Tabs、导航决策和 UX 验收场景复核。 | UX 文档本身指出 Dashboard 是未挂载模板，不能据此声称正式产品页通过。 |
| 依赖、workspace 与 lock | `git diff HEAD -- apps/web/package.json apps/web/pnpm-workspace.yaml`；`git diff HEAD --stat -- apps/web/pnpm-lock.yaml`，退出码均为 `0` | `@clerk/react`、`recharts` 和 `@clerk/shared` 的 build allowlist 项已删除；workspace 仅保留 `esbuild` allowlist。标准 `build` 脚本仍为 `tsc -b && vite build`，未发现 Clerk 专用 build 脚本。Lock diff 为 2 行新增、356 行删除。 | `@faker-js/faker` 依赖仍在；其他业务功能的依赖清理不属于 Dashboard 组件测试范围。 |
| 冻结 lockfile 一致性 | `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts`（`apps/web`），退出码 `0` | pnpm 11.7.0 返回 `Already up to date`；命令前后 `pnpm-lock.yaml` SHA-256 相同。 | 只验证 manifest 与 lockfile 一致，不验证依赖的运行行为。 |
| Clerk 残留 | `rg -n -i 'clerk|@clerk' src package.json pnpm-workspace.yaml pnpm-lock.yaml`（`apps/web`），退出码 `1`；目标路由/logo 的 `Test-Path` 检查退出码 `0` | 被删的 `src/routes/clerk/**`、`src/assets/clerk-logo.tsx`、`src/assets/clerk-full-logo.tsx` 均不存在；源码、manifest、workspace 和 lockfile 无 Clerk 命中。 | 静态路径与文本检查，不验证外部构建产物或仓库之外的配置。 |
| Dashboard 模板残留 | `rg -n -i 'clerk|faker|@faker-js/faker|recent.?sales|recent-sales|Math\.random\(|recharts|Download|Reports|Notifications|visitor|clicks|sales' src/features/dashboard -g '!*.test.tsx`（`apps/web`），退出码 `1` | `dashboard/index.tsx:29-82` 只渲染 Overview、Analytics 两个 Tab；各区块文案见 `dashboard/components/overview.tsx`、`workspace-activity.tsx`、`analytics.tsx` 和 `analytics-chart.tsx`。`recent-sales.tsx` 已删除；指标用破折号并说明数据尚未接入或数据源未配置。 | 测试文件被排除，因为其中包含旧示例的负向断言。这个结果只覆盖 Dashboard production source；应用其他模块仍有合法下载流程和 Notifications 设置入口。 |
| Faker 全局残留 | `rg -n -i 'faker|@faker-js/faker' src package.json pnpm-lock.yaml`（`apps/web`），退出码 `0` | `package.json:67`、`pnpm-lock.yaml:135` 与 `src/features/tasks/data/tasks.ts:1` 命中；`src/features/tasks/index.tsx:6` 导入任务数据。另有 `src/features/users/data/users.ts:1` 中的 Faker 引用。 | 证明 Dashboard 模块已清理 Faker，但不能宣称整个前端已清零。任务/用户数据模块未纳入本次分配实现范围。 |
| 本地认证与正式导航 | `rg -n -i 'clerk|@clerk|sign-in|sign-up|settings/notifications|features/dashboard|/dashboard' src/routeTree.gen.ts src/routes src/components/layout/data/sidebar-data.ts`（`apps/web`），退出码 `0` | `routeTree.gen.ts:109-120` 保留 `/sign-in`、`/sign-up`，并包含 `/settings/notifications`；对应认证路由源码存在。`sidebar-data.ts` 仍定义租户、用户和设置导航。该 route tree 没有 Clerk 或 Dashboard feature route。 | 只核对源码和生成路由表，没有从浏览器实际登录或点击导航；Notifications 设置是正式设置页面，不是已删除的 Dashboard 模板 Tab。 |
| Dashboard focused browser test | `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`（`apps/web`），退出码 `0` | Vitest 4.1.4 / Chromium：1 个测试文件、1 个测试通过。`dashboard/index.test.tsx:14-129` 断言页面级 `h1`、区块 `h2`/`h3`、横向 `aria-orientation`、空态文案、旧示例数据缺失及一次英文到简体中文的切换。 | 测试直接渲染 `Dashboard` 组件，不走正式应用路由；只断言一条中文译文。没有验证 390px、方向键操作、焦点样式或读屏输出。 |
| TypeScript | `pnpm exec tsc -b`（`apps/web`），退出码 `0` | TypeScript project references 编译通过。 | 仅为前端类型检查，不代表运行时 API 或 Workspace 权限行为已验证。 |
| 前端 build | `pnpm build`（`apps/web`），退出码 `0` | `tsc -b && vite build` 成功；Vite 8.0.8 转换 3409 个模块。构建前后 `src/routeTree.gen.ts` SHA-256 相同。 | 这是 `apps/web` 构建证据，不单独证明整个产品完成；未启动生产产物进行端到端检查。 |
| 凭据扫描 | `git diff --no-ext-diff --unified=0 HEAD -- apps/web` 的新增行经 PowerShell 正则扫描，退出码 `0`；修改路径扫描退出码 `0` | 常见 OpenAI/GitHub/AWS/Google/Slack token、PEM 私钥、JWT、Bearer token 和数据库连接串模式命中数为 `0`；新增/修改路径中实际 `.env` 文件数为 `0`。 | 正则扫描只覆盖本次 `apps/web` diff 的新增文本，不是完整 secret scanner；不能排除自定义格式、二进制内容或未覆盖模式。 |

## UX 与语义检查

- `Dashboard`（`index.tsx:26-77`）有单一页面级 `h1`；摘要、概览、动态、分析及 breakdown 有相应 `h2`/`h3`。`DashboardEmptyState`（`components/empty-state.tsx:15-23`）使用 `role="status"`，但其加粗标题仍为 `<p>`，不进入标题导航。针对 UX 审查的“空态标题也参与区块结构”要求，建议实现侧后续补齐并复验。
- Dashboard 中英词条位于 `apps/web/src/lib/i18n.ts:217-239`；focused browser test 实际切换 locale 并验证一条中文空态文案，不能代替逐项双语检查。
- Tabs 代码设置 `orientation='horizontal'`，focused browser test 读到 `aria-orientation="horizontal"`，并通过点击切换 Analytics。点击验证不能替代方向键和读屏验证。
- 空态包含“数据尚未接入”及“尚未配置数据源”的解释，没有伪造指标或要求用户点击不存在的连接入口。真实 API 接入后，pending、合法空结果、未配置、错误和 403/404 仍需按 UX 与 tenancy 契约分别验收。
- 正式设置中的 Notifications、其他模块的 Download 功能仍存在，这是应用功能；本次确认它们没有混入 Dashboard 模板界面。Dashboard feature 本身没有被重新挂入正式 Workspace 导航。

## 明确的验收局限与待办

- 没有在 390px 或更窄视口实测布局、页面级横向溢出、Tabs 滚动与焦点环裁切。
- 没有手动验证 Tab 键/方向键操作、可见焦点状态或真实读屏器的标题层级与 Tabs 方向播报。
- 没有实测浅色/深色主题对比度；focused browser test 只验证组件语义与文案。
- 未连接 Dashboard API；无加载时序、请求失败、合法空结果、403/404、权限提示或 Workspace 切换隔离的运行证据。
- 如验收条件要求整个 `apps/web` 不再有 Faker，应另行安排任务页/用户页 mock 数据的清理或替换，并重新核对依赖与 lockfile。本次验证没有触碰这些实现文件。

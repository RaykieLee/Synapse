# F43 路由清理修复后独立复验

**总体结论：失败。** Clerk 未知深链、兼容别名及四个已移除路由的客户端行为通过；旧模板翻译残留导致清理检查失败。中文 404 的 `<html lang>` 仍为 `en`。

## 依据

- 阅读 `AGENTS.md`、`docs/tenancy-contract.md`、`docs/ux/F43-route-cleanup.md`、`docs/verification/F43-route-cleanup-acceptance.md` 与 `.orca/impl-f43-route-cleanup.spec.md`。
- `docs/development-status.md:36` 记录 `task_a1f9fa471d9d` 增加 Clerk 父路由 NotFound fallback 和测试、移除 Clerk/Faker 依赖及 37 条死文案；实现者报告 2 个聚焦测试文件/11 tests 与 build 通过。本次独立重跑测试，不以 build 代替路由验收。
- 直接核对 `apps/web/src/routes/clerk/route.tsx`、Clerk aliases 与测试、`apps/web/src/routes/(auth)/sign-in-2.tsx`、登录表单/测试、404 组件、`routeTree.gen.ts`、manifest/lock 和翻译目录。工作区含其他在途未提交改动；本 verifier 仅新增本报告。

## 逐项结论

| 检查 | 结论 | 证据与限制 |
| --- | --- | --- |
| 未知嵌套 `/clerk/*` | **通过（UI）** | Ego Lite Chromium，390×844 CSS px。访问 `/clerk/unknown/deep/path?probe=bookmark` 后，中英文均保持路径和查询参数，无登录重定向；渲染单个 `<main>`、`<h1>`、说明和指向 `/` 的可见返回链接。实际点击 `/sign-in` 的语言切换按钮后再进入此路径，文案切成英文。中文状态 `<html lang>` 仍为 `en`。 |
| Clerk aliases 与 `/sign-in-2` | **通过（客户端 replace；真实认证未验）** | 实测 `/clerk` → `/sign-in`；`/clerk/sign-in?redirect=%2Fsettings` 和 `/sign-in-2?redirect=%2Fsettings` → `/sign-in?redirect=%2Fsettings`；`/clerk/sign-up` → `/sign-up`（注册不可用）；未认证 `/clerk/user-management` → `/sign-in?redirect=%2Fusers`。聚焦路由测试逐 alias 调用 memory history `back()` 并回到前项 `/sign-up`；源码均 `replace: true`。有效 `/settings` 登录返回由成功 API mock 验证并使用 replace；`safeRedirectPath` 源码拒绝非站内、`//`、反斜线。本轮没有真实认证或恶意 redirect 的浏览器表单提交。 |
| 四个移除路由 | **通过（UI 范围）** | 浏览器访问 `/tasks`、`/apps`、`/chats`、`/help-center` 均呈现通用应用 404，无演示内容；390px 下 `scrollWidth=390`。聚焦测试另以中文断言 404 标题、`main` 和返回链接。 |
| 包引用与旧模板翻译 | **失败** | `apps/web/package.json`、`apps/web/pnpm-lock.yaml` 和 `apps/web`（排除 `node_modules`）无 `@clerk/react`、`@faker-js/faker`、ClerkProvider 或 Faker 引用；剩余 Clerk 代码是保留 alias 与测试。旧映射仍在 `apps/web/src/components/layout/header-messages.ts:14-17`（应用/聊天/帮助中心/任务）、`apps/web/src/lib/i18n.ts:54,59`（Apps/Chats/Tasks/Help Center），`i18n.ts:244` 仍有 `Connected` 等模板词条。翻译目录外的精确英文文案搜索未找到 `Apps`、`Chats`、`Connected`、`Coming Soon`；旧 Apps/Chats/连接状态项应删除或说明保留原因。帮助中心和任务相关中文另有活跃用途，不应误删。 |
| 聚焦测试/route tree | **通过（可复验项）；受限** | 聚焦 Vitest 2 files/11 tests 通过。静态比较有 55 个路由源文件、55 个生成 import，缺失/孤立均为 0；无四个已移除根路径。`tsr` CLI 未安装，未能重新生成 routeTree；静态核对不是生成差异证明。 |

## 验证命令与结果

- `pnpm --dir apps/web exec vitest run --browser.headless src/routes/clerk/-route.test.tsx src/features/auth/sign-in/components/user-auth-form.test.tsx`：通过，2 files / 11 tests；非阻断 warning：`AuthenticatedHome` route export 不会 code-split。
- `pnpm --dir apps/web dev -- --host 127.0.0.1 --port 5188 --strictPort`：5188 已占用，未终止占用者。使用 `pnpm --dir apps/web dev -- --host 127.0.0.1 --port 5191 --strictPort` 进行浏览器检查，完成后停止进程。
- 浏览器：Ego Lite Chromium；CDP `Emulation.setDeviceMetricsOverride` 设置 390×844、`deviceScaleFactor=1`、`mobile=true`；本地 URL `http://127.0.0.1:5191`。先设 `localStorage['synapse-locale']='zh-CN'` 并重载，再从 `/sign-in` 点击 `.login-header-actions button[title]` 切英语；逐条检查未知深链、四旧路径和五个 aliases。读取 URL/search、`html.lang`、`main`/`h1`、返回链接、页面文字及 `scrollWidth`。这是 Vite 本地客户端/UI 证据，不是生产 HTTP 状态。
- `pnpm --dir apps/web exec tsr --help`：失败，`tsr is not recognized` / `Command tsr not found`。
- Package scan：`rg -n -i '@clerk/react|@faker-js/faker|clerkprovider|\bfaker\b|faker-js' apps/web -g '!node_modules/**'`，无匹配。旧文案 scan：`rg -n -w -F -e Apps -e Chats -e Connected -e 'Coming Soon' apps/web/src -g '*.ts' -g '*.tsx' -g '!**/lib/i18n.ts' -g '!**/components/layout/header-messages.ts' -g '!**/components/layout/sidebar-messages.ts'`，翻译目录外无精确英文文案匹配。routeTree 搜索四个已移除根级 `fullPath`，无匹配。
- 静态 route-tree 对照：筛掉 `*.test.ts[x]` 后递归列 `apps/web/src/routes`，移除扩展名；以正则 `\./routes/([^']+)` 提取 `apps/web/src/routeTree.gen.ts` imports 并集合比较。结果：源 55、import 55、missing 0、extra 0。

## 待补证据与阻断项

- **修复阻断：** 清理未引用旧模板翻译/面包屑，或提交可核实的保留用途，再安排独立复验；本 verifier 未改实现。
- **无障碍：** 中文 404 的 `<html lang>` 错误；未用 NVDA/VoiceOver，也未全量测键盘焦点、320px、真实设备、缩放或高对比度。
- **认证/权限：** `restoreSession` 和登录 API 使用 mock；没有真实账号、service-auth、租户/Workspace 授权证据。前端路由不证明服务端授权。
- **生产/部署：** 未核实生产深链 GET 状态、缓存或服务器重定向；Vite SPA fallback 不作为生产 HTTP 证据，无部署验收。
- **来源/许可：** 未做逐文件来源、许可证边界或法律审计；LICENSE 和来源记录存在不等于审计通过。未独立重跑 build。


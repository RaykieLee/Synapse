# F43 路由清理二次修复：独立复验

**总体结论：通过（限本次聚焦复验）。** 先前失败的死模板翻译键及中文 `document.documentElement.lang` 问题已修复；未知嵌套 Clerk 路径、兼容别名和四个移除路径的客户端行为通过。本报告不构成完整 F43、生产、服务端权限或无障碍验收。

## 范围与依据

- 阅读 `AGENTS.md`、`docs/tenancy-contract.md`、`docs/ux/F43-route-cleanup.md`、先前两份报告 `docs/verification/F43-route-cleanup-acceptance.md` 与 `docs/verification/F43-route-cleanup-reacceptance.md`，并核对 `docs/development-status.md` 的 F43 状态。
- 二次修复 `task_4371bdcd75be` 的结果/files：`apps/web/src/components/layout/header-messages.ts`、`apps/web/src/lib/i18n.ts`、`apps/web/src/components/language-switch.tsx`、`apps/web/src/lib/i18n.test.ts`、`apps/web/src/routes/clerk/-route.test.tsx`。回执记录聚焦 Chromium/Vitest **3 files / 18 tests passed**。修复任务 build 被无关 TypeScript 错误阻断，位置 `apps/web/src/context/font-provider.tsx:36` 与 `apps/web/src/context/theme-provider.tsx:39`；本 verifier 未重跑 build，也没有改产品代码。
- 遵循 `docs/tenancy-contract.md`：只核验客户端路由/UI，不将重定向、菜单或 mock 会话作为全局账号、TenantMember、WorkspaceMember 或服务端授权证据。

## 逐项结果

| 检查 | 结论与证据 | 模拟与限制 |
| --- | --- | --- |
| 删除文案无引用，保留文案有活跃用途 | **通过。** TypeScript AST 对照修复前暂存快照（`git show :<path>`）与当前工作树：`i18n.ts` 删除 43 个映射键，`header-messages.ts` 删除 2 个键，共 45 项、43 个不同键。扫描 `apps/web/src` 中 299 个生产 `.ts/.tsx` 文件（排除测试/规格及两个映射定义文件）的字符串字面量与 JSX 文本后，删除键活跃引用数为 0。保留值改名 `工作台: Workspace` → `工作台: Workbench`：`工作台` 仍用于首页（`routes/_authenticated/index.tsx:196,215,303`），`Workspace` 仍用于团队空间标题（`features/workspaces/teams-page.tsx:426`）。保留的“帮助中心”用于登录按钮（`features/auth/sign-in/index.tsx:55`），“任务”用于计划任务表头及团队任务摘要（`features/tenants/scheduled-tasks-page.tsx:210`、`features/workspaces/teams-page.tsx:532`）。旧 `Apps`、`Chats`、`Connected`、`Connect`、`Coming Soon`、`Coming Soon!` 键在 `i18n.ts`/`header-messages.ts` 均无映射；`i18n.test.ts:10-16` 中旧词仅为原文回退测试。 | 扫描是源码引用检查，不等同运行时用户行为统计。 |
| locale 与 document language 同步，含挂载前恢复 | **通过。** `lib/i18n.ts:10-34` 初始化读取 `synapse-locale` 并同步 `document.documentElement.lang`；`setLocale` 每次写入并同步，`syncLocaleFromStorage` 从存储恢复。`language-switch.tsx:9` 用 `useLayoutEffect` 同步。`i18n.test.ts:35-60` 双向覆盖 zh-CN/en 与即时切换；`clerk/-route.test.tsx:70-80` 覆盖语言组件挂载前恢复中文。Chromium 未知 Clerk 404 两种语言的 `lang` 均与文案一致。 | 本地浏览器检查，不是生产 UI。 |
| 未知嵌套 `/clerk/*` 应用级双语 404 与导航 | **通过（客户端/UI）。** `routes/clerk/route.tsx:4-6` 指定 `NotFoundError`；`features/errors/not-found-error.tsx:8-26` 渲染 `<main>`、`<h1>`、说明、返回按钮及指向 `/` 的工作台链接。Playwright MCP Chromium 打开 `/clerk/unknown/deep/path?probe=bookmark`，中文及英文刷新后保留路径/查询，显示正确标题、说明、`lang` 和链接；测试另断言英文标题、main、链接（`clerk/-route.test.tsx:82-100`）。 | 匿名本地环境曾向 `/api/v1/auth/me` 收到 401；不代表认证或权限结果。 |
| Clerk aliases、`/sign-in-2` 与安全 redirect | **通过（客户端行为）。** 测试覆盖 `/clerk`、`/clerk/sign-in`、`/clerk/sign-up`、`/clerk/user-management`、`/sign-in-2` 的 replace 目的地、查询参数及后退行为（`clerk/-route.test.tsx:37-67,121-139`）。浏览器 `/sign-in-2?redirect=%2Fsettings` 与重试后的 `/clerk/sign-in?redirect=%2Fsettings` 均到 `/sign-in?redirect=%2Fsettings`。`safeRedirectPath` 源码（`user-auth-form.tsx:58-68`）拒绝非 `/` 开头、`//` 与反斜线并回退 `/`；登录成功 replace（第 116 行），表单测试验证有效 `/settings`（`user-auth-form.test.tsx:128-155`）。 | 未以真实账号提交恶意 redirect；负向语义为源码核对，登录 API 用 mock。首次浏览器 alias 导航遇 `ERR_INSUFFICIENT_RESOURCES`，同目标重试通过。 |
| 四个移除的 demo 路由 | **通过（客户端/UI）。** Chromium 逐条打开 `/tasks`、`/apps`、`/chats`、`/help-center`，均显示单个 `<main>` 中文应用 404、标题“页面不存在或已移除”，返回工作台链接 `href=/` 可用且无 demo 内容；测试逐路径断言同类结果（`clerk/-route.test.tsx:102-120`）。 | 本地 SPA 客户端结果，不是生产 HTTP status。 |
| routeTree/source 一致性 | **通过（静态对照，受限）。** 递归列出 `apps/web/src/routes` 非测试 `.ts/.tsx` 文件（剥除扩展名），与 `routeTree.gen.ts` 的 `./routes/...` imports 集合比较：source 55、imports 55、missing 0、orphan 0、重复 0；四个退役路由源文件和 root `fullPath` 项均为 0。 | 未运行 TanStack 生成器；静态集合对照不证明重新生成字节级相同。 |

## 测试、扫描与浏览器记录

- 聚焦命令：`pnpm --dir apps/web exec vitest run --browser.headless src/routes/clerk/-route.test.tsx src/features/auth/sign-in/components/user-auth-form.test.tsx src/lib/i18n.test.ts`；沿用已完成结果 **3 files / 18 tests passed**，遵从协调者要求未重跑。首次 Chromium 启动时测试端口 `63315–63317` 占用；重试通过。
- 死键重复扫描使用项目本地 TypeScript parser（`apps/web/node_modules/typescript`），比较暂存映射快照与工作树 AST，扫描 299 个生产文件的字符串字面量/JSX 文本：45 个删除项、43 个不同键、删除键引用 0、旧模板映射键 0。
- routeTree 重复扫描以文件路径集合对比生成 imports：55/55，missing/orphan/duplicate 均为 0，四个退役路径源文件与 `fullPath` 条目均为 0。
- 手动浏览器服务：`pnpm --dir apps/web exec vite --host 127.0.0.1 --port 5337 --strictPort`；Vite 8.0.8，Playwright MCP Chromium 隔离上下文。检查未知 Clerk 深链、locale/lang、四旧路径及 alias。`AuthenticatedHome` code-split 警告、匿名 `/api/v1/auth/me` 401 不作为通过依据；这是本地客户端证据。

## 限制与未验收项

- 未验证生产深链 GET 状态、HTTP 301/302、部署缓存、真实认证、服务端租户/Workspace 授权或部署行为；Vite 响应不代表生产 HTTP 证据。
- 浏览器匿名，登录/会话测试使用 mock；未提交真实凭据。不得据此推断租户/Workspace 服务端隔离符合 tenancy contract。
- 未用 NVDA/VoiceOver 等读屏软件，也未完成缩放、高对比度、真实移动设备或完整键盘验收；DOM/Chromium 检查不等于完整 WCAG 验收。
- 本 verifier 未重跑 build、许可证/来源逐文件审查或部署；修复任务记录的 build 阻断是另行处理项。本结论不表示完整 F43 或产品整体已完成。

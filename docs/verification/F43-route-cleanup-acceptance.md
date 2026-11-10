# F43 演示与模板路由清理：独立验收

**结论：未通过，需修复后复验。** 未知 `/clerk/*` 实际显示 TanStack 默认纯文本 `Not Found`，缺少契约要求的应用级双语 404、语义标题和返回入口。四个旧演示入口显示应用级 404；模板依赖/词条仍有残留，routeTree 只做静态核对，生产深链状态及实际读屏软件未验证。

## 方法与环境

- 依据：`AGENTS.md`、`docs/tenancy-contract.md`、`docs/ux/F43-route-cleanup.md`、`docs/development-status.md` F43；实现回执 `ctx_5e1b8acea403`。
- 本机 Playwright 1.59.1 / headless Chromium：在 Vite preview `127.0.0.1:4173` 测 320×800、390×800；在开发端口 `5173` 对照未知 Clerk 路由。旧认证页面检查通过拦截 `/api/v1/auth/me` 返回测试用户来模拟登录；不是实账号、真实认证或后端授权验证。
- 本地 GET 深链在 `5173`、`4173` 均返回 `200 text/html`，属 SPA fallback 返回应用壳；这不是客户端路由结果，也不代表生产 HTTP 状态或 HTTP 重定向。
- `pnpm test -- src/context/search-provider.test.tsx src/features/auth/sign-in/components/user-auth-form.test.tsx`：2 个文件、12 项通过。测试通过不替代路由、真实认证或生产部署验收。

## 逐项结果

| 项目 | 结果与证据 | 模拟项及局限 |
| --- | --- | --- |
| `/tasks`、`/apps`、`/chats`、`/help-center` | **通过（UI 范围）。** 在 preview 上用模拟认证访问四条路径；320×800、390×800 均显示中文应用 404：单一 `<main>`、`<h1>`、说明及返回操作，无旧模板内容；`scrollWidth` 等于视口宽度。设置 `synapse-locale=en` 后，标题、说明、操作切为英文。 | 模拟 `/api/v1/auth/me`；不证明真实认证、API 或服务端成员授权。未用读屏软件。 |
| 正式导航不可达 | **通过（静态核对）。** `sidebar-data.ts` 仅有正式平台管理/个人设置；`command-menu.tsx` 从同一数据生成；`app-header.tsx` 无四旧段名映射；`routeTree.gen.ts` 无四旧路径节点，旧页面与路由源文件已移除。 | 不穷举运行时外链/未来动态菜单；直接输入旧 URL 仍可显示应用 404。 |
| 五个兼容别名 | **通过（客户端行为）。** `/clerk` → `/sign-in`；`/clerk/sign-in?redirect=%2Fsettings` 与 `/sign-in-2?redirect=%2Fsettings` → `/sign-in?redirect=%2Fsettings`；`/clerk/sign-up` → `/sign-up`（显示正式“注册不可用”状态）；未认证 `/clerk/user-management` → `/sign-in?redirect=%2Fusers`。源码均 `replace: true`；浏览器返回到先前 `/sign-in?probe=before`，未回到别名。 | 客户端跳转，不是 HTTP 301/302；未认证到 `/users` 不证明服务端授权。 |
| redirect 安全 | **通过（限模拟）。** 有效 `/settings` 目标经 Clerk 与 `/sign-in-2` 别名保留；登录表单测试确认有效目标以 replace 导航。`safeRedirectPath` 拒绝非 `/` 开头、`//` 和含反斜线目标；浏览器模拟登录记录显示 `https://evil.example`、`//evil.example`、反斜线均回退本机 `/`。 | 模拟登录/API 响应；未验真实身份认证、服务端重定向或部署代理行为。 |
| 普通用户走用户管理别名 | **客户端守卫通过，权限待服务端验收。** 模拟普通用户最终到 `/403`；正式 `/users` 客户端按 `platform_role` 守卫。 | 未请求真实用户管理 API，不能证明服务端拒绝普通用户、租户管理员或 Workspace owner；权限语义以 `docs/tenancy-contract.md` 为准。 |
| 未知 `/clerk/*` | **未通过，阻断。** 浏览器打开 `/clerk/unknown` 停留原路径，只见 `Not Found`（开发端另有 `- TanStack Router`）；无 `<main>`、`<h1>`、双语说明或返回入口。 | 不符合应用 404 契约；`/clerk/foo/bar` 本地 GET 只能证明 SPA shell。需修复后复验；本报告不改实现。 |
| routeTree 一致性 | **部分通过。** 生成文件含 Clerk index/别名且删除四旧节点，和已检查源文件相符。 | 只做静态对照；未跑生成器，未核对全部路由导入。无独立 route-generate 脚本；构建通过不视为路由验收。 |
| Faker/样例/Clerk 清理 | **部分通过，存在残留。** 源码无 Faker 导入、Clerk Provider/UI 引用；旧样例页/路由已删。 | `apps/web/package.json` 和 `apps/web/pnpm-lock.yaml` 仍列 `@faker-js/faker`、`@clerk/react`；`apps/web/src/lib/i18n.ts` 仍有 Tasks/Apps/Chats/Help Center、Connected、Coming Soon 等模板词条。用途待实现方确认。 |
| 窄屏、键盘、可访问性 | **有限通过。** 320、390 下无横向溢出；Tab 顺序为“返回上一页”按钮、再到“返回工作台”链接，聚焦截图可见焦点环；一处 `<main>`、一处 `<h1>`，链接指向 `/`。 | 未验真实设备、缩放/高对比或 NVDA/VoiceOver。中文 404 时 `html lang` 仍为 `en`；英文链接名称为 “Back to dashboard”，与 UX 示例 “Go to the workspace home” 不完全一致。 |
| 来源与许可证 | **部分通过。** `apps/web/LICENSE` 保留 MIT License 与 2024 Sat Naing 版权头；`docs/source-provenance.md` 记录 shadcn-admin 来源提交及许可证保留说明。 | 仅检查文件/来源记录；未做逐文件许可证边界、依赖许可清单或法律审计。 |
| HTTP 深链 | **本地已查，生产未验证。** 直接 GET `/tasks`、`/apps`、`/chats`、`/help-center`、五个别名及 `/clerk/unknown`、`/clerk/foo/bar`，两端口均 `200 text/html`。 | 两端口均是 Vite SPA fallback。没有生产域名/托管环境可直接 GET；生产状态码、缓存及服务器重定向未验证。 |

## 待修复与复验

1. **阻断：** 未知 `/clerk/*` 应渲染与其他路径一致的应用级双语 `NotFoundError`，含语义标题和键盘可访问返回入口；重测未知深链及五个兼容别名。
2. 说明或清理残留 Clerk/Faker 依赖、旧模板词条，并复查有效引用。
3. 用可重复 routeTree 生成/差异命令完整核验路由树与路由源文件，不以 build 通过代替。
4. 实测中文 404 的读屏语言；补生产深链 GET 与最终浏览器状态证据，并标注真实认证/服务端授权可用性。
5. 补全来源/许可证边界检查。

本次仅新增本报告；未修改产品实现、配置、测试或其他文档。

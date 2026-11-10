# F43 演示与模板路由清理：UX 审查与实施契约

状态：独立 UX/契约审查完成；本文件为待实施方案，不代表路由已清理或独立验收通过。范围仅为旧演示入口和模板数据；不改变正式租户、Workspace、全局用户、个人设置及认证功能。

## 设计原则

- 不在正式导航中呈现无真实业务契约的模板页。侧栏隐藏不代表不可达：地址栏、旧书签、外部链接、命令菜单或程序跳转仍可能直达。
- 正式认证入口是 Synapse `/sign-in`。`/clerk/*` 属于独立 Clerk 模板；Clerk 登录态不能代替全局账号、租户成员或 Workspace 成员资格。
- 菜单显隐、重定向和客户端守卫均不授予权限。租户/Workspace 权限由服务端按可信上下文校验；全局用户管理仍要求 `platform_admin`。
- Faker、JSON 样例及硬编码集成状态都是**模拟内容**，不是当前用户数据或真实服务状态。不得包装成真实数据或已连接能力。
- 无语义等价的正式目的地时显示应用内 404；不把没有租户/Workspace 上下文的旧列表映射到任一具体租户或空间。

## 路由处置决策

| 路由 | 现况与可达性 | 决策与可达性 | 权限/归属语义 | 状态与中英文反馈 |
| --- | --- | --- | --- | --- |
| `/tasks` | 路由在 `_authenticated` 下，登录后可直接输入 URL；组件消费 Faker seeded 数据生成 100 条样例任务，表格编辑/导入/删除是局部模板交互。没有租户/Workspace 归属。 | **移除路由与模板任务页**；旧链接显示 404。不重定向到租户计划任务或空间调度，因为它们的业务、归属及权限不同。 | Synapse 登录不等于租户或空间成员授权。此演示页不得读写租户/空间 API。正式租户任务为 `/tenants/:tenantId/scheduled-tasks`；空间调度为 `/w/:workspaceId/schedule`，各自执行成员/权限校验。 | 应用 404：“此页面不存在或已移除。返回工作台。” / “This page doesn’t exist or has been removed. Go to the workspace home.” 不使用 405 代表旧页面不存在。 |
| `/apps` | 登录后可直达；集成列表与 `connected: true` 状态为硬编码；“Connect”无真实连接契约。 | **移除路由及模板应用目录**；旧链接 404。不重定向到 MCP、渠道或凭据页（并非同一能力）。 | 假状态不表示当前个人凭据或租户/空间共享配置。不得读取或泄露个人凭据。未来集成须另定数据归属及授权。 | 应用 404；同上双语文案，不显示“已连接 / Connected”等假状态。 |
| `/chats` | 登录后可直达；页面加载 `features/chats/data/convo.json` 样例对话并提供模板发消息交互，不含 Workspace 参数。 | **移除通用聊天演示页及路由**；旧链接 404。正式聊天仅为 `/w/:workspaceId/chat`，无上下文时不跳入某个空间。 | 样例不是个人、租户或 Workspace 历史。正式会话须由服务端验证当前账号、租户、Workspace 与动作权限。 | 应用 404；同上双语文案；不显示样例对话，也不以 403 暗示资源存在。 |
| `/help-center` | 登录后可直达；只显示 `ComingSoon` 模板，无正式导航入口。 | **移除空壳路由**；当前没有已确认帮助内容目标，旧链接 404，不跳首页或无依据外链。未来内容另定可达性与来源。 | 不需租户/Workspace 权限，不显示虚构帮助内容。 | 应用 404；不显示“即将推出 / Coming Soon”。 |
| `/clerk` | 独立路由，不受通用 `_authenticated` 的 `restoreSession` 约束。缺 publishable key 时显示 `.env` 教程；配置时挂载 ClerkProvider。 | **重定向到 `/sign-in`**，replace 历史项；不启动 Clerk 或展示其配置指南。 | 只使用 Synapse 全局账号认证。Clerk provider/session 不构成 Synapse 登录或租户/空间授权。 | 客户端路由重定向，不声称 HTTP 301/302；目标由正式认证状态处理。 |
| `/clerk/sign-in` | Clerk SignIn 模板预填邮箱，匿名可直达；依赖 Clerk provider/key。 | **重定向到 `/sign-in`** 并 replace；不显示预填邮箱或 Clerk UI。 | 仅沿用 `/sign-in` 已接受且经现有安全逻辑验证的站内 `redirect`。外站、协议相对地址、反斜线等开放重定向输入必须拒绝。 | 客户端路由重定向；后续服从正式登录流程。 |
| `/clerk/sign-up` | Clerk SignUp，匿名可直达，身份提供方与正式注册不同。 | **重定向到 `/sign-up`** 并 replace；移除 Clerk 组件。 | 仅走 Synapse 注册并创建全局账号；不自动建立租户/Workspace 成员关系。注册开放状态服从正式 `/sign-up`。 | 客户端重定向；正式注册不可用时显示原有不可用反馈，不回退 Clerk。 |
| `/clerk/user-management` | Clerk 认证路由内的用户管理模板；登录成功使用 `features/users/data/users.ts` 的 Faker 数据；未登录显示 Clerk 引导/计时跳转。可直达。 | **重定向到正式 `/users`** 并 replace；移除 Clerk/Faker 副本，保留旧链接兼容别名。 | `/users` 继续由正式路由要求 `platform_admin`，用户 API 由服务端授权。租户 owner/admin、Workspace owner 或 Clerk 用户不因此获得平台权限。此处为全局账号而非成员列表。 | 重定向后正式 `/users` 守卫决定：非平台管理员 403；未认证遵循父路由转 `/sign-in`。Clerk 会话不得绕过。 |
| `/sign-in-2` | 公开路由已把 `redirect` 搜索参数送到 `/sign-in`，无独立 UI/数据；仍注册且匿名可达。 | **保留为兼容重定向别名**，router replace 到 `/sign-in`；不进入导航、不承担独立 UI。兼容期结束且旧链接情况已核实后再决定删除。 | 与 `/sign-in` 一致，参数交由正式登录页既有安全站内跳转逻辑检查。 | 客户端路由重定向，非 HTTP 301/302；非法目标留在正式登录流程。 |
| 未知 `/clerk/*` | Clerk 父路由有认证和用户管理子路由，其他段依赖 Router 未匹配处理。 | 明确别名外路径**不可用**并进入通用 404；不将任意路径重定向到登录页。 | 不探测 Clerk/Synapse 身份，不泄露租户/账号存在性。 | 应用 404。 |

### HTTP 与 SPA 状态界线

上述是浏览器 SPA/TanStack Router 行为：移除路径渲染根路由 `NotFoundError`；兼容路径由客户端 router 重定向并替换历史项。这不证明 HTTP 响应为 404/3xx。当前未从源码确认 SSR/托管规则；部署需另验直接打开深链的 HTTP status。405 是服务器对不允许的 HTTP 方法响应，不是未知页面的替代状态；本组是 UI 路由，不定义 POST/PUT/PATCH/DELETE API。若部署同路径服务器端方法端点，由服务端按 method 返回 405。不得以 HTTP 200 空白、403 或永久 loading 替代应用级移除 404。

## 导航、错误状态与响应式

- `sidebarData` 当前已不含这些入口，不重新加入侧栏、首页、租户或 Workspace 动态菜单。命令菜单基于 `sidebarData`，继续只列正式入口；另核查旧测试/其他命令列表中的 `/tasks` 静态断言。书签、地址栏仍按表处理。
- `app-header.tsx` 仍将 `apps`、`chats`、`help-center`、`tasks` 映射成正式标题；移除此类模板段名识别。404 显示错误上下文，不显示可点击模板面包屑；`/clerk/*` 不出现租户或 Workspace 面包屑。
- 移除导入、假连接、Faker CRUD、Clerk 计时自动跳转等交互；不能把局部状态变更伪装成持久化成功，也不应先闪现 Clerk/Faker 页面再导航。
- 404 提供可聚焦标题和语义化“返回工作台”链接到 `/`，有可见焦点、键盘支持和读屏可感知标题。窄屏说明和操作完整可见，不依赖 hover 或超宽表格。重定向不得用倒计时抢焦点或强制自动跳转。

| 状态 | 中文 | English |
| --- | --- | --- |
| 移除页标题 | 页面不存在或已移除 | Page not found or removed |
| 移除页说明 | 此页面不存在或已移除。你可以返回工作台，或从正式导航打开当前账号可访问的功能。 | This page doesn’t exist or has been removed. Return to the workspace home or open an available feature from the product navigation. |
| 返回操作 | 返回工作台 | Go to workspace home |
| `/clerk/user-management` 权限拒绝（复用正式状态） | 当前账号没有平台用户管理权限。 | This account cannot manage platform users. |
| 可见跳转状态（仅确有等待时） | 正在前往 Synapse 登录页… | Redirecting to Synapse sign-in… |

即时重定向无需提示。若可见异步等待，辅助提示用 `role=status`/`aria-live=polite`。中英文切换无中文残留；不得强制计时跳转。

## 最小实现文件范围

本 UX 工作只新增本文档，不授权产品实现。后续实现建议限定于下列文件；按决策选保留的兼容路由，不机械扩大范围：

1. 路由：`apps/web/src/routes/_authenticated/{tasks,apps,chats,help-center}/index.tsx`、`apps/web/src/routes/clerk/route.tsx`、`apps/web/src/routes/clerk/(auth)/{route,sign-in,sign-up}.tsx`、`apps/web/src/routes/clerk/_authenticated/{route,user-management}.tsx`；审查并保留 `apps/web/src/routes/(auth)/sign-in-2.tsx`。变更后运行 TanStack Router 生成器，禁止手改生成树。
2. 模板数据：移除已无正式入口引用的 `apps/web/src/features/{tasks,apps,chats}`。`apps/web/src/features/users/data/users.ts` 当前由 Clerk 页面引用，删除前复查引用。不可误删正式 `features/users/index.tsx`、`/w/:workspaceId/chat` 或租户计划任务。
3. 共用 UI：`apps/web/src/components/layout/app-header.tsx` 清理面包屑；检查 `apps/web/src/components/command-menu.tsx` 与相关测试；根 404/i18n 提供双语和无障碍操作。`sidebar-data.ts` 当前没有旧路径，不应无故改写。
4. 依赖/许可证：仅当 Clerk 路由已删除且全仓引用扫描确认后，才评估 `@clerk/react`、Clerk logo 等是否可删并更新包/锁文件。始终保留 `apps/web/LICENSE`、`docs/source-provenance.md` 和上游来源/许可证信息，不删除保留代码所需版权文本。
5. `apps/web/src/routeTree.gen.ts` 由 TanStack Router 自动维护；生成后确认无被删路由导入、fullPath/type 残留。保留的兼容文件路由仍须出现在生成树。

不需要 API、数据库、租户迁移或新认证提供方契约；不引入另一套 AI/API 服务。

## 验收条件

1. **所有入口：** 匿名和登录态逐条打开 `/tasks`、`/apps`、`/chats`、`/help-center`、`/clerk`、`/clerk/sign-in`、`/clerk/sign-up`、`/clerk/user-management`、`/sign-in-2` 和未知 `/clerk/*`；刷新、复制直达均符合表中决策；导航与命令菜单无已移除模板。
2. **正式权限不回归：** `/sign-in`、`/sign-up` 遵循 Synapse 现状；`/users` 仅平台管理员可管理，普通账号被拒；`/tenants/:tenantId/scheduled-tasks` 与 `/w/:workspaceId/chat` 分别验证正确租户/空间成员关系、上下文和资源动作权限。切换上下文、撤销成员后不能复用旧缓存/历史 Clerk 会话。
3. **无模拟误导：** 页面不出现 Faker 任务、硬编码 connected、样例对话、Clerk 预填邮箱/配置指引或假用户 CRUD；不触发演示写 API。失败页不泄露资源存在性。若开发示例保留，须与生产路由隔离并明确标注“模拟 / Demo data”。
4. **重定向安全：** `/sign-in-2?redirect=%2Fsettings` 遵循当前站内跳转；外站 URL、`//host`、反斜线不能离站。Clerk 登录别名进入 Synapse；用户管理别名最终经过 `/users` 守卫。返回键不形成重定向循环。
5. **状态/协议：** SPA 移除路径呈现可感知 404，而非空白、堆栈、假 403 或永久 loading。部署验收分开记录直达 GET 的 HTTP status 与应用 UI；只对确实存在的服务器方法端点测试 405。重定向记录 router replace/query 行为。
6. **移动端/可访问性：** 320/390 CSS px 无横向溢出；键盘能聚焦标题/操作并看到焦点，返回链接名称明确、顺序合理；重定向不抢焦点；读屏识别标题和可选等待状态。验证中英文、放大及减少动态效果偏好。
7. **范围/来源：** 修改仅限清理所需路由、共用界面、模板数据与相关配置；许可证/来源仍可查；正式全局用户、个人设置、租户与 Workspace 动态菜单未被删。

## 负面清单

- 不把演示路径加回正式侧栏、命令菜单、首页或租户/Workspace 动态菜单；不以“入口隐藏但路由仍显示 Faker”冒充清理。
- 不把 `/tasks` 指向租户任务/空间调度；不把 `/chats` 指向未知空间；不把 `/apps` 指向 MCP/渠道/凭据；不把帮助页转去无依据外链。
- 不将 Clerk session/role 当作 Synapse User、TenantMember、WorkspaceMember 或 `platform_admin`；不以菜单、前端守卫、重定向或 404 决策替代服务端授权。
- 不用假 API、伪 connected 状态、样例记录或只改本地状态却显示成功的 CRUD/导入交互。
- 不用 HTTP 200 空白表示成功，不用 405 代表未知路由，不把所有缺失页改成 403；正式资源仍按租户契约返回稳定错误。
- 不删除 `apps/web/LICENSE`、来源注记或保留代码版权文本；不复制真实 `.env`、运行数据库、密钥、上游 `.git` 或 `node_modules`。

## 证据与局限

- 已审阅 `AGENTS.md`、`docs/tenancy-contract.md` 的身份/角色、作用域、URL 上下文、Problem 错误、缓存与硬约束；`docs/tenant-optimization-principles-and-gap-review.md` 第 2、3、7 节；`docs/development-status.md` F43/F44。身份和隔离判断以 tenancy-contract 为唯一权威。
- `apps/web/src/routes` 和 `apps/web/src/routeTree.gen.ts` 证明旧路由已注册；`routes/_authenticated/route.tsx` 为任务/应用/聊天/帮助恢复 Synapse session；Clerk 父路由使用可选 key/`ClerkProvider`，子路由分别为 Clerk 登录、注册与用户管理。
- 数据证据：`features/tasks/data/tasks.ts` 用 seeded Faker 生成 100 条；`features/apps/data/apps.tsx` 硬编码集成及连接布尔值；`features/chats/index.tsx` 加载 `data/convo.json` 且注明 Fake Data；Clerk user-management 引用 Faker `features/users/data/users.ts`。正式 `/users` 具有 `platform_admin` 客户端守卫并调用正式 API，但前端守卫不替代服务端授权。
- 导航证据：`components/layout/data/sidebar-data.ts` 现仅列租户/用户、个人设置；Workspace 菜单由 `app-sidebar.tsx` 动态构造；`command-menu.tsx` 消费 `sidebarData`；`app-header.tsx` 仍把 apps/chats/help-center/tasks 映射为面包屑标题。
- 来源证据：`apps/web/LICENSE` 保留 shadcn-admin MIT 文本；`docs/source-provenance.md` 记录上游来源/许可证保留规则。F43 称旧演示路由及许可范围待处理；F44 是独立首页指标任务。
- 局限：这是源码静态审查，不是浏览器/HTTP 部署验证；未证实生产深链 HTTP status、旧外链流量、Clerk key 是否已配置、真实服务端权限行为或上游素材逐文件许可证边界。实施和独立验收须补证。本文件不宣告路由已删除、依赖可删或许可证审计完成。

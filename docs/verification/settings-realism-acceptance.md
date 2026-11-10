# 个人设置真实性第一阶段独立验收

验收日期：2026-11-09  
范围：`docs/ux/settings-realism.md`；仅记录验收，未修改产品代码、测试、配置或其他文档。

## 总结

**结论：部分通过，第一阶段尚不能整体验收通过。** Display/Notifications 的只读状态和路由登记通过当前组件测试与代码检查。Profile/Account 的接口归属及密码会话处理与当前 API 源码一致，但只有模拟 API 证据；Profile 在 401 时存在清空草稿的代码路径。Appearance 的选项、浏览器本地边界及正常写 Cookie 路径符合契约，但 Cookie 读写异常路径不可靠。真实资料/密码持久化、跨浏览器隔离及完整窄屏/键盘/读屏验证待验收。

## 验收依据与边界

- 已阅读 `AGENTS.md`、`docs/tenancy-contract.md`、`docs/tenant-optimization-principles-and-gap-review.md` 第 2、3、7 节及 `docs/ux/settings-realism.md`。遵循全局 User 资料/凭据独立于 Tenant/Workspace、服务端按当前认证账号执行读写、浏览器偏好不是账号持久化、逐项独立验收的约束。
- 指定实现任务 `task_5218d663b308` 的独立 receipt 未在仓库文件中找到；当前可读到 `.orca/impl-settings-realism.spec.md` 的任务范围和 `docs/development-status.md:41` 的实现摘要，但这不等同于完整 receipt。摘要称实现者报告测试 9/9、曾有一次 build 成功、随后 build 在并行 sidebar 导航改动中失败；本报告以本轮独立命令为当前证据。
- 本轮未登录生产账号、未使用真实凭据/个人数据、未请求真实后端；后端仅以源码核对。Vitest 使用模拟 API，不能证明数据库提交、重新登录读回或真实会话撤销。

## 逐项检查

| 验收项 | 结论 | 证据与局限 |
| --- | --- | --- |
| Display / Notifications | **通过（UI 范围）** | 两页只呈现摘要、disabled 编辑按钮及 unavailable notice（`apps/web/src/features/settings/display/index.tsx:6`、`notifications/index.tsx:6`）。Notice 使用 `role=status` / `aria-live=polite`，禁用按钮通过 `aria-describedby` 关联原因。聚焦测试验证中英文原因、按钮禁用、无 API 调用和无 success toast。无可编辑表单、模板值、演示提交或保存 toast。真实偏好读取/保存和通知投递尚未实现，不能称已保存。 |
| Appearance 选项与语义 | **部分通过** | Schema 与表单都支持 system/light/dark，字体选项共用 provider 的 `fonts`（`appearance-form.tsx:26-37`）。表单、摘要、toast 明确只应用于当前浏览器，不保存到账户或同步设备。正常路径写入并读回 `vite-ui-theme`、`font` Cookie 后才 toast。测试检查三主题/所有字体可见、dark Cookie、无 API 调用及本地语义 toast；未选择 system/light，也未断言字体 Cookie。 |
| Appearance Cookie 异常 | **失败，需复验** | `appearance-form.tsx:49-64` 在校验 Cookie 前先调用两个 provider setter；`theme-provider.tsx:78-80`、`font-provider.tsx:36-38` 写 Cookie 并立即更新内存状态。浏览器静默拒绝时读回不匹配会显示错误且不 toast/关闭，但主题/字体状态已更新。若 `document.cookie` 读写抛异常，setter/getCookie 没有捕获，表单可能停留在 `saving` 而非进入错误态。测试未覆盖拒绝、异常、刷新读回或干净浏览器隔离。正常 dark 写入仅证明该 headless 测试上下文，不是跨浏览器/设备证明。 |
| Profile / Account 接口归属 | **源码一致；真实持久化待验收** | 认证路由等待 `restoreSession()`；`apps/web/src/lib/api.ts:160-174` 从 `/auth/me` 恢复全局当前用户。Profile 用 `PATCH /account/profile` 并以响应 `AuthUser` 更新 store；Account 用 `POST /account/password`。后端 `apps/api/app/api/auth.py:92-113` 两端点依赖 `get_current_user`，资料提交后返回用户；密码成功后递增 `token_version`、提交并删除 session cookie。未请求真实 API/数据库，账号 A/B 隔离、持久化读回、Tenant/Workspace 切换后资料不变均未实测。 |
| Profile 当前值、空值与失败 | **部分通过；401 草稿保留失败** | 摘要读取 auth store，空值显示 `Not set`；用户未加载时显示 alert 且禁用编辑，认证路由在渲染前等待 `/auth/me`。Profile 仅 API 成功后 `setUser(updated)` 并 toast；普通模拟 rejection 测试确认草稿保留。缺口：`apps/web/src/lib/api.ts:153` 对 401 先 reset 用户，`profile-form.tsx:34-37` 在 `user` 变化时重置表单，因此 401/用户状态变化会清空草稿。测试未覆盖 401、403、409、超时、5xx 或并发状态变化。 |
| Profile / Account 能力提示 | **通过（文案范围）** | 邮箱字段说明无验证流程；头像字段说明仅 URL、无图片上传；Account 摘要明确没有安全通知/设备管理能力。未声称已有邮箱验证、图片上传、安全通知或设备管理；这些能力均未实现。 |
| Password 成功流程与凭据 | **源码一致；成功路径待验收** | `account-form.tsx:19-35` 等待 `POST /account/password` 成功后才 reset auth、提示当前会话结束并 replace 导航到 `/sign-in`；密码不出现在 toast，也没有写入 local/session storage 的代码。后端返回 204、递增 `token_version` 并删除 session cookie。测试只模拟 rejection，验证错误 alert、保留会话、无成功 toast/跳转；未模拟成功、旧 token 拒绝、新密码重新认证或检查网络/日志/浏览器历史，因此不能认定真实变更已验收。密码按接口契约作为请求体发送，本轮未检查服务端日志策略。 |
| 中英文可见文案 | **部分通过** | i18n 字典为 Display/Notifications 状态及 Appearance 成功/失败/浏览器本地文案提供中英映射（`apps/web/src/lib/i18n.ts:246-279`）；Profile/Account 能力边界也有映射（`i18n.ts:265-275`）。测试实际渲染 Display/Notifications 两种语言；Appearance/Profile/Account 中文仅核对字典，未逐页渲染。API 的 `error.message` 原样放进 `role=alert`，未经过 `LocalizedText`；动态错误语言依赖服务端，本轮无真实后端证据。 |
| 键盘、Dialog 焦点与读屏 | **待验收** | unavailable 状态与 disabled 按钮有关联，表单使用 label、`aria-busy`、错误 `role=alert`。测试未打开设置 Dialog，也未检查初始焦点、Tab 限制、Escape、关闭后焦点返回、未保存处理或读屏播报。Radix 默认行为和静态 ARIA 不能替代实测。 |
| 320/360/390px 响应式 | **待验收** | 源码有 `flex-col`、小屏全宽按钮、Dialog 高度/滚动约束等 class；本轮未设置 320、360、390 CSS px 视口，未截图或实测溢出、滚动与触控区域。 |
| 路由、摘要与演示文件 | **静态通过；路由集成渲染待验收** | `routeTree.gen.ts:387-390` 保留 `/settings/account`、`appearance`、`display`、`notifications`；对应 route 导入预期 Settings 组件，index 导入 Profile。聚焦测试直接渲染 Display/Notifications，未通过完整应用路由验证全部摘要页。两个旧表单文件不存在；设置 feature/routes 搜索 `display-form`、`notifications-form`、`showSubmittedData` 无命中。当前设置 UI/route 无错误移动端设置链接；旧移动通知模板字符串仍在 `i18n.ts:240`，未发现组件引用或渲染。 |

## 命令与结果

### 聚焦浏览器测试

命令（工作目录 `apps/web`）：

```text
pnpm vitest run src/features/settings/settings-realism.test.tsx --browser.headless
```

结果：**退出码 0；1 个 test file passed，9/9 tests passed；Vitest 4.1.4、Playwright Chromium headless、3.24s。** 9 项为 Display/Notifications 英文只读（2 个参数化 case）、中文状态（2 个）、Appearance 正常 Cookie 写入（1 个）、Profile 模拟成功响应（1 个）、Profile 普通 rejection 保留草稿（1 个）、密码普通 rejection（1 个）、Account 未加载（1 个）。`api`、toast、navigation 为 mock；无真实 API/数据库、密码成功或路由级测试。Cookie 检查仅限当前测试浏览器上下文。

### Web build

命令：

```text
pnpm --dir apps/web build
```

结果：**退出码 1（pnpm lifecycle 显示 exit code 2）；`tsc -b` 失败，未运行 `vite build`。** 当前错误在并行导航/Workspace 改动，不在本验收允许修改范围；设置文件未出现在错误列表：

- `src/components/layout/app-sidebar.tsx`：`Link` 未使用；line 96 可能为 `undefined` 的值不能传给要求 `string` 的参数。
- `src/components/layout/data/sidebar-data.ts`：`Home`、`LayoutDashboard` 未使用。
- `src/features/workspaces/context.tsx`：`useLocale`、`Button`、`workspaceRecoveryCopy` 未使用；缺少 `./workspace-recovery-messages`；`useQuery`、`toast`、`LocalizedText`、`listAllWorkspaces`、`redirect` 未定义；`item` 隐式 `any`。合计 21 个 TypeScript diagnostics（详见本轮命令输出）。

这是当前集成构建阻塞，不能归因于设置实现；build 失败也意味着无成功打包证据。台账中的历史成功 build 是实现者报告，未独立重现。

## 最终状态

- **通过：** Display/Notifications 当前只读、原因双语可见、禁用操作关联说明、无模拟保存/成功反馈；旧演示表单无设置域残留导入；错误移动端设置链接无当前 UI 引用；Profile/Account 使用当前全局账号 API，能力文案没有夸大。
- **失败：** Appearance Cookie 异常未可靠收敛；Profile 对 401/当前用户变化会重置草稿，至少一个 API 失败类型不满足保留草稿验收。
- **待验收：** 真实 Profile 数据库持久化/读回、真实密码变更及 session 失效/重新登录、API 错误码和不确定结果、Cookie 失败/读回/刷新/隔离、中英全部页面实渲染、路由级摘要渲染、320/360/390px、纯键盘/焦点/屏幕阅读器、高对比度/200% 缩放。当前 integration build 被 sidebar/Workspace TypeScript 错误阻塞。

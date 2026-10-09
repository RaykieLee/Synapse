# F05c / F05e 租户邀请前端验收

**结果：通过。** F05e 邀请注册 UI 完成后，本项验收通过。最近一次运行使用真实 FastAPI API、一次性 SQLite 数据库、Vite 前端和无头 Playwright Chromium。本报告将 F05c 现有账户邀请检查与 F05e 新账户注册新增流程分开说明。

## 复现

运行组合式、自包含的 F05c/F05e 验收：

```sh
cd Synapse/apps/api
.venv/bin/python tests/verification/run_f05c_tenant_invite_frontend.py
```

该运行器先执行 `pnpm build`，创建临时 SQLite 数据库并迁移至 `0003_tenant_invitations`，填充互相独立的 owner/admin/member/invitee 账户，在空闲本地端口启动 uvicorn 和 Vite，然后在 Chromium 中执行 [f05c_tenant_invite_frontend.mjs](../../apps/api/tests/verification/f05c_tenant_invite_frontend.mjs)。运行结束后停止进程并移除数据库。构建与 API/浏览器阶段都使用应用真实代码路径。

最终结果：`F05c/F05e tenant invite frontend verification passed`，退出码 0。Production TypeScript/Vite 构建通过，Alembic 到达 `0003_tenant_invitations`，浏览器/API 流程通过。

## 构建记录

F11a 用户模块迁移期间，首次构建因 `@/features/users` 尚无 export module 而失败。主任务负责人确认这是并发编辑期间的暂时状态，并要求等待。F11a 完成后，同一运行器的 `pnpm build` 和所有浏览器/API 流程均通过。

## 已验证流程

### F05c — 现有账户邀请 UI 与接受流程

- Owner 创建 admin 角色邀请，通过 UI 剪贴板操作复制绝对邀请链接，然后撤销邀请。受邀账户尝试接受时看到邀请已撤销/已使用错误。
- Owner 为现有账户邮箱创建 member 邀请。未认证浏览器点击**返回登录页**后，进入普通登录表单，并保留邀请 redirect 和 token。目标账户登录后返回同一邀请 URL；接受邀请时显示正确的 tenant ID。
- 重用已成功接受的邀请会显示一次性使用错误。接受后，该认证账户的 `GET /workspaces` 响应为空，证明租户成员身份不会自动授予 Workspace 权限。
- 其他账户尝试接受尚未绑定账户的邮箱邀请时，会看到邮箱/账户不匹配提示。过期邀请会显示过期提示。
- 租户暂停期间，待处理邀请会被拒绝；检查该边界后，验收器恢复租户。
- Tenant admin 可以创建、复制和撤销 member 邀请，但 UI 不提供 admin 邀请角色。普通租户成员看不到邀请控件，真实 API 会以 403 拒绝创建邀请。

### F05e — 通过邮件邀请注册账户

- Owner 在租户 UI 创建发往新邮箱的 member 邀请。未认证 invitee 选择“没有账号，创建账号”，提交用户名和匹配的 12 字符以上密码，随后进入已接受邀请的租户视图。
- 实际 API 的 `/auth/me` 响应确认注册用户名、规范化后的受邀邮箱和普通 `user` 平台角色。注册账户的 workspace 列表仍为空。
- 流程成功后会从 URL 清除 token 值并清空密码输入框；已使用的邀请不能重放。
- 浏览器本次仅通过新邮箱邀请验证了成功创建账户路径；API 专项 F05d 覆盖注册约束和事务边界。本次浏览器运行没有通过 UI 重测 F05d 的所有校验场景。

## 范围与限制

Owner/admin/member 关系图和初始 Workspace 直接写入临时数据库。邀请创建、复制、撤销、登录、接受现有账户邀请、新账户注册、重复接受、过期提示和邮箱不匹配，均在实际浏览器中针对真实 API 执行。检查使用本地 Vite/SQLite 下的 Chromium，不涉及部署 origin、其他浏览器、邮件投递（尚未实现）或生产数据库锁/并发行为。

## 单独的任务记录

- **F05c：** 现有账户邀请前端和接受流程 — 组合运行通过。
- **F05e：** 通过租户邮件邀请注册新账户 — 覆盖成功创建、所得租户身份、token 清理、拒绝重放以及不自动加入 Workspace；组合运行通过。更广泛的 API 注册校验单独记录于 F05d。

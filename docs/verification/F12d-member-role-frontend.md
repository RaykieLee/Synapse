# F12d Tenant 成员自定义角色前端验收

**结果：通过。** 最终运行成功构建前端，将一次性 SQLite 数据库迁移到 Alembic `head`，启动真实 FastAPI 和 Vite 服务，并完成 Playwright Chromium 流程。

## 复现

```sh
cd Synapse/apps/api
.venv/bin/python tests/verification/run_f12d_member_role_frontend.py
```

运行器创建两个租户、一个共享管理账户（Tenant Alpha 的 owner、Tenant Beta 的 admin）、一个在不同租户中有各自分配的共享普通成员、active 和 disabled 自定义角色，以及 Tenant B 的 owner。浏览器运行结束后，运行器会关闭两项服务并移除临时数据库。

脚本：

- `apps/api/tests/verification/run_f12d_member_role_frontend.py`
- `apps/api/tests/verification/f12d_member_role_frontend.mjs`

## 证据与覆盖

- `pnpm build` 通过（`tsc -b` 和 Vite production build）。
- Alembic 迁移至当前 `head`，包含 `0004_tenant_roles`、`0005_tenant_member_roles` 和 `0006_tenant_menus`。
- Tenant Alpha owner 视图加载了预置分配。Owner 通过成员表 UI 替换、撤销并分配另一个自定义角色。内置租户角色仍为 `member`。
- 同一账户在应用内的两个租户详情之间导航。目标成员在各租户中有不同的初始分配。Tenant Alpha 控件只包含 Alpha 角色，Tenant Beta 只包含 Beta 角色。作为 Tenant Beta admin，该账户替换、撤销并重新分配该租户的角色；返回 Alpha 后仍保留 Alpha 自己的分配。
- 新加载的分配选项中不包含 disabled 角色。为测试错误反馈，运行器在当前 UI 已缓存 active 选项后，通过真实 API 禁用一个角色。选择该过时选项后，管理 UI 显示真实 API 的 `RESOURCE_NOT_FOUND` 错误，并未替换当前分配。重新加载后会获取最新选项，disabled 角色不再出现。
- 普通租户成员只能只读查看自定义角色字段，没有分配选择器。使用该成员 token 发出的 GET、PUT 和 DELETE 自定义角色 endpoint 请求均返回 403 `FORBIDDEN`。
- 在禁用 Tenant Alpha 角色并检查普通成员权限后，最终 Tenant Beta 检查仍显示 Beta 自己的分配。

## 范围说明

本次仅验证 F12d 分配 UI 行为。当前 UI 不允许普通成员查看自己的自定义角色；主任务已将此缺口明确延期至 F12e，因此不计为 F12d 失败。并发情境测试有意验证：页面加载后角色被禁用时，服务端会拒绝请求且用户可见错误。本次不测试生产数据库并发行为或 Chromium 以外的浏览器。

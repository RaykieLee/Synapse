# F13e — Tenant 角色菜单授权前端验收

**状态：通过**

## 运行

- 运行器：`apps/api/tests/verification/run_f13e_role_menu_frontend.py`
- 浏览器流程：`apps/api/tests/verification/f13e_role_menu_frontend.mjs`
- 命令（在 `apps/api` 中运行）：`.venv/bin/python tests/verification/run_f13e_role_menu_frontend.py`
- 运行器执行 `pnpm build`，将临时 SQLite 数据库升级到当前 Alembic `head`（`0009_tenant_dictionaries`），填充两个租户/角色/菜单树和历史授权，然后启动真实 FastAPI API 与 Vite dev server，执行 Playwright。
- 结果：退出码 `0`；TypeScript/Vite production build 成功，Playwright 输出 `F13e role-menu frontend verification passed`。

## 已验证

- Tenant A 的 owner 与同一用户在 Tenant B 的 tenant-admin 账户都能打开角色菜单授权。编辑器渲染真实租户菜单树；可更改 enabled 菜单复选框，通过 API 保存，并在重新加载后呈现已保存状态。
- 历史上已禁用的授权会显示为历史记录，且不可勾选。软删除的历史授权显示为已删除 ID，没有树复选框。保存替换内容时只发送选中的 active 菜单 ID，并清除历史授权。
- 若编辑器加载菜单后该 active 菜单被禁用，真实 API 会以 404 拒绝保存，页面显示本地化错误提示；重新加载后菜单显示为禁用且不能选择。
- 在 Tenant A 切换两个角色会显示不同的已保存选项。切到 Tenant B 后只显示该租户的角色和菜单；修改 Beta 授权后返回 Tenant A，仍恢复原已保存状态，不会跨租户泄露缓存。
- 普通租户成员看到页面管理权限拒绝，没有菜单授权控件；直接调用 API GET 和 PUT 均返回 403。

## 范围与限制

本次使用本地 SQLite、FastAPI、Vite 和 Playwright，不使用生产数据库或浏览器。浏览器产生一条未分类的资源 404 console 消息；所有预期 API 错误反馈和功能断言均通过。本次未修改产品代码。

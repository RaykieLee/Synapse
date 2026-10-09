# F13b 租户菜单管理前端独立验收

## 结论

**通过已覆盖范围。** `pnpm build` 成功；真实 FastAPI + Vite + Playwright 流程通过。验证使用独立临时 SQLite，Alembic 从空库迁移至运行时 head（本次为 `0008_tenant_departments`），结束时清理临时数据库和服务。

## 可复跑

从 `apps/api` 运行：

```bash
.venv/bin/python tests/verification/run_f13b_tenant_menu_frontend.py
```

脚本先执行 `pnpm build`，再启动临时 API/Vite 并运行浏览器流程：

- `apps/api/tests/verification/run_f13b_tenant_menu_frontend.py`
- `apps/api/tests/verification/f13b_tenant_menu_frontend.mjs`

## 通过项

- owner 在 Tenant Alpha 打开菜单管理；页面仅显示 Alpha 的树数据。
- owner 可以编辑菜单名称/路由、停用后重新启用菜单。
- 有子菜单时删除父菜单被服务端拒绝，页面显示可读错误“请先删除或移动此菜单下的子菜单。”。
- 可以创建顶级菜单，并通过“上移”完成同级重排；API 返回顺序与界面操作一致。
- 删除叶子节点后可删除其父节点；最终树与预期一致。
- 同一 SPA 会话切至 Tenant Beta 后不显示 Alpha 缓存数据；Tenant Beta 管理员可以创建菜单；切回 Alpha 后不显示 Beta 数据。
- Tenant Alpha 普通成员直达菜单管理 URL 时看到明确的只读/拒绝提示，不显示创建控件；以该成员 token 调用菜单树 GET 与创建 POST 均返回 403 `FORBIDDEN`。另外直接 `/auth/me` 返回 200，确认这不是失效登录 token 导致的假拒绝。

## 过程记录

F13e 并行修改 `roles-page.tsx` 期间，首次重跑的 `pnpm build` 曾因该文件临时存在 TypeScript 错误失败；开发者完成修改后复跑 build 成功。之后浏览器首次到达普通成员分支时，脚本错误地要求页面必须有“租户菜单”标题；实际页面按设计直接呈现拒绝提示。脚本改为断言提示文本及无管理控件，再完整复跑通过。该首次浏览器失败是验证器断言过严，不是产品缺陷。

## 边界

本项验收前端页面与其常用真实 API 流程、租户切换缓存隔离及普通成员拒绝。跨租户菜单 ID 的直接读写授权由 F13a API 验收承担；本次没有重复完整 API 安全矩阵。此报告不覆盖 F13c 角色菜单授权页面，也不代表其它租户/Workspace 功能通过。

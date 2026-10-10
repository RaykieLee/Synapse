# F06 Workspace 后端验收

**结果：** 通过临时 SQLite 数据库、真实 FastAPI 应用和 Workspace 管理 routes 验收。仅在测试应用中挂载了一个只用于验收的上下文探测 route，以测试 `get_workspace_context`；未更改任何应用 route 或实现。

## 复现

```sh
cd Synapse/apps/api
.venv/bin/pytest -q tests/verification/test_f06_workspace_backend.py
```

实际结果：`1 passed, 2 warnings`（0.41 s）。测试在 pytest 的 `tmp_path` 下创建临时 SQLite 数据库，将 Alembic migrations 应用到 `0002_tenants`，为临时用户签发带签名的 bearer token，通过 `TestClient` 调用 FastAPI，最后丢弃数据库。测试不会连接配置的应用数据库。

2026-10-11 回归：Workspace 业务规则迁移到 `WorkspaceService`、请求/响应契约集中到 `app/schemas/workspaces.py` 后，`test_f06_workspace_backend.py` 与 `test_f06b_archived_workspace.py` 均复验通过；默认本地 SQLite/API 测试套件为 `23 passed`。

两条警告分别是 Starlette 的 `httpx` 弃用提示和 Alembic 缺少 `path_separator` 配置的弃用提示；均未影响测试结果。

## 已验证行为

- 平台管理员创建租户时会设置所选首位 owner 和默认 workspace；平台管理员不会隐式获得租户或 workspace 成员身份，也不能借租户成员权限创建 workspace。
- 创建 workspace 需要 active tenant owner/admin。租户成员会被拒绝。创建另一个 workspace 的管理员会成为该 workspace 的首位 owner。
- `GET /workspaces` 仅包含租户成员关系和 workspace 成员关系均为 active 的空间。仅有租户角色、平台角色或 `tenant_id` 过滤条件都不会授予 workspace 访问权。属于其他租户的成员只能看到自己的 workspace。
- 仅用于测试的上下文探测确认：tenant ID 从 workspace 派生，并返回 workspace role、permissions 和 membership version。缺少 `X-Workspace-ID`、格式错误的 header，以及 path/header 不匹配都会被拒绝。跨租户 ID 不能授权访问。
- 会检查账户、tenant member、workspace member、tenant 和 workspace 状态：非 active 账户返回 401；即使 workspace membership 记录仍为 active，非 active tenant member 也会被拒绝；缺少 workspace membership 会被拒绝；suspended tenant 和 archived workspace 无法建立业务上下文。
- Workspace admin 可以添加、更新、移除普通成员及重新授予成员权限，但不能操作、提升或降级 owner。Viewer 只有只读权限，不能管理成员。
- 不能添加跨租户用户或授予其 workspace owner 身份。没有 workspace membership 的 active tenant member 不能接收 owner 转移。
- 不能移除或降级最后一位 active workspace owner。有效转移会让所选 active workspace member 成为 owner，原 owner 成为 admin；转移后唯一剩余的 owner 受到保护。
- 归档 workspace 后，该空间不再出现在业务列表和上下文中；active owner/admin 仍可读取空间元数据和成员列表，并可恢复该空间。
- 移除租户成员会撤销其 workspace membership，并立即导致上下文探测失败。重新添加租户成员不会恢复 workspace 访问权，仍须显式授予 workspace 权限。

## 范围与限制

这是隔离的 SQLite/API 契约验收，不是生产数据库并发或部署检查。上下文探测仅用于测试，直接依赖业务 routes 计划使用的同一 `get_workspace_context` dependency；这并未验证未来的每个业务 endpoint 都挂载了该 dependency。邀请生命周期、此 workspace 流程之外的租户级 owner 不变量和外部集成不属于本次 F06 验收范围。

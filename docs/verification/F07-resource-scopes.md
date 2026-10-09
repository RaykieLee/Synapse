# F07 Tenant / Workspace 上下文与资源范围验收

状态：通过（独立验收）。

## 证据

- 测试：`apps/api/tests/verification/test_f07_resource_scopes.py`
- 命令：`cd apps/api && .venv/bin/python -m pytest tests/verification/test_f07_resource_scopes.py -q`
- 结果：`1 passed`。测试将隔离的 SQLite 数据库迁移至 Alembic `head`，创建两个租户和三个处于 active、removed、suspended、archived、disabled 等状态的 workspace，然后通过 `TestClient` 调用真实 FastAPI dependency routes。
- 不阻断测试的环境警告：Starlette 提示已安装的 `httpx` 集成已弃用；Alembic 提示未配置 `path_separator`。

## 已验证行为

- `WorkspaceContext` 根据数据库成员关系解析 actor、tenant、workspace、roles、permissions 和 membership version。该对象不可变；尝试修改 workspace ID 会失败。
- 必需的 workspace permission 检查会依据映射角色允许 active owner 读写、允许 viewer 读取，并拒绝 viewer 的创建操作。允许 tenant owner 权限；拒绝普通 tenant member 管理成员。
- Workspace path 要求 `X-Workspace-ID`；省略 header 会返回 `400 WORKSPACE_CONTEXT_REQUIRED`，header 不匹配或格式错误会返回 `400 CONTEXT_MISMATCH`。
- 没有成员关系的 platform admin 在 tenant 和 workspace contexts 下都会收到 `403`；平台角色不会授予业务访问权。Removed/suspended tenant membership、removed workspace membership、archived workspace、suspended tenant 和 disabled account 都会被默认拒绝。
- `workspace_scope` 只返回同时匹配 context tenant 和 workspace 的行，也会排除一条特意构造的 tenant-B/workspace-A1 错误记录。`tenant_scope` 排除 tenant-B 行。`personal_scope` 会排除其他用户的私有行，以及来自其他 workspace/tenant 的记录，即使当前 actor 是 workspace owner 也一样。
- `workspace_values` 和 `personal_values` 会填入由服务端控制的 scope/actor 字段。尝试覆盖 `workspace_id`、`tenant_id` 或 `owner_user_id` 会抛出 `ValueError`。

## 范围与限制

查询范围场景使用仅用于临时验收的 SQLAlchemy models，并要求模型包含相应的 ownership 列；这些测试调用生产 helper 和从真实 dependency 派生的上下文，但不代表已验证未来业务模型各 route 的用法。数据库验收仅使用 SQLite。未发现产品缺陷。

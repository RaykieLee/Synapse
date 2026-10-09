# F12a Tenant Role API 验收

状态：通过（独立验收）。

## 证据

- 测试：`apps/api/tests/verification/test_f12a_tenant_role_api.py`
- 命令：`cd apps/api && .venv/bin/python -m pytest tests/verification/test_f12a_tenant_role_api.py -q`
- 结果：`1 passed`。测试使用隔离的 SQLite 数据库和真实 FastAPI `TestClient` 调用。
- Alembic 先迁移至 `0003_tenant_invitations`，填入既有用户、两个租户、租户成员、一个 workspace 和一条邀请，再升级到 `0004_tenant_roles`。测试断言 revision、新角色表的列和唯一约束，以及既有记录的保留。测试特意固定在 `0004_tenant_roles`，因为后续 F12c migration 工作可能会并行推进 `head`。
- 不阻断测试的环境警告：Starlette 提示已安装的 `httpx` TestClient 集成已弃用；Alembic 提示配置中没有设置 `path_separator`。

## 已验证行为

- Owner 和 tenant admin 可以创建/读取/更新/删除角色。普通租户成员不能列出或创建角色。没有租户成员身份的平台管理员不能列出或创建角色；Tenant A 的用户不能管理 Tenant B。
- 不同租户允许相同的 `role_name` 和 `role_key`。同一租户内重复名称/键返回 409 `ROLE_CONFLICT`。
- Tenant A 不能通过 ID 获取、patch 或删除 Tenant B 的角色；每项操作均返回 404 `RESOURCE_NOT_FOUND`。
- 创建/列表/详情/patch/删除流程验证了租户绑定、字符串 ID、响应中的 `scope: tenant`、actor 归属、搜索、分页、page-size 限制、active/disabled 过滤、状态更新和软删除可见性。
- Permission allowlist 接受受支持的 tenant permissions；Workspace/global permissions、重复值、保留的内置角色键、格式错误的 key 和多余字段都会触发 422 校验响应。
- Patch 会拒绝空更新和不支持的状态。软删除角色的 ID/名称/key 仍受数据库唯一约束保护，尝试复用会返回 409。

## 范围与限制

本次验证了从 `0003_tenant_invitations` 升级到 `0004_tenant_roles`，未测试 downgrade 或之后的 migrations。所有 API 和迁移证据均来自临时 SQLite；未验证生产数据库方言行为。未发现产品缺陷。

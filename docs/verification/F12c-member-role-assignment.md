# F12c Tenant 成员自定义角色分配验收

**状态：通过（修复 SQLite foreign-key connection 问题后）**

## 运行

- 测试：`apps/api/tests/verification/test_f12c_tenant_member_roles.py`
- 命令（在 `apps/api` 中运行）：`.venv/bin/python -m pytest tests/verification/test_f12c_tenant_member_roles.py -q`
- 数据库：隔离的临时 SQLite 文件，已迁移至 Alembic `head`（`0006_tenant_menus`，包含 `0005_tenant_member_roles`）。
- API：通过真实 FastAPI `TestClient` 调用。
- 结果：`1 passed`（0.45s）。
- 警告：Starlette 弃用已安装的 `httpx` TestClient 集成；Alembic 提示未设置 `path_separator`。

## 已验证行为

- Tenant owner/admin 可以分配自定义角色；普通租户成员和没有租户成员身份的平台管理员不能分配角色。
- 重复分配具有幂等性，不会递增 `membership_version`；替换角色时只递增一次。Tenant A 不能使用 Tenant B 的 role ID 或 member ID，内置 owner/admin membership 不能获得自定义角色。
- 已禁用/删除的角色定义、已移除的租户成员、已禁用全局账户和软删除账户均会被拒绝。
- 分配的自定义权限会对普通租户成员生效。编辑权限、禁用/删除角色和撤销分配都会按预期更新 membership version，并回退到内置 member 基线权限。撤销操作可重复执行。
- 现有 JWT 对全局身份认证仍有效（`/auth/me` 返回 200）；请求会根据数据库状态派生当前租户权限和 `membership_version`。
- 两个并发的相同分配请求均返回 200，最终合并为一条分配记录，并只递增一次 version。
- 应用 engine 连接上的 `PRAGMA foreign_keys=1`。直接插入 Tenant A 与 Tenant B 成员的组合，以及 Tenant A 成员与 Tenant B 角色的组合，均触发 `IntegrityError`；两条无效记录均回滚。

## 范围与限制

本次复验覆盖当前 SQLite Alembic head，未验证生产数据库约束。本次验证未修改产品代码。

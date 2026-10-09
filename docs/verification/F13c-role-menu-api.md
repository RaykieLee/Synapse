# F13c — Tenant 自定义角色菜单授权 API 验收

**状态：通过（修复 `_assigned_ids()` 后）**

## 运行

- 测试：`apps/api/tests/verification/test_f13c_tenant_role_menus.py`
- 命令（在 `apps/api` 中运行）：`.venv/bin/python -m pytest tests/verification/test_f13c_tenant_role_menus.py -q --tb=short`
- 数据库：隔离的临时 SQLite 数据库。在 revision `0006_tenant_menus` 填充旧版租户、成员、角色、分配和菜单记录，再迁移至当前 `head`（`0009_tenant_dictionaries`，包含 `0007_tenant_role_menus`）。
- API：真实 FastAPI `TestClient`。
- 结果：`1 passed`（0.57s）。
- 警告：Starlette 弃用已安装的 `httpx` TestClient 集成；Alembic 提示未设置 `path_separator`。

## 已验证

- 前往 `head` 的迁移路径应用了 revision `0007_tenant_role_menus`；关联表及两个复合外键均存在。既有租户、角色、成员角色分配和菜单数据保持完整。
- 建立关联后，GET 和 PUT 会返回排序后的十进制字符串 `menu_ids`，其中包括指向 disabled 菜单的持久化旧关联。
- 替换角色菜单集合会将 `membership_version` 递增一次；再次提交相同的非空集合不会递增。清空为空列表会变更 version 一次，重复提交空集合则不再变更。
- 拒绝重复/非正 ID。跨租户 role/menu IDs、disabled/deleted 角色定义以及 disabled/软删除菜单不能新分配。指向 disabled 菜单的旧关联仍可读取和替换。
- Owner 和 tenant admin 可以读取并替换授权。普通租户成员、无租户成员身份的平台管理员和其他租户用户均被拒绝。
- 两个并发且内容不同的替换请求均返回 200，数据库最终收敛为一套完整集合，version 递增两次。
- 应用连接上的 `PRAGMA foreign_keys=1`。直接插入 Tenant A 记录与 Tenant B 角色的关联，以及 Tenant A 角色与 Tenant B 菜单的关联，均触发 `IntegrityError` 并回滚。

## 范围与限制

验收使用 SQLite 和当前 Alembic head，未使用生产数据库。本次复验未修改产品代码。

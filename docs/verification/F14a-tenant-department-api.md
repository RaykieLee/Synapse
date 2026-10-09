# F14a — Tenant 部门 API 验收

**状态：通过**

## 运行

- 测试：`apps/api/tests/verification/test_f14a_tenant_departments.py`
- 命令（在 `apps/api` 中运行）：`.venv/bin/python -m pytest tests/verification/test_f14a_tenant_departments.py -q --tb=short`
- 数据库：隔离的临时 SQLite 数据库。在 revision `0007_tenant_role_menus` 填入租户、角色、菜单及角色菜单关联，再迁移至当前 `head`（`0009_tenant_dictionaries`，包含 `0008_tenant_departments`）。
- API：通过真实 FastAPI `TestClient` 验收。
- 结果：`1 passed`（0.57s）。
- 警告：Starlette 弃用已安装的 `httpx` TestClient 集成；Alembic 提示未设置 `path_separator`。

## 已验证

- Migration `0008_tenant_departments` 创建部门表和复合 `(parent_id, tenant_id)` 自引用。迁移到 head 后，既有租户、角色、菜单和角色菜单关联行仍完整。
- 两个租户可以独立创建同名部门。同租户重复名称返回 `409 DEPARTMENT_NAME_CONFLICT`；其他租户的部门 ID 在详情、patch、删除操作中均返回 404，且不会泄露跨租户列表/树数据。
- Owner/admin 可以创建、读取、更新和重排部门。普通租户成员、无成员身份的平台管理员以及其他租户的 owner 均被拒绝访问。
- 测试了创建、平铺搜索/状态过滤、嵌套树排序、字段更新、状态禁用/恢复，以及叶节点软删除。`include_disabled=false` 时会排除禁用部门。
- 验证了 root、child、grandchild 的服务端 `ancestors` 值。移动祖先节点会更新所有后代路径；重排也会刷新路径。
- 拒绝跨租户、禁用和软删除的父节点。自引用/多层循环返回 `409 DEPARTMENT_CYCLE`；删除仍有 active 子节点的部门返回 `409 DEPARTMENT_HAS_CHILDREN`。
- 应用 SQLite 连接报告 `PRAGMA foreign_keys=1`；直接插入 Tenant B 部门与 Tenant A 父节点的组合会触发 `IntegrityError` 并回滚。

## 范围与限制

本次使用 SQLite 和当前 Alembic head 验收，未使用生产数据库。未修改产品代码。

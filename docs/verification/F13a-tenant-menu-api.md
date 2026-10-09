# F13a — Tenant 菜单 API 验收

**结果：通过**

在 `apps/api` 中运行：

```sh
.venv/bin/python -m pytest tests/verification/test_f13a_tenant_menu_api.py -q
```

结果：`1 passed`（0.49s）。测试使用临时 SQLite 数据库，将已有租户、角色、成员和成员角色分配数据从 revision `0005_tenant_member_roles` 升级到 `head`（`0006_tenant_menus`），并通过 FastAPI `TestClient` 调用 endpoints。

覆盖情况与观察：

- Migration 创建 `tenant_menus`，声明复合 `(parent_id, tenant_id)` 自引用，并保留既有租户、角色、成员和角色分配记录。
- 两个租户可使用相同的菜单名称和路由路径，彼此读取/修改隔离。Owner/admin 访问成功；租户成员、无成员身份的平台管理员和其他租户用户均被拒绝。
- 测试了菜单创建、搜索/状态过滤、平铺列表、树排序、字段更新和原子重排。`/tree` route 与整数 menu-ID route 的解析正常。
- 拒绝自设父节点和多节点循环。拒绝其他租户和软删除父节点；disabled 父节点不能接收子节点。disabled 过滤会排除禁用节点。
- 有有效子节点时拒绝删除父节点；删除叶节点会执行软删除，并在后续读取中隐藏。
- 数据库拒绝直接插入跨租户父子关系。测试还确认应用 engine 连接的 `PRAGMA foreign_keys=1`，因此此环境会执行同租户复合父节点约束。

警告仅涉及依赖/配置弃用：Starlette 的 `httpx` TestClient 弃用提示，以及 Alembic 缺少 `path_separator` 设置的提示。

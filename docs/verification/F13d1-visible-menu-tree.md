# F13d1 可见菜单树 API 验收

## 结果

**通过。** 专项验收测试使用一次性 SQLite 数据库，从空库迁移至当前 Alembic head `0009_tenant_dictionaries`，并通过 `TestClient` 调用运行中的 FastAPI 应用。

在 `apps/api` 中运行：

```sh
.venv/bin/python -m pytest tests/verification/test_f13d1_visible_menu_tree.py -q
```

结果：`1 passed`（0.47s）。运行时仅出现现有的 Starlette/httpx TestClient 与 Alembic `path_separator` 弃用警告。

## 证据

- Tenant A owner 和 admin 可见符合条件的 active、visible `M`/`C` 导航节点；操作入口、hidden/disabled/deleted 项，以及祖先不符合条件的子节点均会被排除。
- 没有自定义角色的成员得到空树。分配了 active 角色的成员只看到已授权且完整祖先链也都获授权并符合条件的节点。位于未授权、隐藏、禁用或软删除父节点下的子节点不会泄露。Disabled 和软删除角色定义返回空树。
- 替换角色菜单授权会改变成员菜单树，并使 `membership_version` 递增一次；重复提交相同集合不会递增。分配自定义角色以及更改已分配角色的权限/状态也会推进 version。禁用角色会立即清空成员菜单树；重新启用后只恢复当前授权内容。
- 禁用或隐藏菜单后，该节点及其后代会立即从 `visible-tree` 移除。payload 中的 `membership_version` 与当前租户版本一致。
- 每次成功的 visible-tree 请求都返回 `Cache-Control: private, no-store` 和 active tenant ID/version。
- 其他租户用户、无租户成员身份的平台管理员和已移除的租户成员均不能访问租户菜单树。Owner/admin 请求其他租户路径也会被拒绝。跨租户角色菜单授权返回 404 `RESOURCE_NOT_FOUND`。

## 运行说明与限制

首次测试发现 fixture 初始化问题：嵌套测试菜单在父行尚未获得数据库 ID 前就创建，导致部分子项意外成为 root。现在 fixture 会先 flush 每个父节点，再创建子节点；最终运行通过。未修改产品实现。本次验证的是 SQLite/TestClient 上的 API 契约，不涉及浏览器导航调用方或并发菜单修改。

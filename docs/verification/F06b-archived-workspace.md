# F06b 归档 Workspace 列表验收

**结果：** 通过临时 SQLite 数据库和真实 FastAPI routes 验收。仅挂载了一个测试 route，用于确认归档的 Workspace 仍会被现有业务上下文 dependency 拒绝。

## 复现

```sh
cd Synapse/apps/api
.venv/bin/pytest -q tests/verification/test_f06b_archived_workspace.py
```

实际结果：`1 passed, 2 warnings`（0.40 s）。测试创建临时账户和两个租户，将 Alembic migrations 应用到 `0002_tenants`，签发应用 bearer token，然后通过 `TestClient` 调用 `GET /api/v1/workspaces` 及相关真实 API。数据库位于 pytest `tmp_path` 下；不会触及配置的应用数据库。

两条警告是现有的 Starlette `httpx` 弃用提示和 Alembic `path_separator` 配置弃用提示。

## 已验证行为

- 不提供 `include_archived` 时，workspace owner、admin、member 和 viewer 都只会得到 active workspaces。未关联的 platform admin 得到空列表。
- 设置 `include_archived=true` 后，owner 和 workspace admin 可以看到自身 workspace membership 仍为 active 的归档空间。Workspace member 和 viewer 只看到 active 空间；没有成员关系的 platform admin 仍看不到任何空间。
- 其他租户中的归档 workspace 相互隔离。`tenant_id` 过滤只返回调用者可访问的结果，`total`、稳定排序、分页大小和超范围空页面均反映过滤/授权后的集合。
- 暂停租户后，其 active 和 archived workspaces 都从包含归档项的列表中消失。恢复租户后可重新看到这些空间。移除管理员的租户成员身份会移除其 workspace memberships，并使其无法看到包含归档项的结果。
- `include_archived=true` 不会开放业务访问：使用 `get_workspace_context` 的测试 route 对归档 workspace 返回 `409 WORKSPACE_INACTIVE`，即使调用者是其 owner 也如此。

## 范围

本次使用 SQLite 验证了列表授权和现有业务上下文 guard，不涉及生产数据库并发或前端导航。未修改产品代码。

# F05 租户后端验收

**结果：** F05 租户及平台管理列表路径在已通过 Alembic `0002_tenants` 迁移的临时 SQLite 数据库上通过。邀请功能属于 F05a 范围，Workspace API 属于 F06 范围；两者均不计为本次平台列表验收失败。

## 范围与证据

可重复运行的 API 验收为 [test_f05_tenant_backend.py](../../apps/api/tests/verification/test_f05_tenant_backend.py)。该测试创建临时 SQLite 文件、迁移到 `0002_tenants`、创建普通全局账户、签发带签名的应用 Bearer token，并通过 `TestClient` 调用真实 FastAPI routes。使用的不是应用数据库。

在 API 虚拟环境中安装 `pytest` 后运行：

```sh
cd Synapse/apps/api
.venv/bin/python -m pytest -q tests/verification/test_f05_tenant_backend.py
```

实际结果：`1 passed, 2 warnings`。警告分别为 Starlette 的 `httpx` 弃用提示和 Alembic 缺少 `path_separator` 配置的弃用提示；均未影响结果。临时 SQLite 数据库由测试 fixture 创建，并在运行后丢弃。

已验证：

- `platform_admin` 使用选定的 active 全局账户作为租户 owner 创建租户，同时创建 `default` workspace 和初始 workspace-owner 授权。检查了持久化记录和十进制字符串 ID。平台管理员不会自动获得租户成员身份。
- 普通成员不能创建租户。选定无效 owner 时操作失败，不会留下租户或部分成员/workspace 记录。
- 租户列表按成员关系限定范围并分页。未关联租户的平台管理员得到空列表；已知租户 ID 仍可用于平台 get/status 管理 routes。
- `GET /api/v1/platform/tenants` 拒绝租户成员并返回 403；平台管理员无需成为成员即可发现租户。该 route 返回平台范围的租户基础数据，包括 suspended 和 archived 租户，并支持精确状态过滤、不区分大小写的名称子串过滤、确定性分页和 page size 校验。响应中的租户 ID 为十进制字符串，成员角色为 `null`。
- 数据库断言确认，平台列表不会给平台管理员创建 `TenantMember` 记录；即使查询 active、suspended 和 archived 租户，管理员仍不是租户成员。普通 `GET /api/v1/tenants` 仍按成员范围返回，行为未变。
- 成员不能更新租户设置、添加租户成员，也不能读取其他租户的详情/成员列表。跨租户读取详情返回 404，访问成员列表返回 403。
- 租户管理员可以管理非 owner 成员，但不能操作或提升 owner。租户 owner 可以管理成员。移除/降权最后一位 active tenant owner 会被 409 拒绝。
- 若租户成员是唯一 active workspace owner，停用该成员会被 409 拒绝。若 workspace 还有其他 owner，暂停该成员会将其 workspace membership 标记为 `removed`；重新启用不会恢复该关系，且 `/me/context` 不包含该 workspace。
- 检查了分页边界，以及响应中字符串形式的 tenant/workspace/user ID。

## 发现与限制

- **F05a 邀请范围：** 添加租户成员仅限已经存在的 active 全局账户。未验证创建/接受邀请、发送邀请链接或邀请生命周期。
- **F06 Workspace 范围：** 当前实现未提供 workspace 创建/读取/更新/成员 routes。通过租户创建响应和持久化记录验证了默认 workspace 与初始授权。Workspace 授权仅通过租户成员停用时的最后 owner 检查和移除 workspace membership 间接验证；这些 routes 存在前，无法直接测试 workspace ID API 授权。
- 验收使用 SQLite 和同步 FastAPI `TestClient`，不能据此确认生产数据库的并发/锁行为或外部邀请投递。

# F15a 租户字典 Service 化验收

## 当前结论

F15a 租户字典后端已完成渐进式 service 化。字典类型和字典条目的 HTTP 路径、请求字段、响应字段、状态码、错误码、字符串 ID、租户隔离和级联约束保持不变；F15b 前端已使用真实服务重新验收。

## 方案与边界

- 数据归属仍为租户级资源；所有类型和条目查询都通过已验证的 `TenantContext` 注入租户作用域。
- `app/api/tenant_dictionaries.py` 只负责依赖注入、查询参数、请求/响应模型、创建状态码和 204 响应。
- `app/schemas/tenant_dictionaries.py` 集中保存原有输入校验、分页响应、条目响应和重排响应契约。
- `app/services/tenant_dictionaries.py` 负责 owner/admin 权限、租户作用域、类型/条目查询、唯一冲突、完整集合重排、类型有条目时禁止删除、复合外键依赖和 `flush()`。
- service 返回不可变结果对象，不拼 HTTP 响应字典；业务异常通过全局 service error 映射为原有 problem 响应。
- service/router 均不显式调用 `commit()`、`rollback()` 或抛出 `HTTPException`；请求级 `get_db()` 继续拥有事务边界。
- 未引入 repository 层；SQLAlchemy `Session` 仍由 application service 直接使用。
- F15b 的 Windows runner 同步补齐了 `pnpm.cmd` 解析、子进程树终止、日志句柄关闭和 SQLite engine 清理，避免验收基础设施误报。

## 验证结果

在 F15a 工作树中运行：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests\verification\test_f15a_tenant_dictionaries.py
.\.venv\Scripts\python.exe -m compileall -q app
```

F15b 使用 Docker Redis `7.4.11`（`127.0.0.1:16381`）、临时 SQLite、真实 FastAPI/Vite 和 Chromium：

```powershell
cd apps/api
$env:F15B_SKIP_BUILD='1'
$env:SYNAPSE_AGENTSCOPE_REDIS_HOST='127.0.0.1'
$env:SYNAPSE_AGENTSCOPE_REDIS_PORT='16381'
$env:SYNAPSE_SCHEDULED_TASKS_ENABLED='false'
.\.venv\Scripts\python.exe tests\verification\run_f15b_tenant_dictionary_frontend.py
```

结果：

- F15a 定向 API/迁移回归：`1 passed, 2 warnings`
- F15b 真实 API/Vite/Chromium：`F15b tenant dictionary frontend verification passed`，退出码 `0`
- `compileall app`：通过
- router/service 边界扫描：通过；F15a router/service 不含 `HTTPException`、显式 `commit()` 或显式 `rollback()`
- Redis 连通性：`redis-cli ping` 返回 `PONG`

## 覆盖范围与限制

定向 API 和浏览器验收覆盖：

- 类型和条目 CRUD、分页、筛选、启停、排序；
- 同租户类型名称/key 和类型内条目 value 冲突；
- 有条目时阻止删除类型，清空后删除成功；
- owner/admin 与普通 member、平台管理员、外租户成员的权限隔离；
- 跨租户类型/条目 ID 访问拒绝；
- `(dict_type_id, tenant_id)` 复合外键和 SQLite foreign key enforcement；
- 前端租户切换、类型/条目管理、真实 API 持久化和权限提示。

本次未验证生产 PostgreSQL 的并发锁行为、真实模型推理或大规模数据性能；这些不属于字典 service 化改动范围。

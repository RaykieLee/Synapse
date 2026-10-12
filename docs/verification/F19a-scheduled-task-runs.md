# F19a 任务运行记录迁移与 API 验收

## 结果

通过。验证 `0014 → 0015 → 0016` 数据库迁移、真实 FastAPI TestClient 下的租户任务运行记录查询、权限及返回字段脱敏。只修正验收 fixture 的迁移基线和本报告，没有修改产品实现。

## 执行

在 `apps/api` 执行：

```sh
.venv/bin/pytest -q --tb=short tests/verification/test_f19a_scheduled_task_runs.py
```

结果：`1 passed, 2 warnings in 4.36s`。两条 warning 是 Alembic `path_separator` 缺省弃用提示。TestClient 使用实际 Synapse app lifespan 和本地 Redis `127.0.0.1:16381`；调度器通过设置关闭，以便运行记录数据可确定复现。

临时 SQLite 先迁移到 `0014_tenant_task_schedule_state`，使用该版本已有列创建两个租户的既有任务定义，再升级到当前 head `0016_tenant_validity`。迁移后确认版本为 0016、运行记录表存在、SQLite 外键开启，且原两个任务定义仍保留。

## 覆盖结果

- 直接写入 A 租户的 running/succeeded/failed 记录及 B 租户记录；API 返回字符串 ID、正确状态、时间、target、安全结果摘要及错误码。
- Owner 与 admin 均可查询。分页按开始时间倒序并返回正确 total/page/page_size；状态筛选及 `started_from`/`started_to` 时间窗筛选符合预期；无效状态和起止时间倒置返回 422。
- 成功详情返回 `{"expired_count": 3}` 安全摘要；失败详情返回 `HANDLER_ERROR`。响应中不包含原始 claim token、token hash、任务参数 sentinel、`claim_token_hash` 或 `parameters_json` 字段名。
- 普通 tenant member 收到 403 `FORBIDDEN`；无 tenant membership 的 platform admin 收到 403 `MEMBERSHIP_INACTIVE`，没有隐式绕过。
- A 任务下查询 B 任务或 B run ID，以及查询不存在的 run ID 均返回 404；A 身份直接访问 B tenant path 返回 403。
- SQLite 直接插入非法 run status 触发 CHECK `IntegrityError`；将 A tenant ID 与 B task ID 组合写入触发复合外键 `IntegrityError`。

## 限制

API 查询验收使用真实 FastAPI TestClient，但运行记录由 fixture 直接插入，并未在本验收中触发 scheduler runtime 执行；runtime 端到端行为由 F18b2c 单独验收。数据库验证使用 SQLite，未测试 PostgreSQL。

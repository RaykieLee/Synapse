# F18a 租户定时任务定义验收

## 结果

修复 PATCH 校验错误映射后复验通过。本测试将一次性 SQLite 数据库从 Alembic `0011_attachments` 升级到当前 head（本次运行是 `0013_tenant_resource_summaries`），并通过 `TestClient` 验收真实 Synapse FastAPI 定时任务定义 routes。

从 `Synapse/apps/api` 运行：

```text
.venv/bin/pytest -q tests/verification/test_f18a_scheduled_task_definitions.py
1 passed, 3 warnings
```

警告为 Alembic 既有的 `path_separator` 缺失设置，不影响测试。

## PATCH 回归与无写入证据

对于已有的 cron 任务，现在只带 `{"schedule_type":"interval"}` 的 PATCH 会返回受控的 HTTP 422。验收器在请求前快照持久化的 schedule type、cron expression、interval 字段、更新 actor 和 `updated_at`，随后确认这些值均未改变。清除 cron 字段并设置 interval 字段的有效完整转换仍然成功。

## 覆盖范围

- Migration 到达当前 Alembic head；检查租户任务表、tenant/name 唯一约束、target 和 schedule check constraints、interval 约束以及 SQLite `PRAGMA foreign_keys=1`。升级后既有租户、workspace 和附件记录仍存在。
- Owner/admin 可以读取允许的 target metadata 并管理定义；member 和仅平台角色的 actor 会被拒绝。
- 允许的 targets 符合明确列出的三个目标，并按租户范围隔离。不同租户允许同名任务；同租户重复名称会冲突。
- 创建并列出带 IANA timezone 的五字段 cron 定义；接受 10 秒和 365 天的 interval 边界值。拒绝无效 cron 表达式、混合调度字段、未知 target/timezone、超出范围的 interval 值、嵌套/超量/超大参数以及空白名称。
- 验证分页/过滤、启用/禁用、actor 审计字段、跨租户资源 ID 隐藏、软删除（已禁用且 API 不再可见），以及 owner/admin 与 member/platform 的访问控制。
- 直接 SQLite 插入违反 target allowlist、schedule 字段和 tenant/name 约束时，均触发 `IntegrityError`。

## 环境与限制

此 API 虚拟环境未安装 AgentScope；导入同级源码当前会因缺少 `aiofiles` 而停止。为调用真实根应用中的无关定时任务 routes，脚本只将 `app.main.create_agentscope_app` 替换为空 FastAPI child。因此不能据此验证 F20b embedding/lifespan。本次仅覆盖 SQLite/TestClient，不包括 PostgreSQL、并发任务编辑或 scheduler 执行（运行时属于 F18b）。

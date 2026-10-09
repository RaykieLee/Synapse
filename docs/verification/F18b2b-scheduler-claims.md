# F18b2b 持久化 scheduler claim 验收

## 结果

通过。验收覆盖 `0014_tenant_task_schedule_state` 迁移、租户任务的到期时间计算、持久状态、claim 并发和 lease 完成生命周期。只新增本报告与验收脚本，没有修改产品实现。

## 执行

在 `apps/api` 执行：

```sh
.venv/bin/pytest -q --tb=short tests/verification/test_f18b2b_scheduler_claims.py
```

结果：`1 passed, 2 warnings in 0.54s`。两条 warning 均为 Alembic `path_separator` 配置弃用提示。

脚本创建隔离 SQLite 文件库，运行 Alembic 至 head（确认版本为 `0014_tenant_task_schedule_state`），并检查 schedule state 表及 SQLite foreign key enforcement。任务定义覆盖 A/B 两租户的 cron、interval、停用及软删状态。

## 覆盖结果

- `America/New_York` 的 `0 9 * * *` 在 2026-10-01 的下一次执行时间计算为 `2026-10-01T13:00:00+00:00`（本地 09:00 EDT）；interval 任务按秒数计算 UTC `next_run_at`。首次扫描只物化未来运行时间，不提前 claim；初始停用和软删定义不创建 schedule state。
- 两个独立 worker/session 同时竞争一个已到期 slot，恰有一个获得 claim，slot 和 tenant ID 与持久定义一致。
- lease 到期后另一 worker 使用新 token 重领；旧 worker 的完成请求被拒绝，新 claim 可完成并推进下一次 interval 时间。
- 成功完成会推进 `next_run_at`；失败会清除 lease 并保留原 due slot，随后可立即重试。
- 对已 claim 的任务执行停用、定义修改及软删除，然后重新扫描：停用/软删除 state 清除旧 slot 和 lease，修改任务重算未来 slot；所有旧 claim 均不能完成。
- dispose 并重新创建 SQLAlchemy engine 后，已完成任务的下一次运行时间和并发获胜任务的有效 lease owner/token 仍从数据库恢复，验证持久化重启行为。

## 限制

并发 claim 使用同一进程内两个独立 SQLAlchemy session 竞争 SQLite 文件库；没有覆盖多进程部署或 PostgreSQL。Cron 样例验证普通时区偏移场景，不覆盖夏令时跳变边界。

# F18b2c FastAPI lifespan scheduler runtime 验收

## 结果

通过。0015 执行记录迁移到位后，两个 FastAPI lifespan poller 通过共享 SQLite claim state 协作，并执行真实 dispatcher/allowlisted handler。

## 执行

在 `apps/api` 执行：

```sh
.venv/bin/pytest -q --tb=short tests/verification/test_f18b2c_scheduler_runtime.py
```

结果：`1 passed, 1 warning in 1.13s`。warning 是 Alembic 缺省 `path_separator` 的弃用提示。临时 SQLite 迁移到 head `0015_tenant_scheduled_task_runs`；两个真实 FastAPI app lifespan 使用本地 Redis 7 endpoint 启动，各自运行 scheduler loop。

## 覆盖结果

- 两个 poller 竞争同一已到期 interval slot。`actual effect` 的执行记录恰为一条 succeeded，真实 `tenant.expire_pending_invitations` handler 将两条过期邀请更新为 expired，验证两个 worker 对单个 slot 只产生一次业务执行。
- `fail then retry` 的 test wrapper 只在第一次调用时抛一次 transient failure；runtime 写入 failed run 并释放 due slot，下一轮实际调用原 dispatcher 与真实 invitation handler，写入 succeeded run。
- `disable while claimed`、`modify while claimed`、`delete while claimed` 在真实 handler 调用前暂停 dispatch。测试修改持久化定义后放行，dispatcher 重新读取当前定义并拒绝；旧 claim 不能推进旧 slot，disabled/deleted state 清 lease 且 `next_run_at` 为空，已修改定义重新计算未来 slot。
- 预置一个模拟进程崩溃留下的持久化 expired lease 和 running run record。任一活跃 worker 重领并通过真实 handler 执行成功；旧记录保留为 running，恢复执行另加一条 succeeded 记录。
- 退出两个 lifespan context 会 await 两个 scheduler poller 完成优雅停机；验证改动定义无活动 lease，有效成功任务的 claim 已收敛。

## at-least-once 边界与限制

过期 lease 可恢复，但无法保证 exactly-once：进程可能在业务副作用提交后、claim 完成前崩溃，之后另一 worker 会重跑同一 slot，因此 handler 必须幂等。模拟崩溃留下的旧 run record 仍保持 `running`，当前 runtime 不负责回收该历史状态；恢复会创建新的 run record。测试在同进程内启动两个 FastAPI app lifespan，不是两个 OS 进程；SQLite 不等同生产 PostgreSQL 的并发特性。模型推理不是此任务目标。

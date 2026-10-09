# F18b1 过期租户邀请处理器验收

## 结果

通过。处理器验收使用已迁移至 Alembic `head` 的一次性 SQLite 数据库，直接调用生产函数 `expire_pending_invitations`。未修改产品代码。

在 `apps/api` 中运行：

```bash
.venv/bin/pytest -q tests/verification/test_f18b1_expire_invitations.py
```

2026-10-02 实际结果：`1 passed, 1 warning in 0.37s`。警告为 Alembic 既有的 `path_separator` 弃用提示，不影响迁移或断言。

## 证据

- 测试填充两个租户，以及 pending、accepted、revoked 和 already-expired 状态的邀请。
- 使用确定的 UTC 截止时间时，Tenant A 在截止时间前一微秒过期以及恰好在截止时间过期的 pending 邀请，都会转为 `expired`；处理器返回 `2`（`expires_at <= cutoff`）。晚一微秒才过期的邀请保持 pending。
- Tenant A 的 accepted/revoked/already-expired 记录保持不变。只处理 Tenant A 时，Tenant B 已过期的 pending 邀请仍保持 pending，证明更新按租户范围执行。
- 重复调用返回 `0`。两个并发调用竞争处理另一条已过期的 Tenant A 邀请，总计返回 `[0, 1]`，最终邀请为 expired。
- 非法 tenant IDs（`0`、负数、`bool`、float、string 和 `None`）触发处理器受控的 `ValueError`。正数但不存在的整数触发受控的 `LookupError`。

## 验收文件与限制

- `apps/api/tests/verification/test_f18b1_expire_invitations.py`

本次直接验证目标处理器，没有启动 polling scheduler 或 dispatcher。并发证据来自单进程内两个独立 SQLAlchemy sessions 的 SQLite；未覆盖 PostgreSQL 或生产多进程调度。

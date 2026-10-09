# F18b4 租户资源摘要重算验收

## 结果

通过。验证 `tenant.refresh_resource_summary` handler 和 `0013_tenant_resource_summaries` 迁移；只添加验收脚本与本报告，没有改动产品实现。

## 执行方式

在 `apps/api` 执行：

```sh
.venv/bin/pytest -q --tb=short tests/verification/test_f18b4_resource_summary.py
```

结果：`1 passed, 3 warnings in 0.38s`。警告是 Alembic 配置未设置 `path_separator` 的弃用提示，不影响本次执行。

脚本使用隔离临时 SQLite 数据库，先迁移到 `0012_tenant_scheduled_tasks`，建立双租户资源数据，再升级到当前 Alembic head。检查了迁移版本、摘要表及主键、SQLite 外键开关，并确认原有租户、Workspace、附件记录均保留且摘要表初始为空。

## 覆盖结果

- 两个租户各有成员、Workspace、附件、字典、参数配置、部门、自定义角色、菜单和任务定义。A 租户源数据另包含停用、删除、隐藏、撤权及归档等排除状态；摘要只计入应计数的有效记录。A 的预期数值均为 1，附件数为 2（包含其两条附件记录）；与 handler 返回及存储的 JSON 完全一致。
- 对 A 重算不会覆盖 B 的哨兵摘要。重复重算仍只有 A 的一行摘要，并用新的结果文档更新该行。
- 两个独立 SQLAlchemy session 并发重算 A，均返回预期计数；最终 A 仍只有一行，存储 JSON 正确，时间戳为其中一个并发请求的时间。
- 激活 A 的一个 Workspace 和一项配置后再次重算，Workspace 与配置计数各增至 2，其余计数不变；既有摘要被刷新，没有残留旧计数，B 仍未变化。
- `0`、负数、布尔值、浮点数、字符串和 `None` tenant ID 均受控抛出 `ValueError`；不存在的正整数 tenant ID 受控抛出 `LookupError`。

## 限制

并发检查在同一进程内使用两个独立数据库 session 和 SQLite 文件库完成；没有覆盖 PostgreSQL 或多进程并发。迁移兼容性覆盖本地当前 head 及预置行保留，不覆盖生产数据库快照。

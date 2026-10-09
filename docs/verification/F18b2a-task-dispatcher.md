# F18b2a 内部租户任务 dispatcher 验收

## 结果

通过。使用真实 `dispatch_tenant_task` 和三个实际 handler 完成隔离库验收。只新增本报告和验收脚本，没有修改产品代码。

## 执行

在 `apps/api` 执行：

```sh
.venv/bin/pytest -q --tb=short tests/verification/test_f18b2a_task_dispatcher.py
```

结果：`1 passed, 1 warning in 0.45s`。唯一警告是 Alembic 配置缺少 `path_separator` 的弃用提示。

测试创建临时 SQLite 数据库并迁移至 Alembic head，构造两个租户、三种白名单任务定义和实际邀请记录。dispatcher 根据传入的可信 task/tenant ID 重新查询持久化任务定义，再调用真实 handler。

## 覆盖结果

- 三种已允许 target 均成功执行，统一返回 `task_id`、`tenant_id`、`execution_target`、`status=succeeded`、`result` envelope。邀请过期任务仅将 A 租户的过期邀请转为 expired；B 租户邀请保持 pending。附件核对返回 A 的零 metadata 结果；资源摘要结果属于 A 且使用真实摘要 handler。
- A 的任务配 B tenant ID、B 的任务配 A tenant ID 均以 `task_not_found` 拒绝；关闭任务和软删任务均以 `task_unavailable` 拒绝。
- 非空 JSON 对象与畸形 JSON 参数都以 `invalid_parameters` 拒绝，不允许任务参数覆写租户上下文。
- SQLite 临时绕过任务表 target CHECK，将一个持久化行改为 `python:os.system` 后，dispatcher 以 `unsupported_target` 拒绝。其公开 Python 调用签名只有 `db`、`task_id`、`tenant_id`，调用者不能指定 handler 名称或 callable；未知 target 不会被动态加载/执行。
- 非正整数、布尔型 ID 以 `invalid_invocation` 拒绝；不存在的 task ID 以 `task_not_found` 拒绝。

## 限制

验收在临时 SQLite 上完成，没有测试 PostgreSQL。未知 target 检查通过临时关闭 SQLite CHECK 约束模拟损坏或历史异常记录；正常写入路径本身仍受任务表白名单约束。

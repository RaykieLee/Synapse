# F19b 系统任务执行记录前端验收

## 结果

通过。临时 SQLite 数据库迁移到 Alembic `head`（`0015_tenant_scheduled_task_runs`），启动真实 FastAPI 与 Vite 服务并由 Playwright Chromium 操作页面。`pnpm build` 通过，浏览器用例全部通过。

## 覆盖结果

- 测试数据包含租户 A 的两个任务、租户 B 的独立任务，以及 A 主任务的 21 条 mixed status runs（`running`、`succeeded`、`failed`），B 主任务有独立运行记录。
- owner 从任务列表打开“执行记录”，按 20 条分页查看 21 条记录；按 failed 状态筛选；用开始时间起止范围筛选到 6 条记录。
- 失败运行详情显示 `SAFE_HANDLER_ERROR`。成功运行详情显示安全结果摘要中的 `expired_count: 3`。
- fixture 故意在任务参数和 claim token hash 中放置 sentinel；显示的详情文本不包含参数 sentinel 或 claim token sentinel。运行记录 API 的 detail/list 响应由页面真实请求获取。
- admin 可打开主任务的执行记录面板。member 直达任务页后看不到“执行记录”或创建入口，显示权限拒绝；以 member token 调用真实 runs API 返回 HTTP 403。
- owner 在同一会话切换到租户 B 后只看到 B 主任务及其单条记录，切回租户 A 后恢复 A 的 21 条记录。
- `pnpm build` 的退出码为 0；F19b Playwright runner 输出 `F19b Playwright assertions passed`。

## 可重复运行

从 `apps/api` 目录运行：

```sh
.venv/bin/python -m pytest -q tests/verification/test_f19b_task_runs_frontend.py -s
```

runner 创建隔离 SQLite fixture、升级到 `head`、启动 FastAPI 和 Vite，执行 `apps/web/tests/verification/f19b_task_runs.mjs`，最后关闭服务。调度器关闭；本验收验证持久运行记录的前端读取，不执行真实计划任务。AgentScope lifespan 使用本机 Redis 6380 配置。

## 限制

本验证不覆盖调度器生成 run 的执行行为；该部分由 F18b 系列验证。Alembic 在迁移时输出 `path_separator` 弃用警告，但 head 升级及功能断言通过。

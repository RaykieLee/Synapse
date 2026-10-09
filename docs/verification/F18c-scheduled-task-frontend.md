# F18c 租户系统任务定义前端验收

## 结果

通过。使用隔离 SQLite 数据库迁移到 Alembic `head`（当前 `0015_tenant_scheduled_task_runs`），启动真实 FastAPI 和 Vite 服务，通过 Playwright Chromium 登录并操作前端。独立构建 `pnpm build` 通过。

## 覆盖范围与结果

- owner 登录可见任务定义列表；按名称、计划类型和启用状态筛选，并通过 21 条数据验证 20 条分页。
- 创建 Cron 定义时使用无效表达式，前端展示服务端 `VALIDATION_ERROR`；修正后成功创建。
- 执行目标选项仅包含 API allowlist 的三个目标。另以登录态直接提交非法目标，真实 API 返回 HTTP 422。
- 将新建任务改为 15 秒 interval 后保存成功；停用、重新启用及软删除操作成功。
- 在同一 owner 会话中切换租户 A/B：B 显示 `Beta Secret Task` 而不显示 A 的任务，切回 A 后任务数据正确恢复。
- admin 可打开任务列表并看到创建入口。
- 普通 member 直达任务管理页时看到“仅租户所有者或管理员可以管理系统任务定义”错误，不显示创建入口；真实 API 列表请求返回 HTTP 403。
- 浏览器访问均通过 Vite 代理转发到独立 FastAPI 进程；Playwright runner 断言全部通过。

## 可重复运行

从 `apps/api` 目录运行：

```sh
.venv/bin/python -m pytest -q tests/verification/test_f18c_scheduled_task_frontend.py -s
```

该 runner 会建立临时 SQLite 数据库并升级到 `head`，启动 API 与 Vite，运行 `apps/web/tests/verification/f18c_scheduled_tasks.mjs`，最后停止服务。测试期间定时调度器关闭，Redis 使用本机 6380 端口配置；任务定义页面及 API CRUD 本身不依赖任务执行。

## 限制

这次验收覆盖定义管理 API 和前端交互，不验证定时任务的实际执行；执行运行时由 F18b 验收覆盖。Alembic 发出 `path_separator` 配置弃用警告，不影响本次迁移或验收结果。

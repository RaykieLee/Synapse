# F16b 租户参数配置管理前端验收

## 结果

通过。`pnpm build` 成功；使用临时 SQLite 数据库迁移至 Alembic head `0016_tenant_validity`，启动真实 FastAPI 与 Vite，并通过 Playwright 对页面和 API 进行端到端验证。AgentScope/Redis 使用当前 Docker 容器的 `127.0.0.1:16381`。

执行命令：

```bash
docker run --rm -d --name synapse-f16b-redis -p 127.0.0.1:16379:6379 redis:7-alpine
cd apps/api
.\.venv\Scripts\python.exe tests\verification\run_f16b_tenant_config_frontend.py
```

runner 默认使用 `F16B_REDIS_PORT=16381`，也可通过环境变量覆盖。Windows runner 使用 `pnpm.cmd` 解析、进程树清理、日志句柄关闭和 SQLite engine 清理，避免验收基础设施误报。

## 覆盖结果

- Tenant A owner 与 Tenant B admin 使用同一用户身份；Tenant A 有 22 条配置，列表分页、名称/键名/分组/状态/敏感级别筛选均通过。
- owner 在 A 通过页面创建、编辑、停用并删除普通配置，API 返回和持久化状态正确。
- admin 在 B 通过页面创建、编辑、停用并删除配置，API 返回和持久化状态正确。
- 敏感值在列表不出现，仅点击“查看敏感值”后通过详情请求进入对话框；关闭后页面不再渲染该值。
- 延迟拦截 A 的敏感详情响应期间，在同一页面通过 SPA History/PopState 导航切换到 B；B 页面显示本租户数据且不显示 A 配置。释放晚到响应后，不出现敏感值或对话框。
- 在 A 打开未提交草稿后切换至 B，草稿标题和内容都不出现；切回 A 后草稿也不会恢复。A/B 配置列表缓存内容隔离。
- 普通成员查看租户详情时没有“参数配置”入口；直达管理页面显示权限提示且没有创建操作，真实管理列表、详情和创建 API 均返回 403。
- 敏感详情响应断言确认明文只在显式查看动作后返回；验收定位兼容当前页面的中英文 dialog `aria-label`。

## 验证文件

- `apps/api/tests/verification/run_f16b_tenant_config_frontend.py`
- `apps/api/tests/verification/f16b_tenant_config_frontend.mjs`

## 2026-10-12 复验记录

完整执行上述 runner，结果：`F16b tenant config frontend verification passed`，退出码 `0`。`pnpm build` 的 `tsc -b` 与 Vite production build 成功；真实 Redis 容器 `synapse-test-redis-f13c` 的 `127.0.0.1:16381` 连接正常。

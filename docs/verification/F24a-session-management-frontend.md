# F24a Workspace 会话管理前端验收

## 结果

**核心会话管理和 scope 隔离流程通过。** F26a 稳定后，完整 `pnpm build` 和真实 API 浏览器脚本成功；Playwright 输出 `F24a Session management frontend verification passed`，退出码 0。

## 执行与证据

- `pnpm build`（`apps/web`）：`tsc -b` 与 Vite production build 成功。
- `apps/api/.venv/bin/python apps/api/tests/verification/run_f24a_session_management_frontend.py`：退出码 0。
- 运行器创建临时 SQLite 并迁移到 Alembic head 0015，启动真实 FastAPI/AgentScope API、Redis（storage DB 5 / message bus DB 4）、Vite 和无头 Playwright。测试后清理 fixture Agent、会话和 Redis 运行锁。
- 数据包括 Alpha/Beta 两租户、Alpha 两个 Workspace、Beta 一个 Workspace，以及两个共享 Alpha Workspace 的 actor。
- UI 创建 Alpha 手动会话，重命名并设权限模式为 `explore`；真实 API 列表确认名称和模式已持久化。删除后列表不再包含该手动会话。
- Beta session ID 在 Alpha Workspace header 下请求真实 `GET /ai/sessions/{id}/status` 返回 404。
- AgentScope `TeamOrigin` session 不显示重命名/删除按钮。
- 测试 Redis session lock 令 running session 真实显示“运行中”，且重命名和删除控件均 disabled。
- Alpha 未保存会话对话框切换到 Beta Workspace 路由后关闭；Alpha/Beta 会话列表彼此隔离。返回 Alpha 后数据仍在。
- 同 Workspace 第二 actor 看不到 Alpha actor 私有 Agent 或会话。

## 独立观察

用同一 Alpha session ID、Alpha Workspace header，但传入 Beta agent ID 查询 `GET /sessions/{id}/status` 时，API 返回了 Alpha session 本身的状态（200）。这与本任务要求的 tenant/workspace/actor 跨 scope ID 检查不同，因此未作为 F24a 通过/失败依据；建议另行确认 Agent ID 与 session ID 不匹配时是否应拒绝。

## 可复跑

```bash
apps/api/.venv/bin/python apps/api/tests/verification/run_f24a_session_management_frontend.py
```

要求本地 Redis 可从 `127.0.0.1:6380` 访问；可通过 `F24A_REDIS_HOST` 和 `F24A_REDIS_PORT` 覆盖。

## 未覆盖

消息发送、工具执行与流式交互属于其他验收项，不在 F24a 范围内。

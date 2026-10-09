# F21c AgentScope SSE 鉴权上下文验收

## 结果

通过（流式鉴权与上下文传播）。验收使用真实 Synapse FastAPI/AgentScope app、Uvicorn、Redis 7 和临时 SQLite 数据库；测试 event feeder 仅负责注入可控 SSE 事件，完整经过实际 SSE 路由和 gateway。

## 执行

在 `apps/api` 执行：

```sh
.venv/bin/pytest -q --tb=short tests/verification/test_f21c_sse_auth_context.py
```

结果：`1 passed, 1 warning in 1.30s`。warning 是 Alembic 配置未设置 `path_separator` 的弃用提示。测试使用 Redis `127.0.0.1:6380` 的独立 DB 11/12，并迁移临时 SQLite 到当前 head。

## 覆盖结果

- 构造两个租户、三个 Workspace、actor 和 Workspace memberships。经真实 AgentScope `/agent/` 与 `/sessions/` API 创建 Redis session，session ID 分别携带 tenant/Workspace/actor scope。
- 用有效 Synapse JWT 连接真实 `GET /sessions/{id}/stream?agent_id=...` 路由。通过测试专用 publish route 向真实 Redis MessageBus 发布一个受控事件；SSE 客户端收到 `text/event-stream` 帧，帧内 tenant 和 Workspace ID 与请求上下文一致。未调用模型推理。
- 在 Redis replay `log_read`、live `subscribe` feeder 执行时捕获到同一不可变 `WorkspaceContext`。客户端收到事件后断开，feeder 完成清理；gateway reset 后 ContextVar 为 `None`。
- 缺失 JWT 返回 401；伪造 `X-User-ID`、`X-Tenant-ID` 分别返回 400。A1 session ID 在同租户 A2 Workspace 下返回 404。上述拒绝均没有读取 SSE replay 或启动订阅。
- 撤销 actor 的 A1 Workspace membership 后，同一 JWT 的新 SSE 连接返回 `403 WORKSPACE_MEMBERSHIP_REQUIRED`，不读取 Redis replay 或启动 feeder。
- WebSocket 握手由 gateway 拒绝，返回 HTTP 403。

## 限制

事件由测试专用 gateway 路由写入真实 Redis Pub/Sub，以验证 SSE 输出和上下文传播；没有可用模型凭据，未验证模型推理、AgentEvent 生成或推理期间取消。WebSocket 只验证 gateway 拒绝握手。

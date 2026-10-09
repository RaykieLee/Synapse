# F21b1 AgentScope 会话与消息存储作用域验收

## 结果

通过。测试以真实 Redis 7、临时 SQLite（Alembic head `0014_tenant_task_schedule_state`）启动真实 Synapse FastAPI 与 AgentScope ASGI 子应用，同一进程、同一 Uvicorn 端口。使用真实 AgentScope `POST /agent/`、`POST /sessions/`、会话读取/更新/删除路由；不替换 RedisStorage、会话服务或 API 路由。

执行命令：

```bash
docker run --rm -d --name synapse-f21b1-redis -p 127.0.0.1:16379:6379 redis:7-alpine
cd apps/api
.venv/bin/python -m pytest -q tests/verification/test_f21b1_agentscope_session_isolation.py
docker rm -f synapse-f21b1-redis
```

结果：`1 passed`。Alembic 配置有一条 `path_separator` 弃用警告，不影响验收。测试结束后 Redis 容器已删除，child lifespan 恰好进入/退出一次，RedisStorage 与 RedisMessageBus 连接资源已释放。

## 隔离环境

- 临时库有两个 Tenant、三个 Workspace：Tenant A 的 A1/A2，以及 Tenant B 的 B1；两个 actor 都在 A1 有成员关系，Actor A 还加入 A2，Actor B 还加入 B1。由此覆盖同一空间不同 actor、同一 actor 切换 Workspace、跨租户 Workspace 三种边界。
- 每个 actor/Workspace 组合经 AgentScope 实际 `POST /agent/` 和 `POST /sessions/` 创建资源。响应 session ID 带有 `tenant_id/workspace_id/actor_user_id` namespace；四个 ID 彼此不同。
- 启动后检查 `child.state.storage` 是 `WorkspaceSessionStorage`，且真实 `SessionService`、`ChatService` 的 `_storage` 与 child 的同一个 wrapper 实例相同。遍历上游 session router 的依赖图：列表、创建、更新、消息列表和 stream 直接依赖 `get_storage`；删除/状态依赖由 wrapper 构造的 `SessionService`；中断及 `/chat/` 依赖由 wrapper 构造的 `ChatService`。路由依赖检查通过。

## 覆盖结果

- 实际创建会话后，`GET /sessions/` 仅列出当前 actor/Workspace 前缀的 session；通过真实状态路由读取到 idle 状态，`PATCH /sessions/{id}` 修改名称后再从列表读取到新值。
- 消息创建与更新通过仅用于验收的临时 child probe 路由，以真实 `get_storage` FastAPI dependency 调用实际 `WorkspaceSessionStorage`：相同尾消息 ID 重写后仅保留一条且内容变为 `message-v2`。真实 `GET /sessions/{id}/messages` 返回更新后消息。
- 模拟一条由未加作用域的旧版 storage 直接写入的 legacy session。真实列表将其过滤掉；真实消息查询返回 404。缺少 namespace 的旧 session 不会自动进入当前 Workspace。
- 以 actor A/Workspace A2、actor B/Workspace A1、actor B/Tenant B/Workspace B1 三种上下文，直接将另一个 scope 的 session ID 传入 wrapper 的读取、列举、状态更新、upsert、消息读取/列举/upsert、team 更新及删除接口。读取返回空/不可见，列表为空，更新和消息写入拒绝，删除返回 false；真实消息、session Redis key 均未改变。
- 另将真实 Redis session key 字符串当作 session ID 传给 wrapper，并尝试读取/列举/删除；因其被当前作用域前缀化，不会命中原 actor 的 Redis key，读取为空、删除为 false。真实 Redis session 与 message key 的存在状态在攻击前后保持不变。
- 真实 `GET /sessions/{id}/messages`、`PATCH /sessions/{id}` 和 `DELETE /sessions/{id}` 对跨 Workspace、跨 actor 和跨 tenant 的外来 session ID 均返回 404；原 owner 仍能读取未变消息。
- 并发发送四个真实 HTTP 会话列表请求，分别使用 A/A1、A/A2、B/A1、B/B1 的 JWT 与 `X-Workspace-ID`。每个响应只返回对应组合的会话，ContextVar 请求上下文未串线。
- 真实 owner 删除 A1 session 后，session key 和 message list key 均已从 Redis 清除；随后消息查询为 404，另一 actor 在同一 Workspace 的 session 仍存在。

## 验收边界

验收 probe 路由只用于真实 child 中经 `get_storage` dependency 做消息 upsert、旧 session fixture 和 Redis key 状态检查。没有真实模型凭据，因此未执行需要模型 provider 的 `/chat/` 推理；`ChatService` 依赖及其持有的 storage 实例已核对。SSE stream 由 F21a 网关当前 503 拒绝，未执行 SSE 内部读取。此项覆盖 AgentScope session/message storage wrapper，不代表其他 AgentScope 资源（agent 以外的 KB、文件、credential、tool 或 team 等）均已完成资源级隔离。

## 验证文件

- `apps/api/tests/verification/test_f21b1_agentscope_session_isolation.py`

# F21a AgentScope Synapse JWT 与 Workspace 网关验收

## 结果

通过。真实 Synapse FastAPI 根应用与真实 AgentScope 子应用在同一 Uvicorn 进程、同一端口运行；使用临时 SQLite 数据库迁移至 Alembic head `0014_tenant_task_schedule_state`，并连接临时 Redis 7。脚本通过真实 HTTP 与原始 WebSocket 握手验证，不替换 AgentScope 子应用、认证依赖或网关。

执行命令：

```bash
docker run --rm -d --name synapse-f21a-redis -p 127.0.0.1:16379:6379 redis:7-alpine
cd apps/api
.venv/bin/python -m pytest -q tests/verification/test_f21a_agentscope_gateway.py
docker rm -f synapse-f21a-redis
```

结果：`1 passed`。Alembic 配置输出一条 `path_separator` 弃用警告，与验收无关。临时 Redis 容器已移除。

## 覆盖结果

- 临时库包含两个租户、三个 Workspace、平台管理员账号、两租户 owner；测试账号仅在租户 A 具有有效租户成员关系，并分别加入 A 的两个 Workspace。使用账号 JWT 通过根 API `/api/v1/health` 和 AI 子应用进行同进程检查。
- 脚本从 AgentScope 实际挂载路由树递归展开隐藏和懒加载路由，共发现 101 个路由对象、105 个唯一 HTTP 方法/路径组合、74 个 OpenAPI 路径。105 个组合逐一验证无凭证返回 401；伪造 `X-User-ID`、`X-Tenant-ID` 和重复 `X-Workspace-ID` 均返回 400。HEAD 按 HTTP 语义不返回响应体，故对 HEAD 检查状态码，对其他方法同时检查稳定错误码。
- AI 子应用内置的 OpenAPI、Swagger、Redoc 路由也包含在实际路由枚举中，均受相同网关约束。未发现脱离网关的 HTTP 入口。
- 带有效账号 JWT 与 Workspace A1 selector 时，临时 probe 收到冻结的 `WorkspaceContext`；actor 与 tenant 由服务端身份及 Workspace 派生，角色、权限集合和 membership version 与数据库数据吻合。切换至 Workspace A2 后得到该空间自己的 `viewer` 角色。平台管理员账号仅凭平台身份选择 Tenant B Workspace 仍被 403 `MEMBERSHIP_INACTIVE` 拒绝。
- 缺少 Workspace selector 返回 400 `WORKSPACE_CONTEXT_REQUIRED`；伪造 `X-User-ID` 返回 400 `IDENTITY_HEADER_FORBIDDEN`；伪造 `X-Tenant-ID` 返回 400 `TENANT_CONTEXT_FORBIDDEN`；重复 selector 返回 400 `CONTEXT_MISMATCH`。对 Tenant B Workspace 的访问不因 actor 的平台管理员身份而放行。
- 每次请求实时检查成员与资源状态：WorkspaceMember 移除返回 403 `WORKSPACE_MEMBERSHIP_REQUIRED`；TenantMember 暂停返回 403 `MEMBERSHIP_INACTIVE`；租户暂停返回 409 `TENANT_INACTIVE`；Workspace 归档返回 409 `WORKSPACE_INACTIVE`；账号停用使 JWT 请求返回 401。
- SSE 的真实 `/sessions/{session_id}/stream` 请求在有效上下文验证后返回 503 `AI_STREAM_CONTEXT_REVALIDATION_REQUIRED`。脚本包装该实际路由的 ASGI handler 并确认其调用次数为 0，说明 SSE 在访问会话/流处理逻辑前被短路。
- 当前 AgentScope 没有注册 WebSocket route。仍对真实挂载路径发送带有效 JWT/Workspace selector 的 WebSocket upgrade；握手收到 HTTP 403（无 101 Switching Protocols），网关在路由/资源处理前拒绝协议。
- AgentScope child lifespan 恰好进入和退出一次；Uvicorn 正常停止；RedisStorage 与 RedisMessageBus 的 client 和 owned connection pool 均关闭。

## 验收边界

临时 `/__f21a/context` probe 只用于验证中间件注入的可信上下文，不属于产品路由。此验收证明 HTTP 身份/Workspace 上下文网关覆盖和连接建立时的状态校验；不证明 F21b 后续资源 ID、session、文件、知识库等 AgentScope 业务资源已经按 tenant/Workspace 做数据级隔离，也不证明已经实现可撤权的长连接协议。SSE 和 WebSocket 当前明确拒绝。

## 验证文件

- `apps/api/tests/verification/test_f21a_agentscope_gateway.py`

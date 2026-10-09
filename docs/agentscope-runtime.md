# AgentScope 内嵌运行时

状态：F20b 内嵌实现已通过独立验收（见 `development-status.md`）；当前挂载公开 AgentScope 现有 API，但 tenant/协作 Workspace 隔离由 F21 单独实现。请勿将此挂载本身视为 F21 安全边界。

## 进程与 URL 映射

Run one Uvicorn application factory from `apps/api`:

```sh
uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
```

Synapse 路由仍位于 `/api/v1/...`。完整 AgentScope ASGI app 在进程内挂载于 `/api/v1/ai`，因此其 `/health`、`/sessions` 等子路由可通过 `/api/v1/ai/health`、`/api/v1/ai/sessions` 等地址访问。不会另启 AgentScope 进程或增加代理跳转。除非框架环境禁用，AgentScope OpenAPI 位于 `/api/v1/ai/docs`。

内嵌工厂位于 `apps/api/app/integrations/agentscope.py`；`app.main.create_app()` 创建并挂载它。父 FastAPI lifespan 会显式进入一次 `agentscope_app.router.lifespan_context(agentscope_app)`，并在关闭时退出。由于 Starlette 不会自动运行挂载子应用的 lifespan，因此必须显式管理。若进入子应用资源时启动失败，统一应用启动也会失败。

## 依赖与运行配置

`apps/api/pyproject.toml` pins AgentScope to source commit `72f3f6fa0b2fc38b8517f408ab616f0f2bd229e6` from the upstream repository and enables only its `service` and `storage-redis` extras. Existing Synapse FastAPI/Uvicorn bounds are retained; Redis, APScheduler, and AG-UI protocol receive explicit resolver bounds. Qdrant is not installed or initialized in this baseline because no knowledge-base manager is wired yet. Add `vdb-qdrant` only with the later persistent knowledge-base adapter.

A full platform-specific lock file has not been generated. Before production rollout, resolve and lock direct and transitive dependencies for the supported Python/platform set, including FastAPI, Starlette, Pydantic, Uvicorn, Redis, APScheduler and AG-UI protocol; commit the lock and record the resolved versions. The upstream commit pin and dependency ranges alone are not proof of a compatible environment.

Settings use the `SYNAPSE_` prefix:

| Setting | Default | Purpose |
| --- | --- | --- |
| `SYNAPSE_AGENTSCOPE_REDIS_HOST` | `localhost` | Redis host for AgentScope state and message transport |
| `SYNAPSE_AGENTSCOPE_REDIS_PORT` | `6379` | Redis port |
| `SYNAPSE_AGENTSCOPE_REDIS_PASSWORD` | unset | Optional Redis password |
| `SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB` | `1` | AgentScope records database |
| `SYNAPSE_AGENTSCOPE_BUS_REDIS_DB` | `2` | AgentScope message-bus database |
| `SYNAPSE_AGENTSCOPE_WORKSPACE_PATH` | `./var/agentscope/workspaces` | Persistent local runtime workspace directory |
| `SYNAPSE_AGENTSCOPE_DOWNLOAD_SECRET` | unset | Optional stable secret for signed downloads; configure it for restart-safe links and keep it in the secret manager |
| `SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY` | unset | Required Fernet key before storing or running model credentials; keep it stable in the deployment secret manager |

Redis storage 与 bus 使用不同逻辑数据库，但仍共享同一 Redis server 及其可用性/安全边界。本地工作目录必须位于持久化存储上，并配置适当的文件权限与备份策略。基线配置未接入知识库、vector database、blob store、模型 provider、channel 或外部凭据。此初始挂载禁用了 scheduler 和 channel worker；目前尚无单一所有者后台 worker 的部署拓扑。

## 认证与当前限制

子应用在路由前安装 `AgentScopeWorkspaceGateway`。Gateway 使用 Synapse bearer JWT 或 session cookie 认证每个 HTTP 请求，拒绝客户端提供的 `X-User-ID` 和 `X-Tenant-ID`，根据当前账号、tenant 和 Workspace 成员关系校验 `X-Workspace-ID` 选择器，然后将不可变 `WorkspaceContext` 注入 ASGI request state。AgentScope 的 `get_current_user_id` 从已验证上下文读取 actor。错误响应使用 Synapse Problem JSON。

已固定版本的 session SSE endpoint 会在每次请求通过 JWT/cookie 与当前 Workspace 成员资格检查后开放。已验证上下文会在整个 ASGI 流式响应期间保持绑定，并在响应完成或取消后重置。成员资格撤销会阻止重新连接和新请求，但不会终止已建立的 stream；该 stream 可能持续至客户端断开或服务器关闭。由于尚未接入经过认证的 WebSocket 协议，WebSocket 握手仍会被拒绝。参见 [F21a 请求上下文](agentscope-tenant-context.md)。

F21a provides request identity/context wiring only and has not been independently verified.

F21b1 adds a context-bound storage wrapper for conversation sessions and
messages. Session IDs and message storage keys include the verified tenant,
Workspace, and actor namespace; foreign scoped IDs are denied and listing is
filtered. See [session isolation contract](agentscope-session-isolation.md).
F21b1 已通过独立验收，但不会隔离其他 AgentScope 资源类别。

F21b2b1 also namespaces AgentScope agent definitions by verified tenant,
Workspace, and actor, and filters list/detail/update/delete through that
namespace. See [agent isolation contract](agentscope-agent-isolation.md).
其他资源类别仍需分别完成隔离实现与验收。

F21b2b2 namespaces knowledge-base and document metadata IDs and session
references. The current embedded app has no knowledge-base manager, vector
store, or blob store, so those routes remain unavailable (503). Metadata
namespacing does not isolate Qdrant/vector collections or blob objects; see
[knowledge metadata contract](agentscope-knowledge-base-isolation.md) and
complete F29 before enabling indexing.

F21b2a 已通过独立验收：本地 runtime 工作目录按 tenant/Workspace/actor 分层，将用作路径段的 agent ID 哈希，拒绝绝对路径/目录穿越/符号链接逃逸，并禁用不受限的主机 shell 工具。协作 Workspace 内的文件仍为 actor 私有。参见
[workdir isolation contract](agentscope-workdir-isolation.md). This is not an
OS sandbox and has not been independently verified.

F21b2b3 namespaces MCP library metadata by tenant/Workspace/actor and gates
workspace connections on an enabled scoped configuration. Legacy unscoped
records are invisible. Synapse does not broker MCP credentials or configure
external MCP hubs; treat MCP configurations as secrets and apply deployment
egress policy. See [MCP isolation contract](agentscope-mcp-isolation.md).

F21b2b4 scopes Skill library IDs and per-agent Skill files by
tenant/Workspace/actor. Legacy unscoped records are invisible, and the
deprecated server-local path install endpoint is rejected. The factory does
not configure Skill hubs or global seed Skills; see
[Skill isolation contract](agentscope-skill-isolation.md).

F21b2b5 scopes credential IDs and storage owners and encrypts credential
payloads at rest. API projections expose only provider type/name; the runtime
resolver decrypts within the verified scope. Configure
`SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY` before credential writes or
model runs; no provider credentials are configured. See
[model credential isolation contract](agentscope-model-credential-isolation.md).

## 验收状态

F20b 已完成独立验收：同进程路由映射、父子 lifespan 启停一次、认证覆盖（含拒绝伪造 `X-User-ID`）、存储路径配置及 Redis 下的健康/错误行为均有验收记录。此状态仅适用于 F20b 内嵌集成，不代表其他 AgentScope 功能均通过。

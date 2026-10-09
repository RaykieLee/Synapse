# F21a AgentScope 请求认证与 Workspace 上下文

状态：F21a gateway 已通过独立验收（见 `development-status.md` 中 F21a）。该桥接会认证 AgentScope 请求，并将其绑定到当前 Synapse tenant 与 Workspace 成员关系；它不隔离 AgentScope 资源记录、Redis key、runtime 目录或 ID，这些属于 F21b 范围。

## 请求约定

`/api/v1/ai` 下的每个 HTTP 请求都会先由 `AgentScopeWorkspaceGateway` 拦截，再进入子路由；即使路由未声明 AgentScope 用户依赖也一样。

1. 拒绝 `X-User-ID` 并返回 `400 IDENTITY_HEADER_FORBIDDEN`，因此该 header 不能选择 actor。Actor 来自 Synapse bearer JWT 或 `synapse_session` cookie；每次请求都会检查账号状态、软删除状态和 `token_version`。
2. 拒绝 `X-Tenant-ID` 并返回 `400 TENANT_CONTEXT_FORBIDDEN`。Tenant 根据所选 workspace 记录派生。
3. 必须且只能提供一个十进制 `X-Workspace-ID`。它仅用于选择上下文，不授予成员资格。缺失、格式错误或提供多个值时，现有 workspace context dependency 会拒绝请求。
4. Gateway 使用当前数据库调用 Synapse `get_workspace_context`。若账号/tenant/workspace 未激活、tenant 成员关系未激活，或 workspace 成员关系未激活，则拒绝请求。生成的不可变 `WorkspaceContext` 包含 actor ID、tenant ID、workspace ID、tenant 和 workspace 角色、权限集合及成员关系版本。
5. 在任何 AgentScope router 运行前，上下文会附加到 ASGI `scope.state.synapse_context`。AgentScope 的 `get_current_user_id` dependency 现在从已验证上下文读取 `actor_user_id`，不再读取客户端输入。

上下文解析使用线程池中的短生命周期 SQLAlchemy session，避免同步数据库调用阻塞 ASGI event loop。认证/上下文错误使用 `application/problem+json` 和 Synapse 统一错误信封。意外数据库错误会安全失败并返回 `500 INTERNAL_ERROR`。

## 流式协议

- 已固定版本的 AgentScope 源码提供长连接 SSE 路由 `GET /sessions/{session_id}/stream`。Gateway 在调用子 app 前认证请求，并校验当前账号、tenant、Workspace 与成员关系状态，因此 AgentScope 会在创建响应流前检查会话作用域。Gateway 会在整个子 ASGI 响应调用期间保持已验证的 `WorkspaceContext`，包括响应 body 迭代期间。Starlette stream task 与 AgentScope Redis feeder 会继承该上下文。正常完成、断连取消或发生异常后，gateway 均会在 `finally` 中重置 ContextVar token。
- 成员关系在建立 stream 时检查。若响应 header 发送后访问权限被撤销，已建立的 SSE stream 不会主动重新验证或终止；它可能持续发送该会话事件，直到客户端断开或服务器关闭 stream。每个新 HTTP 请求（包括重连）都会重新授权，并拒绝已撤销的成员资格。这是当前对运行中请求的撤权语义，不是持续授权。
- 固定版本源码没有 WebSocket 路由。在实现经过认证且可响应撤权的消息循环前，Gateway 会关闭所有 WebSocket 握手，包括未来增加的路由，返回代码 `4403` / 原因 `AI_WEBSOCKET_UNAVAILABLE`。
- 其他 HTTP 路由（包括流式文件/文档响应）也会在请求开始时进行授权检查。如果成员关系之后改变，桥接不会中断已开始的响应。

## 范围边界

Gateway 仅提供可信请求身份和当前授权上下文，不会更改 AgentScope 存储所有权查询、资源访问策略、持久化实体 ID、Redis key 命名空间、本地 runtime workspace 映射、blob 路径、后台任务 payload 或资源共享行为。现有 AgentScope 用户作用域数据仍只按 actor ID 建键，尚不能据此认定已按 tenant/Workspace 隔离。`X-Workspace-ID` 会作为当前成员上下文进行校验，但尚未加入资源查询。不要将此 gateway 视为 F21b 已完成，或视为允许共享 tenant AI 资源。

F21a 独立验收已覆盖伪造 header 拒绝、bearer/cookie 认证、过期 token/账号状态、workspace selector 隔离、各状态/成员资格门禁、SSE 回放与实时投递期间的上下文、断连取消清理、撤权后的重连授权及 WebSocket 拒绝行为。相关证据见 `development-status.md`。

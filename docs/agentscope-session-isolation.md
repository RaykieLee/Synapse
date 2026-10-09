# F21b1 AgentScope 会话与消息隔离

状态：已通过独立验收（见 `development-status.md` 中 F21b1）。本文仅覆盖持久化会话与消息历史，不代表 F21b 的所有资源隔离均已完成。

## 命名空间约定

`WorkspaceSessionStorage` 封装已配置的 AgentScope Redis storage，并根据 F21a 请求 gateway 绑定的不可变 `WorkspaceContext` 派生 session ID 前缀：

```text
synapse-s{tenant_id}-w{workspace_id}-u{actor_user_id}-{session_id}
```

创建操作会分配带此类前缀的服务端生成 ID。现有会话操作仅接受带当前前缀的 ID；带有其他 Synapse 前缀的 session ID 按未找到处理（写入时则拒绝）。适配器将此规则用于 get/list/update/delete、team-session 引用、状态持久化及消息读写。列表仅筛选当前前缀下的记录。因此，同一 actor 在另一 Workspace，以及同一 Workspace 中的另一 actor，都会对应不同的持久化 session key。

Redis session 和 message key 均包含带作用域的 session ID。AgentScope message-bus key 也由同一 ID 派生，因此并发运行锁、inbox、回放/事件和中断路由各有独立命名空间。存储中的 session owner 仍是 Synapse actor ID；tenant/Workspace 授权信息不会从会话请求 body 接受。

内嵌的 `GET /sessions/{session_id}/status?agent_id=...` 边界会在 AgentScope 检查 Redis run lock 前，检查当前作用域存储会话中的 `agent_id`。会话不存在、属于其他作用域或 agent 不匹配时，均返回相同的 404 `RESOURCE_NOT_FOUND`，避免通过不匹配的 agent 探测会话是否正在运行或暂停。有效的 session/agent 组合仍返回上游状态结果。此检查仅适用于状态探测；session SSE 继续使用既有的会话所有权和作用域授权路径。

## 上下文传递与限制

F21a gateway 在分发子请求时会将已验证上下文绑定到 `ContextVar`。常规进程内 asyncio 子任务会继承该绑定；若未绑定上下文却尝试持久化会话，适配器会默认拒绝。独立 worker 进程和外部队列任务不会继承 Python 上下文。启用这些路径前，必须在任务 payload 中持久化 tenant ID、Workspace ID、actor ID 及授权/版本引用，并在访问会话存储前重新检查当前成员资格。

包装器也按 `agentscope-agent-isolation.md` 为智能体定义 ID 添加命名空间；按 `agentscope-knowledge-base-isolation.md` 为知识库与文档元数据 ID 添加命名空间；并按 `agentscope-mcp-isolation.md` 处理 MCP 库记录。其他非会话存储操作仍直接透传。当前尚未为计划任务本身、作为独立资源的 teams、channels、SOP、runtime 工作目录、下载内容或资源共享策略添加命名空间。会话配置可能引用尚未完成自身隔离的资源。不能将本实现视为这些资源的完整授权边界。

此适配器启用前创建的 AgentScope session ID 不带 Synapse 前缀，因此不会出现在作用域列表中，也无法通过新 API 访问。生产部署前需要受控迁移，或明确处理旧数据；适配器不会从旧记录推断 tenant。Session ID 现已变长，下游使用方必须将其视为不透明字符串，不要只按 UUID 格式校验。

## 独立验收

独立验收已覆盖：同一 actor 的两个 Workspace、同一 Workspace 的两个 actor 无法读取、更新、删除对方会话或追加消息；伪造 session ID 会被拒绝；列表/创建隔离；Redis key 和 SQL 行包含作用域 ID；bus 锁/inbox/回放 key 不冲突；请求创建的 chat task 保留上下文；缺少上下文的操作被拒绝。后续实现变更应重复这些检查。

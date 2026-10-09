# F21b2b3 AgentScope MCP 配置隔离

状态：配置元数据隔离已通过独立验收；外部连接仍待验证（见 `development-status.md` 中 F21b2b3）。本文说明 MCP 库元数据及授权配置建立实时 workspace 连接的边界，不提供外部凭据代理或 MCP hub 集成。

## 命名空间与 API 行为

`WorkspaceSessionStorage` 根据 F21a 验证后的 `WorkspaceContext` 派生 MCP 存储键：

```text
MCP ID:       synapse-mcp-t{tenant_id}-w{workspace_id}-u{actor_user_id}-{id}
storage user: synapse-mcp-owner-t{tenant_id}-w{workspace_id}-u{actor_user_id}
```

合成 storage owner 由服务端生成，用作 AgentScope Redis/SQL 存储键中的 owner 部分及每个 owner 的唯一名称索引。它不是经认证的账号，且不会接受请求数据中的该值。因此，MCP 列表、详情、更新和删除操作只访问当前 actor 的 tenant 与 Workspace 下的记录。其他作用域的 Synapse ID 按不存在处理；原始 ID 仅在创建时接受。没有 Synapse 作用域前缀的旧记录会被隐藏，也不能通过猜测 ID 接管。

Workspace MCP API 按 MCP 名称关联库配置。`ScopedWorkspace` 只有在库记录已启用且配置完全匹配时才会将 MCP 加入工作目录。上游 add 操作打开连接前，手动配置会先写入当前命名空间。上游从库添加的路由通过同一作用域存储适配器解析 ID，因此其他作用域的 ID 不能授权连接。解析工具前，包装器会将已持久化的 `.mcp` 声明与已启用记录进行过滤；也会关闭该 agent/session workspace 中已禁用或移除名称对应的现有连接。

因此，MCP 的有效 runtime 作用域为 tenant + 协作 Workspace + actor。共享协作 Workspace 的 actor 之间不共享 MCP 配置或实时工具连接。Agent/session workspace 配置存储在
[F21b2a](agentscope-workdir-isolation.md) 所述的工作目录边界下，会话/工具引用使用 F21b1 会话命名空间。

## 可用性与限制

内嵌应用在 `/api/v1/ai` 下开放上游 MCP 配置/库及 workspace 路由。部署方必须通过现有 AgentScope API 提供 MCP client 配置及所需连接材料。Synapse 尚未代理、加密、轮换或集中授权外部 MCP 凭据；配置本身可能含有密钥，应按敏感信息处理。未配套独立出口控制和凭据策略前，不要允许不可信用户安装任意网络端点。本功能未添加 hub 目录配置、密钥脱敏变更或 Skills 支持。

命名空间强制执行依赖请求经过 F21a gateway，由它为子 ASGI app 绑定已验证上下文。使用 MCP 存储的后台 worker 必须携带等效授权上下文并重新检查；Python 请求上下文不会自动传递到独立 worker。禁用/移除操作会在下次解析 workspace 的 MCP 列表时生效；这不会即时推送撤权，也不会中断已运行的外部调用。

## 独立验收

Redis/SQL 存储键与 owner 作用域、两个 tenant/Workspace/actor 下的列表/详情/更新/删除及从库添加行为、旧的无作用域记录隐藏情况、伪造的外部 ID、手动配置持久化、已禁用/删除 MCP 的过滤及连接关闭，以及缺少已启用作用域记录时传入 workspace `.mcp` 声明不会建立连接，均已按台账所列范围核验。外部 MCP 握手/工具调用及 detail 路由仍待补验。还应审查哪些 MCP 路由可能返回配置或密钥字段。

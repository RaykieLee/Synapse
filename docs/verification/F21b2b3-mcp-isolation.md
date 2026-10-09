# F21b2b3 AgentScope MCP 隔离验收

**结果：scoped MCP metadata、授权和 disabled/removed 声明门控通过；成功连接外部 MCP 的行为仍未验证。**

## 运行与证据

可重复检查：`apps/api/tests/verification/test_f21b2b3_mcp_isolation.py`。

在 `apps/api` 中运行：

```sh
F21B2B3_REDIS_PORT=6380 .venv/bin/pytest -q -rs tests/verification/test_f21b2b3_mcp_isolation.py
```

2026-10-02 执行结果：**2 passed**。6380 端口的 Redis 可访问。直接 proxy 测试使用 Redis DB 11；ASGI gateway 测试使用 DB 11 存储和 DB 10 message bus。测试只清理自己的 scoped fixture keys，不会清空 Redis。Gateway 测试使用迁移到 Alembic head 的临时 SQLite 数据库、真实 JWT 身份认证、真实租户/Workspace 成员检查、嵌入式 AgentScope app 和 Redis scoped storage。

Proxy 场景覆盖两个租户、两个 Workspaces 以及两个共享 Workspace 的 actors。验证 scoped MCP 创建/列表/读取/删除、合成存储 owner 身份、跨 scope IDs 不存在、旧版未限定记录保持不可见，以及 enabled/disabled/removed 检查。`ScopedWorkspace.add_mcp` 会先在当前 scope 存储手工配置，再执行委派；若 library 记录已禁用或同名配置不匹配则拒绝。`ScopedWorkspace.list_mcps` 仅保留 enabled scoped library entries，并在条目被禁用或移除时关闭/移除注入的缓存 live handles。

Gateway 场景通过真实 `/workspace/mcp` route 手动安装无状态 MCP 配置，在 `/mcp` 中观察该配置，并确认列表响应不含 `mcp_config`。测试 endpoint `127.0.0.1:9` 故意不可用：workspace MCP 列表将其报告为不健康。禁用 library 记录后，下一次 workspace 列表为空；删除后，该项从 library 和 workspace 列表中移除。其他 actor 和同一 actor 在另一 Workspace 下，都不能通过 `/workspace/mcp/from-library` 列表、更新、删除或安装该外部 library ID。

## 限制/未覆盖表面

固定版本 MCP library router 有 `GET /mcp` 列表、`PATCH /mcp/{mcp_id}` 和 `DELETE /mcp/{mcp_id}`，但没有 `GET /mcp/{mcp_id}` 详情 endpoint；即使 owner 请求也确认返回 405。Proxy 的 `get_mcp` 方法已直接覆盖，但没有 HTTP 详情 route 可供验证。

没有可用的外部 MCP server 或凭据。真实 gateway 测试证明 metadata 持久化和授权，并观察到连接故意关闭的 localhost 端口时失败；不能证明与外部服务成功进行协议协商或调用工具。缓存客户端关闭行为在 `ScopedWorkspace` 边界使用已连接的测试 handle 验证；真实 route 使用的无状态 client 从未成功建立真实连接。本次未修改产品代码。

# F21b2a AgentScope 工作目录与文件隔离

状态：已通过独立验收（见 `development-status.md` 中 F21b2a）。本文仅说明本地 runtime 工作目录与文件访问范围。

## 根目录与共享语义

`ScopedLocalWorkspaceManager` 使用 F21a 验证后的 `WorkspaceContext`，将工作目录置于以下路径下：

```text
{configured_root}/tenant-{tenant_id}/workspace-{workspace_id}/actor-{actor_user_id}/agent-{sha256(agent_id)}
```

actor 路径段是有意设计：即使协作 Workspace 为共享空间，工作目录/文件仍是 actor 私有的。同一协作 Workspace 中的两个 actor 不共享 runtime 文件。Runtime workspace ID 在进入上游缓存前会按 tenant、协作 Workspace 和 actor 添加命名空间；带有其他 Synapse 命名空间的 ID 会被拒绝。Agent ID 在用作路径段前会先哈希。

## 路径访问

管理器会在打开 workspace 前检查配置的根目录和生成的路径组件，并拒绝工作目录内已有的符号链接。封装后的本地后端会在文件读取、写入、流式传输、列举、stat、存在性检查和删除时拒绝 workspace API 路径解析中的绝对路径、`..` 组件、工作目录外路径及符号链接组件。内置文件工具内部使用绝对路径，因此只有解析结果位于当前作用域工作目录内时才接受；任意主机路径均会被拒绝。后端以进程内受限目录创建替代 Write 的 `mkdir -p` 子进程，并禁用其他主机命令执行。因此，依赖命令执行的 Glob/Grep 工具目前无法在此本地后端使用。AgentScope workspace 路由及内置 Read/Write/Edit 使用此受保护后端。

该防护应用于已固定版本的本地后端，但它不是内核 sandbox；进程仍拥有主机访问能力，能够并发修改工作目录的外部主体可能造成检查时与使用时不一致（TOCTOU）竞态。生产环境加固应使用专用 OS/container sandbox，或基于文件描述符并禁止跟随符号链接的操作。不要在此后端启用不可信 shell 执行。

## 范围边界与验收

该工作目录边界不隔离知识库 vector index、Skills、凭据或其他 AgentScope 资源。MCP 库元数据与 workspace 连接授权边界由
[F21b2b3](agentscope-mcp-isolation.md) 单独说明。此功能不会迁移旧 `{root}/{agent_id}` 布局下的文件。独立验收已完成；后续变更应复验同一 Workspace 的两个 actor、同一 actor 的两个 Workspace、绝对路径/目录穿越输入、符号链接祖先及目标、所有文件路由/工具、shell 禁用状态，以及持久化目录的重启恢复。

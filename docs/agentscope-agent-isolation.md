# F21b2b1 AgentScope 智能体定义隔离

状态：实现已完成，**独立验收已通过**（见 `development-status.md` 中 F21b2b2b1、F23a1）。本文说明 AgentScope 智能体定义/配置的用户可见接口范围。

## 命名空间与所有权

存储适配器在已验证上下文对应的命名空间下分配 ID：

```text
synapse-agent-t{tenant_id}-w{workspace_id}-u{actor_user_id}-{agent_id}
```

actor ID 仍是存储所有者；带作用域的 agent ID 可区分同一 actor 在不同协作 Workspace 中的定义。智能体列表仅返回当前 tenant/Workspace/actor 前缀下的记录。详情、编辑和删除只接受当前前缀的 ID；其他作用域的 ID 按未找到处理。创建及团队创建的智能体记录会在持久化前获得作用域 ID。存储后端原有的用户所有者检查仍作为第二道边界。

会话记录持久化返回的公开 agent ID，因此会话查找、聊天智能体解析和删除智能体时的级联操作使用同一作用域身份。ID 是不透明字符串，客户端不得假设其为 UUID。没有 Synapse 前缀的旧智能体记录不会出现在列表中，也无法通过新路由访问；系统不会为其推断 tenant。

## 详情读取接口

Synapse 在内嵌的 AgentScope ASGI 应用中新增 `GET /api/v1/ai/agent/{agent_id}`。上游目前为智能体注册了列表/创建及 PATCH/DELETE 接口，但没有按 ID 获取的 GET 路由（此前该方法返回 405）。新增处理器使用 Synapse AI gateway 建立的身份，调用注入的作用域存储适配器 `get_agent`。响应采用 AgentScope `AgentView` 结构；当前 actor 自有定义的 `editable` 为 `true`。接口不会查找原始 ID、调用资源共享机制，也不会使用客户端提供的 owner ID。

其他作用域、旧格式及未知 ID 均返回相同的 404 `RESOURCE_NOT_FOUND` 响应。响应受 `AgentView` 结构约束；智能体定义不包含模型凭据内容，凭据记录仍由独立的作用域适配器脱敏。该路由实现已纳入独立验收证据，但不代表 AgentScope 整体内嵌或所有资源隔离均已验收。

## 范围边界

本功能不隔离模型凭据、知识库、MCP、Skills、独立的计划任务资源，也不涵盖前端行为。它不开放跨用户智能体共享；共享仍由当前存储/资源策略决定，默认策略为全部拒绝。独立验收已覆盖证据见 `development-status.md` 与 `docs/verification`；后续如修改实现，应复验：同一 actor 的两个 Workspace、同一 Workspace 的两个 actor 对 create/list/detail/update/delete 的隔离、伪造 ID、owner 检查及作用域会话/聊天引用。

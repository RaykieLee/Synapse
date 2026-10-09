# F21b2b2 AgentScope 知识库元数据隔离

状态：元数据隔离已通过独立验收；知识库路由与索引尚未验收（见 `development-status.md` 中 F21b2b2b2、F29）。当前内嵌应用未配置知识库服务。

## 元数据作用域

绑定 F21a 上下文的 AgentScope 存储适配器按以下格式为知识库 ID 添加命名空间：

```text
synapse-kb-t{tenant_id}-w{workspace_id}-u{actor_user_id}-{kb_id}
```

文档 ID 也带有作用域，并包含其父级作用域 KB ID 的摘要。适配器在元数据 upsert/get/list/delete 及文档状态/租约操作中使用这些 ID。列表仅返回当前命名空间的记录；其他命名空间的直接 ID 按未找到处理或安全拒绝。原 actor ID 仍是 owner 字段，Redis/SQL 存储所有者原有的检查也继续生效。未带作用域的旧记录不会出现在列表中，也无法访问。写入会话时，`knowledge_base_ids` 引用会规范化为当前作用域 ID；其他作用域的引用会被拒绝。

## 当前可用性与索引限制

内嵌的 `create_agentscope_app` 未配置 `knowledge_base_manager`、vector store 或 blob store。因此，在明确接入这些服务前，上游知识库 API 依赖会返回 `503`；本任务没有添加模拟服务，也不声称 CRUD/索引管线可运行。

AgentScope 的 `CollectionPerKbManager` 会先创建 vector collection，再持久化元数据记录；collection 名称由原始生成 ID 派生。本适配器为持久化 KB ID 添加作用域，但不会改变 Qdrant/vector-store collection 的创建、搜索过滤或删除语义。不能仅凭该元数据适配器启用索引管理器。F29 仍需实现并验收 vector collection/namespace 隔离、blob 对象所有权、索引任务上下文传递及 worker 重新授权。只有选用 Qdrant 作为 vector-store 适配器时才需要上游可选的 Qdrant extra；当前 Synapse 依赖集未包含它。

元数据适配器的独立验收已通过；知识库 manager、Qdrant、blob store 和实际索引流程仍未运行。F29 配置真实 manager 后，应先确认当前 `503` 行为，再验证带作用域的元数据 CRUD、跨作用域引用，以及 vector/blob 隔离。

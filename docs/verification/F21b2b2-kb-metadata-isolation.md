# F21b2b2 AgentScope 知识库 metadata 隔离验收

**结果：已验证 Proxy；KB 功能 routes 和索引仍未验证/未启用。**

## 运行与证据

脚本：`apps/api/tests/verification/test_f21b2b2_kb_metadata_isolation.py`。

在 `apps/api` 中运行：

```sh
F21B2B2_REDIS_PORT=6380 .venv/bin/pytest -q -rs tests/verification/test_f21b2b2_kb_metadata_isolation.py
```

2026-10-02 执行结果：**2 passed**。脚本连接 6380 端口的真实 Redis，metadata 验收使用专用 DB 13，ASGI route 检查的 bus 使用 DB 12。不清空任何 Redis DB；通过 actor/scope 前缀移除 proxy 记录。Route 检查将临时 SQLite 数据库迁移至 Alembic head，并启动真实 Synapse ASGI app、JWT gateway 和嵌入的 AgentScope child。

直接 proxy 场景在真实 `RedisStorage` 外包裹 `WorkspaceSessionStorage`，绑定四个可信 scope：两个租户、多个 Workspaces 和两个共享 Workspace 的 actors。测试 KB upsert/get/list/delete 和 document upsert/get/list/delete；相同原始 ID 会生成彼此独立的 scoped 记录。外部 scoped IDs 会按 missing 处理；外部状态写入不会改变目标记录；外部 leases 失败；跨 scope 的 KB/document 列表为空。测试状态修改、lease 获取/续期/释放、过期 lease 扫描和 pending document 扫描；全局扫描结果会过滤回当前 context。Session upsert 保存当前 scope 的 `knowledge_base_ids` 引用，并拒绝外部 scoped KB ID。直接插入 Redis 的原始旧版 KB 和 document 记录不会出现在 proxy 列表中，也无法通过 proxy get 解析。

## 功能 API/索引边界

挂载后的 `GET /api/v1/ai/knowledge_bases/` 请求会通过真实 Synapse 身份认证 gateway，并返回 **503 Service Unavailable**，因为嵌入式 AgentScope app 没有配置 `knowledge_base_manager`。未启用 Qdrant/vector store、blob store、KB CRUD route、文档上传/索引 route 或 worker 路径。因此这些功能 routes 和索引行为均**未验证**；两项通过的测试仅证明 metadata proxy 行为和预期的禁用 route 响应。本次未更改产品代码。

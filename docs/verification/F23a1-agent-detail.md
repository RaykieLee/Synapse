# F23a1 Agent 详情端点验收

日期：2026-10-02  
结果：**通过**

## 环境与命令

可重复运行的脚本为 `apps/api/tests/verification/test_f23a1_agent_detail.py`。脚本使用 JWT 运行真实 Synapse ASGI gateway，连接迁移至 Alembic head 的临时 SQLite 数据库，以及 `127.0.0.1:6380` 上运行的 Redis（AgentScope storage DB 15、bus DB 14）。不会清空 Redis 数据库；清理阶段会删除已写入的 fixture 记录。

```sh
cd apps/api
F23A1_REDIS_PORT=6380 .venv/bin/pytest tests/verification/test_f23a1_agent_detail.py -q --tb=short
```

实际结果：**1 passed**。除新增的详情断言外，测试还复验了 F21b2b1 中的 Agent 创建、列表、更新、删除和会话引用检查。

## 结果

- Owner 请求 GET `/api/v1/ai/agent/{agent_id}`，返回 HTTP 200，公开 ID 与当前 scope 相符，且 `editable: true`。
- 响应不包含凭据字段或哨兵密钥。请求 AgentView 时，Redis 中同一用户确实存在包含该哨兵值的 AgentScope `OpenAICredential`。
- 在其他 Workspace、共享 Workspace 中的其他 actor，以及其他租户下使用同一 ID，均返回 404。旧版原始 ID 和不存在的 ID 也返回 404。
- 不带 JWT 的请求被拒绝（若同时提供禁止使用的客户端身份 header，则返回 400）；格式错误的 bearer token 返回 401。有效 JWT 配合伪造或不存在的 Workspace selector 时，返回 403/404。
- 基线 Agent 创建和列表隔离、所有者更新/删除、外部 PATCH/DELETE 返回 404、旧版列表排除、同 scope 会话关联、跨 scope 会话拒绝，以及删除 Agent 后的会话级联检查均通过。

本次验收没有修改产品代码。

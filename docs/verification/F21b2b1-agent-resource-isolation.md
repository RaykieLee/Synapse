# F21b2b1 AgentScope Agent 定义隔离验收

**结果：部分通过。** 实际 scope 下的创建/列表/更新/删除路径和 session 引用均通过。固定版本的 AgentScope router 缺少所需的 HTTP 详情/读取路径，因此该部分无法通过验收。

## 证据

可重复运行脚本：`apps/api/tests/verification/test_f21b2b1_agent_resource_isolation.py`。

在 `apps/api` 中使用可访问的 Redis 端口运行：

```sh
F21B2B1_REDIS_PORT=6380 .venv/bin/pytest -q -rs tests/verification/test_f21b2b1_agent_resource_isolation.py
```

2026-10-02 执行结果：**1 passed**。测试默认端口 16379 上的 Redis 不可用；现有 Synapse Redis 在 6380 上响应 ping。脚本使用 AgentScope storage 的 Redis DB 15 和 bus 的 DB 14，不执行 `FLUSHDB`；使用迁移到 Alembic head 的临时 SQLite 数据库、真实 Synapse main ASGI app、gateway/JWT 成员检查、固定版本的 AgentScope router、scoped storage adapter 和 RedisStorage。运行前后按 scope 清理 fixture Redis agents 记录。

Setup 包含两个共享一个 Workspace 的 actor、一个 actor 位于同一租户的两个 Workspaces，以及独立的租户/Workspace。真实请求创建不同的 agent IDs，只列出当前 tenant/Workspace/actor 定义，更新 owner scope 记录，并以 404 拒绝对外部 scope 执行 PATCH 和 DELETE。直接写入隔离 Redis backend 的未限定旧版 AgentRecord 不会出现在 scoped 列表中。真实 sessions API 接受同 scope 的 agent 引用，在该 Agent 下返回创建的 scoped session ID；跨 Workspace 创建 session 返回 404；删除 Agent 会从 Redis 移除关联 session key。

## 验收缺口

已安装的 AgentScope router 注册 `GET /agent/schema`、`GET /agent/schema/v2` 和 `GET /agent/`（列表），但**没有 `GET /agent/{agent_id}` 详情 route**。即使 owner 请求详情 GET 也返回 405。因此无法测试 HTTP 读取/详情隔离，且面向用户的 Agent CRUD surface 缺少单条读取操作。已覆盖的 foreign-ID PATCH/DELETE 检查不能替代缺失的 GET endpoint。

本实时测试没有单独调用 adapter 的 `get_agent` 方法，因为该方法没有 router 暴露，且运行中的 Redis client 绑定在 ASGI lifespan event loop。对旧记录可见性的断言只覆盖列表行为；不能据此推断详情行为。

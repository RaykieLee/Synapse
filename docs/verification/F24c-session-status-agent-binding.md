# F24c Session status agent binding 验收

## 结果

通过。使用临时 SQLite Alembic head、真实 Synapse FastAPI/AgentScope 同进程服务和本机 Redis，运行 `run_f24c_session_status_agent_binding.py`，脚本输出 `F24c session status/agent binding assertions passed`。

## 验收证据

- fixture 覆盖两个租户、三个 Workspace（同租户两个、另一租户一个）、两个 actor；同一 actor/workspace 建立两个 agent 和各自 session。
- 正确的 `(workspace, actor, agent_id, session_id)` 组合均返回 HTTP 200、`status: running`。测试为对应 session 写入真实 Redis run-lock，并通过 Redis `MONITOR` 确认状态端点执行了针对该 session lock key 的 `EXISTS`。
- 同 Workspace 错配 agent、跨 Workspace、跨 tenant 及跨 actor session 的状态请求均返回 HTTP 404 `RESOURCE_NOT_FOUND`。
- 对以上拒绝请求，Redis `MONITOR` 未观察到目标 `agentscope:session:lock:{session_id}` 的命令。Storage record 的 Redis `GET` 属于 session ownership lookup，和上游运行锁探测分开统计；拒绝发生在 run-lock 查询之前。
- 正常会话列表请求返回 200；合法 SSE endpoint 返回 200 `text/event-stream`，确认 status-only guard 未拦截其它会话路由。此项仅检查 SSE 建连，不断言 event payload 或长流处理。
- Redis session record 与 run-lock 由脚本创建并在清理阶段删除；临时数据库和 workdir 在临时目录中创建。

## 可重复运行

从 `apps/api` 目录运行：

```sh
.venv/bin/python tests/verification/run_f24c_session_status_agent_binding.py
```

需要本机 Redis 默认监听 `127.0.0.1:6380`。可用 `F24C_REDIS_HOST`、`F24C_REDIS_PORT` 覆盖。运行使用独立 Redis DB 6（AgentScope storage）和 DB 7（message bus）。

## 限制

Redis `MONITOR` 用来确认 API 在该请求窗口是否访问目标 run-lock key；本验收不覆盖 PostgreSQL 部署表现。SSE 仅验证合法流可建连并返回事件流 content type，未等待模型输出或断言 SSE 事件内容。

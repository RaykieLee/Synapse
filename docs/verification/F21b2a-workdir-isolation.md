# F21b2a AgentScope workdir 隔离验收

**结果：对本次覆盖的本地后端、AgentScope 文件 router 和 Synapse gateway 端到端路径均通过。**

## 验收内容

可重复运行的检查为 `apps/api/tests/verification/test_f21b2a_workdir_isolation.py`。在 `apps/api` 中运行：

```sh
.venv/bin/pytest -q tests/verification/test_f21b2a_workdir_isolation.py
```

2026-10-02 结果：**6 passed**。

脚本使用临时本地根目录、已安装的 AgentScope `LocalWorkspaceManager` 和真实的 `Read`、`Write`、`Edit`、`Glob`、`Grep` 内置工具。它为同一 Workspace 中的两个 actor、同一 actor 在两个 Workspaces 中的场景以及另一个租户创建 scope。Runtime workdir 路径会按 tenant、Workspace、actor 和哈希 agent ID 区分。通过 `Write` 写入、通过 `Edit` 修改的文件，只能从最初的 actor scope 读取；同级 actor/Workspace/tenant 根目录无法列举或读取这些文件。删除操作受限于自身目录且成功；新建 manager 可从磁盘重建同一 scope 的 workdir。

后端/API path resolver 会拒绝路径遍历、主机绝对路径、符号链接目标和符号链接组件。某 actor context 下签发的 runtime workspace ID 在另一 context 下会被拒绝。任意 shell 命令和由命令执行的 `Glob`/`Grep` 工具会抛出 `PermissionError`；`Write` 所需的 `mkdir -p` 由受保护后端内部处理。

HTTP 测试挂载 AgentScope 实际 workspace router，并使用其目录列表和文件下载 endpoints。真实 `Write` 工具创建的文件可正常列出和下载。列表与文件 endpoints 会以 HTTP 400 拒绝路径遍历、主机绝对路径、Windows 绝对路径和符号链接路径。

## 完整 Gateway 端到端补充（2026-10-02）

`apps/api/tests/verification/test_f21b2a_workspace_gateway_e2e.py` 会启动真实 Synapse FastAPI app 及正常 lifespan 下挂载的 AgentScope child，使用迁移到 Alembic head 的临时 SQLite 数据库和 Redis **7.4.11**（专用 Redis DB 13、14）。在 `apps/api` 中运行：

```sh
F21B2A_REDIS_HOST=127.0.0.1 F21B2A_REDIS_PORT=6380 .venv/bin/pytest -q tests/verification/test_f21b2a_workspace_gateway_e2e.py
```

2026-10-02 结果：**1 passed**。测试创建两个 active 租户、三个 Workspaces 和两个 JWT actor，覆盖四种访问 scope（同一 actor 跨两个空间、两个 actor 同处一个空间，以及第二租户）。通过 HTTP 创建真实 AgentScope agents 和 sessions，再经真实 workspace service/受保护 backend 写入哨兵文件。`GET /workspace/directories`、创建 download token 和 `GET /workspace/files` 均经由挂载的生产 Synapse gateway 执行。文件列表报告的根目录与物理 workdir 根目录相同；路径位于 `tenant-{id}/workspace-{id}/actor-{id}/agent-{hash}` 下。每个 scope 都有独立哨兵文件/workdir。

同一运行还确认：actor A 的下载 capability 不能在 actor B context 中重放；session 不能通过不同 Workspace selector 解析；在 actor 的另一个 Workspace 签发的 runtime Workspace ID 返回 404。测试为路径遍历、POSIX 绝对路径、Windows 绝对路径和符号链接路径分别提供精确匹配路径的 download token，然后真实文件 endpoint 均以 HTTP 400 拒绝；目录列表也拒绝遍历和绝对路径。测试在 HTTP 拒绝断言前确认磁盘符号链接解析到 workdir 外的真实文件。缺少 `X-Workspace-ID` 和伪造的 `X-User-ID` 会在 gateway 被拒绝。

原六项检查与此端到端补充合并重跑：**7 passed**。

## 限制与后续

最初的六项测试仍聚焦 manager、受保护 backend、内置工具和路径行为。新增补充覆盖了此前缺失的完整 app/Redis/JWT/gateway 目录列表和文件下载路径；F21a 报告独立验证 gateway policy 和路由覆盖。

固定版本的 AgentScope router 还包含 upload/skill routes，但本端到端验收只测试目录列表和文件下载；未断言上传/写入/删除，也未测试长时间操作期间实时成员撤权。测试未压力测试恶意并发文件系统修改（契约中记录了该 TOCTOU 限制）。

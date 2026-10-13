# F26b WakeupDispatcher WorkspaceContext 修复独立验收计划

状态：待实现；本文件只定义验收，不修改产品代码。

本验收针对 `docs/architecture/agentscope-wakeup-workspace-context.md` 设计的后台
resume/interrupt 上下文传播修复。验收必须证明两件不同的事情：

1. dispatcher 在消费 trigger 前能否重新验证 tenant、Workspace、actor、membership、
   session、agent 和 parked reply 的归属；
2. 通过验证后，真正由后台创建的 AgentScope run 是否在整个生命周期内绑定了正确的
   `WorkspaceContext`，并最终完成或明确失败。

HTTP `/ai/chat/` 返回 `200` 或 `status="started"` 只能证明 trigger 已被接受/入队，
不能单独作为本项通过证据。

## 1. 验收边界与通过规则

### 1.1 当前实现基线

当前 Synapse 自有代码提供：

- `apps/api/app/tenancy/context.py`：从 JWT、`X-Workspace-ID`、Tenant 和
  Workspace 成员关系派生不可变 `WorkspaceContext`；
- `apps/api/app/integrations/agentscope_gateway.py`：在 HTTP AgentScope 请求期间
  bind/reset context；
- `apps/api/app/integrations/agentscope_session_scope.py`：
  `WorkspaceSessionStorage` 根据 context 生成 scoped ID，并在 context 缺失时
  fail closed；
- `apps/api/tests/verification/test_f26b_external_result.py`：
  当前 F26b 的 FastAPI/Redis/Vite/Chromium fixture；
- `apps/api/tests/verification/f26b_external_result.mjs`：当前前端 wire-contract
  与 Workspace 隔离断言。

`WakeupDispatcher`、`enqueue_run_trigger` 和 AgentScope 的 resume queue 当前来自
`apps/api/.venv` 中按 `apps/api/pyproject.toml` pin 的 AgentScope 依赖。除非未来实现
在 Synapse 仓库建立 adapter 或 vendor patch，否则不能把 `.venv` 内直接修改的文件
作为产品修复证据。

### 1.2 通过门槛

F26b backend fix 只有在以下条件全部满足时才可标记为“独立验收通过”：

- 所有 P0 安全拒绝场景通过，且拒绝前没有调用 `ChatService.run`、工具执行器、
  workspace adapter 或未绑定的 session storage；
- 同一 trigger 的重复投递最多产生一次逻辑 resume；
- session lock、lease 和 transient Redis/DB 错误按原 `trigger_id/scope_ref`
  重试，不复制出新的逻辑 trigger；
- run coroutine 的入口和整个生命周期都能观察到同一个已验证 context，结束时
  ContextVar 恢复到调用前值；
- 至少有一个真实后台 AgentScope run 从 trigger 消费到最终持久化状态/事件完成；
- tenant、Workspace、actor、membership version、session、agent 或 reply 任一项
  不匹配时，结果是稳定的拒绝/no-op，不是默认 Workspace、最近 Workspace 或空
  context；
- 证据区分受控 fixture、真实 Redis/DB/HTTP 流程和真实 AgentScope 执行；
- `git diff --check`、API 定向测试、默认 API 测试、`compileall` 和前端 build
  均通过；测试产生的数据按精确 key 清理，不使用 `FLUSHDB` 清理共享 Redis。

## 2. 证据分级

| 级别 | 允许使用的 fixture | 可以证明 | 不能证明 |
| --- | --- | --- | --- |
| A：受控 contract | fake DB/session record、fake scope store、spy `ChatService.run`、fake clock、fake lock/lease、fake event sink | schema、授权矩阵、幂等状态机、拒绝前不 spawn、ContextVar bind/reset、retry 的 trigger identity | AgentScope 私有 dispatcher 与真实 Redis 协议兼容；真实模型/工具完成 |
| B：真实基础设施 | 临时 SQLite、真实 Redis DB/namespace、真实 Synapse API、真实 `WorkspaceSessionStorage`、真实 dispatcher adapter；`ChatService.run` 可使用 deterministic test double | Redis queue/lease/lock、DB 竞态、真实 scoped key、HTTP 入队到后台消费的链路 | 真实模型 provider 的 token/推理行为；真实外部服务的网络故障 |
| C：真实 AgentScope | 真实 pin 的 AgentScope storage/message bus/dispatcher、真实后台 `ChatService.run`、deterministic local model/tool fixture 或已批准的测试 provider | 从 enqueue 到后台 run、消息/事件/最终状态、context 在真实子任务中可用、无 context 错误为零 | 未覆盖的生产 provider、真实第三方工具和高并发生产拓扑 |

P0 安全矩阵可以在 A 级完成后再用 B 级复验；“实际后台完成”必须至少达到 C
级。没有可重复的 deterministic model/tool fixture 时，该项只能记为“待实际验收”，
不能用受控 `200`、fake run 或 UI 状态代替。

## 3. 验收矩阵

下表中的 `spawn=0` 指 spy 或真实 registry 均未创建 `ChatService.run`；`read=0`
指拒绝发生在读取 scoped session/workspace/tool 前。所有拒绝 outcome 都必须携带
内部可关联的 `trigger_id`、`correlation_id` 和 reason，但客户端/普通日志不得泄露
完整输入、凭据或跨 Workspace 资源是否存在。

| ID | 对抗场景与操作 | 预期 outcome | 必须观察的安全断言 | 最低证据级别 |
| --- | --- | --- | --- | --- |
| AC-01 | 同一 actor、同一 tenant/Workspace，合法 `ExternalExecutionResultEvent` | `accepted -> spawned -> run_completed` | scope、session、agent、reply 一致；run 内 context 的 actor/tenant/Workspace 正确；最终消息/状态落库 | C |
| AC-02 | 合法 `UserConfirmResultEvent` 恢复 parked tool call | `accepted -> run_completed` 或明确 `run_failed` | reply/tool-call 属于目标 session；只处理一次；确认结果不会投递到 leader 的错误 worker | B；最终完成 C |
| AC-03 | 合法 `UserInterruptEvent` | `accepted -> interrupted` 或明确失败 | interrupt 只作用于目标 session；不绕过 parked reply/状态检查；不会影响同 Workspace 其他 session | B |
| AC-04 | payload 伪造 `tenant_id`、`workspace_id`、`actor_user_id` 或 `membership_version` | `scope_mismatch`/`malformed` | payload 冗余字段不能覆盖 scope record 或数据库真实值；`spawn=0` | A + B |
| AC-05 | `scope_ref` 指向另一 tenant 或另一 Workspace 的 record | `scope_mismatch` | 不读取、不写入另一作用域；不会回退到当前请求、默认或最近 Workspace | A + B |
| AC-06 | 同一 actor 跨两个 Workspace 重放 session/agent/reply ID；两个 Workspace 使用相似原始 ID | `session_missing`/`scope_mismatch` 或各自独立成功 | Redis scoped key、session、消息、event stream 和 run lock 不交叉；不存在性差异不泄露给外部 HTTP | B |
| AC-07 | enqueue 后撤销 `TenantMember`，再消费 trigger | `membership_revoked` | 不 spawn，不读取 session/workspace/tool，不产生模型或工具事件；scope 进入 rejected/terminal | A + B |
| AC-08 | enqueue 后撤销 `WorkspaceMember` 或降权到不允许该动作 | `membership_revoked`/`forbidden` | 以消费时权限为准；旧的 active membership 不得继续授权；不自动升级 scope | A + B |
| AC-09 | enqueue 后 tenant inactive | `tenant_inactive` | fail closed；不执行；不得把 tenant inactive 映射为“找不到但继续跑” | A + B |
| AC-10 | enqueue 后 Workspace inactive/archived | `workspace_inactive` | fail closed；不执行；不读 runtime workspace 或文件 | A + B |
| AC-11 | session 已删除、owner 改变或 scoped ID 不属于当前 actor | `session_missing` | 不调用 `ChatService.run`；不访问未绑定 storage；不返回原始 session 内容 | A + B |
| AC-12 | payload 的 `agent_id` 与 session binding 不同；leader reply 映射到错误 worker | `agent_mismatch`/`scope_mismatch` | dispatcher 使用 enqueue 时固化且重验的 target；不根据客户端 input 猜测/改写 agent | A + B |
| AC-13 | `reply_id` 不属于 session、已完成、kind 不允许或重复提交同一结果 | `reply_already_resolved`/duplicate no-op | 最多一次逻辑 resume；不会重复工具结果、重复消息或重复模型调用 | A + B |
| AC-14 | 同一 payload 并行投递两次，或多个 dispatcher 竞争同一 trigger | 一个 `spawned/run_completed`，另一个 `duplicate`/lease miss | trigger_id 不变；dispatch lease/CAS 保证最多一次；scope record 不出现两个 completed run | B |
| AC-15 | session lock 已持有，随后释放 | `lock_retry -> spawned -> run_completed` | retry 保留原 trigger_id/scope_ref；指数 backoff/jitter；最终只 spawn 一次，不产生新 logical trigger | B |
| AC-16 | Redis/DB 在 scope resolve、lease、lock 或最终写入阶段短暂失败 | `retry` 或可诊断失败 | 不清空 context、不降级到默认 Workspace；attempt 可见；达到 TTL/max attempts 后 terminal | A + B |
| AC-17 | trigger 过期、scope record 已 rejected/expired、未知 schema、缺 `scope_ref` 或缺 trigger_id | `malformed`/`scope_expired`/`scope_missing` | 不执行、不访问 scoped storage；旧 payload quarantine/drop 可审计，不按旧协议执行 | A + B |
| AC-18 | run coroutine 抛异常、取消、dispatcher shutdown 或 worker crash 后 lease 过期 | `run_failed` 或可重试 | `finally` reset context；consuming lease 可恢复；不会留下永久 consuming；重试重新 resolve scope | A + B |
| AC-19 | 真实后台 external-result resume，使用 deterministic model/tool fixture | `accepted -> spawned -> run_completed` | 真实 AgentScope dispatcher 消费 Redis trigger；真实 storage/workspace adapter 在 run 内可访问；最终助手消息/事件可查询；无 `Workspace context` RuntimeError | C |
| AC-20 | 真实后台 run 完成后检查第二次重复 trigger | `duplicate`/no-op | 不重复调用模型/工具，不追加第二份最终结果；最终 session 状态稳定 | C |
| AC-21 | 两个 Workspace 同时各自触发合法 run | 两个独立的 completed outcome | 两个 context 在并发 task 中互不污染；各自 event stream、runtime path、lock 和消息只属于自身 | C |
| AC-22 | HTTP 返回 `200` 后立即查询，再等待后台 outcome | 先 `accepted/queued`，后明确 `spawned` 与 `run_completed`/`run_failed` | UI/API 不把 `200` 当最终完成；correlation_id 可从入队关联到最终 outcome | B；最终完成 C |

任何 AC-04 至 AC-18 的拒绝若只在模型运行后才发生，均视为失败，因为消费前
重验没有成立。任何 AC-19 至 AC-22 若只观察到 HTTP response、Redis entry 或
前端卡片消失，也不视为真实后台完成。

## 4. 精确执行命令与脚本

以下命令从仓库根目录 `D:\Projects\MyPorject\Synapse\synapse-repo` 执行。
PowerShell 命令使用仓库当前 Windows 约定；若虚拟环境路径不同，应在验收记录中写明
实际解释器，而不是静默切换到系统 Python。

### 4.1 现有基线（每次实现前后都运行）

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m compileall app
Set-Location ..\web
pnpm build
pnpm exec eslint .
```

这些命令是回归门槛，不是 F26b backend fix 的充分证据。默认 pytest 会排除
`redis`、`browser` 和 `integration` marker，必须单独运行下面的定向验收。

### 4.2 A 级 contract 测试（实现后新增）

实现阶段应新增以下仓库测试文件；本验收计划不预先创建它们：

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m pytest -q `
  tests/integrations/test_agentscope_wakeup_scope.py `
  tests/integrations/test_agentscope_wakeup_dispatcher.py `
  tests/integrations/test_agentscope_wakeup_idempotency.py `
  tests/integrations/test_agentscope_session_scope.py
```

最低断言要求：

- fake DB 组合覆盖 AC-04 至 AC-18 的每一条 rejection；
- spy `ChatService.run` 在 rejection 前为零次调用；
- `run_with_workspace_context(context, coro_factory)` 在成功、异常、取消三种路径
  都 reset 原 token；
- retry payload 中 `trigger_id`、`scope_ref`、target session/agent 不变，仅
  `attempt` 改变；
- 重复 trigger、lease 竞争和 terminal scope record 均为幂等；
- 旧 payload 不会走兼容的无 scope 执行路径。

### 4.3 B 级真实 Redis/DB/HTTP 流程

复用已有 F26b runner 的隔离方式，但实现 backend runner 时必须使用独立 Redis
端口或明确的独立 DB/namespace、临时 SQLite 和 F26b 前缀数据。推荐命名：
`run_f26b_wakeup_backend.py`。命令模板如下：

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo
$env:F26B_REDIS_HOST = "127.0.0.1"
$env:F26B_REDIS_PORT = "16381"
$env:F26B_SKIP_BUILD = "1"
apps\api\.venv\Scripts\python.exe apps\api\tests\verification\run_f26b_wakeup_backend.py
```

runner 必须实际启动临时 API/lifespan/dispatcher，使用真实 Redis queue、真实
`WorkspaceSessionStorage` 和临时数据库，并通过内部 test seam 注入 deterministic
run double。它至少要：

1. 创建两个 tenant、三个 Workspace、两个 actor、active/revoked/inactive 成员关系；
2. 创建跨 Workspace 的 agent/session/parked reply fixtures；
3. 通过真实 HTTP endpoint 入队，而不是直接伪造成功 outcome；
4. 在 enqueue 与 consume 之间执行撤权、停用、删除、agent mismatch 等竞态；
5. 读取 scope record、outcome event、session event stream 和精确 Redis key；
6. 在 finally 中只删除本 runner 创建的 SQL 行和带前缀 Redis key。

若本机 Docker Redis 只配置了 16 个 logical DB，不能使用越界 DB；应使用独立
Redis 容器/端口或 namespace。禁止在共享实例上执行：

```powershell
redis-cli -p 16381 FLUSHDB
redis-cli -p 16381 FLUSHALL
```

### 4.4 现有 F26b UI runner（仅作为回归，不作为 backend 通过证据）

当前 UI/wire-contract 回归仍可运行：

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo
$env:F26B_REDIS_PORT = "16381"
$env:F26B_SKIP_BUILD = "1"
apps\api\.venv\Scripts\python.exe apps\api\tests\verification\test_f26b_external_result.py
```

该 runner 可以证明 external-result 卡片、HTTP 请求体、Workspace 隔离和撤权后的
页面行为；它不能证明 WakeupDispatcher 已经在后台完成模型续跑。若 runner 仍观察到
`RuntimeError: AgentScope session access requires a verified Workspace context`，
AC-19 至 AC-22 必须保持未通过。

### 4.5 C 级真实 AgentScope 后台完成

实现阶段必须提供一个不依赖真实生产 provider 的 deterministic fixture，优先级如下：

1. 使用 AgentScope 官方公开 model/tool test double，并通过仓库 adapter 注入；
2. 若官方接口不支持，使用 Synapse 自有兼容 seam；不得 monkey-patch
   `.venv\Lib\site-packages\agentscope` 后把结果当作源码修复；
3. 只有在前两者不可行且明确记录 provider、凭据来源、脱敏方式和成本上限时，才可
   使用受控测试 provider。

命令模板：

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo
$env:F26B_REDIS_PORT = "16381"
$env:F26B_RUN_REAL_AGENTSCOPE = "1"
apps\api\.venv\Scripts\python.exe apps\api\tests\verification\run_f26b_wakeup_agentscope.py
```

该 runner 的通过输出必须同时包含或可从结构化报告读取：

- HTTP enqueue response 与 `trigger_id/correlation_id`；
- dispatcher consumer outcome；
- `WorkspaceContext` snapshot（只记录 actor/tenant/Workspace/版本，不记录凭据）；
- 实际 `ChatService.run` 开始/结束；
- 最终 session state、assistant message 或 interrupted state；
- `workspace context missing` 计数为零；
- duplicate/retry/撤权场景对应的 outcome；
- 精确清理结果。

没有这个 runner，或 runner 只替换 `ChatService.run` 为一个立即返回的 fake，
只能记为 B 级通过，不能把“实际后台完成”标为通过。

### 4.6 结果完整性与静态检查

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo
git diff --check
git status --short
```

验收报告还应附：

- AgentScope commit/version、Python 版本、Redis 版本和 SQLite/Alembic revision；
- runner 的完整退出码和关键 outcome 摘要；
- 临时 API/dispatcher 日志中与 `trigger_id` 相关的脱敏片段；
- 运行前后精确 Redis key 数量和清理结果；
- 失败时未执行的场景和重跑命令。

## 5. 预期可观察结果

### 5.1 Trigger 生命周期

建议 outcome 状态至少包括：

```text
accepted
duplicate
malformed
scope_missing
scope_mismatch
scope_expired
membership_revoked
tenant_inactive
workspace_inactive
session_missing
agent_mismatch
reply_already_resolved
lock_retry
spawned
run_completed
run_failed
retry_exhausted
```

状态必须能用 `trigger_id` 关联，但不应把 `scope_ref` 作为客户端可猜测或可修改的
授权材料暴露。HTTP response 若暂时只有 `status="started"`，验收 runner 应通过内部
状态/event sink 取得后续 outcome；产品后续可以再决定是否向客户端公开不敏感的
`trigger_id`。

### 5.2 成功执行

合法 trigger 的证据顺序应为：

```text
HTTP accepted
  -> durable scope record pending
  -> queue consumed
  -> scope revalidated
  -> run spawned
  -> WorkspaceContext bound
  -> session/message/tool access succeeds
  -> final event/state persisted
  -> context reset
  -> scope record completed
```

`spawned` 不能提前写成 `completed`。只有最终持久化或最终事件确认后，才允许把
scope record 标记为 `completed`。

### 5.3 安全拒绝

撤权、停用、过期、session/agent/reply mismatch 的证据顺序应为：

```text
queue consumed
  -> scope rejected with stable internal reason
  -> spawn count remains zero
  -> no scoped storage/workspace/tool access
  -> terminal outcome/event emitted without sensitive input
```

外部调用者可以看到统一的 queued/failed/retryable 语义，但不能通过
`tenant_inactive`、`session_missing`、`agent_mismatch` 的差异响应探测其他租户或
Workspace 是否存在。

### 5.4 ContextVar 生命周期

成功、异常、取消和 retry 四条路径都要记录：

- run 开始前的 context；
- run 内 storage/workspace/tool adapter 读取到的 context；
- run 结束后的 `current_agentscope_context()`；
- dispatcher transport task 本身没有永久用户 context；
- 下一个不同 Workspace 的 run 读取到自己的 context，而非前一个 run 的值。

预期是 run 内 context 等于本次 DB 重验构造的 immutable context，run 结束后恢复
到调用前 token；不能用 `set(None)` 代替 token reset。

## 6. 设计中仍需明确的缺口

以下问题不应由验收人员自行猜测；实现前需要在设计/ADR 或测试 contract 中固定：

1. **公开 seam**：AgentScope 是否会提供 trigger payload extension、
   pre-dispatch hook 或 `context_factory`？若没有，Synapse 采用自有 adapter 还是
   version-pinned vendor patch；具体覆盖的上游版本和私有函数必须写死。
2. **scope record 存储**：record 放 SQL、AgentScope Redis 还是独立 Synapse Redis
   namespace？需要定义 record-first、queue publish 失败、DB commit 成功但 publish
   失败、Redis 不可用和时钟漂移时的恢复动作。
3. **原子状态机**：scope record、dispatch lease、session lock 和 parked reply 的
   “未处理 -> consuming -> completed/rejected”更新点是否由同一事务/CAS 保护；
   crash window 发生后谁有权恢复 consuming。
4. **membership version 粒度**：当前 `WorkspaceContext` 使用 tenant
   `membership_version`。是否需要 Workspace 级版本或 actor-specific
   authorization epoch，以便单个 Workspace 撤权立即、窄范围地失效 trigger。
5. **动作权限**：`resume`、`confirm`、`interrupt` 是否共享同一个 Workspace
   permission，还是每种 kind 有独立权限；权限降级后的预期 outcome 需固定。
6. **leader/worker 映射**：HTTP 入队时解析出的 worker target 如何持久化并验证；
   worker 被删除/重建后是拒绝旧 trigger，还是允许新版本映射。
7. **reply 权威状态**：parked reply/tool-call 的权威存储和原子 consume 标记点；
   当前仅检查 `reply_id` 是否存在不足以防止重复 resume。
8. **最终完成定义**：`run_completed` 是最终 assistant message、session state、
   SSE terminal event，还是三者组合；前端查询/订阅哪个状态作为真相。
9. **事件可见性**：拒绝原因哪些只进内部日志，哪些通过 session event/
   management API 提供；必须防止跨作用域存在性推断，同时让用户知道需要重试或
   重新提交。
10. **真实执行 fixture**：确定 deterministic model/tool 的来源、是否允许网络、
    如何避免真实凭据和费用，以及如何在 CI/Windows 上稳定复现。
11. **多实例语义**：多进程 dispatcher 的 lease、Redis 时钟、DB isolation level、
    session lock 和 event stream 是否共享假设；至少需要两 dispatcher 竞争同一
    trigger 的验收。
12. **旧 payload 迁移**：旧无 scope payload 的 quarantine 保留多久、是否可人工
    用原 `trigger_id` 重投、滚动发布期间 producer/consumer 的兼容窗口如何结束。

在这些问题没有定稿前，任何“后台 resume 已修复”的结论都应限定为某一测试 fixture
和某一 AgentScope pin 版本，不应扩展为生产拓扑已验证。

## 7. 验收结论模板

最终报告应按以下格式记录，而不是只写一个“passed”：

```text
F26b WakeupDispatcher WorkspaceContext acceptance
Date:
Git commit:
AgentScope source/version:
Python / Redis / OS:

A contract: PASS/FAIL (N passed, N failed)
B real Redis/DB/HTTP: PASS/FAIL
C real AgentScope background completion: PASS/FAIL/BLOCKED

Security:
- tenant isolation:
- Workspace isolation:
- actor authorization:
- membership revocation:
- stale session/agent/version:
- idempotency:
- retry:

Final background outcome:
- trigger_id:
- accepted_at:
- spawned_at:
- completed/failed_at:
- final session state/event:
- context-missing errors:

Cleanup:
- SQL fixture rows removed:
- Redis keys removed:
- no FLUSHDB/FLUSHALL:

Known gaps:
```

只要 C 级真实后台完成、context reset、或任一 P0 隔离场景没有通过，结论必须为
“未通过”或“待实际验收”，不能写“所有 F26b 已通过”。

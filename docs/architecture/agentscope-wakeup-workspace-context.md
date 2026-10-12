# AgentScope WakeupDispatcher WorkspaceContext 安全传播方案

状态：设计方案；本文件只记录后续实现边界和验收要求，不改变产品代码、AgentScope `.venv` 或共享台账。

## 1. 目标与非目标

本方案解决 F26b 暴露的后台 resume/interrupt 上下文缺失问题：HTTP 请求返回 `200` 后，应用 lifespan 创建的 `WakeupDispatcher` 消费 Redis trigger 时，必须能够获得一个服务端产生、可重新验证的 Workspace scope，并在真正访问会话、消息、运行目录或凭据前绑定新的 `WorkspaceContext`。

目标是：

- 保持 `WorkspaceSessionStorage` 的 fail-closed 行为；无可信上下文时仍然拒绝访问。
- 让人工确认、外部执行结果和 parked interrupt 的后台恢复使用与 HTTP 请求相同的租户/Workspace/actor 归属。
- 将“入队成功”和“恢复执行成功”作为两个可观测状态，避免 HTTP `200` 被误读为模型续跑成功。
- 在撤权、停用、会话删除、agent 不匹配和重复 trigger 竞态下，宁可丢弃并报警，也不跨作用域执行。

非目标：

- 不把 runtime workspace 当作协作 Workspace。
- 不让客户端自报的 `tenant_id`、`workspace_id`、`membership_version` 或 `user_id` 成为授权凭证。
- 不通过关闭 `_prefix()` 的 fail-closed 检查、回退到默认 Workspace 或复制最近 Workspace 来“修复”错误。
- 不直接编辑 `apps/api/.venv/Lib/site-packages/agentscope` 中的安装文件。

## 2. 调查范围与调用链证据

本方案核对了 `AGENTS.md`、`docs/tenancy-contract.md`、`docs/agentscope-session-isolation.md`、`docs/verification/F26b-external-result-frontend.md`、仓库的 AgentScope integration adapters，以及当前安装的 AgentScope 2.0.10.dev0 相关实现。以下路径和行为是设计依据；安装包文件是依赖观察点，不是修改目标。

### 2.1 HTTP 请求到 trigger

1. `apps/api/app/integrations/agentscope_gateway.py` 解析登录身份和 `X-Workspace-ID`，通过数据库得到不可变的 `WorkspaceContext`，并在调用 AgentScope ASGI app 前 `bind_agentscope_context()`；完整 response 生命周期结束后才 reset。
2. `apps/api/.venv/Lib/site-packages/agentscope/app/_router/_chat.py` 对 `UserConfirmResultEvent`、`ExternalExecutionResultEvent` 和 `UserInterruptEvent` 走 HITL resume 路径。它会先通过 `SubagentHitlProjector.resolve()` 将 leader session 映射到实际 worker session/agent，再调用 `enqueue_run_trigger()`，随后立即返回 `ChatTriggerResponse(status="started")`。
3. 当前 `enqueue_run_trigger()`（`_bus_ops.py`）写入 `agentscope:wakeups` 的 payload 只有 `user_id`、`session_id`、`agent_id`、`kind` 和序列化的 `input`，随后发布 wakeup signal。没有 tenant、Workspace 或 membership scope。

### 2.2 trigger 到后台 run

1. 应用 lifespan 创建一个进程级 `WakeupDispatcher` task。它订阅 wakeup signal，批量 drain durable queue。
2. `_wakeup_dispatcher.py` 从 payload 取出 `user_id/session_id/agent_id`，解析 resume input；如果 session lock 存在，就以约 100ms backoff 创建 retry task 并重新入队。
3. lock 空闲后，dispatcher 仅以 `storage.get_session(user_id, agent_id, session_id)` 做 orphan guard，然后将 `chat_service.run(...)` 交给 `ChatRunRegistry`。
4. `ChatService.run()` 是 HTTP 新消息和 dispatcher resume 共用的执行入口。它会继续进行 session、agent、workspace、消息和状态持久化；因此 dispatcher 在 spawn 前绑定上下文是必要条件，而不是只给某一个 Redis 查询加 header。

### 2.3 fail-closed 根因

`apps/api/app/integrations/agentscope_session_scope.py` 的 `WorkspaceSessionStorage._prefix()` 从 `ContextVar` 读取 `WorkspaceContext`，为空即抛出 `RuntimeError("AgentScope session access requires a verified Workspace context")`。`agentscope_workspace_scope.py` 的运行目录适配器也要求当前上下文。

HTTP handler 创建的 asyncio task 可以继承请求 task 的 ContextVar；应用 lifespan 创建的 dispatcher task 不在该请求上下文中，因此不会自动继承。F26b 报告已经观测到取消请求后后台日志出现该 RuntimeError，并明确指出当前 `200` 仅证明 trigger 入队，不能证明 parked run 已恢复或清理完成。当前 fail-closed 保护了跨 Workspace 读取，但会使 HITL/外部结果状态停在等待态。

## 3. 威胁模型

保护对象是租户、协作 Workspace、actor 私有会话和其派生的 AgentScope Redis/SQL/bus/runtime-workdir key。假设攻击者可以：

- 修改浏览器请求中的 `session_id`、`agent_id`、`reply_id`、`X-Workspace-ID` 或输入事件字段；
- 重放、延迟、复制或篡改可见的 Redis trigger payload；
- 在 trigger 入队后被移出 Workspace、被暂停、被降权，或让租户/Workspace 进入非 active 状态；
- 让同一 session 产生重复 resume、resume 与仍在结束的 parked run 并发，或在 session/agent 被删除后消费旧消息；
- 观察错误、耗时和事件流，尝试推断其他 Workspace 的 session 是否存在或是否正在运行。

不把 Redis queue 当作可信授权来源。queue payload 是传输数据，不是授权结果；其中的 ID 只能用于定位候选记录，不能跳过数据库重验。scope reference 必须不可由客户端选择，且不能只依赖可伪造的明文 membership version。

安全不变量：

1. 每个后台 run 有且只有一个服务端解析出的 `(actor_user_id, tenant_id, workspace_id)`。
2. scope 与 session、agent 的归属必须同时匹配；任何 mismatch 都不执行。
3. 入队时有权不代表消费时仍有权；消费时必须重新检查 tenant、Workspace、TenantMember、WorkspaceMember 和版本。
4. 未绑定上下文的 session/workspace adapter 继续拒绝访问。
5. 失败不会把原始输入、凭据、完整工具参数或跨租户存在性泄漏到客户端或日志。

## 4. 推荐的仓库自有 seam、patch 与 adapter 边界

### 4.1 推荐 seam

推荐在 Synapse 自有 integration 层建立一个深模块 `ScopedWakeupTrigger`，对上游调用方只暴露两个窄接口：

```text
enqueue_resume(context, target_session, target_agent, input) -> TriggerAccepted
consume_and_dispatch(trigger) -> DispatchOutcome
```

其实现负责 payload schema、scope reference 解析、消费前重验、ContextVar 生命周期、幂等和观测；调用方不再直接知道 AgentScope wakeup queue 的字段细节。`ChatService.run`、`WorkspaceSessionStorage` 和 `ChatRunRegistry` 仍是被调用的现有模块，不把授权逻辑复制到每个调用点。

推荐的组装位置是仓库自有的 AgentScope lifespan/factory：由 Synapse 创建和注入 dispatcher，HTTP router 只调用仓库 adapter 的 enqueue seam。dispatcher 仍应是每进程唯一的 spawn site，以保留 AgentScope 当前的单 session 串行化设计。

### 4.2 不直接改 `.venv`

实现优先级：

1. 优先向 AgentScope 增加公开的 trigger serializer、dispatcher pre-dispatch hook 或 `context_factory(payload)` 扩展，并在 Synapse pin 的版本中使用该接口。
2. 若上游接口来不及提供，短期在仓库内实现兼容 adapter/dispatcher：复用 AgentScope 的 public `MessageBus`、`ChatService`、`ChatRunRegistry` 和事件模型；由 Synapse adapter 自己维护带 scope 的 queue 协议。不要通过 monkey patch 安装包私有函数来注入 ContextVar。
3. 若某个已 pin 的上游私有实现无法复用，维护一个版本锁定的仓库 patch（例如 `apps/api/vendor/patches/agentscope-<version>/`）和可重复的环境安装/验证步骤。patch 必须审阅、可重放、可回滚；不得手工修改 `.venv` 后把运行结果当作源码修复。

不建议直接继承并覆盖多个 `_wakeup_dispatcher.py` 私有方法作为长期方案：它会把 Synapse 绑定到上游私有 drain/retry 细节，且容易在 AgentScope 升级时静默丢失新字段。若短期兼容层确实需要调用私有方法，必须把版本、覆盖点和 contract test 固定在仓库内，并把它视为临时 patch seam。

## 5. Trigger scope payload

### 5.1 传输原则

scope reference 由服务端在 HTTP enqueue 前生成。它可以是一次性或短期有效的随机 opaque ID，指向 Redis/SQL 中的服务端记录；也可以是带签名、短 TTL 的内部 token，但仍建议保留可撤销的服务端记录，以便 membership version 变化时立即失效。客户端不能创建、延长或替换它。

建议 payload（字段名为内部协议，ID 仍使用字符串形式）：

```json
{
  "schema": 2,
  "trigger_id": "wtr_01J...",
  "kind": "resume",
  "user_id": "42",
  "session_id": "synapse-s7-w12-u42-...",
  "agent_id": "synapse-agent-t7-w12-u42-...",
  "scope_ref": "wscope_01J...",
  "scope": {
    "actor_user_id": "42",
    "tenant_id": "7",
    "workspace_id": "12",
    "membership_version": 18
  },
  "input": {
    "type": "ExternalExecutionResultEvent",
    "reply_id": "..."
  },
  "created_at": "2026-10-13T00:00:00Z",
  "expires_at": "2026-10-13T00:05:00Z",
  "attempt": 0,
  "correlation_id": "req_..."
}
```

`scope` 中的值是诊断冗余和快速 mismatch 检查，不是最终授权依据；最终以 `scope_ref` 对应的服务端记录和消费时数据库查询为准。`input` 仍必须按 AgentScope 事件 discriminated union 校验。`trigger_id` 是幂等键，不能由 retry 重新生成；`attempt` 只用于观测和 backoff。

`wake` 和 `message` 也必须使用同一 scope 协议，不能只保护 resume。旧 payload 若缺少 `schema/scope_ref`，兼容窗口内只能进入“拒绝并报警”的 quarantine/drop 分支，不得按当前默认上下文执行。新版本可以对明确不涉及 Synapse scoped storage 的系统 trigger 做单独 system actor 协议，但不能把用户 session wake 混入该例外。

### 5.2 scope record

scope record 至少包含：

```text
trigger_id / scope_ref
actor_user_id / tenant_id / workspace_id
membership_version_at_enqueue
target_session_id / target_agent_id
issuer_request_id / created_at / expires_at
state: pending | consuming | completed | rejected | expired
```

写入 record 和 queue entry 必须遵守“record 先于 queue”的顺序；只有 record 成功后才 publish wakeup signal。record 过期或标记 rejected 后，旧 queue entry 仍可安全消费为 no-op。scope record 不保存凭据或完整外部结果。

## 6. Dispatcher 消费前的 DB 重验

dispatcher 在创建 `ChatService.run` task 之前按以下顺序执行，任何一步失败都终止本次 dispatch：

1. 校验 payload schema、`trigger_id`、`scope_ref`、kind、input 类型和 TTL；拒绝未知 schema、缺字段、过期或重复 terminal trigger。
2. 读取 scope record，确认 `scope_ref`、`trigger_id`、target session/agent、actor 和 payload 冗余字段完全相等；不相等按 tampered trigger 处理。
3. 在一个短事务/一致性读取中确认 Tenant `status=active`，Workspace `status=active` 且 `workspace.tenant_id=tenant_id`。
4. 确认 actor User 可用，TenantMember 为 `active`，WorkspaceMember 为 `active`，且该关系仍满足当前动作权限。个人会话仍必须满足 `owner_user_id=actor_user_id` 或显式共享授权；不能因为 Workspace 成员身份读取别人的私有会话。
5. 确认当前 tenant `membership_version` 等于 enqueue 时记录的版本。版本变化即拒绝旧 trigger 并让前端重新获取状态；不要在后台自动“升级”旧 scope。
6. 通过 scoped storage 读取 session，确认返回记录的完整 scoped ID、`agent_id` 和 owner 与 trigger 一致。leader 到 worker 的解析必须在 HTTP 入队时完成并作为 target 固化；dispatcher 不得根据未验证的 leader input 再猜 worker。
7. 对 resume/interrupt 额外确认 parked reply/tool-call 仍属于该 session、reply ID 未完成且事件状态允许该 kind。重复提交应成为幂等 no-op 或稳定的“已处理” outcome，不得再次驱动模型。
8. 在所有检查通过后，以本次 DB 读取结果构造新的 immutable `WorkspaceContext`，然后才检查 session lock、获取/续租幂等 lease 并 spawn。

建议将第 3--7 步封装为 `resolve_dispatch_scope(trigger) -> VerifiedDispatchScope | Rejection`，让测试可以在不启动模型的情况下覆盖撤权和 mismatch 矩阵。数据库检查失败的 response 不回传给原 HTTP 请求；通过事件流或内部状态查询提供有限的可观察结果。

## 7. ContextVar 生命周期

dispatcher task 本身不绑定任何用户 WorkspaceContext。它只携带 trigger queue 的 transport loop。每次准备 spawn 一个 run 时：

1. 消费者解析并重验得到 immutable `WorkspaceContext`。
2. 在创建 run coroutine 之前或 run coroutine 的最外层，调用 `bind_agentscope_context(context)`，保存 token。
3. `try/finally` 覆盖整个 `ChatService.run()` 生命周期，包括其内部创建的 asyncio 子任务、消息持久化、workspace/tool 访问和错误处理。
4. 在 finally 中用原 token `reset_agentscope_context(token)`；不得使用 `set(None)` 替代 reset，不得把 context 放在 dispatcher 实例字段或全局可变变量上。
5. retry timer 只携带不可变 trigger/original scope reference，不携带可变 ContextVar；每次 retry 消费都重新重验并重新 bind。
6. dispatcher shutdown、task cancellation 和异常都必须经过同一 finally；scope record 的 `consuming` lease 也要转为可重试或 rejected，不能留下永远占用的状态。

如果 AgentScope 的 `ChatRunRegistry.spawn()` 接收的是已创建 coroutine，adapter 必须保证 bind 发生在 coroutine 的实际入口，而不是只在 dispatcher 当前 task 周围短暂 bind；否则 coroutine 可能在无上下文的 task 中运行。建议仓库自有 `run_with_workspace_context(context, coro_factory)` 接受 coroutine factory，在其内部完成 bind、run、reset。

## 8. 幂等、锁与 retry

现有 AgentScope 设计用 session distributed lock、inbox consumer lease 和 dispatcher retry 避免同一 session 的 spawn race；安全传播方案应保留这些串行化语义，并新增 trigger 级幂等：

- `trigger_id` 对 scope record 做唯一约束；同一人工结果重试不能生成第二个逻辑 trigger。
- 消费前抢占短 TTL `dispatch_lease(trigger_id)`，使用 Redis `SET NX` 或等价 CAS；抢不到 lease 的消费者不重复执行。
- lease 获取与 session lock 检查的顺序固定并写入 contract。session busy 时保留原 trigger，按指数 backoff + jitter 重入队；retry 必须带原 `trigger_id/scope_ref`，不能在每次 retry 产生新 trigger。
- 达到最大 attempts、超过 `expires_at` 或确认 scope 已撤销时，标记 `expired/rejected`，发布一条不含敏感输入的 session error event，并停止 retry。对仍可能等待的 HITL 状态，记录需要重新提交，而不是静默假装成功。
- spawn 前后都要处理崩溃窗口：`consuming` lease 过期后可由下一消费者重新验证；`completed` 只能由 run 的最终持久化/事件状态推进，不能由“已调用 spawn”直接标记。
- session lock 仍是 run 级最后防线；不可用 lock、Redis timeout 或 DB transient error 进入可重试错误，而不是把上下文降级为空。

## 9. 错误可观察性

日志和指标必须能关联 `trigger_id`、`scope_ref` 的 hash/短 ID、`correlation_id`、kind、target session 的 hash、attempt、最终 outcome 和 latency；默认不记录外部结果正文、凭据、完整 tool 参数、cookie 或 JWT。

建议 outcome 枚举：

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

至少提供以下指标/告警：

- 入队数、消费数、scope rejection 数，按 kind 和 reason 分组；
- `accepted -> run_completed` 延迟及 `200` 后未出现后台 outcome 的数量；
- retry 次数、最大 attempts、lease expiry、duplicate ratio；
- fail-closed `Workspace context missing` 次数，目标是修复后为零；
- 被撤权/版本变化拒绝的 trigger 数，以及 session error event 投递失败数。

`scope_mismatch`、`membership_revoked`、`agent_mismatch` 等日志必须使用统一 problem code 语义，但不能让 HTTP 客户端通过差异探测其他 Workspace 资源。可在内部管理日志和测试 fixture 中保留精确 reason。

## 10. 兼容、部署与回滚

兼容策略分两阶段：

1. **观测阶段**：新增 schema version 和指标；旧 payload 仅记录并拒绝执行，保留原始 queue entry 的安全 quarantine/TTL 处理。不要静默用当前 request context 补旧 payload。
2. **切换阶段**：所有生产 enqueue 都写 schema 2 + scope record；验证 dispatcher 能消费 schema 2 后，再清理旧 queue。滚动部署期间必须让新消费者能识别旧 entry 并安全 drop，新 producer 不能再写旧格式。

回滚只允许回到“全部 fail-closed、触发器不执行”的安全状态，不能回滚到无 scope 的后台执行。若新 adapter 发现严重错误：

- 停止消费或拒绝 schema 2 trigger；
- 保留 scope record、trigger_id 和诊断指标，便于重新投递；
- 继续允许 HTTP 返回明确的 accepted/queued 状态，但将前端显示为“等待后台处理/可重试”，不声称已完成；
- 修复后用原 trigger_id 在新一轮重验中恢复，不能复制 payload 生成绕过幂等的新任务。

AgentScope 版本升级必须重新运行 compatibility contract tests，特别是 `_bus_ops.py` payload 序列化、dispatcher retry、`ChatService.run` coroutine 创建时机和 event union 字段；不能把 `.venv` 中手工改过的文件作为升级依据。

## 11. 验收矩阵

| 场景 | 入队/消费预期 | 安全断言 | 建议证据 |
| --- | --- | --- | --- |
| 同一 actor、同一 Workspace 的 external result | accepted，最终 spawned/run_completed | session、agent、scope 三者匹配；ContextVar 在整个 run 有效 | 后端集成测试 + Redis/DB 事件 |
| `UserConfirmResultEvent` | accepted，parked run 恢复 | reply/tool-call 属于目标 session 且只处理一次 | dispatcher contract test |
| `UserInterruptEvent` | accepted，最终 interrupted 状态 | interrupt 不能绕过 parked reply 校验 | F26b backend verification |
| HTTP 返回 200 但 dispatcher 失败 | accepted 后出现 rejected/run_failed | UI 不把 200 当最终成功；有 correlation/outcome | API + event stream test |
| TenantMember 撤权后消费 | rejected | 不访问 session，不 spawn，不读 workspace | DB 竞态测试 |
| WorkspaceMember 撤权/降权后消费 | rejected | membership_version 或 active 状态不通过 | DB 竞态测试 |
| tenant/workspace inactive | rejected | 统一 fail-closed；不泄露存在性 | authorization matrix |
| session 删除后消费 | rejected/session_missing | 不调用 `ChatService.run`，不产生跨作用域错误 | orphan trigger test |
| agent mismatch / leader-worker mismatch | rejected | 不按客户端 agent 猜测或改写 target | projection + dispatcher test |
| 同一 trigger 重复投递 | duplicate/no-op | 最多一次逻辑 resume；不会重复工具结果 | idempotency test |
| session lock 持有 | lock_retry 后最终只 spawn 一次 | 原 trigger_id/scope_ref 保持不变 | lock/retry test |
| Redis/DB transient failure | retry 或可诊断失败 | 不清空 context、不降级默认 Workspace | fault injection |
| 无 scope 的旧 payload | malformed/scope_missing | 不执行，不调用未绑定的 session storage | compatibility test |
| 两个 Workspace 的同 ID/相似输入 | 各自独立或拒绝 | Redis key、session prefix、事件流不交叉 | F21b isolation regression |
| 真实外部执行器恢复 | run_completed 或明确 run_failed | 覆盖模型续跑和最终助手文本，而非只看 HTTP 200 | F26b 后端验收 |

## 12. 具体测试文件建议

本次不新增测试文件；实现阶段建议将测试放在仓库自有路径，不把测试写入 `.venv`：

- `apps/api/tests/integrations/test_agentscope_wakeup_scope.py`：schema、scope record、ContextVar bind/reset、malformed/unknown version 和 scope mismatch。
- `apps/api/tests/integrations/test_agentscope_wakeup_dispatcher.py`：消费前 DB 重验、session/agent ownership、tenant/workspace/member 状态、membership version、spawn seam 和错误 outcome。
- `apps/api/tests/integrations/test_agentscope_wakeup_idempotency.py`：重复 trigger、dispatch lease、session lock 持有、backoff retry、lease expiry 和 retry exhaustion。
- `apps/api/tests/verification/test_f26b_external_result.py`：增加真实后台 external-result resume、interrupt 最终状态、HTTP `200` 后 outcome、撤权竞态和 Redis/DB 清理证据。
- `apps/api/tests/verification/f26b_external_result.mjs`：只补前端对 queued/processing/failed/retry 状态的断言；不要把浏览器看到 `200` 作为后台完成断言。
- `apps/api/tests/integrations/test_agentscope_session_scope.py`：保留 F21b 的跨 Workspace/actor session、message、bus lock/inbox/replay 隔离回归，并增加 dispatcher-created task 的 context inheritance 检查。
- 若采用仓库 patch：`apps/api/tests/integrations/test_agentscope_compatibility.py` 固定 pin 版本、payload 字段和上游 serializer/dispatcher 行为，升级 AgentScope 时先运行该文件。

每项后台测试都应使用独立临时 Redis namespace/数据库和带前缀的 fixture key，按精确 key 清理；不得使用 `FLUSHDB`，延续 F26b 报告的清理约束。

## 13. 结论与未决问题

关键结论：

- 根因不是单纯“给 WakeupDispatcher 设置一个全局 ContextVar”，而是 durable trigger 协议没有持久化可重验的 scope。
- 正确 seam 是仓库自有的 trigger/dispatcher adapter：在 enqueue 时生成服务端 scope reference，在 consume 时 DB 重验，再在每个 run task 内 bind/reset immutable `WorkspaceContext`。
- `WorkspaceSessionStorage` 和 workspace filesystem adapter 应继续 fail-closed；放宽它们会把后台缺陷变成跨 Workspace 风险。
- session lock、inbox consumer lease 和 dispatcher retry 仍然需要，但必须以原 `trigger_id/scope_ref` 重试，并加 trigger 级幂等。
- F26b 当前只证明 UI wire contract 和 HTTP 行为；完成本方案前不能宣称真实后台 external-result/interrupt resume 已验收。

未决问题：

1. AgentScope 上游是否愿意提供公开的 trigger payload extension 和 pre-dispatch context factory；若不能，Synapse 是否接受短期仓库自有 dispatcher 兼容实现？
2. scope record 放在现有 SQL 事务、AgentScope Redis，还是单独的 Synapse Redis namespace？需要明确故障时的 record/queue 一致性策略。
3. `membership_version` 当前以 Tenant 版本为主，是否需要 Workspace 级版本或 actor-specific authorization epoch，以便更窄、更快地撤销单个空间成员？
4. parked reply/tool-call 的权威状态和原子“未处理 -> 已消费”更新点在哪里；需要确认是否能与 scope record/dispatch lease 形成可恢复的幂等状态机。
5. HTTP response schema 是否要新增 `accepted/trigger_id`，以及前端如何在不泄露内部 scope reference 的前提下查询后台 outcome？
6. 多进程/多实例部署中，scope record 的 lease、session lock 和 event stream 是否共享同一 Redis 可用性与时钟假设；需要为 Redis/DB 分裂场景确定明确的 fail-closed 行为。


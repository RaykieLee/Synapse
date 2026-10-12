# F27b 子智能体团队编排与执行控制 UX/API 方案

状态：方案梳理，未修改产品代码。

本文定义 F27b 在 F27a“子智能体团队与任务只读面板”之上的可控能力。目标不是把 AgentScope 的内部工具直接暴露给浏览器，而是在 Synapse 的 Workspace、actor、session 和权限模型之上建立一个可审计、可恢复、可逐步实现的团队编排模块。

## 1. 范围与证据

### 1.1 本期解决的问题

- 用户可以在当前 Workspace 内创建一个团队，选择负责人和子智能体成员。
- 用户可以为团队建立任务，查看任务依赖、负责人、状态和最近进展。
- 用户可以启动一次团队运行，并在团队级别查看负责人和成员 session 的收敛状态。
- 用户可以暂停、继续或中断一次运行；控制动作必须有明确的作用对象和最终状态。
- 用户可以看到失败原因、部分成功结果和可重试范围，而不是只能重新创建整个团队。
- 所有读写和实时事件都继承 Synapse 已验证的 `tenant_id`、`workspace_id`、`actor_user_id` 和成员关系版本。

### 1.2 当前证据

| 结论 | 证据 | 影响 |
| --- | --- | --- |
| F27a 已有团队/成员/负责人任务的只读展示 | `docs/verification/F27a-team-panel.md`；`apps/web/src/features/workspaces/sessions-page.tsx` 的 `TeamOverview` | F27b 应复用已有信息架构和状态文案，不把只读面板改成隐藏式控制台 |
| AgentScope 的团队创建、成员创建、邀请、沟通和解散是工具 | `apps/api/.venv/Lib/site-packages/agentscope/app/_tool/_team_create.py`、`_agent_create.py`、`_agent_invite.py`、`_team_say.py`、`_team_delete.py` | 当前能力由 leader session 中的模型自主调用；没有对应的用户管理 HTTP 端点 |
| Team 的持久化模型已有 `TeamRecord`、`TeamData`、`TeamMember` | `agentscope/app/storage/_model/_team.py`（通过 `agentscope.app.storage` 导出）；`storage/_base.py` 的 Team persistence | 可作为 AgentScope adapter 的内部实现参考，但不能直接作为 Synapse 的跨 Workspace 权限模型 |
| session 是团队成员归属的实际连接点 | `agentscope/app/storage/_model/_session.py`；`SessionRecord.team_id`、`TeamRecord.session_id`、`TeamMember.session_id` | API 必须返回 team/session 的显式关系，不能只传 agent ID |
| 任务是 `AgentState.tasks_context.tasks` 中的 `Task` 列表 | `agentscope/state/_state.py`、`agentscope/state/_task.py`；当前前端只显示 `pending/in_progress/completed` | F27b 首期可以做任务投影/控制适配，但要补充稳定版本、来源和并发条件 |
| AgentScope 有 session 级运行状态和中断 | `agentscope/app/_router/_session.py`、`apps/api/app/integrations/agentscope_gateway.py`、`docs/verification/f25b1-interrupt.md` | 可以复用 session 级 `status` 和 `POST /sessions/{id}/interrupt`，但团队级暂停/继续仍需 Synapse 编排层 |
| AgentScope 的实时流是单 session SSE | `GET /sessions/{session_id}/stream`，见 `agentscope/app/_router/_session.py`；已有事件消费见 `sessions-page.tsx` | F27b 需要团队聚合 SSE 或明确的多 session 订阅策略，不能让浏览器自行猜测成员 session |
| Synapse gateway 会校验 JWT/cookie、Workspace 成员资格并绑定上下文 | `apps/api/app/integrations/agentscope_gateway.py`、`docs/agentscope-tenant-context.md` | 所有团队 API 要走同一个可信上下文，不接受客户端传入 actor/tenant 作为授权依据 |

### 1.3 已有与待适配能力

| 能力 | AgentScope 已有 | Synapse 需要补齐 |
| --- | --- | --- |
| 团队记录 | `TeamRecord`、`TeamData.name/description/members`、leader session | `tenant_id/workspace_id/created_by/updated_by` 归属投影、版本、审计、列表与权限 |
| 创建团队 | `TeamCreate`，要求当前 session 未加入团队，创建后绑定 leader session | 面向用户的创建接口、幂等键、Workspace 校验、表单验证、失败补偿 |
| 新建成员 | `AgentCreate`，创建 team-source agent、team session，并立即投递首个 prompt | UI 成员配置、批量创建的部分成功、每个成员的能力/权限确认、可取消的启动编排 |
| 邀请成员 | `AgentInvite`，借用已有可邀请 agent，创建 team-scoped session | actor 跨所有权授权、跨 actor 资源可见性、Workspace 兼容性和撤销语义 |
| 团队消息 | `TeamSay` 通过 inbox/message bus 唤醒目标 session | 用户可见的进度摘要、消息脱敏、审计和事件投影 |
| 解散团队 | `TeamDelete` 会取消并删除 created 成员；invited 成员只删除借用 session | 用户确认、可恢复策略、运行中保护、删除与归档区分 |
| 任务模型 | `Task` 有 subject/description/metadata/state/id/owner/blocks/blocked_by | 任务 API、版本、稳定状态机、重试/跳过/取消、依赖校验、用户编辑与运行器一致性 |
| 启动运行 | `POST /chat/` 触发单个 session run；AgentScope 内部会通过工具创建成员和投递消息 | 团队 run 聚合、预检、一次性幂等键、后台 worker/队列、运行归属和团队级状态 |
| 中断运行 | session 级 interrupt 支持 running 和 HITL parked | 团队级中断级联、成员收敛确认、超时与人工处置 |
| 暂停/继续 | 没有证据表明有用户级 team pause/resume HTTP 契约；HITL parked 是等待确认，不等于用户暂停 | 需要定义“软暂停”语义、调度门禁、恢复点和执行器支持 |
| 进度 | session `status`、`tasks_context`、session SSE 事件 | team aggregate、task progress 事件、事件去重/重放/补偿查询 |

不确定处必须以“待证实”处理：在真实模型、真实 AgentCreate/AgentInvite、多进程 worker 和重启场景完成前，不能宣称 F27b 的编排执行已验证。F27a 报告明确排除了真实模型和子智能体编排执行。

## 2. 用户主流程

### 2.1 入口与信息架构

入口建议放在当前 Workspace 的 AI 区域，保留 F27a 的会话团队概览作为运行详情入口：

1. `团队`列表：显示草稿、就绪、运行中、暂停、失败、已完成、归档团队。
2. `团队详情`：顶部为团队状态和控制区；中部为成员；下部为任务、事件时间线和结果。
3. `创建/编辑团队`：分步或单页表单，始终显示当前 Workspace 和归属 actor。
4. `运行详情`：可以从团队详情进入，也可以从负责人 session 进入；两者指向同一个 `team_run_id`。
5. `成员 session`：默认只读查看。用户若有权限可进入对应 session 的消息/工具时间线，但不能因为打开成员 session 就获得团队控制权。

桌面采用“左侧团队/运行列表 + 右侧详情”；窄屏改为“列表页 → 详情页”，控制区使用底部或顶部 sticky action bar。F27a 现有 `sessions-page.tsx` 的成员与任务区域可作为详情页视觉起点，但控制动作必须集中在团队 run 头部，避免把 `TeamOverview` 变成散落按钮集合。

### 2.2 创建到完成

1. 用户进入当前 Workspace 的团队页，点击“创建团队”。
2. 填写团队名称、目标/说明和默认执行策略。名称在当前 actor 可见范围内校验唯一性，说明作为团队 charter。
3. 选择负责人 agent/session。首期只允许选择当前 Workspace、当前 actor 可操作且已配置模型的 agent；不允许在表单中偷偷跨 actor 借用 agent。
4. 添加子智能体成员。每个成员至少需要 agent、角色说明、首个任务提示和权限模式；显示其来源为“本 actor 新建”或“已授权邀请”。
5. 编写任务清单：任务标题、描述、owner、依赖、是否允许失败后继续。保存为 `draft`，不启动模型。
6. 预检：检查 Workspace active、成员可见性、模型/凭据、工作目录、权限策略、任务依赖无环、成员数量/并发限制和预算限制。
7. 用户点击“启动团队”。服务端创建 `team_run`，固定本次运行的团队版本、成员 session、任务快照和授权版本；返回 `202`。
8. 详情页先显示“准备中”，收到 `run_started` 后显示“运行中”；成员逐项显示 `pending/running/waiting/succeeded/failed/interrupted`。
9. 用户可以查看任务和事件，向负责人 session 发送补充消息，或对待确认工具请求执行已有 F26a/F26b 流程。团队控制动作不通过普通聊天文本模拟。
10. 成功时显示完成摘要和可打开的成员结果；部分失败时保留成功结果、标出失败任务并提供“重试失败任务/重新运行全部”。
11. 用户可以归档团队或结束运行。归档不删除历史 run；解散/删除要有明确的不可逆提示和成员 session 影响说明。

## 3. 团队创建、成员配置与任务分配

### 3.1 团队创建

表单字段：

| 字段 | 规则 | 首期 |
| --- | --- | --- |
| `name` | 必填，长度 1–100；当前 Workspace 内同 actor 的活动团队唯一 | 支持 |
| `description` | 可选，长度 0–4000；作为 charter 展示并传给执行器 | 支持 |
| `leader_agent_id` | 必填；必须在当前 Workspace 可见且可编辑 | 支持 |
| `leader_session_id` | 可选；首期服务端新建或复用明确指定的负责人 session | 支持，策略固定 |
| `execution_policy` | 并发上限、失败策略、工具确认策略、预算/超时 | 首期只开放安全子集 |
| `template_id` | 成员角色模板 | 后续；若复用 AgentScope `SubAgentTemplate`，需版本化 |

创建成功只表示配置持久化，不表示已经开始执行。API 返回 `team_id`、`version`、`status=draft` 和能力矩阵，前端据此决定按钮，不用本地猜测。

### 3.2 成员配置

成员行应显示：

- 展示名称、agent ID 的短引用、来源 actor、来源类型（created/invited）。
- 角色/职责描述和首个任务提示。
- 使用的模型/凭据名称只显示安全标签，不返回密钥。
- 工具权限模式、工作目录范围、可访问资源摘要。
- 当前 team-scoped session、运行状态和最近一次错误。
- 是否允许该成员独立重试、是否允许失败后继续。

配置约束：

- created 成员由团队创建并随团队生命周期管理；invited 成员保留原 agent，但只创建/删除本团队的借用 session。
- 首期不允许在运行中修改成员的 agent、session 归属、模型凭据或工作目录；允许修改未开始任务的说明和依赖，保存后产生新 `team.version`。
- 运行中的成员不支持直接删除；使用“停止成员”或中断整个 run，待其进入终态后再移除。
- 当前 AgentScope `AgentCreate` 会立即启动成员首个 prompt；Synapse UI 不应把“保存成员”误标为“已执行”。适配器应先保存配置，再由 run orchestrator 明确创建 session 和投递首个任务。

### 3.3 任务分配

任务模型建议：

```json
{
  "task_id": "task_01",
  "team_id": "team_01",
  "team_run_id": "run_01",
  "subject": "收集背景资料",
  "description": "给出可核验来源和结论",
  "owner_member_id": "member_researcher",
  "depends_on": [],
  "allow_failure": false,
  "state": "pending",
  "attempt": 0,
  "progress": 0,
  "version": 3
}
```

用户看到的任务状态应比 AgentScope 原始三态更丰富：

`draft → pending → ready → dispatched → running → waiting → succeeded | failed | interrupted | skipped | cancelled`

其中 `blocked` 是派生显示状态：存在未完成依赖或调度条件不满足，不作为执行器最终状态。AgentScope `Task.blocks/blocked_by` 可作为依赖参考，但 Synapse 必须在写入时验证引用存在、同属一个 run、无环和版本一致。

任务分配采取显式 owner，不让模型只凭自然语言决定所有权。自动拆解可以作为后续能力，但必须产出可审阅的任务草稿，用户确认后才能启动。

## 4. 启动、暂停、继续与中断

### 4.1 启动

启动前端检查清单：

- 当前 Workspace、租户和成员资格仍有效。
- 团队配置版本没有被其他用户更新。
- 负责人和成员 agent/session 仍存在且绑定正确。
- 每个要执行的成员都有可用模型配置；凭据只做存在性和权限检查，不回显秘密。
- 工作目录和附件引用仍属于允许的 Workspace/actor 范围。
- 任务依赖无环，至少有一个可执行任务；空团队只能保存，不能启动。
- 并发、预算、超时和工具权限符合 Workspace policy。

启动是幂等操作。客户端发送 `Idempotency-Key`；同一 key 重试返回原 `team_run_id`，不同 key 在已有 active run 时返回 `409 RUN_ALREADY_ACTIVE`，不重复创建成员 session 或投递首个 prompt。

### 4.2 暂停与继续

“暂停”必须明确为两层语义：

1. `soft_pause`：阻止未开始任务继续派发，不强杀正在执行的模型/工具；当前任务完成后进入 `paused`。
2. `hard_stop`/中断：向当前运行中的所有成员发送中断，等待其 session 进入 `interrupted` 或 `idle`，用于紧急停止。

首期只承诺 `soft_pause`，且只在编排器拥有可持久化 dispatch queue 时开放。若 AgentScope 运行器尚无安全的 pause checkpoint，UI 不应伪装出可立即冻结模型的“暂停”按钮；可以只提供“停止未开始任务”或“请求中断”。

继续运行必须从 durable `team_run` 和任务状态重建，不从浏览器内存恢复。已成功任务默认不重复执行；`waiting` 任务按等待原因继续；失败任务仅在用户选择重试后增加 `attempt`。

### 4.3 中断

团队中断流程：

1. API 将 run 从 `running/pausing` 改为 `interrupt_requested`，记录 actor 和原因。
2. 编排器向每个 active member session 调用已有 session interrupt 语义。
3. 仍未收敛的成员显示“停止请求已发送，等待执行器确认”，不要立即伪造 `interrupted`。
4. 所有成员到达终态或超时后，run 变为 `interrupted` 或 `interrupted_with_pending_members`。
5. 用户可以查看未收敛成员，并重试中断请求；该动作应幂等。

AgentScope 当前的 `POST /sessions/{session_id}/interrupt?agent_id=...` 对已有 session 返回 `202`，对 running、HITL parked 和 idle 都是幂等入口。Synapse 需要处理的是多成员级联、授权版本、超时和汇总状态，而不是让浏览器循环调用所有 session ID。

## 5. 进度反馈与失败恢复

### 5.1 进度投影

团队详情至少显示三种进度，避免单一百分比误导：

- 任务完成率：`succeeded / (可计入任务总数)`；`skipped`、`cancelled` 单独计数。
- 成员状态：每个成员的当前 session status、当前 task、最近事件时间。
- 运行阶段：准备、派发、执行、等待人工、汇总、完成/失败。

F27a 当前显示 `1/3 · 33%`、`2/3 · 67%`，这是可保留的摘要；F27b 应在旁边提供“有 1 个成员等待工具确认”“还有 2 个任务被依赖阻塞”等可解释信息。

### 5.2 失败分类

| 类型 | 示例 | 用户动作 |
| --- | --- | --- |
| 配置失败 | 缺少模型、凭据不可用、成员已被删除 | 修改配置后重新预检 |
| 调度失败 | 并发上限、依赖循环、重复 dispatch | 修正任务或重试调度 |
| 执行失败 | 模型/工具返回错误、成员 session 崩溃 | 查看脱敏错误，重试该任务 |
| 权限失败 | Workspace 撤权、资源不再可见 | 回到当前 Workspace，重新授权或放弃 |
| 中断/超时 | 用户中断、worker 超时、锁未释放 | 重试停止、恢复可执行任务或结束 run |
| 部分成功 | 一些任务完成，另一些失败 | 保留结果，选择仅重试失败项 |

错误信息至少包括稳定 `code`、用户可读摘要、是否可重试、建议动作和关联 task/member/session。内部异常、凭据、文件绝对路径、完整工具参数和跨 actor 资源 ID 不应直接返回。

### 5.3 恢复动作

- `Retry failed tasks`：只重试 `failed`，并重新检查依赖；默认复用成功任务结果的引用，不复制上下文全文。
- `Resume run`：从 `paused/waiting` 继续，不创建新 run。
- `Clone run`：创建新 run，复制团队版本和任务草稿，但显式标记为新执行。
- `Discard pending`：将未派发任务标记为 `cancelled`，保留已完成结果。
- `Export result`：只导出用户有权查看的结果，继续走文件/下载权限。

## 6. 权限与归属

### 6.1 归属层级

```text
Tenant
└── Workspace
    ├── Team definition (team_id, version)
    │   ├── Team member (member_id -> agent_id/session_id)
    │   └── Task definition
    └── Team run (team_run_id)
        ├── Task run
        └── AgentScope sessions / messages / events
```

归属规则：

- `Workspace` 是业务可见性和操作权限边界；team、run、task definition 必须带 `tenant_id` 和 `workspace_id`。
- `actor` 是创建者/操作者/审计主体，不等同于 Workspace；同一 Workspace 内的普通成员不能因为知道 ID 就读取其他 actor 的私有 session、凭据或工作目录。
- `team` 是配置和成员编排容器；`team_run` 是一次不可变快照/执行实例。编辑 team 不改变历史 run。
- `session` 是 AgentScope 执行上下文，leader 和 worker 各有独立 session；session 的 `team_id` 只表达参与关系，不能替代 Synapse 的 team/run 归属。
- `task` 是用户可管理的业务对象；`TaskContext` 是 AgentScope 运行状态投影。两者需要稳定映射，不应把任意模型写入的 `metadata` 当作授权字段。

### 6.2 权限建议

| 操作 | Workspace owner/admin | Workspace member | 只读成员 |
| --- | --- | --- | --- |
| 查看自己有权看到的团队/run | 是 | 是 | 是 |
| 创建团队 | 是 | 按 `team:create` | 否 |
| 编辑未运行团队 | 是 | 按 `team:update` 且为创建者/受授予者 | 否 |
| 启动/暂停/中断自己有权管理的 run | 是 | 按 `team:control` | 否 |
| 查看成员 session 消息 | 按 session/resource policy | 仅被授予的范围 | 仅摘要或脱敏结果 |
| 读取凭据明文 | 否，除凭据运行时 resolver | 否 | 否 |
| 解散/删除团队 | 是；运行中需额外确认 | 仅 owner/显式权限 | 否 |
| 修改 Workspace 级并发/预算策略 | 是 | 否 | 否 |

所有读写接口都以服务端当前上下文为准：客户端只提供 `X-Workspace-ID` 作为选择器，不能提供 `X-User-ID`、`X-Tenant-ID` 或任意 owner 作为授权依据。成员撤权后，新请求和 SSE 重连必须被拒绝；已建立 SSE 是否立即终止需要在适配器中实现持续授权或接受当前 gateway 的“建连时校验”限制。

### 6.3 只读 vs 可控边界

只读：

- 团队名称、说明、成员摘要、关联 session、任务状态、进度、脱敏事件和结果摘要。
- 打开 leader/worker session 的历史消息；是否可看完整内容由 session/resource policy 决定。
- 读取当前 run 的配置快照和审计时间线。

可控：

- 创建/编辑未运行 team 和 task。
- 启动、soft pause、continue、interrupt、retry failed tasks、cancel pending tasks。
- 处理已有工具确认/外部结果请求，但仍使用 F26a/F26b 的单次确认和当前 session 权限。

明确不可控：

- 通过前端伪造 actor、tenant、Workspace 或成员 session。
- 直接写 Redis team key、session state 或 `tasks_context` 绕过版本和审计。
- 修改运行中成员的系统提示、凭据、工作目录或权限模式。
- 将 invited agent 的 owner-private session、memory、credentials、workspace 文件展示给团队其他成员。
- 以“暂停”名义强行杀掉工具进程或外部副作用；这只能由明确的中断/撤销契约覆盖。

## 7. API 契约

### 7.1 约定

- 路径建议挂载在现有 `/api/v1/ai` 下，但团队控制应由 Synapse adapter/service 统一收口，不直接暴露 AgentScope 内部 storage。
- 所有请求带 `Authorization` 或现有 session cookie，并带一个 `X-Workspace-ID`。
- 成功响应使用明确的资源版本；写操作返回最新 `version` 或 `run_version`。
- 并发写入使用 `If-Match: "<version>"` 或 body `expected_version`；不匹配返回 `409 VERSION_CONFLICT`。
- 启动使用 `Idempotency-Key`；重复请求必须返回相同 run。
- 错误采用现有 Problem JSON，至少包含 `code`、`detail`、`retryable`、`resource_type`、`resource_id`。

### 7.2 团队与成员接口

| 方法 | 路径 | 用途 | 首期 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/ai/teams?status=&cursor=` | 当前 Workspace 团队分页列表 | 是 |
| `POST` | `/api/v1/ai/teams` | 创建 `draft` 团队 | 是 |
| `GET` | `/api/v1/ai/teams/{team_id}` | 团队详情、成员、能力矩阵、最新 run 摘要 | 是 |
| `PATCH` | `/api/v1/ai/teams/{team_id}` | 更新名称/说明/策略，要求版本 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/members` | 添加 created/invited 成员 | 是，先支持 created |
| `PATCH` | `/api/v1/ai/teams/{team_id}/members/{member_id}` | 更新未运行成员配置 | 是 |
| `DELETE` | `/api/v1/ai/teams/{team_id}/members/{member_id}` | 移除未运行成员 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/archive` | 归档配置，不删除历史 run | 是 |
| `DELETE` | `/api/v1/ai/teams/{team_id}` | 解散/删除，需确认 | 后续 |

成员创建不是简单透传 AgentScope `AgentCreate`：adapter 必须将用户输入转换为可审计的 agent/session 创建命令，保证失败时不会留下孤儿 agent、session 或 team roster。

### 7.3 任务与 run 接口

| 方法 | 路径 | 用途 | 首期 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/ai/teams/{team_id}/tasks` | 团队任务模板/当前 run 任务 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/tasks` | 新建任务草稿 | 是 |
| `PATCH` | `/api/v1/ai/teams/{team_id}/tasks/{task_id}` | 编辑未派发任务 | 是 |
| `DELETE` | `/api/v1/ai/teams/{team_id}/tasks/{task_id}` | 删除未派发任务 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/runs` | 预检并启动一次运行 | 是 |
| `GET` | `/api/v1/ai/teams/{team_id}/runs?cursor=` | 运行历史 | 是 |
| `GET` | `/api/v1/ai/teams/{team_id}/runs/{run_id}` | run 聚合详情、任务和成员状态 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/runs/{run_id}/pause` | soft pause | 首期可选，取决于 worker |
| `POST` | `/api/v1/ai/teams/{team_id}/runs/{run_id}/resume` | 继续 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/runs/{run_id}/interrupt` | 级联中断 | 是 |
| `POST` | `/api/v1/ai/teams/{team_id}/runs/{run_id}/retry` | 重试失败任务或指定 task | 是 |
| `GET` | `/api/v1/ai/teams/{team_id}/runs/{run_id}/events` | 团队聚合 SSE | 是 |
| `GET` | `/api/v1/ai/teams/{team_id}/runs/{run_id}/events/snapshot` | 断线后的完整快照/补偿查询 | 是 |

启动请求示例：

```json
{
  "team_version": 7,
  "task_ids": ["task_01", "task_02", "task_03"],
  "policy": {
    "max_parallel": 2,
    "on_failure": "continue_independent",
    "permission_mode": "ask"
  }
}
```

启动响应：

```json
{
  "team_id": "team_01",
  "team_run_id": "run_01",
  "team_version": 7,
  "run_version": 1,
  "status": "preparing",
  "accepted_at": "2026-10-13T10:00:00Z"
}
```

`202` 只表示命令已接受。前端必须等待 `run_started` 或查询详情，不得把 `202` 显示为“已完成”。

### 7.4 快照响应

`GET /runs/{run_id}` 建议返回：

```json
{
  "team_run_id": "run_01",
  "team_id": "team_01",
  "workspace_id": "workspace_01",
  "created_by": "actor_01",
  "status": "running",
  "run_version": 12,
  "progress": {
    "succeeded": 1,
    "running": 1,
    "waiting": 0,
    "failed": 0,
    "pending": 1,
    "percent": 33
  },
  "members": [
    {
      "member_id": "member_researcher",
      "agent_id": "agent_01",
      "session_id": "session_01",
      "status": "succeeded",
      "current_task_id": "task_01",
      "last_event_at": "2026-10-13T10:01:02Z"
    }
  ],
  "tasks": [],
  "capabilities": {
    "can_pause": false,
    "can_resume": false,
    "can_interrupt": true,
    "can_retry": false
  },
  "last_error": null
}
```

`capabilities` 是服务端按当前 actor、run 状态和策略计算的结果；UI 只使用它控制按钮，仍必须处理 API 返回的 `403/409`。

## 8. 状态机

### 8.1 团队配置状态

```text
draft -> ready -> archived
  |       |
  |       +--> running (通过创建 run，不改变历史版本)
  +--> archived
```

- `draft`：可编辑，可能缺少成员/任务/模型。
- `ready`：预检通过，可启动。
- `archived`：不可编辑、不可启动，只读历史。

### 8.2 团队 run 状态

```text
preparing -> running -> pausing -> paused -> running
     |          |          |         |
     |          |          |         +--> interrupted
     |          |          +------------> failed
     |          +--> waiting_user -> running
     |          +--> interrupt_requested -> interrupted
     |          +--> completed
     +--> failed
```

允许的终态：`completed`、`completed_with_failures`、`failed`、`interrupted`、`interrupted_with_pending_members`、`cancelled`。

规则：

- `preparing` 期间失败不应留下 active run；若已分配资源，进入 `failed` 并执行补偿。
- `running` 只能由服务端调度器推进；浏览器不能直接把 task 改成 completed。
- `paused` 只表示未继续派发；正在执行的任务必须先收敛，除非用户明确请求 interrupt。
- `waiting_user` 包括工具确认和外部结果，不等于失败，也不等于用户点击了 pause。
- `completed_with_failures` 要求至少一个 task succeeded 且至少一个 task failed/skipped；结果页必须同时展示两类结果。
- 任何非幂等状态转移都要求 `expected_run_version`，重复相同命令返回当前状态，不重复副作用。

### 8.3 任务状态

任务状态转移应由 orchestrator 产生：

```text
draft -> pending -> ready -> dispatched -> running
                                      |       |
                                      |       +--> waiting -> running
                                      |       +--> succeeded
                                      |       +--> failed -> retry -> pending
                                      |       +--> interrupted -> retry -> pending
                                      +--> skipped/cancelled
```

禁止用户直接把 `running` 改成 `succeeded`。用户操作只能产生命令：retry、skip、cancel pending、resume 或 interrupt。

## 9. SSE 事件

### 9.1 现有基础

AgentScope session SSE 当前会：

- 先回放当前 run 的事件日志，再订阅实时事件；
- 每 30 秒发送 heartbeat comment；
- 通过 `REPLY_START`、文本增量、工具调用、确认/外部执行和 `REPLY_END` 等事件驱动聊天 UI；
- 由 Synapse gateway 在建连时校验 Workspace，撤权后的新连接会拒绝；已建立的 stream 当前不会持续重新授权。

F27a 已因真实 session event 到达后列表未刷新而补充 `payload` envelope 解包、`REPLY_START` 刷新和 3 秒 fallback。这说明团队进度不能只依赖一次事件，要有快照补偿。

### 9.2 团队聚合事件格式

建议 `GET /teams/{team_id}/runs/{run_id}/events` 返回统一 envelope：

```text
id: evt_00042
event: task_state_changed
data: {"team_run_id":"run_01","run_version":13,...}
```

事件字段：

```json
{
  "event_id": "evt_00042",
  "sequence": 42,
  "event_type": "task_state_changed",
  "team_id": "team_01",
  "team_run_id": "run_01",
  "member_id": "member_01",
  "session_id": "session_01",
  "task_id": "task_01",
  "run_version": 13,
  "occurred_at": "2026-10-13T10:01:02Z",
  "payload": {}
}
```

首期事件：

| 事件 | 用途 |
| --- | --- |
| `snapshot` | 首次连接或补偿后的完整投影 |
| `run_preparing` / `run_started` | 运行生命周期 |
| `member_created` / `member_state_changed` | 成员 session 关联和状态 |
| `task_ready` / `task_dispatched` / `task_state_changed` | 任务进度 |
| `tool_confirmation_required` | 关联 F26a，payload 只含脱敏摘要 |
| `external_result_required` | 关联 F26b |
| `run_paused` / `run_resumed` | 控制结果 |
| `interrupt_requested` / `member_interrupted` / `run_interrupted` | 中断收敛 |
| `task_failed` / `run_failed` / `run_completed` | 失败和完成 |
| `permission_revoked` | 立即清理前端可见数据并停止新的控制请求 |
| `heartbeat` | 保活；可用 SSE comment，不必进入业务事件 |

客户端按 `event_id` 去重，按 `sequence` 检测缺口；缺口、乱序或重连后执行 snapshot 查询。不要把 session 原始事件直接当作 team event，因为一个回复可能包含多个成员和多个 task。

## 10. 空、错、加载与部分成功

### 10.1 空态

- 没有团队：说明“当前 Workspace 还没有团队”，提供“创建团队”；如果无 `team:create`，只显示权限说明。
- 空团队：允许保存草稿，成员区域显示“添加第一个子智能体”，启动按钮 disabled 并解释原因。
- 无任务：可保存配置但不能启动；显示“至少添加一个任务”。
- 无历史 run：显示“启动后这里会出现运行记录”，不要用“暂无数据”掩盖可执行入口。
- 没有可邀请 agent：隐藏邀请入口或显示原因，不把 AgentScope `AgentInvite` 的可邀请池误报为 Workspace 成员列表。

### 10.2 加载态

- 首屏先显示团队/运行骨架和当前 Workspace 名称，避免空白页面。
- 团队详情、任务列表和成员状态可以分块加载，但控制按钮在能力矩阵返回前 disabled。
- SSE 尚未连接时显示“正在连接实时进度”，仍用 snapshot query 显示最后已知状态。
- 控制请求 pending 时锁定同一动作，保留“取消请求”仅在服务端确实支持取消时提供。

### 10.3 错误态

- `401`：登录已失效，跳转登录并保留安全的返回路径。
- `403`：保留页面可读内容，隐藏/禁用控制，说明当前 Workspace 角色不允许操作。
- `404`：统一显示“团队或运行不存在，可能已归档/删除”，避免跨 scope 探测。
- `409 VERSION_CONFLICT`：拉取最新快照，展示“配置已被其他成员更新”，让用户选择查看差异后重试。
- `409 RUN_ALREADY_ACTIVE`：跳转现有 active run，不创建第二个。
- `422`：按字段显示校验错误；任务依赖循环要指出环路中的 task。
- `429`：显示 Workspace 并发/预算限制和预计重试时间（如果服务端提供）。
- `502/503`：说明执行器/Redis/模型服务暂不可用；不要把可重试的基础设施失败标成任务业务失败。

### 10.4 部分成功

成员批量创建、任务批量 dispatch 和团队中断都可能部分成功。响应不能只返回一个 HTTP 200/500：

```json
{
  "status": "partial",
  "succeeded": [{"member_id": "member_01"}],
  "failed": [{
    "member_id": "member_02",
    "code": "MODEL_NOT_CONFIGURED",
    "retryable": false
  }]
}
```

前端显示逐项结果、可重试项和不可重试项；重试只提交失败项。后端必须保存补偿结果和审计记录，避免用户刷新后看不到已成功创建的成员。

## 11. 移动端与可访问性

### 11.1 移动端

- 390px 宽度下不依赖横向表格；成员和任务使用卡片/折叠面板。
- 控制区固定在详情底部，主动作只有一个；中断使用 destructive 样式并需要二次确认。
- 进度摘要固定显示“1/3 已完成 · 33%”，详细事件放入可滚动时间线。
- 长名称、task ID、session ID 使用截断并提供复制按钮；不要让 ID 撑破布局。
- SSE 断开、后台切换和恢复前台后自动 snapshot；不要求用户保持页面常亮。
- 用户输入的任务描述、模型输出和错误堆栈都要换行/折叠，避免横向滚动。

### 11.2 可访问性

- 状态用文字 + 图标/颜色，不只用颜色；进度条提供 `role=progressbar` 和 `aria-valuenow`。
- 团队成员、任务、事件分别使用有意义的 region label；沿用 F27a 已验证的 `团队成员`、`任务进度` 语义。
- 控制按钮名称包含对象和动作，例如“暂停团队运行”“中断全部成员”，不要只写“停止”。
- SSE 事件更新进入 `aria-live="polite"` 的摘要区域；不要把每个 token 或 heartbeat 播报给屏幕阅读器。
- Dialog 打开后焦点进入标题或首个可操作控件，关闭后返回触发按钮；确认 destructive 动作时明确说明影响。
- 所有控件支持键盘操作，loading 时保留可读状态；错误使用 `role=alert`，字段错误关联 `aria-describedby`。
- 动画遵守 `prefers-reduced-motion`；运行中状态不能只靠旋转图标表达。

## 12. 中英文与文案

首期文案必须由同一个 message key 提供中英文，不在 API 返回中文，也不把 AgentScope 英文错误直接作为用户文案。

| 中文 | English |
| --- | --- |
| 子智能体团队 | Sub-agent team |
| 负责人 | Leader |
| 成员 | Member |
| 任务进度 | Task progress |
| 准备中 | Preparing |
| 运行中 | Running |
| 等待确认 | Waiting for confirmation |
| 已暂停 | Paused |
| 中断请求已发送 | Interrupt requested |
| 部分完成 | Completed with failures |
| 重试失败任务 | Retry failed tasks |
| 当前 Workspace 无权控制此运行 | You do not have permission to control this run in the current Workspace |
| 实时进度已断开，正在使用最近快照 | Live progress is disconnected; showing the latest snapshot |

状态名和错误 `code` 保持稳定英文机器值，展示文本可本地化。百分比四舍五入规则固定；分母为可计入任务总数，空任务显示 `0/0 · 0%` 并配合解释，不把空任务伪装成完成。

## 13. 安全限制

- 不接受客户端传入的 `actor_user_id`、`tenant_id` 作为权限依据；只使用 Synapse JWT/cookie 派生的 actor 和 `X-Workspace-ID` 选择器。
- Team、run、task、member、session 每次读取都检查同一 tenant/Workspace 和当前 membership version；ID 不匹配统一为安全的 404 或 403。
- team/run 的所有控制动作写审计：actor、Workspace、action、旧状态、新状态、版本、request/idempotency key、结果和错误 code。
- 不能把 AgentScope 的 `user_id` 当成 Workspace owner。当前适配器对 session/agent 等资源带 tenant/Workspace/actor 前缀；teams 本身尚未有独立的 Synapse 归属映射，F27b 必须补上。
- invited agent 的 `owner_id` 与 team owner 可以不同；只暴露该 team 借用的 session 和被授权结果，不能读原 owner 的其他 session。
- SSE payload 只发送脱敏字段；工具参数、文件路径、凭据、模型请求头和外部结果中的秘密不能进入 team event log。
- 控制动作必须有 CSRF/认证保护（现有 cookie 会话尤其要注意），并设置合理的请求体大小、任务数量、成员数量、描述长度、并发和运行时限。
- 任务描述会进入模型上下文，需做长度限制和不可信内容提示；不要把用户描述当作系统指令或权限策略。
- 不允许前端通过 PATCH `tasks_context`、团队 Redis key 或原始 session state 获得任意执行权限；所有改变由 orchestrator 命令完成。
- 运行中 Workspace 撤权时拒绝新的控制请求并清理页面；是否终止已有 worker 需要明确策略，不能假设 gateway 会自动终止已经建立的 SSE/运行。
- TeamDelete 的当前 AgentScope 语义不可逆且会删除 created 成员及其 session；Synapse 首期建议只提供归档和中断，删除放到后续并要求更强确认。

## 14. 分期实施

### 14.1 首期最小可控范围（F27b-1）

首期只做一个“可安全闭环”的深模块接口：

- 当前 Workspace 内创建/编辑/查看团队草稿。
- 只支持当前 actor 拥有的 agent 作为 leader/member；暂不开放跨 actor `AgentInvite`。
- 成员数量上限由 Workspace policy 固定；成员配置在 run 启动前冻结。
- 用户显式创建任务，支持无环依赖、显式 owner、`pending/running/succeeded/failed/interrupted` 投影。
- 启动一次 `team_run`，保存 team/task/member/session 快照和幂等键。
- 使用已有 session chat/interrupt 能力启动和中断成员；团队级中断由 adapter 级联。
- 团队详情提供 snapshot + team SSE；断线能重连、去重、补偿。
- 支持失败任务单项重试；不承诺强暂停，只提供“停止未派发任务”和“中断运行”。
- 提供最小审计和 Problem JSON；中英文、窄屏、键盘和屏幕阅读器验收。

首期明确不做：

- 任意模型自主创建/删除团队并直接改变用户配置。
- 跨 actor invited agent、跨 Workspace 共享文件/凭据/记忆。
- 用户编辑已运行成员的提示词、权限和模型。
- 强制冻结正在执行的工具/外部副作用。
- 依赖 AgentScope 原生 TeamDelete 的无恢复删除。
- 复杂 DAG 可视化、自动任务拆解、预算计费和多租户全局团队目录。

### 14.2 后续阶段

1. **F27b-2：可恢复执行**
   durable dispatch queue、soft pause/resume、worker 重启恢复、运行锁和超时补偿。
2. **F27b-3：丰富成员来源**
   安全的 AgentInvite、跨 actor resource grant、邀请撤销和结果脱敏。
3. **F27b-4：高级编排**
   模板版本、自动拆解草稿、条件分支、并发策略、预算与审批。
4. **F27b-5：运维与规模化**
   多 worker、跨进程一致性、事件保留策略、审计导出和大团队分页。

每一期都要将 AgentScope 版本/commit、运行器支持情况、Redis key 和后台 worker 拓扑记录在验证材料中；不能只凭页面行为宣布通过。

## 15. 验收条件

### 15.1 API/状态

- 两个 Workspace、两个 actor 的 fixture 下，team/run/task/member/session ID 不能跨范围读取、修改或订阅。
- 创建、编辑、启动、重试、中断带版本和幂等保护；重复请求不重复创建 session、投递任务或发送副作用。
- 成员批量创建和 run dispatch 的部分失败可持久化、可展示、可重试。
- run/task 状态只能通过合法转移推进；并发更新返回 `409 VERSION_CONFLICT`，不会丢失较新状态。
- 中断会级联到 active member session，最终能区分已收敛、未收敛和超时。
- Workspace 撤权后新 API/SSE 请求返回安全错误；前端清理旧团队内容并停止控制。
- 真实 AgentScope Redis storage/message bus、同进程 FastAPI 和至少一个后台执行器环境通过验证；没有真实模型时必须标明模型推理未验。

### 15.2 前端/UX

- 创建团队、配置成员、建立任务、预检、启动、查看进度、失败重试和中断形成完整浏览器流程。
- F27a 的团队/成员/任务只读信息继续可见；控制按钮只在服务端 `capabilities` 允许时出现。
- SSE 首次 snapshot、实时事件、断线重连、事件去重、sequence 缺口补偿和 3 秒/配置化 fallback 均通过。
- 覆盖空团队、空任务、加载、401/403/404/409/422/429/503、部分成功和撤权。
- 390px 窄屏、键盘操作、焦点管理、`aria-live`、进度条、减少动态效果以及中英文均通过。
- 不显示凭据明文、跨 actor 私有 session、内部堆栈或未脱敏工具参数。

### 15.3 证据与未决问题

实施前需要独立回答并记录证据：

1. AgentScope 固定 commit 是否允许通过 adapter 可靠地创建“未立即执行”的 worker session；若不允许，编排器需要怎样隔离配置保存与 `deliver_to_inbox`？
2. 是否存在可跨进程恢复的 team run worker；当前 Synapse 的 AgentScope factory 关闭了 scheduler/channel/index worker，F27b 是否新增唯一 owner worker？
3. `TeamRecord`/team key 是否已被 `WorkspaceSessionStorage` 作用域化；当前源码只明确包装了 session、agent、KB、MCP、Skill、credential 等，teams 不是独立的 Synapse scope。
4. `TaskContext` 写入是否有原子 CAS/版本支持；若没有，task API 必须由 Synapse 保存 canonical task 并把 AgentScope state 当投影。
5. soft pause 是否能阻止已排队 inbox/wakeup 而不丢消息；没有证据前不能在 UI 宣称立即暂停。
6. 已建立 worker SSE 在 Workspace 撤权后是否需要服务端主动终止；当前 gateway 文档明确是建连时检查，需安全策略决策。
7. invited agent 的跨 actor Workspace、工作目录和模型凭据组合是否允许；在 F21b 当前“actor 私有”策略下应默认关闭。
8. 真实模型和工具副作用中断是否可证明最终停止；没有该证据时验收只能覆盖 fixture、状态和控制消息，不能声称端到端停止。

## 16. 参考文件

- `AGENTS.md`
- `docs/integration-plan.md`
- `docs/development-status.md`
- `docs/verification/F27a-team-panel.md`
- `docs/agentscope-runtime.md`
- `docs/agentscope-tenant-context.md`
- `docs/agentscope-session-isolation.md`
- `apps/web/src/features/workspaces/sessions-page.tsx`
- `apps/api/app/integrations/agentscope.py`
- `apps/api/app/integrations/agentscope_gateway.py`
- `apps/api/app/integrations/agentscope_session_scope.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_router/_session.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_router/_chat.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_tool/_team_create.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_tool/_agent_create.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_tool/_agent_invite.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_tool/_team_say.py`
- `apps/api/.venv/Lib/site-packages/agentscope/app/_tool/_team_delete.py`
- `apps/api/.venv/Lib/site-packages/agentscope/state/_state.py`
- `apps/api/.venv/Lib/site-packages/agentscope/state/_task.py`

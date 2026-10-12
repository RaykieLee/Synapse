# F26b 外部结果人工介入前端验收

状态：修复后独立验收通过（2026-10-13）；真实模型/外部执行器仍未覆盖。

本报告由 `apps/api/tests/verification/test_f26b_external_result.py` 和
`apps/api/tests/verification/f26b_external_result.mjs` 生成证据。只使用
F26b 前缀的临时数据，Redis 使用 DB15（AgentScope storage）与 DB16
（session event stream）；清理必须按本报告末尾记录的精确 session/agent/event/lock
key 执行，不得对数据库执行 `FLUSHDB`。

## 验收范围

- `awaiting_external_result` 历史状态恢复和人工结果卡片展示。
- `EXTERNAL_EXECUTION_RESULT` 成功结果，及 `state=interrupted` 的取消结果。
- 空结果阻止提交、重复/过期 `409`、服务端失败反馈和可恢复重试。
- Workspace/会话切换隔离、参数脱敏与成员撤权后的页面清理。
- AgentScope 2.0.10.dev0 `RequireExternalExecutionEvent` /
  `ExternalExecutionResultEvent` 协议字段。

## 初次失败与修复

首次 runner 发现历史 `submitted` 请求的 textarea 值无法保持：输入后受控值立即回到空字符串，导致提交按钮持续禁用。根因是历史请求只存在于派生的 `activeExternalRequests`，而输入处理只更新 live `externalRequests` state。

修复位于 `apps/web/src/features/workspaces/sessions-page.tsx`：历史请求首次输入、空值校验、提交中和失败/过期状态都会按原始 request key 写入 live state，保持多个 pending 请求互相隔离，同时不改变 `EXTERNAL_EXECUTION_RESULT` wire contract。

## 执行记录

| 项目 | 结果 |
| --- | --- |
| 初次命令 | `F26B_REDIS_PORT=16392 F26B_SKIP_BUILD=1 .venv/Scripts/python.exe apps/api/tests/verification/test_f26b_external_result.py` |
| API / Redis / Vite / Chromium | 已实际启动；FastAPI、临时 Redis DB15/DB16、Vite、Chromium 请求均有证据 |
| 前端构建 | 通过；`pnpm build`，`✓ built` |
| 初次浏览器断言 | runner 退出码 `1`；唯一失败为外部结果 textarea 输入值无法保持 |
| 修复后复验 | 使用同一临时 Redis 约定单独运行 `F26B_SKIP_BUILD=1` runner，退出码 `0`，输出 `F26b external result frontend verification passed` |
| Redis 清理 | 通过；F26b 临时 Redis 16392 的 DB15/DB16 已随 `synapse-f26b-redis` 容器删除 |

## 证据与限制

修复后通过项：历史 `submitted` tool call 恢复为 `awaiting_external_result`；历史请求首次输入和
成功结果提交、`409` 过期响应、`503` 失败反馈与可恢复重试、卡片显示、
脱敏参数摘要、空结果提交禁用、取消按钮、取消请求的真实 FastAPI `/ai/chat/`
返回 `200` 且请求体为 `EXTERNAL_EXECUTION_RESULT` / `tool_result.state=interrupted`；
Workspace/会话隔离；撤权后旧 Workspace 请求返回 `403` 且页面不再展示旧卡片。

初次失败项（已修复）：textarea DOM 的 `disabled=false`，但 Playwright `fill`、键盘输入和原生
input/change 事件后 value 都立即恢复为空，提交按钮持续 disabled。修复后已重新覆盖此前被阻断的成功结果、
过期 `409` 和失败 `503` UI 流程。

测试代理对成功/取消请求转发真实 FastAPI；过期和失败分支使用确定的 `409/503`
控制性故障注入，尚未在最终失败前实际执行。控制性故障不等价于真实模型或真实
外部执行器故障。未配置真实模型提供商，因此未验证模型决定触发外部工具、真实
外部执行器回调、后台 worker 恢复后的模型续跑和最终助手文本。

## 后台恢复风险（后续后端任务）

复验期间观察到取消请求后后台日志：

```text
RuntimeError: AgentScope session access requires a verified Workspace context
```

只读诊断已将调用链定位到 AgentScope 的 Redis wakeup resume：HTTP 请求期间的 `WorkspaceContext` 不会自动传递给应用 lifespan 创建的 `WakeupDispatcher` task，而当前 wakeup payload 没有携带可重新验证的 tenant/Workspace/membership scope。因而 HTTP `200` 只能证明 trigger 已入队，不能证明 parked run 已完成恢复或取消清理。当前存储适配器会 fail-closed，暂无证据表明因此发生跨 Workspace 泄露，但等待中的 HITL/外部结果状态可能不推进。

该问题不影响本项已通过的 UI wire-contract 和隔离断言，但 F26b 不能被描述为“真实后台模型/工具 resume 已通过”。后续后端任务必须让 trigger 携带服务端生成的 scope reference，并在 dispatcher 消费时重新验证成员资格、session/agent 归属和 `membership_version`，再在恢复 task 内绑定/重置上下文；同时补充真实后台最终状态和撤权竞态验收。

## Redis 清理

16381 的 Redis 实例报告 `databases=16`，DB16 越界；为满足本项 DB15/DB16，
运行器使用独立临时 Redis 容器 `synapse-f26b-redis`，端口 `16392`，配置
`databases=32`。每轮 runner 的 finally 只删除自己创建的 session/agent 与
对应 event/lock；最终检查时 DB15 的 F26b key 为 `0`、DB16 的 event/lock key
均为 `0`。检查时 DB15 仍有 13 个 AgentScope session-index key、DB16 有
`agentscope:wakeups`，均属于该临时容器的 AgentScope 基础 key；随后删除
整个 F26b 临时容器，故 DB15/DB16 的全部临时数据均已回收。16381 和并行
agent 的 16391 未触碰。

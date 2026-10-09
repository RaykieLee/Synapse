# F25a 聊天 SSE 文本增量前端独立验收

## 结论

**浏览器验收通过，构建门槛未通过，因此整体未通过。** 真实 Synapse API、AgentScope Redis storage/message bus、临时 SQLite、Vite 和 Playwright 路径验证了 SSE 文本增量、重连 replay 与去重、切换上下文后的隔离、临时失败保留历史，以及真实 API 返回 403/404 后清理当前 scope。

真实模型推理未验证；事件来自脚本向真实 AgentScope Redis replay stream 写入的受控 feeder 数据。

## 构建门槛

在 `apps/web` 执行 `pnpm build` 失败：

```text
src/features/workspaces/sessions-page.tsx(1075,11): error TS2304: Cannot find name 'controller'.
```

这是本验收开始时已有的构建缺陷。没有修改产品实现。浏览器链路在记录构建失败后，通过 `F25A_SKIP_BUILD=1` 绕过构建门槛运行；该结果不能视为构建通过。

## 环境与脚本

- 临时 SQLite，Alembic 从空库迁移到 head `0015_tenant_scheduled_task_runs`。
- 真实 FastAPI/AgentScope、Redis 7 storage DB 7 与 bus DB 8、Vite 和无头 Chromium Playwright。
- 一个租户、两个 active Workspace；同一 actor 在两空间均有 active 成员关系。Agent 和 Session 由真实 FastAPI AgentScope 路由创建。
- 历史消息通过真实 `WorkspaceSessionStorage` 写入 Redis。受控 feeder 直接向真实 `agentscope:session:events:{session_id}` Redis stream 写入事件，真实上游 SSE endpoint 执行 replay 与 live subscription。
- Vite 通过本地临时 HTTP 代理连接 API。代理只负责转发，并在第一轮 replay delta 后关闭连接、按测试指令产生一次 503；其余 API/SSE 响应都来自真实 FastAPI。代理还有本机测试控制端点，用于向 Redis 发布晚到事件、撤销 WorkspaceMember。
- 可重复脚本：`apps/api/tests/verification/run_f25a_sse_text_frontend.py` 和 `apps/api/tests/verification/f25a_sse_text_frontend.mjs`。

## 浏览器与 API 证据

- 首次 SSE replay 在显示 `F25a alpha ` 增量后被代理断开。点击“重试消息流”后，真实 API 从同一 Redis replay log 重放事件，页面最终显示 `F25a alpha beta gamma`。
- Feeder 分别重复一个带 `event.id` 的 delta，以及重复一个无 `event.id`、但 sequence 相同的 delta。重连后文本没有重复，Playwright 未发现 `F25a alpha alpha beta beta gamma`。
- 页面显示真实 AgentScope history 中的 `F25a committed history sentinel`。受控 503 retry 后，该已提交历史和已收到的 live text 均仍显示。
- 从主会话切换到第二会话后，主会话实时文本消失。之后向主会话 Redis stream 写入 `F25a late old-session chunk`，第二会话没有显示该内容。
- 切换到第二 Workspace 的会话后，主 Workspace 文本不显示。随后向主 Workspace 原会话的 Redis stream 写入 `F25a late cross-workspace chunk`，新 Workspace 页面没有显示该内容。
- 对第二会话调用真实 `DELETE /api/v1/ai/sessions/{session_id}?agent_id=...` 后，重试其 SSE 连接由真实 AgentScope 路由返回 404。页面显示“当前会话已不可访问，消息内容已清除。”，已提交消息与 live 内容均不再展示。
- 第二 Workspace 会话先收到真实 Redis replay 事件；测试将该用户的 `WorkspaceMember.status` 设为 `removed` 后，重新连接真实 SSE endpoint 返回 403。页面显示同一 scope 清理提示，`F25a forbidden scope secret` 不再展示。

## 可复跑

默认命令先执行构建，目前会在已记录的 TypeScript 错误处停止：

```bash
apps/api/.venv/bin/python apps/api/tests/verification/run_f25a_sse_text_frontend.py
```

构建失败记录后，单独复跑真实 API/Vite/Playwright 流程：

```bash
F25A_SKIP_BUILD=1 apps/api/.venv/bin/python apps/api/tests/verification/run_f25a_sse_text_frontend.py
```

需要 Redis 在 `127.0.0.1:6380` 可用。可用 `F25A_REDIS_HOST` 和 `F25A_REDIS_PORT` 覆盖地址。跳过构建开关只运行浏览器链路，不改变构建失败结论。

## 未验证边界

- 未配置模型提供方凭据；未验证真实推理、模型生成文本或供应商流式响应。增量文本由受控 Redis SSE feeder 提供。
- 首次断线和一次 503 由本地代理受控产生；事件 replay、会话/Workspace context、状态码 403/404、历史数据和成员撤销经真实服务处理。
- 构建因现有 `sessions-page.tsx:1075` TypeScript 错误未通过。此项验收未改产品文件。

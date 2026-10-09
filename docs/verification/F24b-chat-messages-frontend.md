# F24b Workspace 会话消息前端独立验收

## 结论

**未通过。** 消息页面的历史展示、分页、附件引用、发送失败保留草稿、重试成功、切换会话/Workspace 和成员撤权后清除页面内容均在浏览器中得到验证；但当前 `pnpm build` 被 TypeScript 错误阻断，且真实 API 存在跨 Workspace `agent_id` 不匹配仍返回 Alpha 会话消息的越权结果。

真实模型推理未验证：环境没有配置模型凭据。成功发送证据仅表示 `/ai/chat/` 接受了请求，不代表 AgentScope 产生了真实助手回复。

## 构建门槛

在 `apps/web` 执行 `pnpm build` 失败：

```text
src/features/workspaces/sessions-page.tsx(1075,11): error TS2304: Cannot find name 'controller'.
```

报错处位于工具确认提交的 `catch` 分支。该错误与本验收脚本无关；没有修改产品文件。后续浏览器流程通过显式 `F24B_SKIP_BUILD=1` 绕过构建门槛运行，不能视为构建通过。

## 运行环境

- 临时 SQLite 数据库，Alembic 从空库迁移至 head `0015_tenant_scheduled_task_runs`。
- 真实 FastAPI、AgentScope RedisStorage、Redis session/message bus、Vite 和 headless Playwright。
- Alpha/Beta 两租户；Alpha 有两个 Workspace，Beta 有一个 Workspace；Alpha 的两名 Workspace 成员；每个 actor 有各自的 Agent/Session。
- 主会话通过 AgentScope RedisStorage 写入 62 条混合 user/assistant 消息，包含附件 data block。附件通过真实 Workspace 附件 API 上传，文件保存于临时目录。
- 每次运行结束停止服务并清理带 `F24b` 前缀的 AgentScope fixture；SQLite 和附件目录随临时目录删除。

## 浏览器与 API 证据

- 会话主页面显示历史中最新 user 和 assistant 消息；初始 50 条历史没有 oldest sentinel，点击“加载更早消息”后 sentinel 出现，分页确由真实 API 游标返回。
- 页面展示真实附件记录上传后返回的 `f24b-reference.txt`，历史 data block 也显示附件名。
- 测试先在浏览器网络边缘对第一次 `/api/v1/ai/chat/` POST 返回 503。UI 显示服务端错误，文本草稿和附件勾选均保留。
- 第二次点击“发送”放行到真实 API，页面收到成功响应后清空 composer 和附件选择。Playwright 捕获请求体，断言含用户文本及由真实附件下载得到的 base64 data block（附件名、媒体类型和内容均匹配）。模型调用结果未作断言。
- 同 Workspace 切换到第二个会话显示其独立 sentinel；回到主会话恢复主历史。
- 切换到 Alpha 的第二 Workspace 显示 Alpha Two 专属 sentinel，主 Workspace 历史不显示。Beta Session ID 在 Alpha Workspace header 下请求消息 API 返回 404。
- Alpha session ID 搭配 Beta Workspace 的 agent ID，在 Alpha Workspace header 下请求 `GET /api/v1/ai/sessions/{alpha_session_id}/messages?agent_id={beta_agent_id}&limit=50` 返回 **200**，并返回 Alpha 会话消息（包括消息正文）。预期应为 404/拒绝，且不返回正文。这是可重复的跨 Workspace agent selector 边界缺陷。
- Alpha Workspace 的 peer actor 初始可看见自己的 peer session sentinel；owner 通过真实 `DELETE /api/v1/workspaces/{alpha_workspace_id}/members/{peer_id}` 撤销 peer 成员后，peer 重新加载页面不再渲染 sentinel，peer token 的消息 GET 返回 403 或 404。

## 可复跑

正常运行会先执行 build；当前会在已记录的 TypeScript 错误处停止：

```bash
apps/api/.venv/bin/python apps/api/tests/verification/run_f24b_chat_messages_frontend.py
```

在确认并记录 build 失败后，单独运行 Vite/真实 API/Playwright 流程：

```bash
F24B_SKIP_BUILD=1 apps/api/.venv/bin/python apps/api/tests/verification/run_f24b_chat_messages_frontend.py
```

要求 Redis 在 `127.0.0.1:6380` 可用；使用 `F24B_REDIS_HOST`、`F24B_REDIS_PORT` 可更改连接。绕过 build 的命令只收集浏览器证据，不改变 build 的失败结论。

## 未验证边界

- 未配置模型提供方凭据；未验证真实助手推理、回复生成或模型流式内容。
- 本验收的“发送失败”是受控网络 503 fixture；真实服务端成功发送只验证了接受 API 请求。
- 未覆盖工具确认、工具调用、外部任务和 SSE 重连，这些不属于本项基础消息覆盖。

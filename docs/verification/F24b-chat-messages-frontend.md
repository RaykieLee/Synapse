# F24b Workspace 会话消息前端独立验收

## 当前状态

2026-10-12 本机真实 API + Playwright 复验通过；同日由独立子智能体在干净工作树上重新运行真实 API/Redis/Playwright 流程并通过。本项现标记为**独立验收通过**。真实模型推理仍因未配置模型凭据而未验证。

本次页面 `document.lang` 为 `zh-CN`、`localStorage['synapse-locale']` 未设置，但消息输入框实际 accessible name 为 `Type a message`。验收脚本按渲染出的 accessible name 定位输入框；本次没有修改产品 UI。该中英文标签不一致留作 UX/i18n 差距。

## 原验收结论

**未通过。** 消息页面的历史展示、分页、附件引用、发送失败保留草稿、重试成功、切换会话/Workspace 和成员撤权后清除页面内容均在浏览器中得到验证；但当前 `pnpm build` 被 TypeScript 错误阻断，且真实 API 存在跨 Workspace `agent_id` 不匹配仍返回 Alpha 会话消息的越权结果。

真实模型推理未验证：环境没有配置模型凭据。成功发送证据仅表示 `/ai/chat/` 接受了请求，不代表 AgentScope 产生了真实助手回复。

## 原构建门槛（已解除）

原验收时在 `apps/web` 执行 `pnpm build` 失败：

```text
src/features/workspaces/sessions-page.tsx(1075,11): error TS2304: Cannot find name 'controller'.
```

报错处位于工具确认提交的 `catch` 分支。该错误之后已修复；本次完整验收脚本先运行 `pnpm build` 并通过，没有设置 `F24B_SKIP_BUILD`。

## 原验收运行环境

- 临时 SQLite 数据库，Alembic 从空库迁移至 head `0015_tenant_scheduled_task_runs`。
- 真实 FastAPI、AgentScope RedisStorage、Redis session/message bus、Vite 和 headless Playwright。
- Alpha/Beta 两租户；Alpha 有两个 Workspace，Beta 有一个 Workspace；Alpha 的两名 Workspace 成员；每个 actor 有各自的 Agent/Session。
- 主会话通过 AgentScope RedisStorage 写入 62 条混合 user/assistant 消息，包含附件 data block。附件通过真实 Workspace 附件 API 上传，文件保存于临时目录。
- 每次运行结束停止服务并清理带 `F24b` 前缀的 AgentScope fixture；SQLite 和附件目录随临时目录删除。

## 原验收浏览器与 API 证据

- 会话主页面显示历史中最新 user 和 assistant 消息；初始 50 条历史没有 oldest sentinel，点击“加载更早消息”后 sentinel 出现，分页确由真实 API 游标返回。
- 页面展示真实附件记录上传后返回的 `f24b-reference.txt`，历史 data block 也显示附件名。
- 测试先在浏览器网络边缘对第一次 `/api/v1/ai/chat/` POST 返回 503。UI 显示服务端错误，文本草稿和附件勾选均保留。
- 第二次点击“发送”放行到真实 API，页面收到成功响应后清空 composer 和附件选择。Playwright 捕获请求体，断言含用户文本及由真实附件下载得到的 base64 data block（附件名、媒体类型和内容均匹配）。模型调用结果未作断言。
- 同 Workspace 切换到第二个会话显示其独立 sentinel；回到主会话恢复主历史。
- 切换到 Alpha 的第二 Workspace 显示 Alpha Two 专属 sentinel，主 Workspace 历史不显示。Beta Session ID 在 Alpha Workspace header 下请求消息 API 返回 404。
- Alpha session ID 搭配 Beta Workspace 的 agent ID，在 Alpha Workspace header 下请求 `GET /api/v1/ai/sessions/{alpha_session_id}/messages?agent_id={beta_agent_id}&limit=50` 返回 **200**，并返回 Alpha 会话消息（包括消息正文）。预期应为 404/拒绝，且不返回正文。这是可重复的跨 Workspace agent selector 边界缺陷。
- Alpha Workspace 的 peer actor 初始可看见自己的 peer session sentinel；owner 通过真实 `DELETE /api/v1/workspaces/{alpha_workspace_id}/members/{peer_id}` 撤销 peer 成员后，peer 重新加载页面不再渲染 sentinel，peer token 的消息 GET 返回 403 或 404。

## 可复跑

正常运行会先执行 `pnpm build`，再运行真实 API 和 Playwright 流程。Windows 示例：

```powershell
docker run --rm -d --name synapse-f24b-redis-20261012 -p 127.0.0.1:16381:6379 redis:7-alpine
Set-Location apps/api
$env:F24B_REDIS_HOST = '127.0.0.1'
$env:F24B_REDIS_PORT = '16381'
.\.venv\Scripts\python.exe tests\verification\run_f24b_chat_messages_frontend.py
```

Linux/macOS 可使用项目 venv 的 POSIX 路径：

```sh
cd apps/api
F24B_REDIS_HOST=127.0.0.1 F24B_REDIS_PORT=16381 \
  .venv/bin/python tests/verification/run_f24b_chat_messages_frontend.py
```

Redis 默认地址为 `127.0.0.1:6380`；可用 `F24B_REDIS_HOST`、`F24B_REDIS_PORT` 覆盖。`F24B_SKIP_BUILD=1` 只用于单独调试浏览器流程，不能作为 build 通过证据。

## 未验证边界

- 未配置模型提供方凭据；未验证真实助手推理、回复生成或模型流式内容。
- 本验收的“发送失败”是受控网络 503 fixture；真实服务端成功发送只验证了接受 API 请求。
- 未覆盖工具确认、工具调用、外部任务和 SSE 重连，这些不属于本项基础消息覆盖。

## 2026-10-12 本机复验记录

复验代码起点为 `1aa25f7`（产品文件未变），并包含本报告所记的 F24b 验收脚本修复。

### 运行命令与环境

使用一次性 Redis 7 容器（映射到 `127.0.0.1:16381`）、临时 SQLite、真实 FastAPI、AgentScope Redis storage/message bus、Vite 和 Playwright。Windows 命令：

```powershell
docker run --rm -d --name synapse-f24b-redis-20261012 -p 127.0.0.1:16381:6379 redis:7-alpine
Set-Location apps/api
$env:F24B_REDIS_HOST = '127.0.0.1'
$env:F24B_REDIS_PORT = '16381'
.\.venv\Scripts\python.exe tests\verification\run_f24b_chat_messages_frontend.py
```

结果：`pnpm build` 通过，迁移到 `0016_tenant_validity` 完成，脚本输出 `F24b chat messages frontend verification passed`，退出码为 0。

### 绑定修复与浏览器覆盖

- 真实请求以 Alpha session ID 搭配 Beta Workspace 的 `agent_id` 查询消息返回 HTTP 404；响应为 `REQUEST_ERROR` / “Session not found”，不含被测 Alpha 消息正文。验收脚本现明确断言 404，并断言已知消息 sentinel 不出现在响应体中。
- 外来 Beta session、跨 Workspace session 请求均返回 404；成员被移除后，其消息请求返回 403，页面不再显示该成员的历史 sentinel。
- 历史消息分页、附件名称呈现、切换 session/Workspace、受控 503 后保留草稿和附件选择、重试请求携带附件数据均通过。
- 模型调用结果未断言；成功仅代表 API 接受聊天请求，不代表模型生成回复。
- 修正了 Windows 子进程无法找到 `pnpm` 的 runner 问题，并让验收选择当前实际 accessible name、等待可见且启用的 textbox。测试退出时释放 SQLite engine，避免 Windows 删除临时数据库时发生文件占用。

## 2026-10-12 独立子智能体验收记录

独立验收从当前 `HEAD` `addc25e` 的干净工作树开始，未修改产品代码、文档或提交。使用一次性 Redis 7、临时 SQLite、真实 FastAPI、AgentScope Redis storage/message bus、Vite 和 headless Playwright，执行：

```powershell
docker run --rm -d --name synapse-f24b-independent-20261012 `
  -p 127.0.0.1:16381:6379 redis:7-alpine
Set-Location apps/api
$env:F24B_REDIS_HOST = '127.0.0.1'
$env:F24B_REDIS_PORT = '16381'
.\.venv\Scripts\python.exe tests\verification\run_f24b_chat_messages_frontend.py
```

结果：`pnpm build` 通过，迁移到 `0016_tenant_validity` 完成，输出 `F24b chat messages frontend verification passed`，退出码为 `0`。独立验收确认：

- 错配 `agent_id` 返回 `404`，响应不含 Alpha 消息正文；
- 正常历史、游标分页、附件显示和发送请求附件 data block 通过；
- 受控 `503` 后文本草稿与附件选择保留，重试成功后清空；
- Workspace/会话切换保持隔离；
- 成员撤权后消息请求返回 `403`，页面不再显示撤权前内容。

验收结束后已停止 Redis，清理临时 SQLite、附件目录和服务进程。未验证真实模型推理、工具确认、工具调用、外部任务和 SSE 重连。

## 2026-10-12 当前主干工作树复跑

在本地 `main` / `origin/main` 同步的 `704a477f9dfe0199f236b0b09d4e37a9a07a8e23` 上复跑；验证开始时工作区已有租户列表相关未提交改动，F24b 代码与验收脚本本身未改动。

- 使用临时 `redis:7-alpine` 容器，绑定 `127.0.0.1:16391`；API 使用临时 SQLite，迁移到 `0016_tenant_validity`。
- 命令：在 `apps/api` 执行 `.\.venv\Scripts\python.exe tests\verification\run_f24b_chat_messages_frontend.py`，并设置 `F24B_REDIS_HOST=127.0.0.1`、`F24B_REDIS_PORT=16391`。
- `pnpm build` 通过；真实 FastAPI、Vite 和 Playwright 流程输出 `F24b chat messages frontend verification passed`，退出码为 `0`。
- 错配 Workspace 的 `agent_id` 请求返回 `404`，消息正文未泄露；历史分页、附件、受控失败后的草稿保留与重试、Workspace/会话切换、撤权后拒绝访问等脚本断言通过。
- 验收完成后临时 Redis 容器已停止并移除；未触碰既有 `8010` 服务。真实模型推理及前述未覆盖项仍未验证。

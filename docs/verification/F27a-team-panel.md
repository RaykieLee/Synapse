# F27a 子智能体团队与任务只读面板独立验收

## 范围与方法

本验收只新增本报告和 `apps/api/tests/verification/test_f27a_team_panel.py`、`apps/api/tests/verification/f27a_team_panel.mjs`。未修改产品源码、共享台账或其他 agent 文件。

测试运行器使用真实 FastAPI/AgentScope 同进程服务、AgentScope Redis storage DB17、Redis message bus DB18、临时 SQLite、Vite 和无头 Chromium。团队、成员会话和 leader `tasks_context` 通过真实 AgentScope storage 写入；会话列表由真实 `GET /api/v1/ai/sessions/?agent_id=...` 返回 `session.team` 和保留的 `state.tasks_context`。

## 验收断言

- 负责人会话显示真实团队名称、描述、负责人和两个子智能体的关联会话。
- 真实 leader `tasks_context` 的 `1/3`、状态和 `33%` 进度可见；随后更新到 `2/3` 并发布真实 AgentScope session event，页面应刷新为 `67%`。
- 子智能体关联会话只读，并明确提示打开负责人会话查看团队任务进度。
- 空团队显示无成员、无任务和 `0/0 · 0%` 空态。
- 另一 Workspace 的普通会话不显示团队数据；第二 actor 看不到 actor-private agent/session。
- Workspace 成员撤权后，当前页面不再显示原团队内容；API/页面权限反馈由真实 gateway 返回。

## 运行命令

Windows:

```powershell
cd apps\api
.\.venv\Scripts\python.exe tests\verification\test_f27a_team_panel.py
```

可用 `F27A_REDIS_HOST`、`F27A_REDIS_PORT` 覆盖 Redis 地址；默认使用 `127.0.0.1:16381`。脚本会先构建 `apps/web`，再启动临时 API/Vite/控制端口。

## 结果（2026-10-13）

结论：**修复后独立验收通过（真实模型/子智能体编排执行除外）。**

- `pnpm build`：通过，`tsc -b && vite build` 完成。
- 完整首次 runner：因现有 `127.0.0.1:16381` Redis 的 `databases=16` 不支持 DB17/DB18，前置检查返回 `DB index is out of range`，未继续使用该实例。
- 使用临时 Redis 7 容器（端口 `16391`，`databases=32`）运行真实 API/Vite/Chromium；runner 使用 DB17/18。首次修复前命令使用 `F27A_SKIP_BUILD=1` 复用已通过的 build，Playwright runner 退出码 `1`，仅因下述事件刷新断言失败。
- API 证据：负责人 session 返回 `team_id=f27a-team-full`、`team_name=F27a Research Team`、`member_count=2`，初始 task states 为 `completed/in_progress/pending`；更新控制后真实 session API 返回 `completed/completed/pending`。
- 浏览器通过：真实团队概览、负责人/成员与关联会话、`1/3 · 33%` 初始任务进度、子智能体会话只读提示、空团队/空任务 `0/0 · 0%`、跨 Workspace 不泄露、第二 actor 不可见、撤权后的真实 gateway `HTTP 403`。
- 初次浏览器失败（已修复）：发布真实 AgentScope session event 后，页面任务进度仍停留在 `1/3 · 33%`，没有刷新到 API 已返回的 `2/3 · 67%`。
- 修复内容：`sessions-page.tsx` 支持 Redis `payload` envelope 解包，`REPLY_START` 主动刷新当前 scope 的 session list，并在选中会话期间保留 3 秒 refetch fallback。
- 修复后复验：真实 runner 退出码 `0`，页面已从 `1/3 · 33%` 刷新到 `2/3 · 67%`，并通过跨 Workspace、第二 actor、空态和撤权断言。
- 清理后临时 Redis DB17/DB18 均为 `0` keys，临时容器 `synapse-f27a-redis` 已删除。
- `git diff --check`：通过。

## 清理与限制

- 只按 `F27a` 名称前缀和本轮创建的 session event/lock key 清理 DB17/DB18；不执行 `FLUSHDB`，不触碰其他 Redis 数据。
- 真实模型推理、真实子智能体编排工具执行和生产部署未覆盖；本验收只验证已经持久化到真实 session/team/task 状态的只读展示与事件刷新。
- 当前 `127.0.0.1:16381` 共享 Redis 实例最多 16 个逻辑 DB，不能直接提供用户指定的 DB17/18；本次使用独立临时 Redis 并显式配置 32 个 DB，未触碰共享实例数据。
- 修复后的 runner 能证明最终 UI 收敛到 `2/3 · 67%`，但没有把浏览器端事件接收时间线作为独立可观测证据；当前保留 3 秒 fallback，避免事件到达竞态导致旧列表长期停留。

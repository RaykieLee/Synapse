# F26a 工具权限确认前端独立验收

状态：已完成独立验收（2026-10-13）。

## 范围

验收 `apps/web/src/features/workspaces/sessions-page.tsx` 中的工具权限确认流程：

- 会话状态为 `awaiting_permission` 时，从真实历史 `tool_call.state=asking` 恢复确认卡片。
- SSE `REQUIRE_USER_CONFIRM` 事件展示工具名和脱敏参数摘要。
- 允许与拒绝提交 `POST /api/v1/ai/chat/` 的 `USER_CONFIRM_RESULT`。
- 重复事件去重、重复响应、非法 scope/agent 响应。
- `404/409` 过期/重复响应提示，以及状态刷新后的行为。
- 确认结果后状态恢复、工具时间线更新。
- 整页刷新后从持久化会话状态恢复等待确认。

## 产物

- `apps/api/tests/verification/run_f26a_tool_permission.py`
- `apps/web/tests/verification/f26a_tool_permission.spec.ts`
- `docs/verification/f26a-tool-permission.md`

runner 使用临时 SQLite、真实 FastAPI、真实 AgentScope Redis storage/message bus、Vite 和 Chromium。Redis 使用 DB13（storage）与 DB14（bus），fixture 名称和 Redis key 均使用 `F26a` 前缀。

## 执行

```powershell
$env:F26A_CHROMIUM_PATH='C:\Users\Lenovo\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe'
.\apps\api\.venv\Scripts\python.exe apps/api/tests/verification/run_f26a_tool_permission.py
```

结果：

- 通过：真实历史 asking 状态展示等待授权与确认卡片；工具名和参数摘要可展开；敏感 token 以 [已隐藏] 展示且不泄漏明文。
- 通过：重复 REQUIRE_USER_CONFIRM SSE 不生成第二张确认卡。
- 通过：允许按钮捕获并核对 USER_CONFIRM_RESULT 请求结构；真实 fixture resolve 后刷新可恢复成功状态和工具结果。
- 通过：非法 agent/scope status API 返回 404；整页重新打开后 asking 状态恢复确认卡片。
- 通过：拒绝按钮在受控 409 响应下触发前端失效提示；由于 fixture 的持久化状态仍为 asking，查询刷新后卡片按历史状态重建为等待决定。

## Redis 清理

runner 启动前清理自己命名的 `F26a` agent/session；结束时精确删除本轮 session 的：

- `agentscope:session:lock:{session_id}`
- `agentscope:session:events:{session_id}`
- AgentScope storage 中对应的 F26a agent/session/message 记录

不会执行 `FLUSHDB`，不会清理 DB13/DB14 中其他 agent 或 session。

## 限制

- 若本机没有可用 Redis，真实验收不能宣告通过。
- 允许确认后的实际工具执行和真实模型推理不在本验收中；工具状态转换由已持久化的 AgentScope session fixture 与真实 SSE 结果事件驱动。
- `409` 过期响应路径使用 Playwright 单次受控网络响应；本次实测显示顶部提示为“确认请求已失效，消息与运行状态已刷新”，随后 asking 历史会把卡片重建为等待决定，因此未宣称“失效卡片保持并可关闭”。其余 API、session、history、SSE 和刷新路径使用真实服务。
- 真实 `/api/v1/ai/chat/` HITL resume 在无 worker/model fixture 时不作为通过条件；本验收用受控 200 捕获请求，并由 runner 的真实 AgentScope Redis fixture/SSE 结果事件验证恢复展示。

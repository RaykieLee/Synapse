# F25b1 聊天生成中断验收

日期：2026-10-13

## 范围与真实契约

本验收针对当前主线实现的聊天生成中断，不修改产品源码或共享台账。真实接口为：

- `POST /api/v1/ai/sessions/{session_id}/interrupt?agent_id={agent_id}`：已有 session 返回 `202`，响应体为 `{ "session_id": "..." }`。接口对 running、停驻等待人工确认/外部结果和 idle 都是幂等入口；不存在或 agent/session 不匹配返回 `404`。
- `GET /api/v1/ai/sessions/{session_id}/status?agent_id={agent_id}`：返回 `{ "session_id": "...", "status": "running|idle|awaiting_permission|awaiting_external_result" }`。
- 前端仅在 `running`、`awaiting_permission`、`awaiting_external_result` 时显示“中断生成”；请求期间显示“正在请求中断…”并禁用重复点击，`202` 后显示“等待停止…”，随后刷新到 idle。

状态机语义来自内嵌 AgentScope：running 通过 Redis session lock 判断；停驻状态来自持久化 session context；interrupt 对 running 发布 `agentscope:session:interrupt`，对停驻状态排入 resume trigger，idle 为 no-op。

## 运行命令与结果

运行前确认 Docker Redis `127.0.0.1:16381` 可用，验收 runner 使用 DB9（storage）和 DB10（bus）：

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo
.\apps\api\.venv\Scripts\python.exe apps\api\tests\verification\test_f25b1_interrupt.py
git diff --check
```

结果：

- `F25b1 interrupt API/browser verification passed`
- API：idle 状态、idle 重复中断、running 状态、202 响应、Redis interrupt publish、错误 agent/session 均通过。
- 浏览器：真实 Vite/Chromium 覆盖 running 页面、中断 pending、重复点击锁定、等待停止、回到 idle，以及 idle 不显示中断按钮。
- `git diff --check`：通过。
- `pnpm build`：runner 启动前执行，已通过。

## Redis 清理

仅使用 DB9/DB10。结束时精确删除本轮生成的：

- `agentscope:session:lock:{本轮 session_id}`
- `agentscope:session:events:{本轮 session_id}`
- 本轮 session/agent storage records

不会执行 `FLUSHDB`，不会删除其他 agent 的 F25b2 数据。清理逻辑位于 `apps/api/tests/verification/test_f25b1_interrupt.py` 的 `finally`。

## 限制与未覆盖项

- 当前环境没有可用真实模型凭据，因此未验证真实模型生成、真实 SSE 文本增量与模型/工具驱动的 interrupt cleanup。
- 没有真实 `awaiting_permission` 或 `awaiting_external_result` 的 AgentScope parked run；浏览器脚本对 session list 的状态响应做了明确的前端状态投影，仅验证 UI 分支和真实 interrupt endpoint 调用，不能替代真实工具停驻验收。
- 由于没有实际运行中的模型 worker，running 状态下 Redis lock 的最终释放由测试代理控制，未声称验证 CancelDispatcher 结束模型任务后的自然收敛。
- 未修改 `docs/development-status.md`；F25b1 是否转为通过需由主代理依据本报告和上述限制决定。

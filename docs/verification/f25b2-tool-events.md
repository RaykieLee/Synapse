# F25b2 工具执行事件展示验收

日期：2026-10-13

结论：独立验收通过（真实工具/模型执行除外）。

## Wire contract

本验收按现有 `apps/web/src/features/workspaces/sessions-page.tsx` 与真实 SSE/历史接口实现确认契约：

- 实时 SSE 事件使用 `type`：
  - `TOOL_CALL_START`：`reply_id`、`tool_call_id`、`tool_call_name`、可选 `created_at`
  - `TOOL_CALL_DELTA`：`reply_id`、`tool_call_id`、`delta`
  - `TOOL_CALL_END`：`reply_id`、`tool_call_id`、可选 `tool_call_name`
  - `TOOL_RESULT_START`：`reply_id`、`tool_call_id`、`tool_call_name`、可选 `created_at`
  - `TOOL_RESULT_TEXT_DELTA`：`reply_id`、`tool_call_id`、`delta`
  - `TOOL_RESULT_DATA_DELTA`：`reply_id`、`tool_call_id`
  - `TOOL_RESULT_END`：`reply_id`、`tool_call_id`、可选 `tool_call_name`、`state`、`created_at`
- 历史消息在 `content` 中使用 `type: tool_call` / `type: tool_result` block，以同一个 `id` 合并：
  - 调用：`id`、`name`、`input`、`state`、`created_at`
  - 结果：`id`、`name`、`output`、`state`、`finished_at`
- 前端按 `tool_call_id`/历史 `id` 组装工具时间线；参数和结果摘要分别限制长度并脱敏，二进制/附件结果降级为 `[已隐藏附件或二进制结果]`。

## 已验证

运行 `apps/api/tests/verification/test_f25b2_tool_events.py`，脚本启动临时 SQLite、真实 FastAPI、Redis-backed AgentScope SSE、Vite 和 Chromium，浏览器断言位于 `apps/api/tests/verification/f25b2_tool_events.mjs`。

- 前端 `pnpm build`：通过。该 build 在完整 runner 运行中通过；后续复跑用 `F25B2_SKIP_BUILD=1` 复用已验证构建。
- 历史工具时间线：通过。真实消息历史中的 `tool_call/tool_result` 被合并为一张 `history_lookup` 卡片。
- 工具开始、参数增量、参数结束：通过。实时 `TOOL_CALL_START/DELTA/END` 生成 `live_lookup` 卡片和参数摘要。
- 工具结果开始、文本流式刷新、结果结束：通过。`TOOL_RESULT_START/TEXT_DELTA/END` 显示成功状态和合并后的文本。
- 工具错误：通过。`state: error` 显示失败状态、错误摘要和可展开的脱敏结果。
- 顺序和同一工具关联：通过。两个不同 `tool_call_id` 分别保持成功/失败状态，没有串卡。
- 参数脱敏：通过。`token` 字段显示 `[已隐藏]`，原始 `history-token` 不出现在页面。
- 结果脱敏：通过。Bearer token 显示为 `Bearer [已隐藏]`，原始 token 不出现在页面。
- 二进制/附件结果降级：通过。浏览器展开成功工具结果后观察到 `[已隐藏附件或二进制结果]`。
- SSE 连接结束后的展示保留：通过。真实 Redis stream 被代理在 replay 后关闭，工具时间线仍保留在页面。
- `python -m py_compile`、`node --check`、`git diff --check`：通过。

## 未验证与限制

- 未真实调用模型 provider 或真实外部工具；实时事件由验收 runner 写入真实 Redis stream，属于受控事件 fixture。
- 未覆盖真实 AgentScope/provider 产生工具事件的上游适配，只验证当前 API/SSE wire contract 到页面的链路。
- 未覆盖人工确认、外部任务提交/取消；这些属于 F26a/F26b 范围。
- 未覆盖 SSE 重连后的工具事件 replay 去重；F25a 已覆盖文本 replay，本项仅验证 stream 关闭后工具 UI 保留。
- DB11 在验收前已有其他 agent 的 AgentScope fixture key，未触碰或清理；本轮自己的 F25b2 event key 和带 `f25b2` 名称的 agent/session fixture 已由 runner 清理。DB12 验收后为 `0` keys。DB11 现存 11 个非本轮 key，未删除以遵守并行工作区约束。

## 命令与结果

```text
$ apps/api/.venv/Scripts/python.exe apps/api/tests/verification/test_f25b2_tool_events.py
F25b2 tool event frontend verification passed

$env:F25B2_REDIS_HOST=127.0.0.1
$env:F25B2_REDIS_PORT=16381
$env:F25B2_SKIP_BUILD=1
```

最终 runner 使用 Docker Redis `127.0.0.1:16381` 的 DB11/DB12；API/页面流程退出码为 `0`。前置完整 runner 运行同时确认 `pnpm build` 通过。

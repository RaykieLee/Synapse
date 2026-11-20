# AgentScope Chat / Workspace Sessions 共享会话状态机

- 日期：2026-11-19
- 实现基线：`origin/main@5fe7dc7`
- 状态：实现完成；待独立 UX 审阅与功能验收

## 设计与契约

- 新增纯 TypeScript 状态机 `apps/web/src/features/agentscope-chat/session-state.ts`。状态携带 `actorId`、`tenantId`、`workspaceId`、`membershipVersion`、`agentId` 和 `sessionId`；两个页面都以完整作用域初始化状态。Actor、租户、Workspace、成员版本、智能体或会话变化时，面板从新作用域重新初始化，旧作用域发出的 reducer action 会被拒绝。
- TanStack Query 的既有消息与附件 key 仍包含 actor、tenant、workspace 和 membership version；会话面板 key 也加入 membership version。缓存不在 Workspace 间复用。服务端成员与资源授权保持原样，客户端状态不会授予权限。
- 统一转移覆盖草稿文本、附件选择、发送与服务端接受、SSE 消息追加/增量/结束、事件去重、断线保留部分文本与重试、中断与状态轮询收敛、工具确认、外部结果提交、失败/过期/撤权清理及会话作用域切换。UI 结构、路由和交互文案未迁移。
- SSE 幂等键保持既有协议：优先 `event.id`，否则用 `reply_id` 与 `sequence`/`seq`；状态最多记住最近 5000 个事件。确认和外部执行沿用 `${replyId}:${toolCallId}` 作为本地请求键，并保留各自的 in-flight 防重复集合。没有新增 HTTP 幂等字段或改变请求/响应 wire contract。
- 普通发送的临时失败保留草稿与已选附件以便重试；服务端接受后才清空。SSE 断线保留已收文本。确认/外部结果的普通失败可重试，404/409 标记为过期；401/403/404 等既有拒权/资源错误清理当前会话的临时内容与对应缓存。

## 改动位置

- `apps/web/src/features/agentscope-chat/session-state.ts`：共享类型、作用域 key、脱敏摘要工具、纯 reducer 与事件转移。
- `apps/web/src/features/agentscope-chat/page.tsx`：AgentScope Chat 接入 reducer；移除页面内重复的 SSE/live reply/工具/确认状态转移。
- `apps/web/src/features/workspaces/sessions-page.tsx`：Workspace Sessions 接入同一 reducer；移除重复状态转移。
- `apps/web/src/features/agentscope-chat/session-state.test.ts`：Chromium headless 可运行的纯 reducer 测试。
- `docs/development-status.md`：记录实现、静态证据与待独立验收状态。

## 验证证据

| 检查 | 结果 | 覆盖与局限 |
| --- | --- | --- |
| `pnpm exec vitest run --browser.headless src/features/agentscope-chat/session-state.test.ts` | 通过；7 tests | 覆盖合法/非法发送与重试、附件保留、SSE 增量/重放去重/断线恢复、中断错误恢复、确认和外部结果重试/过期、拒权清理与跨 Workspace/成员版本隔离；这是纯 reducer 测试，不是完整页面浏览器流程。 |
| `pnpm exec tsc -b`（`apps/web`） | 通过，退出码 0 | 覆盖 TypeScript 项目引用编译；未执行生产构建。 |
| `git diff --check` | 通过，无空白错误 | 仅检查工作树 diff 格式。 |
| 相关既有 chat/sessions focused tests | 未发现 | `apps/web/src/features/agentscope-chat` 与 `apps/web/src/features/workspaces` 中没有对应 chat/session 专项测试；其他 Workspace 功能测试不代表本功能验收。 |

## 已知限制与待验收

- 本报告没有运行登录态页面的真实 API/SSE/Playwright 流程，也没有模型 provider 或真实工具调用；不替代 F24b/F25/F26 的既有或后续端到端验收。
- HTTP 发送接口未提供新的幂等键；本次仅保留客户端 in-flight guard 与现有 SSE 事件去重，不宣称解决服务端重复提交。
- 该 worker 的任务禁止使用子智能体，因此本轮没有独立 UX 子审阅。界面布局、焦点、键盘、移动端和文案未改；独立 UX 审阅、独立实现验收后的复验仍需协调安排。
- 服务端授权边界没有变化；撤权、跨 Workspace 资源访问和缓存撤销仍须按租户契约通过独立服务端/浏览器验收确认。

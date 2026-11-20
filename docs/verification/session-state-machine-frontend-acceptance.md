# 共享会话状态机前端独立验收

**结论：PARTIAL（部分通过）**。共享 reducer 的定向测试与 AgentScope 页面测试通过；Workspace Sessions 接入经代码检查符合共享状态机、作用域 QueryKey 和 active Workspace 门控，但没有对应的页面测试。Reducer 的 stale 防护不是 fail-closed，且本轮未验证后端权限、真实 API/SSE、完整浏览器交互或独立 UX 审阅。

## 核查结果

| 检查点 | 判定 | 证据与判断 |
| --- | --- | --- |
| 作用域 key 与 stale 隔离 | PARTIAL | `sessionMachineScopeKey` 包含 actor、tenant、workspace、membership version、agent、session 和 workspace 状态；两个页面也以 actor/tenant/workspace/membership version/agent/session 作为面板 React key，常规 dispatch 经 `scopeSessionMachineAction` 附加作用域（`session-state.ts:7-15,239-256`；`page.tsx:737-742,1240-1260`；`sessions-page.tsx:282-288,466-485`）。但 `SessionMachineAction.scopeKey` 可选，reducer 仅在 key 存在时比对；`session/switch` 又先于 stale 检查直接重建 state（`session-state.ts:223-229,936-942`）。当前两个页面的常规派发路径有加 key，且不派发 `session/switch`，故未见当前接入绕过；裸 reducer 调用仍可接受无 key 或 stale switch action。 |
| reducer 状态迁移、去重与错误恢复 | PASS | 定向测试覆盖非法/重复发送与临时失败重试、断流保留部分文本和 SSE 重放去重、中断失败恢复、确认重复提交及可重试/过期区分、外部结果编辑/重试与拒权后阻断迟到完成（`session-state.test.ts:39-288`）。对应迁移集中在 `session-state.ts:969-1010,1111-1285`。 |
| AgentScope 接入 | PASS | Agent、会话、消息与附件 QueryKey 使用 `workspaceQueryScope`；面板仅在 active Workspace 渲染；集成测试覆盖归档只读、草稿失败后重试/重复中断保护，以及切换租户/Workspace 后会话和缓存隔离（`page.tsx:187-192,737-742,1293-1336,1452-1453`；`page.test.tsx:416-438,441-516,518-600`）。 |
| Workspace Sessions 接入 | PARTIAL | 页面使用同一 reducer、相同 scope 字段及 scoped dispatch；消息和附件 key 带 workspace query scope、agent/session 参数，并仅在 active Workspace 加载；拒权路径清理消息和附件缓存（`sessions-page.tsx:106-113,282-295,462-525,544-556,796-808`）。`apps/web/src/features/workspaces` 下未找到 Sessions 页面专项测试，因此这些行为只有代码审查证据，没有页面级行为证据。 |
| 既有权限门控与 QueryKeys | PASS（前端） | `workspaceQueryScope` 明确纳入 actor、tenant、workspace、membership version（`apps/web/src/lib/query-keys.ts:105-113`）；两页面继续使用各自 `agentscope` / `workspace` QueryKey 工厂，并保留 active Workspace 门控和拒权时清理私有消息/附件缓存（`page.tsx:1293-1336,2024-2028`；`sessions-page.tsx:516-556,621-622,796-808`）。这只能证明前端作用域和门控保留，不证明服务端授权实现。 |

## 验证证据

| 工作目录 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `pnpm exec vitest run src/features/agentscope-chat/session-state.test.ts src/features/agentscope-chat/page.test.tsx --browser.headless` | PASS：2 个测试文件、11 项测试通过。 |
| `apps/web` | `pnpm exec tsc -b --pretty false` | PASS：退出码 0。 |
| 仓库根目录 | `git diff --check` | PASS：退出码 0。 |
| 仓库根目录 | `git diff --cached --check` | PASS：退出码 0。 |

注：本轮 `git diff --check` 退出码为 0；Git 另提示当前工作树中多份前端文件下次触及时将 CRLF 规范化为 LF，该提示不是 whitespace error。`git diff --cached --check` 无提示。

## 局限与后续

- 建议将 reducer 的 stale 校验改为默认拒绝缺失 `scopeKey` 的常规 action，并明确保护 `session/switch`；当前页面封装减轻了现有风险，但 reducer 本身未强制所有调用方遵守。
- 为 Workspace Sessions 增加专项页面测试，覆盖归档/切换作用域、权限拒绝后的缓存清理，以及发送、stream、确认和外部结果的错误状态；本轮未以其他 Workspace 测试替代该证据。
- 未运行后端集成、真实服务/API/SSE、模型/provider 或工具调用；服务端租户/成员授权仍待独立验收。按本任务只读验收约束未修改实现或测试，也未启动子智能体；因此没有独立 UX 审阅，移动端、键盘/屏幕阅读器可访问性及错误/部分成功文案的 UX 证据仍缺。

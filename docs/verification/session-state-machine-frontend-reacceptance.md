# 共享会话状态机前端独立复验

**结论：PARTIAL（部分通过）**。Reducer 对缺失和陈旧 `scopeKey` 的 fail-closed 校验，以及 `session/switch` 的源作用域保护，均有实现与定向测试证据；AgentScope 页面测试继续通过。整体仍不判 PASS：Workspace Sessions 缺少专项页面测试，真实 API/SSE 与服务端权限未验证；覆盖两处页面的 scoped ESLint 也未通过。

## 核查结果

| 检查点 | 判定 | 证据与判断 |
| --- | --- | --- |
| 必需作用域 key 与 fail-closed | PASS | `SessionMachineAction.scopeKey` 是必需字符串；scope key 包含 actor、tenant、workspace、membership version、agent、session 和 workspace 状态。Reducer 在所有 action 分支（包括 `session/switch`）前比较 key，不匹配即返回原 state，运行时缺 key 也会被拒绝。测试验证普通 action 和缺 key 的 switch 均返回同一 state（`apps/web/src/features/agentscope-chat/session-state.ts:223-255,936-944`；`session-state.test.ts:324-342`）。 |
| `session/switch` 与 stale 隔离 | PASS | 常规 scoped action 类型排除 `session/switch`；Reducer 仅在 key 匹配当前 state 的源作用域后切换。测试覆盖有效切换、旧作用域 action，以及 actor、tenant、workspace、membership version、agent、session、workspace 状态的变化；陈旧 switch 不改 state、草稿或原作用域（`apps/web/src/features/agentscope-chat/session-state.ts:227-230,940-942`；`session-state.test.ts:287-322,344-372`）。 |
| AgentScope 既有行为 | PASS | 页面 scope 包含 actor/tenant/workspace/membership version/agent/session/workspace 状态，dispatch 会附加作用域 key（`apps/web/src/features/agentscope-chat/page.tsx:1239-1267`）。页面测试覆盖归档 Workspace 只读、临时失败后保留并重试草稿、重复中断保护，以及切换 tenant/Workspace 后会话与 Query 缓存隔离（`apps/web/src/features/agentscope-chat/page.test.tsx:416-600`）。 |
| Workspace Sessions 既有接入 | PARTIAL | 页面使用相同 reducer、scope 字段及 scoped dispatch；消息/附件 QueryKey 含 workspace scope 和会话参数，并仅在 active Workspace 查询；拒权时清理对应消息/附件缓存（`apps/web/src/features/workspaces/sessions-page.tsx:467-492,522-564,807-820`）。未找到 Sessions 页面专项测试文件，因此行为只有代码审阅证据。 |
| Workspace QueryKey | PASS（前端） | `workspaceQueryScope` 包含 actor、tenant、workspace、membership version（`apps/web/src/lib/query-keys.ts:105-114`）；这不证明服务端授权。 |

## 验证证据

| 工作目录 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `pnpm exec vitest run src/features/agentscope-chat/session-state.test.ts src/features/agentscope-chat/page.test.tsx --browser.headless` | PASS：2 个测试文件、19 项测试通过。 |
| `apps/web` | `pnpm exec tsc -b --pretty false` | PASS：退出码 0。 |
| `apps/web` | `pnpm exec eslint src/features/agentscope-chat/session-state.ts src/features/agentscope-chat/session-state.test.ts` | PASS：reducer 与其测试无 lint 诊断。 |
| `apps/web` | scoped ESLint：reducer、AgentScope 页面/测试、Workspace Sessions 页面和 query-keys 文件 | PARTIAL：退出码 1；诊断在 `page.tsx`（8 errors、3 warnings）与 `sessions-page.tsx`（14 errors、6 warnings），含 hooks/query 依赖及 render 阶段 ref 使用。Reducer、reducer 测试及 query-keys 文件无诊断；本只读复验未修改产品实现。 |
| 仓库根目录 | `git diff --check` | PASS：退出码 0；Git 提示多份工作树文件未来会将 CRLF 规范化为 LF，这不是 whitespace error；新增报告另检无行尾空白。 |

## 限制

- Workspace Sessions 页面专项行为仍待测试，不以 AgentScope 页面测试替代。
- 未验证真实服务 API/SSE、后端租户/成员授权或模型/provider；本轮没有真实服务端证据。
- 未做独立 UX 审阅；移动端、键盘/屏幕阅读器可访问性及错误/部分成功文案不作为已验收项。

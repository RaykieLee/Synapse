# Workspace 不可访问恢复缓存隔离复验

日期：2026-11-10  
复验范围：仅独立复验 unresolved-descriptor 分支的前端缓存清理隔离，不修改产品代码。

## 复验依据

- 已阅读 `AGENTS.md`、`docs/ux/inaccessible-workspace-recovery.md`、`docs/verification/workspace-inaccessible-recovery-acceptance.md`，以及 `docs/development-status.md` 中 `FIX-WORKSPACE-RECOVERY-001` 实施记录。UX 契约规定拒绝后保留原 Workspace 路径、仅清理本次拒绝目标的缓存与匹配最近项；客户端缓存和最近项不构成授权。
- 前轮验收记录了具体缺口：目录与最近项均不能解析目标 Workspace 时，仍须清理当前 actor/tenant/Workspace 的敏感缓存，并保留其他作用域缓存与不匹配的最近项。
- 实施记录称修复增加了基于缓存 Workspace detail 的 tenant-scoped fallback；本次重新执行下面的独立回归与两文件聚焦套件，不把实施记录里的既有结果替代为本次证据。

## 检查结果

| 检查 | 判定 | 命令与结果 / 证据 |
| --- | --- | --- |
| unresolved-descriptor 回归 | **通过（模拟）** | `pnpm.cmd exec vitest run --browser.headless src/features/workspaces/context.test.tsx -t "removes the current Workspace cache when neither directory nor recent metadata resolves it"`：`1 passed, 18 skipped`，Vitest 用时 `14.75s`（15:24:44）。`context.test.tsx:318-365` 注入模拟 `403 WORKSPACE_MEMBERSHIP_REQUIRED`，访问 `/w/11/private`，最近项只指向 Workspace `12`；测试种入 Workspace `11` 目标缓存及不同 tenant、actor、Workspace 的缓存。结果断言目标 cache 被移除，另外三个缓存值不变，最近项 `12` 仍在，且路由仍为 `/w/11/private`。目标 tenant 从当前 actor/目标 Workspace 的缓存 detail 补足，清理通过 `isWorkspaceScopedQuery` 限定作用域（`context.tsx:197-212`）。 |
| 两文件聚焦恢复套件 | **通过（模拟）** | `pnpm.cmd exec vitest run --browser.headless src/features/workspaces/context.test.tsx src/features/workspaces/problem-state.test.ts`：`2 passed (2)`，`32 passed (32)`，用时 `2.56s`；开始时间 `15:25:48`。 |
| 模拟授权响应与真实服务端授权区分 | **模拟证据通过；真实后端未验收** | 回归由 `installApiFixture` 注入 403，不调用真实后端或授权服务。测试只证明模拟拒绝下客户端清理及路由行为；没有执行成员撤权，也没有观察真实服务端拒绝或即时生效。 |
| 移动端、键盘与屏幕阅读器 | **未验收** | 本复验只运行 Vitest 浏览器测试；没有运行 viewport/mobile、键盘手动操作或读屏器检查。 |
| 生产环境 | **未验收** | 未连接或验证生产部署。 |

## 环境中断记录

早先的尝试不构成测试判定：一次 `pnpm.ps1` 启动在 Vitest 开始前因 `System.OutOfMemoryException` 失败；一次 `pnpm.cmd` 重试因 provider exit 中断。当前两次 `pnpm.cmd` 执行均完成并返回测试结果。先前中断尝试的完整参数未保留，故不补写猜测的命令行，也不将其计入通过或失败。

## 总体判定

**PASS（仅限此次 simulated frontend reacceptance）**。unresolved-descriptor 回归及两文件聚焦套件均通过，覆盖目标 Workspace cache 清理、actor/tenant/Workspace 隔离、不匹配最近项保留和原路由保持。该结论不代表真实后端授权/撤权、移动端、键盘、屏幕阅读器或生产验收通过；这些项目仍待独立执行，Workspace 恢复 UX 的整体验收不由本报告宣告完成。

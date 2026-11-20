# 前端模板与 Clerk 清理二次独立验收

- 验收日期：2026-11-19
- 验收基线：`5fe7dc7`（当前主工作树）；检查对象包括 residual fix 的 staged/unstaged diff。
依据：`docs/verification/frontend-cleanup-acceptance.md` 与 `docs/ux/frontend-architecture-cleanup-dashboard.md`。本次只新增本报告，没有修改产品实现。

## 结论

**指定 residual fix 通过，另记录一项标题层级复核建议。**Dashboard focused browser test、`tsc -b`、冻结 lockfile 安装检查、指定文件 diff 检查均通过。`@faker-js/faker` 在 `src`、`package.json` 和 `pnpm-lock.yaml` 中已清零；Tasks 页面改用固定的中性任务样例，未引用的 Users 样例文件已删除。Dashboard 空态标题以 `role="heading"` 和 `aria-level` 提供语义，页面未显示随机图表或旧的销售/流量模板指标。

标题层级的复核建议：`DashboardEmptyState` 默认 `level=3`，而 Analytics breakdown 卡片自身标题也是 `h3`，其空态调用未传 `level`。这使嵌套空态标题也暴露为 level 3；若 UX 结构要求它作为 breakdown 标题的子级，应显式设为 level 4 并补一条针对空态标题的浏览器断言。当前测试覆盖了页面与主要区块标题，但未直接断言 `DashboardEmptyState` 的 accessible heading level。

## 命令与证据

除特别标注外，命令从 `apps/web` 运行。`rg` 返回码 `1` 表示无匹配，是本次针对性清理检查的预期结果。

| 检查 | 命令、退出码 | 证据 | 局限 |
| --- | --- | --- | --- |
| Dashboard focused browser test | `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`，`0` | Vitest 4.1.4 / Chromium：1 个文件、1 个测试通过。现有测试断言页面 `h1`、主要区块 `h2`/`h3`、横向 Tabs、未接入文案、旧示例指标/人物/流量词缺失，以及英文到简体中文切换。 | 直接渲染组件，不走正式路由；状态标题本身未按 role/level 查询。没有做真实读屏器或方向键操作。 |
| Faker 全局扫描 | `rg -n -i 'faker|@faker-js/faker' src package.json pnpm-lock.yaml`，rg 退出码 `1` | `src`、manifest 和 lockfile 均无匹配。Diff 中 `package.json` 和 lockfile 已删除 Faker 声明及解析项。 | 这是文本扫描；不覆盖构建产物、仓库外缓存或非文本数据。 |
| 冻结 lockfile | `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts`，`0` | pnpm 11.7.0 返回 `Already up to date`；运行前后的 lockfile SHA-256 相同。 | 只校验 manifest 与 lockfile 一致，不安装或执行 package scripts。 |
| TypeScript | `pnpm exec tsc -b`，`0` | TypeScript project references 编译通过。 | 不验证运行时 API 或用户可见路由。 |
| Diff 检查 | `git diff HEAD --check -- apps/web/src/features/dashboard/components/empty-state.tsx apps/web/src/features/dashboard/index.test.tsx apps/web/src/features/tasks/data/tasks.ts apps/web/src/features/users/data/users.ts apps/web/package.json apps/web/pnpm-lock.yaml`（仓库根目录），`0` | 指定实现与依赖 diff 无 whitespace error。范围包含 staged 与 unstaged 的目标文件差异。 | 不包含未跟踪文件；本报告作为新文件没有纳入该 diff 检查。 |
| Dashboard 模板静态扫描 | `rg -n -i 'faker|@faker-js/faker|Math\.random\(|recent.?sales|recharts|Weekly clicks|Product Hunt|Twitter|\$45,231\.89|Olivia Martin|Jackson Lee|265 sales|42%|Download|Reports|Notifications' src/features/dashboard -g '!*.test.*'`，rg 退出码 `1` | Dashboard 生产组件没有命中 Faker、随机图表、Recent Sales、Download/Reports/Notifications 模板标签或旧销售/流量示例。`index.test.tsx` 中仍保留这些旧值的负向断言，故有意从生产源码扫描排除。 | 静态源码检查，不是整站 DOM 文本搜索；合法下载与通知设置在其他业务页面不属于本项。 |
| 任务样例与旧 Users fixture | `rg -n -i 'faker|@faker-js/faker|Math\.random\(|sales|revenue|visitor|clicks|email|assignee|createdAt|updatedAt|dueDate' src/features/tasks/data/tasks.ts`，rg 退出码 `1`；`Test-Path src/features/users/data/users.ts` 为 `False` | `tasks.ts` 只导出 5 条固定 `TASK-001` 到 `TASK-005` 样例，字段是标题、状态、标签和优先级；文件注释说明这些是模板样例而非实时业务数据。旧的 500 条随机 Users fixture 已删除。 | 任务样例仍是演示记录；本次只核对结构/代码，没有把 Tasks 页面作为独立功能验收。 |
| 空态标题语义与状态文案 | 只读检查 `src/features/dashboard/components/empty-state.tsx`、Dashboard 组件与 `index.test.tsx`；浏览器命令见上 | Empty state 接收 `level?: 2 | 3 | 4`，默认 3，并渲染 `role='heading' aria-level={level}`。Overview、Activity、Analytics 空态显示“数据尚未接入/数据源尚未配置”；KPI 以 `—` 显示，不用 0 冒充真实值。 | 现有 browser test 没有直接查询空态标题的 heading role/level；breakdown 内默认 level 3 与外层 h3 同级，建议实现方明确该层级是否预期。 |

## 剩余 UX 验收局限

- 没有在 390px 或更窄视口实测单列排布、页面横向溢出、Tabs 滚动及焦点环裁切。
- 没有手动验收 Tab/方向键、可见焦点或真实读屏器宣布的标题层级与 Tabs 方向；现有测试只通过点击切换 Analytics 并检查 `aria-orientation`。
- 没有连接 Dashboard API，因此 loading、未配置、合法空结果、请求失败、403/404 与 Workspace 切换后的隔离仍待真实集成验收。
- 本次未运行 `pnpm build`；本次指定复验项已按任务要求通过 focused browser test、`tsc -b`、冻结安装与 diff 检查。构建不作为本报告结论的单一依据。

## 实现建议复核补充（2026-11-19）

- 前次指出的 Breakdown 空态标题层级建议已解决：`analytics.tsx` 为两个 breakdown 空态传入 `level={4}`，`index.test.tsx` 断言该标题的 level-4 heading 恰好有两个。
- 复跑 `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`，退出码 `0`；Vitest 4.1.4 / Chromium 下 1 个文件、1 个测试通过。
- 仍未实测 390px 布局、键盘方向键与焦点表现、真实读屏器播报、正式路由或 Dashboard API 运行态；本次只复核上述两个组件文件和 focused browser test。

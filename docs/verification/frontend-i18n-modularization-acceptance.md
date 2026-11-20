# 前端 i18n 模块化独立验收

- 日期：2026-11-19
- 结论：**fail**。模块拆分、静态装配、已登记词条双语完整性和指定静态检查基本通过；但对拆分前暂存版本逐 key 对比发现 Dashboard catalog 有 37 个方向性查找缺失，Dashboard 浏览器测试也复现中文展示失败。
- 范围：只读检查 `apps/web/src/lib/i18n.ts`、`apps/web/src/lib/i18n/`、`apps/web/src/lib/i18n.test.ts`，并读取根 `AGENTS.md` 与 `docs/development-status.md`。未修改产品实现。
- 基线：工作树中 `i18n.ts` 同时有暂存与未暂存变更；兼容性对比使用 `git show :apps/web/src/lib/i18n.ts` 的 index 版本作为模块拆分前基线，而非更旧的 `HEAD`。

## 逐项结论

### 1. 运行时与目录位置 — partial

- `apps/web/src/lib/i18n.ts:1-3` 只导入 React store hook、catalog lookup 和静态注册表；其余为 locale 持久化、hooks、查找/fallback 与格式化逻辑，没有词典对象。
- `apps/web/src/lib/i18n/index.ts:1-9,18-30` 静态注册 `auth`、`attachments`、`common`、`legacy`、`navigation`、`settings`、`tenants`、`workspaces` 八个模块；没有 Dashboard 模块。
- 四份原始翻译 record 仍在目录外：`apps/web/src/lib/i18n/navigation.ts:7-8` 导入 `apps/web/src/components/layout/header-messages.ts`、`sidebar-messages.ts`；`apps/web/src/lib/i18n/workspaces.ts:7-8` 导入 `apps/web/src/features/workspaces/team-messages.ts`、`model-provider-messages.ts`。目录内有对应装配模块，但若要求所有领域词条源也必须位于 `lib/i18n/`，此项未完全满足；library 层反向依赖 UI/feature 路径也带来后续耦合风险。

### 2. 静态加载、方向/优先级、fallback 与 API — fail

- 静态性通过：注册表使用普通静态 `import`；`apps/web/src/lib/i18n/` 未发现 `import()`、`fetch()`、XHR、WebSocket 或 `/api/` 装载代码。查找链按 `chainOrder`、`mergeOrder`、`entryOrder` 排序，冲突时由后续 `Map.set` 决定结果（`catalog.ts:189-231`）。
- 当前 `Locale`、`getLocale`、`setLocale`、`useLocale`、`useLocaleText`、`translate`、`formatMessage` 均保留；另增加 `t = translate` 别名（`apps/web/src/lib/i18n.ts:5,17-44,81-83`）。编译通过，locale 同步写入 `synapse-locale`；原始空白和未命中原串逻辑保留。
- 只读差分审计以暂存拆分前词典与查找顺序为参照，经 Vite SSR 对当前实现逐 key 查找：958 个中文到英文源 key 中 18 个不一致；343 个英文到中文源 key 中 19 个不一致。所有不一致均为遗漏词条在当前实现返回源串，而非剩余词条的优先级变化。
- 漏项集中在拆分前 `dashboardChineseToEnglish` / `dashboardEnglishToChinese` 词典，没有进入八个已注册 catalog。涉及 Dashboard 标题、分组和空数据提示，例如 `工作区摘要`→`Workspace summary`、`分析数据尚未接入。`→`Analytics data isn't connected yet.`，及反向的 `Workspace summary`→`工作区摘要`、`Analytics data isn't connected yet.`→`分析数据尚未接入。`。
- `apps/web/src/features/dashboard/index.tsx:41-78` 通过 `LocalizedText` 使用这些词条。额外运行 `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless` 失败：切到 `zh-CN` 后测试期望 `分析数据尚未接入。`，页面仍显示 `Analytics data isn't connected yet.`；断言见 `apps/web/src/features/dashboard/index.test.tsx:127-136`。该用例验证了双向词条回归的用户可见影响。

### 3. 双语成对与未命中 — pass（仅限已登记词条）

- 当前八个模块共 1,361 个 `TranslationCatalogEntry`。`BilingualMessage` 要求 `zh-CN` 与 `en` 两个字段（`catalog.ts:1-5,16-25`）；运行 `validateTranslationCatalog` 结果为 `duplicateModuleIds: []`、`duplicateEntryKeys: []`、`missingLocaleKeys: []`。`i18n.test.ts:21-44` 对这些结果及模块清单有断言。
- 有 12 个条目没有 lookup 映射；它们由 legacy helper 对中文源串保留原文，`lookups: []` 是其显式规则（`catalog.ts:87-116`），不属于缺少某一 locale 的双语记录。当前 completeness guard 不会检查 lookup 覆盖。
- `i18n.test.ts:89-95` 验证两种 locale 下未登记字符串原样返回，并验证缺失格式化 placeholder 保留；这些断言通过。但它们只覆盖未登记 key 的 fallback，不会发现整个 Dashboard catalog 未注册。

### 4. 指定验证命令 — pass；相关 Dashboard focused test — fail

从 `apps/web` 运行：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/lib/i18n.test.ts --browser.headless` | pass：1 个文件、6 个测试通过 |
| `pnpm exec tsc -b --pretty false` | pass：退出码 0 |
| `pnpm exec eslint src/lib/i18n.ts src/lib/i18n.test.ts src/lib/i18n --format stylish` | pass：退出码 0，无输出 |
| `git diff --check` | pass：退出码 0，无空白错误 |

此外，为确认 catalog 对既有 Dashboard 调用的兼容性，运行了上述 Dashboard focused test；它失败并复现了第 2 项的中文缺译。未运行全项目构建或全量测试。

### 5. 归属、重复词条、循环依赖与覆盖缺口 — partial

- 目录归属不完整：`navigation` 和 `workspaces` wrapper 在 `lib/i18n/`，但上述四份原始 record 在 components/features 目录。依赖图检查未发现当前循环：这些 record 文件是叶节点，没有回导 `lib/i18n`；不过 `lib/i18n` 依赖 UI/feature 层的方向需要关注。
- 找到两组同一目标 locale/chain 中的重复源词条。`帮助中心` 在 `common`（mergeOrder 4）为 `Help Center`、在 `navigation`（mergeOrder 3）为 `Help center`，最终为 `Help Center`；`错误页面` 在 `navigation` 的 mergeOrder 3/4 分别为 `Error page`/`Errors`，最终为 `Errors`。差分审计确认最终结果与拆分前暂存版本相同，当前优先级稳定；但 `findDuplicateTranslationEntryKeys` 只检测生成的 entry ID，不检测相同 `sourceText` 的不同译文（`catalog.ts:163-176`），现有测试也没有覆盖这两组冲突的最终值。
- `validateTranslationCatalog` 只检查当前传入的模块、模块 ID、entry ID 与 locale 字符串（`catalog.ts:134-187`）；没有必需领域注册清单或拆分前覆盖回归检查，因此整个 Dashboard 模块遗漏仍会得到“无 missing locale keys”。`i18n.test.ts` 的 6 个测试未覆盖 Dashboard catalog；独立 Dashboard 测试已能捕获至少一个失败。
- `docs/development-status.md:214` 仍将 i18n 描述为“实现继续”，未记录本次实现或独立验收；状态更新由主协调者处理，本 worker 未修改该文件。

## 待修复与局限

- 验收不通过的阻塞项：补回 Dashboard 双向词条并纳入静态 catalog，再添加能阻止整域词条遗漏的回归校验；之后重跑本报告列出的命令与 Dashboard focused test。
- 本次差分审计为临时、只读的 Vite SSR 脚本，没有作为可重复测试提交；比较的是当前工作树与暂存 index 基线，不等同于干净提交之间的验证。
- 本报告不覆盖全项目构建、所有页面浏览器路径、服务端行为、真实 API、屏幕阅读器/移动端 UX 或生产运行。按任务要求未以全量构建或 health check 替代定向证据。

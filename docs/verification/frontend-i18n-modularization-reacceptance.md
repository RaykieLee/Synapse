# 前端 i18n Dashboard 修复独立复验

- 日期：2026-11-19
- 结论：**pass**。Dashboard 双语映射、静态注册、方向优先级与未命中 fallback 均有代码和定向测试证据；指定 Vitest、tsc、scoped ESLint 与 `git diff --check` 全部通过。
- 范围：只读复核 i18n 实现/测试与前次验收基线；仅新增本报告，未改产品实现或测试。
- 基线：按前次验收报告采用拆分前的暂存版本 `git show :apps/web/src/lib/i18n.ts`，不以更旧的 `HEAD` 代替。

## 核验结果

### 1. Dashboard 词条完整性 — pass

- 对拆分前 `dashboardEnglishToChinese` 与当前 `dashboardEnglishToChineseMessages` 做逐对比较：基线 19 组、当前 19 组，`missing` 与 `extra` 均为空；当前词条位于 `apps/web/src/lib/i18n/dashboard.ts:7-51`。
- 当前 catalog 登记 19 个英文→中文 lookup 与 18 个中文→英文 lookup，共 37 个方向性 lookup。`Agents` 的反向项刻意不在 Dashboard 模块重复登记；既有高优先级 `智能体`→`Agent` 保持生效，见 `apps/web/src/lib/i18n/dashboard.ts:53-75` 与 `apps/web/src/lib/i18n.test.ts:58-111`。
- Dashboard 通过静态 import 加入 registry（`apps/web/src/lib/i18n/index.ts:4,19-33`）。回归测试精确要求 `dashboard` 模块存在、其 lookup 数为 37，并对 19 组词条逐一断言双向翻译；整域漏注册或词条遗漏会导致断言失败（`apps/web/src/lib/i18n.test.ts:21-44,58-111`）。

### 2. 方向、优先级与 fallback — pass

- Dashboard 英译中使用 `chainOrder: 2`，中译英使用 `chainOrder: 6`（`apps/web/src/lib/i18n/dashboard.ts:61-75`）；registry 测试锁定两种 locale 的查找链顺序（`apps/web/src/lib/i18n.test.ts:34-39`）。catalog 按 `chainOrder`、`mergeOrder`、`entryOrder` 排序并按链查找（`apps/web/src/lib/i18n/catalog.ts:189-231,234-259`）。
- `Agents` / `智能体` 的断言确认原有高优先级结果为 `Agent`，其他 Dashboard 词条则按原成对文案翻译（`apps/web/src/lib/i18n.test.ts:58-111`）。
- 未命中仍返回原文；中文源串不会被反向误翻，中文 fallback 仍限制在原有后续链；`formatMessage` 仍保留缺失 placeholder。对应实现见 `apps/web/src/lib/i18n.ts:43-84`，回归断言见 `apps/web/src/lib/i18n.test.ts:140-153`。
- Dashboard 页面测试切换到 `zh-CN` 后确认空态显示 `分析数据尚未接入。`，并断言另一组文案能双向翻译（`apps/web/src/features/dashboard/index.test.tsx:127-137`）。

## 指定验证

从 `apps/web` 运行：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/lib/i18n.test.ts src/features/dashboard/index.test.tsx --browser.headless` | pass：2 个文件、8 个测试通过 |
| `pnpm exec tsc -b --pretty false` | pass：退出码 0 |
| `pnpm exec eslint src/lib/i18n.ts src/lib/i18n.test.ts src/lib/i18n --format stylish` | pass：退出码 0，无 lint 错误 |
| `git diff --check` | pass：退出码 0；Git 对若干无关既有文件提示 CRLF→LF 行尾规范化警告 |

## 局限

- 本结论限于 Dashboard/i18n 指定范围及上述定向检查；未运行全项目构建、全量浏览器测试、真实 API 或生产行为验证。
- 37 项保护基于显式测试清单；未来新增 Dashboard 文案需同步扩展该清单，测试不会自动扫描页面字符串。
- `git diff --check` 的行尾警告来自当前工作树其他既有改动，不影响本次 i18n 验收结论。

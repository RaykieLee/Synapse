# F44 根工作台复验补充

**复验日期：2026-11-09（Asia/Shanghai）**  
**范围：** 仅补充 F44 根工作台可重复 UI 验证；不覆盖或改写初验、复验报告，也不将 F44 标记为整体验收通过。

## 执行证据

- **命令（仓库根目录）：** `pnpm --dir apps/web exec vitest run --browser.headless src/routes/_authenticated/-index.test.tsx`
- **最终结果：** exit 0；Vitest Chromium headless，`1 file passed`、`10 tests passed`，耗时 3.64 秒。没有运行全仓构建或广泛 health 检查。
- **格式命令：** `pnpm --dir apps/web exec prettier --write src/routes/_authenticated/-index.test.tsx` 完成；随后 `pnpm --dir apps/web exec prettier --check src/routes/_authenticated/-index.test.tsx ../../docs/verification/F44-workspace-home-reacceptance-supplement.md` 检查通过。
- **非阻断输出：** TanStack Router 提示测试直接导入 `AuthenticatedHome` 会影响代码分割；浏览器还输出两条 `overlapping act()` console error。两者均未导致测试失败，仍是测试运行环境中的提示/错误日志，不据此推断产品整体无问题。
- **身份与数据边界：** 所有 UI 数据均为测试 mock：`actor-a`、Tenant A/B、Active/Archived Workspace。目录成功/失败由测试状态对象构造，重试与导航为 spy/mock；未调用真实 API、数据库、登录会话或生产凭据，也未使用生产数据。

## 场景结果

| 场景 | Verdict | 证据与边界 |
| --- | --- | --- |
| 默认工作台停留，显式选择后才记录最近项并请求导航 | 通过（mock UI） | 验证首次渲染不导航；点击显式 Workspace 链接后记录 mock 最近项并调用 mock 导航。不是对真实受保护路由的端到端访问。 |
| active 与 archived 分组、卡片及显式进入控件 | 通过（mock UI） | 两类卡片与分组可见；显式点击才触发 mock 导航。 |
| 成功的空 Workspace 目录 | 通过（mock UI） | 显示成功空态且不显示目录失败文案。 |
| Tenant 目录失败、Workspace 目录成功 | 通过（mock UI） | alert 和 Tenant-only 重试可见；保留已成功 Workspace 数据、租户名 fallback；不误报空态，不显示最近继续；重试只调用 Tenant query。 |
| Workspace 目录失败、Tenant 目录成功 | 通过（mock UI） | 错误仅指向 Workspace 目录；Tenant 成功部分仍显示；重试只调用 Workspace query；不显示全空/状态空态、最近继续、过期/未确认 Workspace 卡片或进入链接；无自动导航或最近项写入。 |
| 仅 archived Workspace 的成功目录 | 通过（mock UI） | 归档分组、归档卡片及组合状态文案可见；不显示“无可访问 Workspace”整体空态；首次渲染无自动导航或最近项写入。未推断 archived Workspace 是否应被真实后端允许作为业务上下文。 |
| 英文 locale 下的失败、fallback 与 accessible names | 通过（运行时 locale + mock UI） | 经 `setLocale('en')` 渲染实际组件；分别验证 Workspace-only 与 Tenant-only 错误/重试按钮名称、Tenant-name fallback、英文分组/链接可访问名称及最近继续隐藏。不是只测翻译字典。 |
| 320px、390px viewport | 通过（headless Chromium） | 分别设置 `320×844`、`390×844`；断言 `window.innerWidth` 与指定宽度一致，且 `main.scrollWidth <= viewport width`。仅为视口宽度及主内容横向溢出检查，不等于人工移动设备验收。 |
| 键盘焦点与 Enter | 通过（headless Chromium + mock 导航） | Tab 将焦点移至显式“进入 Workspace”链接，`toHaveFocus()` 通过；Enter 触发 mock 最近项写入和 mock 导航。没有验证目标真实路由、服务端权限或读屏播报。 |
| 最近 Workspace 仅在当前成功目录中显示 | 通过（mock UI） | 当前目录包含时可见；不包含时隐藏。 |

## 尚未验收

- 本补充没有重跑后端 TestClient；F44 既有复验报告记载的临时 SQLite/FastAPI 测试结果仍仅作为该报告中的历史证据，不代表本轮新跑、生产 API 或完整角色/作用域矩阵。
- 目录 API、真实账号与成员资格、租户/Workspace 服务端隔离、受保护 `/w/{id}` 端到端进入、归档 Workspace 真实权限、Overview API/指标均未由这些 UI mocks 验证。
- 未连接或运行屏幕阅读器；未做人工键盘/触控检查、焦点顺序完整审查、目标尺寸测量、颜色对比、`prefers-reduced-motion` 验证。自动化 accessible-name 查询不是读屏器证据。
- 320px/390px 结果只证明当前测试 DOM 在 Chromium 视口下没有主节点横向滚动宽度溢出；不证明真实手机、不同缩放/字体、所有子节点或生产布局表现。
- 因上述 UX 验收矩阵及真实后端/生产边界仍未覆盖，本补充仅判定表中定向 UI 场景通过；F44 整体仍为待实际验收，不替代或覆盖 `F44-workspace-home-acceptance.md` 与 `F44-workspace-home-reacceptance.md`。

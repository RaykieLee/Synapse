# Synapse 开发与独立验收台账

目标：完成 integration-plan.md 全部明确范围。租户与 Workspace 为所有业务迁移的前置条件。

用户要求：子智能体全部使用 gpt-6-luna / high；每个任务只做一个功能或一个验证；每项验证由独立子智能体执行。主智能体负责协调、契约和进度记录。开发完成不等于验收通过。

状态：待开始 → 开发中 → 待独立验收 → 通过；验证失败转回修复。外部运行条件不足的功能记为待实际验收，不记为通过。

> 2026-10-12 当前 HEAD `bb4351b` 基线与 P0 复验：工作区干净；API 默认套件 `24 passed, 26 deselected, 38 warnings`、`compileall app`、`pnpm build` 均通过；ESLint `0 errors, 24 warnings`。使用现有 Docker Redis `127.0.0.1:16381` 由主线程重跑 F24b 真实 FastAPI/AgentScope/Vite/Chromium 流程，输出 `F24b chat messages frontend verification passed`，退出码 `0`。验证后只清理本轮生成的 1 个 F24b Redis event key，DB4/DB5 恢复为 `6/0`；真实模型推理、工具确认/调用、外部任务和 SSE 重连仍未验证，详见 [F24b 聊天消息验收](verification/F24b-chat-messages-frontend.md) 与 [基线复验报告](verification/baseline-2026-10-12.md)。

> 2026-10-12 F25a SSE 文本增量完成当前工作树独立复验：使用现有 Docker Redis `127.0.0.1:16381`、临时 SQLite（Alembic `0016_tenant_validity`）、真实 FastAPI/AgentScope/Vite/Chromium，`pnpm build` 与完整 F25a runner 均通过，输出 `F25a SSE text frontend verification passed`，退出码 `0`。验收覆盖文本增量、断线 replay、去重、会话/Workspace 切换隔离、历史消息保留、临时 503 重试、删除会话后的 404 清理和撤权后的 403 清理。runner 已补充 Windows `pnpm`/子进程兼容及按名称精确清理 F25a Agent/Session/event fixture；结束后 Redis DB7/DB8 均为 `0` keys。真实模型提供商推理、工具调用和人工确认仍未验证，详见 [F25a SSE 文本验收](verification/F25a-sse-text-frontend.md)。

> 2026-10-13 F25b1/F25b2/F26a/F26b/F27a 完成本轮独立验收与修复后复验：F25b1 中断、F25b2 工具事件、F26a 工具权限确认、F26b 外部结果人工介入、F27a 团队任务只读面板的真实 FastAPI/AgentScope/临时 Redis/Vite/Chromium runner 均退出码 `0`。F26b 首次发现历史 external-result textarea 受控状态缺陷，F27a 首次发现团队任务事件刷新缺口，均已修复并重新通过。所有报告仍明确排除真实模型 provider、真实工具/外部执行器、真实子智能体编排 worker 的覆盖；F25b1 parked 状态为前端投影，F26a HITL resume 使用受控响应与真实 fixture。另发现 AgentScope `WakeupDispatcher` 的后台 resume 可能丢失 `WorkspaceContext`，F26b UI 通过不等于后台恢复通过，已拆为 F26b-backend 未实现任务；对应安全传播设计已完成。F27b UX/API 设计已完成，但实现仍未开始。详见各项 [F25b1](verification/f25b1-interrupt.md)、[F25b2](verification/f25b2-tool-events.md)、[F26a](verification/f26a-tool-permission.md)、[F26b](verification/F26b-external-result-frontend.md)、[F27a](verification/F27a-team-panel.md) 报告。

> 2026-10-13 F26b-backend、F27b-1、F32 第一阶段完成最新修复与独立复验：F26b WakeupDispatcher 增加 consuming lease 的 attempt-safe CAS 恢复、任意 spawn 失败回滚和有界 512 条启动恢复索引，聚焦测试 `12 passed`；F27b 控制面增加创建/更新授权、创建者保护、tenant/workspace 复合外键和数据库级单 active run 约束，聚焦测试 `6 passed`，全新 Alembic `0001 -> 0018` 升级通过；F32 endpoint DNS 解析失败改为 fail-closed，同时保留开发环境 localhost 放行，聚焦测试 `4 passed`。这些修复仍不等于 C 级真实 AgentScope model/tool 执行、真实团队 worker 或真实 provider connection；F27b 仍为 `durable_control_only`。当前 API 全量、compile/build/lint 结果仍以各复验报告为准，真实模型 provider、真实工具执行和登录后的双角色浏览器场景仍未宣称通过。详见 [F26b-backend 复验](verification/F26b-wakeup-workspace-context-reacceptance-20261013.md)、[F27b 复验](verification/F27b-team-orchestration-reacceptance-20261013.md)、[F32 复验](verification/F32-model-provider-custom-model-reacceptance-20261013.md)。

> 2026-10-13 设置域交互收口：个人资料、账号密码、外观、显示和通知页面改为“当前设置摘要 + 编辑弹窗”，保留原有设置路由和提交语义；移动端摘要按钮改为纵向布局，设置侧栏移动端选择器改为直接受路由控制。当前已通过设置域 ESLint、前端构建和既有 5 个前端测试文件（47 项）；Display/Notifications 仍是模板演示提交，未接入持久化 API，未宣称真实设置保存验收。

## 架构演进首批任务（2026-11-06）

方向：按战略 DDD 和模块化单体逐步演进；此批先记录决策、建立依赖规则、梳理授权上下文 UX，再实施纯解析 seam。实现与独立验收分别委派。

| ID | 任务 | 状态 | Orca dispatch / 后续门槛 |
| --- | --- | --- | --- |
| ARCH-ADR-001 | 记录战略 DDD、模块化单体、选择性战术 DDD、AgentScope ACL 决策及参考资料适配结论 | 已完成 | [ADR 0003](adr/0003-strategic-ddd-modular-monolith.md)；独立 worker `ctx_45c75fc3b068` 完成，协调者补充核对文章与四个模板的适配边界 |
| ARCH-GUARD-001 | 增加模块依赖方向的自动架构守护 | 实现及新独立复验完成 | 初验 `4 passed` 发现包内 `tests` 路径漏检，已修复并加回归断言；新独立任务 `task_0105325e3749` / `ctx_22d19a96d6ff` 运行 `5 passed` 并成功结算；旧 follow-up `ctx_b9d3a1fc4749` 仍因 worker identity mismatch 未结算，不作为本次通过的依据；详见 [验收记录](verification/architecture-guard-acceptance-2026-11-06.md) |
| ARCH-UX-001 | 评审授权上下文错误状态、切换、缓存、移动端与可访问性 | 已完成 | [UX 契约](ux/architecture-authorization-context.md)；独立 UX worker `ctx_3d8998734af0` 完成，供实现与后续独立验收使用 |
| TENANCY-SEAM-001 | 将 Tenant/Workspace 上下文解析拆为框架无关 resolver 和 FastAPI adapter，保持现有 wire contract | 后端定向独立验收通过；前端 UX 与 adapter 全矩阵验收未完成 | 独立 verifier `ctx_378d05d02e65`；resolver + F06 定向测试 `9 passed, 2 warnings`；`RESOURCE_NOT_FOUND` 的 404 仅审查映射、未端到端覆盖；详见 [验收报告](verification/architecture-tenancy-seam-acceptance-2026-11-06.md) |
| ARCH-VERIFY-001 | 独立验收授权上下文 seam 与依赖方向规则 | tenancy seam 定向验收通过；架构守护新独立复验通过 | tenancy 报告 `9 passed`；guard 新独立任务 `task_0105325e3749` 报告 `5 passed`；旧 follow-up `ctx_b9d3a1fc4749` 仍未结算；详见两份 `docs/verification/architecture-*-acceptance-2026-11-06.md` 报告 |
| UX-SETTINGS-REALISM-001 | 审查个人设置域真实可用性并输出实施契约 | UX 设计与两轮实现完成；复验失败待修复 | 独立 UX worker `ctx_0f304b985a56`；方案见 [个人设置域真实可用性 UX 契约](ux/settings-realism.md)。首轮修复 Cookie 异常与 Profile 401 草稿；复验发现外观仍先提交主题再写字体，且两个 provider 的 `Error(message, { cause })` 与 ES2020 目标冲突，见 [设置复验报告](verification/settings-realism-reacceptance.md) |
| UX-WORKSPACE-RECOVERY-001 | 审查不可访问 Workspace 的原地恢复体验并输出实施契约 | 前端模拟复验通过；真实/生产验收待补 | 独立 UX worker `ctx_d8ced0dbdedb`；方案见 [Workspace 不可访问恢复 UX 契约](ux/inaccessible-workspace-recovery.md)。首轮独立验收发现的 unresolved-descriptor 缓存清理缺口已修复；复验 `task_574db72d379f` 通过隔离回归 `1/1` 与聚焦套件 `32/32`，仅限 simulated frontend reacceptance，见 [恢复复验报告](verification/workspace-inaccessible-recovery-reacceptance.md) |
| UX-QUICK-NAVIGATION-001 | 审查快速导航搜索的作用域、状态与可访问性 | UX 设计与实现完成；独立验收失败 | 独立 UX worker `ctx_46df3b4a1a5a`；方案见 [命令搜索与全局导航 UX 契约](ux/command-search-context.md)。实现精确复用 `selectAuthorizedNavigationCandidates`，但独立验收发现 Tenant 上下文解析期间错误显示 Global scope，见 [快速导航验收报告](verification/quick-navigation-acceptance.md) |
| UX-GLOBAL-NAVIGATION-001 | 审查全局导航四层信息架构与实施分期 | UX 设计与实现完成；独立验收失败 | 独立 UX worker `ctx_8c773f85b462`；方案见 [全局导航信息架构 UX 契约](ux/global-navigation-information-architecture.md)。设计冻结“个人 / 平台管理 / 租户管理 / Workspace 工作台”四层；实现完成后，独立 verifier `task_ad67822bb6f8` 判定失败：移动端仍用 Popover、失败重取可残留旧菜单、面包屑层级/中英文案与焦点公告存在缺口，见 [全局导航验收报告](verification/global-navigation-acceptance.md) |
| UX-F43-ROUTE-CLEANUP-001 | 审查演示与模板路由的清理策略 | UX 设计与二次修复完成；聚焦复验通过 | 独立 UX worker `ctx_8df70ca301bc`；方案见 [F43 路由清理 UX 契约](ux/F43-route-cleanup.md)。二次修复删除确认无引用文案并同步 document lang；第三次复验 `task_bac6c4f97beb` 通过聚焦范围，报告记录生产深链、真实授权、完整读屏、route regeneration/build 与来源部署证据仍未覆盖 |
| UX-WORKSPACE-HOME-001 | 审查稳定工作台与 Workspace 概览 UX/API 契约 | UX 设计完成；第一阶段实现完成；自动化 UI 补测完成，真实验收待补 | 独立 UX worker `ctx_ee20f7f090c7`；方案见 [Workspace 工作台与空间概览 UX 契约](ux/workspace-home-overview.md)。核心决策为登录后 `/` 保持稳定工作台，不自动进入最近/首个/唯一 Workspace；概览聚合 API 与指标清单均未存在，实施不得使用模板值或前端拼凑指标 |
| IMPL-F43-ROUTE-CLEANUP-001 | 实施演示与模板路由清理 | 二次修复完成；第三次复验中 | 实现 worker `ctx_5e1b8acea403` 完成路由清理；首轮修复 `task_a1f9fa471d9d` 增加 Clerk 父路由 404 与测试、移除 Clerk/Faker 依赖及 37 条死文案。二次修复 `task_4371bdcd75be` 仅删除确认无引用的 Apps/Chats/Connected/Connect/Coming Soon 词条，并同步存储 locale 与 `document.documentElement.lang`；Help Center 与 Tasks 因现存引用保留 |
| VERIFY-F43-ROUTE-CLEANUP-001 | 独立验收 F43 路由清理 | 通过（聚焦范围） | verifier `task_bac6c4f97beb` / `ctx_8bc2a3c82e20` 完成 [F43 复验报告](verification/F43-route-cleanup-second-reacceptance.md)：死键引用扫描、locale/lang、嵌套 Clerk 404、别名、已移除路径与 3 文件/18 测试通过。生产 HTTP/认证授权、完整读屏、route regeneration/build 与来源部署仍待验证 |
| IMPL-WORKSPACE-HOME-001 | 实施稳定根工作台第一阶段 | 部分目录修复完成；自动化 UI 补测通过，真实验收仍受限 | 独立实现 worker `ctx_579c7e7adf77`；首验 `ctx_e3820c17d8bc` 发现 Tenant 目录失败但 Workspace 目录成功时丢失成功 Workspace，修复 `ctx_5921a14e74de` 已完成。独立补测覆盖 Workspace-only 失败、archived-only、运行时英文、320/390px、Tab/Enter 并通过 `10/10`；真实 API/受保护路由、生产权限、读屏与人工移动验收仍未完成。详见 [首验](verification/F44-workspace-home-acceptance.md)、[复验](verification/F44-workspace-home-reacceptance.md) 和 [补充复验](verification/F44-workspace-home-reacceptance-supplement.md) |
| FIX-F44-PARTIAL-DIRECTORY-001 | 保留成功 Workspace 目录并呈现部分失败 | 修复完成；自动化 UI 回归通过，整体验收待真实证据 | 独立修复 worker `ctx_5921a14e74de` 报告定向测试 `6/6` 与 build 通过；独立复验 `task_d39d2ac30401` 的 mock UI 与临时数据库 API 部分通过；补充 verifier `task_c767e5244a3e` 新增的场景/UI 断言 `10/10` 通过。真实 API/认证进入、服务端权限、读屏和生产验收仍未覆盖；见 [F44 首验](verification/F44-workspace-home-acceptance.md)、[复验](verification/F44-workspace-home-reacceptance.md)、[补充复验](verification/F44-workspace-home-reacceptance-supplement.md) |
| REVERIFY-F44-WORKSPACE-HOME-001 | 复验 F44 部分目录失败修复与未完成场景 | 自动化补充验收完成；整体环境受限，未通过为整体验收 | 首轮复验 `task_d39d2ac30401` / verifier `ctx_0bf5d0f02ed5` 的聚焦 UI `6/6` 与两项临时数据库 API 各 `1 passed`；补测 `task_c767e5244a3e` / verifier `ctx_261caf2096e4` 新增 4 类状态、英文运行时、320/390px 及键盘 Tab/Enter 检查，Chromium headless `10/10`、Prettier 检查通过。报告 [F44 补充复验](verification/F44-workspace-home-reacceptance-supplement.md) 明确真实 API/认证路由、屏幕阅读器、人工移动及生产验收仍待完成 |
| IMPL-SETTINGS-REALISM-001 | 实施个人设置真实性第一阶段 | 第一阶段完成；独立验收发现两项缺口，修复中 | 实现 worker `ctx_ebf0f40f7fec` 已完成；聚焦测试 `9/9`。Profile 使用 `PATCH /account/profile`，Account 使用 `POST /account/password`；Display/Notifications 标注 API/投递尚不可用；Appearance 仅写当前浏览器 Cookie。独立验收发现 Appearance Cookie 异常状态和 Profile 401 草稿重置问题，见 [设置域验收](verification/settings-realism-acceptance.md)；修复另列。集成 build 在 sidebar/Workspace TypeScript 错误处失败，非设置文件范围 |
| VERIFY-SETTINGS-REALISM-001 | 独立验收个人设置真实性第一阶段 | 首轮部分通过；两项失败待修复复验 | Orca Task `task_627db1f691dd` / verifier `ctx_32345cfb9a6b` 已完成，仅写 [设置域独立验收](verification/settings-realism-acceptance.md)；确认只读 Display/Notifications 与 API 归属文案，发现 Cookie 异常和 401 草稿保留缺口，真实持久化、密码成功流与可访问性仍待验收 |
| FIX-SETTINGS-REALISM-001 | 修复外观 Cookie 失败与资料 401 草稿丢失 | 首轮修复完成；复验失败 | Orca Task `task_a902a36b113d` / worker `ctx_9f3bd51e4ccb` 完成。Cookie 拒绝/异常保留草稿、回滚已验证写入或披露未确认部分状态并抑制成功回调；401 后仅原账号内存保留草稿、无有效用户禁存、保存/放弃/换号清除、刷新不保留。聚焦浏览器套件 `15/15`，但复验发现提交非原子 |
| REVERIFY-SETTINGS-REALISM-001 | 独立复验设置失败恢复修复 | 复验失败；待二次修复 | Orca Task `task_269a51fbdcc1` / verifier `ctx_2f4a4d6377f4`，仅写 [设置复验报告](verification/settings-realism-reacceptance.md)。聚焦测试仍 `15/15`，但主题 provider 在第二枚 Cookie 确认前应用，`pnpm build` 失败于两个 provider 的 ES2020 TS2554；Profile 401 mock 行为通过 |
| FIX-SETTINGS-REALISM-002 | 修复外观原子提交与 provider TS | 修复完成；复验中 | Orca Task `task_4d00cf325b48` / worker `ctx_2f168ba015c7` 完成：两枚 Cookie 均读回确认后才同时应用 provider state，失败保留草稿并执行已验证回滚；provider 错误保留 cause 元数据且兼容 ES2020。聚焦 Chromium `16/16` 通过，`pnpm --dir apps/web build` 通过，`git diff --check` 通过 |
| REVERIFY-SETTINGS-REALISM-002 | 独立复验设置原子提交修复 | 部分通过；缺一项读回异常回归 | verifier `task_c44eedd879c9` / `ctx_697f34ec6784` 完成 [设置复验报告](verification/settings-realism-second-reacceptance.md)：Chromium `16/16`，provider TS2554 已消失；完整 build 被 `app-header.tsx` 两个并行导航 TS 错误阻断，且 paired-cookie-readback 最终异常没有独立测试。真实 API/401、Cookie 阻断、响应式/辅助技术验收仍待补 |
| FIX-SETTINGS-REALISM-003 | 补充最终 paired-cookie readback 异常回归 | 等待全局复验后启动 | Orca Task `task_81fe88eb84f5` 依赖 `task_b3579dc1f1ab` 以串行化浏览器测试；只允许修改 `settings-realism.test.tsx`，验证 draft 保留、partial/unconfirmed 提示、无成功回调与 `aria-busy=false` |
| REVERIFY-SETTINGS-REALISM-003 | 独立复验最终 readback 异常路径 | 等待测试补充 | Orca Task `task_f0fff4e05701` 依赖 `task_81fe88eb84f5`；只写 `docs/verification/settings-realism-final-reacceptance.md` 并独立运行设置聚焦套件 |
| IMPL-WORKSPACE-RECOVERY-001 | 实施 Workspace 不可访问原地恢复体验 | 首轮实现完成；验收失败待修复 | 独立实现 worker `ctx_06f40ce9b9e0` 完成。稳定 code 覆盖成员不可访问、一般拒绝、资源不可用、范围停用、上下文冲突；未知/网络/5xx 为通用恢复态；401 沿认证边界且 returnTo 安全。模拟响应聚焦测试 `31/31`、Vite build 与 `git diff --check` 通过；但验收发现 unresolved descriptor 分支跳过当前敏感缓存清理，需补充回归 |
| VERIFY-WORKSPACE-RECOVERY-001 | 独立验收 Workspace 不可访问恢复体验 | 首轮验收失败；待修复复验 | Orca Task `task_a534af748292` / verifier `ctx_411516466628`；仅新增 [恢复验收报告](verification/workspace-inaccessible-recovery-acceptance.md)。原路由、code 分类、显式恢复、401 与匹配最近项处理通过；缓存隔离缺口失败。真实后端撤权、移动端、键盘与读屏仍为环境限制 |
| FIX-WORKSPACE-RECOVERY-001 | 修复 Workspace 恢复缓存隔离缺口 | 修复完成；复验中 | Orca Task `task_5f5765c3a8c6` / worker `ctx_c6fc1219f9a5` 完成：新增 tenant-scoped fallback，仅在缓存 Workspace detail 无歧义匹配当前 actor 与 route ID 时补足清理目标；回归覆盖目录/最近项不可用及其他 actor/tenant/Workspace/recent 隔离，聚焦测试 `32/32`，修复前失败、修复后通过 |
| REVERIFY-WORKSPACE-RECOVERY-001 | 独立复验 Workspace 恢复修复 | 通过（仅限模拟前端证据） | Orca Task `task_574db72d379f` / verifier `ctx_14cd0cb1e4ca` 完成 [恢复复验报告](verification/workspace-inaccessible-recovery-reacceptance.md)：目标缓存清理、其他 actor/tenant/Workspace 隔离、不匹配最近项保留与原路由保持均通过；真实后端授权/撤权、移动端、键盘、读屏与生产验收仍待独立执行 |
| IMPL-GLOBAL-NAVIGATION-001 | 实施全局导航四层信息架构 | 首轮实现完成；验收失败待修复 | 独立实现 worker `ctx_1f7bffe87eda`；导出 `selectAuthorizedNavigationCandidates(response, scope)` 与强类型已验证作用域；模拟角色定向测试通过。验收确认作用域静态模型与普通/平台角色基本正确，但移动端切换、失败残留、面包屑、双语文案、焦点与真实权限证据未通过，待针对性修复 |
| VERIFY-GLOBAL-NAVIGATION-001 | 独立验收全局导航实现 | 首轮验收失败；待修复复验 | Orca Task `task_ad67822bb6f8` / verifier `ctx_4354e1a289ae`，`gpt-6-luna/high`，已新增 [全局导航验收报告](verification/global-navigation-acceptance.md)。聚焦模拟测试 6/6 通过；完整 build 被并行 `font-provider.tsx`/`theme-provider.tsx` TS2554 阻塞。验收结论失败，不能以静态 selector 或模拟测试替代真实权限证据 |
| FIX-GLOBAL-NAVIGATION-001 | 修复全局导航验收阻断项 | 修复完成；独立复验待执行 | Orca Task `task_cd81cb9cfdfe` / worker `ctx_6cd29da9d0c3` 完成：移动端 viewport-wide Dialog、切换后关闭 drawer 并交接焦点、失败/撤权清除旧菜单、scope breadcrumbs、窄屏祖先键盘访问和双语 switcher 文案；定向 Chromium 测试 `26/26`、`vite build`、diff check 通过。无真实授权 fixture/读屏；完整 build 未运行，复验报告需核查新 `app-header` 类型诊断 |
| REVERIFY-GLOBAL-NAVIGATION-001 | 独立复验全局导航修复 | 验收进行中 | Orca Task `task_b3579dc1f1ab` / verifier `ctx_27c47e8359eb`；只写 `docs/verification/global-navigation-reacceptance.md`，复验移动端、失败残留、面包屑、本地化、键盘焦点、完整 build 与真实权限证据边界 |
| IMPL-QUICK-NAVIGATION-001 | 按当前 scope 提供已授权的快速导航 | 首轮实现完成；验收失败待修复 | Orca Task `task_3b521168352c` 完成。实现复用 `selectAuthorizedNavigationCandidates`，仅搜索已授权导航与当前 actor 服务端确认的 Workspace 目录，最近项先经目录校验再排序，切换走 `useWorkspaceSwitch(directory)`。独立验收确认核心 selector 与目录隔离通过，但 Tenant pending/error 被 fallback 成 Global |
| VERIFY-QUICK-NAVIGATION-001 | 独立验收已授权的快速导航 | 验收失败；待修复复验 | Orca Task `task_b3a8cd625cf2` / verifier `ctx_af08a431dc18`，仅写 [快速导航验收报告](verification/quick-navigation-acceptance.md)。聚焦测试 `28/28` 通过，但 scope-label 缺陷判定整体失败；真实 API 授权、迟到响应、读屏/触屏与生产验收仍未覆盖 |
| FIX-QUICK-NAVIGATION-001 | 修复快速导航 Tenant scope 标签 | 已就绪待启动 | Orca Task `task_2507456f3463`；只允许改 `command-menu.tsx` 与最小聚焦测试，Tenant route 未确认时不得 fallback 为 Global。待全局导航复验完成后串行启动 |

### 最新复验补充（2026-11-10）

- 全局导航修复已完成，但独立复验 `task_b3579dc1f1ab` 判定失败，见 [全局导航复验报告](verification/global-navigation-reacceptance.md)：聚焦检查有通过项，但 Quick Navigation 测试未能收集，web build 报 3 个 TypeScript 错误，窄屏真实 shell 的 drawer 关闭/焦点交接仍需核验。真实 API 权限证据与读屏验收仍未完成。
- 快速导航首轮验收失败，Tenant scope 未确认时错误显示 Global；修复任务 `task_2507456f3463` 已就绪，需修正并安排独立复验。
- 设置原子提交二次复验为部分通过，缺 paired-cookie readback 最终异常的独立回归；补测任务 `task_81fe88eb84f5` 的全局导航依赖已完成，可继续执行，之后由 `task_f0fff4e05701` 独立复验。
- Workspace 恢复缓存隔离复验通过（模拟前端证据）；真实后端撤权、生产、移动端与读屏仍待验收。

### 架构演进下一步委派（2026-11-06）

先收口授权上下文的前端状态与后端错误矩阵，再根据只读代码盘点选择一个有证据的上下文作为渐进迁移试点；不预先重排全仓目录。UX 设计、实现与独立验收由不同任务承担，测试/验收任务不得修复产品实现。

| ID | 单一任务 | 状态 | Orca dispatch / 范围 |
| --- | --- | --- | --- |
| ARCH-MAP-001 | 盘点当前 API、服务、模型、schema、前端路由/feature 与候选上下文 | 完成：只读盘点 | `ctx_bd55c9baf7b8`；地图与风险证据见 [当前架构地图](architecture/current-architecture-map-2026-11-06.md)；上下文映射为待确认假设，须由产品负责人确认职责、数据归属与迁移试点 |
| ARCH-UX-001-FOLLOWUP | 对照当前实现复核授权上下文 UX 契约 | 修订已重派，待回执 | 首次 follow-up `ctx_6ed66ab347d9` 发现 malformed path Workspace ID 应归 `404 RESOURCE_NOT_FOUND` 而非 `400 CONTEXT_MISMATCH`；后续 `task_ff797bfa4476` / `ctx_322f4ecfa215` 只修订 `docs/ux/architecture-authorization-context.md` 的映射表，不改产品代码或验收 |
| ARCH-GUARD-001-REACCEPT | 对精确 `tests` 路径段回归断言及依赖守护作独立复验 | 完成：`5 passed` | `task_0105325e3749` / `ctx_22d19a96d6ff`；只读；旧 follow-up `ctx_b9d3a1fc4749` 仍未结算，但不影响本次新独立验收证据 |
| TENANCY-SEAM-001-MATRIX | 补足 adapter 状态码/错误码矩阵的独立验收证据 | 首次复验失败，无结论；待重派 | `ctx_21ea990e900f` 报告 focused pytest 120 秒无输出后中止，未改文件、未产生验收结果；后续仍需覆盖端到端 `RESOURCE_NOT_FOUND` 404，且不得改产品实现 |
| TENANCY-UX-IMPLEMENT-001 | 按已完成 UX 契约实现 Workspace 授权上下文前端状态与切换隔离 | 实现 worker 中断，无完成回执 | `ctx_f3cd826a904b` 因 Codex provider exited 中断；当前仅发现未接入的本地 WIP 文件，未作为完成实现提交；独立前端验收尚未派发 |

本批新派发均请求 Orca 使用 `gpt-6-luna` / `high`。Codex transcript 曾报告该模型的本地 metadata 未找到并使用 fallback metadata；因此记录为“请求/Orca effective 配置为 Luna/high”，不把它夸大为可独立证明的实际推理后端身份。ARCH-MAP-001 已完成；首个 context-first 存量迁移任务仍待产品负责人确认上下文责任、数据归属与试点，再依次扩展边界测试、完成试点 UX/API 契约并单切片迁移，避免无依据地搬动目录或扩大范围。

## 功能任务

> 2026-10-12 F17 附件域已完成渐进式 service 化与前端 API 收口：新增 `AttachmentService`、附件 schema 和 `src/api/attachments.ts`，保持现有 wire contract、权限矩阵、个人附件 404 隐私语义和文件补偿行为；F17a 定向 API、默认 API、compileall、build、ESLint 及 F17b 真实 Redis/Vite/Chromium 均通过。验收中修复了中文 locale 反向翻译和 Windows Vite 子进程清理；证据见 [F17 附件 Service 化方案](verification/F17-attachment-service-refactor.md)、[F17a 附件验收](verification/F17a-attachments-api.md) 和 [F17b 附件前端验收](verification/F17b-attachments-frontend.md)。

> 2026-10-12 F24b 当前主干复验：在已推送 `bfb7bf9` 上使用现有 Docker Redis `127.0.0.1:16381` 重跑真实 FastAPI/Vite/Playwright，构建和脚本均通过；错配 `agent_id` 返回 `404` 且无消息正文泄露，撤权后返回 `403`。真实模型推理、工具确认/调用、外部任务和 SSE 重连仍未验证，详见 [F24b 聊天消息验收](verification/F24b-chat-messages-frontend.md)。

> 2026-10-12 基线修复：实际当前树 `896b66a` 首次默认 API 复跑暴露 F17a Windows 瞬态 unlink 竞态（`22 passed, 1 failed, 25 deselected`）。已在附件删除路径加入有限重试，并增加确定性 FastAPI 回归；F17a 定向、F16a→F17a 连续 8 轮、默认 API、compileall、build 和 ESLint 均通过。该修复的 Redis、浏览器、多副本共享存储仍待独立验收，证据见 [F17a 附件验收](verification/F17a-attachments-api.md) 和 [基线复验报告](verification/baseline-2026-10-12.md)。

> 2026-10-12 当前版本补充：租户列表筛选、owner 选择、表格交互、邀请过期事务结果与前端国际化已实现；本轮增量已完成独立真实 API/Chromium 验收。近期差距和优先级见 [租户优化原则与差距清单](tenant-optimization-principles-and-gap-review.md)。F05/F05a/F09 历史“通过”仅适用于原报告所验版本；本轮 F09 增量现为**独立验收通过**，加载态仍未做人为延迟下的独立时序断言。F24b 的 agent/session 绑定修复已完成本机真实 API/Playwright 复验，F24b 独立验收已在 `b069adf` 记录；F25a 当前工作树已完成完整构建与真实 API/Redis/Playwright 独立验收，真实模型推理仍待后续验证。

> 2026-10-12 租户优化独立验收：筛选/计数、UTC 边界、权限隔离、owner API 落库、邀请过期 `410` 与持久化 5 项真实 API 检查通过；独立 Chromium 复验确认中英文标题/说明/状态/角色/日期/分页、错误重试、超范围页码、筛选空态、成员空态、列显隐、可访问名称和 390px 窄屏均通过。平台管理员零租户空态仍为拦截模拟，加载态未做人为延迟下的独立时序断言；详见[租户优化验收记录](verification/tenant-optimization-acceptance-2026-10-12.md)。

> 2026-10-12 F09 租户列表修复后，主代理诊断与随后独立子智能体验收均使用隔离临时数据和真实 FastAPI/Vite/Chromium；独立验收结果已覆盖真实 API 和核心浏览器路径，平台管理员零租户空态仍明确标为模拟。Redis 标记套件最新复跑使用临时 Redis 7.4.11，结果 `8 passed, 5 failed`；失败测试存在迁移版本、当前 API 契约和本机 `.env` 隔离等差异，详见[Redis suite 复跑记录](verification/redis-suite-2026-10-12.md)。

> 2026-10-12 F12a 租户角色后端完成渐进式 service 化：新增角色 schema/service，router 只保留依赖、参数、响应模型和状态码；独立验收确认现有 wire contract、跨租户隔离、权限版本、搜索转义和请求级 rollback 均通过。F12c 成员角色分配功能回归通过，但其 router 仍保留旧的显式事务实现，后续单独迁移，不在本次提交内混改。

> 2026-10-12 F12c 租户成员自定义角色分配完成渐进式 service 化：新增 schema/service，保留原有赋权、替换、撤销、幂等、并发和 `membership_version` 行为；F12c 与 F12a 联合回归、compileall 及 router/service 边界扫描通过。前端 wire contract 未变，因此本项无新增 UX 范围；证据见 [F12c service 化验收](verification/F12c-tenant-member-role-service-refactor.md)。

> 2026-10-12 F13a 租户菜单管理与 F13d1 可见菜单树完成渐进式 service 化：新增菜单 schema/service，router 只保留 HTTP 关注点；F13a/F13d1 定向回归、默认 API 套件、compileall、build、ESLint 和 router/service 边界扫描通过。F13c 角色-菜单授权未混入本次改动；证据见 [F13a service 化验收](verification/F13a-tenant-menu-service-refactor.md)。

> 2026-10-12 F13c 租户角色-菜单授权完成渐进式 service 化：新增 schema/service，保留原有权限、租户隔离、历史失效关联读取、幂等版本递增、并发替换和复合外键行为；定向回归、默认 API 套件、compileall、build、ESLint 及 router/service 边界扫描通过。使用独立 Docker Redis `redis:7-alpine`（本机 `16381`）复跑 F24b 真实 API/Vite/Chromium 流程，结果通过；F13c 本身不依赖 Redis。证据见 [F13c service 化验收](verification/F13c-tenant-role-menu-service-refactor.md)。

> 2026-10-12 F14a 租户部门完成渐进式 service 化：新增部门 schema/service，保留原有租户隔离、部门树递归、祖先刷新、父节点状态、循环检测、重排和软删除行为；F14a 定向 API、F14b 真实 API/Vite/Chromium、默认 API 套件、compileall、build、ESLint 和 router/service 边界扫描通过。F14b Windows runner 的 pnpm/路径/子进程/SQLite 清理修复已单独提交 `21a38a1`；证据见 [F14a service 化验收](verification/F14a-tenant-department-service-refactor.md)。

> 2026-10-12 F15a 租户字典完成渐进式 service 化：新增字典 schema/service，保留原有类型/条目 CRUD、分页筛选、排序、唯一冲突、类型级联删除保护、复合外键、权限和跨租户隔离；F15a 定向 API、F15b 真实 API/Vite/Chromium、compileall、Redis 连通性和 router/service 边界扫描通过。F15b Windows runner 的 pnpm/子进程/日志句柄/SQLite engine 清理问题已一并修复；证据见 [F15a 字典 service 化验收](verification/F15a-tenant-dictionary-service-refactor.md)。

> 2026-10-12 F16a/F16b 租户参数配置完成渐进式 service 化与类型化前端 API 收口：新增参数配置 schema/service 和 `src/api/tenant-configs.ts`，router 不再承载业务规则、HTTP 异常或显式事务；原有租户隔离、owner/admin 权限、public 投影、敏感值脱敏、详情 no-store、同租户唯一键冲突和字符串 ID 契约保持不变。F16a 定向 API `1 passed`，默认 API 套件 `23 passed, 25 deselected`，compileall、build、ESLint 和边界扫描通过；使用当前 Docker Redis `127.0.0.1:16381` 的真实 FastAPI/Vite/Playwright F16b 通过。UX 审查指出的 URL 状态、错误重试、并发版本、dialog 焦点、窄屏操作和完整双语列为后续独立功能点；证据见 [F16a service 化方案](verification/F16a-tenant-config-service-refactor.md)。

> 2026-10-12 F19c 系统任务手工触发完成 service/API 与前端 API 收口，并通过独立验收：新增 `ManualScheduledTaskService`、运行记录 response schema 和 `src/api/scheduled-tasks.ts`；保持 `POST /tenants/{tenant_id}/scheduled-tasks/{task_id}/runs`、`201`、`TASK_UNAVAILABLE`、`TASK_ALREADY_RUNNING`、安全错误码及租户隔离契约。F19c API `1 passed`，默认 API 套件 `24 passed, 26 deselected`，真实 Vite/Playwright `1 passed`，build、compileall 和 ESLint 通过；浏览器覆盖双击单请求、响应丢失、权限、lease、失败脱敏、租户切换、撤权、窄屏键盘和中英文。证据见 [F19c service/API 收口方案](verification/F19c-manual-task-trigger-service-refactor.md)。相邻 F19a 迁移 fixture 已在独立提交 `7e9da42` 修正，当前 Docker Redis 定向测试 `1 passed`。

> 2026-10-12 新增 UX 门槛：每个后续功能点先由独立 UX 子智能体审查主流程、失败/权限/窄屏/可访问性，再由实现子智能体开发，最后另行独立验收。租户批量启停方案已记入上述差距清单并完成 F09b 独立验收；正式导航仍需后续范围清理。F19c2 方案见 [手工触发 UX 与契约检查](ux/F19c2-manual-task-trigger.md)，其代码已写且当前 TypeScript 编译通过，仍待独立验收；设计与编译结论不能替代功能验收。

> 2026-10-12 F11/F11a 增量复核：UX 与 API/服务子智能体审查完成，差距与待决策见 [全局用户管理复核](ux/F11a-global-users-review.md)。`%`/`_` 搜索匹配、用户页确认、结构化字段错误和双语反馈的代码已写，TypeScript 编译通过，待独立验收。软删身份复用、最后平台管理员保护和筛选范围仍待产品决定；历史验收不能覆盖本次增量。

> 2026-10-12 F12 增量复核：角色 UX 审查见 [租户角色与成员分配复核](ux/F12-tenant-roles-review.md)。列表 URL 状态、无匹配空态、停用/软删与历史菜单授权确认、内置成员保护原因、权限版本缓存键和搜索通配符修复已写，TypeScript/Python 静态检查通过；独立静态复核已完成，真实浏览器/API 验收仍待做，英文模式 API 错误与读屏行操作仍待核。历史 F12 验收不覆盖本次增量。

> 2026-10-12 基线验证（起点 `38bbf24`）：API 默认套件 `23 passed, 25 deselected, 37 warnings`、`compileall app`、前端 `pnpm build` 通过。首次全量 ESLint 发现 29 个 error；修复后 `pnpm exec eslint .` 退出码为 0（仍有 24 个 warning）。验证过程中发现并单独提交/推送 F17a Windows 并发 unlink 修复（`4d926bf`）；新竞态修复仍待独立复验。

> 2026-10-12 当前树基线复验（基于 `4d926bf`，包含当时工作树中未提交的前端 lint 整改）：API 默认套件 `23 passed, 25 deselected, 37 warnings`、`compileall app`、`pnpm build` 均通过；`pnpm exec eslint .` 退出码为 0，仍有 24 个 warning。详见[基线复验报告](verification/baseline-2026-10-12.md)。该记录不代表 P0 浏览器/API 独立验收已完成。

> 2026-10-12 当前 HEAD 基线复跑：`git fetch origin` 后本地 `main` 与 `origin/main` 均为 `7da1eca`，运行前工作区干净。API 默认套件 `23 passed, 25 deselected, 37 warnings`、`compileall app`、`pnpm build` 通过；`pnpm exec eslint .` 退出码为 0（0 errors、24 warnings）。本次验证没有进行浏览器或独立功能验收，P0 项仍待处理；详见[基线复验报告](verification/baseline-2026-10-12.md)。

> 2026-10-12 `b069adf` 文档更新后基线复跑：工作区干净；API 默认套件 `23 passed, 25 deselected, 37 warnings`、`compileall app`、`pnpm build` 均通过；`pnpm exec eslint .` 退出码为 0（0 errors、24 warnings）。F24b 已完成独立真实 API/Redis/Playwright 验收；近期租户优化仍待独立验收。

> 2026-10-12 当前工作树基线复跑：实际 `HEAD` 与 `origin/main` 为 `704a477`，不是接续提示所列的 `38bbf24`；工作区已有租户列表 UX/i18n 未提交改动，未清理。API 默认套件 `23 passed, 25 deselected, 37 warnings`、`compileall app`、`pnpm build` 通过；ESLint `0 errors, 24 warnings`。这是当前脏工作树的验证，不代表干净提交基线；详见[基线复验报告](verification/baseline-2026-10-12.md)。F24b 当前工作树复跑通过；F09 增量仍待独立验收。

| ID | 单一任务 | 状态 | 开发/设计智能体 | 独立验证与证据 |
| --- | --- | --- | --- | --- |
| F01 | shadcn-admin 前端基础与品牌 | 基础通过 | web_foundation | verification/F01-web-foundation.md：构建、品牌、桌面/移动浏览器渲染通过；仍含待替换模板业务 |
| F02 | FastAPI、配置和数据库基础 | 基础通过 | api_foundation | verification/F02-api-foundation.md；暂无业务migration，后续补入 |
| F03 | 租户与空间数据/API契约 | 通过 | tenancy_design | verification/F03-tenancy-contract.md；实现需落实事务与空间owner关联 |
| F04 | 全局账号与登录后端 | 通过 | auth_backend | verification/F04-auth-backend.md；认证与CLI/Alembic初始化独立复验通过 |
| F05 | 租户及租户成员后端 | 通过（邀请另列） | tenant_backend | verification/F05-tenant-backend.md；新增platform/tenants独立复验通过；邀请另列F05a |
| F05a | 租户邀请链接与接受流程后端 | 通过 | auth_backend；agent_embedding_design修复 | verification/F05a-tenant-invites.md：2 passed；一次性接受与归属独立复验通过 |
| F05c | 租户邀请链接前端与接受页 | 通过 | agent_embedding_design | verification/F05c-tenant-invite-frontend.md：build、真实API、Playwright邀请流程通过 |
| F05d | 受邀请新用户注册后端 | 通过 | agent_embedding_design | verification/F05d-tenant-invite-registration.md：1 passed；待前端接入另列F05e |
| F05e | 邀请注册前端接入 | 通过 | agent_embedding_design | verification/F05c-tenant-invite-frontend.md：新邮箱注册、加入租户、token清除与重放拒绝通过 |
| F05b | 普通租户列表跨页筛选 | 通过 | tenant_backend | verification/F09-tenant-frontend.md；跨页/状态/越权过滤与UI独立复验通过 |
| F06 | Workspace 及空间成员后端 | 通过 | workspace_backend | verification/F06-workspace-backend.md；临时库真实API的空间权限、切换上下文、成员和撤权独立验证通过 |
| F06b | 归档 Workspace 管理列表 | 通过 | tenant_backend | verification/F06b-archived-workspace.md；归档发现、范围、撤权与计数独立验证通过 |
| F07 | 作用域权限与资源隔离基础 | 通过 | verify_tenant_backend | verification/F07-resource-scopes.md：1 passed；多租户/空间/私有scope、撤权、归档及权限边界独立复验 |
| F08 | 真实登录与个人中心前端 | 通过 | web_auth | verification/F08-web-auth.md；默认代理连接真实API，构建和13项浏览器流程通过 |
| F09 | 租户管理前端 | 通过（本轮增量独立验收通过） | tenant_frontend | verification/F09-tenant-frontend.md 与 verification/tenant-optimization-acceptance-2026-10-12.md；真实 API/Chromium 覆盖筛选计数、UTC 边界、权限、owner、邀请 410、双语交互和窄屏 |
| F09b | 租户列表批量启用/停用 | 独立验收通过 | tenant_batch_ux；tenant_batch_impl | verification/F09b-tenant-batch-actions.md：真实 API/Chromium 验证权限、逐项 PATCH、确认、进度锁定、部分失败/重试、英文、390px 与跨页清空选择；部分失败 UI 使用明确标注的 403 拦截模拟，真实 404 已验证 |
| F10 | Workspace 管理与左上角切换 | 通过 | workspace_backend | verification/F10-workspace-frontend.md；构建及真实API浏览器流程通过，含跨租户回退与撤权后缓存清理 |
| F11 | 全局用户管理后端迁移 | 通过 | agent_embedding_design | verification/F11-user-management-api.md；1 passed，权限、CRUD、JWT撤销、bcrypt兼容与软删独立复验 |
| F11a | 全局用户管理前端迁移 | 通过 | workspace_backend | verification/F11a-user-management-frontend.md：build、真实API浏览器CRUD及权限通过；旧Clerk演示Faker清理另列F43 |
| F12a | 角色管理后端迁移 | 通过（service 化独立验收通过） | agent_embedding_design | verification/F12a-tenant-role-api.md 与 verification/F12a-tenant-role-service-refactor.md：真实 API、wire contract、跨租户隔离、搜索转义、请求级 rollback 和 router/service 边界通过 |
| F12b | 角色管理前端迁移 | 通过 | agent_embedding_design | verification/F12b-tenant-role-frontend.md：Outlet修复后build、真实API浏览器CRUD/权限/缓存复验通过 |
| F12c | 租户角色分配给成员后端 | 通过（service 化独立验收通过） | agent_embedding_design | verification/F12c-member-role-assignment.md 与 verification/F12c-tenant-member-role-service-refactor.md：功能 API、权限、版本、并发、跨租户复合FK及 router/service 事务边界通过 |
| F12d | 租户成员角色分配前端 | 通过 | agent_embedding_design | verification/F12d-member-role-frontend.md：build、真实API浏览器分配/撤销、租户缓存隔离通过 |
| F12e | 普通成员查看自身自定义角色 | 通过 | verify_tenant_backend | verification/F12e-self-role-view.md：build、API和浏览器自读/跨租户隔离/撤权复验通过 |
| F13a | 菜单管理后端迁移 | 通过（service 化独立验收通过） | agent_embedding_design | verification/F13a-tenant-menu-api.md 与 verification/F13a-tenant-menu-service-refactor.md：树 CRUD、排序、跨租户父级复合FK、权限、可见树和 router/service 边界通过 |
| F13b | 租户菜单管理前端 | 通过 | agent_embedding_design | verification/F13b-tenant-menu-frontend.md：build、真实API浏览器树CRUD/排序/权限/租户隔离通过 |
| F13c | 菜单与角色授权后端 | 通过（service 化独立验收通过） | agent_embedding_design | verification/F13c-role-menu-api.md 与 verification/F13c-tenant-role-menu-service-refactor.md：ID序列化、幂等版本、并发、复合FK及 router/service 事务边界通过 |
| F13e | 菜单与角色授权前端 | 通过 | agent_embedding_design | verification/F13e-role-menu-frontend.md：build、真实API浏览器授权保存/历史项/权限/租户缓存通过 |
| F13d1 | 当前成员可见菜单树后端 | 通过 | agent_embedding_design | verification/F13d1-visible-menu-tree.md：1 passed；角色授权、父级过滤、撤权和no-store通过 |
| F13d2 | 租户动态侧栏导航前端 | 通过 | agent_embedding_design | verification/F13d2-dynamic-sidebar.md：build、跨租户/空间/角色/撤权/晚到请求真实API浏览器验收通过 |
| F14a | 部门管理后端迁移 | 通过（service 化独立验收通过） | agent_embedding_design | verification/F14a-tenant-department-api.md 与 verification/F14a-tenant-department-service-refactor.md：树CRUD、隔离、祖先刷新、复合FK及 router/service 事务边界通过 |
| F14b | 部门管理前端迁移 | 通过（当前 service 化后复验通过） | agent_embedding_design | verification/F14b-tenant-department-frontend.md 与 verification/F14a-tenant-department-service-refactor.md：真实 API/Vite/Chromium 树CRUD/移动/排序/隔离通过 |
| F15a | 字典管理后端迁移 | 通过（service 化独立验收通过） | agent_embedding_design | verification/F15a-tenant-dictionary-api.md 与 verification/F15a-tenant-dictionary-service-refactor.md：定向 API、迁移、租户隔离、CRUD、权限、复合FK、compileall 和 router/service 边界通过 |
| F15b | 字典管理前端迁移 | 通过（service 化后复验通过） | verify_tenant_backend | verification/F15b-tenant-dictionary-frontend.md 与 verification/F15a-tenant-dictionary-service-refactor.md：真实 API/Vite/Chromium CRUD、筛选、排序、隔离和 Redis 环境复验通过 |
| F16a | 参数配置后端迁移 | 通过（service 化独立复验通过） | agent_embedding_design | verification/F16a-tenant-config-api.md 与 verification/F16a-tenant-config-service-refactor.md：1 passed；迁移、租户隔离、权限、敏感值边界、router/service 事务边界通过 |
| F16b | 参数配置前端迁移 | 通过（service 化后真实 Redis 复验通过） | agent_embedding_design | verification/F16b-tenant-config-frontend.md：build、真实 API/Vite/Chromium CRUD、敏感值延迟响应、租户切换隔离和当前 Redis `16381` 环境通过 |
| F17a | 附件管理本地存储后端 | 通过（service 化独立验收通过） | verify_tenant_backend | verification/F17-attachment-service-refactor.md 与 verification/F17a-attachments-api.md：AttachmentService、请求级事务补偿、文件校验、并发删除、权限隔离、定向 API、默认 API 和 compileall 通过 |
| F17b | 附件管理前端 | 通过（service 化后真实 Redis/Chromium 复验通过） | verify_tenant_backend | verification/F17b-attachments-frontend.md：类型化附件 API、URL scope/page、错误重试、AlertDialog、权限/撤权/租户切换、真实 Redis/Vite/Playwright 通过；ESLint 0 errors、24 warnings |
| F17c | S3-compatible 附件存储与本地迁移 | 后端实现、定向测试、独立验收及共享 RustFS 远端健康/网络复查通过；UX/运维体验、真实 S3 CRUD、生产 Bucket、API 切换与附件迁移仍待完成 | verify_tenant_backend | verification/F17c-attachment-s3-storage.md：自动化 S3 使用内存替身；Tabby MCP 复核到 infra-rustfs healthy、infra_backend internal、Console health 200；认证对象读写与生产迁移未验证 |
| F18a | 系统任务定义后端迁移 | 通过 | verify_tenant_backend | verification/F18a-scheduled-task-definition.md：修复后1 passed，计划校验422且无写入、隔离、目标allowlist与迁移通过 |
| F18b1 | 过期租户邀请任务目标 | 通过 | verify_tenant_backend | verification/F18b1-expire-invitations.md：1 passed，租户过滤、到期边界及重复/并发幂等通过 |
| F18b2a | 系统任务内部目标分发 | 通过 | verify_tenant_backend | verification/F18b2a-task-dispatcher.md：1 passed，三个真实目标与跨租户/参数拒绝通过 |
| F18b2b | 系统任务持久化到期claim | 通过 | verify_tenant_backend | verification/F18b2b-scheduler-claims.md：1 passed，双worker单槽claim、lease恢复与持久状态通过 |
| F18b2c | 系统任务时钟循环与触发 | 通过（跨进程待终验） | verify_tenant_backend | verification/F18b2c-scheduler-runtime.md：1 passed，双lifespan单槽执行/失败重试/租约恢复/停机通过；at-least-once边界已记 |
| F18b3 | 附件元数据核对任务目标 | 通过 | verify_tenant_backend | verification/F18b3-attachment-reconcile.md：1 passed；异常分类与租户只读隔离通过 |
| F18b4 | 租户资源摘要刷新任务目标 | 通过 | verify_tenant_backend | verification/F18b4-resource-summary.md：1 passed，双租户计数、并发UPSERT与变更覆盖通过 |
| F18c | 系统任务管理前端 | 通过 | verify_tenant_backend | verification/F18c-scheduled-task-frontend.md：build、真实API浏览器Cron/interval CRUD/权限/隔离通过 |
| F19a | 系统任务执行记录后端 | 通过 | verify_tenant_backend | verification/F19a-scheduled-task-runs.md：1 passed，0014→0015→0016迁移、租户API权限/脱敏与复合FK通过 |
| F19b | 系统任务执行记录前端 | 通过 | verify_tenant_backend | verification/F19b-task-runs-frontend.md：build、真实API浏览器分页筛选/脱敏/权限通过 |
| F19c1 | 系统任务手工触发API | 通过（service 化独立验收通过） | workspace_backend | verification/F19c-manual-task-trigger-service-refactor.md：owner/admin、member/跨租户、停用/lease、失败脱敏、run 持久化和事务边界通过 |
| F19c2 | 系统任务手工触发前端 | 通过（真实浏览器独立验收通过） | manual_task_ux；manual_task_impl | verification/F19c-manual-task-trigger-service-refactor.md：类型化 API 收口、双击、响应丢失、租户切换、撤权、窄屏键盘和中英文通过；同步无幂等接口的人工重试风险仍是契约限制 |
| F20b | AgentScope 应用内嵌与生命周期 | 通过 | agent_embedding_design | verification/F20b-agentscope-embed.md：真实依赖、Redis、同端口JWT与父子lifespan独立验收通过；F21隔离另列 |
| F20a | AgentScope 内嵌技术契约 | 静态核验完成 | agent_embedding_design | verification/F20a-embedding-contract.md；运行兼容与隔离仍待F20/F21 |
| F21a | AgentScope 租户/Workspace身份网关 | 通过 | agent_embedding_design | verification/F21a-agentscope-gateway.md：真实Redis/同进程下105入口鉴权、撤权/归档与SSE/WS短路通过 |
| F21b1 | AgentScope会话与消息存储隔离 | 通过 | agent_embedding_design | verification/F21b1-session-isolation.md：真实API/Redis双租户多Workspace/多actor会话消息隔离通过；模型推理待后续 |
| F21b2a | AgentScope工作目录与文件路径隔离 | 通过 | agent_embedding_design | verification/F21b2a-workdir-isolation.md：原工具测试+真实Redis/网关7 passed，跨scope/路径逃逸拒绝 |
| F21b2b1 | AgentScope智能体定义资源隔离 | 通过 | agent_embedding_design | verification/F21b2b1-agent-resource-isolation.md及F23a1-agent-detail.md：真实Redis网关CRUD/list/detail/session隔离通过 |
| F21b2b2 | AgentScope知识库与文档元数据隔离 | 元数据通过（路由/索引待F29） | agent_embedding_design | verification/F21b2b2-kb-metadata-isolation.md：Redis代理2 passed；KB路由无manager为503，索引未验 |
| F21b2b3 | AgentScope MCP配置资源隔离 | 元数据通过（外部连接待验） | agent_embedding_design | verification/F21b2b3-mcp-isolation.md：真实Redis/网关2 passed；外部MCP握手/工具调用及detail路由待补 |
| F21b2b4 | AgentScope Skills资源隔离 | 通过（Hub未验） | agent_embedding_design | verification/F21b2b4-skills-isolation.md：真实Redis/网关2 passed，安全安装/列表/跨actor隔离通过；Hub未配置 |
| F21b2b5 | AgentScope 模型凭据资源隔离 | 通过（旧数据迁移/真实模型待验） | agent_embedding_design | verification/F21b2b5-model-credential-isolation.md：1 passed，新记录加密、跨scope与日志脱敏通过；旧未作用域记录与provider调用待后续 |
| F22 | AI 存储、工作目录与记忆持久化 | 待开始 | — | — |
| F23a1 | 智能体详情读取API | 通过 | agent_embedding_design | verification/F23a1-agent-detail.md：1 passed，真实Redis网关详情与跨scope ID拒绝通过 |
| F23a2 | 智能体管理前端融合 | 通过（只读分支待验） | agent_embedding_design | verification/F23a2-agent-management-frontend.md：build/真实API浏览器CRUD及scope隔离通过；上游editable恒true，只读分支无数据路径 |
| F21c | AgentScope SSE流鉴权上下文 | 通过（模型推理待验） | agent_embedding_design | verification/F21c-sse-auth-context.md：真实Redis SSE事件、上下文、断连与越权拒绝1 passed；无provider推理 |
| F24a | 会话管理前端融合 | 通过 | agent_embedding_design | verification/F24a-session-management-frontend.md：build、真实API/Redis浏览器CRUD、跨空间和只读状态通过 |
| F24c | 会话状态agent_id一致性 | 通过 | verify_tenant_backend | verification/F24c-session-status-agent-binding.md：真实Redis网关错配/跨scope 404且不探测run-lock |
| F24b | 基础聊天消息前端融合 | 独立验收通过（真实模型推理除外） | agent_embedding_design | verification/F24b-chat-messages-frontend.md：独立真实 API/Redis/Playwright 验收确认错配 `agent_id` 返回 404 且无消息正文；消息分页、附件、失败保留草稿/重试、Workspace/会话切换与撤权流程通过；真实模型推理未配置凭据，工具/SSE 重连不属于本项 |
| F25a | SSE文本增量展示 | 独立验收通过（真实模型推理除外） | agent_embedding_design | verification/F25a-sse-text-frontend.md：真实 API/Redis/Vite/Chromium 覆盖增量、replay 去重、会话/Workspace 隔离、403/404 清理；`pnpm build` 通过，真实模型推理待验 |
| F25b1 | 聊天生成中断 | 独立验收通过（真实模型/worker停驻除外） | agent_embedding_design | verification/f25b1-interrupt.md：真实 API/Redis/Chromium 覆盖 202 中断、重复点击、状态收敛、错误 agent/session；parked 状态为前端投影 |
| F25b2 | 工具执行事件展示 | 独立验收通过（真实工具/模型执行除外） | agent_embedding_design | verification/f25b2-tool-events.md：真实 FastAPI/Redis SSE/Vite/Chromium 覆盖历史与实时工具时间线、增量、错误、脱敏、二进制降级 |
| F26a | 工具权限确认前端 | 独立验收通过（真实 worker/model resume 除外） | agent_embedding_design | verification/f26a-tool-permission.md：真实 fixture/SSE 覆盖 asking 展示、重复去重、允许/拒绝、409反馈、刷新恢复；真实 HITL resume 未覆盖 |
| F26b | 外部结果人工介入前端 | 独立验收通过（UI；后台 resume 待修复） | agent_embedding_design | verification/F26b-external-result-frontend.md：初次 textarea 状态缺陷已修复；复验覆盖首次输入、成功提交、409/503、取消、隔离和撤权；WakeupDispatcher scope context 后端风险另列 |
| F26b-backend | AgentScope WakeupDispatcher WorkspaceContext 安全传播与后台恢复 | 实现中（A/B 验收通过；C 级待实际验收） | — | [WakeupDispatcher WorkspaceContext 安全传播方案](architecture/agentscope-wakeup-workspace-context.md) 与 [F26b-backend 复验](verification/F26b-wakeup-workspace-context-reacceptance-20261013.md)：scoped trigger、消费前 DB 重验、ContextVar 生命周期、spawn 失败回滚、consuming lease CAS 恢复、bounded 512 条启动恢复索引和幂等/retry 已实现；聚焦测试 `12 passed`，A/B 级真实 Redis/SQLite/HTTP 边界通过，C 级真实 AgentScope model/tool 后台执行仍待验收 |
| F27a | 子智能体团队与任务只读面板 | 独立验收通过（真实模型/编排 worker 除外） | agent_team_frontend | verification/F27a-team-panel.md：初次事件刷新缺口已修复；复验覆盖 1/3→2/3 进度、团队/空态、跨 Workspace、第二 actor 和撤权 |
| F27b-design | 子智能体团队编排与执行控制 UX/API 设计 | 设计完成 | — | [F27b 子智能体团队编排与执行控制 UX/API 方案](ux/F27b-team-orchestration.md)：已明确首期范围、权限、API、状态机、SSE、错误恢复、可访问性和分期验收条件 |
| F27b | 子智能体团队编排与执行控制实现 | 控制面 Phase 1 复验通过；真实 worker/model 执行未接入 | — | [F27b 复验](verification/F27b-team-orchestration-reacceptance-20261013.md)：agent 归属校验、创建/更新授权、创建者保护、任务依赖闭包、幂等启动、`interrupt_requested` 非终态语义、tenant/workspace 复合外键和数据库级单 active run 约束通过；聚焦测试 `6 passed`，全新 Alembic `0001 -> 0018` 升级通过；当前边界为 `durable_control_only`，真实团队 worker、AgentScope session/model 执行仍待接入 |
| F28 | 知识库管理融合 | 待开始 | — | — |
| F29 | 知识库文档、索引与检索融合 | 待开始 | — | — |
| F30 | MCP 资源与工作空间配置融合 | 待开始 | — | — |
| F31 | Skills 资源与工作空间配置融合 | 待开始 | — | — |
| F32 | 模型与凭据管理融合 | Phase 1 控制面复验通过；runtime/provider 待接入 | model_provider_design | [F32 复验](verification/F32-model-provider-custom-model-reacceptance-20261013.md) 与 [模型提供商/自定义模型方案](architecture/f32-model-provider-custom-model-plan.md)：provider registry、凭据敏感字段拒绝、引用删除保护、membership-version 缓存隔离和 DNS 解析失败 fail-closed 通过；聚焦测试 `4 passed`，开发环境 localhost 仍允许；AgentScope runtime model binding 与真实 provider connection 仍待接入 |
| F33 | AI 定时任务融合 | 待开始 | — | — |
| F34 | 渠道配置和账号绑定融合 | 待开始 | — | — |
| F35 | 工作空间文件交互融合 | 待开始 | — | — |
| F36 | SOP 后端适配与鉴权 | 待开始 | — | — |
| F37 | 人脸库管理迁移 | 待开始 | — | — |
| F38 | 人脸人员与图片管理迁移 | 待开始 | — | — |
| F39 | 人脸识别引擎和检测/比对/搜索 | 待开始 | — | — |
| F40 | 人脸账号绑定与登录 | 待开始 | — | — |
| F41 | 本地启动与持久化部署配置 | 共享基础设施与 Wiki.js 生产部署完成；本地启动手册待补 | — | 腾讯云 2 已切换 PostgreSQL 18.6 + pgvector 0.8.7（新卷，PG16 旧卷保留）；Wiki.js 使用共享库 `wikijs`、专用最小权限角色与 `infra_wiki_db` 隔离网络，监听 `127.0.0.1:18080`；Glances 留在共享基础设施。迁移前/后备份、HTTP/健康与 Compose 证据见 [基础设施迁移验收](verification/infrastructure-migration-2026-11-09.md) |
| F42 | 初始化数据与旧数据迁移工具 | 待开始 | — | — |
| F43 | 范围清理与来源许可证记录 | 二次复验失败；针对性修复中 | 实现 `ctx_5e1b8acea403` / 修复 `task_a1f9fa471d9d` / 复验 `task_5a2ef7921368` / 二次修复 `task_4371bdcd75be` | 未知 `/clerk/*` 应用级 404、兼容别名、旧路由 404 与聚焦测试通过；复验失败于旧 Apps/Chats/Connected 等模板词条残留及中文 `html lang=en`。生产深链/HTTP 状态、真实认证、完整读屏和许可证边界仍未验证；详见 [复验报告](verification/F43-route-cleanup-reacceptance.md) |
| F44 | 首页真实业务概览替换模板指标 | 第一阶段修复与自动化 UI 补测完成；整体 UX/真实后端验收仍待完成 | `ctx_579c7e7adf77` / 修复 `ctx_5921a14e74de` / 复验 `ctx_0bf5d0f02ed5` / 补测 `ctx_261caf2096e4` | 部分目录保留修复有定向测试和独立 UI/API 证据；补测中的 Workspace-only 失败、archived-only、运行时英文、320/390px 与键盘 10/10 通过。整体仍未通过：真实账号/服务端权限及受保护路由端到端、屏幕阅读器、人工移动/生产验收未覆盖；overview API 与真实指标不在第一阶段范围。详见 [F44 首验](verification/F44-workspace-home-acceptance.md)、[复验](verification/F44-workspace-home-reacceptance.md)、[补充复验](verification/F44-workspace-home-reacceptance-supplement.md) |

## 最终独立验收任务（每行独立委派）

- A01：前端构建、路由、导航及主要页面浏览器验收。
- A02：租户/空间/角色隔离，包含跨空间资源 ID、个人私有资源。
- A03：Workspace 切换、缓存与延迟响应、权限撤销行为。
- A04：系统管理功能逐项集成核对；发现缺口拆分为独立修复任务。
- A05：AI 聊天、流式中断和人工确认的端到端核对。
- A06：知识库、MCP、Skills、凭据与文件的集成核对。
- A07：系统任务及 AI 任务持久化和重复调度检查。
- A08：渠道绑定与运行；实际凭据不足必须记录未验证项。
- A09：人脸功能实际 SDK 环境验收。
- A10：重启恢复及启动文档可复现性。
- A11：排除模块、路由、依赖和初始化数据范围核对。
- A12：按 integration-plan.md 逐项审计，证据完整才可宣告全部完成。

运行凭据、模型 API、渠道账号和人脸 SDK 的缺失必须作为真实依赖记录，模拟接口通过不可替代实际验收。

## 登录页视觉更新（2026-10-06）

按用户截图实现双栏登录页、生成的人物插画、中文表单、响应式布局和减少动态效果支持。前端构建与登录相关 ESLint 通过；独立浏览器验收覆盖桌面/手机、标签关联、空提交、显隐、记住账号、错误/加载反馈及说明对话框。模拟登录验证请求字段、存储和导航，未重验真实后端登录。证据见 [登录页验收](verification/login-redesign.md)，素材来源与提示词见 [设计实现说明](login-design.md)。

同时修复聊天确认提交中 controller 未定义的构建阻断，当前 pnpm build 通过；聊天确认取消行为和 F24b 的消息接口参数边界仍需各自独立验收。F25a 已完成独立真实 API/Redis/Playwright 验收，但真实模型推理仍不在本次证据范围内。

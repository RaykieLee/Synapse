# Synapse 开发与独立验收台账

目标：完成 integration-plan.md 全部明确范围。租户与 Workspace 为所有业务迁移的前置条件。

用户要求：子智能体全部使用 gpt-6-luna / medium；每个任务只做一个功能或一个验证；每项验证由独立子智能体执行。主智能体负责协调、契约和进度记录。开发完成不等于验收通过。

状态：待开始 → 开发中 → 待独立验收 → 通过；验证失败转回修复。外部运行条件不足的功能记为待实际验收，不记为通过。

> 2026-11-19 前端架构 8 项优化完成实现与独立验收闭环：1 OpenAPI 契约生成通过（限已生成 users/tenants/workspaces 类型，其余手写模块与部分约束待迁移）；2 模板/Clerk/Faker 清理通过二次复验（真实 Dashboard API、390px、键盘与真实读屏未验）；3 Workspace 路由数据流通过独立复验（mocked API 下单次 GET、scope 隔离、错误隐私回退与受控后台 403；真实撤权/自然 stale 未验）；4 权限 capability 指定迁移通过复验（作用域不继承、45 focused tests；tenant member 名册与 tenant admin 细分契约待确认，范围外 member-table owner 选项保留）；5 QueryKeys 最终复验通过指定范围（full shell 首屏 detail GET 1 次、scope/prefix 隔离；未列目录与真实 API/权限未全量审计）；6 i18n 模块化与 Dashboard 词条修复通过复验（37 个方向 lookup 回归保护；生产行为未验）；7 共享会话状态机核心 fail-closed 修复通过复验（19 tests；Workspace Sessions 页面专项、真实 API/SSE、服务端授权与页面级 lint 仍待后续，整体 PARTIAL）；8 核心复杂页面测试指定 10 tests 通过但整体 PARTIAL（目录错误态误显示为空态、actor/服务端撤权断言缺口）。8 项报告均在 `docs/verification/`；本闭环不宣称全量前端迁移、生产验收或全项目质量完成。

> 2026-11-19 会话 reducer fail-closed 修复：`SessionMachineAction.scopeKey` 改为必需字段，reducer 在所有 action（包括 `session/switch`）处理前比对当前状态作用域，缺失或不匹配时保持原 state。新增覆盖 actor、tenant、workspace、membership version、agent、session、workspace status 七个维度的动态隔离测试，并覆盖缺失 key 与 stale switch；未改 API、权限、QueryKeys 或既有状态迁移。`pnpm exec vitest run src/features/agentscope-chat/session-state.test.ts src/features/agentscope-chat/page.test.tsx --browser.headless`：19 passed；`pnpm exec tsc -b --pretty false`、scoped ESLint 与 `git diff --check` 均通过，diff check 仅提示其他既有文件 CRLF→LF 规范化，无 whitespace error。真实 API/SSE、服务端授权及 Workspace Sessions 页面/UX 独立验收仍待验证。

> 2026-11-19 前端架构优化 7/8 主工作树续迁移：在保留主工作树已有 QueryKeys/query-scope 与会话编辑权限变更的前提下，将 AgentScope Chat 与 Workspace Sessions 接入共享纯 TypeScript session reducer；当前消息、附件和运行状态查询继续使用原有作用域 key，HTTP wire contract、路由与服务端授权边界未改。状态机与 AgentScope Chat focused 浏览器测试共 `11 passed`（7 reducer、4 页面 fixture）；`pnpm exec tsc -b` 与 `git diff --check` 通过；未发现 Workspace Sessions 页面专项测试。diff 检查另提示既有 `features/tasks/data/tasks.ts` CRLF→LF 转换警告，不是空白错误。真实登录态 API/SSE、独立 UX 审阅、独立功能验收及验收后的复验仍待安排。

> 2026-11-19 前端权限 capability 模型主 worktree 合并续迁移（4/8）：已将 app-sidebar、Workspace 目录/设置/成员、模型凭据、团队和附件，以及租户配置/部门/字典/菜单/角色/计划任务子页的当前操作者判断接入 `getPermissionCapabilities`，并保留主 worktree 已有的统一 QueryKeys、Workspace context、API/OpenAPI、Dashboard、会话状态机和测试改动；未修改服务端授权、API 契约、i18n 或目标成员角色约束。`pnpm exec vitest run src/lib/permissions.test.ts --browser.headless` 14 passed（退出码 0）；指定的 models/teams focused command 退出码 1（models-page 14 passed，teams-page 在测试导入阶段因 router mock 缺少 `useNavigate` 失败，未改核心测试）；单独 models-page focused test 14 passed（退出码 0）；`pnpm exec tsc -b` 与 `git diff --check` 均退出码 0；迁移页面当前操作者角色比较的 `rg` 扫描无匹配（退出码 1）。tenant member 完整名册维持既有行为，契约待确认；完整残留为 `features/tenants/components/member-table.tsx` 的当前操作者 `currentRole === 'owner'` owner 选项判断（不在本次指定清单），以及 `features/workspaces/pages.tsx`、`features/tenants/components/member-custom-role.tsx`、`member-table.tsx` 中的目标成员角色保护/资格/显示比较；本轮后续迁移仍待独立验收。

> 2026-10-12 当前 HEAD `bb4351b` 基线与 P0 复验：工作区干净；API 默认套件 `24 passed, 26 deselected, 38 warnings`、`compileall app`、`pnpm build` 均通过；ESLint `0 errors, 24 warnings`。使用现有 Docker Redis `127.0.0.1:16381` 由主线程重跑 F24b 真实 FastAPI/AgentScope/Vite/Chromium 流程，输出 `F24b chat messages frontend verification passed`，退出码 `0`。验证后只清理本轮生成的 1 个 F24b Redis event key，DB4/DB5 恢复为 `6/0`；真实模型推理、工具确认/调用、外部任务和 SSE 重连仍未验证，详见 [F24b 聊天消息验收](verification/F24b-chat-messages-frontend.md) 与 [基线复验报告](verification/baseline-2026-10-12.md)。

> 2026-10-12 F25a SSE 文本增量完成当前工作树独立复验：使用现有 Docker Redis `127.0.0.1:16381`、临时 SQLite（Alembic `0016_tenant_validity`）、真实 FastAPI/AgentScope/Vite/Chromium，`pnpm build` 与完整 F25a runner 均通过，输出 `F25a SSE text frontend verification passed`，退出码 `0`。验收覆盖文本增量、断线 replay、去重、会话/Workspace 切换隔离、历史消息保留、临时 503 重试、删除会话后的 404 清理和撤权后的 403 清理。runner 已补充 Windows `pnpm`/子进程兼容及按名称精确清理 F25a Agent/Session/event fixture；结束后 Redis DB7/DB8 均为 `0` keys。真实模型提供商推理、工具调用和人工确认仍未验证，详见 [F25a SSE 文本验收](verification/F25a-sse-text-frontend.md)。

> 2026-10-13 F25b1/F25b2/F26a/F26b/F27a 完成本轮独立验收与修复后复验：F25b1 中断、F25b2 工具事件、F26a 工具权限确认、F26b 外部结果人工介入、F27a 团队任务只读面板的真实 FastAPI/AgentScope/临时 Redis/Vite/Chromium runner 均退出码 `0`。F26b 首次发现历史 external-result textarea 受控状态缺陷，F27a 首次发现团队任务事件刷新缺口，均已修复并重新通过。所有报告仍明确排除真实模型 provider、真实工具/外部执行器、真实子智能体编排 worker 的覆盖；F25b1 parked 状态为前端投影，F26a HITL resume 使用受控响应与真实 fixture。另发现 AgentScope `WakeupDispatcher` 的后台 resume 可能丢失 `WorkspaceContext`，F26b UI 通过不等于后台恢复通过，已拆为 F26b-backend 未实现任务；对应安全传播设计已完成。F27b UX/API 设计已完成，但实现仍未开始。详见各项 [F25b1](verification/f25b1-interrupt.md)、[F25b2](verification/f25b2-tool-events.md)、[F26a](verification/f26a-tool-permission.md)、[F26b](verification/F26b-external-result-frontend.md)、[F27a](verification/F27a-team-panel.md) 报告。

> 2026-10-13 F26b-backend、F27b-1、F32 第一阶段完成最新修复与独立复验：F26b WakeupDispatcher 增加 consuming lease 的 attempt-safe CAS 恢复、任意 spawn 失败回滚和有界 512 条启动恢复索引，聚焦测试 `12 passed`；F27b 控制面增加创建/更新授权、创建者保护、tenant/workspace 复合外键和数据库级单 active run 约束，聚焦测试 `6 passed`，全新 Alembic `0001 -> 0018` 升级通过；F32 endpoint DNS 解析失败改为 fail-closed，同时保留开发环境 localhost 放行，聚焦测试 `4 passed`。这些修复仍不等于 C 级真实 AgentScope model/tool 执行、真实团队 worker 或真实 provider connection；F27b 仍为 `durable_control_only`。当前 API 全量、compile/build/lint 结果仍以各复验报告为准，真实模型 provider、真实工具执行和登录后的双角色浏览器场景仍未宣称通过。详见 [F26b-backend 复验](verification/F26b-wakeup-workspace-context-reacceptance-20261013.md)、[F27b 复验](verification/F27b-team-orchestration-reacceptance-20261013.md)、[F32 复验](verification/F32-model-provider-custom-model-reacceptance-20261013.md)。

> 2026-10-13 设置域交互收口：个人资料、账号密码、外观、显示和通知页面改为“当前设置摘要 + 编辑弹窗”，保留原有设置路由和提交语义；移动端摘要按钮改为纵向布局，设置侧栏移动端选择器改为直接受路由控制。当前已通过设置域 ESLint、前端构建和既有 5 个前端测试文件（47 项）；Display/Notifications 仍是模板演示提交，未接入持久化 API，未宣称真实设置保存验收。

> 2026-11-19 模板与演示残留清理已实现：删除 Clerk demo 路由、logo 资产和依赖，刷新 TanStack Router 生成树；保留 Synapse 本地 `/sign-in` 等认证页。Dashboard 的销售、流量和随机图表数据改为中性空状态并新增定向浏览器测试；移除不再使用的 `recharts`。使用 pnpm 11.7.0 安装；定向测试 `1 passed`、ESLint `0 errors, 25 warnings`、`pnpm build` 通过。未接入首页真实业务概览 API；其他演示路由、来源许可证范围及本项独立验收仍待处理。

> 2026-11-19 Dashboard UX 补充修订完成：空态明确标识数据源尚未接入/配置，移除 Dashboard 上的 Connect 行动措辞并补齐中英双向词条；为摘要、概览、动态和分析区块添加 h2/h3 层级，Tabs orientation 改为 horizontal，清除无依赖的 `@clerk/shared` allowBuilds 配置。Dashboard focused 浏览器测试 `1 passed`、`tsc -b`、相关 ESLint、`git diff --check` 通过；真实摘要 API 仍未接入，独立验收待完成。

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
| F41 | 本地启动与持久化部署配置 | 待开始 | — | — |
| F42 | 初始化数据与旧数据迁移工具 | 待开始 | — | — |
| F43 | 范围清理与来源许可证记录 | Clerk 示例路由、资产及依赖已清理；其他演示路由和许可证来源范围待处理、待独立验收 | formal_nav_impl | 租户/用户/个人设置与 Workspace 动态菜单及本地认证保留；尚需审查其他演示路由并补齐许可证记录 |
| F44 | 首页真实业务概览替换模板指标 | 模板销售/流量指标已替换为中性占位，待真实业务概览接入及独立验收 | — | 当前不伪造业务数据；尚未接入真实首页摘要 API |

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

## 前端架构优化 1/8：OpenAPI 契约生成（2026-11-19）

实现已写，独立验收已通过。新增 FastAPI OpenAPI 导出、TypeScript schema 生成及 `apps/web` 的 `openapi:generate` / `openapi:verify` 脚本，并将 users、tenants、workspaces API 的核心请求/响应模型改为引用生成类型；接口路径、HTTP 方法、请求处理和后端行为未改。实现验证见[前端 OpenAPI 契约生成验证](verification/frontend-openapi-contract-generation.md)，独立验收见[前端 OpenAPI 契约层验收](verification/frontend-openapi-contract-acceptance.md)。本项只覆盖上述三组核心模型；筛选参数、部分状态/角色约束、完整 operation 客户端和其余 API 模块仍保留手写类型，未完成全量契约迁移。

## 2026-11-19 前端权限 capability 模型统一（4/8）

- 已新增 `src/lib/permissions.ts` 与 14 条 capability 测试，并接入全局用户管理、租户列表与租户详情的既有角色判断；未修改 API、导航或 i18n。
- 权限矩阵保持全局、租户、Workspace 作用域互不继承：`platform_admin` 仅管理平台用户与按契约查看/管理租户；tenant owner/admin 管成员、角色、设置、邀请并可创建 Workspace；Workspace owner/admin 管成员、资源与设置，member 可使用资源，viewer 只读。
- 定向验证：`pnpm exec vitest run src/lib/permissions.test.ts --browser.headless` 14 passed；`pnpm exec tsc -b` 退出码 0；指定页面已无 `platform_role === 'platform_admin'` 直接比较；`git diff --check` 通过。
- 独立验收：首批通过，限 capability helper 与指定接入点；证据见[前端权限 capability 验收](verification/frontend-architecture-permissions-acceptance.md)。tenant member 是否可查看完整成员名册需产品契约确认（现有前后端均维持该行为，未扩大权限）。本轮主 worktree 已完成 app-sidebar、Workspace pages/models/directory/teams/attachments 与租户子页的后续迁移；成员组件 `currentRole === 'owner'` 仍决定是否显示 owner 角色选项，目标成员的 owner 保护/资格/显示比较继续保留，均登记在上方残留清单；本轮后续迁移仍待独立验收。权限 UX 审查另见 `docs/ux/frontend-architecture-permissions.md`。

## 2026-11-19 Workspace 路由数据流优化（3/8）

- 设计范围：本项调整 Workspace 路由与详情查询缓存、不可访问回退，不改页面业务功能或 HTTP 契约；未另做页面 UX 审查。
- 代码状态：已完成。父/子路由使用根 `QueryClient` 的 `ensureQueryData`；Workspace directory key 与目录组件统一使用 `queryKeys.workspace.query(...)`，详情 key 保留 `queryKeys.workspace.resource(...)` 并按 actor、tenant、workspace、membership version 隔离。布局沿用路由缓存数据并关闭 mount refetch；若列表 scope 与服务端详情版本不同，详情缓存迁至服务端返回的 scope key。
- 定向证据：`pnpm exec vitest run src/features/workspaces/context.test.tsx --browser.headless`：7 passed。父/子路由和布局首次进入共发 1 次 `GET /api/v1/workspaces/11`；同一 QueryClient 动态切换 actor、tenant、workspace、membership version 时共发 5 次详情 GET，逐项呈现对应响应并保留 5 个互不命中的缓存项。403/404/409 mocked 回退各请求失败详情 1 次和 fallback 详情 1 次，页面与 toast 均无失败空间名称、ID、服务端标题/详情；受控后台 403 测试断言初次详情 1 次、后台重验 1 次、目标详情 1 次，暂停回退期间仅显示通用提示。`pnpm exec tsc -b`：退出码 0；`git diff --check`：通过。
- 独立验收：原报告结论仍为部分通过，见[Workspace 路由查询数据流验收](verification/frontend-workspace-route-query-acceptance.md)；本次补充证据待独立复验后再调整结论。当前测试全部使用 mocked API，真实服务撤权及详情超过 10 秒 stale 后的真实后台重验行为仍待实体验收；业务 API 仍以服务端授权为准。

## 2026-11-19 架构优化阶段合并记录

- 已将 1/8 OpenAPI 契约层、3/8 Workspace 路由数据流、4/8 权限 capability 首批实现合并至当前 worktree，并合入权限与 Dashboard 清理两份独立 UX 审查报告。
- 合并后重跑定向验证：`pnpm run openapi:verify`、`pnpm exec vitest run src/lib/permissions.test.ts --browser.headless`（14 passed）、`pnpm exec vitest run src/features/workspaces/context.test.tsx --browser.headless`（5 passed）、`git diff --check` 均通过。
- OpenAPI 独立验收通过；权限首批独立验收通过但残留迁移清单待处理；Workspace 路由独立验收部分通过并已派补测。cleanup 与 querykeys 实现 patch 已回报，querykeys 待合并；i18n Dashboard 缺词修复已完成定向自验，独立复验待安排；i18n 模块化其余工作与会话状态机实现继续。

## TanStack Query 缓存键统一（2026-11-19）

新增 `apps/web/src/lib/query-keys.ts` 统一工厂，实际查询键包含 actor、tenant/global、workspace/personal、membership version、domain、resource 和规范化 params。迁移范围覆盖 Workspace 目录/上下文、成员、agents、sessions、teams、附件及模型提供商；AgentScope chat/session config、credentials、ops、knowledge、MCP、Skills 和 SOP。AgentScope 查询统一使用 `agentscope` domain；未覆盖其他 feature 目录中的查询键。Team run references 的 sessionStorage 键保持原序列化，避免改变已有本地状态读取方式；未修改 API 或后端契约。

定向验收证据：`pnpm exec vitest run src/lib/query-keys.test.ts --browser.headless` 退出码 `0`（1 个文件、5 项通过）；`pnpm exec tsc -b` 退出码 `0`；覆盖目录裸写 `['agentscope-ops', ...]` 和 `['agentscope', workspaceId, ...]` 检查无匹配（ripgrep 无匹配退出码 `1`）；`git diff --check` 通过。迁移会让旧缓存键在部署后冷启动并触发重新取数；actor、tenant、workspace 和 membership version 现在显式参与隔离。当前为实现方定向自验通过，仍待独立验收，不能据此宣告所有前端查询键均已迁移。

## 2026-11-19 Workspace detail 请求去重回归修复

- 侧栏复用 `workspaceDetailQueryKey` 与 Workspace route 的 `WORKSPACE_QUERY_STALE_TIME`，并设置 `refetchOnMount: false`，避免完整 `AuthenticatedLayout` 下同一 actor/tenant/workspace/membership-version detail key 因 mount 强制 refetch 形成第二次 GET。租户导航 query key 显式包含 tenant ID；未改变 API、服务端授权契约或 scope 隔离维度。
- 回归测试挂载真实 `AuthenticatedLayout`、Workspace 父/子路由和 `WorkspaceRouteLayout`，等待侧栏 visible-tree 查询后断言首次 `/api/v1/workspaces/11` detail GET 恰 1 次。`pnpm exec vitest run src/features/workspaces/context.test.tsx --browser.headless`：7/7 passed；`pnpm exec tsc -b --pretty false` 通过；scoped ESLint 0 errors、3 条 Fast Refresh warnings；目标文件范围内 `git diff --check` 通过。
- 局限：浏览器测试使用 API stub，未验证真实服务端撤权/授权行为；独立复验仍待协调方安排。

## 2026-11-19 前端模板与 Clerk 残留清理（2/8）

- 已删除 Clerk demo 路由、logo、`@clerk/react` 依赖、Recent Sales 组件和无引用的 recharts；Dashboard 销售、流量与随机图表数据改为中性 Workspace 占位，并保留本地登录与正式业务导航。
- Dashboard UX 审查指出的必修项已修复：空态明确表示数据源尚未接入/配置，可见区块补足 `h2`/`h3` 语义，Tabs 使用横向语义；`pnpm-workspace.yaml` 中无依赖的 `@clerk/shared` allowBuilds 配置已删除。
- 实现定向验证：Dashboard focused browser test、`pnpm exec tsc -b`、相关 ESLint、`pnpm build`、`git diff --check` 通过；`@clerk/react`、Clerk 路由、RecentSales/recent-sales 引用清零。真实首页摘要 API、其它模板路由与许可证范围仍未纳入本项。
- 独立验收待安排。当前主 worktree 已合并 OpenAPI、Workspace 路由、权限首批、QueryKeys 与 cleanup；组合定向验证 `openapi:verify`、5 个测试文件 39 项、`tsc -b`、`git diff --check` 全部通过。

## 2026-11-19 Faker fixture 清理补充

补充修复原独立验收残留：保留 `/tasks` 页面的 5 条固定中性记录，删除未使用的用户 Faker fixture，并从 `package.json` 与 lockfile 移除 `@faker-js/faker`；`DashboardEmptyState` 标题提供可配置语义 heading 层级。Dashboard focused 测试、frozen lockfile、全局 Faker 扫描、`tsc -b` 与 diff 检查通过。独立复验通过，并确认 Breakdown 空态使用 level 4 的建议已解决；真实业务 API 与读屏/窄屏场景不在本轮证据内。

- `/tasks` 仍导入 `features/tasks/data/tasks.ts`；已将 100 条生成数据改为 5 条固定的 `Sample task` 占位记录。`features/users/data/users.ts` 无引用，已删除；正式全局用户页仍使用现有 API。未修改路由或 API。
- 已从 `apps/web/package.json` 与 `apps/web/pnpm-lock.yaml` 移除 `@faker-js/faker`。`pnpm install --frozen-lockfile` 通过；`rg -n -i faker apps/web/src` 与 `rg -n @faker-js/faker apps/web/package.json apps/web/pnpm-lock.yaml` 均无匹配。
- `DashboardEmptyState` 已有 `level?: 2 | 3 | 4`，默认值为 `3`；独立复验建议 Analytics breakdown 空态使用子级标题，现已在两个 breakdown 卡片中显式设为 `level={4}`，并由测试断言存在两个 level 4 空态标题。Dashboard focused test `1 passed`，相关 ESLint 通过；`git diff --check` 通过。
- 原先并发 QueryKeys 迁移造成的 `features/tenants/index.tsx` TS2783 已由协调方移除重复 `page`、`pageSize` 属性；清理任务随后复跑 `pnpm exec tsc -b --pretty false` 通过。

## 2026-11-19 前端 i18n Dashboard 词条回归修复

- 按拆分前暂存 index 版词典恢复静态 Dashboard catalog：19 条英译中、18 条中译英，共 37 个方向性查找；保留 `智能体`→`Agent` 的既有高优先级结果，并按原有查找顺序注册，不引入异步加载、后端依赖或 fallback 变化。
- `i18n.test.ts` 锁定必需 `dashboard` 模块、37 项查找数量、全部 Dashboard 双向文案及 `Agent` 优先级，防止整域 catalog 遗漏或关键词条回归。
- 定向验证通过：`pnpm exec vitest run src/lib/i18n.test.ts src/features/dashboard/index.test.tsx --browser.headless`（2 files、8 tests passed）；`pnpm exec tsc -b --pretty false`；`pnpm exec eslint src/lib/i18n.ts src/lib/i18n.test.ts src/lib/i18n --format stylish`；`git diff --check`（退出码 0；Git 对其他已有改动提示 CRLF→LF 规范化警告）。
- 独立验收待复跑；原报告 `verification/frontend-i18n-modularization-acceptance.md` 保持只读、未改写。未覆盖全项目构建、真实 API 或生产行为。

## 2026-11-20 字典页查询键运行态修复

- 修复初始未选择字典类型时 `selectedTypeId` 为空、被用作 query resource path 段并同步抛错的问题；类型 ID 改为 query params，条目缓存失效使用固定资源前缀。
- 修复类型标识 HTML pattern 在 Chromium 新正则模式下的连字符语法错误，保留原允许字符；API 契约未变。
- 定向验证包括 `pnpm exec tsc -b --pretty false`，以及本地临时 SQLite/FastAPI 环境下 Chromium 实测：字典页初始空态、已有类型条目空态及 `pattern-check` 原生校验通过，控制台无错误。详细证据与局限见 `docs/verification/frontend-dictionary-query-key-runtime-fix.md`；未覆盖完整 CRUD、跨租户访问和生产环境。

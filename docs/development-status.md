# Synapse 开发与独立验收台账

目标：完成 integration-plan.md 全部明确范围。租户与 Workspace 为所有业务迁移的前置条件。

用户要求：子智能体全部使用 gpt-6-luna / medium；每个任务只做一个功能或一个验证；每项验证由独立子智能体执行。主智能体负责协调、契约和进度记录。开发完成不等于验收通过。

状态：待开始 → 开发中 → 待独立验收 → 通过；验证失败转回修复。外部运行条件不足的功能记为待实际验收，不记为通过。

## 功能任务

> 2026-10-12 当前版本补充：租户列表筛选、owner 选择、表格交互、邀请过期事务结果与前端国际化已实现；本轮增量已完成独立真实 API/Chromium 验收。近期差距和优先级见 [租户优化原则与差距清单](tenant-optimization-principles-and-gap-review.md)。F05/F05a/F09 历史“通过”仅适用于原报告所验版本；本轮 F09 增量现为**独立验收通过**，加载态仍未做人为延迟下的独立时序断言。F24b 的 agent/session 绑定修复已完成本机真实 API/Playwright 复验，F24b 独立验收已在 `b069adf` 记录；F25a 原 TypeScript 构建故障已由当前编译通过替代，但 SSE 功能仍待独立验收。

> 2026-10-12 租户优化独立验收：筛选/计数、UTC 边界、权限隔离、owner API 落库、邀请过期 `410` 与持久化 5 项真实 API 检查通过；独立 Chromium 复验确认中英文标题/说明/状态/角色/日期/分页、错误重试、超范围页码、筛选空态、成员空态、列显隐、可访问名称和 390px 窄屏均通过。平台管理员零租户空态仍为拦截模拟，加载态未做人为延迟下的独立时序断言；详见[租户优化验收记录](verification/tenant-optimization-acceptance-2026-10-12.md)。

> 2026-10-12 F09 租户列表修复后，主代理诊断与随后独立子智能体验收均使用隔离临时数据和真实 FastAPI/Vite/Chromium；独立验收结果已覆盖真实 API 和核心浏览器路径，平台管理员零租户空态仍明确标为模拟。Redis 标记套件最新复跑使用临时 Redis 7.4.11，结果 `8 passed, 5 failed`；失败测试存在迁移版本、当前 API 契约和本机 `.env` 隔离等差异，详见[Redis suite 复跑记录](verification/redis-suite-2026-10-12.md)。

> 2026-10-12 新增 UX 门槛：每个后续功能点先由独立 UX 子智能体审查主流程、失败/权限/窄屏/可访问性，再由实现子智能体开发，最后另行独立验收。租户批量启停与正式导航方案已记入上述差距清单；F19c2 方案见 [手工触发 UX 与契约检查](ux/F19c2-manual-task-trigger.md)。这三项的代码已写且当前 TypeScript 编译通过，均**待独立验收**；设计与编译结论不能替代功能验收。

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
| F09b | 租户列表批量启用/停用 | UX 已设计，代码已写，静态检查通过，待独立验收 | tenant_batch_ux；tenant_batch_impl | 复用单租户 PATCH；逐项结果、部分失败和权限需真实 API/浏览器复验 |
| F10 | Workspace 管理与左上角切换 | 通过 | workspace_backend | verification/F10-workspace-frontend.md；构建及真实API浏览器流程通过，含跨租户回退与撤权后缓存清理 |
| F11 | 全局用户管理后端迁移 | 通过 | agent_embedding_design | verification/F11-user-management-api.md；1 passed，权限、CRUD、JWT撤销、bcrypt兼容与软删独立复验 |
| F11a | 全局用户管理前端迁移 | 通过 | workspace_backend | verification/F11a-user-management-frontend.md：build、真实API浏览器CRUD及权限通过；旧Clerk演示Faker清理另列F43 |
| F12a | 角色管理后端迁移 | 通过 | agent_embedding_design | verification/F12a-tenant-role-api.md：1 passed；迁移兼容、跨租户隔离、CRUD及权限校验通过 |
| F12b | 角色管理前端迁移 | 通过 | agent_embedding_design | verification/F12b-tenant-role-frontend.md：Outlet修复后build、真实API浏览器CRUD/权限/缓存复验通过 |
| F12c | 租户角色分配给成员后端 | 通过 | agent_embedding_design | verification/F12c-member-role-assignment.md：1 passed；FK修复后API、权限、版本、并发与跨租户复合FK通过 |
| F12d | 租户成员角色分配前端 | 通过 | agent_embedding_design | verification/F12d-member-role-frontend.md：build、真实API浏览器分配/撤销、租户缓存隔离通过 |
| F12e | 普通成员查看自身自定义角色 | 通过 | verify_tenant_backend | verification/F12e-self-role-view.md：build、API和浏览器自读/跨租户隔离/撤权复验通过 |
| F13a | 菜单管理后端迁移 | 通过 | agent_embedding_design | verification/F13a-tenant-menu-api.md：1 passed；树CRUD、排序、跨租户父级复合FK和权限通过 |
| F13b | 租户菜单管理前端 | 通过 | agent_embedding_design | verification/F13b-tenant-menu-frontend.md：build、真实API浏览器树CRUD/排序/权限/租户隔离通过 |
| F13c | 菜单与角色授权后端 | 通过 | agent_embedding_design | verification/F13c-role-menu-api.md：1 passed；ID序列化、幂等版本、并发及复合FK复验通过 |
| F13e | 菜单与角色授权前端 | 通过 | agent_embedding_design | verification/F13e-role-menu-frontend.md：build、真实API浏览器授权保存/历史项/权限/租户缓存通过 |
| F13d1 | 当前成员可见菜单树后端 | 通过 | agent_embedding_design | verification/F13d1-visible-menu-tree.md：1 passed；角色授权、父级过滤、撤权和no-store通过 |
| F13d2 | 租户动态侧栏导航前端 | 通过 | agent_embedding_design | verification/F13d2-dynamic-sidebar.md：build、跨租户/空间/角色/撤权/晚到请求真实API浏览器验收通过 |
| F14a | 部门管理后端迁移 | 通过 | agent_embedding_design | verification/F14a-tenant-department-api.md：1 passed；树CRUD、隔离、祖先刷新与复合FK通过 |
| F14b | 部门管理前端迁移 | 通过 | agent_embedding_design | verification/F14b-tenant-department-frontend.md：build、真实API浏览器树CRUD/移动/排序/隔离通过 |
| F15a | 字典管理后端迁移 | 通过 | verify_tenant_backend | verification/F15a-tenant-dictionary-api.md：1 passed；迁移、租户隔离、CRUD、权限和复合FK通过 |
| F15b | 字典管理前端迁移 | 通过 | verify_tenant_backend | verification/F15b-tenant-dictionary-frontend.md：build、真实API浏览器CRUD/筛选/排序/隔离通过 |
| F16a | 参数配置后端迁移 | 通过 | agent_embedding_design | verification/F16a-tenant-config-api.md：1 passed；迁移、租户隔离、权限及敏感值边界独立复验通过 |
| F16b | 参数配置前端迁移 | 通过 | agent_embedding_design | verification/F16b-tenant-config-frontend.md：build、真实API浏览器CRUD、敏感值延迟响应与租户切换隔离通过 |
| F17a | 附件管理本地存储后端 | 历史验收通过；2026-10-12 Windows 并发 unlink 修复已写、定向 10 次与默认 API 套件通过，待独立复验 | verify_tenant_backend | verification/F17a-attachments-api.md：原作用域/上传下载/失败重试验收通过；本次新增模拟 WinError 5 缺文件回归和真实双线程并发复跑 |
| F17b | 附件管理前端 | 通过 | verify_tenant_backend | verification/F17b-attachments-frontend.md：build、真实API/AgentScope/Redis浏览器多租户多空间附件与撤权通过 |
| F18a | 系统任务定义后端迁移 | 通过 | verify_tenant_backend | verification/F18a-scheduled-task-definition.md：修复后1 passed，计划校验422且无写入、隔离、目标allowlist与迁移通过 |
| F18b1 | 过期租户邀请任务目标 | 通过 | verify_tenant_backend | verification/F18b1-expire-invitations.md：1 passed，租户过滤、到期边界及重复/并发幂等通过 |
| F18b2a | 系统任务内部目标分发 | 通过 | verify_tenant_backend | verification/F18b2a-task-dispatcher.md：1 passed，三个真实目标与跨租户/参数拒绝通过 |
| F18b2b | 系统任务持久化到期claim | 通过 | verify_tenant_backend | verification/F18b2b-scheduler-claims.md：1 passed，双worker单槽claim、lease恢复与持久状态通过 |
| F18b2c | 系统任务时钟循环与触发 | 通过（跨进程待终验） | verify_tenant_backend | verification/F18b2c-scheduler-runtime.md：1 passed，双lifespan单槽执行/失败重试/租约恢复/停机通过；at-least-once边界已记 |
| F18b3 | 附件元数据核对任务目标 | 通过 | verify_tenant_backend | verification/F18b3-attachment-reconcile.md：1 passed；异常分类与租户只读隔离通过 |
| F18b4 | 租户资源摘要刷新任务目标 | 通过 | verify_tenant_backend | verification/F18b4-resource-summary.md：1 passed，双租户计数、并发UPSERT与变更覆盖通过 |
| F18c | 系统任务管理前端 | 通过 | verify_tenant_backend | verification/F18c-scheduled-task-frontend.md：build、真实API浏览器Cron/interval CRUD/权限/隔离通过 |
| F19a | 系统任务执行记录后端 | 通过 | verify_tenant_backend | verification/F19a-scheduled-task-runs.md：1 passed，0015迁移、租户API权限/脱敏与复合FK通过 |
| F19b | 系统任务执行记录前端 | 通过 | verify_tenant_backend | verification/F19b-task-runs-frontend.md：build、真实API浏览器分页筛选/脱敏/权限通过 |
| F19c1 | 系统任务手工触发API | 待独立验收 | workspace_backend | owner/admin手工trigger与run持久化已实现；待独立验证 |
| F19c2 | 系统任务手工触发前端 | 代码已写，静态检查通过，待独立验收 | manual_task_ux；manual_task_impl | ux/F19c2-manual-task-trigger.md；同步无幂等接口的超时重试风险待产品决策 |
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
| F25a | SSE文本增量展示 | 验收未通过，待修复 | agent_embedding_design | verification/F25a-sse-text-frontend.md：真实SSE浏览器流程通过；前端构建被未定义controller阻断，真实模型推理待验 |
| F25b1 | 聊天生成中断 | 待独立验收 | agent_embedding_design | 当前scope会话interrupt与状态刷新完成；待独立浏览器验证 |
| F25b2 | 工具执行事件展示 | 待独立验收 | agent_embedding_design | SSE/历史工具时间线、脱敏摘要与结果折叠完成；待独立浏览器验证 |
| F26a | 工具权限确认前端 | 待独立验收 | agent_embedding_design | 真实awaiting tool call允许/拒绝、过期/撤权反馈完成；待独立浏览器验证 |
| F26b | 外部结果人工介入前端 | 待独立验收 | agent_embedding_design | 真实外部执行结果/取消UI及scope清理完成；待独立浏览器验证 |
| F27a | 子智能体团队与任务只读面板 | 待独立验收 | agent_team_frontend | 基于真实session.team/tasks_context的只读概览完成；待独立浏览器验证 |
| F27b | 子智能体团队编排与执行控制 | 待开始 | — | — |
| F28 | 知识库管理融合 | 待开始 | — | — |
| F29 | 知识库文档、索引与检索融合 | 待开始 | — | — |
| F30 | MCP 资源与工作空间配置融合 | 待开始 | — | — |
| F31 | Skills 资源与工作空间配置融合 | 待开始 | — | — |
| F32 | 模型与凭据管理融合 | 待开始 | — | — |
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
| F43 | 范围清理与来源许可证记录 | 正式导航和根首页已改，旧演示路由及许可证范围待处理、待独立验收 | formal_nav_impl | 租户/用户/个人设置与 Workspace 动态菜单保留；演示路由仍需逐项审查 |
| F44 | 首页真实业务概览替换模板指标 | 待开始 | — | — |

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

同时修复聊天确认提交中 controller 未定义的构建阻断，当前 pnpm build 通过；聊天确认取消行为和 F24b 的消息接口参数边界仍需各自独立验收，不因此将 F24b/F25a 全部改为通过。

# 租户优化原则与已实现功能差距清单

状态：核心方向已由产品确认，逐模块细节持续审阅。基线为 `0d40cbc`，近期代码为 `51a6c61`（2026-10-12）。本清单区分从代码可确认的约束、跨模块工程标准和各业务自己的交互，不把一次界面改版当成全平台规则。

## 1. 近期改动的事实

| 层面 | 已发生的变化与代码依据 | 判断 |
| --- | --- | --- |
| 前端交互 | `apps/web/src/features/tenants/index.tsx` 与 `components/tenant-table.tsx` 将搜索、状态、有效期和更多筛选映射到 URL；增加当前页多选、显示列、每页行数与完整分页；创建租户改用 `components/owner-picker.tsx` 搜索账号，不要求输入全局 ID。 | 可借鉴“可发现、可恢复的列表状态”和“人选人而非填 ID”；具体筛选字段和批量动作仍由模块决定。 |
| API 契约 | `apps/api/app/api/tenants.py` 和 `apps/web/src/api/tenants.ts` 为普通成员列表与平台目录增加 `q`、`validity`、`slug`、创建/更新/到期时间边界；仍保留旧 `name` 参数，分页仍是 `page`/`page_size`。 | 新筛选为增量兼容，不能直接删除旧参数；前端 camelCase 到 API snake_case 映射集中在 API 客户端。 |
| 服务层 | `apps/api/app/services/tenants.py` 抽出 `_filter_tenants`；关键词转义 SQL 通配符；筛选后从同一查询计算 `total`，避免列表与计数条件分叉；拒绝无时区和倒置日期边界。 | 查询构造、计数、日期验证应成对设计；不能直接将租户字段复制到其他模块。 |
| 数据模型 | `apps/api/app/models/tenant.py` 未因本轮列表优化新增列或迁移；筛选使用现有 `valid_from`、`valid_until`、时间戳、状态、slug，沿用 `membership_version`。 | 这是读取契约与 UI 改造，不是数据模型重构。迁移其他模块时先查归属/索引/约束，再决定迁移。 |
| 权限与作用域 | `GET /tenants` 仍只列当前账号 active 成员关系和 active 租户；`GET /platform/tenants` 仍要求 `platform_admin`，仅赋予平台目录可见性，不授予租户/Workspace 业务访问。创建时显式选择 active 首位所有者，调用平台管理员不会自动成为成员。 | 身份边界属于 `docs/tenancy-contract.md`，必须保持；筛选优化不能扩大返回集合。 |
| 错误与事务 | `apps/api/app/services/tenant_invitations.py` 把邀请过期改为显式 `InvitationExpiredResult`；`apps/api/app/api/tenant_invitations.py` 映射为 410，使过期状态可在请求事务中提交，而其他异常仍走统一 problem 响应。前端创建/筛选错误保留反馈。 | “需要落库的失败”用显式结果表达；一般失败继续抛稳定领域错误。不要把所有异常都改成成功返回。 |

## 2. 拟长期采用的跨模块标准

以下是从上述改动可推广的**候选工程标准**。身份、租户与 Workspace 隔离、JSON ID、统一错误和缓存键以 [租户契约](tenancy-contract.md) 为唯一权威；此处只定义模块迁移的实现与体验检查点。

1. **先确定数据归属与动作权限。** 每个资源明确是全局账号私有、租户共享、Workspace 共享还是个人私有；查询、写入、列表计数、后台任务和缓存都使用同一可信作用域。平台目录权限不隐含资源成员资格。
2. **列表契约成套设计。** 明确搜索字段、精确/模糊规则、筛选枚举、UTC 时间边界、稳定排序、`page`/`page_size` 与同条件 `total`。前端筛选/分页状态放 URL，变更筛选时回到第一页；API 客户端集中处理参数映射。选择状态限定当前页或明确的跨页语义。
3. **面向人的身份输入。** 创建者、所有者和成员使用有权限约束的搜索选择器；页面展示名称/账号，内部 ID 只用于请求与审计。业务字段是否显示 ID 由实际用途决定，不能一概隐藏。
4. **表格能力按需要组合。** 加载、空数据、失败、筛选重置、分页、列显隐应一致；仅有实际批量动作的模块才设计跨页选择、确认、部分失败与撤销。租户表格当前多选只是页内 UI 状态，尚无批量服务契约。
5. **前后端同时定义失败状态。** 输入验证在服务端兜底，领域冲突使用稳定 `code`；前端显示可恢复操作。业务失败若同时需要持久化状态（例如邀请过期），服务层显式返回结果，路由映射 HTTP 状态，事务边界仍负责提交；详见 [事务 ADR](adr/0002-request-scoped-transactions.md)。
6. **变更契约先写迁移方式。** 新参数优先增量兼容；若改路由、字段、作用域或归属，先写旧调用方、数据回填、兼容期与回滚方式，再改前后端。构建成功仅说明代码可编译，不等于功能验收。
7. **每个功能点先做独立 UX 设计。** 指派一个 UX 子智能体审视信息架构、主流程、筛选/选择、空/错/加载/部分成功、权限边界、移动端与可访问性；方案与 API/服务/数据归属一起审阅，不能只在前端实现后补视觉稿。
8. **每个迁移单元一起交付六项。** UX 方案与前端状态；API 与服务；数据归属和权限；失败与并发行为；独立验收条件与证据；开发台账状态。允许模块保留合理的业务差异。

## 3. 可复用标准与租户专属规则的边界

| 可复用 | 租户专属，不能机械复制 |
| --- | --- |
| URL 驱动筛选/分页；API 参数映射；筛选与计数同源；时间边界和通配符处理；用户搜索选择；空/错/加载态；显式事务结果；状态台账。 | `valid_from`/`valid_until` 有效期、active/suspended/archived 生命周期；`platform_admin` 查看平台租户目录；首位 owner 与默认 Workspace 同事务创建；平台管理员不自动入租户；成员撤销影响所有所属空间。 |

## 4. 已实现功能的差距与拟修改文件

优先级按越权/数据错误、核心路径中断、体验一致性排序。台账中的“通过”是当时版本的独立验收，不自动覆盖本次未验的改动；以下“待核”不等于断言当前有缺陷。

| 优先级 | 功能与差距 | 影响范围 | 拟修改/核查文件 | 状态 |
| --- | --- | --- | --- | --- |
| P0 | F24b 聊天消息：代码核查确认存储适配器此前未比较会话绑定的 `agent_id`，现已在 `get_session` 入口加校验。独立静态审查确认官方消息与状态路由先经过该校验；适配器底层 `list_messages`、`get_message` 及部分索引方法并不自行验证 agent 绑定，后续新调用方必须先走受保护入口。仍须按原报告的跨 Workspace 请求独立复验。F25a 旧构建失败已由当前 TypeScript 编译通过所取代，但 SSE 功能仍待独立复验。 | 私有会话与空间隔离、聊天主路径 | `apps/api/app/integrations/agentscope_session_scope.py`、`apps/web/src/features/workspaces/sessions-page.tsx`、`docs/verification/F24b-chat-messages-frontend.md` | P0 修复代码已写、静态审查完成，待真实请求验收 |
| P0 | 近期租户优化尚未独立验收：筛选总数/跨页、UTC 边界、权限不扩张、owner 选择、邀请 410 持久化，以及国际化后交互。 | F05/F05a/F09 既有验收结论的当前版本 | `apps/api/app/{api,services}/tenants.py`、`tenant_invitations.py`，`apps/web/src/features/tenants/**`、`apps/web/src/lib/i18n.ts` | 代码已提交，待独立验收 |
| P1 | 租户列表多选仅有选择计数，缺少批量动作契约；不能从 Synapt 用户管理直接复制批量删除/停用。 | 平台租户目录 | `apps/web/src/features/tenants/components/tenant-table.tsx`、`apps/web/src/features/tenants/index.tsx`；首期复用现有单项 PATCH | UX 已设计，待实现与验收 |
| P1 | 全局用户、角色/菜单/部门/字典/配置、附件与计划任务列表的筛选、分页、空错态、权限说明各自实现，尚未按本标准逐项复核；不可统一成租户字段。 | 已迁移系统管理模块 | `apps/web/src/features/users/**`、`tenants/{roles,menus,departments,dictionaries,configs,scheduled-tasks}-page.tsx`、相应 `apps/api/app/api/*` 与 `services/*` | 待逐模块审计 |
| P1 | F19c1 手工任务触发待验收、F19c2 前端待做；F25b/F26/F27 代码与验收状态分离。 | 系统任务、AgentScope 工作流 | `apps/api/app/api/tenant_scheduled_tasks.py`、`apps/web/src/features/tenants/scheduled-tasks-page.tsx`、`apps/web/src/features/workspaces/{sessions,agents}-page.tsx` | 已写/待做/待验收，见开发台账 |
| P1 | 国际化代码已接入多数页面但词条与属性覆盖尚未得到完整验收，不能标成“所有页面已国际化”。 | 全前端 | `apps/web/src/lib/i18n.ts`、`components/localized-text.tsx`、各正式路由 | 代码已写、静态检查通过、待验收 |
| P2 | F22、F28–F40 尚有 AI 存储/知识库/MCP/Skills/模型/渠道/SOP 与人脸模块迁移；必须先定归属与隔离，再做 UI/API。 | 长期业务集成 | `docs/integration-plan.md` 指定的前后端模块；逐项登记到 `docs/development-status.md` | 待开始或部分基础已具备 |
| P2 | shadcn-admin 演示模块与旧 Clerk/Faker 路由仍可能可达；与开源产品导航及权限定位不一致。 | 范围清理 F43 | `apps/web/src/components/layout/data/sidebar-data.ts`、`apps/web/src/routes/clerk/**`、相关演示 features | 已确认移出正式导航；旧路由清理另评估 |

## 5. 需要产品确认的选项

1. **租户多选用途：已确认批量停用/启用。** 第一阶段复用现有单租户 PATCH，逐项报告成功、失败和跳过；若未来要求原子批量提交，先设计新接口、迁移和幂等语义。
2. **演示模块范围：已确认从正式导航移除。** 保留源码参考，不把模板数据展示为真实平台能力。
3. **国际化验收范围：已确认先覆盖正式产品页面。** 示例页退出正式导航后不阻断首期验收。

## 6. 本轮 UX 子审查：租户批量动作与正式导航

UX 子智能体依据现有租户列表、侧栏实现和租户契约提交了交互设计；这是设计结论，尚非实现或验收结果。

- **批量启停：**仅平台管理员可选择当前页租户。`active` 进入“停用”集合，`suspended` 进入“启用”集合，已归档不可选择；两个动作分别显示数量，避免含糊的“切换状态”。停用确认展示最多五个租户名称和剩余数量，并提示其 Workspace 访问将失效；启用不自动恢复独立撤销的成员权限。
- **执行与失败：**首期逐项调用现有 PATCH，每项由服务端重新核权和核状态。处理中锁定选择与动作，播报进度；成功项取消选择，失败项保留并列出原因，可重试。权限变更返回 403 时明示失败，不推断其他租户信息。选择范围仅当前页，换页或变更筛选会清空。
- **移动端与可访问性：**操作栏适配窄屏和安全区域；复选框有名称、表头支持半选；确认框可滚动；用 `aria-live` 播报进度和结果，状态不能只靠颜色表达；正式产品文案覆盖中英文。
- **正式导航：**移除 Dashboard、Tasks、Apps、Chats、错误演示和占位帮助页等模板入口；保留真实平台租户、平台用户、个人设置与经服务端验证的 Workspace 动态菜单。无 Workspace 时给明确选择或空状态，不回退模板菜单。菜单可见性不构成服务端授权；平台目录可见性不意味着租户业务访问权限。

## 7. 执行顺序与验收口径

先复核并修复 P0 隔离风险；随后独立验收近期租户优化并把失败项登记为待修复；再按用户/角色/菜单等模块逐一做契约与交互审计，只有确有差距时才修改。每个功能点先由 UX 子智能体提交可审阅方案，再实现前后端。每一项在 `development-status.md` 分别记“设计已审”“代码已写”“静态检查通过”“独立验收通过/未通过”，不以历史报告替代当前版本证据。需改数据契约时，先补迁移设计，再实施。

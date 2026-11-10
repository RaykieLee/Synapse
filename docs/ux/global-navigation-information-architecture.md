# 全局导航信息架构 UX 与实施契约

状态：独立 UX 审查与可实施设计；不是产品实现，也不构成独立验收。范围仅限全局导航、上下文切换、导航状态与相关路由入口；不重设计首页，不清理演示路由（演示路由清理继续由 F43 独立处理）。

## 1. 审查依据与结论

依据：[协作约定](../../AGENTS.md)、[租户与 Workspace 契约](../tenancy-contract.md)、[租户优化原则第 2/3/7 节](../tenant-optimization-principles-and-gap-review.md)、[开发状态](../development-status.md)，以及 `app-sidebar.tsx`、`sidebar-data.ts`、`directory.tsx`、`app-header.tsx`。

当前代码事实：

- `sidebar-data.ts` 将 `/tenants` 和 `/users` 静态归入“平台管理”，但 `app-sidebar.tsx` 对普通账号只过滤“全局用户”，`/tenants` 链接仍可见；同时 API/UI 的 `/tenants` 对普通账号返回其成员租户列表，对平台管理员使用平台租户列表。Workspace 路由还追加“系统”“AI 工作台”“个人设置”组，其中“系统”重复放有附件、模型与凭据，并把“租户管理”混入 Workspace；平台用户入口只按 `platform_admin` 显示。
- Workspace 业务菜单通过 `/tenants/{tenant_id}/menus/visible-tree` 动态读取。当前 UI 等 Workspace 详情确认 ID、Tenant 归属和 `membership_version` 后才显示匹配版本的菜单；切换或成员版本变化时清理旧菜单查询。菜单查询失败目前会折叠为无动态链接，没有明确的加载、错误或重试反馈，可能被误读为空菜单。
- `directory.tsx` 用可访问 Tenant 分组展示 Workspace，可搜索，并有最近 Workspace 提示；切换时按账号和空间上下文清理/隔离查询。当前移动端复用 Popover，切换器以“工作区”称呼协作 Workspace，与权威契约及页面普遍使用的“Workspace/工作空间”存在术语混用。
- `app-header.tsx` 依路径组装面包屑，普通 Workspace 路径只显示 Workspace 与当前页，不呈现 Tenant 祖先；小屏隐藏中间项。`Search` 是顶部可见入口，但其是否跨作用域搜索、命令入口能力须以后端契约确认，不能在导航中暗示越权搜索。
- F10、F13d2、F11a 的历史独立验收通过是既有功能证据，不代表本次导航整合已验收。F43 台账表明正式导航已改但演示路由清理另待处理；本设计不改变该状态。

核心问题是模型将四种心智范围平铺/混搭：账号自身事项、平台控制面、单租户管理和单个协作 Workspace 工作台。修复应先定义唯一的当前上下文和分区，再决定静态入口与租户动态菜单的归属、显隐、故障反馈。

## 2. 导航模型与权限边界

| 分区 | 用户问题 / 责任 | 归属与路由 | 可见性原则 |
| --- | --- | --- | --- |
| 个人 | “我的账号和偏好是什么？”个人资料、账号安全、外观、通知、显示；不依赖最近 Workspace。 | 全局账号私有；现有 `/settings/...` 页面可继续使用，路由迁移如要做须另列兼容方案。 | 所有已登录用户可见；个人凭据、会话与资源不得因切换而暴露给其他成员。 |
| 平台管理 | “我作为平台管理员管理哪些平台对象？”平台租户目录、全局账号管理。 | 平台范围；沿用 `/tenants` 的平台管理员列表视图及 `/users`。 | 仅 `platform_admin` 展示平台租户操作和全局用户入口；普通成员不要看到失效入口。角色只授予平台管理能力，不自动授予任何 TenantMember、WorkspaceMember 或业务资源访问。 |
| 租户管理 | “我在当前 Tenant 管理哪些组织设置？”可访问租户列表/租户切换、成员/邀请、租户角色、菜单、部门、字典、参数及租户级系统任务等。 | 当前租户范围；普通账号的 `/tenants` 是本人所属租户列表，平台管理员的同路径按角色呈现平台目录；具体租户下使用现有 `/tenants/{tenant_id}/...`。Tenant ID 在导航链接中来自已验证目录/上下文，不以用户自报 ID 作为授权。 | 当前 Tenant 成员按实际 `tenant_role`/动作权限展示管理入口；仅有读取成员列表能力不意味有编辑权限。平台管理员的平台目录能力与 TenantMember 分离；不可把平台目录访问渲染为已进入 Tenant 或 Workspace。 |
| Workspace 工作台 | “我现在在哪个协作空间工作？”该空间成员管理、空间设置和获授权的业务模块：聊天、智能体、知识库、文件/附件、模型、MCP、Skills、SOP、任务、渠道、人脸等，仅限已迁移且已授权的能力。 | Workspace 共享资源使用 `/w/{workspace_id}/...`；Tenant 由服务端从 Workspace 派生。AgentScope runtime workspace 是运行容器，不是协作 Workspace。 | 仅当前 Workspace 的 active WorkspaceMember 可访问；TenantMember 本身不代表加入其全部 Workspace。动态菜单是发现/导航 UI，不是 API 授权。 |

“个人 / 平台管理 / 租户管理 / Workspace 工作台”是导航的四个范围，不是四种互相继承的角色。面包屑、入口可见性和禁用态均不能替代每个请求的服务端授权。无权限时必须映射稳定 Problem 状态并避免透露无权资源的名称或存在性。不得将 Workspace 中的私有凭据/个人会话混为共享工作台资源；资源实际隐私属性由租户契约决定。

## 3. 桌面导航结构

推荐使用主分区加明确上下文，不再把所有功能塞进一个“系统”组：

```text
Synapse
[当前 Tenant / Workspace 切换器]

个人
  个人资料
  账号与安全
  外观
  通知
  显示

平台管理（仅平台管理员）
  租户目录
  全局用户

当前租户 · {Tenant 名称}（有当前 Tenant 上下文且具备相应读取权时）
  概览/成员与邀请
  角色与策略
  菜单
  部门
  字典
  参数
  系统任务

当前 Workspace · {Workspace 名称}（已验证 Workspace 上下文后）
  概览
  成员与设置
  工作空间业务（仅授权且已配置）
    AI 对话 / 智能体 / 会话 / 团队
    知识库 / 附件与文件
    模型与凭据 / MCP / Skills
    调度任务 / 渠道 / SOP / 人脸（按实际可用功能）
```

说明：

1. `/tenants` 是按可信角色呈现不同数据范围的入口：平台管理员视图明确标“平台租户目录”，普通账号视图明确标“我的租户”；两者不可被显示成同一套权限。当前无已选择 Tenant 时，不显示伪造的“当前租户”设置组。
2. Workspace 内的“附件”“模型与凭据”放在 Workspace 工作台对应类别；不得归入泛化“系统”。租户管理入口不重复塞入 Workspace 业务组。
3. 侧栏始终标明活跃范围；Tenant 管理页显示“租户管理 · {Tenant}”，Workspace 页显示“Workspace 工作台 · {Tenant} / {Workspace}”。避免仅以小图标、颜色或 ID 区分上下文。
4. 当前菜单结果按已验证的 actor、Tenant、Workspace、`membership_version` 绑定。Tenant 动态菜单与 Workspace 产品固定入口是不同来源；当 API 不能提供可信动作权限时，不得靠硬编码角色推断而展示操作。
5. 如果页面有未保存编辑，发起上下文切换前警告离开；若页面没有可丢失状态则不额外阻断。

## 4. 移动端导航

- 在 320、390 CSS px 下使用单一可打开/关闭的导航 Drawer；顶部放可读的当前 Tenant/Workspace 摘要与上下文切换按钮，底部提供个人菜单/账号入口。避免桌面侧栏被压缩成不可操作的横向导航。
- Drawer 内四个分区使用可展开标题，默认展开当前所在区；其他区可折叠。平台区仅对平台管理员显示；租户与 Workspace 分别显示名称上下文。动态业务项目可滚动，不把关键按钮放在必须横向滚动的位置。
- 切换器在移动端使用占满可视宽度、可滚动的 Dialog/Sheet，而非被侧栏边界裁切的 Popover。先按 Tenant 分组，再列其可访问 Workspace；每项可显示角色与“已归档”标记（仅对有权管理/查看归档的用户），提供搜索、当前项标识、关闭/取消操作。
- 切换后收起 Drawer/Sheet，将焦点转移到新页面主标题或主要内容起点，并以礼貌级 live region 宣布“已切换到 {Tenant} / {Workspace}”。不可只靠色彩、选中勾或视觉 Toast 告知状态。
- 移动端面包屑保留可返回的首级上下文与当前页；中间祖先可放入“返回上级”菜单，但不能仅隐藏到视觉不可访问。导航和 Sheet 的键盘、读屏焦点规则见第 9 节。

## 5. 上下文切换与路由行为

1. **进入个人范围**：`/settings/...` 当前可兼容保留，但导航名称明确为“个人”。该范围不自动附加最近 Tenant/Workspace，也不读取 Workspace 私有缓存。
2. **进入平台范围**：平台租户目录与全局用户按全局平台权限进入。`platform_admin` 不因浏览或创建 Tenant 自动成为该 Tenant 的成员；界面不显示“已进入 Tenant”除非有效成员/授权上下文确实存在。普通用户的 `/tenants` 只是自身租户列表，不代表平台管理能力。
3. **进入 Tenant 管理**：从已验证 Tenant 上下文的 Workspace 可点明确的“管理当前租户”；链接目标使用经服务端验证的 Tenant ID。无该 Tenant 上下文时先选择可管理 Tenant；不能以当前 Workspace 的 `owner/admin` 角色猜 Tenant 管理权。
4. **切换 Workspace**：列表仅从当前账号可访问目录返回的 active Workspace 中选择；归档空间仅对有权管理者作为只读管理/恢复入口显示，不提供普通工作入口。最近 Workspace 只是预选提示，必须重新验证 actor、Tenant 状态、TenantMember、Workspace 状态及 WorkspaceMember。切换成功后导航至新 Workspace 稳定路由入口；不把旧路径中的页面 slug 拼到新 Workspace。
5. **请求与缓存**：Workspace URL ID 是路由上下文；API 必须校验，不能把本地存储、切换器所选值或 header 当授权。query key 至少隔离 actor、Tenant、Workspace 和成员/上下文版本；切换或撤权时不能把迟到响应渲染到新上下文。清除/隔离仅影响 UI 查询缓存，不取消已提交的服务端后台任务。
6. **不再可访问的深链接**：若服务端返回 `401` 转登录且不盲目重放写操作；`403` 显示无该空间访问权限并给出可访问空间目录入口，不把 403 直接当作其他 Workspace 的允许证据；`404` 显示不可用资源/页面，不泄露名称；`409 TENANT_INACTIVE` 或 `WORKSPACE_INACTIVE` 显示停用/归档状态及返回入口；`400 CONTEXT_MISMATCH` 不自动改成用户最近空间，提示刷新或重新选择。具体 code 以 tenancy-contract 为准。

## 6. 动态菜单加载、失败与权限差异

动态接口是当前 Tenant/Workspace 成员可见导航的来源。菜单不可作为授权决策，也不得缓存/复用到其他 actor 或作用域。

| 状态 | 体验与行为 |
| --- | --- |
| 正在验证 Workspace | 显示“正在确认工作空间访问权限… / Verifying workspace access…”骨架或状态提示；在返回前不闪现该空间旧菜单、业务链接或敏感页面标题。 |
| 正在加载菜单 | 在业务导航区显示“正在加载工作空间导航… / Loading workspace navigation…”；允许用户访问已独立验证且不依赖动态菜单的固定导航，不显示空白空间或错误的“无功能”。 |
| 成功且非空 | 只展示响应 Tenant、Workspace 与 `membership_version` 与当前已确认上下文一致的树；保持后端顺序/层级，过滤接口明确标为不可见的节点；关联路径使用现有 TanStack Router 约束，不把外部 URL 当内部路由。 |
| 成功但空树 | 显示“此 Workspace 暂无已分配的工作模块。请联系租户管理员检查菜单与角色授权。 / No workspace modules are assigned yet. Ask a tenant admin to check menu and role access.”仅给出可确认存在且有权访问的管理联系/帮助入口；不得暗示用户无权功能可用。 |
| 请求失败/超时 | 显示内联错误“无法加载工作空间导航。 / Workspace navigation couldn’t load.”、重试按钮和返回 Workspace 目录入口。不要把 error 静默折叠为和空树相同状态；禁止展示上次跨上下文成功的菜单。 |
| 403/成员撤权 | 清除该上下文的动态菜单；显示权限不可用与返回可访问 Workspace 的操作，不推断 TenantMember 仍 active 就能进入。服务端仍拒绝具体动作。 |
| Tenant/Workspace 暂停或归档 | 按稳定 Problem code 呈现状态和恢复/联系管理员路径；不允许继续使用过期缓存。归档 Workspace 的管理只读入口遵循服务端角色授权。 |
| 部分动态入口失效 | 若单个路由或菜单项请求失败/返回 404，显示该模块的局部错误或不可用状态，并保留其他成功模块；不把局部失败当作整棵菜单空态，不自动重试有副作用操作。 |
| 版本/旧响应不匹配 | 丢弃而非渲染；刷新上下文和菜单。刷新仍冲突时进入可恢复错误，避免无限循环。 |

如果 API 响应没有 Workspace ID，而只是 Tenant ID、菜单与 `membership_version`，UI 至少必须先通过 `/workspaces/{workspace_id}` 验证得到服务端派生的 Tenant 与版本，再请求/呈现该 Tenant 的菜单；若契约将来改为 Workspace-scoped menu endpoint，先写兼容性及缓存迁移，不可在 UI 中自行猜定新 API。

## 7. 空态与恢复入口

- **无可访问 Workspace**：在“Workspace 工作台”区说明“此账号目前没有已加入的 Workspace。加入租户不代表自动加入所有 Workspace。 / You don’t currently belong to a workspace. Tenant membership doesn’t automatically grant access to every workspace.”提供“查看我的租户”与（仅 Tenant owner/admin）“创建 Workspace”；不可显示“全局用户”来解决无空间状态。
- **有 Tenant、没有 WorkspaceMember**：单独提示“你是 {Tenant} 成员，但尚未加入可用 Workspace。请让空间管理员授予成员资格。 / You’re a member of {Tenant}, but haven’t joined a workspace. Ask a workspace admin to grant access.”不把 Tenant 配置入口当作 Workspace 业务权限。
- **平台管理员无 Tenant 成员资格**：平台目录可用；Workspace 区显示“平台管理权限不会自动加入 Tenant 或 Workspace。 / Platform admin access does not automatically add you to a tenant or workspace.”只有真实授权的动作可用。
- **目录加载中/失败**：显示可辨认的 skeleton 或“无法加载 Tenant/Workspace 列表”及重试；不得把网络失败显示成“你没有权限”或无数据。目录成功为空才显示真实空态。
- **上下文不可用**：显示无需透露无权资源名称的说明、可访问目录链接和重试；未经用户确认不默默切到最近空间，以免写错作用域。
- 中英文对应术语固定：Tenant=“租户”，Workspace=“Workspace（工作空间）”首次并列说明后简称“Workspace”，平台=“平台”，个人=“个人”。同一切换器、面包屑、对话框和错误文案共享本地化来源，避免一处译为“工作区”另一处为“工作空间”。

## 8. 面包屑、搜索与命令入口

### 面包屑

- `/w/{workspace_id}/...`：`Workspace 工作台 > {Tenant 名称} > {Workspace 名称} > {当前页}`。租户名称和 Workspace 名称只能来自已授权目录/已确认 Workspace 响应；尚未加载时显示通用标签和加载状态，不使用裸 ID 冒充人类名称。
- `/tenants` 的面包屑/标题按服务端实际呈现的数据范围命名：平台管理员列表为 `平台管理 > 平台租户目录`，普通账号列表为 `租户管理 > 我的租户`；`/tenants/{tenant_id}/...` 为 `租户管理 > {Tenant 名称} > {当前页}`；全局用户为 `平台管理 > 全局用户`；个人为 `个人 > {账号/外观/通知/...}`。
- 面包屑每级只链接到同范围可访问的祖先；“Workspace 工作台”返回当前 Workspace 根，“租户管理”返回当前 Tenant 管理根，个人根返回个人资料。不要让 Workspace 面包屑链接到无权访问的 Tenant 页面。
- 小屏可以压缩视觉显示，但所有祖先必须仍可通过溢出按钮/上级菜单访问，并有完整 aria-label。末项 `aria-current="page"`；结构为有命名的 `nav` 和有序列表；分隔图标对读屏隐藏。

### 搜索与命令入口

- 顶栏全局 `Search` 和键盘命令入口（如 `⌘/Ctrl+K`）使用同一操作目录；目录分组为“个人”“平台管理”“当前租户”“当前 Workspace”，可搜索当前用户可见的页面与明确允许搜索的对象。
- 命令面板显示命中项所属范围及 Tenant/Workspace 名称，执行前若要切换范围须明确展示并确认；搜索不得跨越未授权 Tenant/Workspace，不将隐藏菜单名称、其他用户资料或私有资源作为结果提示。
- 列出“切换 Tenant/Workspace”“去个人设置”“查看我的租户”“去平台租户目录（平台管理员）”“管理当前租户（有权限时）”“打开当前 Workspace 模块”等安全导航命令。无权操作不列为可执行命令；如需解释权限，只给非敏感通用说明。
- 当前 `Search` 的具体搜索 API、对象覆盖和范围尚需在命令入口实施任务中核对；本设计不宣称现有 Search 已是完整命令面板。快捷键可用按钮说明发现，不能是唯一打开方式；输入控件必须支持键盘、IME 和移动触屏。

## 9. 可访问性、焦点与错误提示

- 语义化 `<nav aria-label>`，主导航分组使用标题/列表结构；当前页设 `aria-current="page"`，图标标为装饰性，图标按钮有本地化名称；不以颜色/形状作为角色或选中状态的唯一指示。
- 切换器与命令面板使用有标题/描述的 Dialog/Combobox 模式；支持 Tab、Shift+Tab、方向键、Enter、Escape；搜索字段有标签，选择项可读出完整 Tenant、Workspace、角色及状态。打开时焦点进入标题或搜索框，关闭后归还触发器。
- 目录和动态菜单加载通过 `aria-live="polite"` 播报一次；操作成功礼貌播报新上下文；权限、上下文和网络错误通过一次 `role="alert"` 或等价摘要播报，并在用户触发重试前避免反复播报。切换后焦点落在新内容标题；直达路由拒绝时焦点落在错误标题/状态摘要。
- 可触控目标建议至少 44×44 CSS px；文字缩放到 200% 与 320 CSS px 宽下无关键操作丢失，无横向页面滚动。焦点指示清楚且不被 Drawer、Popover 或 sticky header 遮挡。
- 用户可见文本均有中英翻译；动态 Tenant/Workspace 名称须作为文本安全显示与读屏朗读，错误不泄露未授权对象。测试键盘完成切换/重试，至少以 NVDA 或同等屏幕阅读器核对主要流程。

## 10. 最小实施文件范围

以尽量复用现有组件/数据契约为原则，实际开发任务分派时遵守文件范围，不在本设计任务修改产品实现：

1. `apps/web/src/components/layout/app-sidebar.tsx`：从 Workspace 组中剥离平台/租户/个人混搭，组合四个范围的分区；动态菜单状态可见化；按当前上下文形成层级，不在本文件复制权限逻辑。
2. `apps/web/src/components/layout/data/sidebar-data.ts` 与必要的 `apps/web/src/components/layout/types.ts`：把静态入口数据表达为范围分区；动态租户菜单和产品 Workspace 菜单来源分清，避免标题字符串判断作为唯一权限模型。
3. `apps/web/src/features/workspaces/directory.tsx` 与必要的 `apps/web/src/features/workspaces/types.ts`：复用目录和切换查询；统一 Tenant/Workspace 术语、最近项提示、空/错/加载态、手机 Dialog/Sheet 与焦点恢复。服务端目录仍是可访问项真源。
4. `apps/web/src/components/layout/app-header.tsx`：重构按路由/已验证上下文生成的面包屑层级、可访问小屏祖先及通用加载/拒绝表现；不从 URL slug 直接推断权限。
5. `apps/web/src/components/search.tsx`（现存 Search 入口，须先核实其 API 与 scope 支持后再改动）与最小化令牌/快捷键组件：只有在现有搜索机制核实支持后，增加范围感知命令入口。若 Search 无可复用契约，将命令面板列为后续独立切片，不扩大到首页或业务功能。
6. 本地化文件（实际来源需从 `apps/web/src/lib/i18n.ts` 及消息表确认，最小必要项）：四个范围、切换器状态、菜单失败、空态、错误、焦点播报的英文/中文文案。
7. 对以上导航行为新增/更新对应前端单测及限定浏览器验收材料；后端只有在已确认的导航契约确有缺失时才另开契约任务，不将整个菜单 API 重写混入前端任务。

排除：`apps/web` 首页/仪表盘重设计；移除或整理旧演示路由、Faker、许可证审查（F43）；重写授权、Tenant/Workspace 数据模型；全局搜索后端或 API 大范围设计；与导航无关的租户业务页面。任何扩展须由协调者单独拆分。

## 11. 分期实施顺序

| 阶段 | 内容 | 交付门槛 |
| --- | --- | --- |
| 0. 契约冻结 | 协调者确认四分区术语、个人路由是否继续兼容、Tenant 管理入口从何处可达、空树和失败状态、Search 是否仅做导航命令。检查现有动态菜单 response fields，不推定接口提供了未声明的 role/action/Workspace ID。 | UX 方案作为实施输入；若须改变 URL/API/权限则先另写兼容、迁移及回滚契约。 |
| 1. 结构与上下文 | 先调整侧栏静态/动态分组和 Tenant/Workspace 切换器；平台、个人入口不依赖 Workspace；验证访问上下文后才呈现上下文菜单；处理已验证的空态/目录错误。 | 桌面/手机有一致四分区模型；所有入口仍走原服务端权限。 |
| 2. 动态菜单可靠性 | 加入验证、加载、成功空树、网络/403/版本冲突状态、局部失败与重试；确保旧查询不能闪现或跨作用域展示。 | 租户撤权、并发切换和晚到响应不泄露；错误能恢复且不等同空树。 |
| 3. 面包屑与移动完成 | 层级按真实上下文生成；小屏提供祖先导航；调好菜单/切换焦点与播报、键盘、触控及 i18n。 | 中英文文本完整；320/390px 和读屏导航无关键操作丢失。 |
| 4. 命令入口（独立可延期） | 核对现有 Search 组件与数据/API 契约后，增添范围分组的页面命令；暂不纳入跨资源全局搜索。 | 如果 Search 契约不明确或需后端扩展，暂停此阶段并另行定义任务，不阻塞阶段 1–3。 |

实施期间按功能切片分别指派实现者和独立 UX/验收者；本文件只提供方案，不替代独立验收。不要用一次全项目构建或健康检查宣告导航功能完成。

## 12. 逐条验收条件

1. **分区与入口**：普通成员/平台管理员分别登录；普通账号不看见平台管理；平台管理员看到租户目录和全局用户；个人始终可达；在 Workspace 路由不再出现“系统”组里的租户管理或重复入口。附件、模型、MCP、AI 项目均明确归属 Workspace 工作台。
2. **权限隔离**：准备平台管理员但无 TenantMember、Tenant owner/admin 但未加入目标 Workspace、Tenant member 加入部分 Workspace、Workspace viewer/admin 等测试账号。平台管理员不得由平台角色自动获取租户/空间资源；TenantMember 不可访问未加入空间；不同 Workspace owner/admin 与 Tenant owner/admin 不互相推导；UI 隐藏/显示只验证导航，不替代直接 API 的 401/403/404/409 服务端检查。
3. **切换器**：跨多个 Tenant 的可访问 Workspace 按 Tenant 分组、能搜索、可读角色/归档状态；切换只导航到目标 Workspace 根；最近项失效、Tenant suspended、成员 removed/suspended 时重新验证并拒绝，不使用缓存绕过；切换后旧路由和查询响应不出现在新空间。
4. **动态菜单加载**：未验证时无旧链接闪现；请求中有加载反馈；非空树只显示正确 Tenant/Workspace/version；空树说明菜单/角色分配且有合法求助方式；网络错误有重试；403 撤权移除旧菜单；版本不匹配丢弃并有限重验；单项失败不掩盖其他项。记录每一状态的真实 API 或明确标记的模拟，不把模拟当真实权限验收。
5. **失败与恢复**：分别覆盖 401、403、404、400 `CONTEXT_MISMATCH`、409 Tenant/Workspace inactive、超时/断网、重试成功、权限撤销和目录接口失败。文案不泄露无权资源；不会静默跳到最近 Workspace；成功恢复前无过期业务数据或凭据闪现。
6. **面包屑/路由**：覆盖 `/settings/...`、`/users`、`/tenants`、`/tenants/{id}/...`、`/w/{id}` 和嵌套 Workspace 页面；每个祖先可访问且链接保持正确 scope；Tenant 与 Workspace 名称由授权数据呈现；不存在时用通用标题，不原样暴露 ID；小屏祖先可操作。
7. **移动端**：在 320/390 CSS px 验证 Drawer、切换 Sheet、长名称、很多菜单项、错误/空态、滚动、触控目标、200% 字号；无裁切、横向溢出，关键动作可达。
8. **键盘与读屏**：仅键盘打开/搜索/选项/切换/关闭/重试；焦点打开时进入、关闭时返回、切换时落到内容标题、错误时落到摘要；NVDA 或等价屏幕阅读器能辨认分区、当前页、完整 Tenant/Workspace 名称、角色、加载/错误状态和可用恢复操作。
9. **中英文和术语**：上述四分区、动态菜单状态、切换器、面包屑、失败/空态、命令说明全部有英文与中文；术语“Tenant/租户”“Workspace（工作空间）”一致，切换、菜单、通知与屏幕阅读器无遗漏文本。
10. **命令入口（若本期实施）**：键盘和可见按钮均可打开；命令按四个作用域分组且显示当前上下文；不会返回/显示越权结果；跨上下文命令明确展示目标并遵循未保存更改保护。若依赖未定 API，则此条标记延期，不得用静态演示结果判通过。
11. **台账与证据**：协调者为每阶段更新 `docs/development-status.md`；独立验证报告写 `docs/verification/`，逐条列测试身份/数据、真实 API/浏览器证据、模拟部分与局限。历史 F10/F13d2/F11a 结果可引用为背景，不替代本契约验收；F43 演示路由清理状态保持独立。

## 13. 待协调者确认项

- 全局账号页面现有 `/settings/...` 是否保留作为“个人”主入口；本设计默认保留以降低路由迁移风险。
- 租户管理员/成员哪些租户级入口可用以及平台管理员对租户详情的只读/管理边界，应逐项依据实际 service permission 集合核实；UI 不创造权限。
- 当前动态菜单 response 未见 `workspace_id` 字段；确认继续“先校验 Workspace，再读 Tenant menu tree”，或另行设计 Workspace-scoped API。未经契约变更不可前端改猜。
- 当前 `/search` 能力是否支持按当前 scope 搜索；本设计只提议命令面板导航，不假定已有范围安全的全局对象搜索。
- `workspaceSystemGroups` 中固定业务链接和租户动态菜单的功能重叠/来源，实施阶段按现存功能逐项盘点并选择唯一入口，不能将删项扩大到演示路由或业务功能。

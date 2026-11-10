# F44 Workspace 工作台与空间概览 UX 审查

状态：UX/API 契约设计，不是实现或独立验收。F44 在 [development-status.md](../development-status.md) 中仍为待开始。

## 依据与结论

- [租户契约](../tenancy-contract.md)是身份隔离唯一权威：全局账号、TenantMember、WorkspaceMember 独立；tenant 由服务端从 Workspace 派生；`X-Workspace-ID` 只是上下文提示；最近空间只供导航恢复。
- 依[租户优化原则第 2、3、7 节](../tenant-optimization-principles-and-gap-review.md)，先定归属、权限、API、失败行为、验收证据，再实现。
- [根路由](../../apps/web/src/routes/_authenticated/index.tsx) 当前按最近空间或首个 active Workspace 自动跳转；[Workspace 首页](../../apps/web/src/features/workspaces/pages.tsx) 只有身份、归档提示和业务入口，没有真实概览聚合 API。[上下文守卫](../../apps/web/src/features/workspaces/context.tsx) 对部分 `403/404/409` 自动切换其它空间，易混淆撤权、不可见和上下文冲突；[目录实现](../../apps/web/src/features/workspaces/directory.tsx) 还将最近空间保存在浏览器本地。

**决定：** 登录后 `/` 是稳定工作台；不自动进入最近/首个/唯一 Workspace。用户显式点击“进入/继续”才导航。直接访问 `/w/{id}` 保留 URL，由服务端验证。最近空间不是授权凭证或默认上下文。

## 1. 页面职责与导航

**根工作台 `/`：**回答“我能访问哪些租户和空间、下一步做什么”。显示账号摘要及按租户分组的可访问 Workspace；每项同时显示租户名、空间名、状态、空间角色，避免同名歧义。active 与 archived 分区。提供进入、继续上次、查看租户、重试目录；创建仅在租户 owner/admin 并获服务端授权时提供。TenantMember 不代表加入所有空间；`platform_admin` 不自动成为成员或获得业务数据权限。根页不聚合跨空间聊天/凭据/文件，也不把个人私有资源改成共享数据。

**Workspace 首页 `/w/{workspace_id}`：**显示经服务端验证的租户、Workspace、slug/图标、状态、当前角色；更新时间仅在 API 提供时显示。展示有定义和权限的数据及可用业务入口。界面隐藏按钮不能替代服务端授权。归档、撤权、上下文错误、部分失败时留在当前语境，不静默切换。个人私有资源按 `owner_user_id=actor_user_id` 隔离，除非有显式共享授权。

| 情况 | 规则 |
| --- | --- |
| 登录后到 `/` | 加载后仍留工作台；不因最近/首个/唯一空间跳转。 |
| 用户选择空间 | 显式导航至 `/w/{id}`；验证成功后更新最近空间提示。 |
| 直接访问空间 URL | 保留 URL，由服务端验证账号、tenant/workspace 状态、两类成员资格和权限。 |
| 不可访问/归档/不存在/上下文冲突 | 显示对应反馈和返回工作台/重试；不自动切换别的空间。 |
| 最近空间无效 | 隐藏/禁用推荐；不得以 localStorage 对象绕过授权。 |
| 目录失败 | 留在工作台，明确失败范围并重试；不误报“无空间”。 |

## 2. 信息层级、权限和状态

- 根页 P0：租户/空间身份和角色、active/archived 分组、显式进入/继续、加载/空/错误/重试；搜索租户名、空间名、slug。轻量摘要仅用目录 API 明确字段，不从分页数据推算指标。
- 空间页 P0：租户名、空间名、状态、角色后才是概览；P1 常用业务入口；待处理/最近活动须有后端定义、来源、权限、时间范围和排序；P2 管理动作按角色显示并说明影响。
- 每张概览卡需有标签、值/状态、Workspace 作用域、目标动作、更新时间（若有）及不可用原因。`null`、未实现、无权限、失败不等于 `0`。

| 状态 | 页面行为 |
| --- | --- |
| 多租户/多空间 | 根页按租户分组；空间页标明当前 Tenant/Workspace；缓存按 actor/tenant/workspace/membership version 隔离。 |
| 单空间 | 仍停留根页，显式点击后进入。 |
| Tenant member 未加入 Workspace | 只列真实可访问空间；不得从 TenantMember 推导 WorkspaceMember。 |
| viewer/member/admin/owner | 显示服务端角色；viewer 只读，其他操作依权限；服务端最终裁决。 |
| platform_admin 非成员 | 仅平台授权管理入口；不得访问空间业务数据。 |
| 无空间/仅归档 | 无空间时说明并提供查看租户/联系管理员；创建入口须有权。归档单列，不自动进入；普通成员不展示无权管理动作。 |
| 目录部分失败 | 成功目录保留，失败目录独立提示和重试；不误报为空。 |
| 详情/概览加载 | 验证当前 URL；先呈现已验证身份，再独立加载卡片；不导航到替代空间。 |
| 概览部分失败 | 成功卡片继续显示；失败卡片局部提示并重试，不填 0、不阻断其它入口。 |

- `401 AUTHENTICATION_REQUIRED`：按全局流程重新认证并清理私有缓存。
- `403 FORBIDDEN` / `MEMBERSHIP_INACTIVE`：说明身份或动作无权，提供返回工作台，不自动换空间。
- `404 RESOURCE_NOT_FOUND`：无法确认/访问目标，不泄露其它租户资源是否存在。
- `400 WORKSPACE_CONTEXT_REQUIRED` / `CONTEXT_MISMATCH`：按请求上下文错误处理，不混为撤权。
- `409 TENANT_INACTIVE` / `WORKSPACE_INACTIVE`：说明租户/空间不可用，不展示依赖 active 上下文的业务卡。
- 使用租户契约稳定 Problem `code` 和 `request_id`；本地化错误，不把原始 `detail` 当唯一文案，不利用 403/404 探测资源。

## 3. 概览数据与 API 契约

### 当前有证据的内容

- 当前目录和 Workspace 详情可提供租户/空间名称、标识、状态、当前角色和成员版本；根页应只展示 API 明确返回且当前用户有权看到的目录字段。
- Workspace 首页现有“空间资源”是功能入口（智能体、会话、团队、附件、知识等），不是概览统计。F44 仍为待开始，当前没有 Workspace 概览聚合 API，也没有经确认可直接显示的业务指标清单。
- 因此首次交付不得用模板数字、演示值或客户端按分页结果拼出的总数填卡。业务统计在定义和来源通过评审前不渲染；空、未实现、无权限、失败均不得伪装成 `0`。

### 卡片优先级与数据发布门槛

| 优先级 | 信息 | 发布条件 |
| --- | --- | --- |
| P0 | 当前租户/Workspace 身份、状态、空间角色及已存在业务功能入口 | 使用目录/详情 API 的已授权字段；明确 workspace 作用域。 |
| P1 | 经业务负责人确认、可直接推进工作的真实业务概览 | 每个指标先登记名称与定义、归属（Workspace 共享或个人私有）、真实服务端来源、权限过滤、范围/时间/时区、刷新延迟、空值和错误语义、目标路由；聚合由后端提供。 |
| P2 | 最近活动、待处理事项、趋势或管理提醒 | 仅在各自业务定义、排序/时间范围、访问角色和稳定数据来源均获确认后加入；未确认时不显示占位卡。 |

智能体数、会话数、文件数、团队数、活跃度、增长率和健康分目前都不是已批准指标。即使其领域已有页面或分页 API，也不得推算成概览数据；须先确认业务含义和后端聚合来源。个人凭据、会话或其他私有资源不并入 Workspace 共享卡，除非存在明确共享授权。

### 拟议 API（尚未实现）

建议评审新增 `GET /api/v1/workspaces/{workspace_id}/overview`，不得视为现有能力。请求由认证账号发起，携带与路径一致的 `X-Workspace-ID`；服务端从 Workspace 派生 `tenant_id`，验证账号、Tenant/Workspace 状态、active TenantMember、active WorkspaceMember 及每项数据读取权限，禁止客户端提供 tenant_id 覆盖作用域。归档 Workspace 的读取范围和各角色行为须先按契约确认；未经确认不得返回业务卡或暗示可恢复/可管理。

响应至少须携带已验证的 Workspace/Tenant 身份、状态和当前角色；如适用，带 `context_version` / `membership_version` 与快照生成时间。卡片仅用经批准清单中的稳定 `key`，并提供明确状态、按业务定义类型化的值/单位（仅有值时）、更新时间和必要的本地化原因码。值 `0` 仅表示定义明确的真实零；空结果、不可用、尚未支持和无权限必须可区分。对调用者无权读取的卡，不返回可探测资源存在性的细节；逐卡失败不阻断其它成功卡。

错误遵循租户契约的 Problem `code` / `request_id`：`401 AUTHENTICATION_REQUIRED`、`403 FORBIDDEN` / `MEMBERSHIP_INACTIVE`、`404 RESOURCE_NOT_FOUND`、`400 WORKSPACE_CONTEXT_REQUIRED` / `CONTEXT_MISMATCH`、`409 TENANT_INACTIVE` / `WORKSPACE_INACTIVE`。前端按本地化 key 映射通用反馈，不直接展示原始 `detail`。缓存至少按 actor、tenant、workspace、资源和契约支持的上下文/成员版本隔离；成员、角色或状态变化后旧缓存必须失效。未确认的数据源或权限边界未能安全区分时，宁可不显示该卡。

现有 `GET /api/v1/me/context`、`GET /api/v1/tenants`、`GET /api/v1/workspaces` 和 `GET /api/v1/workspaces/{workspace_id}` 可用于工作台目录及已授权身份读取；它们不等同于 overview 聚合端点。成员列表 `total` 至多代表已定义范围内的成员数，不得推导其他指标；不得在前端拼分页接口计算未定义总数。
## 4. 移动端、无障碍与文案

移动端根页单列租户分组，空间项显示租户名；长文本截断时保留完整可访问名称。切换器采用底部/全宽弹层、置顶搜索，按租户/空间/slug 搜索，关闭恢复触发器焦点。空间首页单列，身份状态优先；触控目标至少 44×44 CSS px。关键错误在卡内显示，慢网可重试且不跳转；操作不依赖 hover。

每页唯一 `h1`，语义标题层级；加载状态通过 polite live region 宣告，错误通过 alert 语义宣告，状态不只用颜色/图标。键盘可达、焦点顺序合理；弹层有标题描述并恢复焦点。数值标签、归档/只读/无权可整体朗读。支持 `prefers-reduced-motion`。中英文状态语义相同；API key 与翻译 key 分离，缺词不显示原始 code。

| 场景 | 中文 | English |
| --- | --- | --- |
| 根页 | 工作台；选择一个 Workspace 开始工作 | Workbench; Choose a Workspace to get started |
| 继续/查看 | 继续上次访问的 Workspace；查看全部 Workspace | Continue to your last Workspace; View all Workspaces |
| 加载/失败 | 正在加载租户和 Workspace…；无法加载 Workspace 目录，请重试。 | Loading tenants and Workspaces…; We couldn’t load the directory. Try again. |
| 空/归档 | 当前账号没有可访问的 Workspace；已归档，不会自动进入。 | No accessible Workspaces; Archived, not opened automatically. |
| 进入/概览 | 进入 Workspace；Workspace 概览 | Open Workspace; Workspace overview |
| 卡片失败/返回 | 暂时无法加载；返回工作台 | Temporarily unavailable; Back to Workbench |
| 权限/上下文 | 当前账号无权访问此 Workspace；Workspace 上下文不一致，请重新打开此页面。 | This account can’t access this Workspace; The Workspace context doesn’t match. Reopen this page. |

以上为本地化基线，使用现有 i18n，不把 API code 作为界面文案。

## 5. 实施前置与验收

实施前：确认无自动进入决策；确认 archived 角色权限（现有契约未完整定义归档读取能力，不能推测）；逐卡登记 key/归属/定义/来源/权限/空值/时间和路由；冻结聚合契约、Problem code、快照及版本失效规则；真实依赖缺失标待验收。

验收条件：

- [ ] `/` 对最近/首个/唯一空间都不自动导航；显式点击后才进入。
- [ ] 多租户/多空间/同名空间、未加入空间、platform_admin 非成员、viewer/member/admin/owner 有独立可重复用例。
- [ ] 无空间、仅归档、目录部分失败、概览逐卡失败、重试不会误报为空、无权或 0。
- [ ] `401/403 FORBIDDEN|MEMBERSHIP_INACTIVE/404/400 WORKSPACE_CONTEXT_REQUIRED|CONTEXT_MISMATCH/409 TENANT_INACTIVE|WORKSPACE_INACTIVE` 对应反馈正确；不自动切换空间。
- [ ] 每个数值可追溯到已冻结业务定义、真实来源及时间语义；无模板指标/虚构数据/前端拼凑总数。
- [ ] 定向验证移动端、键盘/触控、焦点、屏幕阅读器、颜色对比和减少动态效果。
- [ ] 独立报告放 `docs/verification`，逐条列证据、账号作用域、浏览器尺寸、真实/模拟接口和局限；独立验收前 F44 不标完成。

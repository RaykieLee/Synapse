# 命令搜索与全局导航 UX / 契约审查

状态：独立 UX 设计审查与可实施契约；不是产品实现，也不构成独立验收。本文只定义搜索入口如何与现有导航、授权上下文和动态菜单同步。

## 审查依据与结论

- 身份与隔离以[租户和 Workspace 契约](../tenancy-contract.md)为准：全局账号、TenantMember、WorkspaceMember 相互独立；Tenant 由已验证 Workspace 派生；最近 Workspace 仅用于导航提示，不是授权。工程检查点按[跨模块标准第 2、3、7 节](../tenant-optimization-principles-and-gap-review.md)执行。
- 当前 `command-menu.tsx` 直接枚举静态 `sidebarData.navGroups`，然后附加主题命令；它不消费 AppSidebar 根据当前路由和授权上下文组装的导航，也没有 Workspace/Tenant 上下文提示。输入框仍显示英文模板，动态来源缺失会被误呈现为普通无结果。
- 当前 AppSidebar 在校验 Workspace 详情后，从 `GET /api/v1/tenants/{tenant_id}/menus/visible-tree` 读取当前 Tenant 可见菜单。响应含 `tenant_id`、`membership_version` 和嵌套 `items`；后端依据成员角色/菜单授权、启用/可见/未删除状态过滤，并剔除没有合格祖先的子项。该端点返回 `Cache-Control: private, no-store`。前端菜单查询 key 带 actor、tenant、workspace 和 `membership_version`，数据仅在上下文及版本吻合后用于侧栏。
- 当前 `TeamSwitcher` 从账号作用域的租户/Workspace 目录分组并搜索可访问空间；归档空间只向 owner/admin 展示。最近空间来自按账号分隔的 localStorage，但必须先与服务端目录/当前上下文核对，不能单独作为可搜索授权数据。
- 当前实现只能证明侧栏与切换器各自的范围，不表示命令搜索已经具有这些能力。本契约要求搜索复用同一来源、校验规则与本地化标签，避免平行维护另一份导航。

## 入口与范围

### 名称与用户预期

- 产品名称采用“快速导航” / “Quick navigation”，不称“全局搜索” / “Global search”。入口是应用头部现有按钮及 `⌘K` / `Ctrl+K` 快捷键；打开后标题、输入框和屏幕阅读器名称均说明这是导航搜索。
- 输入提示：“搜索页面或工作空间…” / “Search pages or workspaces…”；说明：“仅搜索你有权访问的导航，不搜索内容。” / “Searches accessible navigation—not content.”
- 提供两类可执行结果：**导航目的地**（当前实际可用的静态应用页、当前 Tenant 租户设置、当前已验证 Workspace 动态菜单和固定系统页）及**空间切换**（服务端目录中当前账号可访问的 Tenant/Workspace，选择后进入该 Workspace）。当前身份/路由不适用的类别应省略，而非显示不可用的伪结果。
- 主题切换等现有命令可保留为明确的“命令” / “Commands”分组；它们是动作而非搜索数据。只显示当前导航构造器确认存在、且该身份/Workspace 当前可用的入口，不假定 AI 功能永久存在。

### 搜索对象与本期边界

| 对象 | 本期行为 | 数据来源与约束 |
| --- | --- | --- |
| 静态应用导航、全局平台管理、个人设置 | 导航 | 复用 AppSidebar 已本地化、已做角色限制的项；平台管理员限定项仍须角色条件成立。个人资料/账号只链接当前账号设置。 |
| 租户配置导航 | 导航 | 只显示路由中且已验证的当前 Tenant；成员仅有现行租户成员页，owner/admin 另有允许的设置入口。不可混入其它 Tenant 菜单。 |
| 动态 Workspace 菜单 | 导航 | 只使用当前已确认 Workspace 的 visible-tree；保留祖先面包屑；不纳入管理菜单树及隐藏、停用、未授权条目。 |
| Workspace 固定系统导航 | 导航 | 仅限当前已验证 Workspace 下 AppSidebar 实际显示的系统页；采用相同 feature/role 可用性条件，不从路由清单猜测功能已启用。 |
| Tenant/Workspace 名称与 slug | 切换/导航 | 只来自 `useWorkspaceDirectory` 的已授权结果；Tenant 名称只能显示在有权查看的分组。归档项沿用目录规则，仅 owner/admin 可见。选择后走现有 Workspace 路由/上下文验证，localStorage 不是凭据。 |
| 主题、语言等显式本地命令 | 执行动作 | 保留为命令，不作为业务资源，不改变授权上下文。 |
| 会话、聊天、Agent 运行记录、知识库/附件正文、成员/用户、任务、MCP/Skills Hub 内容、外部网站内容 | **本期不搜索** | 各业务页自己的搜索不等于纳入此入口。全文/跨实体搜索须另行定义资源归属、作用域、权限、服务端筛选/分页、隐私及 API 契约。 |

本期不新增通用搜索后端、索引、跨资源全文端点或搜索 API；仅在已授权导航/目录候选上客户端过滤。搜索动态业务菜单命中的是标签/路径元数据并导航，不会搜索页面数据或内容。

## 上下文与权限

- 打开及路由/身份切换后，以 `actor_user_id` 和 TanStack Router 当前路径重新解析 `global`、`tenant:{tenant_id}` 或 `tenant:{tenant_id}:workspace:{workspace_id}`。scope 仅源自服务端确认的上下文，不从 query string、localStorage 或客户端自报字段构造。
- Workspace 页显示“当前空间：{Workspace} · {Tenant}” / “Current workspace: {Workspace} · {Tenant}”；租户页显示“当前租户：{Tenant}” / “Current tenant: {Tenant}”；全局页显示“全局导航” / “Global navigation”。解析中或无法确认时不显示旧名称/旧菜单。
- Workspace 切换项限服务端账号目录，沿用 `directory.tsx` 的租户分组及 archived 可见规则。最近空间只可作为排序/建议，不能增加候选。切换仍走现有路由及 API 校验。
- 静态项采用 AppSidebar 相同角色/功能过滤；租户项受当前 Tenant 角色限制；动态项由 visible-tree 服务端过滤。UI 显隐只帮助发现，不构成安全边界；目的地 API 仍逐请求检查账号、作用域状态、成员和动作权限。直达 URL/旧搜索结果不得绕过拒绝。
- 仅索引成功返回的服务端可见 `items`。成功空菜单表示当前范围没有额外动态菜单，不暗示隐藏菜单存在或泄露其名称/ID；空结果和加载失败必须区分。
- TanStack Query key 遵循 tenancy 契约：菜单至少为 `['synapse', actorUserId, tenantId, 'tenant-navigation', workspaceId, membershipVersion]`；目录使用 actor 隔离的全局/个人 key。Workspace/Tenant/membership version 改变、退出或授权失效时旧结果立即不可见；迟到响应只能写回原 key，禁止跨 scope 共享菜单缓存。

## 加载、错误和空状态

| 状态 | 展示和行为 |
| --- | --- |
| 尚无查询字词 | 显示当前范围标签、常用目的地/最近可访问空间（仅从已授权候选中挑选）和快捷键说明；不显示“无结果”。 |
| 正在确认 Workspace/Tenant 上下文 | 隐藏动态 Workspace/Tenant 结果，显示“正在确认当前空间…” / “Verifying current workspace…”。不得闪现上一路由的菜单或旧作用域名称。 |
| 上下文已验证、动态菜单请求进行中 | 已确认的全局/个人/固定项可继续使用；动态项显示独立加载状态“正在加载空间导航…” / “Loading workspace navigation…”，不能当作零结果。 |
| 菜单或目录加载失败 | 按来源标记部分可用：“部分导航暂时无法加载。” / “Some navigation is temporarily unavailable.” 提供“重试” / “Retry”；仍可用已确认来源。错误不替代安全结果，也不改写成“无权限”或“没有结果”。 |
| 授权/上下文请求被拒绝或过期 | 立即隐藏受影响 scope 的私有候选；按 Problem code/认证状态走既有登录、范围错误或恢复流程。错误不泄露资源存在性；不得静默切到最近空间或其它 Tenant。 |
| 查询无匹配 | “没有匹配的可访问页面或空间。” / “No accessible pages or workspaces match.” 提供清空查询；不暗示隐藏结果存在。 |
| Workspace 目录成功但为空 | “当前账号还没有可访问的工作空间。” / “No workspaces are available to this account.” 可链接已有租户/空间目录入口；无确切申请/创建权限时不显示申请或创建 CTA。 |
| 成功加载且无可见动态菜单 | 查询为空时说明“当前空间没有其他导航项。” / “No additional navigation is available in this workspace.” 不展示无权项。 |
| 目标页导航后遭服务端拒绝 | 关闭弹层并交由目的页现有授权错误映射处理；保留标准 `code`/`request_id` 诊断能力，不把菜单可见性视作通行凭证。 |

部分成功必须可见：例如 Workspace 菜单失败但全局设置仍可用时，清楚标记 Workspace 导航未加载，不能以部分结果冒充完整搜索。对 `401` 使用已有认证过期流程；对 `403`、`404`、`409` 按 tenancy 稳定 Problem code 与既有标准处理，不把成员撤销、动作无权、资源不存在和范围停用合并，也不在本功能另造错误码。

## 键盘、读屏与移动端

- `⌘K` / `Ctrl+K` 打开/关闭。快捷键处理忽略 input、textarea、select、可编辑区域、组合输入（IME）和被其他模态/菜单占用的按键，避免业务输入时误触。
- 使用标准命令列表键盘交互：`↑/↓` 移动，`Home/End` 首末项，`Enter` 激活，`Escape` 关闭并还焦触发器。若组件不支持 Home/End，实施前补齐或明确以标准列表按键代替并在验收记录。选择后关闭弹层；内部导航使用 TanStack Router，外部目的地（如有）明确标记并安全新开标签。
- 对话框有可访问名称/描述；输入有显式 label，结果使用 listbox/option 或等效命令语义，包含目的地、分组/面包屑和必要的新标签提示。当前页面/Workspace 用可读状态标记，不只靠图标或颜色。
- 加载、结果数/无结果、部分失败通过一个 `aria-live="polite"` 状态适度播报；需要恢复的错误用 `role="alert"` 一次播报。避免逐键朗读整个候选列表或重复播报。关闭后焦点回触发器；路由切换时焦点由目的页标题/主内容管理。
- 320/390 CSS px 下弹层不超视口、列表可滚动；长标题可换行/截断并保留完整 accessible name；面包屑/权限错误不依赖 hover。触控目标易点按，快捷键提示可隐藏但按钮仍可触达，无键盘时可由头部按钮打开。
- 中英文文案跟随当前 locale；动态菜单、租户、Workspace 名称保留原文，不做不可靠的机器反向翻译。匹配当前显示标题、已有翻译别名、父级面包屑及空间/Tenant 名称；英文忽略大小写，中文支持子串。不得把权限标识、数据库 ID 或隐藏路径作为用户可见建议。

## 前后端状态/API 契约

### API / 服务边界

- 复用现有 `GET /api/v1/tenants/{tenant_id}/menus/visible-tree`；认证、过滤规则、字段和 `private, no-store` 响应头保持不变。本期不增加通用 search 参数、全文索引或 endpoint。
- 复用 workspace/tenant directory 现有查询；目录范围及 archived 过滤不变。个人/全局设置和当前 Workspace 系统导航由 AppSidebar 现有构造逻辑提供，平台角色/功能条件沿用其唯一事实来源。后端按已验证上下文返回授权目录/菜单，不因搜索词扩大授权。
- 菜单 JSON 保持现有字段：`menu_id`、`parent_id`、`menu_name`、`path`、`component`、`query`、`is_frame`、`is_cache`、`menu_type`、`perms`、`icon`、`children`；菜单/资源 ID 保持十进制字符串。搜索只需要导航元数据，不新增业务对象详情或权限全集。
- 若 API 不能提供构建当前侧栏所需的真实可见项，先记录具体字段/权限缺口并另行提出服务端契约扩展；不得由前端猜权、枚举隐藏菜单或假造返回值。

### 前端归一化模型与状态

建议建立单一纯前端归一化模型，供 Sidebar 与快速导航共同消费，避免重复组装静态、租户和 Workspace 菜单：

```ts
type NavigationScope =
  | { kind: 'global'; actorUserId: string }
  | { kind: 'tenant'; actorUserId: string; tenantId: string; membershipVersion: number }
  | { kind: 'workspace'; actorUserId: string; tenantId: string; workspaceId: string; membershipVersion: number }

type NavigationEntry = {
  id: string
  title: string
  titleAliases: string[]
  groupTitle: string
  breadcrumb: string[]
  href: string
  kind: 'route' | 'workspace-switch' | 'command'
  external?: boolean
  current?: boolean
}

type SearchSourceState<T> =
  | { status: 'idle' | 'loading'; scopeKey: string }
  | { status: 'success'; scopeKey: string; data: T }
  | { status: 'error'; scopeKey: string; error: ApiProblem | Error }
```

- `scopeKey` 是 actor + 精确 scope + membership/context version 的稳定键；每条来源状态携带该 key。渲染前与当前 key 比较，不相符即隐藏，不能只依赖 Query 刷新。
- 聚合状态区分 `context: resolving|ready|error`、`dynamicMenu: idle|loading|success|error`、`workspaceDirectory: idle|loading|success|error` 和 `staticNavigation: ready`。一个来源错误不清空其它已验证成功来源；空数组不折叠成 loading/error。
- 同一 `NavigationEntry[]` 生成侧栏与搜索。动态菜单保留父级路径、服务器排序和可见性；本地过滤归一化候选，不逐键请求 API。选择按 `kind` 分派：路由用 TanStack Router/现有 helper，Workspace 用既有 switch 流程，命令用本地 handler。
- 菜单路径只导航到应用支持的目的地；外部 URL（如有）先校验协议/目标并安全打开，不能把未校验字符串当 Router 目的地。到达后仍由路由和服务端重验授权。
- 搜索只持有短暂输入、open/focus 和当前 scope 派生结果；不写 URL、跨账号存储或私有查询记录。账号/Workspace 切换后关闭或重置输入，不能复用上个用户/范围结果。

## 实施最小文件范围

以下是后续实现建议边界，不是本任务改动范围；当前仅新增本 UX 文档。

| 文件 | 预期责任 |
| --- | --- |
| `apps/web/src/components/layout/app-sidebar.tsx`（必要时抽共享导航 hook/selector） | 单一地产生已过滤/本地化候选，供侧栏与搜索共享；保证同路由/同权限。helper 仅限该逻辑，不搬无关布局。 |
| `apps/web/src/components/command-menu.tsx` | 快速导航范围提示、分组/列表、匹配、加载/部分错误/空态和结果激活。 |
| `apps/web/src/context/search-provider.tsx` | `⌘K`/`Ctrl+K` 焦点与 IME 防护、open 生命周期及上下文改变时清理瞬态状态。 |
| `apps/web/src/components/search.tsx` | 本地化入口名称、可访问名称/描述和键盘提示。 |
| `apps/web/src/features/workspaces/directory.tsx` | 仅当纳入空间切换结果时复用可访问目录及既有 `switchTo`，不重建授权/导航流程。 |
| `apps/web/src/lib/i18n.ts` 或独立快速导航 message 文件 | 中英固定文案和搜索别名；新增 catalog 时只接入现有 i18n 聚合入口。 |

本期**不计划修改 API/schema/database/权限规则**；接口不足须先举证并另开契约决策。不要改台账、验证报告、其它 UI 或无关路由。实际实现与独立验收仍由分开的任务承担。

## 独立验收矩阵

| 场景 | 操作/夹具 | 通过条件 | 证据类型 |
| --- | --- | --- | --- |
| 当前 Workspace 动态导航 | 两个 Tenant、多个 Workspace；用户仅加入部分空间，并在当前空间配置已授权动态菜单 | 搜索与侧栏一致；面包屑正确；未授权、隐藏、停用、删除及无可见祖先菜单不出现 | 菜单 API 响应、UI 截图/DOM、候选断言 |
| 成员与管理员差异 | 同一 Tenant 的 owner/admin、自定义 role member、未加入账号分别登录 | 角色菜单对应 visible-tree；租户项符合角色；platform admin 不自动成为成员 | 账号角色夹具、API 与 UI 结果 |
| 租户/全局上下文 | 切换 tenant、个人设置路由及平台管理员/普通用户 | 范围提示正确；仅显示当前 Tenant 和可见全局/个人入口；无权平台项不出现 | 路由/角色组合截图与可访问性树 |
| Workspace 切换与最近项 | 多 Tenant 多 Workspace；localStorage 注入不存在、被撤权或其它账号 recent ID | 候选只来自当前 actor 服务端目录；分组准确；recent 不扩权；切换更新真实上下文 | network、localStorage、URL 和 query key |
| 加载/延迟旧响应 | 延迟 Workspace detail 和 visible-tree，弹层打开时快速切换 | 显示验证/加载状态；不闪旧菜单；迟到响应不进入新 scope | 可控 API 延迟记录及 Query key |
| 菜单部分失败 | visible-tree 网络错误，其它导航来源成功 | 明示部分故障；安全来源可用；重试可恢复；失败不伪装无结果 | 模拟失败网络记录与 UI |
| 目录失败/空列表 | 目录超时及成功但返回空项目 | 错误可重试且与空态区分；不泄露过滤项，不给未经授权的创建/申请 CTA | API fixture、读屏播报/截图 |
| 无匹配与中英搜索 | 查询不存在项、中文标题/别名、大小写英文和动态中文名 | 匹配规则正确；无匹配文案本地化；动态标题原样保留 | 浏览器断言、locale 截图 |
| 搜索隐私边界 | 聊天、知识库、文件、用户、任务内放置可识别标题/正文 | 快速导航不返回业务对象或正文；它们只在对应业务页使用已有搜索 | API/network 请求与不包含断言 |
| 权限撤销/范围停用 | 弹层打开期间撤销 Tenant/Workspace 成员或停用范围，再刷新/导航 | 旧私有项立即隐藏；不切换 recent、不泄露存在性；目的 API code 按标准处理 | Problem 响应、缓存和导航记录 |
| 键盘/焦点 | 纯键盘打开、输入、方向键/Home/End、Enter、Escape；在 input/IME 测快捷键 | 快捷键不干扰编辑；选择/关闭焦点正确；焦点不进隐藏背景 | 键盘录屏、焦点序列/自动化 |
| 读屏/移动端 | 至少一个屏幕阅读器；320/390 CSS px 和触控 | 对话框/输入/结果/范围语义明确；加载/错误只播报一次；可滚动无溢出 | Accessibility tree、读屏记录、响应式截图 |
| 主题命令回归 | 执行各 theme command、关闭重开并切 locale | 命令可用且与导航分组区分；文案 locale 一致；关闭还焦触发器 | UI 回归断言 |

以上为待独立验证场景，不代表当前实现已满足；不能用全项目构建或单一 health 检查代替逐条行为证据。真实账号/后端不可用时，模拟结果须标明“模拟”，并保留真实权限验收待办。

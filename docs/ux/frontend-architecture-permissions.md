# 权限模型统一：前端架构权限 UX 独立审查

审查基线：`origin/main` `5fe7dc70fbac396531375507d1c6c84d77bbe8ad`。审查对象为 `synapse-arch-permissions` worktree 中相对该基线的未提交权限 helper、租户/用户页面及相关现有导航代码。本文为只读 UX 审查；未修改产品实现，也未运行构建、测试或浏览器检查。

## 结论

**当前不建议按“平台、租户、Workspace 三作用域统一 UX”验收通过。** 新的能力 helper 把三个作用域分开计算，测试也明确验证了角色不会跨作用域推导；租户列表和详情对平台管理视图、租户角色已有初步提示。主要缺口是：成员和邀请列表把请求失败显示成空数据；Workspace 动态导航把加载、失败、空菜单和权限边界都折叠成菜单消失；多个现有 Workspace/导航页面仍自行判断角色；隐藏操作和通用 403 没有一致的作用域解释；租户及 Workspace 角色提示在英文界面仍出现中文。

## 契约前提

- 全局账号是唯一登录身份；TenantMember 与 WorkspaceMember 是独立关系。加入租户不自动加入其 Workspace；同名 `owner`/`admin` 也不能跨作用域继承权限。
- `platform_admin` 的平台管理权限不自动成为租户成员或 Workspace 成员，也不自动开放 Workspace 业务数据。UI 仅用于显示，服务端仍须对每个请求按可信上下文授权。
- 对跨租户/跨 Workspace 的拒绝文案不得暴露目标资源是否存在或其他成员隐私。

依据：`docs/tenancy-contract.md:5-27`、`docs/tenancy-contract.md:62-70`、`docs/tenancy-contract.md:76-91`。

## 分项审查

### 1. 权限提示与信息架构：部分清楚

- 正向证据：平台租户目录标题说明平台管理员管理的是租户状态，不代表拥有租户业务或成员访问权（`apps/web/src/features/tenants/index.tsx:328-350`）。租户详情可显示“我的角色”或“平台管理视图”，租户设置与生命周期操作也分开判断（同文件 `:716-726`、`:869-925`）。全局用户页说明账号管理与租户/Workspace 成员资格分别维护（`apps/web/src/features/users/index.tsx:180`）。
- 缺口：租户成员、邀请、管理链接及多数 Workspace 操作直接隐藏；用户看不到“当前身份属于哪个作用域、缺少哪种关系/角色”。全局用户路由虽会拦截普通用户，但复用的 403 只显示通用“Access Forbidden / You don't have necessary permission to view this resource”，不说明是平台用户管理权限（`apps/web/src/routes/_authenticated/users/index.tsx:13-20`、`apps/web/src/features/errors/forbidden.tsx:8-20`）。Workspace 路由对不可访问空间使用通用不可用提示/回退，符合不泄露资源存在性的方向，但没有说明平台角色或租户角色不等于空间成员资格（`apps/web/src/features/workspaces/context.tsx:118-140`、`:154-177`）。

### 2. 加载、失败、空数据：页面间不一致

- 正向证据：租户详情区分详情加载与详情请求失败（`apps/web/src/features/tenants/index.tsx:820-833`）；租户列表有单独的错误提示和重试按钮（同文件 `:223-229`、`:362-375`）。全局用户列表区分骨架加载、错误并重试、无匹配结果/空账号（`apps/web/src/features/users/index.tsx:198-255`）。租户批量状态更新有进度、部分失败列表和重试入口（`apps/web/src/features/tenants/index.tsx:249-307`、`:482-538`）。
- **必须修复：租户成员列表失败会落入“暂无成员”。** `TenantDetail` 只把 `members.isLoading` 和空数组传入 `MemberTable`，没有传入或呈现 `members.isError`（`apps/web/src/features/tenants/index.tsx:737-741`、`:971-1019`）；表格在非加载且数组为空时渲染“暂无成员”（`apps/web/src/features/tenants/components/member-table.tsx:152-164`、`:284-293`）。网络失败或 403 会被误读为租户没有成员。
- **必须修复：邀请列表失败会落入“暂无待处理邀请”。** 调用方只传 `invitations.isLoading` 和 `invitations.data?.items ?? []`，没有传入错误状态（`apps/web/src/features/tenants/index.tsx:1043-1053`）；面板在非加载且数组为空时渲染空态（`apps/web/src/features/tenants/components/invitation-panel.tsx:214-216`、`:261-270`）。
- **必须修复：Workspace 动态菜单请求失败/未完成/返回空项时表现相同。** `dynamicItems` 对未就绪、fetching、错误及空 `items` 都产生空数组；只有非空时才渲染“工作空间”菜单组；`navigation.isError` 没有对应的错误提示或重试控件（`apps/web/src/components/layout/app-sidebar.tsx:299-309`、`:331-364`）。侧栏现有目录错误/无空间提示只在非 Workspace 路由出现（同文件 `:375-399`）。

### 3. 动态导航：可见性有规则，缺少解释

- 全局用户菜单只对 `platform_admin` 显示；租户成员只看到概览，租户 owner/admin 还会看到配置链接（`apps/web/src/components/layout/app-sidebar.tsx:94-108`、`:164-205`、`:353-363`）。隐藏规则方向上遵循作用域，但菜单没有角色提示或“为什么不可见”的就地说明。
- Workspace 系统导航是静态列出；租户动态菜单来自服务端 `visible-tree`。在 Workspace 路由内，动态菜单未加载、失败或为空都直接消失，用户无法判断是没有可见菜单、菜单配置为空、请求失败还是上下文尚未验证（同文件 `:248-309`、`:331-351`）。
- 首页与模型页已有“我的空间角色”“只读权限”等局部说明（`apps/web/src/features/workspaces/pages.tsx:53-80`、`apps/web/src/features/workspaces/models-page.tsx:217-236`），但未形成跨页面一致规则。

### 4. 中英双语：通用错误有支持，作用域角色提示缺漏

- 正向证据：通用 403 通过 `LocalizedText` 提供中英文；全局用户页的 403 操作错误有中英文映射（`apps/web/src/features/errors/forbidden.tsx:11-19`、`apps/web/src/features/users/index.tsx:47-59`）。租户列表使用 locale 文案函数。
- **必须修复：租户详情的角色描述是未本地化的动态字符串。** 页面直接拼接 `tenantText`、状态和中文“我的角色 / 平台管理视图”，`PageHeader` 只原样渲染 description；同样的角色摘要传入 `TenantSummaryCard` 并作为原始 badge 文本渲染（`apps/web/src/features/tenants/index.tsx:869-925`、`apps/web/src/features/tenants/components/tenant-summary.tsx:28-34`）。虽然 `tenantText` 文件提供 `localizedTenantText`（`apps/web/src/features/tenants/types.ts:24-50`），此处没有使用。
- **必须修复：Workspace 角色标记也会在英文界面显示中文。** `roleLabel` 只有中文值（`apps/web/src/features/workspaces/types.ts:16-21`），切换器和 Workspace 首页直接渲染该值（`apps/web/src/features/workspaces/directory.tsx:240-254`、`apps/web/src/features/workspaces/pages.tsx:60-66`）。租户详情 `errorText` 直接透传服务端 `message`（`apps/web/src/features/tenants/index.tsx:1062-1065`），英文界面也可能收到中文权限/请求错误。

### 5. 移动端：有基础响应式结构，尚无视觉证据

- 表格容器允许横向滚动（`apps/web/src/components/ui/table.tsx:4-17`）；租户详情标题和操作在窄屏纵向排列/换行（`apps/web/src/features/tenants/components/shared.tsx:19-35`），用户操作区也可换行（`apps/web/src/features/users/index.tsx:241-247`）。
- 权限空态主要通过隐藏控件体现，没有专门的窄屏说明布局。需在 320/375 px 实际确认提示不会被侧栏遮挡、表格可以触摸和键盘横向滚动、按钮不会挤出可视区域；本次未启动浏览器，不能据静态类名判定布局通过。

### 6. 可访问性：错误语义较好，空态/异步导航需补充

- 正向证据：`ErrorBox` 使用 `role="alert"`（`apps/web/src/features/tenants/components/shared.tsx:38-46`）；用户列表的加载失败提示使用 `role="alert"`，操作成功通知使用 `role="status"`（`apps/web/src/features/users/index.tsx:182-209`）；操作采用原生按钮/链接，具备键盘基础操作。
- 改进项：共享 `EmptyState` 是普通 `div`/段落，没有标题层级或状态语义（`apps/web/src/features/tenants/components/shared.tsx:49-70`）。动态菜单从有内容变成空内容时没有加载/失败/无菜单状态，也没有可供读屏器感知的状态变化。对不可用操作提供说明时，应用可聚焦的文本提示并以 `aria-describedby` 关联禁用按钮；路由拒绝后应确认焦点落在错误标题或主内容，而非丢失。
- 本次没有屏幕阅读器、键盘遍历或焦点管理的运行时验证；这里只能确认静态语义。

### 7. 角色边界与 UX 统一：helper 本身清楚，调用覆盖有限

- `getPermissionCapabilities` 分别输入 `platformRole`、`tenantRole`、`workspaceRole`，不从一个作用域推导另一个作用域（`apps/web/src/lib/permissions.ts:1-5`、`:47-91`）。对应单测明确覆盖平台管理员不自动拥有租户/空间权限，以及 tenant owner、Workspace owner 不跨作用域继承（`apps/web/src/lib/permissions.test.ts:105-134`）。这是当前差异的正向基础。
- 但 helper 的页面调用集中于租户主页面、全局用户页和用户路由守卫。侧栏仍直接比较平台/租户角色；Workspace 页面也继续使用自己的 `workspace_role === ...` 或数组判断（`apps/web/src/components/layout/app-sidebar.tsx:94-108`、`:164-205`；`apps/web/src/features/workspaces/pages.tsx:53-56`、`:181-185`、`:337-340`；`apps/web/src/features/workspaces/models-page.tsx:88-92`；`apps/web/src/features/workspaces/teams-page.tsx:218-220`）。因此目前只能确认 helper 的角色映射，不足以证明三作用域界面已统一，也留下规则漂移与提示不一致的风险。

## 必须修复项

1. **修正空态与请求失败混淆。** 成员、邀请、动态导航分别呈现加载、失败（含可恢复重试）、成功空数据；失败时不得显示“暂无成员/邀请/菜单”。错误状态应带 `role="alert"` 或适当的状态语义。
2. **为权限边界提供作用域明确、隐私安全的说明。** 403/拒绝访问至少区分平台账号管理、租户关系/租户角色、Workspace 成员关系/Workspace 角色；页面隐藏操作时说明当前角色及所需作用域，或提供合适的权限说明入口。跨租户/跨空间目标仍须统一显示“不可访问/未找到”类文案，不能透露资源是否存在。
3. **统一真实 UI 的能力判断来源，或把验收范围明确收窄到当前改动页面。** 如果该差异以三作用域统一能力为目标，应让侧栏、Workspace 页面及涉及的租户子页面共享同一组能力结果；服务端授权仍是唯一安全边界。不能只用 helper 的单元测试替代界面角色矩阵验收。
4. **补齐英文界面中的动态权限文案。** 至少本地化租户/Workspace 角色标签、租户详情的“平台管理视图/我的角色”、权限拒绝和错误信息；避免直接把后端 `detail` 当作英文 UI 文案。

## 建议项

- 页面标题附近固定显示当前作用域（平台 / 某租户 / 某 Workspace）和该作用域角色；只读角色明确标记“只读”。对适合公开的操作，可保留禁用态按钮并说明所需角色；对不适合公开的资源仍使用安全的通用不可访问提示。
- 给动态菜单增加独立的 `loading`、`error + retry`、`success + no visible menus` 状态，作用域校验未完成时可显示“正在验证当前 Workspace”，不要把失败静默等同无权限。
- 将稳定错误码映射为双语、面向人的短文案；保留 request id/错误码作为辅助技术信息，不把原始服务端描述作为唯一解释。
- 异步状态及空态使用清晰标题与可读状态语义；禁用控件的原因与控件关联，重定向后把焦点移到错误标题或页面主区域。
- 在 320、375、768 px 验证租户成员/邀请/用户表格、角色提示、重试按钮、侧栏菜单及焦点顺序；重点确认表格横向滚动不吞掉键盘焦点、窄屏空态有恢复路径。

## 验收场景

下表是建议的独立验收条件。每个场景同时检查中英文、键盘操作和窄屏显示；权限结果由后端授权单独验证，UI 隐藏菜单不能作为越权测试证据。

| 主体与数据关系 | 预期可见行为与验收断言 |
| --- | --- |
| **平台管理员**，无任何租户/Workspace 成员关系 | 可见平台全局用户与平台租户目录操作；租户详情明确标记平台管理视图。平台身份本身不生成 `tenant_role` / `workspace_role`，不得据此推导 Workspace 成员权限或空间业务访问；若需提供租户成员名单等管理能力，应另有明确的平台范围授权与提示。直接访问无成员 Workspace 时显示安全、可恢复的不可访问提示。 |
| **租户 owner**，是 Workspace A 的 owner，但不是同租户 Workspace B 成员 | 可管理当前租户允许的设置、成员和邀请，并可按契约邀请管理员/创建 Workspace；进入 A 显示 Workspace owner 能力。进入 B 时仍被拒绝，不因租户 owner 推导 Workspace B 权限。 |
| **租户 admin** | 可执行契约允许的租户成员/设置管理；邀请仅能授予 member。不可管理平台账号或租户生命周期；未加入的 Workspace 不出现在可访问目录中，直达 URL 也不泄露数据。 |
| **租户 member**，未加入任何 Workspace | 可看到其获准查看的租户信息，并明确说明租户成员身份不自动开放 Workspace；不能看到租户管理操作或 Workspace 业务数据。空 Workspace 列表与加载失败必须明显不同。 |
| **Workspace owner**，租户角色是 member | 可管理此 Workspace 成员、设置和资源，并可转移所有权；不能因此获得租户管理或平台用户管理能力。页面同时准确显示租户角色与 Workspace 角色。 |
| **Workspace admin** | 可管理契约规定的空间成员/设置/资源；所有权转移仅 owner 可用。被隐藏/禁用的转移操作应说明所需角色，不显示为普通空数据。 |
| **Workspace member** | 可使用允许的 Workspace 资源，但不获得 Workspace 管理权限；个人凭据/会话仍是当前账号私有。只读/可写差异需在操作附近说明。 |
| **Workspace viewer** | 可查看只读资源，不可创建、更新、删除或管理成员；页面明确显示只读角色、保持可访问的查看操作，并把禁用或隐藏写操作与权限说明关联。 |
| **跨租户越权**：仅属于租户 A，尝试租户 B 的详情/成员/设置 URL | 页面显示统一的不可访问/未找到文案，不渲染 B 的名称、成员、是否存在等信息；不把访问失败显示成空成员表。服务端对 API 请求单独拒绝。 |
| **跨 Workspace 越权**：租户成员/管理员尝试未加入的 Workspace，或 Workspace A 成员猜测 Workspace B 的资源 ID | 不推导成员权限；工作区上下文、导航、缓存和资源都不串用。显示安全的不可访问反馈并提供返回已授权空间的路径；不把拒绝包装成“暂无资源”。 |
| **成员撤销/恢复**：TenantMember 被暂停/移除，但旧 WorkspaceMember 仍标记 active；随后恢复 TenantMember | 撤销后所有该租户 Workspace 权限立即失效；重新加入后没有 Workspace 权限自动复活，须逐个重新授权。UI 文案说明当前阻断来自成员关系，不伪装为空资源。 |
| **状态组合**：成员列表/邀请/动态菜单各自模拟加载中、请求失败、成功空集、成功有数据 | 四种状态有不同文案/语义；失败可重试，空集说明下一步，加载中可被辅助技术感知。动态导航错误不能静默隐藏菜单。 |

## 局限

- 本结论基于指定实现 worktree 的未提交 diff 和相关前端源码静态阅读；未启动应用、未运行测试/构建、未检查真实视口、键盘或读屏器。
- `permissions.test.ts` 的存在和断言仅作为代码证据，本审查没有执行该测试；它不能证明 API 服务端授权正确。
- 本报告审查 UX 与界面状态，不代替对后端作用域校验、数据隔离、错误码实现和缓存隔离的独立安全验收。最终验收须依 `docs/tenancy-contract.md` 对接口进行单独验证。

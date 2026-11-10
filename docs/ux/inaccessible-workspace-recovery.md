# Workspace 不可访问恢复体验 UX 审查

状态：独立 UX/前后端交互契约；不是实现记录，也不是独立验收结论。范围仅限用户从 `/w/{workspaceId}` 进入 Workspace、目录/上下文验证失败以及恢复导航；不修改服务端状态码、Problem code、权限边界或现有业务能力。

## 审查依据与现状

- 身份、作用域和服务端授权以[租户契约](../tenancy-contract.md)为准：全局账号、TenantMember、WorkspaceMember 各自独立；路径 Workspace 确定导航上下文，`X-Workspace-ID` 只传上下文、不授予权限；最近 Workspace 只用于导航恢复。客户端缓存、URL、目录列表、角色显示均不构成授权。
- 跨模块工程和 UX 核查依据[租户优化差距审查第 2、3、7 节](../tenant-optimization-principles-and-gap-review.md)：先分类加载/失败状态、明确归属和动作权限，定义服务端与前端失败行为、移动端/可访问性及可重复验收；不可把通用列表体验机械套成租户授权规则。
- [授权上下文 UX 契约](architecture-authorization-context.md)已区分成员失效、无动作权限、作用域停用、资源不可见和网络未验证；本审查进一步专门规定**访问 Workspace 根路由/详情本身失败时的路由、目录故障和恢复生命周期**。
- 当前审查路径事实：`context.tsx` 的路由 `beforeLoad` 与 `WorkspaceRouteLayout` 都把 403/404/409 按状态码合并为“不可访问”，移除最近 Workspace，然后依赖目录首项自动切换，目录失败时回 `/`；因此用户可能在 toast 后被无选择地移动。组件错误态仅显示 `detail.error.message`，没有重试按钮。`directory.tsx` 使用账号分区目录查询，以租户分组、可搜索的切换器和移动端底部弹层呈现空间；最近 Workspace 是账号级 localStorage JSON。以下条款是期望目标，不表示产品代码已满足。

## 核心原则

1. **拒绝不是导航命令。** 对明确服务端拒绝或不可用响应，保留原 URL/路由并显示完整页面级恢复态；不得自动选中/切入另一个 Tenant 或 Workspace，也不得只靠 toast 或静默跳转。
2. **不能确认不是拒绝。** 网络故障、超时、5xx 或目录加载失败均保持原目标上下文为“未验证”；不清理最近项、不把空间标记为不可访问、不改 URL。隐藏未经当前请求重新验证的私有业务内容，保留稳定导航壳和可重试入口。
3. **切换必须由用户选择。** “查看可访问空间”展开/进入目录；用户选中具体空间后才切换。返回工作台是明确的独立动作，不是无可选目标时的默认副作用。
4. **当前用户可获知结果，但不获知越权资源事实。** 可显示泛化的“当前空间不可用”，不把 `detail`、租户/空间名称或 ID 原样展示给无权用户；诊断状态和 request ID 可放在用户主动展开的详情中。

## 状态与路由恢复矩阵

按响应的稳定 Problem `code` 优先分类；状态码只用于 code 缺失/未知时的保守通用错误。**本表决定页面保持还是重定向：** 除独立的认证流程外，均保持原路径，重定向只发生于用户明确触发的导航操作。

| 结果 | 稳定 UI 状态与原上下文 | 原地显示/恢复操作 | 最近空间与自动行为 |
| --- | --- | --- | --- |
| `403 MEMBERSHIP_INACTIVE`、`403 WORKSPACE_MEMBERSHIP_REQUIRED` | `access_revoked`；保留原 URL 和原路由外壳，不渲染该 Workspace 私有内容。租户成员与空间成员提示分别本地化；不得将租户成员身份推断为 Workspace 成员资格。 | 说明当前账号无法访问该空间；按钮“查看可访问空间”“返回工作台”。如真实授权申请/管理员联系流程已存在，可提供对应操作；不得承诺重新加入或暴露其他成员。 | 从最近项中仅在该 ID 等于本次被拒绝的 workspaceId 时删除（详见清理规则）；不自动切换。目录成功后可以原地显示切换器。 |
| `403 FORBIDDEN` | `action_denied`；如果拒绝的是空间主页/详情读取且原因无法确认，则作为 `access_unconfirmed` 泛化失败，仍保留原路由；若为主页内单个动作拒绝则保留当前已验证页面和草稿。 | 主页级失败提供“重试”“查看可访问空间”“返回工作台”；动作级失败说明当前账号无权执行此操作、停止该动作、保留输入并刷新受影响权限提示。 | 不得将一般动作权限不足解释为撤销 Workspace 成员资格；只有服务端拒绝了该 Workspace 本身的访问验证，且 code 说明该 ID 不再可用时才按精确 ID 清除最近项。 |
| `404 RESOURCE_NOT_FOUND`（含不存在或调用者无权知晓资源存在） | `resource_unavailable`；保留原 URL，使用不区分“被删除”“不存在”“无权查看”的通用页面。 | “此空间不存在或当前不可用。”提供“查看可访问空间”“返回工作台”；无原始 detail/名称/ID 泄露。 | 清理匹配的最近项；不尝试名称探测、不查其它租户、不自动切到目录首项。 |
| `409 WORKSPACE_INACTIVE` | `workspace_inactive`；保留原 URL，告知空间暂不可用（如空间名称本身仍获授权读取才可显示名称）。 | “此空间目前已停用或归档，暂时无法打开。”提供“查看可访问空间”“返回工作台”。仅在状态可能更新时提供重试。 | 精确清理该 workspaceId 最近项；不自动恢复状态/权限或切换。 |
| `409 TENANT_INACTIVE` | `tenant_inactive`；保留原 URL，不泄露无法授权查看的租户信息。 | “该空间所属范围目前不可用。”提供“查看可访问空间”“返回工作台”；若重新激活需要管理员处理，文案仅陈述用户可采取的真实路径。 | 精确清理该 workspaceId 最近项；不推断空间成员关系已被移除，不自动切到同租户或别的租户。 |
| 其它 `409`（如 `LAST_OWNER_REQUIRED`、非访问类冲突） | `conflict`；保留当前页面/导航上下文；不要将所有 409 解释成 Workspace 不可访问。若该冲突发生在当前根路由验证，保持原路由并显示无法确认状态。 | 根据已知 code 用明确冲突文案；否则“当前状态发生变化，暂时无法打开空间。”提供“重试”“查看可访问空间”“返回工作台”。不自动重放写请求。 | 不清除最近项，除非稳定 code 明确表示 Workspace 本身不可用；不自动切换。 |
| 网络断开、请求超时、连接错误、服务暂不可达/5xx | `context_unverified`；保持原 URL 与待验证 workspaceId，不将服务端视为拒绝。展示导航壳和“无法确认访问状态”；隐藏 stale 私有内容并禁用写操作。 | 显示手动“重试”“查看可访问空间”“返回工作台”；连接恢复时可礼貌提示，但只在用户重试或显式重新载入后重新验证。不自动切换。 | 保留最近项；不覆盖为其它空间。请求结果未知时，不自动重发任何写操作。 |
| 租户或 Workspace 目录加载失败（任何目录 API 网络/服务端错误） | `directory_unavailable`；保留原目标 URL，目录显示错误而非空列表。若 Workspace 详情成功且实时授权通过，可继续显示已验证当前 Workspace；否则不显示受保护内容。 | 目录区显示“无法加载可访问空间”和“重试加载空间”；仍可用的“返回工作台”独立可见。可重试目录不触发当前路由替换。 | 不把空结果当成无成员，不清除最近项；不得从 stale 目录或最近缓存自动导航。 |
| 目录成功且明确没有可访问 Workspace | `directory_empty`；保持原 URL，显示空目录说明。此结果只说明当前目录响应为空，不说明账号无租户、是否可申请访问或无任何资源。 | “没有可显示的可访问空间。”提供“返回工作台”；仅当后端支持时提供真实创建/申请入口。目录仍可刷新。 | 只有服务端对当前 Workspace 明确返回访问拒绝/不存在时，才能按上述规则清理对应最近项。空目录本身不清理其它最近项、不强制离开当前路由。 |
| `400 WORKSPACE_CONTEXT_REQUIRED` / `400 CONTEXT_MISMATCH` 或未知 code | `context_invalid`；保留当前 URL，停止空间内容展示，不猜测用 URL、header、localStorage 中哪一个上下文替换另一个。 | “空间上下文不一致，尚未载入内容。”提供“重新加载当前空间”“查看可访问空间”“返回工作台”；错误详情可显示状态/code/request ID。 | 保留最近项；不将上下文格式/客户端错误标作撤权，不自动重试带错 header 的动作。 |
| `401 AUTHENTICATION_REQUIRED` / 已过期会话 | `session_expired`；走既有认证边界至登录页，带受限且校验过的 `returnTo` 保存原相对路由。此为唯一自动导航例外。 | 登录后重新验证原 URL，不重放写请求；如果登录后仍不可访问，回到页面级对应错误态。 | 按现有登出/会话失效策略清理当前 actor 的私有缓存；最近项可保留为导航提示，但登录回来必须重新向服务端验证。 |

## 操作与后端契约

- **重试：**针对导致状态的读请求执行明确的用户触发重试；在同一 actor、目标 workspaceId、租户/成员版本和路由仍有效时重新请求 Workspace 详情/访问摘要。仅对网络/可重试服务错误允许有限退避重试，页面级手动按钮始终保留。4xx 不做循环自动重试。若旧响应迟到，不能清除新路由错误或覆盖新空间数据。
- **查看可访问空间：**打开现有按 Tenant 分组的 Workspace Directory/TeamSwitcher 列表，不需要或不要求后端“跳到推荐空间”接口。列表只有服务端按当前 actor 返回的可访问关系；TenantMember active 不推导 WorkspaceMember。目录获取失败应在原错误页面显示列表失败和目录重试，而非渲染空态。
- **切换 Workspace：**只对目录中当前响应确认可访问的目标允许显式选择；选择后更新 `/w/{workspaceId}`，先进入该目标的“正在验证”状态，成功后再展示目标数据。旧空间未保存改动提示遵循现有页面契约；未提交请求不得因切换而变成成功，已提交后台任务仍保留其原始作用域。目标验证失败时停留在目标路由的相应错误页，显示返回/列表操作，不循环回退。
- **返回工作台：**用户主动按键/链接才导航 `/`；保留安全的同源相对原路由供其从目录主动返回（不把无权资源名称/ID呈现为链接或说明）。不要把“返回工作台”与“查看可访问空间”合并成一个不可预测动作。
- **HTTP/API 需求：**继续使用现有 `GET /api/v1/workspaces/{workspace_id}`、Tenant/Workspace directory list 及标准 Problem JSON。分类依赖其稳定 `code`（至少沿用 `MEMBERSHIP_INACTIVE`、`WORKSPACE_MEMBERSHIP_REQUIRED`、`FORBIDDEN`、`RESOURCE_NOT_FOUND`、`TENANT_INACTIVE`、`WORKSPACE_INACTIVE`、`WORKSPACE_CONTEXT_REQUIRED`、`CONTEXT_MISMATCH`）；网络失败没有领域 code；未知 code 必须落入通用可恢复错误。UX 不要求改变状态码或公开新枚举。现有 `request_id` 可用于可复制的诊断信息；原始 `detail` 不作为用户文案协议。
- **安全与缓存：**服务端对详情、目录和每个业务读写仍基于当前身份、成员状态、作用域实时核权；404 不区分不存在与不可见。`/w/{workspaceId}` 是导航意图，不授权。请求和 Query key 绑定发起时的 actor、派生 tenant、workspace 和适用的 `membership_version/context_version`；在错误页面不得使用最近缓存、旧目录快照或旧 Workspace 详情作为“已授权”证据。

## 最近空间清理与缓存失效

1. 最近项是账号导航提示；不得因为读取失败/暂时未知就覆盖它。只有当前 Workspace 详情请求返回上述**明确的 Workspace 访问拒绝/不可用 code**时，才删除该 actor 下 `synapse:recent-workspace:{actorId}` 中与错误 workspaceId 精确匹配的项。ID 不匹配时不得动它；用户已选择的新 Workspace 最近项不能被迟到的旧请求删除。
2. 目录请求失败、网络/超时/5xx、一般 `403 FORBIDDEN` 动作拒绝、上下文 `400`、未知 code、目录空结果均不清除最近项。401 按既有账号退出处理，不因 Workspace 恢复 UX 扩大清理范围。
3. 明确 403/404/409 根上下文失败后，立即停止观察并移除/隔离该 workspaceId 对应的敏感详情、菜单、权限和业务 query；失效该 actor 的 Tenant 与 Workspace 目录查询，并获取新目录以供用户自行选择。查询 key 至少遵循租户契约的 actor + 派生 tenant + workspace + 资源/参数及适用权限版本分区。不得 invalidate 后立即拿旧缓存自动导航。
4. 网络错误下保留原目标的导航上下文，但旧私有业务数据不作为当前可见内容；不重定向。连接恢复并重新验证成功后才可恢复展示。目录缓存应显示 stale/未刷新标记或加载错误，不将其作为新的授权结果。
5. 切换空间时隔离/移除旧空间 UI observer/cache，确保旧请求迟到只写回旧作用域 key；不要求撤销已提交后台任务。权限版本变化或成员撤销时，旧权限/目录及对应业务数据必须失效，重新请求后再呈现。

## 文案与本地化

错误摘要使用可翻译的稳定状态键，至少覆盖中英文，不能直接把 `detail` 拼到 toast 或错误页。建议默认文案如下；根据 code 选择语义，不通过文案推测更具体的权限原因。

| 状态 | 简体中文 | English |
| --- | --- | --- |
| `access_revoked` | 你目前无法访问此空间。 | You can’t access this workspace right now. |
| `resource_unavailable` | 此空间不存在或当前不可用。 | This workspace doesn’t exist or is unavailable. |
| `workspace_inactive` | 此空间目前不可用。 | This workspace is currently unavailable. |
| `tenant_inactive` | 该空间所属范围目前不可用。 | The organization for this workspace is currently unavailable. |
| `context_unverified` | 无法确认此空间的访问状态。 | We couldn’t verify access to this workspace. |
| `directory_unavailable` | 无法加载可访问空间，请重试。 | Accessible workspaces couldn’t be loaded. Try again. |
| `directory_empty` | 没有可显示的可访问空间。 | There are no accessible workspaces to show. |
| `context_invalid` | 空间上下文不一致，尚未载入内容。 | The workspace context doesn’t match. No content was loaded. |
| 重试 | 重试 | Retry |
| 查看可访问空间 | 查看可访问空间 | View accessible workspaces |
| 返回工作台 | 返回工作台 | Go to home |
| 重新加载当前空间 | 重新加载当前空间 | Reload this workspace |
| 诊断详情 | 错误详情（HTTP 状态、code、request ID） | Error details (HTTP status, code, request ID) |

仅在服务端已授权返回 Workspace/Tenant 名称时，在标题/正文中显示其名称；错误状态、toast、浏览器标题、链接和诊断文字不回显原始被拒绝 ID 或未经授权名称。toast 只能作为非阻断的补充播报，不能替代可见且有恢复动作的页面状态。

## 移动端与可访问性

- 320px/390px 窄屏下原路由错误页纵向排列：标题、原因、主操作“查看可访问空间”、次操作“重试/返回工作台”、可折叠诊断；按钮不依赖 hover，满足触控面积，适配安全区域。错误页不能要求横向滚动；长租户/空间名换行或截断但保留授权可见的完整无障碍名称。
- 移动端 Workspace 列表沿用底部弹层，搜索、分 Tenant 分组和目标选择都可在视口内滚动；目录失败和空结果具有不同状态及重试，关闭后焦点回到“查看可访问空间”触发器。无空间可选时不自动进入另一个页面。
- 页面级错误使用语义化 `<main>` 和单一 `<h1>`；将焦点移至错误标题（不抢夺用户尚在操作的焦点），错误摘要由单个 `role="alert"` 或等效 assertive live region 播报一次，重试加载/目录成功状态使用 polite live region。重复渲染、路由守卫与 toast 不得重复播报相同错误。
- 恢复按钮用真实按钮/链接及清晰名称；Tab 顺序为标题/摘要、主恢复操作、次操作、诊断详情；键盘 Enter/Space 可激活，目录支持现有键盘搜索/选择/Escape 返回焦点。焦点不能因组件卸载或程序化路由跳转丢失。
- 状态说明同时包含图标/文字/可读名称，不能只用红色/图标表达；展开诊断有可读标签，request ID 可选择复制但不作为唯一恢复方法。错误和状态支持简体中文、英文切换；用屏幕阅读器验证原因、加载、恢复结果和当前 Tenant/Workspace（仅限已授权名称）。

## 回归验收矩阵（供独立实现/验收任务使用）

使用非生产账号与夹具：Tenant North 含 active Workspace Research、Support；Tenant South 含 active Workspace Sales。Alex 对 North/South 均为 active TenantMember，只加入 Research、Sales；Support 成员关系为 removed。另设权限不足动作用户、可停用 tenant/workspace 管理员和独立 owner。夹具不改变最后 owner 保护。每一项验证 URL、目录、localStorage 最近项、Query cache、焦点/播报与中英文；本清单不代表已经执行。

| ID | 注入结果/步骤 | 必须满足的断言 |
| --- | --- | --- |
| IWR-01 | Alex 直达 Support；详情返回 `403 WORKSPACE_MEMBERSHIP_REQUIRED`。 | 保留 `/w/SupportId`；不渲染 Support 数据；展示成员不可访问说明、列表和工作台入口；不跳 Research/Sales，不泄露 North/Support 未授权信息。只清理匹配 SupportId 的最近项。 |
| IWR-02 | TenantMember inactive 返回 `403 MEMBERSHIP_INACTIVE`；另一用例对动作返回 `403 FORBIDDEN`。 | 前者显示租户成员关系不可访问且保留路由；后者在已验证页面只拒绝该动作并保留草稿，不清最近项、不误称空间成员已撤销。 |
| IWR-03 | 未知 403 code 或只含通用 403。 | 显示通用可恢复状态并保留原路由；不推断原因、不泄露 detail，不自动重定向。 |
| IWR-04 | workspace ID 无效/他租户不可见，详情返回 `404 RESOURCE_NOT_FOUND`。 | 原路径保留；文案一致不区分“不存在/无权”；不尝试搜索或暴露名称/ID；仅精确匹配最近项可删。 |
| IWR-05 | Research 所属 Tenant 返回 `409 TENANT_INACTIVE`；另对 Workspace 返回 `409 WORKSPACE_INACTIVE`。 | 分别呈现正确本地化泛化范围/空间说明；保留原 URL，不自动换空间；目录/权限/业务缓存按作用域失效。 |
| IWR-06 | 根路由验证遇到 `409 LAST_OWNER_REQUIRED` 或未知 409。 | 不分类成空间关闭，不清最近项；保留上下文并提供重试/目录/工作台的合适恢复，不重放写操作。 |
| IWR-07 | 详情 GET 断网、超时、连接失败、503；加载中离线恢复。 | `context_unverified` 保留 URL/最近项；不展示 stale 私有数据，不写入、不自动换空间；重试成功才恢复数据，写请求不盲目重放。 |
| IWR-08 | Workspace/Tenant directory GET 分别返回网络错误、403/5xx；再恢复目录。 | 显示目录错误+专用重试而非空态；不改当前路由、不清最近项/将 stale 行选作目标；目录恢复后用户可自行选择。 |
| IWR-09 | 目录合法返回空列表。 | 显示独立空态，不把它当作目录错误/授权证明；不自动回首页，不删除其它最近项。 |
| IWR-10 | context `400 WORKSPACE_CONTEXT_REQUIRED`、`400 CONTEXT_MISMATCH`，及未知 Problem code。 | 保留 URL、不渲染空间数据、不通过 ID/header/recent 猜目标；展示重新载入/目录/工作台动作和安全诊断。 |
| IWR-11 | 401 后登录回跳，原 Workspace 在登录期间权限撤销。 | 只在 401 走登录重定向；returnTo 校验为同源相对路由；不重放写请求；登录回来重新请求并落入正确错误态，不闪现私有缓存。 |
| IWR-12 | Support 拒绝响应延迟到用户已切换 Sales 且 Sales 最近项写入之后才返回。 | 旧响应不能删 Sales 最近项、导航或覆盖 Sales 内容；任何迟到数据仅命中旧 actor/tenant/workspace/version query key。 |
| IWR-13 | 已验证 Research 内写入遇 403；表单有未提交草稿并有已提交后台任务。 | 乐观状态回滚，保留可恢复草稿并只刷新相关权限；不泄露目标内容或重放动作；已提交任务仍绑定原作用域，不因 UI 切换改归属。 |
| IWR-14 | 320px/390px、纯键盘、屏幕阅读器、中/英文切换。 | 错误、按钮、目录、焦点顺序、一次性错误播报、加载/恢复播报都可理解和完成；没有横向溢出、hover-only 控件或未经授权名称泄露。 |

验收报告逐条记录真实响应 code/status、账号/成员状态夹具、原/最终 URL、页面显示状态、最近项变更、相关 Query key/cache 清理证据、焦点/读屏与 viewport/语言。mock/模拟故障须显式标记为模拟；真实身份/权限撤销条件未能构造时保留待验收，不以构建通过、单次 health 检查或 toast 截图替代交互证据。

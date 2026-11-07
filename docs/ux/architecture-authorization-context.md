# ARCH-UX-001 授权上下文架构接缝 UX 设计审查

状态：UX/契约设计审查；不是实现记录，也不构成独立验收。此处只规定用户体验和前端状态映射，不修改任何既有 HTTP 状态码、Problem code 或 detail。

## 依据与结论

- 权威边界见 [租户契约](../tenancy-contract.md)：全局账号、TenantMember、WorkspaceMember 分离；`/w/{workspace_id}` 确定协作 Workspace，`X-Workspace-ID` 只传递上下文、不授予权限；租户由服务端派生。TenantMember active 不代表加入该租户的所有 Workspace；最近空间只是导航提示。
- [集成计划](../integration-plan.md)要求按租户分组切换、显示当前 Tenant/Workspace、切换后按账号/租户/空间隔离 TanStack Query 缓存、提示未保存改动，且不能把浏览器保存的 ID 当作授权。跨模块工程标准与租户专属规则依 [差距审查第 2、3、7 节](../tenant-optimization-principles-and-gap-review.md)执行。
- **当前代码事实（不是 UX 目标）：** `apps/api/app/tenancy/context.py` 与 `resolver.py` 按稳定 code 返回契约中的 HTTP 状态；`apps/web/src/lib/api.ts` 将 Problem 的状态、code 和 detail/message 保存在 `ApiProblem`，遇到 401 会重置 auth store。`main.tsx` 的 QueryCache 只对查询错误统一提示并转登录，auth reset 本身没有清理 QueryClient 私有缓存。TanStack workspace 路由的 `beforeLoad` 与 `WorkspaceRouteLayout` 都按状态码而非 Problem code 处理 403/404/409：清除最近空间后尝试跳至目录返回的首个 active Workspace，否则回工作台；这会合并成员停用、操作拒绝、资源不存在和范围停用。400 上下文错误不会走该回退，页面可能显示通用验证错误或路由错误；provider 当前直接展示 `ApiProblem.message`。`directory.tsx` 已按 Tenant 分组、支持搜索和移动端底部弹出，并以账号隔离目录查询；Workspace 详情及已检查的业务 query key 按 actor/tenant/workspace（多处也含 `membership_version`）分区，切换时移除旧 Workspace 的 query，但不取消传输或已提交任务。以上仅描述所审查路径，不代表所有资源键或登录/登出路径均已审计。下表及后续条目是提议的 UX 契约，不表示实现已满足。

主要 UX 风险：把权限撤销、停用、资源不存在和上下文组装错误合并成“空间不可访问”并自动跳到目录中的第一个空间，会令用户丢失任务位置、掩盖需修复的客户端上下文错误，并可能误切至另一个租户。必须按返回的稳定 Problem code 映射状态；缓存、最近空间和菜单都不是授权凭证。

## 状态与用户动作契约

UI 可使用下表的稳定状态名；服务端仍是授权最终裁决者。响应若同时含 `code` 与 `detail`，原样保留作为诊断依据；给用户显示本地化的简明说明，并在可展开的“错误详情”中显示 HTTP 状态与 code，不把原始 detail 当唯一文案。

| 后端结果（保持不变） | 稳定 UI 状态 | 用户看到 / 可做 |
| --- | --- | --- |
| 路径 Workspace ID 可解析但缺少 `X-Workspace-ID`，或无路径 Workspace ID 且缺少该 header：`400 WORKSPACE_CONTEXT_REQUIRED` | `context_required` | “此请求缺少空间上下文。”提供“重新加载空间”和“返回空间列表”；不从最近空间静默补授权。 |
| 路径 Workspace ID 可解析且 header 非十进制或与路径 ID 不同；或无路径 Workspace ID 且 header 非十进制：`400 CONTEXT_MISMATCH` | `context_mismatch` | “页面与请求的空间不一致，尚未提交更改。”提供“重新载入当前空间”；不把 header 的空间内容展示在路径空间下，也不自动切到任一方。 |
| TenantMember 非 active：`403 MEMBERSHIP_INACTIVE` | `tenant_membership_inactive` | “你目前无法访问此租户。”提供“查看可访问空间”；不暴露其他成员或租户数据。 |
| WorkspaceMember 缺失或非 active：`403 WORKSPACE_MEMBERSHIP_REQUIRED` | `workspace_membership_inactive` | “你目前无法访问此空间。”提供“查看可访问空间”；只有存在真实申请/联系流程时才显示“申请访问”，否则提示联系租户/空间管理员。 |
| Tenant 非 active：`409 TENANT_INACTIVE`；Workspace 非 active：`409 WORKSPACE_INACTIVE` | `scope_inactive` | 分别说明租户或空间暂不可用，并提供“返回空间列表”；不自动恢复或切换权限。若客户端没有授权查看名称，只显示通用范围文案。 |
| 操作权限不足：`403 FORBIDDEN` | `permission_denied` | “当前账号无权执行此操作。”保留输入草稿，停止该动作；可刷新权限/上下文、返回或联系管理员。没有可用的授权申请接口时不伪造 CTA。 |
| 资源、关联 Tenant 不存在，或路径 Workspace ID 无法解析（在 header 校验前）：`404 RESOURCE_NOT_FOUND` | `resource_unavailable` | 显示通用“内容不存在或不可用”，不判断或泄露是否属于其他租户；提供返回列表。 |
| 会话过期/撤销：`401`（沿用端点实际 Problem code/detail；本设计不新增） | `session_expired` | 清除当前用户态及其缓存，转登录并在登录后安全返回原路由；不重试写操作、不继续展示私有缓存。 |
| 超时、断网、服务暂不可达；无可确认领域结果 | `context_unverified` | “无法确认空间访问状态。”保留导航壳，隐藏未重新验证的敏感空间数据；提供“重试”。不得把网络失败当成允许访问或权限撤销。 |

**实现准备度：** 本次按 `resolver.py` 的既有解析顺序校正文档状态映射后，授权上下文 UX 契约已可用于实现；状态码级自动回退、401 缓存清理、原始错误文案和未保存改动保护是已审查前端路径中的实现差距，不构成新增或修改后端契约。本说明不表示实现或验收已完成。

依赖当前端点实际返回的 code 决定映射，不仅凭状态码推测领域原因。例如 403 可能是成员关系失效，也可能只是某个动作的权限不足。未知 code/status 使用可重试的通用错误态，并记录诊断信息，不把原始服务器文案作为交互协议。

## 交互、错误与缓存行为

- **进入/恢复空间：** URL 中的 Workspace ID 是当前导航选择；先呈现“正在确认空间访问”，通过当前用户的服务端目录与 Workspace 详情验证后再显示业务内容。没有匹配成员关系时给明确空态和空间列表入口；最近空间只作为建议，恢复时必须重新验证。Tenant 与 Workspace 身份/角色分开呈现，不用其中一种角色推断另一种。
- **错误分类：** 400 上下文错误不自动重试；401 清除会话并登录；403/404/409 显示映射状态并刷新目录/权限摘要；仅网络、超时及可重试服务错误提供有界自动重试和始终可见的手动重试。重试前确保仍在同一 actor/tenant/workspace 路由。
- **切换与并发：** 切换器按 Tenant 分组、显示当前 Tenant 与 Workspace，选择后立即更新路由并显示目标空间加载态。未保存表单先提示保存/放弃/留在当前页。每个请求捕获发起时的 `actor_id + tenant_id + workspace_id`；异步旧响应只能写入旧作用域缓存，不得渲染到新路由。切换时取消旧查询观察/请求（若可取消），并确保迟到响应不会恢复旧页面；切换不取消已经提交的后台 AI 任务，任务仍保留原归属。
- **TanStack Query：** 所有空间数据键至少包含 actor、派生 tenant、workspace、资源/参数及适用的 `membership_version`/`context_version`；全局账号、租户目录、空间目录、空间业务和个人私有数据各自分区。切换后停止/取消旧作用域查询，验证并加载目标作用域目录、详情、菜单/权限和数据；权限版本变化、成员撤销或 403/409 后使当前空间详情、权限/菜单及受影响资源失效并重新取目录。401/登出时清理用户私有缓存；禁止用当前 URL 的 workspace 覆盖迟到请求或缓存 key。
- **写入与部分成功：** 失败的乐观更新回滚，并从服务端重新读取。批量/多请求操作只重试失败项，清楚列出已成功与失败项；已成功项不因另一项失败而谎报回滚。写请求超时属于结果未知：先重查状态/结果，再由用户确认重试；除非接口已具备幂等保障，不自动重放。撤权后保留可恢复草稿，但不继续提交。
- **慢速/离线：** 骨架屏和“正在确认访问”应有可感知的加载状态；超时显示重试与返回入口。未连通时只保留导航壳和明确标记的离线状态，不把过期 Workspace 缓存展示成已授权数据，不允许写入；连接恢复后先重新验证上下文再刷新内容。

权限提示、禁用按钮、菜单显隐和角色说明仅供发现与理解，是**展示提示**，不能构成授权或安全检查。每个读/写 API 仍需服务端按当前身份、成员状态、作用域和动作实时校验；即使 UI 显示可操作，服务端拒绝时仍切换到对应错误态并刷新权限提示。需要二次确认的破坏性操作是确认意图，不是授权提示。

## 移动端与可访问性

- 窄屏（至少验证 320、390 CSS px）：切换器可触达、可滚动且不被侧栏/对话框裁切；租户组与空间名称可换行或截断并保留完整可访问名称；状态、错误和主操作垂直排列，不依赖横向表格或 hover。错误按钮有足够触控面积，长错误详情可展开且不横向溢出。
- 打开切换器/对话框时将焦点送入标题或搜索框；关闭时还焦到触发器。切换时保持在稳定的页面标题/主内容起点；被撤权时焦点移至错误标题，再可顺序到达“查看可访问空间”和“登录/重试”等动作。避免自动重定向导致焦点丢失或连续读屏播报。
- 使用语义标题、按钮名称和表单标签；错误摘要用 `role=alert`/合适的 live region 只播报一次，加载/切换结果用礼貌级别状态播报。色彩/图标不得是唯一状态线索；错误码可读、可复制但不替代简明说明。键盘可打开、搜索、方向键选择、Enter 确认、Escape 关闭；禁用项说明为何禁用，且焦点顺序不跳跃。
- 所有用户可见文案支持中英双语；使用屏幕阅读器验证切换前后 Tenant/Workspace 名称、加载状态、错误原因和恢复动作。不得在提示、链接或 URL 中泄露用户无权访问的 Tenant/Workspace 名称、资源名或 ID。

## 独立验收预留场景

验收夹具（均为非生产测试身份）：创建 active 租户 `North` 与 `South`；`North` 下 active Workspace `Research`、`Support`，`South` 下 active Workspace `Sales`。`Alex` 是两个 Tenant 的 active 成员，仅加入 `Research` 和 `Sales`；`Riley` 是 `North` 的 active TenantMember，但其 `Support` WorkspaceMember 已 removed；保留独立 owner 账号，避免测试破坏最后 owner 约束。

1. Alex 在可解析 Workspace 路径下无 header 请求空间 API，以及无路径 Workspace ID 且无 header 请求：都必须收到 `400 WORKSPACE_CONTEXT_REQUIRED`；UI 不把 `Support`/最近空间作为隐式授权。
2. Alex 在 `Research` 路径携带 `Sales` 或非十进制 header，以及无路径 Workspace ID 时携带非十进制 header：必须收到 `400 CONTEXT_MISMATCH`；不展示跨空间响应，不自动改路由。无法解析的路径 Workspace ID（即使 header 缺失或格式错误）必须先收到 `404 RESOURCE_NOT_FOUND`，映射为通用不可用状态。
3. Alex 分别访问 `Research` 与 `Sales`：Tenant 由服务端分别派生为 North/South；目录、角色、查询缓存互不混用。Alex 直达 `Support` 应是 `403 WORKSPACE_MEMBERSHIP_REQUIRED`，不能因其已是 North 成员而放行。
4. Riley 访问 `Support`：收到 `403 WORKSPACE_MEMBERSHIP_REQUIRED`；UI 显示成员关系不可用及返回列表操作，不承诺恢复访问。
5. 在 Alex 的 TenantMember 与 WorkspaceMember 仍 active 时将 North 暂停：访问 Research 显示 `409 TENANT_INACTIVE`；恢复 North 后再将 Research 归档/停用，显示 `409 WORKSPACE_INACTIVE`。逐次检查目录/权限缓存刷新和无敏感信息闪现。
6. 以无某动作权限的 Workspace 身份调用写 API：服务端返回 `403 FORBIDDEN`；即使测试强制显示/触发 UI 操作也不得成功，乐观状态回滚并刷新权限提示。
7. 使 Alex 会话过期或撤销，在已打开空间和进行中查询时请求 API：返回实际 `401`；私有缓存清理，页面转登录，恢复会话后才可重新验证原路由；写请求不盲目重放。
8. 并发切换：延迟 Research 的只读请求，Alex 切换至 Sales 后再释放旧响应；Sales 页面不得显示 North/Research 数据，迟到响应只属于原缓存键；确认切换不会取消已提交的后台任务。
9. 模拟断网/超时及一个成功、一个失败的多项操作：显示未验证状态并隐藏过期私有数据；失败项可单独重试，成功项不重复执行；恢复网络后先重验授权。另在 320/390px、纯键盘和屏幕阅读器下覆盖错误聚焦与播报。

上述场景是留给后续独立验收的清单。本次只完成设计审查；需要实现、状态码/detail 变更或验收结论时，另由相应实现与独立验证任务处理。

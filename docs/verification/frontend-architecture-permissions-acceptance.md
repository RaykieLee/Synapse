# 前端权限 capability 首批实现独立验收（4/8）

验收日期：2026-11-19
验收对象：`apps/web/src/lib/permissions.ts`、`permissions.test.ts`、全局用户路由与查询、租户列表/详情接入，以及 `docs/ux/frontend-architecture-permissions.md`。

## 结论

**首批能力模型与指定接入点通过定向代码和类型检查；完整三作用域 UX 与服务端安全验收不在本结论内。** Capability helper 将平台、租户和 Workspace 角色分开计算，测试覆盖跨作用域不继承；指定用户路由/查询和租户列表/详情已使用 helper。Chromium headless focused test 14/14 通过，`tsc -b` 退出码为 0；静态检查未发现本次指定页面仍直接比较角色。

留有一项契约待确认：helper 将 `viewTenantMembers` 授予所有有效租户角色，成员页因此允许普通 tenant member 请求成员名册；`docs/tenancy-contract.md` 明确普通 member 可查看本租户基础信息，但没有明确成员名册是否属于该能力。现有 API 也允许普通 member 读取名册，因此这是既有行为且本次没有扩大；在产品确认名册可见范围之前，不将其计作明确的契约符合证据。

本次没有实现 UX 审查报告中的错误/空态、权限提示、国际化、移动端或可访问性改进，也没有迁移侧栏、Workspace 页面或租户子页面的角色判断。相关问题仍是已知未迁移项，不作为本次通过证据。

## 命令与结果

以下命令在当前 worktree 执行；前端命令的工作目录为 `apps/web`。退出码均为实际记录值。静态代码检查不代表运行时授权测试。

| 命令 | 退出码 | 证据 | 局限与未覆盖项 |
| --- | ---: | --- | --- |
| `pnpm exec vitest run src/lib/permissions.test.ts --browser.headless` | 0 | Vitest 4.1.4：1 个文件、14 个测试通过。`apps/web/vite.config.ts:35-41` 将 Vitest Browser 配置为 Playwright Chromium；测试覆盖平台/租户/Workspace 各角色、未知角色拒绝、viewer 只读、owner 才可转移所有权及跨作用域不继承。 | 测试导入纯函数，没有渲染路由/页面，也没有发出真实 API 请求；浏览器模式不等于完成 UX 场景、移动端、键盘或读屏器验收。 |
| `pnpm exec tsc -b` | 0 | TypeScript 项目引用检查通过，无编译错误。 | 仅验证类型与项目图；不证明业务行为或授权正确。没有运行全项目构建。 |
| `rg -n "platform_role\s*===|tenant_role\s*===|workspace_role\s*===" apps/web/src/routes/_authenticated/users/index.tsx apps/web/src/features/users/index.tsx apps/web/src/features/tenants/index.tsx` | 1（预期无匹配） | 指定用户路由、用户功能页、租户功能页未发现这些直接相等比较；能力调用位置由下方代码走查确认。 | 此扫描仅覆盖指定文件和这三种相等表达式；不作为其他模块已迁移的证据。 |
| `rg -n "platform_role|tenant_role|workspace_role|tenantRole|workspaceRole|platform_admin" apps/web/src --glob '!**/*.test.*' --glob '!**/api/generated/**'` | 0 | 全前端角色引用扫描用于识别残留判断；人工区分当前操作者权限判断、目标成员角色约束、显示字段和 API 类型。残留清单见下文。 | `rg` 是文本扫描，单独不能区分操作者权限与目标对象状态；已对相关命中做代码走查。 |
| `rg -n "require_platform_admin|def get_tenant\(|def update_tenant\(|Only platform administrators|_require_role\(tenant_id, actor.user_id" apps/api/app/auth/dependencies.py apps/api/app/api/users.py apps/api/app/api/tenants.py apps/api/app/services/tenants.py` | 0 | 代码命中显示用户 API 依赖 `require_platform_admin`；租户服务保留 membership/role 检查及状态变更 platform-only 检查。对应位置见[后端授权静态证据](#服务端授权边界)。 | 静态走查，没有针对匿名、普通用户、租户成员或跨租户 ID 的真实请求/后端测试。 |
| `git diff HEAD -- apps/api` | 0（无输出） | 当前 worktree 相对 HEAD 没有 `apps/api` 改动。 | 无 diff 只能证明本次 worktree 未修改后端代码；不能证明已有后端实现完全符合全部安全契约。 |
| `git diff --unified=0 HEAD -- apps/web/src/api/users.ts apps/web/src/api/tenants.ts` | 0 | 两个 API wrapper 的工作树改动是 OpenAPI 生成类型替换；走查未发现 HTTP 路径、方法或请求处理改变。 | 这是静态 diff 检查；未验证服务器实际响应与生成 schema 的一致性。 |

## 角色矩阵与作用域隔离

`getPermissionCapabilities` 的输入是独立的 `platformRole`、`tenantRole`、`workspaceRole`（`apps/web/src/lib/permissions.ts:1-5,47-91`）。平台能力只由 `platform_admin` 产生；租户能力只由已知租户角色产生；Workspace 能力只由已知 Workspace 角色产生。未知/缺失角色没有命中相应的已知角色条件，结果按默认 false 收敛。

| 作用域与角色 | helper 映射 | 与契约对照及测试证据 |
| --- | --- | --- |
| 平台 `platform_admin` | 可管理平台用户、查看平台租户管理、创建租户、管理租户生命周期及租户基础设置；不自动获得 tenant/Workspace 成员能力。 | 符合 `docs/tenancy-contract.md` 的平台角色范围；“平台管理员不自动成为租户/空间成员”由 `permissions.test.ts` 的跨作用域用例验证。 |
| 租户 `owner` | 可查看租户/成员，管理租户成员、角色、设置、邀请并创建 Workspace；可邀请 tenant admin。 | owner 的管理及 Workspace 创建能力符合契约方向；邀请 admin 的限制由测试明确覆盖。成员名册可见性需按上文契约待确认项处理。 |
| 租户 `admin` | 可查看租户/成员、管理租户成员、角色、设置、邀请并创建 Workspace；不能邀请 admin，也不获得平台或 Workspace 能力。 | 契约明确 admin 管理成员和租户设置；角色/邀请等能力与当前租户页面和接口既有行为一致。名册可见性同样待确认。 |
| 租户 `member` | 可查看租户和成员名册；不能管理成员、角色、设置、邀请或创建 Workspace。 | 查看本租户基础信息符合契约；查看完整成员名册没有被契约角色表明确授权或禁止，见待确认项。测试证明不会因此获得 Workspace 能力。 |
| Workspace `owner` | 可查看/读取/使用资源，管理成员、资源和设置，并可转移所有权。 | 符合 Workspace owner 契约；测试覆盖转移权只属于 owner，且不获得 tenant/platform 权限。 |
| Workspace `admin` | 可查看/读取/使用资源，管理成员、资源和设置；不能转移所有权。 | 符合 Workspace admin 契约；测试覆盖不能转移所有权，且不获得 tenant/platform 权限。 |
| Workspace `member` | 可查看/读取并使用资源，不可管理成员、资源或设置，不可转移所有权。 | 符合 member 可使用有权资源的契约；测试覆盖使用与管理能力分开。 |
| Workspace `viewer` | 可查看/读取资源，不可使用写入型资源操作，也不可管理成员、资源或设置。 | 符合只读契约；测试覆盖读取为 true、使用/管理为 false。 |

跨作用域断言包括：平台管理员没有 tenant/Workspace 权限；tenant owner 不会因 tenant 角色获得 Workspace 访问；Workspace owner 不会获得 tenant/platform 权限。对应测试位于 `apps/web/src/lib/permissions.test.ts:118-145`。这证明 helper 的计算边界，不证明页面所有能力判断已迁移，也不证明服务端的每条业务 API 均正确授权。

### 待确认：tenant member 的成员名册读取

helper 在 `apps/web/src/lib/permissions.ts:69-70` 把 `viewTenantMembers` 等同于“任一已知 tenant role”；租户详情据此启用 `GET /tenants/{tenant_id}/members`（`apps/web/src/features/tenants/index.tsx:736-741,955-956`）。契约角色表（`docs/tenancy-contract.md:23-26`）只明确普通 member 可查看本租户基础信息，端点表（`:62`）列出成员分页响应字段但没有定义谁可读取完整名册。当前服务 `apps/api/app/services/tenants.py:376-387` 允许 owner/admin/member 查询，故这不是本次新增的权限扩大，但需要产品/契约明确名册访问范围。

## 指定页面接入与 API 安全边界

- 全局用户路由守卫在 `apps/web/src/routes/_authenticated/users/index.tsx:13-20` 以 `platform.managePlatformUsers` 决定是否继续或重定向 `/403`。用户页查询在 `apps/web/src/features/users/index.tsx:87-125` 使用同一能力作为 `enabled` 条件；查询仍处于全局个人 key 空间。该 helper 只控制 UI 路由/查询行为。
- 租户列表在 `apps/web/src/features/tenants/index.tsx:83-89,164-172` 通过平台租户管理能力选择平台租户目录或当前用户租户列表，并以独立的 actor/列表模式建立 query key。当前 `admin` 布尔值还被复用于创建、批量租户状态操作及平台筛选；虽然 helper 已提供 `createTenants`、`manageTenantLifecycle`，列表处未逐项消费这些细分 capability。当前三项均只授予 `platform_admin`，没有观察到现行矩阵下的越权；若未来拆分平台能力，应改为逐动作使用对应 capability。
- 租户详情在 `apps/web/src/features/tenants/index.tsx:713-739` 同时传入平台角色与当前租户响应角色，再分别计算租户管理、成员读取、租户设置和平台生命周期能力。平台管理员只有平台角色时可按契约查看/编辑平台租户基础设置和管理生命周期，但 helper 不因此赋予成员名册、租户成员管理或 Workspace 能力。
- 邀请区域以 tenant 管理能力控制，是否可邀请 admin 由 `inviteTenantAdmins` 单独传给 UI（同文件 `:1029-1050`）；这维持 owner/admin 邀请级别差异。成员与邀请列表错误/空态仍存在 UX 报告记录的问题，未由本次改动解决。
- `apps/web/src/api/users.ts`、`apps/web/src/api/tenants.ts` 同时存在 1/8 OpenAPI 类型改造；本次所审 wrapper diff 更改响应/请求 TS 类型，没有改请求路径或 HTTP 方法。

### 服务端授权边界

静态走查确认当前后端仍独立核权：

- `apps/api/app/auth/dependencies.py:28-31` 的 `require_platform_admin` 校验用户平台角色；`apps/api/app/api/users.py:27-79` 的全局用户列表、创建、读取、更新、删除和重置密码端点均依赖它。
- `apps/api/app/api/tenants.py:37-41,96-100` 的创建租户与平台租户目录端点依赖 `require_platform_admin`；租户详情由 `TenantService.get_tenant` 按 active tenant role 或 platform admin 判定（`apps/api/app/services/tenants.py:341-346`）。
- `TenantService.update_tenant` 要求 platform admin 或 tenant owner/admin，且明确只允许平台管理员改租户状态（`apps/api/app/services/tenants.py:348-361`）。成员写操作仍要求 owner/admin（`apps/api/app/services/tenants.py:409-410,457`）。
- `git diff HEAD -- apps/api` 无改动；因此没有证据显示本次 UI helper 替代、放宽或移除了服务端授权。上述只是源码走查，没有对拒绝响应、资源隐藏、跨租户/Workspace 访问或状态撤权时效做 API 运行验证。

## 尚未迁移的角色比较

本次指定文件的直接比较扫描没有匹配，但全前端扫描确认还有既有角色判断。以下项目是后续迁移/代码走查清单，**不作为本次 capability 统一或服务端越权已通过的证据**：

- `apps/web/src/components/layout/app-sidebar.tsx`：侧栏仍直接根据 tenantRole 和 platform role 决定租户管理链接/全局用户入口。
- `apps/web/src/features/workspaces/directory.tsx`：仍按租户 owner/admin 控制创建 Workspace，并按 Workspace owner/admin 计算管理入口。
- `apps/web/src/features/workspaces/pages.tsx`、`models-page.tsx`、`teams-page.tsx`、`attachments-page.tsx`：仍直接按当前 Workspace role 控制成员/资源/附件/团队相关能力。其中 `teams-page.tsx`、`attachments-page.tsx` 不在 `docs/development-status.md:9,195` 的 4/8 残留清单中；`teams-page.tsx` 已在 UX 报告 `:57` 提及，attachments 页是本次 rg 新发现的遗漏。
- 租户子页 `apps/web/src/features/tenants/{configs-page.tsx,departments-page.tsx,dictionaries-page.tsx,menus-page.tsx,roles-page.tsx,scheduled-tasks-page.tsx}`：仍按当前 `tenant_role` 自行计算管理权限。
- `apps/web/src/features/tenants/components/member-table.tsx` 与 `member-custom-role.tsx`、以及 Workspace 成员页中的目标成员角色比较，主要用于目标成员角色约束/行操作状态，而非当前操作者 capability 入口；仍应单独确认其域规则，不可将这些比较当作已迁移能力。

## UX 报告对照与覆盖边界

`docs/ux/frontend-architecture-permissions.md` 的结论明确不建议据此宣称三作用域 UX 已统一（`:5-12`、`:54-60`）。其指出租户成员/邀请请求失败会误显空状态、动态导航缺少独立错误状态、权限边界说明和英文角色文案不足，并要求补充中英、窄屏、键盘和可访问性验收（`:27-59`）。本次 diff 只新增/使用 capability helper，没有修订这些 UI 状态、文案或导航行为；focused helper test 也没有验证上述 UX 场景。因此 UX 缺陷仍未解决、未复验。

未覆盖项：

- 未用不同账号在真实 API/应用中验证 platform admin、tenant owner/admin/member 与 Workspace owner/admin/member/viewer 的完整页面矩阵。
- 未验证跨租户/跨 Workspace 直达 URL、成员撤销/恢复、缓存失效、API 403/404 或错误信息是否泄漏资源存在性。
- 未做实际视口截图、320/375/768 px 响应式检查、键盘遍历、焦点恢复或读屏器检查。
- 未运行 API 安全测试或全项目构建；本报告不替代后端权限、数据隔离及相关功能点的独立验收。
- UX 文档自己的测试未执行说明准确描述其原审查时状态；本次只补充 helper focused test 证据，不将其解释为对 UX 问题的修复或复验。

## 本次验收产物

本验收 worker 只新增了本报告，没有修改产品实现或其他状态文档。

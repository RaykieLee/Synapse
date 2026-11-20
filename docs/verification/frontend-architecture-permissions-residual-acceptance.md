# 前端权限 capability 残留迁移独立验收

验收日期：2026-11-19

验收范围：`getPermissionCapabilities` 当前操作者接入，覆盖 `app-sidebar`、Workspace 目录/页面/模型/团队/附件、六个租户子页面、全局用户入口；并核对目标成员约束与开发台账。

## 结论

**指定迁移范围通过；整体状态为部分通过。** 指定入口均用 helper 计算当前操作者能力，未发现页面继续直接比较操作者角色；三作用域以独立角色输入计算，目标成员角色保护仍保留。

部分通过原因：`docs/development-status.md:11` 记载 models/teams 组合测试失败，但本次精确命令通过；tenant member 完整名册可见范围待契约确认；tenant admin 获得 `manageTenantRoles`、`createWorkspaces` 的授权见当前矩阵，但 `docs/tenancy-contract.md` 未逐项明确。

## 能力模型与接入证据

- `apps/web/src/lib/permissions.ts:1,47-91` 将 `platformRole`、`tenantRole`、`workspaceRole` 独立计算。未知角色默认拒绝；平台管理员不因此成为租户/空间成员，tenant owner 不推导 Workspace 成员身份，Workspace owner 不继承平台/租户能力。
- `platform_admin` 只取得平台能力；`inviteTenantAdmins` 限 tenant owner；Workspace owner 才可转移所有权；Workspace member 可使用资源，viewer 只读。
- `apps/web/src/lib/permissions.test.ts:4` 覆盖各作用域已知/未知角色及三种跨作用域不继承场景；helper 的 14 项测试通过。

| 接入面 | 代码证据 |
| --- | --- |
| 导航/目录 | `app-sidebar.tsx:170,361`；`workspaces/directory.tsx:97,161,261,311`，用于租户/平台导航、归档入口与 Workspace 创建。 |
| Workspace 页面 | `workspaces/pages.tsx:48,179,331`；`models-page.tsx:91`；`teams-page.tsx:211`；`attachments-page.tsx:100`，控制设置、成员、资源、模型凭据、团队与附件操作。 |
| 租户子页 | `configs-page.tsx:83`、`departments-page.tsx:48`、`dictionaries-page.tsx:65`、`menus-page.tsx:49`、`roles-page.tsx:94`、`scheduled-tasks-page.tsx:85`，均以当前租户 `tenant_role` 计算 `canManage`。 |
| 全局用户入口 | `routes/_authenticated/users/index.tsx:15` 与 `features/users/index.tsx:92` 均使用 `platform.managePlatformUsers`。 |

指定页面的角色字面量走查中，业务层直接比较只有 `workspaces/pages.tsx:492,655` 的 `member.workspace_role === 'owner'`，对象是目标成员而非操作者。其余指定页面的当前操作者判断均使用 capability helper。

## 目标成员约束与保留项

- `workspaces/pages.tsx:331-336` 以 `transferWorkspaceOwnership` 得出当前操作者 `isOwner`；owner 角色选项/转移操作只对 owner 开放（`:460,545,584,631`）。非 owner 不能编辑目标 owner（`:492-506`），非 owner 重新加入原 owner 时会降为 member（`:655`）。这些目标角色约束仍独立于 capability 判断。
- `tenants/components/member-table.tsx:210,237` 继续保护目标 tenant owner，不开放角色编辑及暂停/移除操作。`tenants/components/member-custom-role.tsx:60-61,120-128` 只允许为 active tenant member 分配自定义角色，owner/admin 目标明确拒绝。`git diff HEAD` 走查未发现这些目标约束被删除；`member-table.tsx` 相对 HEAD 无改动，`member-custom-role.tsx` 改动仅涉及查询作用域。
- 范围外的有意残留：`tenants/components/member-table.tsx:340` 仍以当前操作者 `currentRole === 'owner'` 控制是否显示 owner 角色选项。该文件不在本次指定迁移面，且已列于 `docs/development-status.md:11`；本次未修改。
- 名册范围待确认：helper 对所有有效 tenant role 授予 `viewTenantMembers`（`permissions.ts:69-70`）。`docs/tenancy-contract.md:17-27` 只明确 member 可查看租户基础信息，没有明定完整名册；原独立验收已记录（`frontend-architecture-permissions-acceptance.md:10,45`）。本次未扩大该既有行为，不将其作为明确契约符合证据。
- 契约细化待确认：tenancy-contract 的角色表没有明确将 `manageTenantRoles`、`createWorkspaces` 分配给 tenant admin。没有发现跨作用域继承，但正式角色映射仍需由权威契约确认，不能只由台账替代。

## 台账核对

`docs/development-status.md:11` 的迁移范围及范围外残留与当前代码吻合：列出的导航、Workspace 页面和租户子页已使用 helper；`member-table` 操作者 owner 选项判断及目标成员角色约束仍有记录。该行的组合测试结果过期：当前 `teams-page.test.tsx` 已加入 `useNavigate` mock，本次组合命令通过。受文件范围限制，本报告未修改开发台账；请主协调者据本次证据更新历史验证结果。

## 验证结果

前端命令在 `apps/web` 执行，diff 命令在仓库根目录执行。

| 命令 | 结果 | 覆盖与限制 |
| --- | --- | --- |
| `pnpm exec vitest run src/lib/permissions.test.ts src/features/workspaces/models-page.test.tsx src/features/workspaces/teams-page.test.tsx --browser.headless` | 退出码 0；3 个文件、45 个测试通过 | Teams 使用 mock；不覆盖清单内每个页面或真实 API/账户权限。 |
| `pnpm exec tsc -b --pretty false` | 退出码 0 | 类型检查通过，不证明运行时授权或接口隔离。 |
| `git diff --check` | 退出码 0 | 工作树 diff 无空白错误；Git 对其他既有改动输出 CRLF→LF 规范化警告，不影响退出码。另对本报告做了尾随空白扫描。 |
| `git diff --cached --check` | 退出码 0 | 暂存 diff 无空白错误。 |

## 限制

- Capability 仅用于 UI/导航，不替代服务端逐请求授权。本次没有用不同身份验证真实 API、跨租户/Workspace URL、撤权/缓存隔离或 403/404 信息泄漏。
- 未对所有页面执行 UI 角色矩阵、真实视口、键盘或读屏器验收；focused tests 与 `tsc` 不代表完整 UX 通过，相关问题见 `docs/ux/frontend-architecture-permissions.md`。
- 本验收仅新增此报告，未改产品实现、测试、API 契约或 `docs/development-status.md`。

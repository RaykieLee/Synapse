# TanStack Query 缓存键统一实现独立验收

- 验收日期：2026-11-19
- 验收范围：`apps/web/src/lib/query-keys.ts`、`query-keys.test.ts`，以及使用该 helper 的 Workspace / AgentScope 查询调用点。
- 实施约束：本轮只新增本报告，未修改产品实现或测试。
- 下文 `apps/web/src` 内文件的行号均相对该目录；`apps/api` 文件路径相对仓库根目录。

## 结论

**部分通过。** 统一 key factory 的作用域分层、常规跨作用域隔离、同作用域参数分键及 TanStack Query 前缀失效均通过 focused tests 和内存 QueryClient 验证。Workspace 路由的 workspace-detail helper 在路由父/子 `beforeLoad` 与 `WorkspaceRouteLayout` 之间保持单次详情请求；但完整路由仍有两个未统一的缓存键调用点：应用侧栏自行构造 workspace-detail key，路由上下文的 workspace-directory key 也与目录 hook 不同。因此不能据此宣称完整 Workspace 路由请求已经统一或整项验收完成。

## 验证命令与证据

| 命令 | 退出码 | 证据 | 局限 |
| --- | ---: | --- | --- |
| `pnpm exec vitest run src/lib/query-keys.test.ts src/features/workspaces/context.test.tsx src/features/workspaces/models-page.test.tsx --browser.headless`（工作目录 `apps/web`） | 0 | 3 个测试文件通过，共 24 项。覆盖层级序列、actor/tenant/workspace/membership-version 差异、AgentScope domain/resource 前缀、参数归一化、缺失 tenant 拒绝、Workspace 详情请求复用及 models 页面相关缓存行为。 | 使用前端测试 fixture；路由测试没有挂载 `AppSidebar`，也没有断言 workspace-directory 请求次数。 |
| `pnpm exec tsc -b`（工作目录 `apps/web`） | 0 | TypeScript build references 检查完成，无诊断输出。 | 仅类型检查，不包含 Vite bundle 或真实后端联调。 |
| `rg -l "queryKey:" apps/web/src`；`rg -l "queryKeys\." apps/web/src` | 0 | 对 `apps/web/src` 中缓存键调用点做清单扫描；结果见下文迁移清单。 | 文本扫描本身不能证明运行时行为；需结合调用点代码走查。 |
| PowerShell here-string 输入 `node --experimental-strip-types --input-type=module`，导入实际 `query-keys.ts` 与 `@tanstack/react-query` `QueryClient`，执行下方内存 probe（工作目录 `apps/web`） | 0 | 输出确认 actor/tenant/workspace/version、global/tenant、personal/workspace 均分键；相同 resource 下 page 1/2 分别保留不同缓存数据；`ops` 前缀只失效两个 ops 页，不影响 chat 或其他 scope/version。 | 内存 QueryClient 探针验证 key/hash 与失效语义，不覆盖 React 页面完整网络请求生命周期。 |

Probe 脚本：

```powershell
@'
import { QueryClient } from "@tanstack/react-query"
import { normalizeQueryKeyParams, queryKeys, workspaceQueryScope } from "./src/lib/query-keys.ts"
const workspace = { tenant_id: "tenant-7", workspace_id: "workspace-11", membership_version: 3 }
const scope = workspaceQueryScope("actor-1", workspace)
const agentKey = (s, params) => queryKeys.agentscope.query(s, ["ops", "schedules"], params)
const base = agentKey(scope, { page: 1 })
const variants = {
  actor: agentKey(workspaceQueryScope("actor-2", workspace), { page: 1 }),
  tenant: agentKey(workspaceQueryScope("actor-1", { ...workspace, tenant_id: "tenant-8" }), { page: 1 }),
  workspace: agentKey(workspaceQueryScope("actor-1", { ...workspace, workspace_id: "workspace-12" }), { page: 1 }),
  membership: agentKey(workspaceQueryScope("actor-1", { ...workspace, membership_version: 4 }), { page: 1 }),
}
const page1 = queryKeys.workspace.query(scope, ["models", "list"], { page: 1 })
const page2 = queryKeys.workspace.query(scope, ["models", "list"], { page: 2 })
const globalTenant = queryKeys.tenant.query(queryKeys.actorScope("actor-1"), "directory")
const scopedTenant = queryKeys.tenant.query({ actorId: "actor-1", tenantId: "tenant-7" }, "directory")
const personalWorkspace = queryKeys.workspace.query({ actorId: "actor-1", tenantId: "tenant-7" }, "detail")
const scopedWorkspace = queryKeys.workspace.query({ actorId: "actor-1", tenantId: "tenant-7", workspaceId: "workspace-11" }, "detail")
const client = new QueryClient()
client.setQueryData(page1, "page-one")
client.setQueryData(page2, "page-two")
const ops1 = agentKey(scope, { page: 1 })
const ops2 = agentKey(scope, { page: 2 })
const chat = queryKeys.agentscope.query(scope, ["chat", "sessions"])
for (const [key, value] of [[ops1, "ops-one"], [ops2, "ops-two"], [chat, "chat"], [variants.actor, "actor"], [variants.tenant, "tenant"], [variants.workspace, "workspace"], [variants.membership, "membership"]]) client.setQueryData(key, value)
const prefix = queryKeys.agentscope.resource(scope, "ops")
await client.invalidateQueries({ queryKey: prefix, refetchType: "none" })
const invalidated = Object.fromEntries([["ops_page_1", ops1], ["ops_page_2", ops2], ["chat", chat], ["actor", variants.actor], ["tenant", variants.tenant], ["workspace", variants.workspace], ["membership_version", variants.membership]].map(([name, key]) => [name, client.getQueryState(key)?.isInvalidated]))
console.log(JSON.stringify({
  differingScopesDistinct: Object.fromEntries(Object.entries(variants).map(([name, key]) => [name, JSON.stringify(base) !== JSON.stringify(key)])),
  globalVsTenantDistinct: JSON.stringify(globalTenant) !== JSON.stringify(scopedTenant),
  personalVsWorkspaceDistinct: JSON.stringify(personalWorkspace) !== JSON.stringify(scopedWorkspace),
  sameScopeParamsDistinct: JSON.stringify(page1) !== JSON.stringify(page2) && client.getQueryData(page1) === "page-one" && client.getQueryData(page2) === "page-two",
  paramsNormalizeObjectOrder: JSON.stringify(normalizeQueryKeyParams({ z: 1, a: 2 })) === JSON.stringify(normalizeQueryKeyParams({ a: 2, z: 1 })),
  prefixInvalidation: invalidated,
}))
'@ | node --experimental-strip-types --input-type=module
```

实际输出：

```json
{"differingScopesDistinct":{"actor":true,"tenant":true,"workspace":true,"membership":true},"globalVsTenantDistinct":true,"personalVsWorkspaceDistinct":true,"sameScopeParamsDistinct":true,"paramsNormalizeObjectOrder":true,"prefixInvalidation":{"ops_page_1":true,"ops_page_2":true,"chat":false,"actor":false,"tenant":false,"workspace":false,"membership_version":false}}
```

## 分层验收

| 层级 | 结果与证据 |
| --- | --- |
| Actor、tenant/global、workspace/personal | `query-keys.ts:54-62` 先固定 `synapse / actor / tenant / workspace` 顺序；`query-keys.test.ts:35-67` 断言不同 actor、tenant、workspace 分键；probe 额外确认 global 与具体 tenant、personal 与具体 workspace 分键。 |
| Membership version | `query-keys.ts:64-70,105-114` 将 membership version 放在 context 层，Workspace scope 从 `membership_version` 取值（缺省为 `0`）；单测和 probe 均确认版本 `3` 与 `4` 不同键。`queryKeys.scope(...)` 刻意只生成前三层作用域前缀，可用于同一 actor/tenant/workspace 下跨版本的权限缓存清理。 |
| Domain、resource、params | `query-keys.ts:72-95,116-140` 顺序为 context、domain、resource segments、归一化 params 对象；单测验证 Workspace/AgentScope domain 与资源前缀，probe 验证 params 变化生成不同缓存条目。 |
| 参数归一化 | `query-keys.ts:35-52` 递归排序对象属性、去除对象中的 `undefined`、把 Date 转 ISO 字符串；`query-keys.test.ts:82-98` 覆盖嵌套对象/Date/undefined，probe 确认属性顺序不同的对象归一化一致。 |
| Prefix invalidation | `query-keys.test.ts:70-79` 检查 AgentScope `ops` 的数组前缀；probe 使用真实 TanStack QueryClient 执行 `invalidateQueries({ queryKey: opsPrefix, refetchType: "none" })`，实际仅 `ops_page_1`、`ops_page_2` 的 `isInvalidated` 为 true，chat 和 actor/tenant/workspace/version 变体均为 false。 |
| Workspace detail 请求复用 | `workspaceDetailQueryKey` 使用统一 helper（`features/workspaces/context.tsx:45-55`）；`context.test.tsx:196-220` 覆盖父/子 route `beforeLoad` 与 layout，并断言 workspace 11 的 detail GET 恰为 1 次。 |

## 迁移清单

以下路径均相对 `apps/web/src`。“已迁移”指本次静态扫描中，生产查询调用使用 `queryKeys` helper；`context.tsx` 的目录缓存例外列在发现项中。

- **Workspace 查询调用使用 helper：** `features/workspaces/{agents-page.tsx,attachments-page.tsx,directory.tsx,model-provider-query-key.ts,models-page.tsx,pages.tsx,sessions-page.tsx,teams-page.tsx}`；`features/workspaces/context.tsx` 的 workspace detail key 使用 helper。
- **AgentScope 查询调用使用 helper：** `features/agentscope-chat/page.tsx`、`features/agentscope-chat/components/session-config-panel.tsx`、`features/agentscope-credential/page.tsx`、`features/agentscope-ops/page.tsx`、`features/agentscope-resources/{knowledge-page.tsx,mcp-page.tsx,skills-page.tsx}`、`features/agentscope-sop/page.tsx`。
- **仍有本地 key / 未纳入本次统一完成范围：** `components/layout/app-sidebar.tsx`、`features/setup/page.tsx`、`features/tenants/{configs-page.tsx,departments-page.tsx,dictionaries-page.tsx,index.tsx,menus-page.tsx,roles-page.tsx,scheduled-tasks-page.tsx}`、`features/tenants/components/{member-custom-role.tsx,member-custom-role-query.ts,owner-picker.tsx}`、`features/users/index.tsx`。`features/tenants/components/member-custom-role-query.test.ts` 是本地 key helper 的测试文件，不代表生产页面迁移。

因此不能宣称租户、用户、设置或全局侧栏目录已经迁移到统一 key factory；本验收也不覆盖这些目录的缓存正确性。

## 发现项与待复验边界

1. **Workspace 侧栏的 detail key 与 route helper 不一致。** `context.tsx:45-55` 生成 `['synapse', actor, tenant, workspace, 'membership', version, 'workspace', 'workspace-detail']`；`components/layout/app-sidebar.tsx:248-263` 手写为 `['synapse', actor, tenant, workspace, 'workspace-detail', version]`。侧栏虽注释称共享 route detail query，但 key 不同，并设置 `staleTime: 0`、`refetchOnMount: 'always'`，且 queryFn 再次调用 `getWorkspace`。因此 route context 单测通过只能证明其 fixture 内父/子/layout 的 detail 请求复用，不能证明真实应用侧栏也复用同一缓存或保持一条 detail 请求。需要统一调用点或明确该侧栏重验请求为有意行为，并补充挂载应用外壳的请求计数复验。
2. **Workspace directory key 仍有两套结构。** `context.tsx:32-42,292-300` 手写 `workspaceDirectoryQueryKey`，并在 `validateWorkspaceRoute` 下以该 key 缓存 `listAllWorkspaces(true)`；`directory.tsx:78-85` 则以 `queryKeys.workspace.query(..., 'directory', { includeArchived, page, pageSize })` 缓存同一请求。二者 key 不相等，因此 route loader 与 layout 的 `useWorkspaceDirectory(true)` 不能共享目录缓存；context 中通过 `queryKeys.workspace.resource(..., 'directory')` 发起的失效也不会命中手写 key。当前 context 测试只断言 detail 请求数，目录请求次数与这两套缓存的同步未被测试覆盖。
3. **字符串 sentinel 的适用前提。** scope 缺省值编码为字面量 `global`、`personal`、`unversioned`（`query-keys.ts:54-70`）。当前后端 tenant/workspace 路由参数为整数（`apps/api/app/api/tenants.py:120-129`、`workspaces.py:66-78`），实际 ID 不会使用这些字面量；但前端接口类型为 `string`，helper 未以类型或编码方式保留这些值。若 ID 契约改成任意 opaque string，应补充保留字碰撞测试或改用不冲突的标记编码。本轮 probe 使用普通 ID，未把 sentinel 字面量作为真实 ID 测试。

**复验限制：** 本轮按要求只运行指定 focused tests 与 `tsc -b`，未运行全项目构建；没有调用真实 API。QueryClient probe 证明缓存 key 和 invalidation 的内存行为，不能替代对应用 shell 完整路由请求数的浏览器验收。

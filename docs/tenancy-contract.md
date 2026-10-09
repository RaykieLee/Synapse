# Synapse 租户与 Workspace 数据/API 契约

状态：设计契约，供后续独立实现使用。本文约定首期共享数据库、一个 FastAPI 进程内的上下文传递；不增加计费、套餐或用量范围。

## 1. 身份与作用域

- **全局账号（User）**是唯一登录身份。账号资料、凭据、密码状态与登录记录属于全局账号，不因加入或离开租户而复制或删除。沿用 Synapt `sys_user` 的 `user_id`、`user_name`、`nick_name`、`email`、`phonenumber`、`sex`、`avatar`、`status`、`del_flag` 等属性；`dept_id` 和全局 `role_ids` 不再作为租户授权来源。
- **租户（Tenant）**是组织边界。租户记录有 `tenant_id`、`slug`、`name`、`status` (`active|suspended|archived`)、`settings_json`、`created_at`、`updated_at`。状态不为 active 时，普通成员不能建立该租户上下文。
- **租户成员（TenantMember）**由 `(tenant_id,user_id)` 唯一标识，字段为 `status` (`invited|active|suspended|removed`)、`tenant_role` (`owner|admin|member`)、`joined_at`、`created_at`、`updated_at`。首期邀请可生成链接，但投递不属于本契约。租户成员关系不意味着拥有租户下所有空间的业务数据访问权。
- **协作 Workspace**归属于单一租户，字段为 `workspace_id`、`tenant_id`、`slug`、`name`、`icon`、`status` (`active|archived`)、`settings_json`、`created_by`、时间戳。`(tenant_id,slug)` 唯一。
- **空间成员（WorkspaceMember）**由 `(workspace_id,user_id)` 唯一标识，字段为 `tenant_id`（与 Workspace 一致）、`status` (`active|suspended|removed`)、`workspace_role` (`owner|admin|member|viewer`)、`joined_at`、时间戳。成员必须同时是该空间所属租户的 active TenantMember。不得移除或降权最后一个 active owner。
- TenantMember 必须始终至少有一个 `status=active` 且 `tenant_role=owner` 的成员。禁止暂停、移除或降权最后一位 active tenant owner；租户归档/停用不等于移除 owner 关系。
- TenantMember 状态不是 active（包括 suspended、removed）时，该用户在该租户下所有 WorkspaceMember 的有效权限立即失效，即使 WorkspaceMember 自身仍标记为 active。恢复租户成员资格时，不自动恢复任何空间权限：重新加入/激活 TenantMember 后，须逐个重新授予 WorkspaceMember 关系或显式恢复其状态，确保撤权期间的访问不会因重新加入而复活。
- 首次 `platform_admin` 必须由运维在受控环境中执行显式 CLI 初始化命令创建，并由操作者交互输入账号标识及凭据/身份提供方绑定；命令不得提供或生成默认密码、不得匿名公开初始化端点。普通匿名用户永远不能初始化平台管理员。
- 成员关系表保留 `tenant_id`，并以组合外键/唯一约束保证 `workspace_id,tenant_id` 对应同一 Workspace，防止跨租户关联。

### 角色与权限

采用作用域分离的 RBAC。角色标识是作用域内稳定字符串，权限是稳定的 `resource:action` 字符串；服务端对每个请求按当前上下文计算授权，UI 菜单只用于显示，不能替代接口授权。

| 角色 | 作用域 | 默认能力 |
| --- | --- | --- |
| `platform_admin` | 平台 | 创建、停用、归档租户及租户基础设置；不因该角色自动读取聊天、凭据或人脸业务数据 |
| `owner` / `admin` / `member` | 租户 | owner 可管理租户及租户成员；admin 可管理租户成员和租户设置；member 可查看自己所在租户的基础信息。三者均不能仅凭租户角色访问未加入空间的数据 |
| `owner` / `admin` / `member` / `viewer` | Workspace | owner 管理空间、成员并转移所有权；admin 管理空间成员、设置和空间资源；member 使用其有权使用的空间资源；viewer 只读空间资源 |

权限定义可使用如 `tenant:read`, `tenant:update`, `tenant_member:manage`, `workspace:create`, `workspace:update`, `workspace_member:manage`, `resource:read`, `resource:create`, `resource:update`, `resource:delete`。业务动作还应按资源类型细分。角色名称不能跨作用域推导：Workspace `owner` 不自动成为租户 owner，平台管理员不自动成为空间成员。Synapt 的 `sys_role`/`sys_user_role` 可保留为旧系统管理数据迁移来源；新租户/空间授权以成员角色为准，禁止把一个全局 `role_key` 当作所有租户权限。

## 2. 归属与隔离规则

所有业务资源须标明且不可由客户端改写其归属。空间资源至少有 `tenant_id`、`workspace_id`、`created_by`、`created_at`、`updated_at`；外键校验 `(workspace_id,tenant_id)`，每条读写查询均由已验证上下文注入归属条件。路径中的资源 ID 不可作为授权凭证。

| 归属范围 | 资源与规则 |
| --- | --- |
| 全局账号私有 | 账号资料、登录凭据、密码、个人设置、登录记录；账号自身管理，账号管理员权限需显式定义且不能由租户角色继承 |
| 租户 | 租户成员、租户部门、租户角色/策略、租户配置与字典覆盖；租户 ID 必须由已验证租户上下文约束 |
| Workspace 共享 | 智能体定义、知识库、附件/文件、向量索引、人脸库及人员、任务、渠道配置、空间资源库、空间设置；默认仅该空间成员按角色访问 |
| 个人私有 | 聊天会话、个人凭据、个人 MCP/Skill 资源和个人资源；所有者键为 `owner_user_id`，同时记录创建时的 `tenant_id`、`workspace_id` 以限定工作上下文。缺省不得向其他空间成员共享 |
| 显式共享 | 可共享资源需有单独授权记录（`resource_id`, `grantee_type`, `grantee_id`, `permission`, `granted_by`, `created_at`）；共享不能绕开租户边界。撤销后立即拒绝后续请求 |

AgentScope runtime workspace（`runtime_workspace_id`）是运行目录、文件和记忆容器，**不是**协作 Workspace。映射表 `workspace_runtime_bindings` 至少包含 `binding_id`、`tenant_id`、`workspace_id`、`runtime_workspace_id`、`created_at`，以组合唯一约束防止跨空间映射。一个协作空间可映射多个 runtime workspace。AgentScope 请求由统一后端适配层传入可信 `actor_user_id`、`tenant_id`、`workspace_id`；禁止采信 `X-User-ID` 或客户端自报 owner。统一后端和 AgentScope 在同一服务进程，后台任务也必须持久化原始归属和发起人，并在执行时再次检查成员状态/权限。

## 3. URL、API 与上下文

浏览器工作区页面使用 `/w/{workspace_id}/...`。租户上下文由服务端根据 Workspace 归属解析，客户端不得在路径中另传可冲突的 tenant ID。全局账号页使用 `/account/...`，租户管理使用 `/tenants/{tenant_id}/...`。初期 API 前缀为 `/api/v1`，租户管理在 `/api/v1/tenants`，空间管理在 `/api/v1/workspaces`，既有业务模块仍挂在 `/api/v1/system/*`、`/api/v1/face/*`、`/api/v1/ai/*`，空间业务必须带工作区上下文。

空间业务请求采用 `X-Workspace-ID: <workspace_id>`；它只是请求上下文提示，不授予权限。若 URL 有 workspace ID，header 必须相同，否则 `400 CONTEXT_MISMATCH`。若 URL 没有 workspace ID，凡属空间业务的端点必须带 header，否则 `400 WORKSPACE_CONTEXT_REQUIRED`。服务端由该 ID 派生 tenant ID，并检查账号 active、租户 active、Workspace active、active TenantMember、active WorkspaceMember、所需动作权限。`tenant_id` 可在服务端注入的内部上下文及响应中提供，不接受普通客户端用它覆盖派生值。无需空间的个人 API 不得被强行赋予最近访问空间。

服务端依赖应统一生成不可变请求上下文：`actor_user_id`, `tenant_id?`, `workspace_id?`, `tenant_role?`, `workspace_role?`, `permission_set`, `membership_version`。全部主应用 API、AgentScope 子应用、SSE/WebSocket 握手、上传/下载签名、索引与后台任务入口都经过同一上下文校验；系统内部调用显式传递此上下文或使用具名 system actor，不以缺少用户身份作为绕过路径。

### 建议端点

所有 ID 在 JSON 中使用字符串形式的十进制值（避免 JavaScript 大整数精度问题）。请求/响应时间用 RFC 3339 UTC；列表分页统一 `page`、`page_size`（默认 1/20，最大 100）、`items`、`total`。

| 方法与路径 | 说明/契约 |
| --- | --- |
| `GET /api/v1/me/context` | 返回账号摘要、可访问租户和空间、最近空间提示及 `context_version`；只返回 active 成员关系，不以最近空间跳过鉴权 |
| `GET /api/v1/tenants` | 当前用户 active 租户列表，含 `tenant_role` 和其可访问空间摘要 |
| `POST /api/v1/tenants` | **仅 `platform_admin` 可调用**。请求 `{slug,name,first_owner_user_id}`；`first_owner_user_id` 必须指向已存在且可登录的全局账号。事务中创建 Tenant、首位 active TenantMember（`tenant_role=owner`）、首位 WorkspaceMember（`workspace_role=owner`）及默认 Workspace。平台管理员调用者不会因此自动成为该租户成员。用户和成员 JSON 中的 ID 均使用十进制字符串。 |
| `GET /api/v1/tenants/{tenant_id}` | 租户基础信息，需租户成员或平台租户管理权限 |
| `PATCH /api/v1/tenants/{tenant_id}` | `{name?,status?,settings?}`；状态和设置由相应租户/平台权限控制 |
| `GET /api/v1/tenants/{tenant_id}/members` | 租户成员分页；响应项含 `user_id`, `user_name`, `nick_name`, `email`, `status`, `tenant_role`, 时间 |
| `POST /api/v1/tenants/{tenant_id}/members` | 添加/接受成员；`{user_id,tenant_role}` 或邀请流程所需身份字段；必须创建/激活 TenantMember，不能直接创建全局账号冒充用户 |
| `PATCH /api/v1/tenants/{tenant_id}/members/{user_id}` | `{tenant_role?,status?}`；移除用 `status=removed`，保留审计关系。更新后立即使该用户在该租户所有 Workspace 的有效权限失效；重新加入须重新单独授予空间成员资格。 |
| `GET /api/v1/workspaces` | 返回当前用户有权访问的 active 空间；可选 `tenant_id` 仅作筛选且须校验成员权 |
| `POST /api/v1/tenants/{tenant_id}/workspaces` | `{slug,name,icon?}`；仅该租户 active TenantMember 且 `tenant_role=owner|admin` 可创建；创建者自动成为该空间首位 `owner` 并加入 WorkspaceMember。普通租户 `member`、仅有平台管理员身份者不可创建。 |
| `GET /api/v1/workspaces/{workspace_id}` | 需 active 空间成员；响应含派生 `tenant_id`、当前角色和 `context_version` |
| `PATCH /api/v1/workspaces/{workspace_id}` | `{name?,icon?,status?,settings?}`；要求空间管理权限 |
| `GET /api/v1/workspaces/{workspace_id}/members` | 空间成员列表，需空间成员及相应查看权限 |
| `PUT /api/v1/workspaces/{workspace_id}/members/{user_id}` | `{workspace_role}`；目标须是所属租户 active 成员；幂等 upsert，变更须检查最后 owner 规则 |
| `DELETE /api/v1/workspaces/{workspace_id}/members/{user_id}` | 软移除成员；不得移除最后 owner；删除者有空间成员管理权限 |
| `POST /api/v1/workspaces/{workspace_id}/transfer-ownership` | `{new_owner_user_id}`；原 owner 确认转交并在事务中完成角色变更 |

创建、修改成功响应应返回完整对象和 `context_version`/`membership_version`。授权判断与成员状态更新需事务化；变更角色、移除/暂停租户成员、暂停租户/空间后，权限版本递增并使关联会话和缓存失效。租户成员失效须在所有空间请求的服务端授权计算中同步生效，不依赖异步缓存清理完成；缓存版本不匹配时必须拒绝访问。不得提供“以任意 user_id 代行”的公开请求参数。

## 4. 统一错误响应

错误采用 `application/problem+json`，形状如下：

```json
{
  "type": "https://synapse.invalid/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "WORKSPACE_MEMBERSHIP_REQUIRED",
  "detail": "当前账号无权访问此 Workspace",
  "request_id": "req_..."
}
```

`type` 使用部署域名下稳定文档 URI；`code` 是机器可读稳定枚举，detail 不泄露资源是否存在或其他成员隐私。常见映射：未认证 `401 AUTHENTICATION_REQUIRED`；无成员/动作权限 `403 FORBIDDEN`；资源不存在或调用者无权知晓其存在时 `404 RESOURCE_NOT_FOUND`；租户/空间上下文缺失、矛盾、不可用分别为 `400 WORKSPACE_CONTEXT_REQUIRED`、`400 CONTEXT_MISMATCH`、`409 TENANT_INACTIVE`/`409 WORKSPACE_INACTIVE`；成员关系停用/撤销为 `403 MEMBERSHIP_INACTIVE`；最后所有者保护为 `409 LAST_OWNER_REQUIRED`；输入校验 `422 VALIDATION_ERROR`（可附 `errors: [{field,code,message}]`）；冲突唯一键为 `409 SLUG_CONFLICT`。客户端不得通过错误差异探测他租户资源。

## 5. 缓存与异步上下文键

TanStack Query 的基础 key 必须含身份和完整上下文：

```ts
['synapse', actorUserId, tenantId ?? 'global', workspaceId ?? 'personal', resourceType, ...normalizedParams]
```

角色/权限、菜单、成员列表等 key 还包含 `contextVersion` 或 `membershipVersion`。切换空间时先切换当前上下文，再清理/隔离旧上下文缓存并重新取菜单、权限和资源；每个异步请求捕获发起时的上下文和 key，只能写入该上下文对应的缓存。退出、移除成员、权限变化、租户/空间停用时清理相应缓存。任何缓存不得只用 `['users']`、`['sessions']` 等资源名作为跨租户 key。

Redis、任务队列、AgentScope session/state、向量索引、对象存储 key 同样按作用域命名。例如 `tenant:{tenant_id}:workspace:{workspace_id}:...`，个人资源再加入 `user:{owner_user_id}`。对象存储下载/预览签名绑定资源 ID、归属字段、操作者、操作和过期时间；SSE/WS 连接在建立时校验并在成员撤销时中断或重新校验。任务 payload 至少保存 `actor_user_id`、`tenant_id`、`workspace_id`、资源 ID、提交时 `membership_version`；执行时确认 tenant/workspace 状态及当前授权，不因提交时曾有权就永久有效。

## 6. 完成实现时的硬约束

1. SQL 查询、唯一性校验、文件/向量/Redis 访问都从同一经过验证的上下文获取 scope；写入归属字段由服务端赋值。
2. 查询由资源 ID 开始时，先按允许的 scope 定位资源，再鉴权；任何不匹配的外键组合均拒绝。
3. 租户成员暂停/移除须即时使该租户内所有 Workspace 的有效权限失效；重新加入不会自动恢复任何空间成员权限。Workspace 成员移除或权限降级不得删除全局 User，也不改变此用户在其他租户/空间的关系。
4. 个人凭据和会话查询始终附加 `owner_user_id=actor_user_id`，除非目标资源存在有效、显式共享授权。
5. 个人账号 API、租户 API、空间 API 使用各自作用域；最近空间只用于导航恢复。
6. 旧数据迁移必须显式确定 tenant、默认协作 Workspace、操作者和私有/共享归属；禁止根据旧 `user_id` 猜测共享范围。

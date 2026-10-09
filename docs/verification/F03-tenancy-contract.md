# F03：租户与 Workspace 契约复验

结论：**通过**。本次复查确认契约已补齐上一轮提出的租户最后 owner 保护、TenantMember 撤权对 Workspace 的即时影响及重新加入语义，并新增 platform admin 初始化和租户首建流程。原检查的全局账号与业务授权、多租户成员、上下文切换/缓存、私有资源、后台任务及 AgentScope 运行目录边界仍然成立。

## 复验结果

| 检查项 | 结果 | 依据与备注 |
| --- | --- | --- |
| 全局账号不等于全局业务权限 | 通过 | 全局 `role_ids` 不作为租户授权来源；平台管理员不自动读取聊天、凭据、人脸数据，也不自动成为租户或空间成员。 |
| 多租户、多空间及跨空间账号 | 通过 | TenantMember 与 WorkspaceMember 分离；加入租户不自动访问其所有空间。空间成员必须属于其租户且有效。 |
| 空间切换 URL、上下文和缓存 | 通过 | `/w/{workspace_id}/...` 派生租户；header 与 URL 校验一致。缓存含 actor/tenant/workspace，异步结果绑定原上下文，成员/权限变化及停用后失效。 |
| 私有资源与显式共享 | 通过 | 个人会话、凭据和资源以 `owner_user_id` 限定，默认私有；跨用户共享必须有单独授权，不能越过租户边界。 |
| 后台任务和撤权 | 通过 | 队列保留 actor、租户/空间、资源和 membership version；执行时重检当前状态和权限。TenantMember 无效在服务端所有空间授权判断中同步生效，不能依赖异步缓存清理。 |
| 最后 owner | 通过 | 契约明确 TenantMember 始终至少有一位 active tenant owner，禁止暂停、移除或降权最后一位；Workspace 的最后 active owner 也有保护。租户停用/归档不会移除 owner 关系。 |
| 租户成员禁用、撤权与重新加入 | 通过 | TenantMember 非 active 时，其该租户全部 WorkspaceMember 权限立即无效；重新加入不会自动恢复空间权限，必须逐空间重新授予/显式恢复。权限版本、会话和缓存失效也有约定。 |
| AgentScope 运行目录边界 | 通过 | 明确 runtime workspace 是运行目录/文件/记忆容器，不是协作 Workspace；通过 tenant/workspace 绑定映射，且一个协作空间可关联多个 runtime workspace。 |
| 首个 platform admin 初始化 | 通过 | 要求运维在受控环境显式运行 CLI，交互绑定账号身份；不生成默认密码，不开放匿名初始化端点。 |
| 租户首次创建与初始空间 | 通过 | 仅 platform_admin 创建；指定已存在且可登录的 `first_owner_user_id`，事务中创建租户、首位 owner、默认 Workspace 及首位 Workspace owner；平台管理员不会被顺带加入租户。 |

## 实现时的共享开发顺序

这些契约要求多个模块共享同一身份和授权事实，建议按下列依赖顺序落地，避免各模块先做出不兼容的局部实现：

1. 先确定 User/认证来源、tenant/workspace/member 数据模型、迁移及组合约束；同时定义唯一可信请求上下文和统一成员/权限依赖。
2. 建立首次 platform admin 的受控 CLI 初始化，并确认其身份可被平台角色授权层识别；初始化命令应可安全重复检测，数据库迁移完成后才允许执行。
3. 先实现成员状态、角色变更、两个作用域的最后 owner 事务规则，以及 membership/context version 的生成和失效机制。所有业务 API、缓存、SSE/WS 和队列之后都复用这些接口。
4. 再实现 platform_admin 租户创建事务：租户、指定首位 tenant owner、默认 Workspace、首位 Workspace owner 一次提交或全部回滚。随后实现邀请、成员管理和空间管理端点。
5. 在业务模块与 AgentScope 接入前，接通撤权后的查询拒绝、缓存隔离、签名链接校验、实时连接失效和队列执行重检；再迁移业务资源与前端切换器。

需在实现规格中确定默认 Workspace 的初始 `slug`/`name` 生成规则，以及 TenantMember 暂停/移除某人的 owner 角色时，如何处理该人拥有的空间（例如先要求转移空间 owner，或明确采用其他事务化规则）。当前契约已要求授权即时失效与 Workspace 最后 owner 保护，但未完全写明这两个交叉变更的操作结果；该细节应在成员管理 API 落地前定下来。

本次仅复验 `tenancy-contract.md` 与 integration plan 的租户/Workspace 要求，不检查实现代码或其他模块。

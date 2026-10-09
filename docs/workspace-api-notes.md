# Workspace API 实现说明

Workspace 管理挂载在 `/api/v1` 下，并使用现有的 `Workspace` 和 `WorkspaceMember` 表。JSON 中的 ID 均为十进制字符串。所有带 `workspace_id` 的管理路由都要求 `X-Workspace-ID` 与路径中的 ID 一致；缺少上下文或上下文冲突时，分别返回 `WORKSPACE_CONTEXT_REQUIRED` 和 `CONTEXT_MISMATCH`。

- `GET /workspaces` 列出租户成员关系和 Workspace 成员关系均有效的 active Workspace。可选的 `tenant_id` 仅用于筛选，不授予访问权。结果采用分页。设置 `include_archived=true` 时，仅当调用者同时具有 active 租户成员关系、active Workspace 成员关系，且 Workspace 角色为 `owner` 或 `admin`，才会包含已归档 Workspace。其他用户（包括没有成员关系的平台管理员）无法发现已归档 Workspace。筛选和授权均在分页及总数统计前完成。
- `POST /tenants/{tenant_id}/workspaces` 要求租户状态为 active，且调用者是 active 租户 owner/admin。创建者成为初始 Workspace owner，不会自动添加其他租户成员。
- `GET/PATCH /workspaces/{workspace_id}` 以及成员列表、新增/更新和移除路由会从 Workspace 推导租户归属，要求租户和 Workspace 成员关系均 active，并依据 Workspace 角色授权变更。平台管理员没有隐式业务访问权。租户角色本身不授予 Workspace 权限。
- Workspace 成员必须是同一租户的 active 成员。再次授予已有但已移除的 Workspace 成员关系时，会显式将其激活；仅凭租户成员关系不会重新创建 Workspace 成员关系。Workspace admin 不能操作、降级、移除或提升 Workspace owner。Owner 可管理其他 owner，但受最后一位 owner 保护规则约束。转移所有权要求目标用户在同一租户及 Workspace 中均为 active 成员，随后以原子操作将调用者设为 admin、目标设为 owner。
- 归档 Workspace 会保留成员记录。Owner/admin 仍可访问其元数据和成员，并可通过 `PATCH {"status":"active"}` 恢复。归档 Workspace 不出现在列表中，也不能作为业务上下文使用。
- `app.tenancy.context.get_workspace_context` 为业务端点提供不可变的可信上下文。它会验证账号、租户、Workspace、租户成员关系、Workspace 成员关系、状态以及路径/header 是否一致，并在服务端推导租户 ID 和权限集。平台管理员身份不会绕过任何检查。

本次实现未运行测试，也未启动服务。

# F05a 租户邀请验收

**结果：通过（2026-10-01）。** 两个聚焦生命周期测试均在一次性 SQLite 数据库上通过。此前观察到的原子认领邀请时 naive/aware datetime 错误不再复现。成功接受邀请只会创建或激活 `TenantMember`，不会创建 `WorkspaceMember`。

## 环境与命令

验收脚本 [test_f05a_tenant_invites.py](../../apps/api/tests/verification/test_f05a_tenant_invites.py) 会创建临时 SQLite 数据库，将各库迁移到 Alembic `0003_tenant_invitations`，创建测试账户、签发带签名的应用 Bearer token，并通过 `TestClient` 调用 FastAPI。

```sh
cd Synapse/apps/api
.venv/bin/python -m pytest -q tests/verification/test_f05a_tenant_invites.py --tb=short
```

实际结果：**2 passed**，耗时 0.59 秒。警告：Starlette 提示其 `httpx` TestClient 集成已弃用；Alembic 提示未配置 `path_separator`，将回退到旧版解析。两条警告均未导致验收失败。

## 已验证行为

- Owner 可以向指定用户发出邀请。API 返回一次性 token 和链接；存储中仅有 token 的 SHA-256 哈希。列表会隐藏 token 和哈希。
- Owner/admin 角色约束有效：成员不能管理邀请；管理员可以创建 member 邀请，但不能授予 admin；邀请角色为 owner，以及请求同时提供 email 和 user ID，均无法通过校验。
- 受邀账户绑定的 active 用户接受有效邀请后成功加入并获得受邀角色。重放已接受的 token 返回 409。数据库中存在 active `TenantMember`，该用户在此租户下的 workspace-member 记录数仍为零。
- 绑定到其他账户的 token 会被拒绝。针对已存在账户的邀请，email 匹配不区分大小写。此前被移除的租户成员可以重新加入，但旧的、已移除的 `WorkspaceMember` 仍保持 removed 状态。
- 撤销邀请会阻止接受和重放。过期邀请会在列表中标记为 expired，接受时返回 410，并转换为 `expired` 状态。
- 租户暂停期间禁止创建和接受邀请；恢复租户后可继续操作。移除管理员的租户成员身份会撤销其邀请管理权限。跨租户邀请操作会被拒绝。

## 限制

本次运行通过 TestClient 在 SQLite 上验证邀请生命周期，不能据此确认生产 PostgreSQL 行为、多 worker 并发认领行为或邮件投递。本次验收未修改产品代码。

## 2026-10-11 service 化回归

邀请生命周期迁移为 `TenantInvitationService` 后重新执行同文件，两个用例通过。过期邀请保留原有 410 `INVITATION_EXPIRED` 行为，并新增共享 `GoneError` / 410 全局映射。service 内不再显式 commit/rollback；成功请求由 `get_db()` 统一提交，冲突由异常触发统一回滚。

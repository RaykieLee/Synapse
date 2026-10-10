# F05d 邀请注册与接受验证

状态：通过（独立验证）。

## 执行环境与证据

- 测试文件：`apps/api/tests/verification/test_f05d_tenant_invite_registration.py`
- 命令：`cd apps/api && .venv/bin/python -m pytest tests/verification/test_f05d_tenant_invite_registration.py -q`
- 结果：`1 passed`。测试为一次隔离执行，将临时 SQLite 数据库迁移到 Alembic `head`，通过真实 FastAPI `TestClient` 调用 API，并直接检查数据库状态。
- 非阻塞警告：当前环境的 Starlette 提示 `httpx` 测试客户端弃用警告；Alembic 配置提示缺少 `path_separator`。本次用例仍通过。

## 覆盖结果

- 有效邮件邀请可以匿名注册并接受：邮箱从邀请派生且规范化；响应提供 active `user`、登录 token 和 tenant membership，user ID 为十进制字符串，不泄露哈希或内部状态字段。
- 新账号可用注册时显式提供的密码成功登录。注册只创建 active `TenantMember`，角色来自邀请；响应声明创建 0 个 Workspace 成员，数据库确认没有 `WorkspaceMember`。
- 同一邀请重放返回 409 `INVITATION_NOT_PENDING`。
- 邀请创建时已有 active 账号，以及邀请创建后才出现的邮箱冲突，均拒绝匿名重复注册；disabled 与软删除账号分别返回 403 `ACCOUNT_INACTIVE`。
- 少于 12 位密码、额外提交 `email`、`tenant_id` 或 `tenant_role` 均返回 422，未创建用户。
- 用户名冲突返回 409 `ACCOUNT_CONFLICT`；数据库确认邀请仍为 pending，且没有部分用户或成员记录，验证了事务回滚。
- 撤销邀请后注册返回 409；过期邀请返回 410 `INVITATION_EXPIRED` 并持久化为 expired；租户 suspended 时返回 409 `TENANT_INACTIVE`，邀请仍 pending，且没有创建用户。
- 两个并发请求竞争同一邀请，结果为一个 201 和一个 409；数据库只有一个对应用户、一个 active tenant membership，邀请最终为 accepted。

## 范围与限制

本验证只针对临时 SQLite 数据库和当前 Alembic `head`，并发检查覆盖同一 SQLite 文件中的双请求竞争；没有验证生产数据库方言、跨进程多主机负载或真实邮件投递。没有发现需要转交产品开发者的缺陷。

## 2026-10-11 service 化回归

注册与原子认领逻辑迁入 `TenantInvitationService` 后重新执行，1 个用例通过。保留 SQL conditional update 作为一次性邀请闸门；用户名/邮箱唯一键冲突仍回滚为 pending，并保持 409 `ACCOUNT_CONFLICT` 契约。

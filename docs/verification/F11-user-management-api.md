# F11 全局用户管理 API 验收

**结果：通过（2026-10-01）。** 聚焦 API 验收在已迁移至 Alembic `head` 的隔离 SQLite 数据库上通过。测试使用真实 FastAPI 应用、带签名的 Synapse tokens 和 TestClient 请求。本次未修改产品代码。

## 环境与命令

可重复运行的测试为 [test_f11_users.py](../../apps/api/tests/verification/test_f11_users.py)。测试创建临时 SQLite 数据库，填充平台/普通/租户管理员 actor 和两个租户，并验证全局用户 endpoints 及常规登录流程。

```sh
cd Synapse/apps/api
.venv/bin/python -m pytest -q tests/verification/test_f11_users.py --tb=short
```

实际结果：**1 passed**，耗时 0.70 秒。警告：Starlette 提示其 `httpx` TestClient 集成已弃用；Alembic 提示未设置 `path_separator`，将回退到旧版解析。两条警告均未影响结果。

## 已验证行为

- 平台管理员列表支持分页，并搜索用户名/昵称/邮箱/电话。详情和列表使用十进制字符串 ID，不暴露 `password_hash`、`token_version` 或 `del_flag`。
- 显式指定密码创建账户后，得到普通 active `platform_role=user` 账户。密码长度、仅含空白的用户名、无效邮箱/性别、多余创建字段、规范化后重复的邮箱以及重复用户名均按文档要求拒绝。
- 普通用户和 tenant admin 调用列表、详情、创建、patch、删除和重置密码 endpoints 均收到 403；未认证的列表请求返回 401。
- 支持的个人资料更新成功。空 patch 以及尝试修改用户名或平台角色均校验失败。不支持的状态 `suspended` 会被拒绝；将状态改为 `disabled` 会使旧 JWT 失效，禁用账户无法登录。
- 密码重置会拒绝过短的值，接受显式提供的有效新密码并撤销旧 JWT；旧密码登录失败，新密码登录成功。
- 软删除返回 204、撤销用户 token、在列表/详情中隐藏记录，并且在两个预置租户中保持 active TenantMember 和 WorkspaceMember 行不变。
- 已有 bcrypt 哈希的账户可以登录。登录流程会将其存储哈希升级为 Synapse scrypt，登录响应不含任何秘密哈希字段。

## 限制

本次只验证 SQLite/TestClient 路径，不能据此确认生产 PostgreSQL 行为或管理员并发写入行为。bcrypt 场景验证了配置使用的旧版 `$2b$` 哈希格式；API 文档另行列明支持 `$2a$` 和 `$2y$` 前缀。

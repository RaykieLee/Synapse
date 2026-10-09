# F04 身份认证后端验收

在 `Synapse/apps/api` 中使用项目环境运行：

```sh
.venv/bin/python ../../docs/verification/verify_f04_auth.py
```

脚本使用新建的临时 SQLite 数据库，将 Alembic 迁移到 `0001_global_users`，测试 CLI 初始化及迁移失败场景，并通过 FastAPI TestClient 调用 API。CLI 会执行配置的 `head` 迁移（目前包含 `0002_tenants`）；本验收不检查租户行为。进程退出时会删除临时数据库。未使用真实凭据。

## 结果

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| F04 Alembic migration | 通过 | Revision 为 `0001_global_users`；`users` 包含 `user_id`、`password_hash`、`token_version`、`platform_role` 和 `del_flag`。 |
| CLI 操作部分迁移的数据库 | 通过 | 应用 `0001_global_users` 后，CLI 将迁移推进到 `head` 并创建合成管理员；随后再次执行 `alembic upgrade head` 成功（幂等）。拒绝重复创建第二个管理员。 |
| CLI 操作已完成迁移的数据库 | 通过 | 执行 `alembic upgrade head` 后运行 CLI，成功创建合成管理员。 |
| 迁移失败时不创建管理员 | 通过 | 预先存在的合成 `users` 表会导致迁移失败；CLI 以迁移错误退出，且请求创建的管理员记录不存在。 |
| 凭据无效 | 通过 | 缺少用户名和密码错误均返回 401 `INVALID_CREDENTIALS`；响应 content type 为 `application/problem+json`。 |
| 账户已禁用 | 通过 | 对合成禁用用户使用正确密码，返回 403 `ACCOUNT_INACTIVE`。 |
| 登录与 `/auth/me` | 通过 | 登录返回 bearer token 和 cookie；`/me` 返回十进制字符串 ID，不包含密码哈希、token version 或删除标志。 |
| 个人资料 | 通过 | 昵称/邮箱更新成功；未声明的 `status` 属性被 422 拒绝。 |
| 修改密码 | 通过 | 当前密码正确时可修改密码，旧 token 随后返回 401，新密码可以登录；当前密码错误时返回 400。 |
| 登出 | 通过 | 登出返回 204，同一 token 随后收到 401。 |
| 旧版 bcrypt 升级 | 通过 | 使用生成的 bcrypt `$2b$` fixture 登录成功，存储的哈希改为 `scrypt$`。 |
| 生产环境缺失 secret | 通过 | 生产环境未配置 secret 时，`signing_key()` 抛出提及 `SYNAPSE_JWT_SECRET` 的 `RuntimeError`。 |
| CLI 一次性密码处理 | 通过（源码检查） | CLI 现在会从自身进程环境中移除 `SYNAPSE_INITIAL_ADMIN_PASSWORD`，并提醒用户在调用 CLI 的 shell 中取消设置。子进程无法直接修改父 shell 的环境。 |

运行环境备注：提供的 `.venv` 最初缺少声明的 `bcrypt` 和 `email-validator` 依赖，因此脚本无法启动。使用 `.venv/bin/pip install -e .` 按 `pyproject.toml` 安装项目后解决了环境问题。运行时出现 Starlette 关于通过 TestClient 使用 `httpx` 的弃用警告；所有检查均成功完成。

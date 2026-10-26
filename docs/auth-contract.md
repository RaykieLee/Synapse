# Synapse 全局账号与认证契约

状态：F04 后端实现契约。全局身份仅由 `User` 表表示；租户成员、空间成员不会创建或复制 User。ID 在 JSON 中一律为十进制字符串。

## User

`users` 表字段包括 `user_id`, `user_name`, `nick_name`, `email`, `phonenumber`, `sex`, `avatar`, `status`, `del_flag`, `password_hash`, `platform_role`, `token_version`, `created_at`, `updated_at`。账号启用状态为 `status="active"` 且 `del_flag=false`。平台角色仅为全局平台权限标识；`platform_admin` 不自动成为任何租户/空间成员，也不获得其业务数据访问权。

密码采用带随机盐的 scrypt。首登时接受旧 Synapt bcrypt `$2a$`、`$2b$`、`$2y$` 密文并在密码验证成功后升级为 scrypt。登录令牌是 HS256 JWT，包含字符串 `sub`、`ver`、`iat`、`exp`、`jti`。每次认证都会检查用户 active 状态和 token version。登出及改密递增 `token_version`，立即撤销用户此前全部令牌；改密后需重新登录。

密钥使用环境变量 `SYNAPSE_JWT_SECRET`。生产环境 `SYNAPSE_ENV=production`（或 `prod`）缺少密钥、密钥不足 32 字节或仍使用示例占位符时，应用启动失败，不生成隐式生产密钥；`SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY` 同样必须存在、不能是占位符，并且必须是可解析的 Fernet key。开发环境未设置 JWT 密钥时，进程启动期间生成随机临时密钥，重启会使旧令牌失效。可用 `SYNAPSE_JWT_TTL_MINUTES` 设置有效期，默认 60 分钟。浏览器登录只通过 `Secure`、`HttpOnly`、`SameSite=Lax` 的 `synapse_session` Cookie 保持会话；API 客户端仍可用 `Authorization: Bearer <token>`，但令牌不返回给浏览器脚本。`SYNAPSE_AUTH_COOKIE_SECURE` 显式设置时优先于请求协议：HTTPS 部署设为 `true`，仅受信任的本地 HTTP 开发环境设 `false`；未设置时按请求 URL 或 `X-Forwarded-Proto` 是否为 HTTPS 自动判断。

## 接口

API 前缀 `/api/v1`。

| 方法与路径 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/v1/auth/login` | JSON `{ "user_name": "...", "password": "..." }` | `{ "user": { ... } }`，设置 HttpOnly Cookie，不返回访问令牌 |
| `POST /api/v1/auth/logout` | 认证令牌 | `204`；撤销此用户全部现存令牌并清除 Cookie |
| `GET /api/v1/auth/me` | 认证令牌 | 当前用户摘要 |
| `PATCH /api/v1/account/profile` | `{ "nick_name?", "email?", "phonenumber?", "sex?", "avatar?" }` | 更新后的用户摘要；额外字段拒绝 |
| `POST /api/v1/account/password` | `{ "current_password": "...", "new_password": "..." }`，新密码至少 12 字符 | `204`；所有令牌撤销，需重新登录 |

用户摘要字段为 `user_id`（十进制字符串）、`user_name`、`nick_name`、`email`、`phonenumber`、`sex`、`avatar`、`status`、`platform_role`，不返回密码哈希、token version 或 `del_flag`。登录只接受 JSON，不使用表单编码。

`app.auth.dependencies.get_current_user` 是后续模块可复用的 FastAPI 依赖；`require_platform_admin` 检查当前账号 `platform_role == "platform_admin"`。认证失败返回 401 `AUTHENTICATION_REQUIRED`；无效凭据为 401 `INVALID_CREDENTIALS`；停用账号为 403 `ACCOUNT_INACTIVE`；非平台管理员使用平台管理员依赖时为 403 `FORBIDDEN`。

## 错误格式

所有 HTTP 异常和请求校验错误返回 `application/problem+json`：

```json
{
  "type": "https://synapse.invalid/problems/authentication_required",
  "title": "Unauthorized",
  "status": 401,
  "code": "AUTHENTICATION_REQUIRED",
  "detail": "Unauthorized",
  "request_id": "req_..."
}
```

输入错误为 422 `VALIDATION_ERROR`，并可带 `errors: [{field,code,message}]`。认证错误不泄露账号是否存在。部署时可将 `type` URI 域名替换为正式的问题文档域名，保持 code 稳定。

## 首个管理员

在 API 包目录运行 `python -m app.cli.create_platform_admin`。命令要求显式输入用户名；密码优先从一次性环境变量 `SYNAPSE_INITIAL_ADMIN_PASSWORD` 读取（读取后会从 CLI 进程环境移除），否则通过无回显交互输入并确认，且至少 12 字符。不存在默认用户名或默认密码。使用环境变量时，CLI 成功后会提醒从调用者 shell/部署环境中 unset 该变量；子进程无法清理调用者环境。CLI 会先执行 Alembic `upgrade head`，迁移失败会停止创建并显示修复提示，不使用 `create_all`。命令拒绝重复创建首个管理员。

数据库结构由 `alembic upgrade head` 建立；迁移 `0001_global_users` 只创建全局用户表，不含租户或空间业务。

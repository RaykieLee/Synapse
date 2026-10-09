# 全局用户管理 API

状态：F11 接口实现说明。所有接口操作的是平台级全局 `User` 账号；租户成员和 Workspace 成员管理仍由各自 API 负责。本模块不授予租户管理员编辑全局账号的能力。

所有路由均要求 Synapse Bearer token 或 session cookie，并通过 `require_platform_admin`。无效/缺少身份返回统一 `application/problem+json` 401；非 `platform_admin` 返回 403 `FORBIDDEN`。ID 在 JSON 响应中为十进制字符串。用户对象仅返回安全字段，不包含 `password_hash`、`token_version` 或 `del_flag`。

## 用户对象

```json
{
  "user_id": "123",
  "user_name": "alex",
  "nick_name": "Alex",
  "email": "alex@example.com",
  "phonenumber": null,
  "sex": null,
  "avatar": null,
  "status": "active",
  "platform_role": "user",
  "created_at": "2026-10-01T00:00:00+00:00",
  "updated_at": "2026-10-01T00:00:00+00:00"
}
```

## 端点

### `GET /api/v1/users`

分页列出未软删除的全局用户。支持 `page`（默认 1）、`page_size`（默认 20，最大 100）和可选 `search`（匹配用户名、昵称、邮箱或电话号码）。响应为 `{ "items": [User], "total": 42, "page": 1, "page_size": 20 }`，按用户 ID 升序。

### `GET /api/v1/users/{user_id}`

读取单个未软删除用户。不存在或已软删除时返回 404 `RESOURCE_NOT_FOUND`。

### `POST /api/v1/users`

创建普通全局账号，成功返回 201 和 `User`。请求只接受以下字段，拒绝额外字段：

```json
{
  "user_name": "alex",
  "password": "explicit-password-at-least-12-chars",
  "nick_name": "Alex",
  "email": "alex@example.com",
  "phonenumber": null,
  "sex": null,
  "avatar": null
}
```

`password` 必须由管理员显式提供且至少 12 字符；没有默认密码或隐式初始化密码。新密码以 Synapse scrypt 格式散列，用户创建时 `status=active`、`platform_role=user`、`token_version=0`。用户名或邮箱冲突返回 409 `USER_CONFLICT`。

### `PATCH /api/v1/users/{user_id}`

更新资料或启停账号。支持 `nick_name`、`email`、`phonenumber`、`sex`、`avatar`、`status`，其中 `status` 为 `active` 或 `disabled`。至少提供一个字段；拒绝额外字段以及 `user_name`、`password`、`platform_role` 等不可经此接口修改的字段。状态发生变化时递增 `token_version`，即时撤销已有令牌。响应为更新后的 `User`。

### `DELETE /api/v1/users/{user_id}`

软删除账号：设置 `del_flag=true`、`status=disabled` 并递增 `token_version`，不物理删除账号或租户/空间成员关系。成功返回 204；重复删除或目标不存在返回 404。

### `POST /api/v1/users/{user_id}/reset-password`

管理员显式提供新密码：`{ "new_password": "at-least-12-characters" }`。密码至少 12 字符并以 scrypt 散列存储；操作递增 `token_version`，撤销该用户所有旧 token。成功返回 204，重置后用户需重新登录。

## 错误

所有 HTTP 异常及 Pydantic 请求错误由应用统一返回 `application/problem+json`。常见错误码：401 `AUTHENTICATION_REQUIRED`、403 `FORBIDDEN`、404 `RESOURCE_NOT_FOUND`、409 `USER_CONFLICT`、422 `VALIDATION_ERROR`。冲突响应不区分用户名冲突或邮箱冲突，避免额外泄露账号信息。

旧 Synapt bcrypt `$2a$`、`$2b$`、`$2y$` 用户登录兼容由现有认证登录路径负责：密码验证成功后会升级为 scrypt；本用户管理 router 不实现或替代认证流程。

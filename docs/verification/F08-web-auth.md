# F08 Web 身份认证验收

日期：2026-10-01

## 结果

隔离的真实后端浏览器流程以及更新后的默认开发 API 接线均**通过**。生产部署仍需配置自己的 API origin/CORS 或同源路由；本次验收覆盖文档所述的本地 Vite proxy。

## 环境与命令

- 前端构建：`cd apps/web && pnpm build` — 通过（`tsc -b` 和 Vite production build）。
- API：真实 FastAPI 应用 `app.main:create_app` 运行于 `127.0.0.1:8010`，使用 `/tmp` 下新建的 SQLite 数据库，通过 Alembic `upgrade head` 创建，并配置一次性 `f08_user` 账户。
- 前端：Vite 运行于 `127.0.0.1:5418`，未覆盖 API URL，也未使用 mock handlers。使用默认 `VITE_API_BASE_URL=/api/v1`；Vite 默认 proxy target 为 `http://127.0.0.1:8010`。
- Proxy 路径检查：`GET http://127.0.0.1:5418/api/v1/auth/me` 返回 `401 application/problem+json` 和 `AUTHENTICATION_REQUIRED`，确认 `/api/v1` 前缀只转发一次。
- 浏览器：已安装的 Playwright Chromium，无头运行。所有身份认证调用均经 Vite proxy 到达真实 API。

## 浏览器检查

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 密码错误 | 通过 | 登录返回 `401`；浏览器仍停留在登录页。 |
| 有效用户登录 | 通过 | 真实账户登录成功，认证后的布局加载完成。 |
| 刷新与会话恢复 | 通过 | 浏览器重新加载时请求 `GET /api/v1/auth/me`，返回 `200`。 |
| 受保护路由与个人资料 | 通过 | 认证后 `/settings/` 成功加载；profile `PATCH` 成功并显示 “Profile updated.”。 |
| 修改密码 | 通过 | 账户密码修改成功，浏览器返回登录页。 |
| 拒绝旧密码 | 通过 | 随后的旧密码登录请求返回 `401`。 |
| 接受新密码 | 通过 | 使用新密码登录后进入认证布局。 |
| 登出 | 通过 | UI 登出成功并返回登录页。 |
| 401 清理本地身份认证 | 通过 | 登录后，测试提高该一次性用户的服务端 token version；访问受保护路由时，旧 token 的 `/me` 请求返回 `401`，移除 `synapse_access_token` 并重定向至登录页。 |
| 未认证访问受保护路由 | 通过 | 直接访问 `/settings/account` 会重定向至登录页。 |
| 注册不可用提示 | 通过 | `/sign-up` 显示 “Registration unavailable”。 |
| 密码恢复不可用提示 | 通过 | `/forgot-password` 显示 “Password recovery unavailable”。 |

## 范围说明

账户和 SQLite 数据库均为一次性资源，与正常应用数据库隔离。未使用 API mock 或临时 CORS middleware。本次验证本地开发接线和身份认证行为，不涉及生产 reverse proxy/CORS 配置或外部身份提供方。

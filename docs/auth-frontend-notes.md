# Auth 前端实现说明

前端认证已对接 `docs/auth-contract.md`：登录以 JSON `{ user_name, password }` 调用 `POST /api/v1/auth/login`；访问受保护路由前通过 Bearer token 请求 `GET /api/v1/auth/me` 恢复用户；个人资料使用 `PATCH /api/v1/account/profile`；登出使用 `POST /api/v1/auth/logout`；改密使用 `POST /api/v1/account/password`，成功后清空本地凭据并要求重新登录。

`VITE_API_BASE_URL` 是完整 API 前缀，默认 `/api/v1`；client 在其后追加接口路径（例如 `/auth/login`）。同源开发请求由 Vite 转发至 `VITE_API_PROXY_TARGET`，默认 `http://127.0.0.1:8010`，避免与常见的前端/API 共用 8000 端口冲突。部署时可将 `VITE_API_BASE_URL` 配置为完整远程前缀（例如 `https://api.example.com/api/v1`）。请求同时带 `credentials: include`，以兼容服务端 HttpOnly session cookie；前端还将 access token 存在短期、非 HttpOnly 的 `synapse_access_token` cookie 中，以便页面刷新后携带 Bearer token恢复会话。任何 401 都会清除本地 token 和用户状态。

API 错误按 Problem JSON 的 `code`、`detail` 展示；网络错误会给出可读提示。注册与找回密码后端尚未提供，因此入口显示未启用说明；第三方登录控件已从真实登录流程移除。账号资料页只请求全局 `/me` 用户资料，不依赖 Workspace、租户或空间上下文；个人资料入口为侧边栏 Settings → Profile，密码修改入口为 Settings → Account。

需要注意：API 当前登录接口设置 `synapse_session` Cookie 为 `Secure`，本地 HTTP 开发环境可能不会保存该 cookie；前端 Bearer token 流程仍可用。跨域部署需要 API CORS 允许前端 origin、Authorization/Content-Type 请求头及 credentials，并正确配置 Cookie SameSite/Secure 策略。

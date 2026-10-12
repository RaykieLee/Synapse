# F16a 租户参数配置 Service 化方案

## 目标

在不改变租户参数配置 HTTP 契约和前端行为的前提下，将业务规则从路由模块提取到 application service，并将前端参数配置请求集中到类型化 API 模块。

## 业务边界

- 参数配置是租户级共享资源，所有读写都必须使用请求依赖解析出的 `TenantContext`。
- `owner` 和 `admin` 管理配置；普通 `member` 只能访问 `/public` 投影。
- `/public` 只返回启用、前端可见且非敏感的配置。
- 敏感值在列表、创建响应和修改响应中脱敏；只有明确的详情读取才返回明文。
- 敏感配置不得同时设置为前端公开。
- `config_key` 只在同一租户内唯一；跨租户相同键名合法。
- 请求事务继续由 `get_db()` 管理；service 只执行 `flush()`，不提交或回滚。

## 模块与职责

### 后端

- `apps/api/app/schemas/tenant_configs.py`
  - 保存创建、修改、分页、详情和 public 投影的 HTTP 契约。
  - 继续执行字段长度、格式和额外字段禁止校验。
- `apps/api/app/services/tenant_configs.py`
  - 负责 owner/admin 授权、租户作用域查询、唯一键检查、敏感值规则、脱敏结果、行锁和 `flush()`。
  - 返回不可变结果对象和 `PageResult`，不抛出 `HTTPException`，不拼 HTTP 响应字典。
- `apps/api/app/api/tenant_configs.py`
  - 只负责依赖注入、查询参数、响应头、状态码和 schema 投影。

目标 seam：

```text
HTTP router -> TenantConfigService -> SQLAlchemy ORM
```

本轮不引入 repository；SQLAlchemy `Session` 直接作为 service 的实现依赖。

### 前端

- `apps/web/src/api/tenant-configs.ts`
  - 集中配置实体、分页参数、创建/修改 payload 和 CRUD/public API 函数。
- `apps/web/src/features/tenants/configs-page.tsx`
  - 保留 React Query、筛选状态、敏感值展示和页面交互。
  - 不在本轮引入新的 Query hooks 包装层。

## 保持不变的接口

- `GET /tenants/{tenant_id}/configs/public`
- `GET /tenants/{tenant_id}/configs`
- `POST /tenants/{tenant_id}/configs`
- `GET /tenants/{tenant_id}/configs/{config_id}`
- `PATCH /tenants/{tenant_id}/configs/{config_id}`
- `DELETE /tenants/{tenant_id}/configs/{config_id}`

错误码保持：

- `CONFIG_KEY_CONFLICT` -> 409
- `SENSITIVE_CONFIG_CANNOT_BE_FRONTEND` -> 422
- `VALIDATION_ERROR` -> 422
- `FORBIDDEN` -> 403
- `RESOURCE_NOT_FOUND` -> 404

## 验证产出

- F16a API/迁移回归继续覆盖租户隔离、权限、CRUD、public 投影、敏感值脱敏和冲突。
- F16b 使用当前 Docker Redis `127.0.0.1:16381`，真实 FastAPI、Vite 和 Playwright 验证前端主流程。
- `compileall app`、前端 `pnpm build`、ESLint 和 router/service 边界扫描作为结构回归。

## 本轮明确不做

- URL 驱动筛选和分页。
- 并发编辑版本号或 `If-Match`。
- 敏感值二次认证、查看审计记录和复制策略。
- Dialog 焦点管理、移动端操作菜单和完整双语补齐。

这些由 UX 审查列为后续独立功能点，避免与 service 提取混在同一提交。

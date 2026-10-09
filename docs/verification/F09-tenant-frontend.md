# F09 租户前端验收

日期：2026-10-01

## 结果

**通过** — F09 平台管理、按角色呈现的成员管理，以及 F05b 成员列表过滤修复，均已通过真实 API 验收。此前普通成员过滤失败的问题已解决，并在下文单独复验。

## 环境

- `cd apps/web && pnpm build` — **通过**（`tsc -b` 和 Vite production build）。
- 真实 FastAPI `app.main:create_app`，运行于 `127.0.0.1:8010`；使用隔离的临时 SQLite 数据库，并迁移至 Alembic `upgrade head`。
- 真实 Vite 开发服务器运行于 `127.0.0.1:5418`，使用默认 `/api/v1` 前缀和指向 API 的 Vite proxy。未使用 API mock 或 CORS wrapper。
- 浏览器：已安装的 Playwright Chromium，无头运行。
- 回归检查：`cd apps/api && .venv/bin/python -m pytest tests/verification/test_f05_tenant_backend.py -q` — 1 passed（有两条依赖/配置弃用警告）。`cd apps/web && pnpm build` — 通过。
- 一次性用户：`platform`（`platform_admin`）、`owner`、`tenantadmin`、`member` 和 `outsider`。均使用临时测试密码。浏览器测试前，通过真实平台 API 创建了 21 个用于分页的租户。

## 通过项

| 范围 | 结果与证据 |
| --- | --- |
| 平台租户列表与分页 | 通过。21 条由 API 创建的记录中，第 1 页显示 20 条，第 2 页显示 1 条。 |
| 平台名称/状态过滤 | 通过。搜索尚未创建的名称返回空结果；创建租户后，状态为 `suspended` 时结果为空，再由 UI 暂停目标租户后显示该记录。 |
| 创建租户与首位 owner | 通过。平台管理员通过 UI 创建 `f09-ui-tenant` / “F09 User Org”，全局用户 ID 为 `2`。数据库检查确认该用户有 active tenant `owner` membership 和 active 默认 workspace `owner` membership。 |
| 平台成员隔离 | 通过。数据库检查确认 `platform_admin` 没有 `TenantMember` 记录；其常规 `GET /api/v1/tenants` 响应为空。 |
| 重复创建错误 | 通过。重复使用已有 slug 时，页面提示中显示 `Conflict（SLUG_CONFLICT）`。 |
| 平台编辑与生命周期 | 通过。UI 成功重命名、暂停、恢复并归档租户。 |
| Owner/admin/member 可见性 | 通过。Owner 和 tenant admin 可见成员管理控件。Member 可以看到租户和成员列表，但没有添加、暂停或变更角色控件。无关账户看到空租户列表。 |
| 成员状态变更 | 通过。Tenant admin 通过 UI 暂停并重新启用现有成员；行状态先更新为“已停用”，之后更新为“启用”。 |
| 不存在虚假的邀请流程 | 通过。Owner UI 只提供“添加已有成员”，并明确说明尚未实现邀请链接和邮件投递。 |
| 查询缓存范围 | 通过，在 `apps/web/src/features/tenants/index.tsx` 中通过代码检查确认：列表 key 包含 actor ID 和平台/成员范围；详情和成员 key 包含 actor ID、tenant ID 和资源类型；成员 key 还包含 membership version、page 和 size。 |

## F05b 复验 — 此前的过滤失败已解决

普通用户 `GET /api/v1/tenants` route 现在接受 `name` 和 `status`，在计算 `total` 和分页之前，将过滤条件应用于按成员关系限定的 active-tenant 查询，并保留仅允许 active 项的规则。租户列表 query key 包含 actor ID、role scope、page、规范化名称和状态；详情/成员 keys 包含 actor ID 和 tenant ID，成员 key 还包含 membership version 及分页参数。

使用保留的临时 F09 数据库时，21 条预置的 active membership 令新建的 active 目标租户（`F05b Cross Page Target`，tenant 23）最初位于第 2 页。同一 owner 还拥有一个 suspended 租户（tenant 24）和一个 archived 租户（tenant 22）。通过真实 Vite proxy 和浏览器执行检查：

| 检查项 | 结果与证据 |
| --- | --- |
| 跨页名称搜索 | 通过。以 active 状态搜索 “F05b Cross Page Target” 时，目标项出现在第 1 页（共 1 页），角色为 owner，尽管它在未过滤列表的第 2 页。 |
| Suspended 租户可见性 | 通过。以 suspended 状态搜索已知的 suspended 租户，不会返回租户。 |
| Archived 租户可见性 | 通过。以 archived 状态搜索已知的 archived 租户，不会返回租户。 |
| 查询 key/结果变化 | 通过。变更名称/状态会得到对应过滤结果；改为不匹配的名称后显示空状态。源码检查确认这些过滤值属于列表 query key。 |
| 默认仅 active 范围 | 通过。直接认证请求 `/api/v1/tenants?page=1&page_size=100` 返回 22 条 active membership，不包含 suspended 或 archived 租户。 |

这解决了原始 F09 发现的问题，也确认过滤在分页之前执行；当匹配租户位于后续页时，成员搜索不再错误地显示空结果。

## Query key 检查

在 `apps/web/src/features/tenants/index.tsx` 中，列表 key（第 27 行）包含 `actor.user_id`、`global`、`personal`、`tenants`、平台/成员角色范围、page、规范化名称和状态。详情 key（第 50 行）包含 actor ID 和 tenant ID。成员 key（第 54 行）还包含 membership version 及 page size/page。浏览器中的结果变化符合名称/状态 key 维度。

## 限制

浏览器运行覆盖了临时数据库上的租户管理和成员管理流程，随后使用同一数据库针对性复验 F05b。Workspace UI 和生产路由不在范围内。

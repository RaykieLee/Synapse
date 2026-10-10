# Synapse 工程上下文

本文记录当前主干的代码组织约定，供后续按业务域迁移时保持一致。功能范围和阶段目标见 [集成计划](docs/integration-plan.md)。

## 后端分层

```text
HTTP router
  -> application service
    -> SQLAlchemy ORM / Session
```

- `app/api/*`：HTTP 边界。只负责依赖注入、路径/查询参数、调用 service、声明 response model 和状态码；不直接查询数据库，不手写响应 dict，不管理事务。
- `app/services/*`：业务用例。接收 Pydantic 请求模型和轻量 `ActorContext`，执行权限相关的业务规则、跨表不变量和 `flush()`；不抛 `HTTPException`，不拼 HTTP 响应。
- `app/schemas/*`：HTTP 请求与响应契约，OpenAPI 以这里为准。
- `app/models/*`：SQLAlchemy ORM 模型，不包含 HTTP 语义。
- 不引入 repository 层。SQLAlchemy Session 已提供工作单元和查询能力，额外包装只增加样板。

已迁移完成的域：租户与租户成员（`app/services/tenants.py`）、Workspace 与空间成员（`app/services/workspaces.py`）。其他既有 router 仍保持旧写法，后续按业务域逐个迁移，不做一次性大爆炸重写。

## 事务与错误

- `app/database/session.py:get_db()` 提供请求级托管事务：请求成功统一 commit，任何异常统一 rollback，最后 close。
- service 只 `flush()` 获取数据库生成值并暴露约束冲突；事务提交归 `get_db()`。
- service 抛 `ServiceError` 子类表达领域失败。全局 handler 在 `app/auth/errors.py` 统一映射为 `application/problem+json`：400 / 404 / 403 / 422 / 409，未知 `ServiceError` 为 500。
- 领域专属错误如 `TenantSlugConflict`、`TenantValidityError`、`WorkspaceSlugConflict`、`LastWorkspaceOwnerRequired` 放在对应 service 文件，继承共享错误类型。

## 前端 API 方向

前端按域集中到 `apps/web/src/api/*.ts`，导出带入参/出参类型的 API 函数；`useQuery` / `useMutation` 仍留在组件中。当前已完成 `tenants.ts` 与 `workspaces.ts`，其余领域继续按此方向迁移。契约稳定后再评估从 OpenAPI 生成 typed client，不在本次重构中同时引入。

## 迁移规则

1. 一次只迁移一个业务域，先补测试再移动逻辑。
2. 严格保持现有 API 字段名、状态码、错误 code 和 ID 字符串化，不借重构改变 wire contract。
3. service 使用真实临时数据库做集成测试，不 mock SQLAlchemy Session。
4. 每个域迁移完成后单独提交，功能提交与结构重构不混合。

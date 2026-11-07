# 当前架构地图与演进决策门（2026-11-06）

## 范围与证据口径

本次只读盘点覆盖当前工作树的 FastAPI 入口、后端源码包、前端路由与 feature 组织、关键导入关系，以及 `docs/integration-plan.md`、`docs/tenancy-contract.md`、优化差距审查第 2、3、7 节和 ADR 0003。下文把当前代码结构标为“事实”，把有界上下文归属标为“候选假设”；候选名称不等于已批准的数据所有权或最终物理目录。盘点没有运行测试、构建或 lint。

## 当前物理结构（事实）

- `apps/api/app/main.py:7-28,36-105` 是单一 FastAPI 组合入口，集中挂载平台路由、在 `/api/v1/ai` 内嵌 AgentScope 子应用，并在同一进程 lifespan 中启动 scheduler。
- 后端主体仍按技术职责分包：`api/`、`services/`、`models/`、`schemas/`、`auth/`、`tenancy/`、`integrations/`、`database/`、`tasks/`、`cli/`。迁移版本位于 `apps/api/app/database/migrations/versions/`，模型由 `apps/api/app/database/base.py:8-24` 汇总注册，请求会话由 `apps/api/app/database/session.py:63-78` 管理。
- `apps/api/app/models/tenant.py` 同时定义 Tenant、TenantMember、TenantInvitation、Workspace、WorkspaceMember；这是当前共置事实，不代表这些对象必须放进同一业务上下文。
- `apps/web/src/main.tsx:20-73,88-96` 建立全局 TanStack Query/Router。认证路由位于 `apps/web/src/routes/_authenticated/`，Workspace 路由位于 `apps/web/src/routes/_authenticated/w/$workspaceId/route.tsx:4-6`；页面功能、API 客户端分别主要位于 `apps/web/src/features/` 与 `apps/web/src/api/`。
- 作用域 helper 位于 `apps/api/app/tenancy/scopes.py`，目前仅部分服务使用。前端已有包含 actor、tenant、workspace 与版本信息的缓存键实例，例如 `apps/web/src/features/workspaces/context.tsx:35-43` 和 `apps/web/src/features/model-provider-query-key.ts:1-14`；这证明存在可复用模式，不证明所有功能均已一致遵循。

## 候选上下文映射（待产品确认）

| 候选上下文 | 当前代码候选落点 | 尚未确认的归属边界 |
| --- | --- | --- |
| Identity | `models/user.py`、`auth/*`、账号接口 | 全局账号、认证、会话与平台账号管理的责任分界 |
| Tenancy/Access | `tenancy/{resolver,context,scopes}.py`、`models/tenant.py` 中成员/作用域实体 | 按 `docs/tenancy-contract.md` 维护独立身份、TenantMember、WorkspaceMember 与服务端作用域校验；具体规则不由目录推断 |
| Tenant Administration | tenants、roles、menus、departments、dictionaries、configs、invitations 对应的 API/service | 管理 CRUD、生命周期、授权策略与访问解析之间的职责分界 |
| Workspace Resources | attachments 与其他 Workspace 资源 API/service/前端 feature | Workspace 协作资源与个人私有资源的归属边界 |
| AI Orchestration | team orchestration 与面向用户的 AgentScope 功能 | 用户用例/团队编排与上游 AgentScope 适配的界面 |
| AgentScope ACL | `apps/api/app/integrations/*` | 将外部模型、会话和运行时类型映射为 Synapse 内部身份/作用域的适配职责 |
| Operations | health/setup、scheduler、platform-admin CLI | 平台运维与用户身份/租户管理的分界 |
| Shared Kernel | `services/{errors,results}.py` 等共享概念 | 只保留语义稳定且确需共享的基础内容，避免变成通用业务层 |
| Face Recognition | 当前 `apps/api/app`、`apps/web/src` 未发现实现 | 集成计划只允许迁入人脸识别业务；Synapt 加密管理不迁入 |

## 当前耦合与已有守护

- `apps/api/app/api/tenant_invitations.py:8` 导入 `api.auth.set_session_cookie`，形成 API 路由模块之间的反向依赖。
- `apps/api/app/services/scheduled_tasks.py:20-21` 直接依赖 task dispatcher/runtime；盘点还发现多个 service 直接依赖 SQLAlchemy model 与 Session，具体迁移边界须按各功能的数据归属确定。
- Tenant、成员、邀请和 Workspace 模型共置于 `models/tenant.py`，反映技术层模型聚集而非已治理的领域边界。
- `apps/api/app/integrations/agentscope.py:109-161` 接入上游 `_service` 私有实现，是供应方升级时需要隔离的适配风险。
- `apps/api/tests/architecture/test_dependency_boundaries.py:62-94` 已用 AST 测试阻止 integrations→api、tenancy→api/integrations、限制 tenancy 中 FastAPI/Starlette 导入位置并防止生产代码导入 tests。该规则不覆盖全部业务上下文之间的依赖矩阵，也没有前端模块矩阵；本次只读盘点未运行此测试。另有 fresh 独立复验记录在 `docs/verification/architecture-guard-acceptance-2026-11-06.md`。

## 建议执行顺序

1. 产品负责人确认候选上下文的职责、关键数据归属和首个试点；决策表至少列出资源 owner、scope、API/service 责任与未决项。
2. 以获批的上下文矩阵扩展现有架构守护，明确允许/禁止导入及必要过渡例外；不提前禁止尚未批准的依赖。
3. 对获选的单一试点先完成 UX、API、数据归属、权限提示、失败/部分成功及验收契约，再进入实现。
4. 只迁移该试点的一个完整业务切片，采用 Strangler Fig，保留路由/wire contract、请求级事务规则和 tenancy contract；实现者与独立验收者分开。

产品负责人仍需确认的决策：

- Identity 与 Operations 的平台账号管理边界。
- Tenancy/Access 与 Tenant Administration 的职责分界，尤其角色/菜单授权与成员访问解析之间的接口。
- AI Orchestration、Workspace Resources 与 AgentScope ACL 的责任界面。
- 首个 context-first 迁移试点。Attachments 与既有 tenancy resolver seam 均可评估，但本地图不擅自替产品负责人作最终选择。

上述顺序延续 ADR 0003 的战略 DDD + 单 FastAPI 模块化单体决定；不表示采用微服务、全仓统一四层 DDD 或一次性物理重排。

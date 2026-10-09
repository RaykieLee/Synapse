# AgentScope 内嵌接口与依赖契约（研究稿）

状态：基于当前本地源码的接口研究，**尚未实现或验证**。这份文档供 F21 隔离适配设计使用，不表示嵌入方案、版本组合或租户隔离已经通过验收。

## 目标运行形态

AgentScope 的 `agentscope.app.create_app(...)` 返回一个独立 FastAPI 子应用。Synapse 将其挂载在 `/api/v1/ai`，由 Synapse 的统一 Uvicorn 入口在同一 Python 进程、同一个监听端口提供 AI 与业务 API。不要另开 AgentScope 端口，也不要把浏览器请求转发到单独服务。

源码入口为 `agentscope.app.create_app`（`agentscope/src/agentscope/app/__init__.py`）。工厂参数支持存储、消息总线、工作空间管理器、知识库管理器、Blob store、后台 worker 开关、扩展 middleware、Agent middleware/tools、资源访问策略、渠道、下载签名密钥等。它创建 FastAPI 实例并将内置路由逐一 `include_router`。

## 最小依赖选择与锁定

Synapse 当前 Python 包约束位于 `Synapse/apps/api/pyproject.toml`：Python `>=3.11`、FastAPI `>=0.115,<1`，Pydantic Settings 2.x、SQLAlchemy 2.x、Uvicorn 0.x。AgentScope 自身要求 Python `>=3.11`；其 `service` extra 声明 FastAPI、Uvicorn、APScheduler、AG-UI 协议；`storage-redis` 提供 Redis；`vdb-qdrant` 提供 qdrant-client。

按 Synapse 已确定的 Redis、持久工作目录、Qdrant 持久化计划，候选最小安装集合为：

- AgentScope 的 `service` 与 `storage-redis` extras；
- AgentScope 的 `vdb-qdrant` extra（仅在选用 AgentScope Qdrant vector store 时）；
- Redis 服务端连接库由该 extra 提供；
- 本地持久化工作空间及本地 Blob store 无需 Docker、S3 或其他 workspace extra；
- 只对已启用的渠道类型添加其 channel extra；不安装 `models`、`workspace`、`realtime` 等整组可选功能，除非实际启用。

此处是功能依赖范围建议，不是已解析成功的锁文件。AgentScope 的 service extra 对 FastAPI 等包未声明兼容上限，而 Synapse 已有范围较宽，因此目前不能仅凭元数据断言两者兼容。集成时应先将 AgentScope 固定到明确发布版本或 Git commit，再生成完整解析锁（直接与传递依赖均锁定），记录 Python 版本、平台、AgentScope 来源/许可证；明确锁住 FastAPI、Starlette、Pydantic、Uvicorn、AG-UI、Redis client、APScheduler 和 Qdrant client 的实测组合。锁定前核查 AgentScope 源码/发布版本和 Synapse Pydantic 用法，不要通过无边界升级来“解决”冲突。完成应用启动与接口联调后才能将候选组合标记为验证通过。

## 生命周期组合

`create_app` 自带 `lifespan`（`agentscope/src/agentscope/app/_lifespan.py`），在启动期间进入 storage、message bus、workspace manager、可选知识库 manager/blob store/hubs，并创建或启动后台任务管理、聊天 run registry、调度器、资源访问服务、聊天/会话服务、渠道服务、SOP 服务、知识索引 worker/sweeper 等；关闭时由 `AsyncExitStack` 逆序清理。

Starlette/FastAPI 挂载子应用不会自动运行其 lifespan。因此仅 `root.mount("/api/v1/ai", ai_app)` 不够，且 `ai_app` 自带 `/health` 明确会在这类情况下报告 `not_ready`。Synapse 主应用 lifespan 应在自己的 `AsyncExitStack` 中显式进入子应用的 `ai_app.router.lifespan_context(ai_app)`，确保同一启动与关闭周期中恰好启动/停止一次 AgentScope 资源。不要再让第二个 Uvicorn 入口或重复生命周期管理器运行它。具体组合代码属于实现阶段，本研究没有执行或验证。

该选择还意味着每个承载 Synapse 请求的进程都会运行 AgentScope 生命周期。单进程部署可采用内嵌 indexing/channel worker/scheduler；若后续多副本，须将 scheduler 设为单实例、评估 channel 长连接 owner、index worker 的重复/分布式消费以及共享下载密钥，不能直接把默认值复制到每个副本。

## 认证依赖覆盖和审查面

`agentscope.app.deps.get_current_user_id` 当前读取 `X-User-ID` 请求头，缺失时返回 401；它是临时身份入口，不是 Synapse JWT/会话校验。AgentScope 子应用的 `dependency_overrides` 可按依赖函数对象覆盖它，例如以 Synapse 已认证用户依赖作为唯一身份来源。覆盖应安装在 `ai_app` 上，供挂载子应用路由解析；返回的 AgentScope `user_id` 必须是经认证账号稳定 ID（Synapse 契约沿用 `sys_user.user_id`），绝不能信任客户端传入的 `X-User-ID`。

覆盖身份依赖只解决“是谁”，不会自动传递 tenant/workspace scope，也不会让存储查询按空间隔离。Synapse 的租户契约要求每次空间请求重新校验租户状态、workspace 归属、成员资格及权限。AI 子应用必须另行取得验证后的 `tenant_id`、协作 `workspace_id`、actor user id，并确保请求操作、后台任务、会话流、渠道事件、文件下载、索引和向量检索都继承该上下文。

逐个检查 router endpoint 的 Depends：多数业务路由使用 `get_current_user_id`，但模型目录、Hub/Skill 目录、知识库 parser/chunker 能力列表、channel type 列表等存在不依赖用户身份的 endpoint。不能假设覆盖一个函数便覆盖所有授权边界。对每个无需用户 ID 的端点明确其公开/登录/角色规则；如果 app 级全局认证依赖被增加，应确认 webhook/平台回调等系统入口有单独的可信验证方式。

`create_app` 没有接受 auth dependency 参数；当前可见扩展点包括 `extra_middlewares`、`extra_agent_middlewares`、`extra_agent_tools` 和 `resource_access_policy`，均不等价于完整请求级租户授权。F21 需确定适配位置和可测试策略，并审查资源 ID 横向访问、SSE/取消、下载签名、MCP/Skills、凭据使用、定时任务及系统入口。

## 路径前缀与 URL

`mount("/api/v1/ai", ai_app)` 会把子应用路由前缀附加在外部 URL 上。AgentScope 内部仍注册如 `/health`、`/sessions` 等以 `/` 开始的路由；前端/适配器请求应统一从 `/api/v1/ai/...` 构造，不能让以 `/` 开头的绝对路径把 `/api/v1` 覆盖掉。`root_path`/反向代理前缀、OpenAPI 文档、SSE `EventSource`、multipart 上传、带 token 下载/预览、查询回调 URL 都需逐条联调。`download_secret` 默认是每进程随机值，持久化/多副本部署应注入稳定 secret；路径前缀变更是否正确进入签名 URL 也需要验证。

## 可用公共接口与持久化组件

以下是当前源码公开入口/扩展抽象，不是租户隔离声明：

- Storage：`agentscope.app.storage.StorageBase`；内置 `RedisStorage`（Redis）、`AsyncSQLAlchemyStorage`（`storage-sql` extra，具体 async driver 由应用提供）。`agentscope.app.storage` 导出记录类型。存储接口大多以 `user_id` 为 owner key；将账号 ID 映射为协作 Workspace ID 会造成身份混淆，不得用这种技巧伪造租户隔离。
- Message bus：`agentscope.app.message_bus.MessageBus`、`RedisMessageBus`、`InMemoryMessageBus`。计划采用 Redis bus 承载进程间/后台事件；本地内存 bus 仅适用于明确单进程情形，重启或跨进程不能提供持久队列语义。
- Knowledge base：`agentscope.app.rag.knowledge_base_manager.KnowledgeBaseManagerBase`、`CollectionPerKbManager`；向量 store 抽象在 `agentscope.rag`，其中 `QdrantStore` 需 `vdb-qdrant`。`QdrantStore(location=":memory:")` 是内存模式示例；Synapse 计划持久化，需配置 Qdrant 服务或经确认的数据目录并设置 collection/metadata 的租户空间边界。manager 生命周期进入时也负责进入其 vector store。
- Blob：`agentscope.app.rag.blob_store.BlobStoreBase`、`LocalBlobStore`、`S3BlobStore`。本地 blob 默认 `./blobs`，应显式换成稳定持久化目录；Blob 路径及下载授权须按范围隔离。
- Runtime 工作目录：`agentscope.app.workspace_manager.WorkspaceManagerBase`、`LocalWorkspaceManager`。后者接受 `basedir`，按 AgentScope runtime workspace ID 管理目录；协作 workspace ID 与 runtime workspace ID 在 Synapse 契约中是不同概念，需有受控映射。工作目录持久化需明确持久挂载目录和备份/权限边界。
- Resource access：`agentscope.app.access.ResourceAccessPolicyBase`、`DenyAllResourceAccessPolicy`、`ResourceRef`、`ResourceKind`、`ResourcePermission`。策略目前只针对跨用户 credential/agent/knowledge base 资源引用，由 `list_accessible(viewer_id, kind, storage)` 及可覆盖的 `can_edit(...)` 决策；它不管理 tenant/workspace membership，也不覆盖 sessions、文件、channel、SOP 或查询过滤，不能把它单独当作多租户隔离层。

## F21 必须继续设计的隔离适配点

1. 定义 request context：由 Synapse 鉴权依赖产出不可伪造的 `actor_user_id / tenant_id / workspace_id / role`，并在请求和后台工作中传递；客户端 header/body ID 只作为待校验选择项。
2. 确定 AgentScope 持久化边界：当前记录 owner 多为 user_id，需决定 workspace 共享资源模型、个人私有资源与共享资源授权如何映射，禁止把 workspace 用户合并成一个 user ID。
3. 确认 `StorageBase` / Redis key / SQL 表与查询是否需包装或扩展，使每条 agent、session、credential、KB、MCP/Skill、channel、schedule、SOP 和 team 记录具有范围并在读取/写入时强制筛选。`RedisStorage.KeyConfig` 前缀可作命名空间工具，但不是授权检查。
4. 追踪聊天、SSE、取消、跨会话消息、定时触发、索引队列和渠道事件的归属传播及撤权行为；需要在创建时固化范围并在执行时再次校验。
5. 将 AgentScope runtime workspace、Blob、Qdrant collection/point payload、下载 token 和缓存 key 纳入租户/空间路径与访问策略，检查任何按资源 ID 直接读取的路径。
6. 审查不依赖用户 ID 的管理/目录路由与外部回调，为其设定显式 auth policy。
7. 审查模型凭据引用以及 Agent middleware/tools 的授权；Agent runtime 的 `user_id` 参数本身不携带 Synapse 租户上下文。模型凭据隔离实现与限制见 `agentscope-model-credential-isolation.md`；仍需独立验收。

只有以上适配完成并在至少两个租户、多个空间、跨空间成员、撤权与后台执行场景下实际验证后，才能把“已隔离”或“已通过”写入状态文件。

## 依据

- `agentscope/src/agentscope/app/_app.py`、`_lifespan.py`、`deps.py`、`access/_policy.py`、`storage/`、`workspace_manager/`、`rag/`。
- `agentscope/pyproject.toml` optional dependency extras 与 Synapse `apps/api/pyproject.toml` 当前包约束。
- `Synapse/docs/integration-plan.md` 与 `Synapse/docs/tenancy-contract.md` 的同进程/单端口、Redis/Qdrant/工作目录持久化计划及账号、租户、协作 Workspace 约定。

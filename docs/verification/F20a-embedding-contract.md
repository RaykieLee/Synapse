# F20a：AgentScope 内嵌契约源码核验

状态：源码静态核验完成；没有安装依赖、启动服务或执行集成验证。本记录只核查接口、依赖元数据、生命周期组合和授权覆盖边界，不代表 F20 实现或多租户隔离通过。

核验对象：`Synapse/docs/agentscope-embedding-contract.md` 与工作区 `agentscope/` 当前源码。

## 核验结论

| 契约点 | 源码可确认事实 | 判断 |
|---|---|---|
| 公共 app 符号 | `agentscope/src/agentscope/app/__init__.py` 从 `._app` 导入 `create_app` 并列入 `__all__`；`StorageBase`、`MessageBus`、`RedisMessageBus`、`InMemoryMessageBus`、`CollectionPerKbManager`、`LocalBlobStore`、`LocalWorkspaceManager` 分别位于 `app/storage`、`app/message_bus`、`app/rag/knowledge_base_manager`、`app/rag/blob_store`、`app/workspace_manager` 公共包。 | 名称和模块路径与研究稿一致；确认到源码定义/导出，不代表安装后的发布包导入测试已过。 |
| `create_app` 参数 | `app/_app.py` 的签名包含 storage、message_bus、workspace_manager、KB parser/chunker/manager、blob_store、worker 开关、hub、middleware/tool、resource policy、channels、download_secret、title/version。它创建 `FastAPI(..., lifespan=lifespan)` 并逐一 `include_router`。 | 研究稿列出的主要扩展点真实存在。注意 `**kwargs` 仅兼容旧 `knowledge_chunker`，其他未知关键字会警告并忽略，不能视为可扩展参数。 |
| extras | `agentscope/pyproject.toml` 标明 Python `>=3.11`；`service` 包含 `fastapi`、`uvicorn`、`apscheduler`、`ag-ui-protocol>=0.1.10`；`storage-redis = ["redis"]`；`vdb-qdrant = ["qdrant-client"]`。Synapse API 元数据要求 Python `>=3.11`、FastAPI `>=0.115,<1`、Uvicorn `>=0.32,<1`。 | 文档提及的 extra 拼写及候选功能集合正确。元数据未给 AgentScope service 对 FastAPI/Uvicorn 的上界，因此兼容性不能从源码/元数据推出。 |
| 生命周期 | `app/_lifespan.py` 以一个 `AsyncExitStack` 进入 storage、bus、workspace、可选 KB manager/blob/hubs、各 manager/service/worker；stack 退出时逆序清理。`_app.py` 把该 lifespan 交给子 FastAPI。`_router/_health.py` 检查多个 lifespan 创建的 state 项；未运行子应用 lifespan 时它们缺失，返回 503 `not_ready`。 | 子应用生命周期确实是关键集成要求。研究稿建议由主应用显式进入 `ai_app.router.lifespan_context(ai_app)`，从代码结构看合理；但是否恰好一次、退出顺序正确及挂载请求访问正确 state，仍须在 Synapse 集成运行时验证。 |
| 身份依赖覆盖 | `app/deps.py:get_current_user_id` 通过 `X-User-ID` Header 取身份；缺失时 401。路由将依赖函数对象用作 `Depends`。`create_app` 没有 auth dependency 参数，创建后可见 FastAPI 的应用对象可配置 `dependency_overrides`，故可以尝试按同一函数对象覆盖。 | 仅覆盖到子应用 `ai_app` 是符合 FastAPI 子应用隔离边界的设计方向；还需实际请求证明挂载路由确实解析子应用覆盖。覆盖只替代身份值，不自动生成/传播 tenant 或 workspace scope。 |
| 资源策略边界 | `app/access/_policy.py` 的 `ResourceKind` 只枚举 credential、agent、knowledge_base。`ResourceAccessPolicyBase` 接收 viewer_id、kind、storage，并声明不管理用户、群组、membership；默认 `can_edit` 只按列出的资源引用判断。 | 研究稿称其不是 tenant/workspace 授权层，符合实现。不能据此推断 session、workspace 文件、channel、SOP、下载、向量查询均被租户隔离。 |

## 授权覆盖边界补充

大多数业务路由显式依赖 `get_current_user_id`，但路由面不能仅靠“覆盖这一项”推定授权完整：健康路由本身也依赖该身份；KB 下载路由还组合下载签名依赖；其他路由中的无需身份端点及回调类型须以逐路由审查为准。建议 F21 继续按 endpoint 清单确认匿名/登录/角色规则，以及系统回调的独立可信校验。静态检索不是完整 endpoint 审计。

同进程/单端口是 Synapse 部署目标，不是 AgentScope 源码自动保证的性质。`create_app` 同时支持独立运行和挂载；只有由 Synapse 的同一个 ASGI 根应用挂载、且部署只启动该根应用，才能满足该目标。源码允许开独立入口，故应通过实际启动拓扑确认没有第二个 AgentScope server。

## 必须运行验证的项目

1. 固定 AgentScope 来源及版本，解析并锁定完整 Python 依赖；在 Synapse 目标 Python/平台安装，检查 FastAPI、Starlette、Pydantic、Uvicorn、AG-UI、Redis、APScheduler、Qdrant 的实际解析版本与导入兼容。
2. 启动 Synapse 根 ASGI 应用，确认 AI 路由与业务 API 同进程同端口可达；确认子应用 lifespan 启动一次、健康状态就绪、关闭时资源完整释放，启动失败时部分资源也能清理。
3. 带有效 Synapse 身份请求及伪造 `X-User-ID` 请求，验证 dependency override 使用服务端认证身份；未认证请求拒绝；确认根应用或兄弟子应用的 overrides 不会意外改变 AI 子应用行为。
4. 对全部 AgentScope 路由执行 auth policy 清点和越权请求验证；覆盖租户、workspace 成员资格、跨空间资源 ID、SSE/取消、下载、后台任务、索引、channel/webhook、schedule、撤权后的执行。
5. 验证 `/api/v1/ai` 前缀、代理/root_path、SSE、multipart、回调、签名下载 URL；多实例若启用，另验证 scheduler 单实例、channel owner、共享 secret 与索引消费语义。

## 依据位置

- `agentscope/src/agentscope/app/__init__.py`、`_app.py`、`_lifespan.py`、`deps.py`、`_router/_health.py`、`access/_policy.py`
- `agentscope/pyproject.toml`
- `Synapse/apps/api/pyproject.toml`
- 原始契约：`Synapse/docs/agentscope-embedding-contract.md`

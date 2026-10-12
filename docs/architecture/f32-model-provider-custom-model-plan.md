# F32 模型、提供商、凭据与自定义模型方案

状态：方案梳理，未修改产品代码。本文只记录当前仓库和已安装 AgentScope 版本能够证明的事实，以及 F32 后续实施建议。

## 1. 结论先行

当前 F32 的真实基线不是“没有模型能力”，而是“AgentScope 已提供底层模型/凭据路由，Synapse 已完成一部分凭据作用域适配，但产品级模型提供商管理和前端入口尚未迁入”：

- AgentScope 已挂载在 Synapse 同一 FastAPI 进程的 `/api/v1/ai` 下；凭据 CRUD、凭据 Schema、聊天/嵌入/TTS 模型目录路由来自已固定的 AgentScope commit `72f3f6fa0b2fc38b8517f408ab616f0f2bd229e6`。[`apps/api/pyproject.toml`](../../apps/api/pyproject.toml)、[`apps/api/app/integrations/agentscope.py`](../../apps/api/app/integrations/agentscope.py)、[`apps/api/.venv/Lib/site-packages/agentscope/app/_app.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_app.py)
- F21b2b5 已将凭据 ID、Redis owner key 和凭据密文绑定到 `tenant_id + workspace_id + actor_user_id`；API 列表/详情只投影 provider type 和显示名，runtime resolver 才解密。[`apps/api/app/integrations/agentscope_session_scope.py`](../../apps/api/app/integrations/agentscope_session_scope.py)、[`docs/agentscope-model-credential-isolation.md`](../agentscope-model-credential-isolation.md)
- 当前凭据默认是“当前 Workspace 内当前账号私有”，不是 Workspace 共享凭据，也不是租户级凭据。AgentScope 原生跨用户共享策略没有被 Synapse 作用域适配器开放。
- provider 和模型目录目前由 AgentScope Python provider class 及其 `_models/*.yaml` 静态注册；`GET /model/` 只按 provider 类型返回内置模型卡，不读取数据库或用户自定义模型表。
- OpenAI-compatible 端点已经有一个可运行的最小通道：`OpenAICredential.base_url` 可覆盖 endpoint，`ChatModelConfig.model` 是任意字符串，runtime 用该字符串构造 OpenAI Chat Completions client。可是目录不会显示该自定义模型，页面也没有录入、测试、启用或归属管理入口。
- 当前 Web 只有 Workspace 智能体、会话、附件、Workspace 设置和全局个人设置；智能体页面明确把“模型凭据和聊天会话”留给其他页面，但仓库中没有对应 F32 页面或 API 客户端。[`apps/web/src/features/workspaces/agents-page.tsx`](../../apps/web/src/features/workspaces/agents-page.tsx)、[`apps/web/src/features/settings/index.tsx`](../../apps/web/src/features/settings/index.tsx)
- F32 首期应把“凭据连接”和“模型定义/别名”分开：凭据保存秘密，模型定义保存非秘密能力与调用约束；模型引用只引用稳定的 model binding ID，不把 API key 或 endpoint secret 塞进 agent/session 的 `parameters`。

## 2. 当前真实实现

### 2.1 服务挂载与可见 API

`create_agentscope_app()` 创建 AgentScope 子应用，并由 Synapse 主应用挂载到 `/api/v1/ai`。它使用 Redis storage、WorkspaceSessionStorage、Synapse gateway 和统一的 JWT/session 认证；子应用的生命周期由主应用显式管理。[`apps/api/app/integrations/agentscope.py`](../../apps/api/app/integrations/agentscope.py)、[`docs/agentscope-runtime.md`](../agentscope-runtime.md)

已安装版本的 AgentScope `create_app()` 注册以下与 F32 直接相关的路由：

| 路径 | 当前真实行为 | 持久化内容 |
| --- | --- | --- |
| `GET /api/v1/ai/credential/schemas` | 返回已注册 credential class 的 JSON Schema，用于动态生成凭据表单 | 无 |
| `GET /api/v1/ai/credential/` | 返回当前调用者可见的凭据投影 | AgentScope credential record；Synapse 适配器只保留安全标签 |
| `POST /api/v1/ai/credential/` | 接收 `{data: {...}}`，按 `data.type` 通过 CredentialFactory 构造并保存 | 凭据密文及 type/name |
| `PATCH /api/v1/ai/credential/{credential_id}` | 替换整个 credential payload | 更新凭据密文 |
| `DELETE /api/v1/ai/credential/{credential_id}` | 删除凭据 | 删除 record |
| `GET /api/v1/ai/model/?provider=...` | 返回 provider class 的聊天 ModelCard 列表 | 无；目录来自静态 YAML |
| `GET /api/v1/ai/embedding-model/?provider=...` | 返回 provider class 的嵌入模型卡 | 无；目录来自静态 YAML |
| `GET /api/v1/ai/tts-model/?provider=...` | 返回 provider class 的 TTS 模型卡 | 无；目录来自静态 YAML |

依据是 AgentScope 的 `_credential.py`、`_model.py`、`_embedding_model.py`、`_tts_model.py` router，以及 `_app.py` 对这些 router 的注册。[`apps/api/.venv/Lib/site-packages/agentscope/app/_router/_credential.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_router/_credential.py)、[`apps/api/.venv/Lib/site-packages/agentscope/app/_router/_model.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_router/_model.py)

这些底层 API 不能直接当成 Synapse 的完整 F32 产品契约：

- credential API 的请求体是开放的 `dict`，Schema 由运行时注册的 credential class 生成；没有租户/Workspace/共享范围字段。
- model API 的请求只有 `provider`，没有 `credential_id`、Workspace、模型别名、启用状态、能力覆盖或自定义模型字段。
- model API 返回 ModelCard 静态元数据，不验证凭据有效性，不探测 endpoint，也不表示该模型可以成功推理。
- 当前没有 provider CRUD、model binding CRUD、连接测试、模型测试、默认模型、禁用/归档、使用引用查询或审计 API。

### 2.2 当前凭据隔离与加密

`WorkspaceSessionStorage` 对 credential 做了以下处理：

```text
credential id:
synapse-credential-t{tenant_id}-w{workspace_id}-u{actor_user_id}-{id}

storage owner:
synapse-credential-owner-t{tenant_id}-w{workspace_id}-u{actor_user_id}
```

写入时 payload 被序列化进 Fernet envelope，envelope 同时认证 storage owner 和 credential ID；Redis record 只包含 `type`、`name` 和 `synapse_ciphertext_v1`。列表、普通读取和更新响应不会返回 API key。只有 `ResourceAccessService.resolve_credential()` 调用受保护的 runtime 路径后才解密。[`apps/api/app/integrations/agentscope_session_scope.py`](../../apps/api/app/integrations/agentscope_session_scope.py)

缺少或错误的 `SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY` 会返回受控 503，不回退到明文或开发密钥。当前文档明确说明：密钥轮换、多密钥兼容、旧无作用域数据迁移和真实 provider 调用仍未完成。[`docs/agentscope-model-credential-isolation.md`](../agentscope-model-credential-isolation.md)、[`docs/agentscope-runtime.md`](../agentscope-runtime.md)

F21b2b5 验收已覆盖新凭据加密、跨 tenant/Workspace/actor 拒绝、响应和日志脱敏及 session 的 credential ID 作用域校验；未覆盖真实 provider API、模型构造后的成功推理、provider 错误分类、旧数据迁移和生产多副本密钥轮换。[`docs/verification/F21b2b5-model-credential-isolation.md`](../verification/F21b2b5-model-credential-isolation.md)

### 2.3 当前 provider 与模型目录

AgentScope 的 `CredentialFactory` 注册 provider credential class。以 OpenAI 为例，真实 credential schema 至少有：

```text
type: "openai_credential"
name: string
api_key: SecretStr
organization: string | null
base_url: string | null
```

[`apps/api/.venv/Lib/site-packages/agentscope/credential/_openai.py`](../../apps/api/.venv/Lib/site-packages/agentscope/credential/_openai.py)

聊天模型目录由 provider 对应的 ChatModel class 扫描旁边的 `_models/*.yaml`，生成 `ModelCard`。ModelCard 包含 `name`、`label`、`status`、输入/输出类型、context/output size 和参数 Schema；模型名称和标签是静态卡字段，不是 Synapse 业务数据。[`apps/api/.venv/Lib/site-packages/agentscope/model/_base.py`](../../apps/api/.venv/Lib/site-packages/agentscope/model/_base.py)、[`apps/api/.venv/Lib/site-packages/agentscope/model/_model_card.py`](../../apps/api/.venv/Lib/site-packages/agentscope/model/_model_card.py)

### 2.4 OpenAI-compatible 当前能力和写死点

当前 OpenAI Chat Model 初始化时把 `OpenAICredential.api_key`、`organization`、`base_url` 传给 OpenAI async client；调用时把 `ChatModelConfig.model` 作为请求 model 字符串传给 Chat Completions。[`apps/api/.venv/Lib/site-packages/agentscope/model/_openai_chat/_model.py`](../../apps/api/.venv/Lib/site-packages/agentscope/model/_openai_chat/_model.py)

因此，以下路径在代码上是可行的：

```json
{
  "type": "openai_chat",
  "credential_id": "<scoped credential id>",
  "model": "my-company-chat",
  "parameters": {}
}
```

其中 credential 的 `base_url` 指向 OpenAI-compatible 服务，`model` 使用该服务接受的模型 ID。`get_model()` 即使找不到对应 ModelCard，也仍然构造模型；找不到卡时保留模型类默认的 context size 和 formatter input types。[`apps/api/.venv/Lib/site-packages/agentscope/app/_service/_model.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_service/_model.py)

写死点和风险：

1. `/model/` 目录只列内置 YAML 卡，自定义 model string 不会出现在模型选择列表。
2. 自定义模型没有 context size、output size、模态、tool calling、structured output、reasoning 等能力声明；runtime 会落到默认值或 provider 实现的宽松行为。
3. OpenAI-compatible 的协议差异、路径拼接、鉴权头、额外 header、TLS/代理和响应兼容性没有独立契约。
4. `base_url` 与 API key 都位于同一 credential payload；当前没有 endpoint 的非秘密展示、校验、连通性状态或变更审计。
5. session/agent 配置中的 `type`、`credential_id`、`model`、`parameters` 是运行时配置，不是可供用户管理的 provider/model 资源。
6. ModelCard 不持久化，无法记录模型被哪个 Workspace 使用，也无法在删凭据前发现引用关系。

## 3. 归属与作用域建议

必须维持 `docs/tenancy-contract.md` 的硬规则：全局账号、租户成员和 Workspace 成员独立；平台管理员不因平台角色自动获得聊天、凭据或人脸数据访问权；个人凭据和会话默认私有；客户端资源 ID 不是授权凭证。

### 3.1 资源分层

建议把 F32 资源分成四层：

| 资源 | 建议归属 | 是否秘密 | 说明 |
| --- | --- | --- | --- |
| Provider 类型/协议能力 | 全局只读注册表 | 否 | 例如 `openai_chat`、`openai_embedding`；由服务端安装/注册，不由普通租户任意上传 Python class |
| Credential connection | 默认个人私有；首期不做共享 | 是 | 由 actor 创建，绑定创建时 tenant/Workspace；用于 API key、organization、base URL、额外认证信息 |
| Model binding / model profile | Workspace 共享，创建者负责管理 | 否，但可能含敏感 endpoint 引用 | 把某个 credential 与一个模型 ID、能力声明、显示名、状态和默认参数组合成可选模型；共享读取投影不得暴露原始 credential ID |
| Agent/session model reference | Workspace 资源或个人会话配置 | 否 | 只引用 model binding 或受控的 provider/model 标识，不保存 secret |

这里“凭据默认个人私有”是当前实现和租户契约的兼容路径；“Workspace 共享模型”不代表共享 API key。Workspace 成员只能看到模型 binding 的非秘密投影，且不能从投影中得到带 actor/tenant/workspace 编码的原始 credential ID、可枚举引用或密文；runtime 仍须依据绑定的 credential 授权执行。首期若无法安全实现共享 credential，应让 Workspace 管理员创建 binding，但只允许创建者/被授权 actor 使用，或把 binding 明确显示为“仅自己可用”，不能产生伪共享 UX。

模型 binding 的共享读取投影必须明确区分“模型可见”和“当前操作者可执行”。建议只返回 `credential_status: available|unavailable|owner_only`、`credential_provider` 和不可枚举的内部引用摘要；只有服务端 runtime 可以解析真实 credential ID。创建者撤权、凭据删除或凭据不可用时，binding 仍可作为历史配置显示，但必须变为 `unavailable` 并阻止运行，不能把原始 credential 归属泄露给其他成员。

### 3.2 推荐的最小引用链

```text
Workspace
  └─ ModelBinding (workspace-shared metadata)
       ├─ ProviderType (global registry)
       ├─ CredentialRef (actor-private credential)
       └─ ModelSpec (model id + capability metadata)

Agent/Session
  └─ model_binding_id
```

若首期为了兼容 AgentScope 而继续存 `type + credential_id + model + parameters`，服务层必须把它视为 legacy wire format：先解析为当前 scope 的 binding/credential，再执行完整作用域校验；不能让前端直接拼接 foreign credential ID。

### 3.3 运行上下文

每个 F32 请求必须从已验证 `WorkspaceContext` 派生：

```text
actor_user_id
tenant_id
workspace_id
workspace_role
permission_set
membership_version
```

`X-Workspace-ID` 只选择上下文，不授予权限。provider/model/credential 列表、创建、更新、删除、测试连接和引用检查都应在服务端重复校验账号、租户、Workspace 状态和成员权限。[`docs/agentscope-tenant-context.md`](../agentscope-tenant-context.md)、[`docs/tenancy-contract.md`](../tenancy-contract.md)

## 4. API 与前端缺口

### 4.1 API 缺口

当前缺少以下产品级契约：

- provider registry：可用 provider、协议能力、credential schema、支持的 chat/embedding/TTS 能力和版本；
- credential connection：安全创建、轮换、删除、脱敏详情、最后使用时间、绑定数量；
- model binding：Workspace 下的显示名、provider、model ID、模型类型、能力声明、启用状态、默认参数；
- connection/model test：异步或同步测试、稳定错误码、超时、取消、结果脱敏；
- reference management：列出 binding 使用在哪些 agent/session/knowledge base，删除前阻止或提供迁移；
- audit：创建、更新、轮换、删除、连接测试、启用/停用、权限变化；
- embedding/TTS：保留 AgentScope 现有能力，但要有与 Workspace/credential/binding 一致的归属和前端契约；
- migration compatibility：旧 session/agent 配置读写、旧 credential ID 隐藏、未作用域数据处理和回滚。

建议 F32 新增的 API 形状（具体路径可在实现任务中锁定）：

| 方法 | 建议路径 | 目的 |
| --- | --- | --- |
| `GET` | `/api/v1/ai/providers` | 全局 provider 能力/Schema/版本目录；只返回非秘密元数据 |
| `GET` | `/api/v1/ai/credentials` | 当前 actor 在当前 Workspace 的凭据脱敏列表 |
| `POST` | `/api/v1/ai/credentials` | 创建或轮换个人凭据；secret 只进请求体，不进响应 |
| `PATCH` | `/api/v1/ai/credentials/{id}` | 修改名称或替换 secret；不支持读取原 secret |
| `DELETE` | `/api/v1/ai/credentials/{id}` | 删除前检查引用或按明确策略解除绑定 |
| `GET` | `/api/v1/ai/models` | 当前 Workspace 可用的 model binding 列表，支持 `kind`、`status`、`provider`、`q` |
| `POST` | `/api/v1/ai/models` | 创建 Workspace model binding |
| `PATCH` | `/api/v1/ai/models/{id}` | 修改显示名、能力声明、默认参数、状态或 credential 引用 |
| `POST` | `/api/v1/ai/models/{id}/test` | 以当前权限执行受控连接/最小请求测试 |
| `DELETE` | `/api/v1/ai/models/{id}` | 归档或删除；有引用时返回稳定冲突码 |
| `GET` | `/api/v1/ai/models/{id}/references` | 查看当前调用者有权知道的引用摘要 |

不建议直接覆盖 AgentScope 原始 `/credential/` 和 `/model/` 语义而不做兼容层。更安全的方式是增加 Synapse F32 router/service，内部调用受保护的 credential runtime resolver，并保留旧路由作为迁移期只读/兼容入口，直到前端和存量配置迁移完成。

### 4.2 Web 缺口

当前正式页面证据：

- Workspace 首页只有智能体、会话、附件、成员和 Workspace 设置入口；没有模型/凭据入口。[`apps/web/src/features/workspaces/pages.tsx`](../../apps/web/src/features/workspaces/pages.tsx)
- 智能体页面只编辑名称、系统提示词和 JSON 配置，并明确写着“模型凭据和聊天会话在各自页面管理”；没有模型选择和凭据选择。[`apps/web/src/features/workspaces/agents-page.tsx`](../../apps/web/src/features/workspaces/agents-page.tsx)
- 全局 Settings 只有 Profile、Account、Appearance、Notifications、Display，没有 AI provider/model/credential 页面。[`apps/web/src/features/settings/index.tsx`](../../apps/web/src/features/settings/index.tsx)
- 会话页面负责会话、消息、SSE、工具事件和中断，但当前没有 provider/model 管理表单。[`apps/web/src/features/workspaces/sessions-page.tsx`](../../apps/web/src/features/workspaces/sessions-page.tsx)
- Web API client 默认使用 `/api/v1`，Workspace 请求通过 `X-Workspace-ID` 携带上下文；F32 页面应沿用该方式，并把 actor、tenant、workspace、membership version 纳入 Query key。[`apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)、[`apps/web/src/features/workspaces/agents-page.tsx`](../../apps/web/src/features/workspaces/agents-page.tsx)

建议的页面信息架构：

1. Workspace > 模型：当前空间可用模型 binding、状态、类型、provider、来源、默认/引用数量。
2. Workspace > 模型 > 新建/编辑：选择 provider、选择/新建个人 credential、填写 model ID、能力声明、默认参数和显示名。
3. Workspace > 凭据：当前账号私有凭据；显示 provider、名称、endpoint host、最近测试状态和引用数量，不显示 secret。
4. Workspace > 模型 > 连接测试：明确“发送最小真实请求可能产生费用/日志/限流”，展示可恢复错误和最后测试时间。
5. Agent 编辑：从当前 Workspace 可用 model binding 中选择 primary/fallback；若 binding 不可用，显示原因并阻止保存，而不是静默回退。
6. 知识库/语音使用处：分别选择 embedding/TTS binding，显示能力不匹配、维度不匹配和 credential 不可用状态。

页面必须覆盖加载、空数据、无权限、归档 Workspace、密钥未配置、provider 不支持该能力、连接超时、部分成功、重复提交、删除有引用、切换 Workspace 后晚到响应和窄屏/键盘可用性。

## 5. OpenAI-compatible 自定义模型最小数据契约

### 5.1 原则

最小契约只解决“一个 OpenAI-compatible chat endpoint 上的一个自定义模型可安全被选择和调用”。不首期承诺自动发现模型、完整 OpenAI Responses API、所有多模态能力、供应商专属参数或跨 Workspace credential 共享。

### 5.2 Provider 与 credential

全局 provider registry 的最小只读投影：

```json
{
  "provider_type": "openai_chat",
  "credential_type": "openai_credential",
  "label": "OpenAI-compatible Chat",
  "capabilities": ["chat"],
  "credential_schema_version": 1,
  "supports_custom_model_id": true,
  "supports_base_url": true
}
```

个人 credential 的写入契约建议：

```json
{
  "provider_type": "openai_chat",
  "name": "Company Gateway",
  "api_key": "<write-only secret>",
  "base_url": "https://llm.example.com/v1",
  "organization": null
}
```

约束：

- `api_key` 仅写入，不在任何成功响应、日志、审计 detail、异常文本或前端缓存中返回。
- `base_url` 必须是允许的 `https` URL；开发环境是否允许 `http://localhost` 由部署策略明确，不由普通请求任意关闭 TLS。
- 服务端规范化末尾斜杠和已知 `/v1` 路径规则，避免 SDK 再拼接出错误路径；不要把未经验证的任意 URL 用作 SSRF 入口。
- `organization` 可选且按 provider schema 校验；不要把额外 header 作为首期自由 JSON 放开。
- UI 只展示 endpoint 的 scheme/host/脱敏 path 摘要，不能把完整 secret-bearing URL 或认证 header 回显。

### 5.3 Model binding

最小的 Workspace model binding 读取投影：

```json
{
  "model_id": "mdl_01J...",
  "workspace_id": "123",
  "tenant_id": "45",
  "display_name": "Company Chat",
  "kind": "chat",
  "provider_type": "openai_chat",
  "credential_status": "owner_only",
  "credential_provider": "openai_credential",
  "model": "company-chat-v3",
  "status": "active",
  "capabilities": {
    "input_types": ["text/plain"],
    "output_types": ["text/plain"],
    "context_size": 32768,
    "output_size": 4096,
    "tool_calling": "unknown",
    "structured_output": "unknown",
    "streaming": "required"
  },
  "default_parameters": {}
}
```

其中：

- `model_id` 是 Synapse 生成的稳定字符串 ID；前端和 agent/session 新契约引用它。
- 共享读取投影不返回原始 `credential_id`。服务端内部保存 scope-checked credential reference；普通读取只返回 `credential_status`、provider 摘要和必要的可用性原因，不能通过响应推导 actor/tenant/workspace 编码或枚举其他凭据。
- `credential_status=available` 只表示当前调用者有权使用绑定的凭据；`owner_only` 表示模型元数据可见但凭据仅创建者可用；`unavailable` 表示凭据被删除、撤权、禁用或尚未完成连接验证。所有状态都必须在服务端按当前 `WorkspaceContext` 重新计算，不能永久缓存为授权结论。
- `model` 是上游 endpoint 接受的字符串，允许连字符、斜杠、版本号和供应商自定义命名，但禁止控制字符和超长值。
- `capabilities` 是声明/探测结果，不应默认把未知能力显示为“支持”。首期可用 `unknown`，只有明确验证或人工确认后才标为 `supported`。
- `context_size` 和 `output_size` 不应在未知时假装精确；可用 nullable/unknown，runtime 再采用受控默认值并在 UI 告警。
- `default_parameters` 只允许非秘密、可 JSON 序列化且经过 provider/model schema 校验的参数；API key、authorization、cookie、私钥和任意 endpoint 不能放这里。

### 5.4 Runtime 兼容转换

迁移期 model binding 到 AgentScope runtime 的转换可以是：

```json
{
  "type": "openai_chat",
  "credential_id": "<scope-checked credential id>",
  "model": "company-chat-v3",
  "parameters": {}
}
```

转换步骤必须是：

1. 从当前已验证 `WorkspaceContext` 查询 binding；
2. 校验 binding 属于当前 Workspace 且状态为 active；
3. 解析 binding 的内部 credential reference；绝不接受前端传入的 raw credential ID 覆盖服务端绑定；
4. 校验 binding 引用的 credential 对当前 actor 可用；
5. 通过 runtime-only resolver 解密 credential；
6. 使用 binding 的 model、能力默认值和参数构造 AgentScope model；
7. 失败时返回稳定的 F32 错误码，不把 provider 原始响应或 secret 写入日志。

## 6. 密钥安全、SSRF 与审计

### 6.1 密钥生命周期

- 传输：仅 HTTPS；secret 不写 URL、query、浏览器 localStorage、TanStack Query data、SSE event、错误 detail 或普通审计字段。
- 写入：沿用稳定的部署级 Fernet key，但建议为 F32 增加密文版本、key id、created_at 和 secret fingerprint（fingerprint 只用于判断是否替换，不可逆）。
- 读取：普通列表/详情只返回 `has_secret`、`secret_last_rotated_at`、masked host 和 provider metadata；只有 runtime resolver 在调用链内短暂解密。
- 轮换：`PATCH` 替换 secret 应是幂等的；旧 secret 不可回显；替换成功后旧运行实例是否继续使用旧 secret 必须有明确语义，建议新请求只用新值。
- 删除：删除 credential 前检查 model binding/session/agent/knowledge base 引用；默认返回 `409 CREDENTIAL_IN_USE`，提供显式迁移/解除引用流程。
- 备份：Redis 密文、Fernet key、应用日志、审计库和备份介质分别控制权限；仅有 Redis 密文并不等于密钥安全。

### 6.2 OpenAI-compatible endpoint 安全

`base_url` 是 SSRF 和数据外送边界，不能只作为字符串存储：

- 默认允许公网 HTTPS provider 域名；私网、环回、链路本地、多播、云 metadata 地址按解析后的 IP 拒绝，除非部署管理员显式 allowlist。
- 连接测试和真实调用都应用相同的 URL 校验、DNS rebinding 防护、超时、重定向限制和响应大小限制。
- 不允许用户通过 `base_url` 覆盖到 Synapse 内部管理端点、Redis、数据库、文件服务或云 metadata。
- 记录 provider host、端口、TLS 结果、耗时、HTTP 状态类别和稳定错误码；不记录 authorization header、完整 request body 或完整 provider response。
- 连接测试必须区分“配置验证失败”“网络不可达”“认证失败”“模型不存在”“能力不兼容”“上游限流”和“未知 provider 错误”。

### 6.3 审计事件

建议至少记录以下事件：

```text
credential.created
credential.metadata_updated
credential.secret_rotated
credential.deleted
model_binding.created
model_binding.updated
model_binding.enabled
model_binding.disabled
model_binding.connection_tested
model_binding.deleted_or_archived
model_binding.reference_blocked
```

每条事件带 `request_id`、actor、tenant、Workspace、resource ID、provider type、model ID（非秘密）、结果类别、稳定 error code、时间和 membership version。禁止记录 secret、完整 endpoint query、原始 prompt/completion 和任意 provider authorization 数据。

## 7. 迁移与兼容

### 7.1 旧凭据

当前无作用域 legacy credential 会被新适配器隐藏并拒绝使用；不要在无人工确认的情况下猜测其 tenant、Workspace 或共享范围。[`docs/agentscope-model-credential-isolation.md`](../agentscope-model-credential-isolation.md)

建议迁移策略：

1. 先扫描旧 record 的 owner、type、name 和是否存在密文版本，只输出计数和非秘密诊断；
2. 对有明确 owner、tenant、Workspace 映射的记录，生成迁移候选，不自动赋予 Workspace 共享；
3. 由账号本人或明确管理员重新确认/轮换 secret；
4. 新 record 使用 F32 credential schema version；旧 record 保持只读隐藏或进入隔离区；
5. 迁移失败不影响新 API；记录稳定原因，不能把旧明文重新写回 Redis。

### 7.2 旧 model config

当前 AgentScope 的 `ChatModelConfig`、`TTSModelConfig` 和 `EmbeddingModelConfig` 都以 `type`、`credential_id`、`model` 和 `parameters` 为中心；session create/update 会校验 credential ID 属于当前作用域。[`apps/api/.venv/Lib/site-packages/agentscope/app/storage/_model/_session.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/storage/_model/_session.py)、[`apps/api/app/integrations/agentscope_session_scope.py`](../../apps/api/app/integrations/agentscope_session_scope.py)

兼容规则：

- 读取旧配置时保留原字段，后台解析为 transient model binding view，不在首次读取时静默改写数据。
- 新写入优先保存 `model_binding_id`；在 AgentScope 兼容窗口同时生成旧格式的 `type`/`credential_id`/`model`/`parameters`。
- 如果旧配置的 credential 或 model binding 不可用，详情页显示“配置已失效”，不自动换到其他 provider。
- 删除/归档 model binding 前查询旧格式引用和新格式引用；有引用时返回 `MODEL_IN_USE`。
- 兼容窗口结束后再迁移 session/agent/schedule/SOP/channel 等所有 model config 消费方；不能只迁聊天页面。

### 7.3 回滚

回滚必须可独立于 provider SDK 版本：

- 保留旧 runtime config 转换器；
- F32 新表/新 key 使用可区分前缀和 schema version；
- 新 API 停写后仍可从旧 session config 解析已配置模型；
- 不在回滚中删除仍被旧 session 引用的 credential；
- 回滚报告要区分“页面回滚”“binding 数据回滚”“secret 回滚”和“provider 连接回滚”。

## 8. 验收矩阵

| 领域 | 必须验证 | 通过证据 | 当前状态 |
| --- | --- | --- | --- |
| Provider 目录 | 仅返回已注册能力；未知 provider 稳定 404/422；不泄露 credential | API 测试 + OpenAPI/schema snapshot | 未实现 |
| 凭据创建 | secret 不回显、不进日志；无加密 key 安全失败；重复提交语义明确 | API/Redis 原始 record/log 检查 | F21b2b5 已覆盖基础隔离与加密；F32 UX 未实现 |
| 凭据隔离 | 两 tenant、两 Workspace、跨 actor 的 list/get/update/delete/test 均拒绝越权 | 真实 gateway + Redis/临时 DB | F21b2b5 基础通过；共享模型策略未实现 |
| Model binding | Workspace 归属、角色权限、启停、删除引用冲突、分页/筛选/稳定排序 | service/API 测试 | 未实现 |
| 自定义模型 | 任意合法 model ID 可保存；非法控制字符/超长值拒绝；模型不在静态目录仍可运行 | API + fake OpenAI-compatible server | 未实现 |
| endpoint 安全 | SSRF/private IP/redirect/timeout/TLS/allowlist | 网络隔离测试 | 未实现 |
| 真实调用 | chat streaming、错误分类、工具调用/structured output 能力按声明验证 | 真实或明确标记的 provider 环境 | 当前文档明确未验 |
| Embedding | binding、维度、知识库索引引用和跨空间隔离 | fake/真实 embedding endpoint | 未实现 |
| TTS | binding、voice 参数、能力目录和 secret 保护 | fake/真实 TTS endpoint | 未实现 |
| Agent/session 引用 | 当前 binding/credential 校验；切换 Workspace 不串缓存；删除前引用检查 | API + 浏览器 + delayed response | 未实现 |
| 前端 UX | loading/empty/error/permission/archived/partial failure/mobile/a11y/i18n | Chromium 窄屏/键盘/双语证据 | 未实现 |
| 审计 | 创建、轮换、测试、启停、删除事件完整且无 secret | 审计存储和日志扫描 | 未实现 |
| 迁移 | legacy 无作用域记录不可见；明确映射记录可人工迁移；失败可重试/回滚 | dry-run 报告 + migration test | 旧数据迁移待验 |
| 运行条件 | API/worker 共用稳定加密 key；Redis、provider、网络和多副本行为明确 | 部署/重启/worker 验证 | provider 与多副本待验 |

## 9. 按域拆分的实施顺序

每个域先完成 UX/API/归属审查，再实现，再由独立验收任务验证；不把“页面能打开”当作“真实模型已可用”。

### F32-A：契约与安全基线

- 固定 provider、credential、model binding、model reference 的术语和归属。
- 锁定错误码、secret 投影、审计字段、scope 校验和 Query key 规则。
- 为 OpenAI-compatible endpoint 写 SSRF、redirect、timeout、TLS 和 allowlist 规则。
- 输出迁移/回滚设计，不改现有产品代码作为本方案范围。

### F32-B：Provider registry 与 credential service

- 将 AgentScope 动态 schema 包装成 Synapse provider registry 只读服务。
- 建立 credential service/router，保留当前加密 adapter 的 runtime-only 解密约束。
- 首期只支持现有已注册 provider；OpenAI-compatible 复用 `openai_credential`，不新增任意 Python provider 上传。
- 完成 secret rotate、脱敏详情、引用检查、审计和稳定错误码。

### F32-C：Model binding service

- 建立 Workspace model binding 的持久化模型、迁移、索引和复合归属约束。
- 支持 chat 首期自定义 model ID；embedding/TTS 复用同一 binding 形状但按能力单独验收。
- 把 ModelCard 静态能力和自定义能力声明统一为只读 projection，区分 `declared`、`verified`、`unknown`。
- 提供引用查询、启停、归档和删除冲突语义。

### F32-D：Runtime adapter 与兼容层

- 把 binding 解析成 AgentScope 旧 `type`/`credential_id`/`model`/`parameters`，所有步骤都经过当前 scope。
- 不让 provider API 直接从普通 storage 取 credential；所有 runtime 读取经过 resolver。
- 统一 provider 错误、超时、限流和能力不匹配错误；日志只保留脱敏摘要。
- 覆盖 agent、session、schedule、SOP、channel 和未来知识库等所有 model config 消费方。

### F32-E：Workspace 模型与凭据 UX

- 增加 Workspace 模型列表、模型编辑/创建、凭据列表/轮换、连接测试和引用提示。
- 在智能体/会话/知识库/TTS 入口使用 model binding picker，不要求用户手填 credential ID。
- 明确个人私有凭据与 Workspace 可见模型的区别；没有安全共享能力时不显示“共享凭据”假象。
- 覆盖权限、归档、撤权、切换 Workspace、晚到响应、窄屏、键盘和中英文。

### F32-F：迁移、真实依赖与独立验收

- 先做 legacy dry-run，再做明确映射的人工迁移/secret rotation。
- 用本地 fake OpenAI-compatible server 验证协议、错误和自定义 model ID；标明这是模拟，不替代真实 provider 验收。
- 有真实凭据时再验真实 chat/embedding/TTS；缺少真实 provider 时保持“待实际验收”。
- 验证重启、稳定 Fernet key、独立 worker、Redis 备份权限和多副本行为。

## 10. 证据文件、关键结论与未决问题

### 证据文件

- [`AGENTS.md`](../../AGENTS.md)：只按指定范围工作；租户/Workspace/个人凭据隔离；验证和台账边界。
- [`docs/integration-plan.md`](../integration-plan.md)：F32 在 AgentScope 迁移范围内；AI 模型/凭据入口来自 AgentScope；真实凭据是验收前置条件。
- [`docs/development-status.md`](../development-status.md)：F32 尚未开始；F21b2b5 仅完成模型凭据资源隔离的基础验收，真实模型调用和旧数据迁移待验。
- [`docs/tenancy-contract.md`](../tenancy-contract.md)：全局账号、租户、Workspace、个人私有资源和服务端作用域的权威规则。
- [`docs/agentscope-tenant-context.md`](../agentscope-tenant-context.md)：gateway 认证和 Workspace 上下文边界；gateway 本身不等于资源隔离。
- [`docs/agentscope-model-credential-isolation.md`](../agentscope-model-credential-isolation.md)：当前 credential ID/owner key、Fernet 加密、runtime resolver 和已知限制。
- [`docs/agentscope-runtime.md`](../agentscope-runtime.md)：AgentScope commit、运行配置、生命周期和 provider 未配置现状。
- [`docs/verification/F21b2b5-model-credential-isolation.md`](../verification/F21b2b5-model-credential-isolation.md)：凭据隔离、密文、脱敏和 scope 验收证据。
- [`apps/api/app/integrations/agentscope.py`](../../apps/api/app/integrations/agentscope.py)：子应用挂载、credential runtime resolver 和 Workspace storage。
- [`apps/api/app/integrations/agentscope_session_scope.py`](../../apps/api/app/integrations/agentscope_session_scope.py)：credential scope、加密、列表投影和 model config 校验。
- [`apps/api/.venv/Lib/site-packages/agentscope/app/_router/_credential.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_router/_credential.py)：底层凭据 CRUD 与 schema API。
- [`apps/api/.venv/Lib/site-packages/agentscope/app/_router/_model.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_router/_model.py)：静态 provider model catalog API。
- [`apps/api/.venv/Lib/site-packages/agentscope/credential/_openai.py`](../../apps/api/.venv/Lib/site-packages/agentscope/credential/_openai.py)：OpenAI credential 字段和 `base_url`。
- [`apps/api/.venv/Lib/site-packages/agentscope/app/storage/_model/_session.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/storage/_model/_session.py)：chat/embedding/TTS config 结构。
- [`apps/api/.venv/Lib/site-packages/agentscope/app/_service/_model.py`](../../apps/api/.venv/Lib/site-packages/agentscope/app/_service/_model.py)：credential resolver、任意 model string 和无 ModelCard 默认路径。
- [`apps/web/src/features/workspaces/agents-page.tsx`](../../apps/web/src/features/workspaces/agents-page.tsx)：当前智能体 UX 及“模型凭据另页管理”文字。
- [`apps/web/src/features/workspaces/pages.tsx`](../../apps/web/src/features/workspaces/pages.tsx)：Workspace 资源与设置入口。
- [`apps/web/src/features/settings/index.tsx`](../../apps/web/src/features/settings/index.tsx)：当前全局 Settings 页面集合。
- `references/agentscope`：仓库中未发现该目录；本方案改以实际安装在 `apps/api/.venv` 的 AgentScope 源码和仓库已有适配文档为证据。

### 关键结论

1. 现有底层能力已经能保存和运行 OpenAI-compatible 自定义 model string，但产品没有把它建模成可管理、可审计、可归属的资源。
2. 当前 credential 是 actor-private，而租户契约中的 Workspace 共享模型资源需要新增 binding 和显式授权，不能把当前 credential owner key 误认为 Workspace 共享。
3. 静态 ModelCard 目录与用户自定义模型是两种不同来源，必须在 API/UX 上明确区分“内置目录”“人工声明”“连接已验证”。
4. F32 的首要风险不是再做一个表单，而是 secret 生命周期、SSRF、引用删除、runtime resolver、迁移和真实 provider 验收。
5. F21b2b5 的通过结论不能扩大解释为真实 provider 可用；在真实凭据、网络、模型请求和错误语义验收前，模型调用仍是待实际验收。

### 未决问题

- Workspace 共享模型是否允许多个成员使用同一 provider credential？若允许，共享授权记录和 runtime actor/credential owner 语义如何设计；若不允许，Workspace 模型页面如何避免“看得到但用不了”的误导？
- 首期是否只支持 `openai_chat` 的 OpenAI-compatible Chat Completions，还是同时承诺 Responses API、工具调用、多模态、embedding 和 TTS？
- `base_url` 的公网/私网 allowlist 由谁配置，是否需要部署级 provider registry 或管理员审批？
- 自定义模型能力由用户声明、连接测试推断，还是由平台管理员维护；未知能力是否允许进入 agent picker？
- 删除 credential 时，对已存在的 session/agent 是阻止、自动停用、保留不可运行配置，还是要求先迁移？
- F32 新 binding 是否需要 SQL 持久化，还是暂时沿用 Redis；若用 SQL，workspace/tenant/credential 的复合外键和 Redis runtime cache 如何保持一致？
- 旧无作用域凭据的 owner 到 tenant/Workspace 是否有可靠映射；没有映射的记录保留多久、如何由用户重新认领？
- 连接测试是否产生真实费用、上游审计记录或敏感 prompt；产品文案和审计留存周期如何定义？
- AgentScope commit 是否继续沿用当前版本，还是在 F32 前锁定带 provider/model API 改动的新版本；升级需要重新跑哪些隔离验收？

# F32 模型提供商与自定义模型管理验收计划

状态：**独立验收计划，待 F32 产品实现后执行**

本文只定义验收范围、证据要求和未决问题，不代表 F32 已经实现。本文不要求真实 provider 密钥，也不把 AgentScope 当前的静态 ModelCard 目录或原始 credential API 误认为 Synapse 的完整 F32 产品能力。

## 1. 验收目标

F32 验收需要证明以下完整链路成立：

```text
Provider registry
  -> actor-private credential
  -> Workspace model binding
  -> agent/session reference
  -> controlled runtime resolution
  -> optional connection test / real model call
  -> audit and safe availability projection
```

必须同时验证：

- provider 能力目录是服务端注册表的只读投影，未知 provider 不能由请求动态加载 Python class；
- credential 的 secret 只写不读，普通列表、详情、异常、日志、审计和前端缓存都不泄露；
- model binding 是 Workspace 级元数据，但其 credential 仍遵守创建者和当前 actor 的授权边界；
- 任意合法的自定义 model ID 可以保存和转换为 AgentScope runtime 配置，不依赖静态 YAML ModelCard；
- `base_url` 的校验、DNS 解析、重定向、超时和 allowlist 规则不能被连接测试或真实调用绕过；
- `available`、`owner_only`、`unavailable` 等状态按当前 `WorkspaceContext` 重新计算，不能把历史投影当作永久授权；
- agent/session 只引用稳定的 model binding ID，不能让前端提交的 raw credential ID 覆盖服务端绑定；
- API/UI 的错误、空态、权限、切换 Workspace 和删除引用行为可解释且不串数据。

## 2. 范围与非范围

### 2.1 本次范围

- provider registry 查询和能力投影；
- credential 创建、脱敏列表/详情、元数据更新、secret rotation、删除和引用检查；
- Workspace model binding 的创建、查询、更新、启停、归档/删除；
- chat 自定义 model ID；
- OpenAI-compatible `base_url` 校验和受控连接测试；
- credential 可见性、model binding 共享投影和跨 tenant/Workspace/actor 隔离；
- model binding 到 AgentScope 旧格式的安全转换；
- agent/session 使用 model binding 的校验；
- 审计、日志、Redis 密文和前端缓存中的 secret 防泄漏；
- Web 页面与 typed API 的 loading、empty、error、permission、stale response 和窄屏可用性。

### 2.2 不在首期通过标准中的能力

除非另有明确实现和测试证据，以下不能因“页面可见”而标记通过：

- 自动探测 provider 所有模型；
- 完整 OpenAI Responses API 或每个供应商的专有协议；
- 任意 Python provider class 上传；
- 未实现的跨 Workspace credential 共享；
- 未实现的多模态、tool calling、structured output 或 reasoning 能力；
- embedding/TTS 的完整业务闭环；
- 没有真实 worker/provider 证据的“真实模型调用成功”；
- 不具备 checkpoint 语义的暂停/恢复或异步测试伪造。

## 3. 测试分层与证据规则

每个用例必须在报告中标明证据级别。不同级别不能互相替代。

| 级别 | 证据类型 | 可以证明 | 不能证明 |
| --- | --- | --- | --- |
| A | 受控 fixture、Fake provider、临时 SQLite/Redis、拦截 HTTP client | schema、授权、事务、投影、错误码、加密边界、SSRF 规则和 runtime 转换 | 真实供应商协议兼容、真实计费/限流和真实模型质量 |
| B | 真实 Synapse API、真实 Redis、真实临时数据库、真实浏览器 | 端到端资源链路、Workspace header、前端缓存、日志/审计、重启后的密文读取 | 真实外部模型的 provider 行为，除非确实连接外部服务 |
| C | 明确配置的真实或本地协议兼容 provider、真实最小请求 | endpoint、TLS、鉴权、模型 ID、流式响应和 provider 错误分类 | 其他未配置 provider、生产网络策略和模型质量 |

### 3.1 测试数据隔离

- 每次运行创建唯一的测试后缀、tenant、Workspace、actor、credential name 和 model ID。
- 使用临时 SQLite 数据库和专用 Redis key 前缀；禁止 `FLUSHDB`、`FLUSHALL` 或清空共享 Redis。
- 测试结束通过 fixture finalizer 删除自己创建的 SQL 行、Redis key、fake provider route 和审计记录。
- 所有 sentinel secret 使用不可复用的随机值，例如 `f32-secret-<run-id>`；报告只记录 hash 或存在性，不记录明文。
- 至少准备：
  - `tenant_a / workspace_a1 / actor_a_owner`
  - `tenant_a / workspace_a1 / actor_a_member`
  - `tenant_a / workspace_a2 / actor_a_other_workspace`
  - `tenant_b / workspace_b1 / actor_b`
  - 一个已撤权 actor 和一个被停用 Workspace。

### 3.2 当前既有覆盖的复用边界

`F21b2b5-model-credential-isolation.md` 已覆盖 scoped credential 的基础加密、tenant/Workspace/actor 隔离和 runtime resolver 边界。F32 不应只重复该测试，而要额外证明：

- F32 credential/service 契约与旧 AgentScope credential 路由的兼容边界；
- model binding 不暴露 raw credential ID；
- model binding 删除引用、启停和 availability projection；
- 自定义 model ID 不在静态目录中仍可运行；
- endpoint/SSRF 安全和连接测试错误分类；
- agent/session 只接受服务端解析的 binding；
- 前端共享投影与切换 Workspace 的缓存隔离。

## 4. 验收矩阵

结果列使用：`未执行`、`通过`、`失败`、`阻塞`、`不适用`。测试报告必须为每一行填写证据级别、命令或操作、响应摘要、日志/存储检查和结论。

### 4.1 Provider registry

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-P01 | 查询 provider registry | A/B | 只返回服务端已注册 provider 的非秘密元数据、能力、schema version 和 custom-model 支持标记。 |
| F32-P02 | 查询未知 provider | A/B | 返回稳定的 `PROVIDER_NOT_FOUND` 或明确 404/422；不尝试导入请求指定的 class。 |
| F32-P03 | 修改 provider type、credential type 或能力 | A/B | 普通租户请求不可修改全局注册表；返回 403/405 或 schema 明确标记只读。 |
| F32-P04 | provider schema 动态表单 | A/B | schema 可用于表单校验，但不包含默认 secret、服务端密钥或内部路径；不信任客户端篡改 schema。 |
| F32-P05 | provider 能力不匹配 | A/B | 为 embedding/TTS 创建 chat-only binding 时返回稳定的 `MODEL_CAPABILITY_MISMATCH`。 |

### 4.2 Credential CRUD 与 secret 生命周期

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-C01 | 创建合法 credential | A/B | 返回稳定资源 ID、provider、名称和脱敏 endpoint；不返回 `api_key`、authorization、完整 secret-bearing URL 或密文。 |
| F32-C02 | 创建请求缺少 secret | A/B | 返回稳定校验错误；不创建半可用 credential，不写入 plaintext record。 |
| F32-C03 | 创建请求包含未知字段 | A/B | 按 provider schema 拒绝或明确忽略有审计语义；不能把任意 header、cookie、私钥或 endpoint 写入自由 JSON。 |
| F32-C04 | 列表和详情 | A/B | 只显示 `has_secret`、secret rotation 时间、provider、脱敏 host/path、最近测试状态和引用数量。 |
| F32-C05 | 修改名称/元数据 | A/B | 只更新允许字段；不因未提交 secret 而清空旧 secret；审计记录不含密文。 |
| F32-C06 | secret rotation | A/B/C | 新请求使用新 secret；旧 secret 不回显；rotation 具备明确幂等语义；运行中旧实例语义有文档和测试证据。 |
| F32-C07 | 删除无引用 credential | A/B | 删除成功；后续 list/get/resolve 均不可见或返回稳定 not found；不会残留可解密 runtime record。 |
| F32-C08 | 删除有引用 credential | A/B | 默认返回 `CREDENTIAL_IN_USE`/409，列出当前调用者有权知道的引用摘要；不能静默让 binding 变成其他 credential。 |
| F32-C09 | 未配置或错误 Fernet key | A/B | 返回稳定 `MODEL_CREDENTIAL_ENCRYPTION_*` 受控 503；不回退明文、默认 key 或日志输出 secret。 |
| F32-C10 | Redis/数据库重启后读取 | B | 合法密文仍可按相同部署 key 解析；密钥不写入 Redis、数据库、前端 localStorage 或普通日志。 |

### 4.3 Model binding 与自定义模型

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-M01 | 创建合法 chat binding | A/B | 保存 Workspace、provider、model string、能力声明、显示名和默认参数；返回稳定 binding ID。 |
| F32-M02 | 保存不在静态 ModelCard 目录的 model ID | A/C | 合法自定义 ID 可保存；不要求先出现在 AgentScope YAML 目录；运行转换使用该字符串。 |
| F32-M03 | model ID 控制字符 | A/B | 拒绝换行、NUL、不可见控制字符和首尾不允许的空白；响应不反射危险内容。 |
| F32-M04 | model ID 超长或为空 | A/B | 返回稳定 schema 错误；不截断成另一个可运行模型，不产生重复资源。 |
| F32-M05 | model ID 合法特殊字符 | A/B/C | 连字符、斜杠、点号、冒号和供应商版本号按明确规则接受；不会被路径拼接、SQL 或日志格式破坏。 |
| F32-M06 | default parameters | A/B | 只允许非秘密、可 JSON 序列化且通过 provider/model schema 的参数；拒绝 API key、cookie、authorization、私钥、endpoint 和任意 callable。 |
| F32-M07 | 更新 binding | A/B | 显示名、能力声明、默认参数和允许的 credential 引用按权限更新；Workspace/provider/model 归属不能被 body 覆盖。 |
| F32-M08 | 禁用 binding | A/B | 新 agent/session/runtime 使用被阻止并返回 `MODEL_BINDING_UNAVAILABLE`；历史配置可显示失效原因，不静默换模型。 |
| F32-M09 | 归档/删除无引用 binding | A/B | 归档或删除成功；列表默认不再显示 active；历史审计和可授权引用查询仍有明确语义。 |
| F32-M10 | 归档/删除有引用 binding | A/B | 返回 `MODEL_IN_USE`/409 或执行明确迁移流程；不会删除后让 agent/session 静默回退。 |
| F32-M11 | 稳定分页、筛选和排序 | A/B | `kind`、`status`、`provider`、`q` 筛选只作用当前 Workspace；同一快照分页无重复/丢失，排序稳定。 |

### 4.4 Credential visibility、Workspace sharing 与隔离

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-S01 | credential owner 查看自己的 credential | A/B | owner 可以查看脱敏 metadata、轮换 secret、按权限删除；不能读取旧 secret。 |
| F32-S02 | 同 Workspace 其他成员查看 binding | A/B | 可看到共享 model metadata，但 raw credential ID、actor 编码、密文和 owner secret 不可见。 |
| F32-S03 | 同 Workspace 其他成员执行 binding | A/C | 仅在明确授权且 credential 可用时返回 `available` 并允许运行；否则 `owner_only` 或 `unavailable`，不能伪造 shared UX。 |
| F32-S04 | owner 删除 credential | A/B | 绑定状态重新计算为 `unavailable`；其他成员只能看到非秘密不可用原因，不能推断 owner 账号或 credential ID。 |
| F32-S05 | owner 被移出 Workspace | A/B | 其 credential 不自动变成 Workspace 共享；binding 变为 `owner_only`/`unavailable`，运行被阻止或按已确认策略迁移。 |
| F32-S06 | actor 切换 Workspace | B | list/detail/test/reference 均使用新的 `WorkspaceContext`；旧 Workspace 的 binding、credential 和 query data 不闪现、不串入新列表。 |
| F32-S07 | tenant A 访问 tenant B resource ID | A/B | list 为空或返回统一 not found；get/update/delete/test/reference 不泄露资源存在性或归属。 |
| F32-S08 | workspace A1 访问 workspace A2 | A/B | 统一拒绝；`X-Workspace-ID` 只选择上下文，不授予成员资格。 |
| F32-S09 | revoked/disabled membership | A/B | 撤权、租户停用、Workspace 归档后，下一请求重新校验并拒绝；不依赖旧缓存的 `available=true`。 |
| F32-S10 | 延迟旧响应 | B | 旧 Workspace 的慢响应不能覆盖当前 Workspace 的 TanStack Query cache 或表单状态。 |
| F32-S11 | 跨 actor 猜测 binding/credential ID | A/B | 不可枚举 raw credential ID；binding ID 即使可猜也不能绕过 scope、membership 和 credential availability 校验。 |

### 4.5 Base URL、SSRF 与连接测试

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-N01 | 合法公网 HTTPS endpoint | A/C | 规范化末尾斜杠和已知 `/v1` 规则；连接测试仅访问预期 host/path。 |
| F32-N02 | HTTP endpoint | A/B | 按部署策略拒绝；若开发环境允许 localhost，必须是显式、服务端配置的例外，不由普通租户请求打开。 |
| F32-N03 | loopback/private/link-local/multicast/metadata IP | A/B | DNS 解析后的目标命中禁止网段时拒绝；不能通过域名、IPv6、整数 IP、重定向或 DNS rebinding 绕过。 |
| F32-N04 | 解析到禁止 IP 的域名 | A/B | 连接测试和真实调用均拒绝；日志只记录 host、稳定错误码和分类，不记录 authorization。 |
| F32-N05 | redirect 到禁止地址 | A/B | 不跟随或在每一跳重新校验并拒绝；不把上游响应原文直接返回给用户。 |
| F32-N06 | redirect 到合法地址但改变协议/host | A/B | 按明确 allowlist 和 redirect policy 处理；不得把初始 host 的授权自动转移给任意目标。 |
| F32-N07 | 连接超时、响应超大、连接复用异常 | A/B/C | 返回稳定 timeout/response-limit/provider-network 错误；请求有总超时和响应大小限制。 |
| F32-N08 | provider 认证失败 | A/C | 返回 `PROVIDER_AUTH_FAILED` 等稳定分类；不返回 API key、完整上游 header 或 secret-bearing URL。 |
| F32-N09 | 模型不存在 | A/C | 返回 `MODEL_NOT_FOUND`；不把上游原始响应中的 secret 或不必要内容带回前端。 |
| F32-N10 | 上游限流/服务错误 | A/C | 分类为 rate limited/upstream unavailable；重试策略有上限，不因连接测试形成无限重试。 |
| F32-N11 | fake provider 捕获请求 | A/C | 只看到预期 model、必要参数和正确鉴权；测试报告以 hash/存在性描述 secret，不保存请求 body。 |

### 4.6 Runtime 转换与 agent/session 引用

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-R01 | 以 binding ID 创建 agent/session | A/B | 服务端从当前 context 查询 binding，再解析内部 credential；前端不需要提交 raw credential ID。 |
| F32-R02 | body 同时提交合法 binding 与 foreign credential ID | A/B | raw credential 被忽略或拒绝；不能覆盖 binding 内部引用。 |
| F32-R03 | binding 属于其他 Workspace | A/B | 返回 `MODEL_BINDING_NOT_FOUND`/403；不尝试 resolver 或 provider 调用。 |
| F32-R04 | binding active 但 credential owner 不可用 | A/B/C | runtime 阻止执行并返回 `MODEL_CREDENTIAL_UNAVAILABLE`；不静默改用默认模型。 |
| F32-R05 | binding model 不在静态目录 | A/C | AgentScope 配置中的 `model` 使用保存的自定义字符串；fake provider 能收到该字符串。 |
| F32-R06 | legacy `type/credential_id/model/parameters` 读取 | A/B | 兼容读取按当前 scope 校验；不把 legacy raw credential ID 直接投影给前端。 |
| F32-R07 | 新写入兼容格式 | A/B | 如迁移窗口仍需旧字段，服务端生成的 `type`、scoped credential ID、model 和 parameters 与 binding 一致。 |
| F32-R08 | 删除/归档前引用检查 | A/B | 检查 agent、session、knowledge base、SOP、schedule/channel 等已纳入范围的消费者；有引用返回稳定冲突。 |
| F32-R09 | provider call 失败后的状态 | A/C | 不把一次失败永久写成授权结论；最近测试状态与 availability 的生命周期有明确区别。 |

### 4.7 审计、日志与前端体验

| ID | 场景 | 证据 | 预期结果 |
| --- | --- | --- | --- |
| F32-A01 | credential created/metadata updated/secret rotated/deleted | A/B | 审计含 request ID、actor、tenant、Workspace、resource、provider、结果类别和稳定 code；不含 secret。 |
| F32-A02 | binding created/updated/enabled/disabled/deleted | A/B | 审计记录资源变化和权限上下文；不记录 raw credential ID、完整 endpoint 或 prompt/completion。 |
| F32-A03 | connection tested | A/C | 审计记录 host 摘要、耗时、状态类别和稳定 code；不记录 header、完整 URL query 或完整 provider response。 |
| F32-A04 | 日志和异常扫描 | A/B | 使用 sentinel secret、fake token、cookie、private key 和 endpoint 检查日志、trace、审计、SSE、HTTP error；均不得出现。 |
| F32-A05 | 模型列表页面 | B | 显示 provider、model、kind、状态、来源、引用数量和 availability；加载、空、错误、无权限、归档态明确。 |
| F32-A06 | credential 页面 | B | 显示脱敏 host、最近测试状态和 rotation 时间；secret 输入只写入 mutation，不进入 URL、localStorage 或 query cache。 |
| F32-A07 | 创建/编辑表单 | B | provider schema 驱动校验；model ID、endpoint、能力和默认参数错误在提交前后均可解释。 |
| F32-A08 | connection test UI | B/C | 明确可能产生费用、日志和限流；显示可恢复错误分类，防止重复点击导致并发测试失控。 |
| F32-A09 | 键盘、窄屏和双语 | B | 表格、弹窗、错误和状态徽标可键盘操作；窄屏不隐藏关键不可用原因；中英文文案不泄露 secret。 |
| F32-A10 | 快速切换 Workspace | B | query key 包含 tenant/workspace/actor/membership context；旧请求取消或丢弃，页面不短暂展示上一空间资源。 |

## 5. Exact API 检查

以下路径以 F32 方案建议契约为准。若实现采用不同路径，验收报告必须给出等价映射；不得用 AgentScope 原始的 `/credential/` 和 `/model/` 路由替代未实现的 Synapse 业务契约。

### 5.1 Provider

```text
GET /api/v1/ai/providers
GET /api/v1/ai/providers/{provider_type}/schema
```

检查：

1. 携带有效 JWT 和当前 `X-Workspace-ID`，返回 provider 非秘密投影。
2. 缺少认证返回 401；非 Workspace 成员返回 403 或统一 not found。
3. `provider_type=unknown` 不改变服务端注册表。
4. 响应不包含 API key、Fernet key、Python module path、内部 Redis key 或服务端环境变量。

### 5.2 Credential

```text
GET    /api/v1/ai/credentials
POST   /api/v1/ai/credentials
PATCH  /api/v1/ai/credentials/{credential_id}
DELETE /api/v1/ai/credentials/{credential_id}
```

最小创建请求示例：

```json
{
  "provider_type": "openai_chat",
  "name": "F32 fake gateway",
  "api_key": "f32-secret-<run-id>",
  "base_url": "https://provider.example.test/v1",
  "organization": null
}
```

必须检查：

- `POST` 响应及所有后续 `GET` 不含 `api_key`；
- `PATCH` 未提交 secret 时不清空旧值，提交新值时不回显旧值或新值；
- 抓取 API access log、应用 log、trace、审计和浏览器 network/Storage 后搜索 sentinel secret；
- 自己的 resource ID 成功，其他 tenant/Workspace/actor 的 ID 统一拒绝；
- 删除有引用资源时断言稳定 409 code 和无 secret 的引用摘要；
- 以错误 Fernet key、缺少 Fernet key 和不可解密 record 分别检查受控错误。

### 5.3 Model binding

```text
GET    /api/v1/ai/models?kind=chat&status=active&provider=openai_chat&q=company
POST   /api/v1/ai/models
PATCH  /api/v1/ai/models/{model_id}
POST   /api/v1/ai/models/{model_id}/test
DELETE /api/v1/ai/models/{model_id}
GET    /api/v1/ai/models/{model_id}/references
```

最小自定义模型请求示例：

```json
{
  "display_name": "F32 fake company chat",
  "provider_type": "openai_chat",
  "credential_id": "<only-if-legacy-compatible-input-is-required>",
  "model": "company-chat-v3/2026-10",
  "kind": "chat",
  "capabilities": {
    "input_types": ["text/plain"],
    "output_types": ["text/plain"],
    "context_size": null,
    "output_size": null,
    "tool_calling": "unknown",
    "structured_output": "unknown",
    "streaming": "required"
  },
  "default_parameters": {}
}
```

如果实现已采用 `credential_ref` 或仅允许服务端绑定 credential，测试应确认前端不能利用 body 传入的 raw ID 覆盖服务端关联。成功的共享读取投影至少检查：

```json
{
  "model_id": "mdl_...",
  "workspace_id": "123",
  "tenant_id": "45",
  "display_name": "F32 fake company chat",
  "kind": "chat",
  "provider_type": "openai_chat",
  "credential_status": "available",
  "credential_provider": "openai_credential",
  "model": "company-chat-v3/2026-10",
  "status": "active",
  "capabilities": {},
  "default_parameters": {}
}
```

断言：

- 共享投影不含 raw `credential_id`、actor ID 编码、密文、API key、authorization、完整 URL 或 provider 原始响应；
- `credential_status` 由当前请求的 context 重新计算；
- `model` 保留自定义字符串，不因静态 ModelCard 不存在而改写、清空或替换；
- `default_parameters` 不含秘密或任意 endpoint；
- 删除/归档有引用时先调用 references 或返回稳定 `MODEL_IN_USE`；
- `POST /test` 只能使用服务端绑定的 credential 和经过同样 SSRF 校验的 endpoint。

### 5.4 Agent/session 引用

对现有 agent/session API 的每一个接收模型配置的入口重复以下检查：

1. 仅提交 `model_binding_id` 时可解析。
2. 同时提交 `model_binding_id` 和 foreign `credential_id` 时，foreign ID 不生效。
3. binding 被禁用、credential 被删除、owner 被撤权或 Workspace 被归档时，创建/更新/运行均得到稳定错误。
4. 切换 `X-Workspace-ID` 后不能复用上一 Workspace 的 Query cache 或 server-side context。
5. 兼容旧 `type/credential_id/model/parameters` 时，服务端按当前 actor/tenant/Workspace 重新校验。

## 6. SSRF 与 Fake Provider 检查

### 6.1 Fake provider 的职责

Fake provider 是本地或测试网络中的协议兼容服务，只用于证明：

- 目标 URL 是否经过校验；
- 请求是否发送到预期 host/path；
- model 字符串、必要参数和鉴权是否正确；
- streaming、认证失败、模型不存在、限流和 5xx 的错误分类；
- secret 是否只进入 provider 请求，不进入应用响应和日志。

Fake provider 不能证明真实供应商的模型质量、计费、区域限制、内容策略或完整协议兼容。

### 6.2 Fake provider routes

至少准备以下可控响应：

```text
POST /v1/chat/completions -> 200 non-streaming
POST /v1/chat/completions -> 200 streaming SSE
POST /v1/chat/completions -> 401
POST /v1/chat/completions -> 404 model-not-found
POST /v1/chat/completions -> 429
POST /v1/chat/completions -> 500
POST /v1/chat/completions -> delayed timeout
POST /v1/chat/completions -> oversized response
GET  /redirect-to-private -> redirect to a blocked address
```

每个 route 把收到的 `model`、请求头存在性、body hash 和时间写入测试内存，不把 API key 写到报告。测试结束时检查：

- 认证 header 只出现在 fake provider 的受控请求中；
- Synapse response、log、audit、trace、SSE 和 browser storage 均不含 sentinel；
- blocked target 没收到请求；
- redirect 每一跳都重新执行策略；
- timeout/size limit 释放连接和任务，不留下可重复执行的后台请求。

### 6.3 真实 provider 调用的准入条件

只有下列条件全部满足，才执行 C 级真实 provider 测试：

- 使用专门的测试账号、低权限 key、低成本模型和可撤销 endpoint；
- 用户明确知道请求可能产生费用、日志和限流；
- 生产密钥不进入本地测试、CI artifact、截图、日志或验收文档；
- endpoint 通过同一 SSRF、TLS、redirect 和 timeout 规则；
- 能在 provider 侧确认测试请求已结束并撤销测试 key；
- 报告只记录 provider 类型、模型 ID、错误类别和耗时，不记录 prompt、completion 或 secret。

真实调用至少覆盖：

- 自定义 model ID 的最小 chat；
- streaming（若声明 `streaming=supported`）；
- provider 认证失败；
- 模型不存在；
- 超时或限流；
- 若产品声称支持，tool calling/structured output 必须分别有能力声明和真实证据，否则保持 `unknown`。

## 7. 安全与隐私通过标准

以下任一项失败，F32 安全验收失败：

- API key、Fernet key、完整 authorization header、cookie、私钥或 secret-bearing URL 出现在响应、日志、审计、SSE、trace、前端 localStorage、sessionStorage、TanStack Query data、URL query 或错误 detail；
- 同 Workspace 成员通过 model binding 投影得到 raw credential ID、actor/tenant/workspace 编码或可枚举的私有资源标识；
- 请求体传入 foreign credential ID 可以改变服务端 runtime 解析结果；
- `X-Workspace-ID` 可以越过 membership、tenant、Workspace 状态或 actor scope；
- DNS rebinding、私网地址、metadata 地址、IPv6/整数 IP 或重定向可以绕过 endpoint policy；
- 删除/禁用 credential 或 binding 后，旧的 `available` 投影仍被当作授权决定；
- provider 上游原始响应或 prompt/completion 被无控制地转发或写入审计；
- 错误中暴露其他 tenant/Workspace/resource 是否存在；
- secret rotation 后旧 secret 仍被新请求使用，且没有明确可接受的运行实例语义；
- 旧未作用域 credential 被自动猜测归属、自动变成共享资源或重新写回明文。

## 8. UI 验收操作清单

使用 Chromium，至少覆盖桌面宽度和窄屏宽度；使用两个浏览器上下文或清理 cookie 模拟不同 actor。

### 8.1 模型页面

1. 进入 Workspace > 模型，确认列表带当前 Workspace 的 `X-Workspace-ID`。
2. 验证加载 skeleton、无数据空态、接口 401/403/500、归档 Workspace 和 provider 部分失败状态。
3. 创建 `company-chat-v3/2026-10`，确认它能被选择，即使它不在静态 ModelCard 列表。
4. 验证状态 `available`、`owner_only`、`unavailable` 的文案、颜色和原因，不显示 raw credential ID。
5. 停用/归档模型后刷新和重新进入页面，确认不会自动替换为另一个模型。
6. 有引用时删除，确认 UI 展示稳定冲突原因和引用摘要；无权限的引用不被泄露。
7. 切换 Workspace，使用慢响应 fixture 确认旧模型列表不会闪回。

### 8.2 凭据页面

1. 创建 credential，确认 secret 输入框不会出现在 URL、React Query cache、localStorage 或浏览器历史。
2. 刷新页面后 secret 输入框为空，UI 只显示 `已配置`、rotation 时间和脱敏 host。
3. 修改名称不影响 secret；轮换 secret 后旧值不能回显。
4. 连接测试显示“可能产生费用/日志/限流”的提示，并区分配置错误、网络错误、认证失败、模型不存在、限流和上游错误。
5. owner 删除或被撤权后，其他 actor 的 model binding 变为不可用，不显示 owner 身份或私有 credential 详情。

### 8.3 Agent/session 选择器

1. 只展示当前 Workspace 可用的 active binding。
2. `owner_only` 和 `unavailable` 的 binding 可按产品决定显示或隐藏，但不能被提交成功运行。
3. 删除/禁用已被 agent/session 引用的 binding 时，UI 必须提示引用检查和迁移动作。
4. 旧配置读取到失效 binding 时显示明确“配置已失效”，不能静默切换默认模型。
5. 页面在窄屏、键盘 Tab、Enter、Escape 和屏幕阅读器标签下仍可完成创建、测试、取消和错误恢复。

## 9. 执行命令与报告模板

实现后，优先新增独立测试文件，例如：

```text
apps/api/tests/verification/test_f32_model_provider_custom_model.py
apps/web/tests/verification/f32-model-provider-custom-model.spec.ts
```

Windows PowerShell 示例：

```powershell
Set-Location apps/api
python -m pytest tests/verification/test_f32_model_provider_custom_model.py -q --tb=short

Set-Location ../web
pnpm exec playwright test tests/verification/f32-model-provider-custom-model.spec.ts
pnpm build
pnpm exec eslint .
```

如果测试文件尚未实现，应运行 `python -m pytest --collect-only` 或直接标记为“未执行”，不能把空测试、只测 schema 的测试或静态页面截图当作通过。

每次报告至少包含：

```text
执行日期：
代码 commit：
数据库/Redis fixture：
证据级别：A / B / C
真实 provider：否 / 是（provider、模型、测试 key 生命周期）
执行命令：
通过用例：
失败用例：
阻塞用例：
secret/log 扫描结果：
浏览器 viewport：
截图或 artifact：
已知未覆盖：
```

## 10. 计划缺口与必须先定的决策

以下问题在实现前必须形成可引用的 ADR、契约或测试 fixture；否则相应验收只能标记为阻塞。

1. **最终路径与 schema**：方案给出建议路径，但尚未锁定实际 URL、分页字段、错误响应格式和 OpenAPI schema。
2. **共享执行语义**：Workspace 共享的是 model metadata 还是可执行能力？如果 credential 仍是 owner-private，其他成员何时允许 `available`？
3. **binding owner 与权限**：创建者离开 Workspace、被撤权、账号停用或角色变化后，binding 如何迁移、停用或由管理员接管？
4. **credential 删除策略**：有引用时只阻止删除，还是允许显式解除/迁移？历史 session 是否继续显示旧 metadata？
5. **availability 生命周期**：`available` 与最近连接测试成功、credential 存在、当前 actor 有权执行之间的关系是什么？测试失败是否自动禁用？
6. **base_url policy**：生产和开发是否允许 localhost/HTTP？allowlist 由部署管理员配置还是 tenant 管理员配置？DNS 解析和代理的信任边界是什么？
7. **redirect policy**：是否完全禁止重定向，还是允许同 host/同 scheme 的有限跳转？每一跳是否强制重新校验？
8. **secret rotation 语义**：已创建的 agent/session run 使用旧值还是新值？后台任务和长流式请求何时切换？
9. **自定义能力声明**：`unknown`、`declared`、`verified` 的数据结构和 UI 文案是否锁定？未知 context/output size 的 runtime 默认值是什么？
10. **测试请求语义**：连接测试发送什么最小 payload、是否计费、是否允许真实 completion、如何取消、超时和重试？
11. **provider 错误映射**：上游 401/403/404/408/409/429/5xx、网络错误、TLS 错误分别对应哪些稳定 F32 code？
12. **embedding/TTS 范围**：首期只验 chat 还是同时验 embedding/TTS？知识库维度不匹配和 TTS voice 能力如何阻止错误配置？
13. **引用范围**：删除 binding 前必须扫描哪些消费者：agent、session、knowledge base、SOP、schedule、channel、team run 以及未来资源？
14. **legacy 迁移**：旧 AgentScope credential/model config 的读取、隐藏、人工迁移、回滚和清理窗口由谁执行？
15. **审计存储与保留期**：审计事件存储在哪里、哪些管理员可读、保留多久、删除/导出规则是什么？
16. **多副本运行**：API、worker、SSE 和后台 runtime 是否共享相同 Fernet key、provider policy、DNS resolver 和 capability registry 版本？
17. **前端缓存边界**：Query key 是否必须包含 actor、tenant、Workspace 和 membership version？登出、切换 Workspace 和权限变化时如何清理？
18. **真实 provider 资格**：CI 是否只运行 fake provider？真实 provider 测试由谁批准、多久轮换测试 key、如何防止费用失控？

## 11. 通过门槛

F32 不能以“页面能打开”或“POST 返回 201”作为完成标准。至少满足：

- F32-P、F32-C、F32-M、F32-S、F32-N、F32-R 和 F32-A 的必测用例全部通过，或有明确批准的阻塞/不适用说明；
- A/B 级安全、scope、secret、projection、引用和 UI 用例全部通过；
- C 级真实 provider 用例要么通过，要么明确记录为环境阻塞，并保留 fake provider 的协议证据；
- `git diff --check`、API 测试、API compile、Web build、Web lint 和浏览器验收结果分别记录；
- 报告明确哪些是 fake provider 事实，哪些是真实 provider 事实；
- 没有任何未解释的 secret 泄漏、跨 Workspace 数据、SSRF 请求或静默模型回退；
- 所有计划缺口中影响安全、归属、删除、SSRF 或 runtime 解析的项目已在实现前锁定。

# F32 模型提供商与自定义模型独立验收报告

执行日期：2026-10-13

验收代码状态：当前工作树（未提交并行改动）

验收范围：

- `apps/api/app/models/model_provider.py`
- `apps/api/app/schemas/model_provider.py`
- `apps/api/app/services/model_provider.py`
- `apps/api/app/api/model_provider.py`
- `apps/api/app/database/migrations/versions/0018_model_provider_management.py`
- `apps/api/tests/verification/test_f32_model_provider_management.py`
- `apps/web/src/api/model-providers.ts`
- `apps/web/src/features/workspaces/models-page.tsx`

本次没有修改产品代码。只新增本报告。

## 1. 结论

结论：**F32 不能标记为完成。**

已被受控证据证明的范围是：

- 一个 `openai_chat` provider 的静态 registry；
- actor-private credential 的 Fernet 加密存储和脱敏投影；
- Workspace/tenant/owner 条件下的 credential 查询；
- Workspace model binding 的自定义 model string 保存；
- 同 Workspace 非 owner 看到 `owner_only`，且投影不包含 raw credential ID；
- 被 disabled binding 引用的 credential 仍不能删除；
- 基础 endpoint 私网 IPv4 拒绝；
- migration 从空 SQLite 升级到 `0018`；
- Web 路由、侧边栏入口和生产构建。

尚未实现或未通过的关键闭环：

- F32 资源尚未接入 AgentScope runtime；当前 custom model 只被保存和展示，不能证明真实运行；
- 没有 connection test、provider schema、references API、审计 API；
- model binding 删除没有引用检查；
- `default_parameters` 接受 `api_key` 等秘密字段；
- provider 列表路由没有 `WorkspaceContext`/认证依赖；
- 前端没有 loading/error/empty 的完整状态、credential rotation/delete、connection test、引用冲突处理；
- 没有 fake provider 或真实 provider 连接证据。

推荐 `docs/development-status.md`：

```text
F32 | 模型与凭据管理融合 | 实现进行中；受控 API/service slice 部分通过，F32 整体未通过独立验收
```

## 2. 执行命令与结果

| 命令 | 结果 |
| --- | --- |
| `apps/api/.venv/Scripts/python.exe -m pytest tests/verification/test_f32_model_provider_management.py -q --tb=short` | **通过**：`1 passed in 2.51s` |
| `apps/api/.venv/Scripts/python.exe -m compileall app` | **通过** |
| `apps/api/.venv/Scripts/python.exe -m alembic heads` | **通过**：`0018_model_provider_management (head)` |
| `apps/api/.venv/Scripts/python.exe -m alembic history` | **通过**：`0017 -> 0018` 单链 |
| 临时 SQLite 上 `python -m alembic upgrade head` | **通过**：空库完整升级至 `0018_model_provider_management` |
| `apps/api/.venv/Scripts/python.exe -m alembic check` | **未通过**：当前开发数据库不是最新 head；不是 0018 空库升级失败 |
| `apps/web/pnpm build` | **通过**：`2858 modules transformed`，Vite build 成功 |
| `apps/web/pnpm exec eslint src/api/model-providers.ts src/features/workspaces/models-page.tsx 'src/routes/_authenticated/w/$workspaceId/models.tsx'` | **通过**，退出码 `0` |
| `git diff --check` | **通过**；只有工作区既有换行提示 |
| provider 路由依赖探针 | **发现缺陷**：`/providers` 仅有 `get_service`，没有 `get_workspace_context` |
| Pydantic 独立探针：未知 credential 字段、秘密 default parameter、控制字符 model | **结果**：未知字段拒绝；秘密 default parameter 被接受；控制字符 model 拒绝 |

当前没有执行真实 provider 调用、fake provider、AgentScope runtime run 或登录后的 Chromium 操作。当前浏览器自动化探针超时，因此不能把页面构建结果等同于 UI 独立验收。

## 3. 按验收用例判定

结果含义：

- `通过`：当前实现和本次证据满足该用例；
- `部分通过`：安全/契约的一部分成立，但验收要求的完整能力缺失；
- `失败`：实现与预期直接冲突；
- `阻塞`：需要 runtime、fake provider、登录浏览器或尚未实现的 API 才能判定；
- `未实现`：所需 endpoint/能力不存在。

### 3.1 Provider registry

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-P01 | 失败 | `/providers` 未注入 `get_workspace_context`，缺少认证和 Workspace 成员校验。 |
| F32-P02 | 未实现 | 没有 provider detail/schema 查询 endpoint。 |
| F32-P03 | 部分通过 | 没有 provider mutation endpoint；但未提供明确只读 schema/HTTP 语义。 |
| F32-P04 | 未实现 | 没有动态 provider schema endpoint。 |
| F32-P05 | 未实现 | 仅支持 `chat`/`openai_chat`，没有 capability mismatch 错误契约。 |

### 3.2 Credential CRUD 与 secret 生命周期

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-C01 | 通过 | response DTO 仅返回 `has_secret`、`endpoint_host`，不含 API key/密文；F32 定向测试通过。 |
| F32-C02 | 通过 | Pydantic 必填和非空校验；未发现半可用创建路径。 |
| F32-C03 | 通过 | `CredentialCreate` 使用 `extra="forbid"`；未知字段独立探针被拒绝。 |
| F32-C04 | 部分通过 | 有脱敏 host 和 `has_secret`；缺少 rotation time、最近测试状态、引用数量。 |
| F32-C05 | 部分通过 | metadata patch 不提交 secret 时保留密文；没有审计证据。 |
| F32-C06 | 阻塞 | Fernet rotation 写入存在，但没有 runtime 使用新 secret、旧运行实例语义或真实调用测试。 |
| F32-C07 | 部分通过 | 无 binding 时 service 删除并 flush；没有独立 HTTP/delete 后 resolve 和残留检查。 |
| F32-C08 | 失败 | `CREDENTIAL_IN_USE` 存在，但没有返回调用者可见的引用摘要。 |
| F32-C09 | 失败 | 未配置/错误 key 转成普通 `VALIDATION_ERROR`，不是验收要求的稳定受控 503 分类。 |
| F32-C10 | 未实现 | 本 slice 没有 Redis credential persistence；没有重启后读取证据。 |

### 3.3 Model binding 与自定义模型

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-M01 | 通过 | binding 保存 Workspace/provider/model/display/capabilities/default parameters；定向测试通过。 |
| F32-M02 | 通过 | `company-chat-v3` 等不在静态目录的字符串可保存，未被改写。 |
| F32-M03 | 通过 | schema 和 update 均拒绝控制字符；独立探针通过。 |
| F32-M04 | 通过 | 空值/超长值由 Pydantic 限制；不会截断。 |
| F32-M05 | 通过 | 字符串字段允许供应商常见特殊字符；未发现路径拼接。 |
| F32-M06 | 失败 | `default_parameters` 是任意 JSON object；独立探针确认 `{"api_key":"s"}` 可接受，未做 secret/endpoint/callable 约束。 |
| F32-M07 | 部分通过 | update 受 Workspace manager 和 scope 保护；但参数内容未安全校验。 |
| F32-M08 | 失败 | 可以写入 `disabled`，但没有 agent/session/runtime 解析或 `MODEL_BINDING_UNAVAILABLE` 阻止。 |
| F32-M09 | 部分通过 | delete endpoint 存在；列表没有 active/status 过滤，且没有历史审计语义。 |
| F32-M10 | 失败 | 删除 model binding 没有引用检查，且没有 references endpoint。 |
| F32-M11 | 失败 | API 固定返回全量列表，未实现 kind/status/provider/q 筛选、分页和快照稳定性。 |

### 3.4 Credential visibility、Workspace sharing 与隔离

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-S01 | 通过 | owner 可以脱敏 list/update/delete；原 secret 不出 response。 |
| F32-S02 | 通过 | member 可看到 binding metadata 和 `owner_only`，projection 没有 `credential_id`。 |
| F32-S03 | 阻塞 | 设计为 owner-only fail-closed，但没有实际 binding execute/runtime endpoint。 |
| F32-S04 | 失败 | 正常 API 会阻止有引用 credential 删除；没有验证 owner 删除/撤权后既有 binding 的重新计算和不可用状态。 |
| F32-S05 | 阻塞 | 没有 owner 移出 Workspace 的集成验收，也没有迁移/停用策略实现。 |
| F32-S06 | 失败 | backend context 每次查询校验；但 models page query key 未包含 `membership_version`，且未完成延迟响应浏览器验证。 |
| F32-S07 | 通过 | service 查询同时约束 tenant/workspace；跨租户资源不会被查询到。 |
| F32-S08 | 通过 | `get_workspace_context` 校验 path/header、tenant membership 和 workspace membership。 |
| F32-S09 | 部分通过 | request dependency 会拒绝 inactive membership/tenant/workspace；runtime 使用和旧缓存失效未验。 |
| F32-S10 | 失败 | 没有浏览器慢响应验收；query key/取消策略不足以证明旧响应不会闪现。 |
| F32-S11 | 通过 | credential/binding 查询均带 tenant/workspace 条件，credential owner 还需 actor 匹配。 |

### 3.5 Base URL、SSRF 与连接测试

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-N01 | 阻塞 | endpoint 可校验，但没有 connection test/真实请求证明访问 host/path。 |
| F32-N02 | 部分通过 | 非开发 HTTP 被拒绝；开发环境硬编码允许 localhost/127.0.0.1，尚非部署级可配置策略。 |
| F32-N03 | 部分通过 | 定向测试覆盖 10/8、172.16/12、192.168/16；IPv6、整数 IP、metadata、重定向和 DNS rebinding 未覆盖。 |
| F32-N04 | 阻塞 | 没有 fake provider/连接测试。 |
| F32-N05 | 未实现 | 没有 redirect policy 或连接测试。 |
| F32-N06 | 未实现 | 没有跨 host/scheme redirect policy。 |
| F32-N07 | 未实现 | 没有 provider request timeout/response size/connection reuse 控制。 |
| F32-N08 | 未实现 | 没有真实 provider call 或稳定 provider error mapping。 |
| F32-N09 | 未实现 | 没有模型不存在错误映射。 |
| F32-N10 | 未实现 | 没有限流/5xx 错误分类和有限重试。 |
| F32-N11 | 未实现 | 没有 fake provider 捕获请求证据。 |

### 3.6 Runtime 转换与 agent/session 引用

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-R01 | 未实现 | 没有 agent/session 接受 `model_binding_id` 并解析 credential 的链路。 |
| F32-R02 | 未实现 | 没有新的 binding-based agent/session API。 |
| F32-R03 | 未实现 | 没有 runtime binding scope resolver。 |
| F32-R04 | 未实现 | disabled/owner-only credential 不会被 runtime 解析为稳定错误。 |
| F32-R05 | 阻塞 | 保存自定义 model string 已通过；没有 fake provider/runtime 请求证明实际传递。 |
| F32-R06 | 未实现 | 没有 legacy 兼容读取迁移层。 |
| F32-R07 | 未实现 | 没有服务端生成 AgentScope 兼容配置。 |
| F32-R08 | 失败 | credential 删除仅检查 model binding；model binding 没有 agent/session/KB/SOP/schedule/channel 引用检查。 |
| F32-R09 | 未实现 | 没有 provider call/test 状态生命周期。 |

### 3.7 审计、日志与前端体验

| 用例 | 结果 | 证据/原因 |
| --- | --- | --- |
| F32-A01 | 未实现 | 没有 F32 audit event persistence。 |
| F32-A02 | 未实现 | 没有 binding 审计。 |
| F32-A03 | 未实现 | 没有 connection test。 |
| F32-A04 | 部分通过 | response projection 不含 secret；没有日志、trace、SSE、audit 全链路扫描。 |
| F32-A05 | 部分通过 | 页面和路由存在；无 loading/error/empty 完整状态、筛选、引用数、稳定状态原因。 |
| F32-A06 | 部分通过 | secret 输入为 password 且不进入 URL；无 rotation/delete/test/最近状态。 |
| F32-A07 | 部分通过 | 基础表单存在，provider 没有 schema 驱动，default parameters/capability 没有 UI。 |
| F32-A08 | 未实现 | 没有 connection test UI。 |
| F32-A09 | 阻塞 | 未完成 Chromium、窄屏、键盘和双语独立验收。 |
| F32-A10 | 失败 | query key 包含 actor/tenant/workspace，但没有 `membership_version`；旧响应丢弃未被证明。 |

## 4. 主要阻塞缺陷

1. `apps/api/app/api/model_provider.py:26-28` 的 provider registry endpoint 没有 `get_workspace_context`，可绕过本 F32 其他资源使用的 Workspace 认证/成员校验。
2. `apps/api/app/schemas/model_provider.py:67-68` 和 `apps/api/app/services/model_provider.py:211-212` 将 `default_parameters` 当作任意 JSON object 保存；`api_key`、`authorization`、endpoint 等秘密字段目前可被持久化并回传给 Workspace 成员。
3. `apps/api/app/services/model_provider.py:249-253` 删除 binding 只执行 delete/flush；没有 `MODEL_IN_USE` 或跨消费者引用查询。
4. `apps/api/app/services/model_provider.py:306-327` 只是从本地 model credential 生成投影；没有把 binding 转换成 AgentScope runtime `type/credential_id/model`，因此“自定义模型可实际使用”尚未成立。
5. `apps/web/src/features/workspaces/models-page.tsx:32-43` 的 Query key 缺少 `workspace.membership_version`；同文件也没有 query error/loading/empty 处理或 credential rotation/delete/test。
6. `apps/api/app/services/model_provider.py:329-336` 对加密配置缺失/无效返回普通业务校验错误，不符合验收计划要求的稳定受控 encryption error/503 语义。

## 5. 真实运行边界

- 真实 provider：未执行；没有测试 key、fake provider 或上游连接。
- AgentScope runtime：未执行；当前实现没有 F32 binding resolver 接入 agent/session。
- Redis：F32 slice 使用 SQLAlchemy 数据库模型，不提供 Redis persistence；没有 Redis 重启证据。
- 浏览器：Web build 和静态路由/侧边栏代码已核验；当前登录浏览器自动化探针超时，没有把交互式页面标记为通过。

## 6. 推荐后续顺序

1. 先修复 provider route 认证、default parameters 安全 schema、binding 引用检查和加密错误码。
2. 明确并实现 binding -> AgentScope runtime resolver，增加 fake provider 和最小 deterministic model fixture。
3. 再补 provider schema、connection test、references、audit 和 credential rotation/delete UI。
4. 最后执行带两个 actor、两个 Workspace、窄屏/键盘和慢响应 fixture 的 Chromium 独立验收。

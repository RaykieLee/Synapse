# F21b2b5 AgentScope 模型配置与凭据隔离

状态：已通过独立验收（见 `development-status.md` 中 F21b2b5）；旧数据迁移与真实模型调用待验。尚未添加 provider 凭据，也未调用 provider API。

## 接口范围

AgentScope's persisted model-provider resource is its credential library
(`/api/v1/ai/credential`): create, list, patch, delete, and provider schema
catalog. `/api/v1/ai/model` and the embedding/TTS model catalog routes expose
registered provider model-card metadata; they do not persist credentials.
Chat, fallback-chat, and TTS settings refer to credentials through
`credential_id` in `SessionConfig`.

Credential record IDs and Redis/SQL storage owner keys are derived from the
F21a verified context:

```text
credential ID:   synapse-credential-t{tenant_id}-w{workspace_id}-u{actor_user_id}-{id}
storage owner:   synapse-credential-owner-t{tenant_id}-w{workspace_id}-u{actor_user_id}
```

owner key 由服务端生成。List/get/update/delete 仅接受当前命名空间；其他作用域 ID 按不存在处理。以原始账号 ID 存储的旧凭据会被隐藏，无法通过新 API 使用。AgentScope 默认资源策略拒绝跨用户共享，此作用域适配器也会拒绝其他作用域的凭据，因此每个 tenant Workspace 中的凭据均为 actor 私有。

Session create/update 仅校验并持久化当前作用域下的 primary、fallback 和 TTS model credential ID。Runtime credential resolution 使用专用 `ResourceAccessService` 路径，只有在检查当前作用域后才解密。API projection 使用的普通 storage get/list 仅返回 provider type 和 display name。Credential create 仅返回不透明 ID；list 和 update 响应不包含密钥字段。

## 加密与运行密钥

除 provider `type` 和显示用 `name` 外，credential payload 字段在写入 Redis/SQL storage 前均使用 Fernet 加密。加密封装中包含 storage owner 和 credential ID；解密时会根据当前已验证作用域与记录 key 对两者进行检查。缺少版本化加密字段的旧明文记录会被隐藏并拒绝。

创建或使用凭据前，将 `SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY` 设置为由部署环境管理的 Fernet key。可用以下命令生成：
`python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`
并将其存入部署环境的 secret manager。若缺少密钥或密钥格式错误，
credential 写入与 runtime 解析会返回受控的 503；服务不会回退到明文存储或开发用密钥。存储凭据期间必须保持密钥稳定。轮换需要规划解密/重新加密迁移，并同时控制新旧密钥；本功能尚未实现密钥轮换或多密钥封装。由于 Redis 中仍存有密文及非敏感标签，Redis 访问和备份也必须有各自的访问控制。

API 除 provider type 和显示名称外不会返回 credential payload 字段。Runtime 代码仅从 credential resolver 在内存中取得明文。此处没有新增 API key 值或 provider 账号。Provider 凭据应保存在此库中，不要放入 model `parameters` 或其他会话字段。

## 限制与后续验收

模型目录仅代表 provider 元数据，不能证明 provider 已配置或可连通。尚未验收 provider 凭据、网络请求、模型构造或成功生成。API/worker 进程必须使用同一加密密钥运行会话；独立 worker 还必须携带并重新检查已验证的 Workspace 上下文。当前作用域适配器有意不提供 AgentScope 跨账号凭据共享。内嵌应用当前未配置 knowledge-base manager；未来如有后台索引路径直接从 storage 读取凭据，必须改用受作用域保护的 runtime resolver。

独立验收已检查新记录加密、跨作用域访问拒绝与日志脱敏。旧无作用域记录及真实 provider 调用仍待后续验收。后续应检查原始 Redis/SQL 记录是否仅含密文；跨 tenant、Workspace、actor 执行 create/list/update/delete；核实旧记录不可见、外部 ID 被拒绝、API body 和日志无明文、无效/缺失密钥时安全失败、模型目录不泄露凭据、会话模型引用绑定作用域，且只有 runtime resolution 能解密。

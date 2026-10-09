# F21b2b5 模型凭据 scope 与加密验收

日期：2026-10-02  
结果：**新建的 scoped 凭据通过；记录了旧数据静态加密边界**

## 环境与命令

可重复验收为 `apps/api/tests/verification/test_f21b2b5_model_credential_isolation.py`。使用迁移到 Alembic head 的临时 SQLite 数据库、真实 Synapse JWT 和 Workspace gateway 请求，以及 `127.0.0.1:6380` 上的 Redis（AgentScope storage DB 7、bus DB 6）。每次运行生成新的 Fernet key。不清空 Redis 数据库；fixture 记录由 pytest finalizers 清理。

```sh
cd apps/api
F21B2B5_REDIS_PORT=6380 .venv/bin/pytest tests/verification/test_f21b2b5_model_credential_isolation.py -q --tb=short
```

实际结果：**1 passed**。SQLite 数据库包含 Synapse 用户/租户和 workspace membership；AgentScope 模型凭据存储在 Redis，因此此配置下没有可检查的 SQL credential 值。

## 结果

- 通过已认证 API 在两个租户、两个 Workspaces 和两个 actors 之间创建四条凭据（包括共享一个 Workspace 的两个 actors）。每条都获得不同的 tenant/Workspace/actor 前缀 ID。Scoped 列表只暴露各自记录。外部 IDs 和特意预置的原始旧版 ID 无法更新/删除（404）；自身的更新/删除成功。
- API 创建/更新/列表响应仅返回凭据 ID 或安全类型与显示名称。捕获的请求日志中不含任何提交或更新的哨兵密钥。
- 新建 scoped credentials 的 AgentScope 原始 Redis 记录包含 `synapse_ciphertext_v1` 和安全标签。解码后的原始记录不含任何提交的明文哨兵值，包括更新后。
- 使用有效 Fernet key 时，真实 `ResourceAccessService.resolve_credential` runtime 路径会解密当前 actor 的凭据。其他 Workspace 的 credential ID 解析为 404。
- 引用当前 scope 凭据的 Session primary、fallback 和 TTS 配置均被接受，并以 scoped credential ID 持久化。外部 Workspace、外部 actor、外部 tenant 和原始旧版 credential IDs 在各自配置字段中均以 404 拒绝。
- 未配置加密或配置的 Fernet key 格式错误时，真实凭据 API 返回带稳定 `MODEL_CREDENTIAL_ENCRYPTION_*` codes 的受控 503 响应。
- 未调用真实外部模型提供方。上述存储/runtime resolver 检查不需要提供方 key，本次也没有可用 key。

## 旧存储说明

测试将一条 scope 前凭据直接写入旧版全局用户 owner 下，以确认 scoped 列表/修改/runtime resolution 不会接管它。该 fixture 模拟旧版未加密的 AgentScope 记录；其原始 Redis 值会保持明文，直到单独迁移或移除。Scoped API 请求不会暴露此记录。本验收证明新 scoped 写入会加密，不代表已修复现有未限定记录的静态加密问题。

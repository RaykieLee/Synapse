# Redis 标记测试复跑

日期：2026-10-12

## 环境

- Docker Desktop 本机运行；创建一次性 `redis:7-alpine` 容器，实测 Redis `7.4.11`。
- 容器仅绑定 `127.0.0.1:16379` 与 `127.0.0.1:6380`，用于适配测试中的端口默认值；未挂载持久卷，测试后已停止并自动移除。
- API 每项验收使用 pytest 临时目录中的 SQLite 数据库；未连接生产数据库。未读取或输出 `apps/api/.env` 内容。
- Redis suite 使用隔离容器；可配置端口的测试均设置为 `16379`，`F18b2c` 使用其测试代码内固定的 `6380`。

## 结果

最新执行 `apps/api/.venv/Scripts/python.exe -m pytest -q -m "redis and not windows_symlink"`：

**8 passed, 5 failed, 35 deselected, 12 warnings。**

随后单独修正 F19a 的迁移基线 fixture，并使用当前 Docker Redis `127.0.0.1:16381` 重跑该测试：`1 passed, 2 warnings`。下表的完整 suite 数字保留为修复前记录，不能作为修复后的完整 suite 结果。

本次完整 suite 中 `F18b2c` 通过；此前记录的 `7 passed, 6 failed` 结果未作为本次结论。当前 5 个失败均为验收断言或本机配置隔离差异，不是 Redis `PING`/连接失败。

| 测试 | 观察到的结果 | 初步判断 |
| --- | --- | --- |
| `test_f19a_scheduled_task_runs.py` | 期望 Alembic revision 为 `0015_tenant_scheduled_task_runs`，当前迁移已到 `0016_tenant_validity`。 | 验收断言未跟进后续迁移，需更新测试基线。 |
| `test_f20b_agentscope_embed.py` | 测试携带 `X-User-ID` 并期望健康检查 `200`；当前网关按安全规则返回 `400 IDENTITY_HEADER_FORBIDDEN`。 | 测试请求与当前身份头契约冲突，需更新验收用例。 |
| `test_f21a_agentscope_gateway.py` | SSE 请求未传 `agent_id`，FastAPI 返回 `422`，测试期待 `503 AI_STREAM_CONTEXT_REVALIDATION_REQUIRED`。 | 测试未满足当前路由必填参数，需核对预期后修正用例。 |
| `test_f21b2b1_agent_resource_isolation.py` | 测试仍期待 owner 读取 agent detail 为 `405`；当前 F23a1 已提供详情路由，实际为 `200`。 | 旧验收断言未跟进新增详情功能。 |
| `test_f21b2b5_model_credential_isolation.py` | 测试清除进程环境变量后仍可创建凭据（`201`），而预期是缺少加密密钥时返回 `503`。`Settings` 配置还会读取 `.env`，且本机 `apps/api/.env` 存在。 | 疑似本机 `.env` 影响“缺少密钥”场景；未读取密钥内容，需在隔离配置源下复验。 |
| `test_f18b2c_scheduler_runtime.py` | 本次完整 suite 通过；此前记录曾出现一次失败。 | 后续如修改调度器，仍需关注测试时序/顺序敏感性。 |

这次 Redis suite **不能判为全通过**。上述测试差异未在本任务中修改；Windows symlink 标记测试也未纳入本次筛选。

## 其他检查

- API 默认套件：`23 passed, 25 deselected, 37 warnings`。
- Python `compileall app`：通过。
- 前端 `pnpm build`：通过。
- 全量 ESLint：`0 errors, 24 warnings`。
- `git diff --check`：通过。

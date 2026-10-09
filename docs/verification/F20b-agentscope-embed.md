# F20b AgentScope 同进程嵌入与生命周期验收

## 结果

通过 F20b 范围内的同进程挂载、生命周期与身份覆盖验证；F21 的 tenant/Workspace 隔离仍未实现，明确不计入通过范围。

本次验证按 `apps/api/pyproject.toml` 精确安装了：

```text
agentscope[service,storage-redis] @ git+https://github.com/agentscope-ai/agentscope.git@72f3f6fa0b2fc38b8517f408ab616f0f2bd229e6
```

Git SHA 成功解析为 `72f3f6fa0b2fc38b8517f408ab616f0f2bd229e6`，wheel 成功构建并安装，版本为 `2.0.10.dev0`。真实 Redis 7 容器用于本次联调，映射到本机 `127.0.0.1:16379`，验证后已移除。

## 执行

先启动隔离 Redis，再执行测试：

```bash
docker run --rm -d --name synapse-f20b-redis -p 127.0.0.1:16379:6379 redis:7-alpine
cd apps/api
.venv/bin/python -m pytest -q tests/verification/test_f20b_agentscope_embed.py
```

结果：`1 passed`。测试使用临时 SQLite 数据库迁移到运行时 Alembic head `0012_tenant_scheduled_tasks`，并在同一进程内以真实 Uvicorn 在动态分配的单个端口启动 Synapse 根应用及挂载子应用。

## 验收证据

- `GET /api/v1/health` 与 `GET /api/v1/ai/health` 通过同一 Uvicorn socket 可达。带 Synapse JWT 的 AI health 返回 200、`status=ok` 且没有 `not_ready` 组件；缺 JWT 返回 401。
- 包装 AgentScope 原 lifespan context manager 计数：进入 1 次、退出 1 次。Uvicorn 正常停止；结束后 Redis storage 与 message bus 的 client 和 owned pool 均已释放。
- 向子应用加一个仅供本测试使用的 identity 探针路由：只有 `Authorization: Bearer <Synapse JWT>` 时通过；JWT 指向测试用户、请求同时伪造 `X-User-ID: 999999-forged-client-id`，探针仍返回 JWT 对应用户 ID；无 JWT 且仅有伪造 header 时返回 401。
- workspace manager 初始化配置为临时目录；验收确认 AgentScope manager 的 resolved `basedir` 等于该临时路径。AgentScope 在未创建 runtime workspace 前不会主动创建根目录。

## 范围与局限

- 身份断言使用测试专用子应用路由直接读取 `get_current_user_id` 依赖的结果；它验证子应用依赖覆盖与挂载时的身份来源，不代表所有 AgentScope 业务资源路由均已端到端验收。
- 本验证没有调用模型供应商或执行真实 Agent 对话。
- F21 的 tenant/Workspace 归属、成员状态、权限与资源查询隔离尚未实现，因此不得将本报告解读为 AI 业务具备多租户或 Workspace 隔离。

## 验证文件

- `apps/api/tests/verification/test_f20b_agentscope_embed.py`
- 实现契约：`docs/agentscope-runtime.md`

# Docker 部署

Synapse 的 Docker 部署包含四个服务：

- `web`：构建后的 Vite 前端，由 Nginx 提供静态文件，并将 `/api/` 反向代理到 API。
- `api`：FastAPI、Synapse 业务 API 和嵌入式 AgentScope。
- `redis`：AgentScope 元数据、消息总线和唤醒任务使用的 Redis。
- `qdrant`：知识库向量存储。

SQLite 数据库、附件、AgentScope Workspace/blob 文件、Redis 和 Qdrant 数据都使用 Docker named volume 持久化。

## 启动

在仓库根目录执行：

```powershell
Copy-Item .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
```

首次启动会在 API 容器内自动执行 Alembic migration。查看状态：

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f api
```

默认入口：

- Web：`http://localhost:5173`
- API 健康检查：`http://localhost:8010/api/v1/health`
- Redis 本机诊断端口：`localhost:16382`
- Qdrant 本机诊断端口：`localhost:16334`

如果这些端口被占用，在 `.env.docker` 中修改 `SYNAPSE_WEB_PORT`、`SYNAPSE_API_PORT`、`SYNAPSE_REDIS_PUBLISH_PORT` 或 `SYNAPSE_QDRANT_PUBLISH_PORT`。

## 初始化平台管理员

部署不会自动创建默认账号或默认密码。先进入 API 容器执行受控 CLI：

```powershell
docker compose --env-file .env.docker exec api python -m app.cli.create_platform_admin
```

命令会交互式要求输入用户名和至少 12 位密码。然后使用该账号登录 Web，再创建租户和 Workspace。

## AgentScope 配置

默认 Compose 配置已启用：

- AgentScope Redis 存储和消息总线；
- Qdrant 知识库；
- AgentScope 调度器；
- Synapse 租户定时任务轮询器。

默认关闭：

- GitHub/ClawHub Hub；
- 钉钉、Discord、飞书渠道。

需要真实模型时，在前端工作空间的“AgentScope 凭据”中添加提供商凭据；需要 Hub 或渠道时，在 `.env.docker` 中增加对应 token/开关。不要把真实 token 提交到 Git。

## 停止与清理

停止容器但保留数据：

```powershell
docker compose --env-file .env.docker down
```

删除容器和所有持久化数据（会删除 SQLite、Redis、Qdrant、附件和 AgentScope 文件）：

```powershell
docker compose --env-file .env.docker down -v
```

生产环境不要使用示例密钥；修改 `SYNAPSE_JWT_SECRET` 和 `SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY` 后再启动。


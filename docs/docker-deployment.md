# Docker 部署

Synapse 的 Docker 部署默认包含四个服务；对象存储为可选能力：

- `web`：构建后的 Vite 前端，由 Nginx 提供静态文件，并将 `/api/` 反向代理到 API。
- `api`：FastAPI、Synapse 业务 API 和嵌入式 AgentScope。
- `redis`：AgentScope 元数据、消息总线和唤醒任务使用的 Redis。
- `qdrant`：知识库向量存储。

SQLite 数据库、附件、AgentScope Workspace/blob 文件、Redis 和 Qdrant 数据都使用 Docker named volume 持久化。附件默认存本地；需要多 API 副本共享附件时可切换到外部 S3-compatible 存储。附件迁移不包含 AgentScope runtime Workspace/blob 文件。

## 启动

在仓库根目录执行：

```powershell
Copy-Item .env.docker.example .env.docker
```

`.env.docker.example` 中的两个密钥默认为空。启动前必须填写至少 32 字节的随机 JWT secret 和有效的 Fernet key：

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Compose 在变量缺失或为空时会拒绝启动。已有模型凭据时，轮换 Fernet key 前必须先完成解密后重加密；轮换 JWT key 会立即使现有浏览器和 API 会话失效。

示例配置面向 `http://localhost`，因此显式设置 `SYNAPSE_AUTH_COOKIE_SECURE=false`。通过 HTTPS 暴露服务时，必须改为 `SYNAPSE_AUTH_COOKIE_SECURE=true`；若删除该变量，API 会根据请求或反向代理的 `X-Forwarded-Proto` 自动判断。

```powershell
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

## RustFS / S3-compatible 附件存储

仓库附带 `deploy/rustfs/docker-compose.yml`，固定使用官方 RustFS `1.0.4` 镜像，并将 S3 API/Console 端口绑定到宿主机回环地址：默认 `127.0.0.1:19000` 和 `127.0.0.1:19001`。API 和 RustFS 通过单独的 internal Docker network 通信；Web、Redis、Qdrant 等其他容器不直接加入该网络。API 容器内通过 `http://rustfs:9000` 访问；不要把 S3 API 或 Console 端口直接开放到公网。RustFS 官方 Docker 部署说明要求为挂载目录提供 UID `10001` 的写权限，数据路径应放在持久磁盘。参见 [RustFS Docker 部署文档](https://docs.rustfs.com/en/installation/container/docker) 与 [官方发行版](https://github.com/rustfs/rustfs/releases)。

在已有 Synapse 网络的服务器上，部署时先准备独立数据目录和权限受限的 `.env` 文件；从 `.env.example` 复制模板后，在服务器本地产生 `RUSTFS_ACCESS_KEY`、`RUSTFS_SECRET_KEY`，不要把真实值放进仓库或聊天记录。随后使用 `deploy/rustfs/docker-compose.yml` 启动 RustFS。管理 Console 仅通过 SSH 隧道访问；创建附件 Bucket 后，再按 `docs/attachment-api.md` 配置 API 的 `SYNAPSE_ATTACHMENTS_S3_*` 变量。生产应用应使用仅授权目标 Bucket 的独立服务凭据，不应把 RustFS 管理凭据交给浏览器。

将已部署应用切换到 S3 前，先备份数据库与附件数据，确认 Bucket、内部 DNS、凭据和健康状态，再运行 `python -m app.cli.migrate_attachment_storage` 预演；审阅数量后加 `--apply` 分批复制和校验。完成迁移后才能将 `SYNAPSE_ATTACHMENTS_STORAGE_BACKEND` 设为 `s3` 并滚动部署 API。失败时先修复存储连接再重跑；迁移保留源文件，回滚到本地时使用 `--target local --apply`。当前线上 Synapse 容器不因部署 RustFS 而重启，也不会自动切换附件后端。

## 停止与清理

停止容器但保留数据：

```powershell
docker compose --env-file .env.docker down
```

删除容器和所有持久化数据（会删除 SQLite、Redis、Qdrant、附件和 AgentScope 文件）：

```powershell
docker compose --env-file .env.docker down -v
```

生产环境不要使用示例密钥。`docker compose config` 可以帮助检查变量是否已设置，但不要把输出或 `.env.docker` 提交到 Git。


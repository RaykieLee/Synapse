# GitHub Actions 自动部署

推送 `main` 后，`.github/workflows/deploy.yml` 会依次执行：

1. 后端测试：`uv sync --frozen --extra dev`、`pytest -q`。
2. 前端检查：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm build`。
3. 镜像构建：在 GitHub Actions 构建 API 和 Web 镜像。
4. 发布传输：打包 API、Web、Redis 和 Qdrant 镜像，通过 SSH 上传服务器。
5. 远端发布：加载镜像、启动 Compose、等待健康检查；失败时回滚上一版本。

采用“Actions 构建、SSH 直传”而不是让服务器现场构建，是因为当前生产服务器访问 GitHub 和 GHCR 的速度很慢，但以上传带宽和 Docker 本地加载方式可以稳定发布。

## GitHub Secrets

在 GitHub 仓库 `Settings > Secrets and variables > Actions` 配置：

| Secret | 用途 | 示例 |
| --- | --- | --- |
| `DEPLOY_HOST` | 服务器 IP 或域名 | `43.138.192.8` |
| `DEPLOY_USER` | SSH 用户 | `ubuntu` |
| `DEPLOY_PATH` | 部署根目录 | `/opt/synapse` |
| `DEPLOY_SSH_KEY` | 部署账号的私钥全文 | OpenSSH PEM |
| `DEPLOY_KNOWN_HOSTS` | 服务器 SSH host key | `ssh-keyscan` 输出 |

不要使用登录密码作为流水线凭据。部署用户需要能执行 `sudo docker compose`，且仓库不允许把 `.env.docker`、私钥或服务器密码写入 Git。

## 服务器初始化

服务器需要安装 Docker Engine 和 Docker Compose，并准备：

```bash
sudo install -d -o ubuntu -o ubuntu -m 755 /opt/synapse /opt/synapse/releases
install -m 600 .env.docker.example /opt/synapse/.env.docker
```

编辑 `/opt/synapse/.env.docker`，至少设置：

- `SYNAPSE_JWT_SECRET`：至少 32 字节随机值；
- `SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY`：有效 Fernet key；
- `SYNAPSE_AUTH_COOKIE_SECURE=true`：通过 HTTPS 访问时；
- `SYNAPSE_WEB_PORT=5173`：Web 对公网暴露的端口。

API、Redis 和 Qdrant 使用带 `127.0.0.1` 的端口绑定，不能直接暴露到公网。Web 由宿主机 Nginx、Caddy 或云负载均衡反向代理到 `127.0.0.1:5173`。

## 触发和查看

推送到 `main` 自动触发，也可以在 GitHub Actions 页面手动运行 `workflow_dispatch`：

```bash
git push origin main
gh run list --workflow deploy.yml --repo RaykieLee/Synapse
gh run watch --repo RaykieLee/Synapse
```

服务器上的发布状态：

```bash
sudo docker compose \
  --project-directory /opt/synapse \
  --env-file /opt/synapse/.env.docker \
  --env-file /opt/synapse/state/current.env \
  -f /opt/synapse/docker-compose.yml ps
```

## 回滚

工作流在健康检查失败时会自动加载 `state/previous.env` 并回滚上一镜像。手动回滚：

```bash
sudo cp /opt/synapse/state/previous.env /opt/synapse/state/current.env
sudo docker compose \
  --project-directory /opt/synapse \
  --env-file /opt/synapse/.env.docker \
  --env-file /opt/synapse/state/current.env \
  -f /opt/synapse/docker-compose.yml up -d --no-build --wait
```

发布数据使用 Docker named volumes 持久化；不要执行 `docker compose down -v`，除非明确要删除数据库、附件、Redis 和 Qdrant 数据。

## 公网 HTTPS

当前 Compose 只负责应用容器，不终止 TLS。建议让宿主机 Nginx 或 Caddy 监听 80/443，并反向代理到 `127.0.0.1:5173`。如果云厂商已经在 80 端口做负载均衡，必须将后端目标指向服务器的 Web 端口，并确保安全组放行 `5173` 或只放行代理端口。

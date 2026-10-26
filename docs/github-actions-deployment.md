# GitHub Actions 自动部署

推送 `main` 后，`.github/workflows/deploy.yml` 会依次执行：

1. 后端测试：`uv sync --frozen --extra dev`、`pytest -q`。
2. 前端检查：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm build`。
3. 镜像构建：在 GitHub Actions 构建 API 和 Web 镜像，并推送到 GitHub Container Registry（GHCR）。
4. 发布传输：通过 SSH 标准输入向服务器传递本次运行的短期 `GITHUB_TOKEN`，服务器临时登录 GHCR 并拉取镜像。
5. 远端发布：启动 Compose、等待健康检查；失败时恢复上一版本的 Compose 配置和镜像，临时 Docker 登录信息随后自动删除。

采用“Actions 构建、GHCR 分发、服务器拉取运行”而不是让服务器现场构建，是因为构建依赖和缓存由 GitHub 托管，服务器只承担运行职责。Redis 和 Qdrant 仍由服务器直接从 Docker Hub 拉取。

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

GHCR 登录不需要额外创建长期 Secret。工作流使用本次 Actions 运行自动生成的 `GITHUB_TOKEN` 推送镜像，并在发布阶段通过 SSH 将它传给远端脚本。远端只把它写入权限为 `700` 的临时 `DOCKER_CONFIG`，发布结束或失败时删除，不写入 `/opt/synapse/.env.docker`。

镜像 owner 默认取 GitHub 仓库 owner；如果组织迁移后需要覆盖，可在仓库 `Settings > Secrets and variables > Actions > Variables` 中设置 `GHCR_OWNER`。该值应使用 GHCR 接受的命名空间，不能包含 `ghcr.io/` 前缀。

## 服务器初始化

服务器需要安装 Docker Engine 和 Docker Compose，并准备：

```bash
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/synapse /opt/synapse/releases
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

工作流在健康检查失败时会自动加载 `state/previous.env`、`state/previous-compose.yml` 并回滚上一镜像。手动回滚：

```bash
sudo cp /opt/synapse/state/previous.env /opt/synapse/state/current.env
sudo docker compose \
  --project-directory /opt/synapse \
  --env-file /opt/synapse/.env.docker \
  --env-file /opt/synapse/state/current.env \
  -f /opt/synapse/docker-compose.yml up -d --no-build --wait
```

如果上一版本镜像已经不在服务器本地，而 GHCR package 仍是私有状态，需要先使用有 `read:packages` 权限的 GitHub token 临时执行 `docker login ghcr.io` 再拉取。正常自动发布不需要人工登录。

发布数据使用 Docker named volumes 持久化；不要执行 `docker compose down -v`，除非明确要删除数据库、附件、Redis 和 Qdrant 数据。

## 公网 HTTPS

当前 Compose 只负责应用容器，不终止 TLS。建议让宿主机 Nginx 或 Caddy 监听 80/443，并反向代理到 `127.0.0.1:5173`。如果云厂商已经在 80 端口做负载均衡，必须将后端目标指向服务器的 Web 端口，并确保安全组放行 `5173` 或只放行代理端口。

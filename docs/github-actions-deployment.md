# GitHub Actions 自动部署

推送 `main` 后，`.github/workflows/deploy.yml` 会依次执行：

1. 后端测试：`uv sync --frozen --extra dev`、`pytest -q`。
2. 前端检查：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm build`。
3. 镜像构建：在 GitHub Actions Runner 上构建 API 和 Web 镜像，只把本次提交生成的两个应用镜像打包为压缩镜像包。
4. 发布产物：上传 `synapse-release-<commit>` Actions Artifact，保留 14 天；该产物包含镜像包、SHA-256、Compose 文件和发布脚本。
5. 本机发布：在能访问 GitHub 和服务器且网络更稳定的机器上下载 Artifact，通过 SSH/`rsync` 分块上传，远端校验 SHA-256 后加载镜像并切换版本。

采用“GitHub 构建、本机分发、服务器加载运行”而不是让服务器现场构建：构建依赖和缓存由 GitHub 托管，服务器只承担运行职责，因此服务器不需要拉取源码或安装 Node/Python 构建工具。当前路径不依赖 GHCR。

GitHub Runner 到服务器的跨境链路实测只有约 15 KiB/s，直接由 Actions 推送约 300 MB 镜像包需要数小时，因此发布不再绑定 Actions Job 时长。服务器仍不现场编译；发布机只负责搬运 GitHub 已构建并校验过的同一份产物。

## 本机发布

先确认 Actions 运行成功，并取得提交 SHA：

```powershell
$sha = git rev-parse HEAD
gh run list --workflow deploy.yml --repo RaykieLee/Synapse --limit 1
gh run download --repo RaykieLee/Synapse --name "synapse-release-$sha" --dir ".artifacts\$sha"
```

可直接在本仓库根目录运行：

```powershell
.\scripts\deploy-local.ps1 -Commit $sha
```

脚本会下载对应 Actions Artifact、校验 SHA-256、上传到服务器、再次校验，最后调用远端发布脚本。Windows 自带 `scp` 无法断点续传，因此若上传中断，重新运行脚本即可重新尝试；服务器上的正式生产发布仍可通过 Linux 发布机的 `rsync --partial --append-verify` 完成。不要使用登录密码作为部署凭据。部署用户需要能执行 `sudo docker compose`，且仓库不允许把 `.env.docker`、私钥或服务器密码写入 Git。

当前个人账号的 GHCR 在全新包名、个人 OAuth Token、经典 PAT 和 Actions `GITHUB_TOKEN` 下均实测返回 `owner not found` 或 `permission_denied`，因此流水线不把 GHCR 作为生产发布的硬依赖。迁移到组织命名空间或 GHCR 状态恢复后，可另开改动切回 Registry 拉取模式。

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

Actions 成功表示测试、镜像构建和发布 Artifact 已就绪，不表示服务器已经切换版本。必须继续执行上面的本机发布命令，并确认服务器 `current.env` 指向新 SHA、四个容器健康后才算上线成功。

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

上一版本的 API 和 Web 镜像已保留在服务器本地，自动回滚不依赖 Registry。Redis 与 Qdrant 使用标准镜像；发布脚本会先检查本地镜像，只有缺失的首次部署才从 Docker Hub 拉取，已有镜像不会触发联网拉取。

发布数据使用 Docker named volumes 持久化；不要执行 `docker compose down -v`，除非明确要删除数据库、附件、Redis 和 Qdrant 数据。

## 公网 HTTPS

当前 Compose 只负责应用容器，不终止 TLS。建议让宿主机 Nginx 或 Caddy 监听 80/443，并反向代理到 `127.0.0.1:5173`。如果云厂商已经在 80 端口做负载均衡，必须将后端目标指向服务器的 Web 端口，并确保安全组放行 `5173` 或只放行代理端口。

# Synapse

统一管理后台与 AgentScope AI 工作台。

支持租户、Workspace、成员和角色管理，并通过左上角切换器切换工作空间。业务数据和 AI 资源按租户及空间隔离。

前端基于 shadcn-admin，后端迁入 Synapt 系统管理和人脸识别，并在同一个 FastAPI 服务中嵌入 AgentScope。

当前状态：前端初始框架和后端基础已建立，登录与多租户基础正在开发。完整业务迁移仍在进行中。

功能进度和独立验证证据见 [开发台账](docs/development-status.md)。开发与验收均按单一任务委派，验收报告位于 docs/verification。

## API 测试分层

在 `apps/api` 中默认只运行本地 SQLite/API 套件，不要求 Redis、浏览器或系统符号链接权限。外部环境要求通过测试文件中的 pytest marker 显式声明；改动测试文件名不会改变套件分层：

```powershell
.venv\Scripts\python.exe -m pytest -q
```

外部环境套件按需选择：

```powershell
.venv\Scripts\python.exe -m pytest -q -m redis           # AgentScope/Redis
.venv\Scripts\python.exe -m pytest -q -m browser         # Vite + API + Playwright
.venv\Scripts\python.exe -m pytest -q -m windows_symlink # Windows 符号链接权限
.venv\Scripts\python.exe -m pytest -q -m integration     # 多进程/真实外部服务
```

详细范围、目录、技术方案及阶段验收见 [集成计划](docs/integration-plan.md)。

## Docker 部署

项目提供 API、Web、Redis 和 Qdrant 的 Compose 部署方式。首次部署会自动执行数据库迁移，但不会自动创建默认账号：

```powershell
Copy-Item .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker exec api python -m app.cli.create_platform_admin
```

完整配置、持久化目录、端口和 AgentScope 开关见 [Docker 部署说明](docs/docker-deployment.md)。

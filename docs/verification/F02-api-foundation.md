# F02 — API 基础验收

**日期：** 2026-10-01 CST  
**范围：** 仅验收 `Synapse/apps/api` 的 FastAPI 基础架构。未启动或访问任何现有后端服务。

## 结果

| 检查项 | 结果 | 证据 |
|---|---|---|
| Python 运行时与环境 | **通过** | 系统 Python 为 3.9，低于项目声明的要求。使用 `/opt/homebrew/bin/python3.11`（Python 3.11.13）在 `Synapse/apps/api/.venv` 创建可复用环境。项目以 editable 模式安装，声明的依赖均已解析。另在虚拟环境安装了 `httpx`，用于进程内 Starlette TestClient 验证。 |
| 应用工厂 | **通过** | `create_app()` 创建了标题为 `Synapse API` 的 FastAPI 应用。 |
| Health endpoint | **通过** | 进程内 `GET /api/v1/health` 返回 HTTP 200 和 `{"status":"ok","service":"synapse-api"}`。未启动网络监听。 |
| SQLAlchemy 与临时 SQLite | **通过** | 设置 `SYNAPSE_DATABASE_URL=sqlite:////tmp/synapse-api-foundation-check.db` 后，engine/session factory 成功连接、创建并读取探测行。此临时数据库位于项目目录之外。 |
| Alembic `upgrade head` | **命令成功；不存在迁移 head** | 对临时 SQLite 数据库运行命令，退出码为 0，并创建 `alembic_version`。`alembic heads` 和 `alembic current` 均未返回 revision。`app/database/migrations` 仅含 `env.py` 和 `script.py.mako`，没有 revision 脚本，因此当前只是空操作升级，并未实际执行 schema migration。 |
| 范围与密钥扫描 | **通过，有限源码扫描** | API 源码由 app factory、health route、环境设置、SQLAlchemy session/base 和 migration 环境组成。搜索未发现无关领域/业务实现或内嵌凭据；只有一条文档注释提及 secrets。这是源码级扫描，并非完整安全审计。 |

## 结论

FastAPI 脚手架、health route 和 SQLAlchemy SQLite 路径在 Python 3.11.13 下可用。保留的虚拟环境为 `Synapse/apps/api/.venv`；从 Synapse 根目录使用 `apps/api/.venv/bin/python` 调用，或从 `apps/api` 使用 `.venv/bin/python`。Alembic 当前没有 revision 脚本，因此尚未验证空基线之外的数据库迁移行为。未启动任何无关后端服务。

# F17c S3-compatible 附件存储验收记录

验收日期：2026-11-09
结论：代码定向验证、独立验收及共享 RustFS 的远端健康/网络复查通过；自动化 S3 客户端仍为模拟，未验证认证 Bucket/Object CRUD；生产 Bucket、Synapse API 切换和附件数据迁移尚未完成。

## 范围与契约

- 附件元数据通过 `storage_backend` 区分 `local` 与 `s3`；默认仍为 `local`，已有记录由迁移设为本地后端。
- S3-compatible 适配器在服务端生成对象键，并把租户、Workspace、附件作用域及个人附件所有者编码进对象路径；现有 Workspace/个人附件授权仍由 Synapse API 执行，不向浏览器返回对象键、Bucket 或预签名 URL。
- 服务端配置使用 `SYNAPSE_ATTACHMENTS_STORAGE_BACKEND`、`SYNAPSE_ATTACHMENTS_S3_ENDPOINT_URL`、`SYNAPSE_ATTACHMENTS_S3_BUCKET`、`SYNAPSE_ATTACHMENTS_S3_REGION`、`SYNAPSE_ATTACHMENTS_S3_ACCESS_KEY_ID`、`SYNAPSE_ATTACHMENTS_S3_SECRET_ACCESS_KEY` 和 `SYNAPSE_ATTACHMENTS_S3_FORCE_PATH_STYLE`。缺少必要配置时拒绝启用 S3；存储不可用返回脱敏的 `503 ATTACHMENT_STORAGE_UNAVAILABLE`。
- `python -m app.cli.migrate_attachment_storage` 默认只读预演；显式传入 `--apply` 后才逐项复制数据、校验字节数与 SHA-256、更新元数据并保留源对象。也支持从 S3 回迁本地。
- RustFS 管理界面仅经 SSH 隧道使用，不新增 Synapse 内的存储管理 UI；API 密钥保持服务端私有。

## 验证证据

| 项目 | 结果 | 证据与局限 |
| --- | --- | --- |
| F17c、F17a、F18b3 定向测试 | 通过 | 在 `apps/api` 运行 `.venv/Scripts/python.exe -m pytest tests/verification/test_f17c_attachment_s3_storage.py tests/verification/test_f17a_attachments.py tests/verification/test_f18b3_attachment_reconcile.py -q`，结果为 `6 passed, 1 deselected, 4 warnings in 8.08s`。警告为 Alembic 未配置 `path_separator` 的弃用警告。 |
| 独立后端验收 | 通过（代码与定向测试） | 独立验收者报告 S3 adapter、迁移顺序、保留源数据、RustFS 配置和测试通过。其 F17c 定向结果为 `5 passed, 1 warning in 5.38s`。未修改产品文件。 |
| S3 测试真实性 | 模拟 | 自动化测试使用内存 S3 客户端替身；覆盖对象读写、迁移校验、错误脱敏及前缀盘点，不等于对实际 RustFS 的端到端 CRUD 验收。 |
| 补丁格式 | 通过 | `git diff --check` 通过。 |
| RustFS Compose 与部署配置 | 通过（共享基础设施） | 当前服务器由 `deploy/infra/docker-compose.yml` 管理 RustFS `1.0.4`；Compose 位于 `/opt/docker/dockercompose/infra`，数据目录为 `/opt/infra/RustFS/data`，S3 API/Console 分别仅绑定 `127.0.0.1:19000/19001`。旧的 `deploy/rustfs` 单独部署说明不代表当前容器名称或目录。 |
| RustFS 部署状态 | 通过（实时只读） | Tabby MCP 于 `2026-11-09 18:01:03 +08:00` 检查到 `infra-rustfs` 为 `running/healthy`，并连接 `infra_backend` 和 `infra_access`；本次未读取或修改服务器密钥。数据目录数值 UID/GID 未核验。 |
| 远端网络与健康复查 | 部分通过 | `infra_backend` 的 `Internal=true`，RustFS 在该网络具有 `rustfs` DNS alias；`infra_access` 为 `Internal=false`。S3 根端点未认证请求返回 HTTP 403，Console health 返回 HTTP 200。未执行认证后的 Bucket/Object CRUD，也未从 API 容器发起 S3 请求，因此只证明服务和监听端点可达，不是 S3 业务验收。 |
| Bucket 与生产切换 | 未执行 | 未取得附件 Bucket、最小权限应用凭据及其验收证据；未为 Synapse API 配置 S3 网络/变量、切换新上传后端或迁移生产附件。当前 API 仍运行旧 release，不能把已部署 RustFS 等同于应用已经使用 S3。 |

## UX 事后评审

独立 UX 评审发生在现有实现之后，不代表满足“实现前先审 UX”的流程要求。结论是不新增 Synapse 内的 RustFS 配置/管理 UI：凭据和迁移属于服务端运维职责，Console 继续限制为 SSH 隧道访问。评审认为通用 `ATTACHMENT_STORAGE_UNAVAILABLE` 提示没有泄露存储细节，方向合适；但发现以下未闭环项：

- 附件删除失败时，错误可能显示在仍打开的确认对话框后面；应在对话框内明确“未删除”，并提供重试/取消操作。
- 会话附件选择器缺少附件加载失败后的专用重试入口。
- 前端 `ApiProblem` 未保留 API `request_id`，存储持续不可用时缺少支持排查引用号。
- 迁移 CLI 有成功/跳过/失败计数、失败附件 ID 和非零退出码，但不输出安全的失败类别；批次部分失败的运维诊断仍需验收。
- 附件页与会话选择器的错误、焦点、键盘和读屏状态尚未完成窄屏/无障碍实测。

以上 UI/运维体验缺口不在本次存储适配器的代码修改范围内，未擅自扩大改动；应单独分配 UX/API 契约及实现任务后验收。当前 F17c 不标记为完整通过。

## 远端复查范围与局限

已通过 Tabby MCP `http://127.0.0.1:3001/mcp` 重连“腾讯云 2”并执行只读复查。RustFS 容器、共享网络与健康端点证据记录在上表；没有查看 `.env`、数据库内容、Bucket 清单或对象数据，也没有创建资源或改变服务配置。HTTP 403 是 S3 根端点未认证探测结果，不证明任何凭据、Bucket 或对象读写可用。API 到 RustFS 的认证连接、生产附件迁移与回滚仍待单独验收。

## 后续验收门槛

1. 核对数据卷权限/UID/GID，并以不泄露密钥的方式完成真实 RustFS 认证 Bucket/Object CRUD 与 API 容器连通性检查。
2. 使用专用最小权限服务凭据准备附件 Bucket；备份数据库和本地附件，再部署启用 S3 的 API 版本并验证新上传、下载、删除及授权隔离。
3. 先运行只读迁移预演并人工审阅对象数量；再逐批 `--apply`，核对 SHA-256、迁移计数、对账结果和回滚路径。
4. 只有实际 RustFS CRUD、线上应用状态、数据迁移与回滚验收证据齐备后，才可将 F17c 更新为完整通过。

## 改动文件

- 部署与配置：`.env.docker.example`、`.gitignore`、`docker-compose.yml`、`deploy/rustfs/docker-compose.yml`、`deploy/rustfs/.env.example`。
- API 与存储：`apps/api/app/api/attachments.py`、`apps/api/app/core/config.py`、`apps/api/app/models/attachment.py`、`apps/api/app/database/migrations/versions/0019_attachment_storage_backend.py`、`apps/api/app/services/attachment_storage.py`、`apps/api/app/services/attachments.py`、`apps/api/app/integrations/attachment_storage.py`、`apps/api/app/cli/migrate_attachment_storage.py`。
- 对账、依赖与测试：`apps/api/app/tasks/attachments.py`、`apps/api/app/tasks/scheduler_runtime.py`、`apps/api/pyproject.toml`、`apps/api/uv.lock`、`apps/api/tests/verification/test_f17c_attachment_s3_storage.py`、`apps/api/tests/verification/test_f17a_attachments.py`、`apps/api/tests/verification/test_f18b3_attachment_reconcile.py`。
- Web 与文档：`apps/web/src/api/attachments.ts`、`apps/web/src/lib/i18n.ts`、`docs/attachment-api.md`、`docs/docker-deployment.md`、`docs/development-status.md`、`docs/verification/F17c-attachment-s3-storage.md`。

本次未纳入工作区中其他三个未跟踪的 Workspace 问题态文件；未读取或提交服务器真实 `.env`、凭据及数据文件。

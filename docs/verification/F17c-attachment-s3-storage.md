# F17c S3-compatible 附件存储验收记录

验收日期：2026-11-09
结论：代码定向验证和独立验收通过；RustFS 部署有启动证据，但远端复查不完整；生产 Bucket、应用切换和附件数据迁移尚未完成。

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
| RustFS Compose 与部署配置 | 通过（共享部署日志证据） | 本地 `deploy/rustfs/docker-compose.yml` 与部署日志中的远端文件哈希一致；固定 RustFS `1.0.4`，S3 API/Console 仅绑定宿主机 `127.0.0.1:19000/19001`，数据挂载至 `/opt/synapse-rustfs/data`。 |
| RustFS 部署状态 | 部分通过 | 部署终端记录 `synapse-rustfs` 为 `running/healthy`、重启数为 `0`，挂载到持久目录；日志记录服务器 `.env` 权限为 `0600`、数据目录权限为 `0750`。此为共享部署日志证据，未能在本轮重新实时确认；数据目录数值 UID/GID 是否为 `10001` 未核实。 |
| 远端网络与健康复查 | 未验证 | 本地 Compose 将附件网络标记为 `internal: true`，但未取得服务器 `docker network inspect` 结果；S3/Console HTTP 探测及原 Synapse 容器部署后健康状态未完成核验。 |
| Bucket 与生产切换 | 未执行 | 未创建或验收附件 Bucket，未向 Synapse API 配置 S3 凭据/网络，未切换新上传后端，也未迁移生产附件。当前应用仍应保持本地后端。 |

## UX 事后评审

独立 UX 评审发生在现有实现之后，不代表满足“实现前先审 UX”的流程要求。结论是不新增 Synapse 内的 RustFS 配置/管理 UI：凭据和迁移属于服务端运维职责，Console 继续限制为 SSH 隧道访问。评审认为通用 `ATTACHMENT_STORAGE_UNAVAILABLE` 提示没有泄露存储细节，方向合适；但发现以下未闭环项：

- 附件删除失败时，错误可能显示在仍打开的确认对话框后面；应在对话框内明确“未删除”，并提供重试/取消操作。
- 会话附件选择器缺少附件加载失败后的专用重试入口。
- 前端 `ApiProblem` 未保留 API `request_id`，存储持续不可用时缺少支持排查引用号。
- 迁移 CLI 有成功/跳过/失败计数、失败附件 ID 和非零退出码，但不输出安全的失败类别；批次部分失败的运维诊断仍需验收。
- 附件页与会话选择器的错误、焦点、键盘和读屏状态尚未完成窄屏/无障碍实测。

以上 UI/运维体验缺口不在本次存储适配器的代码修改范围内，未擅自扩大改动；应单独分配 UX/API 契约及实现任务后验收。当前 F17c 不标记为完整通过。

## 远端访问限制

已通过 Tabby MCP `http://127.0.0.1:3001/mcp` 成功列出会话与工具，并找到“腾讯云 2” SSH 配置。现有终端会话在部署后断开；重新打开配置返回 `Agent auth selected, but no running Agent process is found`，只读命令随之超时。Tabby MCP 本身可用，阻塞点是该 SSH 配置所依赖的本机 Agent 进程/会话。因此没有把先前部署日志当作本轮实时复验，也没有将生产迁移标记为完成。

## 后续验收门槛

1. 恢复 Tabby SSH Agent 或有效会话后，只读核验 RustFS 容器与 Compose 健康、两个 HTTP health endpoint、网络 `Internal` 标志、数据目录数值 UID/GID，以及 Synapse 原有容器的状态。
2. 单独规划并创建附件 Bucket 与最小权限服务凭据；备份数据库和本地附件后，确认 API 容器到 `rustfs:9000` 的连通性。
3. 先运行只读迁移预演并人工审阅对象数量；获准后再逐批 `--apply`，验证上传/下载/删除、授权隔离、对账结果和回滚路径。
4. 只有实际 RustFS CRUD、线上应用状态、数据迁移与回滚验收证据齐备后，才可将 F17c 更新为完整通过。

## 改动文件

- 部署与配置：`.env.docker.example`、`.gitignore`、`docker-compose.yml`、`deploy/rustfs/docker-compose.yml`、`deploy/rustfs/.env.example`。
- API 与存储：`apps/api/app/api/attachments.py`、`apps/api/app/core/config.py`、`apps/api/app/models/attachment.py`、`apps/api/app/database/migrations/versions/0019_attachment_storage_backend.py`、`apps/api/app/services/attachment_storage.py`、`apps/api/app/services/attachments.py`、`apps/api/app/integrations/attachment_storage.py`、`apps/api/app/cli/migrate_attachment_storage.py`。
- 对账、依赖与测试：`apps/api/app/tasks/attachments.py`、`apps/api/app/tasks/scheduler_runtime.py`、`apps/api/pyproject.toml`、`apps/api/uv.lock`、`apps/api/tests/verification/test_f17c_attachment_s3_storage.py`、`apps/api/tests/verification/test_f17a_attachments.py`、`apps/api/tests/verification/test_f18b3_attachment_reconcile.py`。
- Web 与文档：`apps/web/src/api/attachments.ts`、`apps/web/src/lib/i18n.ts`、`docs/attachment-api.md`、`docs/docker-deployment.md`、`docs/development-status.md`、`docs/verification/F17c-attachment-s3-storage.md`。

本次未纳入工作区中其他三个未跟踪的 Workspace 问题态文件；未读取或提交服务器真实 `.env`、凭据及数据文件。

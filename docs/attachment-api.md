# 附件管理 API（本地与 S3-compatible 存储）

状态：F17a/F17c 后端契约。本文说明 Synapse 对已认证上传、列表查询、下载和删除的实现；不包含预览界面、人脸图像处理或 AgentScope runtime/blob 文件迁移。

## 范围与授权

所有端点均隶属于已授权的 Workspace：

```text
/api/v1/workspaces/{workspace_id}/attachments
```

客户端必须发送 Bearer token，并提供与路径一致的 `X-Workspace-ID`。FastAPI 使用 F07 `WorkspaceContext` 解析有效的租户及 Workspace 成员关系；附件查询使用 `workspace_scope` 或 `personal_scope`，因此调用者单独提供的 ID 不会决定查询记录。

`scope_kind=workspace` 附件可由具有 `resource:read` 权限的 Workspace 成员访问；上传需要 `resource:create`，删除需要 `resource:delete`。`scope_kind=personal` 附件仍存储在相同租户和 Workspace 上下文中，但额外绑定到上传账号。其他 Workspace 成员（包括 Workspace owner/admin）不能列出、下载或删除该个人附件；所有者可以删除自己的个人附件。个人附件上传仍需 `resource:create`，读取仍需 `resource:read`。

`SYNAPSE_ATTACHMENTS_STORAGE_BACKEND` 默认为 `local`。本地根目录由 `SYNAPSE_ATTACHMENTS_STORAGE_PATH` 指定（默认 `./var/attachments`）。每个对象使用服务端随机存储键；客户端文件名和 ID 不会用于选择文件系统路径。

## 存储后端与迁移

附件元数据的 `storage_backend` 明确标识 `local` 或 `s3`，既有数据由数据库迁移设为 `local`。对象存储使用服务端随机键，并在实际 S3 object key 中包含可信的租户、Workspace 和作用域（个人附件还包含所有者）路径；对象键和 Bucket 不返回给浏览器。

将新上传切换到 S3-compatible 服务时配置以下服务端变量：

| 环境变量 | 含义 |
| --- | --- |
| `SYNAPSE_ATTACHMENTS_STORAGE_BACKEND` | `local` 或 `s3`；缺省为 `local` |
| `SYNAPSE_ATTACHMENTS_S3_ENDPOINT_URL` | S3 API origin，例如容器内 `http://rustfs:9000` |
| `SYNAPSE_ATTACHMENTS_S3_BUCKET` | 已创建的 Bucket |
| `SYNAPSE_ATTACHMENTS_S3_REGION` | SigV4 region，RustFS 常用 `us-east-1` |
| `SYNAPSE_ATTACHMENTS_S3_ACCESS_KEY_ID` | 服务端访问密钥，不发送给浏览器 |
| `SYNAPSE_ATTACHMENTS_S3_SECRET_ACCESS_KEY` | 服务端 Secret，不发送给浏览器 |
| `SYNAPSE_ATTACHMENTS_S3_FORCE_PATH_STYLE` | 默认 `true`，适配 RustFS/MinIO endpoint |

上传、下载和删除都由 FastAPI 在完成现有 Workspace/个人附件授权后代理到对象存储；不生成或返回预签名 URL。下载继续设置 `Cache-Control: private, no-store` 和 `X-Content-Type-Options: nosniff`。对象存储不可用时返回 `503 ATTACHMENT_STORAGE_UNAVAILABLE`，响应不暴露 endpoint、Bucket、object key 或底层 SDK 错误；附件页面显示可重试提示。对象确实缺失仍使用原有 `404 FILE_NOT_FOUND`。

迁移命令默认只读预演、每批最多 100 条；只有明确传入 `--apply` 才会复制数据：

```powershell
cd apps/api
python -m app.cli.migrate_attachment_storage --target s3 --tenant-id 123
python -m app.cli.migrate_attachment_storage --target s3 --tenant-id 123 --apply
```

命令逐条读取源对象、写入目标、重新读取并比较字节数与 SHA-256，之后才更新 `storage_backend`；每条记录独立提交，重跑可继续。源对象不会由迁移命令删除。回滚时可先部署已支持双后端的版本，再运行 `--target local --apply`；切回旧版本前必须确认所有 S3 记录已回到本地。保留副本期间，正常删除会清理当前对象及已配置的另一后端副本。不要在迁移完成前移除 S3 凭据或手工清理旧本地文件。

## 一致性核对与 S3 权限

租户附件核对任务会逐条检查元数据引用的对象；配置 S3-compatible 存储时，还会在 `synapse/attachments/v1/tenants/<tenant-id>/` 前缀内统计未被当前 S3 元数据引用的对象。结果通过 `s3_orphan_scan_status`（`not_configured`、`complete`、`unavailable` 或 `unsupported`）与 `s3_orphan_object_count` 报告；盘点只读，不返回对象键，也不会自动删除对象。迁移时保留的回滚副本也可能计入该数字，清理前必须人工确认。

附件读写需要 Bucket 内对象级读取、写入、删除和 Head 权限；孤儿盘点另外需要 `s3:ListBucket`，建议将 List 权限限制在附件前缀 `synapse/attachments/v1/tenants/*`。未授权 List 时，附件 CRUD 不因此失效，但盘点状态会是 `unavailable`。

## 端点

### 上传

`POST /api/v1/workspaces/{workspace_id}/attachments` as `multipart/form-data`:

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `file` | 文件 | 必填 | 附件内容及原始文件名 |
| `scope_kind` | 字符串 | `workspace` | `workspace` 或 `personal` |

返回 `201`，并提供包含不透明 UUID `attachment_id`、租户/Workspace ID、作用域、个人附件所有者（若为个人附件）、净化后的原始文件名、检测到的媒体类型、字节数、创建者和创建时间的元数据。

最大文件大小为 25 MiB。空文件和超大文件会被拒绝。支持的扩展名及内容格式包括 PNG、JPEG、GIF、WebP、PDF、UTF-8 TXT/CSV、DOCX、XLSX 和 PPTX。扩展名、声明的 MIME 类型（如存在）以及可识别的文件签名/容器内容必须相符。不支持或类型不匹配的上传会被拒绝。

### 列表

`GET /api/v1/workspaces/{workspace_id}/attachments?scope_kind=workspace&page=1&page_size=20`

`scope_kind` 可取 `workspace` 或 `personal`（默认 `workspace`）。个人附件结果会筛选为当前调用者拥有的附件。`page_size` 最大为 100。响应包含 `items`、`total`、`page` 和 `page_size`。

### 下载

`GET /api/v1/workspaces/{workspace_id}/attachments/{attachment_id}/download?scope_kind=workspace`

返回原始文件字节，并附带净化后的原始文件名、经验证的存储媒体类型、`Cache-Control: private, no-store` 和 `X-Content-Type-Options: nosniff`。超出所选租户、Workspace 或个人所有者范围的 ID，均返回相同的资源不存在响应。

### 删除

`DELETE /api/v1/workspaces/{workspace_id}/attachments/{attachment_id}?scope_kind=workspace`

返回 `204`；系统先幂等删除当前后端对象及可用的保留副本，再删除元数据。本地对象清理失败时返回 `500 FILE_CLEANUP_FAILED`；对象存储不可用时返回 `503 ATTACHMENT_STORAGE_UNAVAILABLE`，元数据行保留以便重试。如果对象已不存在，则幂等地继续删除。如果对象移除后数据库提交失败，元数据会保留，重试时可将其删除。带作用域的条件元数据删除使并发删除具备幂等性：资源删除后，两个调用方都会收到 `204`。删除 Workspace 附件需要 `resource:delete`；个人附件仅所有者可删除。未知、跨租户、跨 Workspace 或非本人所有的个人附件 ID 均返回 `404`。

## 当前边界

- 本地磁盘仍是默认后端；多 API 副本可共享 S3-compatible 对象存储。单机 RustFS 本身不是高可用方案，生产环境仍需规划磁盘容量、备份、监控和故障恢复。
- 支持的文件类型有意限定范围，不包含旧版 Office 格式、任意归档文件、可执行文件或人脸图像。
- 此后端尚未实现内嵌预览、病毒扫描、保留策略、云存储或客户端上传进度。

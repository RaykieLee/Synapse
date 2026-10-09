# 附件管理 API（本地存储）

状态：F17a 后端契约。本文说明 Synapse 首期对认证上传、列表查询、下载和删除的实现，不包含预览界面、云对象存储或人脸图像处理。

## 范围与授权

所有端点均隶属于已授权的 Workspace：

```text
/api/v1/workspaces/{workspace_id}/attachments
```

客户端必须发送 Bearer token，并提供与路径一致的 `X-Workspace-ID`。FastAPI 使用 F07 `WorkspaceContext` 解析有效的租户及 Workspace 成员关系；附件查询使用 `workspace_scope` 或 `personal_scope`，因此调用者单独提供的 ID 不会决定查询记录。

`scope_kind=workspace` 附件可由具有 `resource:read` 权限的 Workspace 成员访问；上传需要 `resource:create`，删除需要 `resource:delete`。`scope_kind=personal` 附件仍存储在相同租户和 Workspace 上下文中，但额外绑定到上传账号。其他 Workspace 成员（包括 Workspace owner/admin）不能列出、下载或删除该个人附件；所有者可以删除自己的个人附件。个人附件上传仍需 `resource:create`，读取仍需 `resource:read`。

本地存储配置项为 `SYNAPSE_ATTACHMENTS_STORAGE_PATH`（默认 `./var/attachments`）。每个对象都写入服务端生成的随机存储键下。客户端文件名和 ID 不会用于选择文件系统路径。

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

返回 `204`；系统会先移除本地对象，再删除元数据。如果 unlink 失败，端点返回 `500 FILE_CLEANUP_FAILED` 并保留元数据行，因此可使用相同的已授权 `DELETE` 重试。如果对象已不存在，则幂等地继续删除。如果对象移除后数据库提交失败，元数据会保留，重试时可将其删除。带作用域的条件元数据删除使并发删除具备幂等性：资源删除后，两个调用方都会收到 `204`。删除 Workspace 附件需要 `resource:delete`；个人附件仅所有者可删除。未知、跨租户、跨 Workspace 或非本人所有的个人附件 ID 均返回 `404`。

## 当前边界

- 目前仅支持本地磁盘存储；运行多个 API 副本的部署，在依赖跨副本下载前必须提供共享持久化路径，或替换此存储适配器。
- 支持的文件类型有意限定范围，不包含旧版 Office 格式、任意归档文件、可执行文件或人脸图像。
- 此后端尚未实现内嵌预览、病毒扫描、保留策略、云存储或客户端上传进度。

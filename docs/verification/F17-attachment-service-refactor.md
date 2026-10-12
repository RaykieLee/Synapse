# F17 附件域 Service 化与前端 API 收口方案

## 状态

- UX 审查：已完成（独立只读审查）
- 方案：本文件
- 代码：已完成（附件域独立提交范围内）
- 静态检查：已通过
- 独立验收：已通过（F17a API + F17b Redis/Vite/Chromium）

本轮只处理附件业务域，不引入 repository 层，也不修改附件的对外 wire contract。

## 目标

1. 将附件业务规则从 `app/api/attachments.py` 提取到 application service。
2. 让请求事务回到 `get_db()` 托管，service 只使用 `flush()`，不显式 `commit()` / `rollback()`。
3. 将前端附件类型和请求集中到 `apps/web/src/api/attachments.ts`，附件页和聊天页复用同一契约。
4. 保留本地文件与数据库 metadata 的补偿语义、Windows 并发删除幂等行为和现有错误码。
5. 补齐当前附件页的高优先级可恢复体验：URL 分页状态、列表重试、操作级错误、逐行删除状态、并发删除后的刷新和双语错误映射。

## 数据归属与权限

### Workspace 附件

- 归属：`tenant_id + workspace_id`。
- 成员权限：具有 `resource:read` 的 Workspace 成员可列表和下载；具有 `resource:create` 才可上传；具有 `resource:delete` 才可删除共享附件。
- 平台管理员仅有平台目录可见性，不因平台角色自动获得 Workspace 附件访问权。

### 个人附件

- 归属：`owner_user_id + tenant_id + workspace_id`。
- 当前产品语义是“当前 Workspace 下我的私有附件”，不是跨 Workspace 的全局个人文件。
- 只有创建者可以列表、下载和删除；其他成员（包括 Workspace owner/admin）按现有隐私语义返回 `404 RESOURCE_NOT_FOUND`。
- 客户端不能覆盖服务端注入的 `tenant_id`、`workspace_id`、`owner_user_id`、`created_by`。

所有列表、计数、下载、删除和后台清理都必须使用同一可信 `WorkspaceContext`；路径中的 ID 和 `X-Workspace-ID` 不一致时继续拒绝请求。

## 冻结的 HTTP 契约

### 路径与上下文

```text
GET    /api/v1/workspaces/{workspace_id}/attachments
POST   /api/v1/workspaces/{workspace_id}/attachments
GET    /api/v1/workspaces/{workspace_id}/attachments/{attachment_id}/download
DELETE /api/v1/workspaces/{workspace_id}/attachments/{attachment_id}
```

- 请求继续使用 `Authorization: Bearer ...` 和 `X-Workspace-ID`。
- 路径 Workspace ID 与 Header 必须一致。
- `tenant_id` 不接受客户端覆盖，由 Workspace 上下文派生。

### 查询和上传字段

```text
scope_kind=workspace|personal
page=1...
page_size=1..100
```

上传 multipart 字段保持：

```text
file
scope_kind
```

默认值继续是 `scope_kind=workspace`、`page=1`、`page_size=20`。

### 成功状态与响应

- 列表：`200`
- 上传：`201`
- 下载：`200` 文件流
- 删除：`204` 空响应
- 列表字段继续为 `items`、`total`、`page`、`page_size`。
- `attachment_id` 保持 UUID 字符串；`tenant_id`、`workspace_id`、`owner_user_id`、`created_by` 保持现有字符串化规则。
- `filename` 是净化后的原始文件名；`storage_key` 不出现在响应中。
- 下载继续返回 `Cache-Control: private, no-store` 和 `X-Content-Type-Options: nosniff`。

### 错误契约

以下状态码和 code 不因 service 化改变：

```text
403 FORBIDDEN
404 RESOURCE_NOT_FOUND
404 FILE_NOT_FOUND
413 FILE_TOO_LARGE
415 UNSUPPORTED_FILE_TYPE
415 FILE_TYPE_MISMATCH
415 INVALID_FILE_CONTENT
422 INVALID_FILENAME
422 FILENAME_TOO_LONG
422 EMPTY_FILE
500 FILE_CLEANUP_FAILED
```

个人附件对其他用户继续使用 `404 RESOURCE_NOT_FOUND`，避免资源存在性探测。现有 problem response 包装不在本轮另行改造；错误映射由 router 保持兼容。

## 后端文件边界

### `apps/api/app/schemas/attachments.py`（新增）

定义 HTTP 契约模型：

- `AttachmentScopeKind`
- 上传/列表参数的可复用类型
- `AttachmentResponse`
- `AttachmentPageResponse`

schema 负责输入形状、枚举、分页上下限和响应文档，不包含数据库查询或文件写入。

### `apps/api/app/services/attachments.py`（新增）

定义 `AttachmentService`，直接接收 SQLAlchemy `Session` 和 `WorkspaceContext`，不引入 repository。

service 负责：

- 作用域查询、个人所有者过滤和权限相关业务判断；
- 文件名净化、扩展名/MIME/内容签名校验；
- 本地临时文件写入、原子替换和安全 storage key 校验；
- 上传 metadata 创建、删除条件和 `flush()`；
- Windows unlink 短暂 `PermissionError` 重试与并发删除幂等；
- 上传 flush 失败时清理临时/目标文件；
- 删除文件后 flush 失败时保留可重试 metadata 语义；
- 返回 ORM 实体、分页结果或下载文件描述，不拼 HTTP 响应字典。

service 不做以下事情：

- 不抛 `HTTPException`；
- 不读取路径参数、Header、Form 或 FastAPI `UploadFile` 的 HTTP 语义；
- 不返回 `FileResponse`；
- 不显式 `commit()` / `rollback()`；
- 不新增 repository 层。

领域失败使用附件域异常/结果表达稳定 code；router 负责把它们映射成当前状态码和 problem response。

### `apps/api/app/api/attachments.py`

收窄为 HTTP 适配层：

- 解析路径、Query、Form、UploadFile 和 Workspace 依赖；
- 调用 `AttachmentService`；
- 声明 response model、状态码和 header；
- 将下载描述转换成 `FileResponse`；
- 将附件域错误映射为现有 HTTP 状态码/code。

本轮完成后，router 不应再直接执行 Attachment 查询、文件校验、`commit()` / `rollback()` 或响应 dict 拼装。

### ORM 与迁移

- `apps/api/app/models/attachment.py` 不改字段和归属。
- 不新增 migration；现有 `0011_attachments` 与后续 migration 保持不变。
- 不改变本地 storage key 格式和目录布局。

## 文件系统与数据库事务

文件系统不是数据库事务的一部分，因此按以下顺序保持可重试：

### 上传

1. service 校验内容并写入唯一临时文件。
2. 原子替换为目标路径。
3. `db.add()` metadata 并 `flush()`。
4. 请求成功后由 `get_db()` commit。
5. `flush()` 或请求失败时删除临时文件和目标文件；数据库由 `get_db()` rollback。

如果原子替换成功但 metadata flush 失败，不能留下无 metadata 的对象。

### 删除

1. service 按可信 scope 读取 metadata。
2. 使用有限重试删除对象；文件已经不存在视为可继续。
3. 条件删除 metadata 并 `flush()`，不自行提交。
4. 请求成功后由 `get_db()` commit。
5. unlink 失败时抛稳定 `FILE_CLEANUP_FAILED`，metadata 保留以便重试。
6. 文件已删除但 flush/请求事务失败时，rollback 保留 metadata；下一次删除遇到缺失文件后仍可清理 metadata。

这套顺序必须同时通过单请求失败、重复删除、真实双线程 DELETE 和确定性 Windows `PermissionError` 模拟。

## 前端 API 收口

### `apps/web/src/api/attachments.ts`（新增）

集中定义：

- `Attachment`
- `AttachmentPage`
- `AttachmentScopeKind`
- `listAttachments`
- `uploadAttachment`
- `downloadAttachment`
- `deleteAttachment`
- 稳定错误 code 到展示 message key 的映射辅助函数

该模块只负责类型化请求、FormData 和 blob 处理；不创建 React Query hooks。

### `apps/web/src/features/workspaces/attachments-page.tsx`

保留 Query/Mutation 和页面交互，但改为调用 `api/attachments.ts`：

- `scope_kind`、`page`、`page_size` 放入 URL search；scope 变化回到第一页。
- Query key 继续包含 actor、tenant、workspace、作用域、分页和 membership version。
- 列表失败保留已显示数据，并提供“重试加载”。
- 上传、下载、删除错误分开记录；错误显示文件名/动作上下文。
- 删除按 attachment ID 记录 pending 状态，避免锁住所有行。
- 删除返回 404 时刷新列表；当前页超出总页数时回退到最后有效页。
- 权限撤销/Workspace 上下文失效时清理附件缓存并重新校验 Workspace。
- 错误 code、空态、加载态和日期使用当前应用 locale；未知错误安全兜底。
- 删除确认继续保持不可误触；统一 Dialog、键盘焦点和移动端布局作为本轮页面交互的一部分。

### `apps/web/src/features/workspaces/sessions-page.tsx`

移除直接拼接附件端点和重复附件类型，复用 `api/attachments.ts`；聊天消息中的附件 data block 格式保持不变。

## UX 与可访问性验收

- Workspace/个人范围切换保持现有语义，页面刷新和浏览器前进后退可恢复范围与页码。
- 加载、空、失败、上传中、删除中均有明确状态；失败状态具备可恢复动作。
- 窄屏（至少 390px）仍可选择、上传、下载、删除和翻页。
- 上传、删除、下载状态不会只用颜色表达；错误具备 `role=alert` 或等价可读播报。
- 删除确认 Dialog 支持 Escape、焦点回收、完整文件名和风险说明。
- 中文/英文页面不出现硬编码技术错误或错误码原文；日期使用应用 locale。
- Viewer/member/admin/owner、个人附件所有者、撤权后请求均保持权限矩阵。

## 实施顺序与所有权

1. 先新增/调整后端定向回归，覆盖事务补偿、错误 code、权限、并发和 Windows 瞬态冲突。
2. 新增 schema/service，逐个迁移上传、列表、下载、删除 router。
3. 运行 F17a、默认 API、compileall；确认 router/service 边界扫描。
4. 新增前端 API 模块，迁移附件页和聊天页调用。
5. 实现 URL 状态与高优先级恢复体验，运行 build、ESLint 和 Playwright。
6. 使用当前 Docker Redis 仅验证与聊天/AgentScope 的交叉路径，不把 Redis 可用性当成附件 service 化本身的通过条件。
7. 更新本文件、`F17a-attachments-api.md`、`F17b-attachments-frontend.md` 和 `development-status.md`，分别记录设计、代码、静态检查和独立验收。
8. 以单独域提交并推送；不混入其他租户 service 或 AI 模块。

## 验收命令与通过条件

```text
cd apps/api
.venv\Scripts\python.exe -m pytest -q tests\verification\test_f17a_attachments.py
.venv\Scripts\python.exe -m compileall app
cd ..\web
pnpm build
pnpm exec eslint .
```

必要时追加：

```text
cd ..\api
.venv\Scripts\python.exe tests\verification\run_f17b_attachments_frontend.py
```

通过条件：

- 现有 F17a/F17b 主路径和全部权限/隔离/失败/并发断言通过；
- F16a→F17a 顺序回归不再出现 Windows unlink 竞态；
- router 不再直接承担附件 ORM 查询、文件校验和事务；
- 两个前端页面只通过 `api/attachments.ts` 调用附件端点；
- wire contract、错误码、状态码、ID 格式和个人附件 404 隐私语义不变；
- 默认 API、compileall、build、ESLint 通过；真实浏览器验收单独记录限制。

## 明确不做

- 云对象存储、病毒扫描、预览、保留策略和大文件分片上传。
- 修改附件归属模型或把个人附件改为跨 Workspace 全局资源。
- 引入 repository 或 OpenAPI 自动生成 client。
- 改造全局 problem response；附件旧调用方兼容问题另列任务。

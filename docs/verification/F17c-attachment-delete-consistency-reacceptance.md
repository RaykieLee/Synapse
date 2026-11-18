# F17c 附件删除一致性修复复验

复验日期：2026-11-18
结论：指定 F17c/F17a 定向测试通过；alternate 存储不可用时保留权威对象及元数据、修复后可重试的行为得到验证。S3 是模拟；真实 RustFS CRUD 与生产数据仍未验证，因此本报告不构成 F17c 生产验收。

## 复验范围

依据并检查了 `docs/tenancy-contract.md`（身份/作用域分离和资源归属）、`docs/attachment-api.md`（附件授权及删除顺序）、`docs/ux/attachment-deletion-consistency.md`（失败语义与验收标准）、原始报告 `docs/verification/F17c-attachment-s3-storage.md`，以及附件服务、HTTP API 和 F17c/F17a 定向测试。未修改产品实现或测试；本报告是本次唯一写入文件。

## 自动化证据

从 `apps/api` 原样运行指定命令：

```text
.venv/Scripts/python.exe -m pytest tests/verification/test_f17c_attachment_s3_storage.py tests/verification/test_f17a_attachments.py -q
```

本次捕获的 pytest 输出：

```text
.......                                                                  [100%]
=============================== warnings summary ===============================
tests/verification/test_f17c_attachment_s3_storage.py::test_attachment_storage_migration_is_verified_reversible_and_read_only
tests/verification/test_f17c_attachment_s3_storage.py::test_simulated_alternate_store_delete_failure_preserves_authoritative_object_for_retry
tests/verification/test_f17a_attachments.py::test_f17a_attachment_storage_api_and_migration
tests/verification/test_f17a_attachments.py::test_f17a_attachment_storage_api_and_migration
tests/verification/test_f17a_attachments.py::test_f17a_attachment_storage_api_and_migration
  C:\Users\Lenovo\orca\workspaces\synapse-repo\�ܹ�����\apps\api\.venv\Lib\site-packages\alembic\config.py:604: DeprecationWarning: No path_separator found in configuration; falling back to legacy splitting on spaces, commas, and colons for prepend_sys_path.  Consider adding path_separator=os to Alembic config.
    util.warn_deprecated(

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
7 passed, 5 warnings in 7.04s
```

5 条 warnings summary entries 共指向 Alembic `path_separator` 未配置而回退到旧式路径拆分的 `DeprecationWarning`；测试成功，无失败或跳过。

| 验收点 | 证据 | 结果与限定 |
| --- | --- | --- |
| Alternate 不可用时保留权威对象 | `apps/api/tests/verification/test_f17c_attachment_s3_storage.py:213` 注入内存 S3 alternate 删除不可用；`apps/api/app/services/attachments.py:262` 先删除 alternate，再删除元数据所指向的当前后端对象。测试断言异常发生后本地权威对象内容仍在、模拟 S3 副本仍在，数据库附件记录仍存在。 | 通过。此测试明确是模拟 S3 与临时本地对象，不是真实 RustFS。 |
| 错误映射和安全响应 | 服务捕获 `AttachmentStoreUnavailable` 并转换为 `AttachmentStorageUnavailable`（`apps/api/app/services/attachments.py:276`–`:284`）；HTTP adapter 将服务错误的状态码及稳定错误码放入响应 detail，未包含原始异常（`apps/api/app/api/attachments.py:43`–`:47`；DELETE 路由 `:161` 起）。F17c 用例断言服务层抛出 storage-unavailable 错误；F17a API 用例断言本地清理失败为 `500 FILE_CLEANUP_FAILED`（`apps/api/tests/verification/test_f17a_attachments.py:216` 起）。 | 服务层故障分类及 adapter 映射代码相符。局限：本次 F17c alternate 删除失败断言在服务层，没有直接断言该确切故障经 HTTP 请求后的 `503 ATTACHMENT_STORAGE_UNAVAILABLE` wire 响应。 |
| 元数据与重试 | F17c 测试在 alternate 删除失败后读取 DB 确认附件记录仍在；关闭故障后以同一附件再次调用 delete 并提交，断言本地与模拟 S3 对象均清除、数据库记录不存在（同文件 `:239`–`:264`）。F17a 还覆盖本地 unlink 失败保留元数据/文件后重试成功（`apps/api/tests/verification/test_f17a_attachments.py:216`–`:240`）、flush 故障后对象已清理但记录保留并可重试（`:306`–`:327`），以及对象缺失时幂等清理（`:241` 起）。 | 通过。F17a 中标为 `commit_failed` 的用例实际注入的是 `Session.flush`，不能据此声称真正数据库 commit 阶段故障已验证；UX 契约也要求把它准确称为 flush 故障。 |
| Workspace 授权 | 删除服务先按经过验证的 tenant、Workspace、scope 查询目标，再要求 Workspace 删除具有 `resource:delete`；路径、租户和 Workspace 过滤由 `workspace_scope` 与额外条件实现（`apps/api/app/services/attachments.py:262`–`:331`）。F17a API 测试覆盖无删除权限返回 403，以及跨 Workspace/租户下载拒绝（`apps/api/tests/verification/test_f17a_attachments.py:132`–`:145`）。 | 通过定向行为与代码检查。资源 ID 本身不作为授权依据。 |
| Personal 404 隐私 | `personal_scope` 按 owner、tenant 和 Workspace 限定查询；`_get_attachment` 无匹配时抛出统一 `AttachmentNotFound`，非所有者删除也抛相同错误（`apps/api/app/services/attachments.py:272`–`:331`；`apps/api/app/tenancy/scopes.py:47`）。F17a 覆盖其他成员查看列表为空、跨 Workspace 下载 404、同 Workspace 非所有者下载和删除 404，以及所有者删除成功（`apps/api/tests/verification/test_f17a_attachments.py:151`–`:164`）。 | 通过代码路径和所列 API 行为检查。测试没有逐字比较未知 ID、跨作用域 ID 与非本人 personal ID 的完整响应体；相同 404/code 由共用查询异常和 adapter 映射推得，不能声称响应体逐字段等价已被该测试断言。 |

## UX/契约核对

- 租户成员资格不替代 Workspace 授权；附件按 Workspace 共享或个人私有归属处理，服务端校验上下文和 `resource:delete`，个人附件仅本人可删。符合租户契约和附件 API 中的归属、授权边界。
- 删除流程先处理配置的 alternate 保留副本，再处理当前权威后端对象，最后删除并 flush 元数据。存储任一步失败都会在元数据删除之前退出；alternate 失败时因此保留权威对象，可安全重试。此顺序满足附件 API 与 UX 验收的“alternate 失败不能误报成功、记录可重试”要求。
- UX 契约另列真正 commit 故障、UI 确认框内失败提示/重试、焦点与读屏、320 CSS px/200% 缩放等验收。本次任务只运行指定 API 测试，未验证前端状态、辅助功能、真实 commit 故障或生产环境行为。

## 明确未验证

- **S3 是模拟**：F17c 的删除故障测试使用内存 S3 替身。真实 RustFS 认证连接、Bucket/Object CRUD、故障恢复与生产数据迁移/回滚均未在本次复验中执行；真实 RustFS CRUD/生产数据仍未验证。
- 本次只运行用户指定的两个 pytest 文件；未运行更大测试套件、全项目构建或线上探测。
- F17c alternate 故障的 HTTP 503 响应未由此新增/执行专门 API 集成断言；未知 ID 与非本人 personal ID 完整响应的逐字段相同性亦未由指定用例显式比较。
- 真正数据库 commit 阶段失败及 UX 文档列出的前端视觉、键盘、读屏和窄屏测试不在本次证据范围内。

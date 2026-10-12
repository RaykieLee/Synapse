# F17a 附件本地存储验收

## 2026-10-12 基线回归：瞬态 Windows unlink 冲突

- 当前实际基线 `896b66a` 的默认 API 套件首次复跑为 `22 passed, 1 failed, 25 deselected`；失败发生在 F17a 两个并发 DELETE 的一个请求，返回 `500 INTERNAL_ERROR`。
- 根因是 Windows 并发删除时，第二次 `Path.unlink(missing_ok=True)` 可能短暂抛出 `PermissionError`，而目标文件在一次性的 `stat()` 检查时仍存在。旧逻辑将这个短暂共享冲突误判为 `FILE_CLEANUP_FAILED`。
- `apps/api/app/api/attachments.py` 新增有限重试的 `_unlink_storage_file()`：确认文件仍存在后按 `10ms/50ms/100ms` 重试；文件已经消失时按幂等成功处理；持续占用或其他 I/O 错误仍返回 `500 FILE_CLEANUP_FAILED`。
- `tests/verification/test_f17a_attachments.py` 新增确定性 FastAPI 回归：第一次 unlink 注入“文件仍存在的 `PermissionError`”，第二次调用恢复真实 unlink，要求 DELETE 返回 `204`、metadata 删除且磁盘文件不存在。该段是模拟操作系统竞态，不等同于真实 Windows 内核故障注入。
- 修复后证据：F17a 定向用例 `1 passed`；F16a→F17a 顺序组合连续 `8/8` 通过；默认 API 套件 `23 passed, 25 deselected, 37 warnings`；`compileall`、`pnpm build` 通过；ESLint `0 errors, 24 warnings`。
- 这些证据仍不替代 PostgreSQL、多副本共享存储、Redis 标记套件或浏览器独立验收。

## 2026-10-12 Windows 并发 unlink 修复复核

- 基线复跑发现，两个 DELETE 请求都读取同一附件后，Windows 偶发在后一个 `Path.unlink(missing_ok=True)` 上抛出 `PermissionError`（WinError 5 / errno 13），即使文件此时已经被另一个请求删除。临时探针确认异常后目标路径不存在；移除父目录操作的最小双线程环也能复现，300 轮中出现 121 次该异常。
- `apps/api/app/api/attachments.py` 现在仅在 `PermissionError` 后 `stat()` 确认文件已不存在时按并发重复删除处理；文件仍存在或 `stat()` 仍失败时，保留原来的 `500 FILE_CLEANUP_FAILED` 和 metadata 回滚行为。
- 回归用例通过真实 FastAPI `TestClient` 调用 DELETE，并在文件已删除的状态下注入 Windows `PermissionError`。**注入的是模拟的操作系统竞态结果**；原有双线程 API 并发删除用例仍实际运行。
- 定向 F17a 用例在修复后连续 10 次通过；API 默认套件 `23 passed, 25 deselected`。这些是本地实现者复核，新的竞态修复仍待独立复验；不替代 PostgreSQL、多主机存储或真实 AgentScope 验收。

## 结果

修复 DELETE 一致性问题后复验通过。本测试将临时 SQLite 数据库迁移到当前 Alembic head（本次运行是 `0013_tenant_resource_summaries`），并使用真实 FastAPI multipart 请求和临时文件目录。

从 `Synapse/apps/api` 运行：

```text
.venv/bin/pytest -q tests/verification/test_f17a_attachments.py
1 passed, 3 warnings
```

警告为 Alembic 既有的 `path_separator` 缺失设置，不影响测试。测试运行两次，两次均通过，包括同步并发删除场景。

## 覆盖证据

- 从 Alembic `0010_tenant_configs` 开始，插入租户/workspace/账户数据，然后迁移到当前 head。确认附件复合 workspace/tenant foreign key、SQLite `PRAGMA foreign_keys=1`，以及预置租户/workspace 记录仍保留。
- 使用真实 TestClient multipart 请求和临时附件目录，执行 workspace 上传/列表/下载/删除。检查 metadata、文件字节、cache/no-sniff headers、数据库行移除和磁盘清理。
- 确认个人附件仅 owner 可见；其他 workspace/租户 ID 会隐藏。平台级用户不能访问 workspace 文件，viewer 可读取但不能上传，普通成员不能删除共享 workspace 内容。
- 确认 removed tenant membership、archived workspace 和 suspended tenant 均会阻止访问。
- 确认路径遍历式文件名会以 basename 存储；拒绝不支持的扩展名、声明类型不匹配、无效 PDF 内容和空文件。损坏的持久化 storage key 不能读取存储目录之外的文件字节。恰好 25 MiB 的文本文件可以上传；25 MiB + 1 byte 会被拒绝。
- **unlink `OSError`：** DELETE 返回 `500 FILE_CLEANUP_FAILED`；附件 metadata 和磁盘文件均保留。随后重试 DELETE 成功并同时移除两者。
- **磁盘文件已不存在：** DELETE 返回 204 并移除残留 metadata。
- **磁盘 unlink 后 DB commit 失败：** 注入失败后返回 500，metadata 删除回滚且记录仍可用。用此时已不存在的文件重试 DELETE，返回 204 并移除记录。
- **并发重复删除：** barrier 会让两个请求都先解析记录；两次 DELETE 均返回 204，metadata 行和磁盘文件均被删除。
- **上传 DB commit 失败：** 请求返回 500，不留下 metadata 行，并清理已写入的文件。

## 验收环境限制

此 API 虚拟环境未安装 AgentScope；将同级源码目录加入 `PYTHONPATH` 时，目前会因缺少 `aiofiles` 而停止。为使检查限定在附件功能，脚本只将 `app.main.create_agentscope_app` 替换为空 FastAPI child。附件 routes、身份认证、数据库、存储及 DELETE 实现均为真实代码；本测试不验证 F20b AgentScope embedding/lifespan。本次仅为单进程 SQLite，使用注入故障；未覆盖 PostgreSQL、多主机存储或真实磁盘/断电故障。也未覆盖每种受支持图片/Office 格式的成功上传。

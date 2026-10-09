# F17a 附件本地存储验收

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

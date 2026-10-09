# F18b3 附件 metadata 对账处理器验收

## 结果

通过。直接调用生产处理器，使用已迁移至 Alembic `head` 的临时 SQLite 数据库和隔离的附件根目录。检查为只读，范围限定在所选租户的附件 metadata。未修改产品代码。

在 `apps/api` 中运行：

```bash
.venv/bin/pytest -q tests/verification/test_f18b3_attachment_reconcile.py
```

2026-10-02 实际结果：`1 passed, 1 warning in 0.37s`。警告为 Alembic 既有的 `path_separator` 弃用提示。

## 证据

Fixture 为 Tenant A 创建七条附件 metadata 行，为 Tenant B 创建一条有效记录。Tenant A 的引用包括：一个有效常规文件、一个缺失文件、大小不匹配、无效 storage key、带符号链接的分片、以目录代替常规文件，以及解析后位于根目录之外的路径。处理器报告：

```json
{
  "metadata_count": 7,
  "present_file_count": 2,
  "consistent_file_count": 1,
  "exception_count": 6,
  "exception_ids": {
    "invalid_storage_key": ["f18b3-a-key"],
    "storage_path_outside_root": ["f18b3-a-outside"],
    "missing_file": ["f18b3-a-missing"],
    "not_regular_file": ["f18b3-a-directory", "f18b3-a-symlink"],
    "unreadable_file": [],
    "size_mismatch": ["f18b3-a-size"]
  },
  "read_only": true
}
```

响应中的 tenant ID 是 Tenant A 的十进制字符串；Tenant B 的有效行和 ID 均未出现。没有 metadata 的磁盘孤儿文件不会被报告。测试对目录遍历 API（`Path.iterdir/glob/rglob`、`os.scandir` 和 `os.walk`）进行埋点记录；没有调用这些 API。所有附件的 tenant/workspace/storage-key/size 字段，以及已知文件的类型、大小、mtime 和内容，在操作前后的快照完全一致。符号链接、目录、孤儿文件和 Tenant B 对象均保留。

非法 tenant IDs（`0`、负数、`bool`、float、string 和 `None`）会触发 `ValueError`；正数但不存在的租户会触发 `LookupError`。

## 根目录约束分支说明

对于配置的规范根目录和严格 32 位十六进制 storage key，常规 fixture 无法稳定构造持久路径逃逸：解析前会拒绝符号链接组件。为确定性地覆盖显式的 `storage_path_outside_root` containment 分支，测试仅对一个有效 key 候选的 `Path.resolve()` 做 stub，使其返回配置根目录之外的路径，以模拟解析竞态/逃逸。磁盘上的实际符号链接独立创建，并归类为 `not_regular_file`。

## 验收文件与限制

- `apps/api/tests/verification/test_f18b3_attachment_reconcile.py`

这是针对本地磁盘和 SQLite 的直接处理器验收。没有启动 scheduled-task poller 或 dispatcher，也未模拟并发文件系统变更或 PostgreSQL 文件系统部署拓扑。处理器响应中包含 unreadable-file exception 类别，但本次没有注入 OS 级别的不可读/stat 故障。

# F15a 租户字典 API 与迁移验收

**结果：通过（临时 SQLite / FastAPI TestClient）**

## 验收范围

运行脚本 [test_f15a_tenant_dictionaries.py](../../apps/api/tests/verification/test_f15a_tenant_dictionaries.py)，对 tenant dictionary type/value API 和 Alembic `0009_tenant_dictionaries` 进行端到端检查。测试先将临时数据库迁移到 `0008_tenant_departments`，写入已有租户、角色、菜单、部门及菜单授权记录，再升级到 head，确认既有数据仍可读取。

覆盖内容：

- head 修订为 `0009_tenant_dictionaries`；字典类型及条目表、唯一约束和 `(dict_type_id, tenant_id)` 复合外键已创建。
- 同名和同 key 字典类型可分别存在于两个租户；类型、条目读写和跨租户 ID 请求均保持租户隔离。
- 字典类型和条目新增、详情、更新、删除；分页、名称/类型/标签/状态筛选；排序重排；启停状态。
- 同租户重复类型 key/name 和同字典类型重复 value 返回 409；其他字典类型可复用同一个 value。
- 有条目的字典类型删除返回 `DICT_TYPE_HAS_DATA`；移除条目后删除成功。
- 租户 owner/admin 可管理；普通 member、无该租户成员关系的平台管理员和另一租户 owner 被拒绝。
- 应用 SQLite 连接 `PRAGMA foreign_keys` 为 1；直接插入 tenant B 条目并引用 tenant A 字典类型时，复合外键拒绝写入。

## 运行证据

```text
.venv/bin/python -m pytest -q tests/verification/test_f15a_tenant_dictionaries.py
1 passed, 3 warnings in 0.48s
```

警告来自 Starlette/httpx 的弃用提示，以及 Alembic 配置缺少 `path_separator` 的弃用提示；本次验收没有发现字典 API 或迁移失败。

## 限制

该验收使用单进程临时 SQLite 和 TestClient；没有覆盖 PostgreSQL、并发写入、生产数据规模或真实部署配置。验收脚本中的测试数据和 JWT secret 均为临时本地值。

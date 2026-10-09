# SQLite 外键约束启用

FastAPI 的 SQLAlchemy 引擎在 `apps/api/app/database/session.py` 中启用 SQLite 外键约束。调用 `get_engine()` 时，SQLAlchemy 会解析 `SYNAPSE_DATABASE_URL`，并且仅在后端为 SQLite（包括带 SQLite 驱动标识的 URL）时注册监听器。该监听器会在每个 DBAPI 连接进入连接池前执行 `PRAGMA foreign_keys=ON`，因此既覆盖初始连接，也覆盖应用引擎后续创建的连接。

因此，SQLite 会对以下约束执行检查：

- `tenant_member_roles`：Alembic revision `0005_tenant_member_roles` 定义的租户/成员及租户/角色组合外键。
- `tenant_menus`：Alembic revision `0006_tenant_menus` 定义的租户/父级组合外键。

PostgreSQL 和其他非 SQLite 引擎不会注册此监听器，也不会执行 SQLite pragma。此设置仅适用于 FastAPI 应用缓存的 `get_engine()` 所创建的连接；独立脚本、迁移引擎及其他单独创建的 SQLite 引擎必须自行启用该 pragma。启用约束不会扫描或修复数据库中既有的外键违规记录，只会影响后续写入以及 SQLite 执行的完整性检查。

# F16a 租户参数配置 API 验收

## 结果

通过。测试使用临时 SQLite 数据库，从 `0009_tenant_dictionaries` 升级到当前 Alembic head `0012_tenant_scheduled_tasks`，并通过真实 FastAPI `TestClient` 调用配置 API。

执行命令：

```bash
cd apps/api
.venv/bin/python -m pytest -q tests/verification/test_f16a_tenant_configs.py
```

结果：`1 passed`。测试期间记录 Starlette TestClient 与 Alembic 配置的弃用警告，不影响结果。

## 覆盖结果

- 迁移在既有租户、成员、字典表与数据存在时从 0009 升级到 head；保留原字典数据，创建配置表、租户内 config key 唯一约束，并确认 SQLite `PRAGMA foreign_keys=1`。
- 两个租户的 owner/admin/member 真实成员关系用于构造权限上下文。同一 config key 可分别存在于两个租户；同租户重复创建与修改为重复 key 均返回 409。
- owner/admin 可创建、筛选、读取详情、修改、停用和删除配置；列表筛选覆盖 config key 与敏感标记。
- 敏感配置的创建、列表、修改响应均将 `config_value` 置空且 `value_redacted=true`；owner/admin 的详情请求返回明文，并包含 `Cache-Control: private, no-store`。普通配置详情也设置 no-store。
- public 接口仅返回当前租户中已启用、前端可见且非敏感的键值；响应设置 `Cache-Control: private, no-store`。成员可调用 public 接口，但管理列表/详情/写入均返回 403。
- 两个租户的 public 投影隔离；停用项从 public 结果消失。敏感且标为 frontend 的组合创建被拒绝。
- 通过另一租户配置 ID 进行 GET、PATCH、DELETE 均返回 404；删除当前租户配置后详情返回 404。

## 验证范围说明

测试针对参数配置和租户 API；`create_app` 中与本范围无关的 AgentScope 子应用用最小空 FastAPI 子应用替代，以免启动外部 Redis/AgentScope 服务。API 主应用、路由、认证、数据库依赖均为真实实现。

## 验证文件

- `apps/api/tests/verification/test_f16a_tenant_configs.py`

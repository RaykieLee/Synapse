# F12c 租户成员自定义角色 Service 化验收

## 当前结论

F12c 的业务行为保持不变，并已将成员角色分配的业务规则从 router 提取到 `TenantMemberRoleService`。本次迁移不新增前端交互，不改变 HTTP 路径、请求字段、响应字段、错误码、状态码或 ID 字符串化规则。

## 方案与边界

- `app/api/tenant_member_roles.py` 只负责依赖注入、路径/请求解析、response model 和 204 状态码。
- `app/services/tenant_member_roles.py` 负责内置 owner/admin 权限边界、成员与全局用户状态、角色作用域、赋权/替换/撤销、`membership_version` 递增和并发唯一键竞争。
- `app/schemas/tenant_member_roles.py` 保持 `role_id` 字符串输入和已赋权/未赋权两种原有响应形状。
- service 只使用 `flush()`；请求级 `get_db()` 负责成功提交和异常回滚。
- 并发相同赋权使用内部 savepoint 处理唯一键竞争，获胜请求提交后，竞争请求可返回同一最终赋权而不重复递增版本号。

## 验证结果

在 `main` 的 `af0c889` 之后的工作树中运行：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests\verification\test_f12c_tenant_member_roles.py
.\.venv\Scripts\python.exe -m pytest -q tests\verification\test_f12a_tenant_role_api.py tests\verification\test_f12c_tenant_member_roles.py
.\.venv\Scripts\python.exe -m compileall app
```

结果：

- F12c 独立回归：`1 passed, 1 warning`
- F12a + F12c 联合回归：`2 passed, 3 warnings`
- `compileall app`：通过
- router/service 边界扫描：通过；两个文件均不含 `HTTPException`、显式 `commit()` 或显式 `rollback()`
- Alembic 的 `path_separator` 弃用提示仍存在，不影响本次结果

## 覆盖范围与限制

测试覆盖 owner/admin 赋权、普通成员自读、平台管理员拒绝、跨租户资源拒绝、内置角色保护、失效成员/用户/角色、幂等重复赋权、替换、权限版本联动、撤销、并发收敛和复合外键约束。

本次没有验证生产数据库、多进程并发、真实模型推理或前端视觉路径；因为本项是后端分层迁移，前端 wire contract 未变，不新增 UX 验收范围。

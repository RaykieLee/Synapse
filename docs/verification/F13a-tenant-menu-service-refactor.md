# F13a 租户菜单 Service 化验收

## 当前结论

F13a 菜单管理和 F13d1 成员可见菜单树已完成渐进式 service 化。菜单 CRUD、树构建、排序、软删除、跨租户父级约束和可见树授权行为保持不变；前端 wire contract 未修改。

## 方案与边界

- `app/api/tenant_menus.py` 只负责依赖注入、查询/请求解析、response model、`Cache-Control` 响应头和 HTTP 状态码。
- `app/services/tenant_menus.py` 负责菜单管理权限、租户作用域、父级状态、循环检测、树投影、可见树祖先过滤、角色菜单授权读取、软删除和 `flush()`。
- `app/schemas/tenant_menus.py` 集中保存原有请求校验和各类平铺树/导航树响应模型。
- F13c 角色-菜单授权 router/service 未在本次修改；可见树只读取其既有授权数据。
- router/service 均不显式调用 `commit()`、`rollback()` 或抛出 `HTTPException`；事务继续由 `get_db()` 托管。

## 验证结果

在 `main` 的 `47367c1` 之后的工作树中运行：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests\verification\test_f13a_tenant_menu_api.py tests\verification\test_f13d1_visible_menu_tree.py
.\.venv\Scripts\python.exe -m compileall app
cd ..\web
pnpm build
pnpm exec eslint .
```

结果：

- F13a + F13d1 定向回归：`2 passed, 3 warnings`
- 默认 API 套件复跑：`23 passed, 25 deselected, 37 warnings`
- `compileall app`：通过
- `pnpm build`：通过
- ESLint：`0 errors, 24 warnings`
- router/service 边界扫描：通过；菜单 router/service 不含 `HTTPException`、显式 `commit()` 或显式 `rollback()`
- 默认套件第一次运行出现一次与本次改动无关的 F17a Windows 并发 DELETE `500/204` 时序失败；F17a 单测独立复跑通过，随后完整默认套件复跑通过。未修改 F17a 产品代码。

## 覆盖范围与限制

定向验收覆盖菜单创建、列表/搜索/状态过滤、树排序、字段更新、重排、循环和父级校验、软删除、跨租户隔离、复合外键，以及 owner/admin、成员、平台管理员和自定义角色的可见树、祖先过滤、`membership_version` 与 `private, no-store`。

本次没有修改前端，因此没有新增浏览器 UX 范围；未验证生产数据库、多进程并发菜单修改或真实模型推理。

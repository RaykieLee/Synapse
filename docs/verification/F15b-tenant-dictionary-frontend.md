# F15b 租户字典管理前端验收

## 结果

通过。完整运行 `pnpm build`，然后以临时 SQLite 数据库迁移 Alembic `head`，启动真实 FastAPI 和 Vite，并用 Playwright 操作页面并检查真实 API 返回。

执行命令：

```bash
cd apps/api
.venv/bin/python tests/verification/run_f15b_tenant_dictionary_frontend.py
```

验证环境初始缺少项目声明依赖 `python-multipart`，已仅安装至本地 `.venv`（版本 0.0.32），未更改项目依赖文件。最终全量运行的前端构建成功。

## 覆盖结果

- 同一账号在 Tenant A、B 具备管理角色；两租户使用相同字典类型标识 `color`，类型与条目数据不串租户，返回 A 后仍显示 A 数据。
- 字典类型列表及条目列表各有 21 条，分别通过页面分页；按类型标识、条目标签筛选后结果正确。
- 页面创建、编辑字典类型并由 API 确认；页面启停和类型排序均在真实 API 中持久化。
- 页面创建、编辑字典条目并由 API 确认；页面启停和条目排序均在真实 API 中持久化。
- 删除类型下仍有条目的类型，API 返回 409，页面显示“请先删除该字典类型下的所有条目。”；删除条目后 API 返回 404；无条目的类型删除成功。
- 普通成员在租户详情页看不到“字典管理”入口；直达字典路由显示权限提示、没有创建操作，字典 API 返回 403。

## 验证文件

- `apps/api/tests/verification/run_f15b_tenant_dictionary_frontend.py`
- `apps/api/tests/verification/f15b_tenant_dictionary_frontend.mjs`

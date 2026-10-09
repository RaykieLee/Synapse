# F14b 租户部门管理前端验收

## 结果

通过。使用临时 SQLite 数据库迁移到 Alembic `head`，启动真实 FastAPI、Vite，并通过 Playwright 操作部门页面和 API。

执行命令：

```bash
cd apps/api
.venv/bin/python tests/verification/run_f14b_tenant_department_frontend.py
```

脚本先执行 `pnpm build`，再创建临时数据并启动服务；完成后清理临时数据库和服务。

## 覆盖结果

- `pnpm build` 成功。
- 同一用户在两个租户分别拥有 owner/admin 角色；A、B 部门树内容及返回 A 时的缓存数据均相互隔离。
- 通过页面创建部门和子部门；移动部门后由 API 返回的 parent ID 与整条祖先路径更新正确。
- 页面“上移”触发真实同级排序 API，排序后的树顺序正确。
- 页面停用、启用操作均成功，并由 API 读取到持久化状态。
- 叶节点删除成功；非叶节点删除被 API 拒绝，页面显示“请先删除或移动此部门下的子部门。”。
- 用并发父级变更模拟过期编辑，环提交被拒绝，页面显示“部门父级关系不能形成循环。”。
- Tenant B 的 admin 可在 B 创建部门，B 树不显示 A 的资源。
- 普通成员查看租户详情时看不到“部门管理”入口；直接进入部门路由显示权限错误且没有创建控件，真实树 API 返回 403。

## 验证文件

- `apps/api/tests/verification/run_f14b_tenant_department_frontend.py`
- `apps/api/tests/verification/f14b_tenant_department_frontend.mjs`

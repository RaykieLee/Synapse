# F13d2 Workspace 动态侧栏独立验收

## 结论

通过本次 F13d2 验收。`pnpm build` 成功；脚本在临时 SQLite 数据库迁移到 Alembic 当前 head（`0010_tenant_configs`）后，启动真实 FastAPI 和 Vite，并用 Playwright Chromium 操作 Workspace 侧栏。验证脚本：`apps/api/tests/verification/run_f13d2_dynamic_sidebar.py` 与 `apps/api/tests/verification/f13d2_dynamic_sidebar.mjs`。

## 覆盖与结果

- 同一 owner/admin 账号通过 Workspace 切换器从 Alpha 租户的两个 Workspace 切换到 Beta 租户 Workspace。Alpha 与 Beta 的动态菜单互不串用；owner/admin 可看到本租户可见的菜单。
- 自定义角色普通成员只能看到授予的父菜单和叶菜单。不可见父级及其子项均不显示。没有角色授权的普通成员看到空的动态菜单树。
- 页面加载目标租户菜单时，上一租户菜单立即清除；目标菜单在请求完成前不显示。延迟的旧租户请求在切换完成后返回，也没有回流到侧栏。
- 动态菜单请求返回 503 时，旧租户菜单不保留，新租户菜单也不显示；固定系统入口仍可用。
- 通过真实租户角色菜单 API 撤销全部授权后，以成员身份重新加载 Workspace；更新后的 membership version 对应空菜单，已撤销项不再出现。
- Workspace 壳保留固定“租户管理”系统入口。旧模板业务侧栏入口 Dashboard、Tasks、Apps、Chats 不进入 Workspace 左侧菜单。

## 执行记录

命令：

```sh
apps/api/.venv/bin/python apps/api/tests/verification/run_f13d2_dynamic_sidebar.py
```

结果：`F13d2 dynamic sidebar browser verification passed`。构建输出为 `✓ built`；Alembic 临时数据库按顺序应用 `0001` 至 `0010`。初次运行脚本时，浏览器内从 Vite 页面直接 `fetch` API 受跨源限制；改为由 Node 验证进程直接请求本地 API 后，完整流程复跑通过。该调整仅在验证脚本中，没有修改产品代码。

## 边界

仅验收 Workspace 左侧动态菜单装载、作用域切换和请求状态呈现；未验证菜单链接对应的业务资源页面权限，也未覆盖真实浏览器中的跨设备/多标签竞争。

# 字典页查询键运行态修复

日期：2026-11-20

## 修复内容

- 条目查询键将 `selectedTypeId` 从 resource path 移到 params。页面初始未选类型时，静态资源路径保持非空；失效操作按条目列表资源前缀刷新当前租户下的条目查询。
- 类型标识的 HTML pattern 转义连字符，兼容 Chromium `v` 正则模式并保留字母、数字、下划线、点和连字符。
- 未修改 HTTP/API 契约。

## 验证证据

- `pnpm exec tsc -b --pretty false` 通过。
- 使用本地 Vite、FastAPI、临时 SQLite 演示库和本地 Redis 在 Chromium 打开 `/tenants/1/dictionaries`。未选类型时页面正常显示空态；通过 UI 创建 `Demo dictionary` 后，条目管理对话框正常显示空条目态。
- 在新浏览器页的类型表单输入 `pattern-check`，浏览器原生 `validity.valid` 为 `true`、`patternMismatch` 为 `false`；该页控制台没有错误。

## 局限

- 验证使用本地临时数据，仅覆盖初始空选择、已选类型的条目列表和类型标识校验；未覆盖完整条目 CRUD、跨租户访问或生产环境。

# 租户优化增量独立验收记录

日期：2026-10-12

## 当前结论

独立子智能体真实 API 验收 5 项通过；其 Playwright 脚本首次因 locator 使用不当而未完成。主代理修正 locator 后做了浏览器诊断复跑，确认 owner 选择等主流程可用，同时复现国际化差距。该诊断不是独立 UI 验收。因此，近期租户优化**尚未整体独立验收通过**，尤其不能把中英文页面验收标为通过。此次验收没有修改产品代码。

## 运行环境

- Windows；使用 `apps/api/.venv`、临时 SQLite 数据库、Alembic 迁移至 `0016_tenant_validity`、真实 FastAPI 和真实 Vite 代理。
- 一次性测试用户、租户、Workspace、邀请均只写入临时 SQLite；不连接生产数据库。
- 浏览器通过本机 Playwright Chromium 可见窗口访问临时 Vite 实例，页面 API 请求转发到临时 FastAPI。
- AgentScope 和计划任务在临时实例中关闭；本验收不覆盖这些依赖。

API 验收运行器由独立子智能体创建在 `%TEMP%\synapse-independent-1f7b1b7f2fd04331b239ec7bd099ae9b\run_audit.py`，执行命令为：

```powershell
$env:SYNAPSE_AUDIT_TMP = 'C:\Users\Lenovo\AppData\Local\Temp\synapse-independent-1f7b1b7f2fd04331b239ec7bd099ae9b'
& 'D:\Projects\MyPorject\Synapse\synapse-repo\apps\api\.venv\Scripts\python.exe' `
  "$env:SYNAPSE_AUDIT_TMP\run_audit.py"
```

## 真实 API 验收

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 筛选与 `total`/分页同源 | 通过 | 对 `q=Audit Acme&page_size=2` 请求第 1、2 页，`total` 均为 3；依次返回 A、B、C。 |
| UTC 有效期边界 | 通过 | `current/not_started/expired/unlimited` 数量为 `4/1/1/1`；无时区筛选边界及倒置有效期创建均返回 `422`。 |
| 平台目录可见性不扩张成员权限 | 通过 | 平台管理员可列出 6 个租户，但其普通租户列表与 Workspace 列表为空；所选 owner 可列出其 Workspace。 |
| 创建租户时 owner 选择与持久化 | 通过（API） | 真实创建接口指定首位 owner 后，租户详情和 `/me/context` 均确认该账号为 owner。搜索选择器 UI 另见浏览器结果。 |
| 邀请过期 `410` 与持久化 | 通过 | 接受请求返回 `410 INVITATION_EXPIRED`；直接检查临时数据库，邀请状态为 `expired`。 |

## 浏览器验收

临时 Playwright 脚本通过 `C:\Users\Lenovo\.codex\skills\playwright-skill\run.js` 运行。最初的独立脚本把 `role="toolbar"` 错用 `getByLabel()` 定位，并把 owner 搜索占位文本错当作标签；主代理修正 locator 后重新运行，避免把测试定位错误误报为产品故障。该复跑只作为诊断证据，最终 UI 验收仍须由独立子智能体执行。

已验证：

- 中文页面租户搜索结果正确；搜索变化同步更新 URL 和列表结果。
- 创建租户对话框能搜索并选择首位 owner；选择结果状态可见。
- 租户标识、名称、有效期开始和结束控件均有可访问名称。
- 切换到 English 后 `document.lang` 更新为 `en`；owner 标签、创建表单字段、租户筛选工具栏名称和搜索框 accessible name 可定位。
- 390px 窄屏下无水平溢出；控制台及页面未观察到错误。

未通过/待修：

- 中文模式下，租户筛选工具栏的 `aria-label` 实际呈现英文 `Tenant filters`，与 `document.lang=zh-CN` 不一致。
- 切换 English 后，租户列表主标题和平台管理员说明仍为中文。
- 英文分页文案未形成可读的 `Page 1 of 1` 结构；当前实现把中文片段分别翻译，无法表达英文页码语序。
- 表格状态、角色以及日期格式的实现仍有硬编码中文路径（见 `apps/web/src/features/tenants/components/tenant-table.tsx` 与 `apps/web/src/features/tenants/types.ts`），需要 UX 审查后确定本次正式导航范围的验收面。

以上为本轮浏览器诊断证据，不代表完整 UX/i18n 验收通过。需先完成独立 UX 审查并针对差距修复，再由不同子智能体重新运行浏览器验收。

## 限制

- 未验证生产环境或真实多进程数据库并发。
- 未覆盖邀请邮件投递、模型推理或 AgentScope 服务。
- 临时运行器和浏览器验收脚本位于 `%TEMP%\synapse-independent-1f7b1b7f2fd04331b239ec7bd099ae9b`；运行器遗留临时 SQLite、日志和脚本，需在核对绝对路径后清理。

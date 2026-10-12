# 租户优化增量独立验收记录

日期：2026-10-12

## 当前结论

前半部分记录了首次独立 API 验收和主代理诊断阶段的差距。截至 2026-10-12，另一独立子智能体已在未修改产品代码的前提下完成真实 API 与 Chromium 复验，F09 本轮增量**独立验收通过**。平台管理员零租户空态使用拦截模拟；加载态没有人为延迟下的独立时序断言，因此这两项仍明确保留为限制。此次独立验收没有修改产品代码。

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

## 修复后定向浏览器复跑（主代理诊断，非独立验收）

日期：2026-10-12。使用新的临时目录 `%TEMP%\synapse-f09-polish-77384e20f1d1469f9030ba02dad30670`，临时 SQLite 迁移至 `0016_tenant_validity`，真实 FastAPI、Vite proxy 和可见 Chromium。未连接生产数据库；AgentScope 与计划任务关闭。

结果：以下定向检查通过。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 中文和 English 列设置菜单 | 通过 | 管理员菜单显示中文 `标识/状态/有效期/创建时间`；成员菜单英文完整显示 `Slug/Status/Validity period/My role/Created at`。管理员菜单按权限不展示角色列。 |
| 列表失败与重试 | 通过 | Playwright 临时注入 `503 TEST_TEMPORARY_FAILURE` 后显示 `role="alert"` 和重试按钮，不显示空结果；点击重试后真实 API 数据恢复。 |
| 超范围页码 | 通过 | 访问 `page=99`，数据返回后 URL 自动改为 `page=1`。 |
| 筛选空态和成员空态 | 通过 | 真实 API 搜索无匹配租户显示筛选空态；无租户成员关系的用户显示“无可访问启用租户”空态。 |
| 双语标题、分页与可访问名称 | 通过 | English 下标题为 `Tenant Management`、分页为 `Page 1 of 1`、搜索 accessible name 为 `Search tenants`、工具栏名称为 `Tenant filters`。 |
| 窄屏与页面错误 | 通过 | 390px viewport 的 `scrollWidth/clientWidth` 为 `390/390`；除预期注入的 503 外，无控制台或页面错误。 |
| 平台管理员真正零租户空态 | UI 分支通过，API 未实测 | Playwright 对列表端点返回临时空 `200` 响应，确认显示 `No tenants yet`；并非真实空数据库响应。 |

同一临时运行器的 5 项真实 API 检查（筛选分页、UTC 有效期、权限隔离、owner 落库、邀请过期）均通过。运行器及临时数据只用于本机诊断；本节不是独立子智能体验收，不能将任务状态改为“独立验收通过”。此前发现的英文标题/说明、分页、状态/角色/日期和列菜单差异已在当前工作树修复；最终仍需独立验收。

## 独立复验（2026-10-12）

独立子智能体在当前工作树上运行，未修改产品源码、现有文档或 Git 状态，未执行 `reset`、`stash`、`clean`，也未触碰已有服务。使用临时 SQLite、真实 FastAPI、真实 Vite 和 Chromium：

- 临时目录：`C:\Users\Lenovo\AppData\Local\Temp\synapse-f09-independent-e2fba9aea3c148d48bc165965530b1d3`
- API/Vite 端口：`53940` / `53941`
- 运行结束后临时服务已退出；本次 F09 不需要 Redis

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 筛选与 `total`/跨页结果同源 | 通过 | `q=Audit Acme` 第 1/2 页均为 `total=3`，跨页返回 A/B/C |
| 有效期 UTC 边界与反向区间 | 通过 | `current/not_started/expired/unlimited` 为 `4/1/1/1`；无时区边界和 `valid_from > valid_until` 均 `422` |
| 平台目录可见性不扩张租户/Workspace 权限 | 通过 | 平台目录 6 个；普通租户列表和平台管理员 Workspace 列表为 0；指定 owner 可见其 Workspace |
| 创建租户时 owner 选择并持久化 | 通过 | 指定 `first_owner_user_id` 后详情为 `owner`，`/me/context` 保留该关系 |
| 过期邀请 `410` 与持久化 | 通过 | 创建 `201`，接受 `410 INVITATION_EXPIRED`，数据库状态为 `expired` |
| 中英文真实浏览器交互与可访问性 | 通过 | 标题、说明、状态、角色、日期、分页、搜索/筛选/列菜单名称、错误重试、空态、页码回退、分页边界、390px 窄屏和控制台异常均通过 |

以下结果是明确的拦截模拟，不是真实空库结果：拦截 `GET /platform/tenants` 返回 `200` 且 `items=[]/total=0`，用于确认平台管理员 `No tenants yet` 空态。

## 限制

- 未验证生产环境或真实多进程数据库并发。
- 未覆盖邀请邮件投递、模型推理或 AgentScope 服务。
- 临时运行器和浏览器验收脚本位于 `%TEMP%\synapse-independent-1f7b1b7f2fd04331b239ec7bd099ae9b`；运行器遗留临时 SQLite、日志和脚本，需在核对绝对路径后清理。
- 早期主代理诊断脚本曾缺少中英文说明、状态标签和日期格式的显式断言；独立复验已补足这些断言。平台管理员零租户空态仍是网络拦截的模拟响应，不是真实空数据库结果。
- 独立复验通过源码检查确认加载状态包含 `role="status"`、`aria-live="polite"`、`aria-busy="true"` 和隐藏文案，但没有人为延迟下的运行时加载时序断言；这不影响已通过的错误、空态、分页和窄屏检查。

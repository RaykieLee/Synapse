# F09 租户列表交互与国际化修复方案

日期：2026-10-12

## 范围

本轮只修复租户正式列表页的交互反馈、分页边界和中英文展示一致性：

- 列表请求失败与空结果分开呈现，并提供重试。
- 当前页超出服务端返回的总页数时回到有效页。
- 平台管理员与普通成员使用准确的空态文案；筛选无结果时明确提示。
- 英文页面的标题、说明、状态、角色、日期、分页和筛选控件使用完整英文。
- 加载状态和错误状态具备可访问的语义。

本轮不改变后端路由、请求参数、响应字段、状态码、错误码、权限范围、缓存键或数据库结构；创建/编辑对话框的完整英文覆盖作为后续独立子任务处理。

## 归属与契约

- 数据归属：平台租户目录或当前账号所属的 active 租户，沿用现有 `GET /platform/tenants` 与 `GET /tenants`。
- 权限：平台目录可见性不扩张租户或 Workspace 成员资格；本轮不新增权限。
- 列表状态：继续由 URL 的 `page`、`pageSize`、筛选参数驱动；筛选和 page size 变更仍回到第 1 页。
- 失败行为：读取失败显示稳定的可重试错误态，不把失败当作零结果；重试复用当前 Query，不新增接口。

## 文件边界

- `apps/web/src/features/tenants/index.tsx`：列表 Query 错误态、重试、页码回退和上下文空态。
- `apps/web/src/features/tenants/components/tenant-table.tsx`：筛选/分页/表格可访问文案、加载语义和 locale-aware 展示。
- `apps/web/src/features/tenants/types.ts`：locale-aware 日期与租户文本辅助函数。
- `apps/web/src/lib/i18n.ts`：本轮正式列表页面所需的双语词条。
- `docs/development-status.md`：分别记录设计、代码、静态检查和独立验收状态。

## 验收条件

1. `GET /tenants` 或 `GET /platform/tenants` 返回 4xx/5xx 时，页面显示 `role="alert"` 错误和重试操作，不显示“暂无租户”。
2. 重试成功后错误态消失并显示真实列表。
3. 直接访问超出范围的 `page`，或筛选后当前页失效时，URL 自动回到第 1 页；真实零结果仍显示空态。
4. 中文和 English 切换无需刷新，列表标题、说明、筛选工具栏 accessible name、状态、角色、日期、分页和空态均使用对应语言。
5. English 分页可读为完整句子，例如 `Page 1 of 1`、`0 selected, 3 total`。
6. 390px 窄屏不产生页面级横向溢出，列表错误、空态和分页控件仍可操作。
7. 不改变现有 API/权限/隔离行为；默认 API 测试、`compileall`、前端构建和 ESLint 通过。

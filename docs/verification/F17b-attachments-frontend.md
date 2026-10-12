# F17b Workspace 附件前端独立验收

## 结果

通过。`pnpm build`（`tsc -b` 和 Vite production build）成功；真实 Chromium/Playwright 浏览器通过 Vite 访问真实 Synapse FastAPI+AgentScope 同进程应用，使用临时 SQLite Alembic head、临时附件目录和现有 Redis 7 容器完成 UI/API 联调。验收过程中修复了附件域前端 API/交互、中文 locale 反向翻译以及 Windows Vite 子进程清理问题。

## 复现命令

从 `apps/api` 执行：

```powershell
$env:F17B_REDIS_HOST = '127.0.0.1'
$env:F17B_REDIS_PORT = '16381'
.venv\Scripts\python.exe tests\verification\run_f17b_attachments_frontend.py
```

Runner 会再次执行 `pnpm build`，建立 Alembic head 临时库，启动实际 FastAPI 应用、AgentScope 子应用生命周期和 Vite，再启动 Playwright Chromium 流程。Redis 使用 DB 13、14，runner 在前后清空这两个 DB；本次使用的容器为宿主机 `127.0.0.1:16381` 上的 Redis 7.4.11。迁移 head 为 `0016_tenant_validity`。

## 覆盖证据

- 构造两个 active tenant、三个 active Workspace 和两个账号。账号 A 跨租户拥有 Alpha One owner、Alpha Two member、Beta One admin 权限；账号 B 在 Alpha One 为 member、Beta One 为 owner。两账号均使用签名 JWT。
- 检查侧栏真实“附件”入口和左上角 Workspace 选择器；通过选择器搜索并切换 Alpha One、Alpha Two、Beta One，确认租户分组可见。
- 账号 A 在 Alpha One 的 Workspace 范围通过 UI 上传、列表显示、下载并核对原始内容、确认删除。个人范围也通过 UI 上传、列表和下载；账号 B 在同一 Workspace 切换到个人范围时看不到账号 A 的个人文件。账号 A 后续能删除自己的个人附件。
- Alpha Two 中账号 A 的角色是 member：上传 Workspace 附件成功，但该列表行没有删除控件。Beta One 中角色是 admin：Workspace 附件删除控件显示且删除成功。
- Alpha One/Alpha Two/Beta One 切换后，上一空间列表项不会沿用；选中文件尚未上传时切换空间，`待上传`文件名随页面卸载而清除。
- `.exe` 扩展名和 25 MiB + 1 字节文件在浏览器选择阶段显示错误且没有发起上传请求。对合法扩展名 `.pdf` 选择错误内容，真实后端返回 415，UI 显示“文件内容与所选类型不匹配。”；绕过前端再次向真实 API 上传 25 MiB + 1 字节 multipart 内容，后端返回 413 `FILE_TOO_LARGE`。F17a API 验收另已覆盖 25 MiB 边界成功。
- 第二个账号在 Alpha One 可读取共享附件，但无删除控件。选择待上传文件期间，runner 的 loopback 验收控制路由将其 WorkspaceMember 改为 removed；真实附件上传请求被后端拒绝为 403，界面呈现非空错误反馈。重新加载后空间详情复核拒绝访问并回退至其仍可访问的 Beta One，之前的待上传文件和 Alpha One 行不再显示。
- 浏览器执行期间没有 `pageerror`；真实 runner 最终输出 `F17b Workspace attachment frontend verification passed`，退出码 0。

首次开发 runner 时出现的 Playwright 断言/复现脚本问题已在验证脚本内修正；同时固定验收 locale，避免可访问名称随本机浏览器状态漂移。Windows runner 现在会终止 pnpm 的完整子进程树，避免 Vite 日志句柄阻塞临时目录清理。

## 文件与边界

- `apps/api/tests/verification/run_f17b_attachments_frontend.py`
- `apps/api/tests/verification/f17b_attachments_frontend.mjs`
- `apps/web/src/api/attachments.ts`
- `apps/web/src/features/workspaces/attachments-page.tsx`
- `apps/web/src/features/workspaces/sessions-page.tsx`
- `apps/web/src/lib/i18n.ts`
- `docs/verification/F17b-attachments-frontend.md`

此验收使用单进程 Uvicorn、SQLite 和本地临时附件目录，不代表 PostgreSQL、跨进程共享文件系统或生产部署可靠性。25 MiB 精确边界的成功由 F17a API 验收覆盖；本报告中的 UI 验证覆盖客户端超限拒绝及服务端超限拒绝。权限撤销由仅存在于 runner 创建的 loopback app 实例上的验收控制路由触发，不是产品 API。

# F11a 全局用户管理前端独立验收

**结果：通过。** 最终运行在 F12d 文件稳定后完成，`pnpm build`、临时数据库迁移和本地 Chromium 浏览器流程均通过。

## 可复跑脚本

```sh
cd Synapse/apps/api
.venv/bin/python tests/verification/run_f11a_user_management_frontend.py
```

脚本先执行 `pnpm build`，然后在临时 SQLite 中迁移至 `0003_tenant_invitations`，创建平台管理员、普通账号、目标账号和 22 个分页种子用户，启动真实 FastAPI 与 Vite，在 Chromium 中操作用户管理界面。完成后终止服务并删除临时数据库。

脚本文件：

- `apps/api/tests/verification/run_f11a_user_management_frontend.py`
- `apps/api/tests/verification/f11a_user_management_frontend.mjs`

## 已观察证据

- 当前实现的 `/users` 页面调用 `/api/v1/users`，覆盖真实分页搜索、创建、资料编辑、启停、密码重置和软删除动作；路由与侧边导航均对普通平台账号限制访问。
- 最新完整运行成功：`F11a global user management frontend verification passed`，进程退出码 0。`pnpm build` 的 TypeScript 检查与 Vite production build 通过，Alembic 临时数据库成功迁移到 `0003_tenant_invitations`。
- 保留的早期历史：F12d 文件尚未稳定时构建因 `MemberCustomRole` 暂态错误失败，主任务确认是并发编辑；稳定后完整构建通过。此失败不计入最终 F11a 结论。
- 自动化脚本调试历史：初版搜索检查在 URL 参数 debounce/查询刷新前读到旧数据，已改为等待搜索 URL 与总数更新。测试邮箱最初使用保留的 `.test` 域名，`EmailStr` 按规范拒绝；改用 `.com` 测试域。最终脚本所有步骤通过。这些是验证脚本问题，不是产品缺陷。
- Faker 检查：新 `/users` 页面源文件没有 Faker 导入，其行数据由 API 响应渲染。旧 `/clerk/user-management` 演示路由仍导入 Faker 数据，但按主任务范围归入 F43 遗留范围清理，不作为 F11a 新全局管理入口的失败项；后续浏览器检查将确认新页面列表只包含临时 API 数据。

## 验证结果

- 平台管理员进入 `/users` 后看到分页种子数据；每页 10 条并正确显示 3 页，搜索按用户名及邮箱定位 API 数据，页面可翻页。
- 管理员通过真实创建表单新增用户，页面确认创建成功，新账号平台角色为普通 `user`。重复邮箱提交返回冲突并显示“用户名或邮箱已被使用。”错误反馈。
- 管理员编辑目标用户昵称、邮箱后，表格与服务端搜索返回更新结果。
- 停用账号会撤销已有 access token；重新启用不会让旧 token 恢复有效。管理员通过页面重置密码后，旧 token 失效，新密码登录成功。
- 确认软删除后账号从列表/搜索中移除，当前 token 被撤销。
- 普通用户侧边栏不显示 Users；直接打开 `/users` 后由客户端路由跳转到 `/403`，不呈现用户管理页面。
- Faker 检查：新 `/users` 页面源文件没有 Faker 导入，浏览器表格中的 10 个首屏账号全部来自临时 API 数据（`f11a-` 前缀）。旧 `/clerk/user-management` 演示路由仍保留 Faker 模块，按主任务约定记入 F43 遗留范围清理，不计为 F11a 失败。

## 范围与限制

运行环境为本地 Vite、FastAPI、SQLite 和 Chromium；不覆盖部署环境、其他浏览器或并发数据库写入。直接在临时数据库种下管理员、普通账号、目标用户与分页数据；增删改、启停、密码重置、搜索和授权页面行为均通过真实 API/界面完成。

## 2026-10-11 回归

用户 API 前端调用集中到 `src/api/users.ts` 后，production 构建、TypeScript 检查和针对 `src/api/users.ts`、`src/features/users/index.tsx` 的定向 ESLint 均通过（0 errors）。本次顺带移除用户页三个同步 effect 内 setState 的 React hooks lint 错误，改为渲染期状态同步和按目标用户 key 重建的对话框表单。

随后完整重跑 F11a 浏览器验收，最终输出 `F11a global user management frontend verification passed`。同时修复该运行器在 Windows 下无法解析 `pnpm`、未终止 pnpm/Vite 子进程树的问题，与其他浏览器验收脚本保持一致。

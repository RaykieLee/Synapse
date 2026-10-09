# F23a2 Workspace Agent 管理前端验收

## 验收结果

**核心 Agent 管理与 Workspace 隔离流程通过；只读 Agent 控件分支未验证。**

### Build 与执行环境

- `pnpm build`（`apps/web`）：通过，`tsc -b` 与 Vite production build 成功。
- `apps/api/.venv/bin/python apps/api/tests/verification/run_f23a2_agent_management_frontend.py`：通过。
- 运行器另行执行 build，创建临时 SQLite 并 Alembic 升级到 head（0015），使用本机 Redis DB 5（storage）/DB 4（bus），启动 FastAPI、Vite 与无头 Playwright。
- 此次执行迁移完整通过，Playwright 输出 `F23a2 Agent management frontend verification passed`，退出码 0。

### 浏览器与 API 覆盖

- Alpha、Beta 两个租户、Alpha 两个 Workspace、Beta 一个 Workspace，以及同 Workspace 的第二 actor。Agent 管理 UI 在 Alpha 创建、详情、编辑、删除均成功；编辑后提示词更新可见。
- 不合法的上下文配置 JSON 被前端验证拦截，并显示表单错误。
- 在 Beta 建立 Agent 后，以 Alpha Workspace selector 请求该 Beta Agent 的详情，真实 API 返回 404；Beta 列表仅含 Beta Agent。
- 通过 Workspace 切换器往返 Alpha/Beta，列表未串租户；新打开的编辑草稿为空；第二 actor 在共享 Alpha Workspace 看到空列表。
- 删除 Alpha Agent 后重新读取真实 API 列表，已无该 Agent。

### 未验证项及边界

- **只读 Agent 控件分支未验证：** 当前服务端 Agent 详情适配器始终返回 `editable: true`，且存储/列表路径只返回当前 actor 私有 Agent；本次真实 API fixture 无法产生 `editable: false` 记录。因此不能声称只读视图正确。
- 404 隔离通过浏览器中的真实 API 直达请求验证；UI 的 detail 404 提示分支无法从当前真实列表路径触发，未做伪造/mock 响应测试。
- 这次首次 build 曾被 F24 会话页缺少 `getNextPageParam` 阻断，F25a 更新后 build 通过；首次失败作为并发暂态，不计入 F23a2 产品缺陷。

## 可复跑脚本

```bash
apps/api/.venv/bin/python apps/api/tests/verification/run_f23a2_agent_management_frontend.py
```

脚本先执行 `pnpm build`，之后准备独立临时 SQLite 数据库并迁移至 head，连接本地 Redis 的独立 DB 4/5，启动 FastAPI 与 Vite，再运行 Playwright。要求本地 Redis 可在 `127.0.0.1:6380` 访问；可通过 `F23A2_REDIS_HOST` 和 `F23A2_REDIS_PORT` 覆盖。运行结束会清理其 `f23a2` Agent fixture。

## 覆盖范围

- 两个租户、三个 Workspace、两个 actor 的真实数据隔离。
- 创建、详情、编辑和删除当前 actor 的 Agent；表单 JSON 错误反馈。
- Beta Agent ID 在 Alpha Workspace 直达请求返回 404。
- Workspace 切换后的列表缓存隔离和未保存草稿清空。
- 同 Workspace 另一 actor 看不到创建者的 Agent。
- 只读 Agent 控件分支须由真实 API 提供 `editable: false` Agent 后补验；当前真实数据路径不支持构造此类记录。

## 验收边界

要完整关闭 F23a2 的验收边界，还需为真实只读 Agent 定义/权限提供可验证的数据路径，再补测只读控件。核心创建、详情、编辑、删除、草稿切换、actor/Workspace 隔离已由真实浏览器与 API 覆盖。

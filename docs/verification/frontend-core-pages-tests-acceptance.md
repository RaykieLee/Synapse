# 前端核心复杂页面浏览器测试独立验收

日期：2026-11-19

范围：只读审查 Workspace 目录、租户角色、AgentScope Chat 三组指定浏览器测试及对应实现；本任务只新增本报告，不修改产品实现或测试。

## 结论

**PARTIAL（部分通过）**。指定浏览器测试全部通过，且能证明部分主要加载、空态、错误、权限门禁、交互与前端缓存隔离行为；但目录列表错误被界面当作空态展示，租户角色页缺少 actor/tenant 缓存切换断言，AgentScope 缺少 actor 切换及服务端撤权错误测试。所有请求均由测试 fixture 模拟，不能据此确认后端隔离或真实权限。

## 页面验收

### Workspace 目录 — PARTIAL

- `apps/web/src/features/workspaces/directory.test.tsx:194-218` 使用受控请求断言加载提示、空态，以及没有可创建租户时不显示写入动作。
- `:220-236` 模拟 Workspace 列表 503，断言不呈现无关 Workspace，且缓存进入 error 状态；`:238-326` 覆盖租户成员过滤、Workspace role 对归档空间的可见性、创建动作门禁、切换路由、最近访问记录和 actor A/B 的目录缓存数据分离。
- **缺口：**测试没有断言用户可见的错误提示或重试行为。实现 `apps/web/src/features/workspaces/directory.tsx:234` 只区分 `isLoading` 与非加载状态；请求失败后同样展示“没有匹配的可访问空间”，把错误误呈现为空态。租户目录请求失败也没有对应场景。

### 租户角色 — PARTIAL

- `apps/web/src/features/tenants/roles-page.test.tsx:221-275` 覆盖租户详情加载、角色列表空态和角色列表 503 告警，并确认失败不显示空态；`:277-290` 验证 tenant member 看不到管理入口且不会请求角色数据；`:292-337` 验证创建角色的权限载荷及请求始终落在路由租户 `42`。
- **缺口：**没有租户详情请求失败、admin 角色允许管理、角色写入失败/重试或同一 QueryClient 下切换 actor/tenant 的用例。测试路由固定为 tenant `42`（`:9-24`），因此 endpoint 检查只能证明当前调用路径，不能证明租户缓存键隔离。

### AgentScope Chat — PARTIAL

- `apps/web/src/features/agentscope-chat/page.test.tsx:375-415` 覆盖 Agent 列表加载、空态和 503；`:416-440` 验证 archived Workspace 禁止读取消息历史及发送请求；`:442-517` 验证发送失败保留草稿、成功重试、请求体作用域及重复中断锁定。
- `:519-579` 在同一 QueryClient 下切换 tenant/Workspace，检查会话列表变化、请求携带的 Workspace ID，以及两组 factory query key 不同且对应缓存成功。
- **缺口：**测试 actor 固定为 `actor-a`，没有同租户/Workspace 跨 actor 的页面切换；权限场景只覆盖 archived 本地门禁，没有覆盖服务端 401/403/404/409 撤权后隐藏历史、禁用写入或清理敏感缓存。列表状态覆盖集中于 Agent 列表，未分别验收会话列表和消息历史的加载、空态、错误恢复。

## 统一 Query Key 与隔离断言

- Workspace 目录与 AgentScope 测试通过统一 `queryKeys` 工厂构造缓存键，再读取 QueryClient 状态与缓存数据；目录用 actor A/B 的缓存内容互斥断言，AgentScope 用 tenant/Workspace 变化断言键不同并检查缓存成功。没有发现为了适配统一 key 而退化成只检查字符串常量的情况。
- 这些断言的预期键与生产代码共用 factory，避免重复硬编码键格式；代价是页面测试本身不独立验证 factory 的完整维度编码。租户角色页实现已使用 `queryKeys.tenant.query`（`apps/web/src/features/tenants/roles-page.tsx:92-108`），但其浏览器测试没有缓存键/数据隔离断言，仅检查请求路径和前端权限门禁。
- 目录测试的数据由 fixture 按当前 actor 直接提供，AgentScope 主要以同一 actor 下的 tenant/Workspace 组合验证；它们验证的是前端缓存/展示与请求上下文，不是服务端对伪造 tenant、Workspace 或 actor 的授权拒绝。

## 指定验证

- `pnpm exec vitest run src/features/workspaces/directory.test.tsx src/features/tenants/roles-page.test.tsx src/features/agentscope-chat/page.test.tsx --browser.headless`：退出码 `0`；3 个文件、10 项测试通过。
- `pnpm exec tsc -b --pretty false`：退出码 `0`，无诊断输出。
- `git diff --check`：退出码 `0`；`git diff --cached --check`：退出码 `0`。

## 限制

- 所有网络响应均来自测试内 `fetch` fixture；未连接 FastAPI、运行数据库、真实账号或真实租户/空间成员关系，因此不构成后端授权、数据隔离或并发撤权验收。
- 本轮按指定范围只运行三组浏览器测试、TypeScript build-mode 检查及两项 diff 检查；未运行全量测试、生产构建、真实浏览器端到端流程，也未验证移动端布局、键盘导航或辅助技术行为。
- 租户/Workspace 身份与缓存隔离的权威约束仍以 `docs/tenancy-contract.md` 为准；本报告不更新开发台账，由协调方决定是否登记后续补测/修复。

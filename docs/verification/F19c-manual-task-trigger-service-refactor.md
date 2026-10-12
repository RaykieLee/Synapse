# F19c 系统任务手工触发 Service/API 收口方案

## 范围

本项只迁移系统任务的“手工触发”用例和其前端 API 调用，不重写 F18a/F18c 已验收的任务定义 CRUD，也不改变调度器的内部 claim 生命周期。目标是把当前 `tenant_scheduled_tasks.py` 中的手工执行编排移到 application service，并把 `scheduled-tasks-page.tsx` 中散落的 HTTP 调用集中到 `apps/web/src/api/scheduled-tasks.ts`。

UX 主流程与失败状态以 [F19c2 手工触发 UX 与契约检查](../ux/F19c2-manual-task-trigger.md) 为准。

## 数据归属与权限

- 任务定义和运行记录都属于租户，由 `tenant_id + task_id` 复合范围约束。
- 只有当前租户 active `owner` / `admin` 可以触发、查看运行记录或管理任务定义。
- `member`、无成员关系的 `platform_admin`、停用租户成员和跨租户 task ID 不获得绕过。
- 任务执行目标只能来自已持久化定义，并继续经过 `app.tasks.dispatcher` 的闭合集合校验；客户端不能提交目标覆盖。
- 运行记录只返回安全结果摘要和稳定错误码，不返回参数、凭据、异常消息或 claim token。

## 不变 API 契约

```text
POST /api/v1/tenants/{tenant_id}/scheduled-tasks/{task_id}/runs
```

- 请求无 body。
- 成功接受一次独立执行后返回 `201` 和完整 run 投影；`status` 可以是 `succeeded` 或 `failed`。
- 业务 handler 失败仍返回 `201`，并在 run 中保存安全 `error_code`。
- 不存在、软删除或外租户任务：`404 RESOURCE_NOT_FOUND`。
- 停用任务：`409 TASK_UNAVAILABLE`。
- 已有有效计划 lease：`409 TASK_ALREADY_RUNNING`。
- 运行记录创建或终态保存失败：`500 RUN_RECORD_ERROR`。
- 不增加幂等键、不增加 retry endpoint；请求超时仍要求先查运行记录再决定是否发起新执行。

## Service 边界

`ManualScheduledTaskService.trigger(context, task_id)` 负责：

1. owner/admin 业务授权和 `(tenant_id, task_id)` 定位。
2. 检查软删除、启用状态和有效调度 lease。
3. 按租户/任务串行化同进程手工请求，并在支持行锁的数据库上保持任务锁直到本次 handler 完成。
4. 持久化 `running` 记录、调用同一个 allowlisted dispatcher、写入安全终态。
5. 将领域失败转换为 `ServiceError` 子类；不抛 `HTTPException`，不拼 HTTP 响应字典。

router 只负责依赖注入、路径参数、`201` 状态码和 response model。运行记录查询、任务 CRUD 的既有行为和 wire contract 不在本项重新设计。

手工执行需要在 handler 前后使用独立内部 session，原因是现有 F18b handler 是可被 scheduler 调用的持久化任务，并可能在其自身完成时提交业务副作用；不能把一个可能耗时的 handler 和 HTTP request session 混成一个事务。service 使用托管 transaction context 创建/终结 run 记录，避免在 router 中显式 `commit/rollback`；本项不把内部 scheduler 的后台事务误标为请求级 `get_db()` 事务。

## 前端 API 模块

新增 `apps/web/src/api/scheduled-tasks.ts`，集中导出：

- 任务、目标、运行记录及分页类型；
- `listScheduledTasks`、`listScheduledTaskTargets`；
- `createScheduledTask`、`updateScheduledTask`、`deleteScheduledTask`；
- `triggerScheduledTask`；
- `listScheduledTaskRuns`、`getScheduledTaskRun`。

`useQuery` / `useMutation`、缓存 key、确认框和运行状态仍留在页面组件。查询参数名称、ID 字符串化、状态码和错误码保持现状。

## 验收条件

### API

- owner/admin 成功触发并得到对应 run；
- member、跨租户 task、无成员 platform admin 被拒绝；
- 停用任务和有效 scheduled lease 分别返回稳定 `409`；
- 非空参数导致 dispatcher 失败时返回 `201` 且 run 为 `failed`，不泄露参数内容；
- 运行记录在租户范围内可查询，结果投影不泄露 claim hash、参数或异常栈；
- 同任务并发手工请求按现有契约串行、每次接受请求生成独立 run。

### 前端与静态检查

- 任务页不再直接拼接 scheduled-task API 路径；
- 手工运行成功、失败、不可用、已有运行、权限拒绝和不确定网络结果均保留现有 UX 文案语义；
- `pnpm build`、ESLint、F19c 定向 API 回归通过；
- 独立浏览器验收另行验证双击、响应丢失、租户切换、撤权、窄屏、键盘和中英文。

## 当前实现与验证结果

- 后端已将手工触发编排迁移到 `app.services.scheduled_tasks.ManualScheduledTaskService`；router 不再持有手工执行锁、run 记录写入、dispatcher 调用或终态序列化逻辑。
- 前端已新增 `apps/web/src/api/scheduled-tasks.ts`，页面不再直接拼接系统任务接口路径；Query/Mutation 和缓存 key 仍由页面组件持有。
- F19c API 定向测试：`1 passed`；默认 API 套件：`24 passed, 26 deselected`；`compileall app` 通过。
- 前端 `pnpm build` 通过（`2850 modules transformed`）；全量 ESLint `0 errors, 24 warnings`；系统任务页面、API 模块和浏览器验收脚本定向 ESLint 通过。
- 真实 API/Vite/Playwright 浏览器验收：`1 passed`。覆盖 owner/admin、member 拒绝、停用任务、有效 lease、handler 失败脱敏、双击单 POST、租户切换、撤权后的 `404 RESOURCE_NOT_FOUND`、窄屏键盘、英文模式和响应丢失提示。
- 使用 Docker Redis `127.0.0.1:16381` 的真实 F24b AgentScope/Vite/Playwright 验证通过；Redis 仅做连通性和隔离测试，没有清空 DB4/DB5。

相邻回归注意：F19a 的迁移 fixture 曾断言旧 head `0015_tenant_scheduled_task_runs`，已在独立提交 `7e9da42` 中修正为 `0014 → 0015 → 0016` 的真实迁移回归；使用当前 Docker Redis 的定向测试结果为 `1 passed`。Redis 全量标记套件仍有其他既有验收契约差异，详见 [Redis suite 复跑记录](redis-suite-2026-10-12.md)。

## 明确限制

本项不声称真实任务目标依赖的外部模型、渠道或多副本生产环境已验证。F19c 的“成功”只证明当前 allowlisted handler 在验收 fixture 中完成并写入 run 记录。

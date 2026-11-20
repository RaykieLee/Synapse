# 前端 OpenAPI 契约层独立验收（1/8）

日期：2026-11-19
结论：**通过（限本任务范围）**。

已先阅读仓库 `AGENTS.md` 与 `docs/tenancy-contract.md`。本次只验收 OpenAPI 生成流程、生成物、users/tenants/workspaces 类型接入和对应状态记录；没有修改产品实现，只新增本报告。

## 命令与证据

### 1. 当前 FastAPI schema 生成物复现检查

- 命令（仓库根目录）：`& '.\apps\api\.venv\Scripts\python.exe' 'scripts\frontend\openapi_codegen.py' --check`
- 退出码：`0`
- 证据：输出 `OpenAPI schema parsed; 67 paths, 126 component schemas; generated outputs current.`。检查脚本从当前 `apps/api` 导入 `app.create_app()` 并调用 `openapi()`；验证 OpenAPI 3.x、所有本地 `$ref`，再把确定性序列化结果与 `openapi.json`、`openapi.ts` 逐字比较。`--check` 分支只读，不重写生成物。
- 局限：证明当前 FastAPI app 的 schema 与生成文件一致，不证明所有 operation 的业务语义或前后端字段覆盖完整。

### 2. 前端 OpenAPI 验证脚本及类型编译

- 命令（`apps/web`）：`pnpm run openapi:verify`
- 退出码：`0`
- 证据：脚本完成 OpenAPI `--check`，随后执行 `tsc -b`，均通过；生成检查报告同样为 67 paths、126 component schemas。`package.json` 的 `openapi:generate` 与 `openapi:verify` 调用仓库级 Node wrapper；wrapper 根据平台选择 `apps/api/.venv` Python，并把工作目录设为仓库根目录。
- 局限：TypeScript 项目编译未运行 Vite 打包、浏览器交互或真实 API 请求。

### 3. API 调用行为差异核对

- 命令：`git diff HEAD -- apps/web/src/api/users.ts apps/web/src/api/tenants.ts apps/web/src/api/workspaces.ts`；并用 `rg -n "api<|method:|body:|headers:|URLSearchParams|JSON\.stringify|/users|/tenants|/workspaces"` 检索这三个文件。
- 退出码：`0`。
- 证据：差异是生成类型导入、别名和 `api<T>` 的编译期返回类型调整；URL、HTTP method、query 参数构造、`X-Workspace-ID` header 和 `JSON.stringify(...)` 请求体处理未改。`rg` 仍显示原有 GET/POST/PATCH/PUT/DELETE 路径与请求处理。
- 补充命令（`apps/web`）：`node --input-type=module`，由 stdin 脚本分别读取 `HEAD` 和工作树中的三个 API TypeScript 文件，经同一 `typescript.transpileModule` 配置转译后比较。
- 补充退出码：`0`；`users.ts`、`tenants.ts`、`workspaces.ts` 的 emitted JavaScript 均完全一致。
- 局限：编译输出一致能证明这三份文件的类型改动没有改变发出的 JavaScript；不替代真实 HTTP 请求或服务端授权测试。

### 4. 生成物敏感信息扫描

- 命令：PowerShell inline Python 扫描，将 `apps/web/src/api/generated/openapi.json` 与 `openapi.ts` 输入 `apps/api/.venv/Scripts/python.exe -`。
- 退出码：`0`。
- 证据：私钥 PEM 标记、JWT 样式 token、AWS/Google/Stripe/OpenAI/GitHub 常见 key、带凭据数据库 DSN、URL Basic Auth 和 Windows 用户目录路径的匹配数均为 `0`。OpenAPI 中非空 `example`/`examples` 数为 `0`，OpenAPI `servers` 数为 `0`；有 75 个非 null `default` 节点（含空字符串默认值），凭据/secret/token/key/DSN 字段默认值数为 `0`。
- 局限：扫描是已知格式的启发式检查，不能证明任意形式的敏感文本绝对不存在。生成脚本另将工作目录切到临时目录，并显式设置开发模式、内存 SQLite、空 JWT/加密密钥且关闭 AgentScope 和定时任务；未连接运行数据库，也没有执行真实 API 操作。

### 5. 补丁格式

- 命令：`git diff --check HEAD -- apps/web/package.json scripts/frontend/openapi_codegen.py scripts/frontend/run_openapi_codegen.mjs apps/web/src/api/generated/openapi.json apps/web/src/api/generated/openapi.ts apps/web/src/api/users.ts apps/web/src/api/tenants.ts apps/web/src/api/workspaces.ts docs/development-status.md docs/verification/frontend-openapi-contract-generation.md`
- 退出码：`0`。
- 证据：验收范围内差异无空白错误。
- 局限：格式检查不验证功能正确性。

## 类型覆盖与契约边界

- `openapi.json` 为 OpenAPI `3.1.0`，包含当前 FastAPI app 的用户、租户和 Workspace 路由；`openapi.ts` 标明由 `scripts/frontend/openapi_codegen.py` 生成。
- `users.ts` 的用户请求、列表及响应类型引用生成 schema；`tenants.ts` 的租户/成员请求、分页及响应类型引用生成 schema；`workspaces.ts` 的 Workspace、成员与转移所有权请求/响应也引用生成 schema。生成的 `user_id`、`tenant_id`、`workspace_id` 均为字符串，符合租户契约中 JSON ID 使用十进制字符串的约定。
- 生成流程从 `apps/api/app/main.py` 当前注册的 FastAPI app 导出 schema，而非手工维护的 JSON 副本；临时工作目录和隔离配置避免从仓库 `.env` 加载本地配置。生成文件检查结果与当前导出完全一致。
- `docs/development-status.md` 的 1/8 记录准确描述了本项覆盖范围以及筛选参数、部分状态/角色约束和其它 API 模块仍未迁移的情况。该记录当前仍写着“独立验收待安排”；主协调者应在接收本报告后更新状态。本 worker 未修改该文件。

## 未覆盖项与限制

- 当前生成器输出 component schemas，不生成完整的 operation path/query/header/response 客户端；其它 API 模块不在本次验收范围内。
- 列表筛选参数及部分状态/角色 union 仍是手写类型；本次确认调用逻辑未变化，不代表这些手写类型已与所有后端取值完全一致。
- 未验证真实凭据、数据库、浏览器流程或租户/Workspace 服务端隔离行为；也未以此项验收代替其它 1/8 架构工作或完整租户契约验收。

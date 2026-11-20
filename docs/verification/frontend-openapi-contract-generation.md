# 前端 OpenAPI 契约生成验证（1/8）

日期：2026-11-19
范围：新增 OpenAPI 导出与 TypeScript 类型生成流程；将 users、tenants、workspaces 三组核心类型接入生成 schema。未修改后端路由、服务或 wire contract。

## 验证结果

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 初始化指定 API Python 环境 | 在 `apps/api` 执行 `uv sync --frozen --extra dev` | 0 | 使用锁文件创建本地 `.venv`；`.venv` 为忽略文件，不属于提交改动 |
| 导出 OpenAPI 并生成类型 | 在仓库根目录执行 `apps/api/.venv/Scripts/python.exe scripts/frontend/openapi_codegen.py` | 0 | FastAPI schema 可解析，含 67 个路径、126 个组件 schema；生成 JSON 与 TypeScript 文件 |
| 检查生成物可复现且为最新 | 在仓库根目录执行 `apps/api/.venv/Scripts/python.exe scripts/frontend/openapi_codegen.py --check` | 0 | 两个生成文件均存在且与当前 API schema 一致 |
| TypeScript 项目编译 | 在 `apps/web` 执行 `pnpm exec tsc -b` | 0 | 通过 |
| 项目组合检查脚本 | 在 `apps/web` 执行 `pnpm run openapi:verify` | 0 | OpenAPI schema/生成物检查与 `tsc -b` 均通过 |
| 补丁空白检查 | 在仓库根目录执行 `git diff --check` | 0 | 通过 |

生成文件检查了私钥、常见 API key、JWT 与带凭据数据库 DSN 特征，没有发现凭据值。OpenAPI schema 中保留接口字段名称和类型定义，不含示例凭据。

## 契约覆盖与限制

- `apps/web/src/api/generated/openapi.json` 保存 FastAPI 导出的 schema；`openapi.ts` 标明由脚本生成，包含 OpenAPI component schemas。
- `src/api/users.ts`、`tenants.ts`、`workspaces.ts` 的主要请求、列表和响应结构引用生成 schema，函数路径、方法及请求处理保持原样。
- 用户输入参数映射、列表筛选参数、部分状态/角色联合类型仍为手写类型；其它 `src/api/*.ts` 模块暂未迁移。
- 本脚本目前生成组件 schema 类型，不生成各 operation 的路径、query、header 和响应客户端类型。
- 本记录证明 schema 可导出、生成物可复现并可通过 TypeScript 编译；没有执行浏览器或真实 API 验收。独立验收仍待安排，不代表全量契约迁移完成。

# Synapse 技术栈学习与开源质量路线图

本路线面向前端初学者，结合 Synapse 的实际实现逐层学习。目标是能够解释系统、阅读和修改代码、判断设计是否合理，并参与开源维护。这里列出的学习主题不代表对应产品功能已经完成；实现状态以 development-status.md 和独立验收报告为准。

## 学习方式

每次只讲一个主题，沿用六个步骤：要解决的问题 → 最小例子 → Synapse 代码位置 → 实际调用流程 → 常见错误与质量要求 → 小练习与复述。

每个主题分三个层次：先能解释用途，再能读懂当前代码，最后能独立完成一个小改动并说明影响。不要求先背完整 API，也不以阅读文档数量衡量掌握程度。

讲解中明确区分框架提供的能力、Synapse 自己实现的约定，以及尚未完成的规划。现有代码也需要审查，不应当作所有写法都正确的范本。

以下路径相对于 Synapse 项目根目录。技术版本以 package.json、锁文件和 pyproject.toml 为准；学习某个库的具体行为时，再结合当前安装版本阅读官方文档。

## 第一阶段：认识完整系统（2 次）

1. 前端、后端、数据库和浏览器分别做什么；开发环境与部署环境的区别。
2. 从点击按钮到数据库返回结果：URL、HTTP、JSON、状态码、请求头、Cookie、请求与响应。

代码入口：apps/web/package.json、apps/web/src/main.tsx、apps/web/src/lib/api.ts、apps/api/app/main.py。

练习：在浏览器开发者工具中找到一个 Workspace 请求，说出请求地址、响应结果及它来自哪一层。

掌握标准：能画出一个请求经过的组件，能区分页面地址与 API 地址。

## 第二阶段：前端语言基础（5 次）

3. HTML：标签、语义、表单、按钮和可访问名称。
4. CSS：盒模型、Flex、Grid、响应式、层叠和主题变量。
5. JavaScript：变量、对象、数组、函数、模块与解构。
6. 异步：Promise、async/await、异常、请求取消和竞态。
7. TypeScript：类型、接口、联合类型、泛型、类型收窄、可选值；编译检查与运行时校验的区别。

代码入口：apps/web/src/features/workspaces/types.ts、apps/web/src/lib/api.ts、apps/web/src/styles/。

练习：读懂 Workspace 类型，给一个小表单增加字段，解释字段缺失时如何处理。

掌握标准：能读懂常见 .ts/.tsx 表达式，知道 any、类型断言和 as never 为什么需要谨慎使用。

## 第三阶段：工程怎样启动和构建（3 次）

8. Node.js 与 pnpm：运行环境、依赖、开发依赖、脚本、版本范围和锁文件。
9. Vite：开发服务、热更新、插件、路径别名、环境变量和 API 代理。
10. TypeScript 构建与部署产物：dev、build、preview 的区别；静态文件如何被服务器提供。

代码入口：apps/web/package.json、apps/web/vite.config.ts、apps/web/tsconfig*.json。

练习：解释 pnpm build 的两步过程；定位一个类型错误，说明为什么开发页面能打开但构建可能失败。

掌握标准：知道浏览器可见环境变量不能保存服务端密钥，知道生产环境需要自己的 API 转发和路由回退配置。

## 第四阶段：React 页面与组件（5 次）

11. JSX、组件、props 与组件组合。
12. useState：状态变化与重新渲染；列表 key 与条件渲染。
13. 表单事件与受控输入；把重复界面抽成组件。
14. useEffect、useRef、清理逻辑和异步请求竞态。
15. Context、Provider、自定义 Hook、组件职责和状态归属。

代码入口：apps/web/src/main.tsx、apps/web/src/components/layout/、apps/web/src/features/workspaces/context.tsx。

练习：实现一个含加载、空结果、错误和正常结果的小列表；切换对象后不残留旧对象的内容。

掌握标准：能解释 props、state、Context 的区别；知道何时需要 Effect，避免把可直接计算的数据重复存成状态。

## 第五阶段：TanStack Router 路由（3 次）

16. 文件路由、动态参数、根路由、无路径布局、嵌套路由与 Outlet。
17. Link、navigate、搜索参数、刷新、分享链接与浏览器前进后退。
18. beforeLoad、登录检查、Workspace 检查、加载状态、错误页与预加载。

代码入口：apps/web/src/routes/、apps/web/src/routeTree.gen.ts、apps/web/src/features/workspaces/context.tsx。

练习：沿 /w/某个ID/agents 追踪父子路由；给一个页面增加可复制的筛选条件。

掌握标准：知道生成的路由文件不应手工维护，前端路由检查不能替代后端权限；能识别重复校验请求和绕过类型检查的导航写法。

## 第六阶段：接口与 TanStack Query（4 次）

19. 请求封装：fetch、请求头、JSON、统一错误和 AbortSignal；识别项目遗留 Axios 用法与实际 api() 封装。
20. useQuery：queryKey、queryFn、加载和错误状态、缓存、staleTime、重新获取与重试。
21. useMutation：新增修改删除、刷新相关查询、乐观更新及失败回滚。
22. 多租户缓存：用户、租户、Workspace 和权限版本；延迟响应、切换空间、退出登录和撤权。

代码入口：apps/web/src/lib/api.ts、apps/web/src/main.tsx、apps/web/src/features/workspaces/directory.tsx。

练习：追踪 Workspace 列表的获取与切换；解释为什么两个空间的查询不能共用一个不带空间标识的缓存键。

掌握标准：能分清网络请求与缓存管理，知道何时刷新、清除或保留缓存，能处理请求失败而不丢失用户输入。

## 第七阶段：状态、表单和界面体系（5 次）

23. 状态分工：React 本地状态、URL、Context、Zustand、TanStack Query 各适合保存什么。
24. React Hook Form 与 Zod：字段、默认值、校验、错误提示；前后端都要校验的原因。
25. Tailwind CSS：工具类、设计变量、暗色主题、间距与响应式。
26. shadcn/ui 与 Radix：组件源码归属、交互基础、弹窗焦点、键盘操作和可访问性。
27. TanStack Table 及辅助库：筛选、排序、分页；Lucide 图标、Sonner 通知、Recharts 图表、date-fns 日期按实际需要学习。

代码入口：apps/web/src/stores/、apps/web/src/components/ui/、apps/web/src/components/data-table/、apps/web/src/styles/、apps/web/src/features/users/。

练习：完成一个表格加编辑弹窗，并覆盖提交中、失败、无权限、空列表及移动端状态。

掌握标准：能解释数据放在哪里的理由；新页面复用现有样式和交互，不制造第二套组件规范。

## 第八阶段：Python 与 FastAPI（4 次）

28. Python 阅读基础：模块、类、类型注解、异常、虚拟环境、同步与异步。
29. FastAPI：路由、参数、请求体、响应模型和依赖注入。
30. Pydantic 与配置：运行时数据校验、环境配置、敏感配置管理。
31. ASGI、Uvicorn、应用工厂与 lifespan：服务如何启动、持有资源和退出。

代码入口：apps/api/pyproject.toml、apps/api/app/main.py、apps/api/app/api/、apps/api/app/core/config.py。

练习：沿一个 Workspace GET 请求读完路由、依赖和响应；解释 401、403、404、409 与校验错误的区别。

掌握标准：能增加一个简单接口，明确输入、输出、权限和失败行为。

## 第九阶段：数据库与迁移（3 次）

32. 关系数据库：表、主键、外键、唯一约束、索引、事务与并发。
33. SQLAlchemy：模型、会话、查询、提交和回滚；查询条件中的租户边界。
34. Alembic：迁移版本、升级、已有数据兼容；SQLite 与 PostgreSQL 的运行差异。

代码入口：apps/api/app/models/、apps/api/app/database/session.py、apps/api/app/database/migrations/。

练习：追踪租户、成员和 Workspace 表关系，解释为什么跨租户关联要用数据库约束保护。

掌握标准：字段变化有迁移，写操作有事务边界，能说明索引和约束解决的具体问题。

## 第十阶段：账号、权限与多租户（3 次）

35. 认证：密码哈希、登录令牌、Cookie、令牌有效性和退出登录。
36. 授权：平台、租户、Workspace 的角色与成员关系；菜单可见性和 API 权限的区别。
37. 数据隔离：服务器确认身份和空间归属，资源 ID 校验、撤权、归档、个人私有资源和日志脱敏。

代码入口：apps/api/app/auth/、apps/api/app/tenancy/、apps/api/app/api/workspaces.py、apps/web/src/stores/auth-store.ts。

练习：说明普通成员为何不能靠修改 URL 或请求头读取其他空间的数据；列出一次 Workspace 切换涉及的前后端动作。

掌握标准：能追踪一个接口的认证、授权和数据过滤，并区分这三步。

## 第十一阶段：AgentScope 与流式 AI（5 次）

38. AgentScope 对象：Agent、Session、Message、Tool、模型和运行目录；协作 Workspace 与运行目录的区别。
39. 嵌入 FastAPI：子应用、生命周期、身份网关、存储适配器和上游版本固定。
40. Redis：记录存储、消息总线、命名空间、持久化与故障恢复；不同逻辑库不等于独立安全边界。
41. SSE：增量事件、重连、去重、取消、断流、工具结果与人工确认。
42. 扩展能力：MCP、Skills、模型凭据、知识库、向量检索、渠道和任务；逐项区分已经接入与尚待实现的部分。

代码入口：apps/api/app/integrations/、apps/web/src/features/workspaces/agents-page.tsx、apps/web/src/features/workspaces/sessions-page.tsx。

练习：画出一次发送消息到流式展示的链路；解释切换 Workspace 后为什么旧事件不能继续写入新页面。

掌握标准：能区分模型调用成功、API 接受成功和受控测试事件；能说明凭据解密、存储隔离和后台任务身份的边界。

## 第十二阶段：后台任务、文件与运行保障（2 次）

43. 系统任务：计划、执行记录、持久化领取、租约、重试、幂等和重复执行；与 AgentScope AI 任务的区别。
44. 文件：上传下载、元数据与实际文件一致性、路径隔离、备份恢复和服务重启。

代码入口：apps/api/app/tasks/、apps/api/app/api/attachments.py、apps/api/app/integrations/agentscope_workspace_scope.py。

练习：解释进程在任务执行中退出或文件删除失败时，系统应如何恢复。

掌握标准：不把定时器等同于可靠任务系统，能描述数据库之外仍需持久化的内容。

## 第十三阶段：开源工程质量与交付（4 次）

45. 代码维护：模块边界、命名、依赖方向、重复代码、大组件拆分、错误模型一致性与模板清理。
46. 验证：TypeScript、ESLint、Prettier、Knip、Vitest、Playwright 与后端测试各负责什么；基于真实风险选择测试。
47. 交付：开发和生产配置、反向代理、迁移、启动顺序、健康检查、日志、备份、依赖锁定及 CI。
48. 开源协作：许可证与来源保留、README、配置示例、贡献指南、变更记录、Issue/PR 和版本发布。

代码与资料入口：package.json、pyproject.toml、infra/、docs/source-provenance.md、docs/verification/。部署与开源文件若尚不存在，应作为交付工作补齐。

练习：让另一位开发者依据文档从干净环境启动项目；审查一个小 PR，解释改动、验证证据和剩余限制。

掌握标准：可安装、可构建、可启动、可理解、可修改；核心权限和数据边界有有效验证，未完成能力有明确说明。

## 综合实践与节奏

完成前端阶段后，用一个“小型项目列表”练习路由、表格、表单、Query 缓存和空间切换。完成后端与权限阶段后，再为它补齐真实 API、数据库迁移和权限控制。最后接入一个只读 AI 工具，理解完整链路。练习应在独立分支或练习目录中进行，避免把教学代码混入正式功能。

共规划 48 次主题学习。每次约 30～60 分钟讲解和代码阅读，另留练习时间；按每周 3 次约 16 周，每周 5 次约 10 周。进度取决于练习结果，遇到不熟悉的基础可以拆成更多次。

目前已初步介绍 Vite/React/TypeScript 和 Router，不计为完成相应阶段；下一次从第一阶段的实际请求链路开始，补齐整体认知，然后按顺序推进。

每次记录：本次主题、所读文件、能否复述、练习结果、发现的代码质量问题及对应后续任务。学习进度与产品开发台账分开维护。

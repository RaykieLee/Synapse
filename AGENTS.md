# Synapse 协作约定

用户要求逐项实现 docs/integration-plan.md，包含租户和 Workspace，并对每项功能安排独立子智能体验证。

长期任务接续提示词见 docs/long-term-migration-task-prompt.md；实际范围与状态仍以 integration-plan、tenancy-contract 和 development-status 为准。

- 子智能体必须使用 gpt-6-luna，思考强度 medium；单次只承担一个功能或一个独立验证，规模不超过用户管理迁移。
- 每个功能点增加独立 UX 子智能体，先审视信息架构、交互状态、权限提示、错误/部分成功、移动端和可访问性，再确定前端界面与后端契约；UX 方案记录在相应任务说明或验收材料中。实施与独立验收仍由不同子智能体承担。
- 主智能体维护 docs/development-status.md、安排任务与接续。开发者不自行扩大任务范围或替代独立验收。
- 开发任务只修改分配的文件范围；验证任务可建立可重复测试和报告，不直接修产品实现，发现问题交由开发者修复后复验。
- 只按指定任务开展验证，不用全项目构建或一个 health 检查证明整个产品完成。
- 必须遵循 docs/tenancy-contract.md：全局账号、租户成员、空间成员相互独立；服务端校验作用域；个人凭据/会话默认私有。
- 迁移各模块前阅读 docs/tenant-optimization-principles-and-gap-review.md 第 2、3、7 节；该文档记录跨模块工程标准与待确认差距，身份和隔离的权威规则仍只在 docs/tenancy-contract.md。先确定数据归属、API/服务、前端状态、失败行为和验收条件，再实现具体页面。
- 同一前端使用 TanStack Router；AgentScope 通过一个 FastAPI 入口内嵌，不能以另开 AI 后端服务代替。
- Synapt 平台业务仅迁入人脸识别，加密管理不迁入；共享基础能力按保留模块依赖提取。
- 不复制真实 .env、运行数据库、密钥、上游 .git 或 node_modules。保留开源许可证和来源信息。
- 模拟模型/渠道/SDK验证必须标为模拟；真实凭据/SDK缺失时明确保留待验收状态。
- Python 开发环境位于 apps/api/.venv；前端位于 apps/web，使用 pnpm。不要干扰同级原项目的运行服务。
- 完成时报告改动文件、接口契约、待验收项；验证报告放 docs/verification，逐条写明证据与局限。

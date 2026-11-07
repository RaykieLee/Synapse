# ADR 0003：采用战略 DDD 与模块化单体

状态：已接受。

## 背景

Synapse 正按业务域逐步迁移，现有决策已建立 service 层、请求级事务，以及租户和 Workspace 的作用域契约。随着身份、租户访问、系统管理、AI 与人脸识别等能力汇入同一应用，需要明确长期的业务边界，避免模块继续按技术类型互相耦合。与此同时，集成计划要求 AgentScope 与 Synapse 共用一个 FastAPI 服务入口；现有迁移也需要保留既有接口并分批推进，而非一次性重写。

## 决策

### 架构形态

采用战略 DDD 的有界上下文（Bounded Context）思维来识别和治理业务边界，Synapse 仍保持一个 FastAPI 进程内的模块化单体。上下文用于表达职责、语言和依赖边界，不代表独立部署单元。拒绝按上下文拆成微服务；本 ADR 也不要求所有模块一律采用教科书式的四层战术 DDD 结构。

### 模块组织与迁移

新能力按上下文组织，而不是先按 router、service、model 等技术类型建立跨域目录。具体包名和物理目录布局留给各项实现设计决定，不由本 ADR 固定。存量代码以 Strangler Fig 方式逐域迁移：在保留既有 API 契约和已接受事务规则的前提下，逐步把职责收敛到明确上下文，不进行全仓一次性搬迁。

### 战术模式

Repository port、aggregate、domain event 等模式按需采用，只有当业务不变量、持久化隔离或跨上下文协作确实需要时才引入，不作为每个上下文的先决条件。ADR 0001 中“不引入 repository 层”继续作为默认选择，但限定为不建设机械、统一的 repository 层；有明确理由的上下文可以局部引入端口。ADR 0001 的 service/HTTP 职责边界及 ADR 0002 的请求级事务规则继续有效。

### 初始上下文建议

以下是首批边界讨论的建议，不是最终包名或不变的目录清单：

- **Identity**：全局账号身份与认证。
- **Tenancy/Access**：租户和 Workspace 成员关系、作用域解析与访问授权；身份、租户成员和空间成员保持独立，服务端校验作用域，具体规则以 `docs/tenancy-contract.md` 为准。
- **Tenant Administration**：租户管理操作及租户生命周期配置。
- **Workspace Resources**：归属 Workspace 的协作资源及其生命周期。
- **AI Orchestration**：面向用户的 AI 能力编排与用例。
- **Operations**：平台运维、系统管理与运维任务。
- **Face Recognition**：纳入范围的人脸识别业务。
- **AgentScope ACL**：隔离 AgentScope 与 Synapse 内部身份、作用域及接口模型的适配边界。
- **Shared Kernel**：少量确需跨上下文共享且语义稳定的基础概念；不得演变为承载任意业务逻辑的公共模块。

这些名称用于讨论职责边界；数据归属、权限规则和具体 API 仍由相应契约及功能决策确定。

### AgentScope 与边界治理

AgentScope 继续以内嵌方式运行在同一 FastAPI 进程中，并通过 AgentScope ACL/适配边界接入 Synapse；拒绝另建独立 AI 后端服务来替代该集成方向。各上下文的依赖边界最终必须由自动化架构测试或 import-linter 一类工具验证。本 ADR 记录方向，不规定测试实现、工具选型或落地时点。

## 参考资料及适配结论

2026-11-06 对照了下列文章、仓库说明、架构文档及公开目录结构。它们用于比较取舍，不作为直接复制代码或目录的指令：

- [ToB 分层架构实践](https://www.whthomas-blog.com/blog/layered-architecture-tob)：最值得借鉴的是业务包自治、结构即文档、控制共享工具包规模，以及用 Strangler Fig 小步迁移。文章示例面向 Java/JVM，并采用较完整的 application/ACL/model/repository/service 组合；不应把该技术栈与固定五层目录原样移植到 Synapse。
- [FastAPI Full Stack Template](https://github.com/fastapi/full-stack-fastapi-template)：适合作为 FastAPI、前后端联调、测试、CI 与部署基线的参考；当前后端仍按 API、core、CRUD、models 等技术职责组织，不提供有界上下文治理。其 SQLModel 与默认前端集成方式也不要求 Synapse 改变现有 SQLAlchemy/Alembic、Vite、TanStack Router/Query 技术选择。
- [Vstorm Full-Stack AI Agent Template](https://github.com/vstorm-co/full-stack-ai-agent-template)：可参考 AI/RAG 集成、配置、观测性和项目生成器的工程实践；其架构文档采用 routes → services → repositories → database，且生成 Next.js、多种 AI 框架与向量库组合，不是 Synapse 的 DDD 蓝图，也不能替代“同一 FastAPI 进程内嵌 AgentScope”的集成约束。
- [FastAPI Clean Architecture + DDD Template](https://github.com/BrunoTanabe/fastapi-clean-architecture-ddd-template)：四层模块、依赖向内、以 `Protocol` 表达应用端口和通过 fake 测用例，是最有价值的战术模式参考。模板为每个模块预置较完整骨架；其 README 也说明测试目录仍为空脚手架且 pytest 尚未加入依赖。因此只在存在业务不变量、可替换依赖或明确测试收益时选用对应模式，不强制所有上下文建立仓储、聚合或空层目录。
- [FastAPI DDD Starter](https://github.com/EzyGang/fastapi-ddd-template)：适合快速了解 adapters/application/domain/core 的基础术语与依赖方向；公开结构主要展示 health 示例，作为成熟业务边界设计的证据较弱。仓库未声明可识别的 SPDX 许可证，故不复制其代码。

综合结论：采纳“先按业务上下文组织、以依赖规则守边界、渐进迁移”的思路；不采纳任何一个模板的整套目录、ORM、前端或 AI 运行时。涉及外部参考的实现须保留来源与许可证信息。

## 后果

- 业务边界成为新功能组织和存量迁移的共同依据，同时保留单体部署与既有契约。
- 边界按迁移逐步建立，过渡期允许新旧组织方式并存；团队需持续确认上下文职责与依赖方向。
- 战术建模成本按不变量需要承担，避免为形式完整而普遍增加抽象；局部引入模式时应说明其解决的具体问题。
- 自动化边界校验是后续必须补齐的治理能力，但不属于本 ADR 的实现交付。

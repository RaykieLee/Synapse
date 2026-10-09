# Synapse

统一管理后台与 AgentScope AI 工作台。

支持租户、Workspace、成员和角色管理，并通过左上角切换器切换工作空间。业务数据和 AI 资源按租户及空间隔离。

前端基于 shadcn-admin，后端迁入 Synapt 系统管理和人脸识别，并在同一个 FastAPI 服务中嵌入 AgentScope。

当前状态：前端初始框架和后端基础已建立，登录与多租户基础正在开发。完整业务迁移仍在进行中。

功能进度和独立验证证据见 [开发台账](docs/development-status.md)。开发与验收均按单一任务委派，验收报告位于 docs/verification。

详细范围、目录、技术方案及阶段验收见 [集成计划](docs/integration-plan.md)。

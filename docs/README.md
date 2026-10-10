# Synapse 文档索引

本目录以中文说明项目方案、接口契约、运行边界和验收结果。代码标识、接口路径、环境变量、命令及必要的技术术语保留原文，便于直接查找和复制。

| 想了解什么 | 从哪里开始 |
| --- | --- |
| 项目目标、技术选型与功能范围 | [集成计划](integration-plan.md) |
| 各功能目前完成到哪一步 | [开发与独立验收台账](development-status.md) |
| 当前架构约定与已接受决策 | [工程上下文](../CONTEXT.md)、[ADR](adr/) |
| 登录、租户、Workspace 与权限规则 | [认证契约](auth-contract.md)、[租户契约](tenancy-contract.md)、[权限使用说明](tenancy-authorization-usage.md) |
| AgentScope 如何接入及隔离 | [嵌入契约](agentscope-embedding-contract.md)、[运行说明](agentscope-runtime.md)及同目录的 `agentscope-*.md` |
| 管理接口的字段和行为 | 同目录的 `*-api.md` 与 `*-notes.md` |
| 某项功能的实际验证结果 | [verification/](verification/) 中按任务编号命名的报告 |

阅读顺序建议：先看集成计划，再看开发台账；需要确认某项功能是否真正通过时，打开台账对应的验收报告。方案文档描述目标，验收报告记录已经验证的行为和限制，两者不能互相替代。

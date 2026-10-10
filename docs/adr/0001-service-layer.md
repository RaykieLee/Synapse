# ADR 0001：引入按业务域划分的 service 层

状态：已接受。

## 背景

早期 router 直接组合权限判断、跨表写入、业务不变量、事务提交和响应序列化。租户创建需要同时写入租户、租户成员、默认 Workspace 和空间成员；成员停用还要同步撤销 Workspace 成员。这类多表用例放在 router 中会让关键规则难以测试，也容易在响应拼装中引入字段遗漏。

Synapt 的 repository 层主要重复封装 SQLAlchemy Session，事务边界还被分散到多个方法中。它是参考来源，但不是目标形态。

## 决策

后端采用三层：

```text
router -> service -> SQLAlchemy Session
```

- router 是 HTTP 适配层：依赖注入、参数解析、调用 service、response model。
- service 是业务用例层：业务规则、跨表不变量、事务内 `flush()`。
- ORM 模型保留持久化映射，不追加 repository 层。

迁移按业务域推进，每个域一个独立提交。租户与租户成员是第一批范围，Workspace 与空间成员是第二批范围；邀请、角色、菜单、字典、配置、任务等不在同一次迁移中修改。

## 后果

- 复杂用例可以在不启动 HTTP 层的情况下用真实数据库直接测试。
- wire contract 保持在 router/schema，service 不依赖 FastAPI。
- 前期会短暂存在新旧两种 router 风格，必须通过 CONTEXT.md 明确目标并逐域收敛。
- 新增领域错误时继承 `ServiceError` 子类，由全局 handler 统一映射 problem response。

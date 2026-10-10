# ADR 0002：请求级托管数据库事务

状态：已接受。

## 背景

router 中分散的 `commit()` / `rollback()` 使跨表用例难以保证同一事务边界。一个用例中途失败时，调用方必须记得 rollback；不同 router 的错误路径也容易产生不一致。

Synapt 的 repository 方法内部直接 commit，无法把多个 ORM 写入组合成一个原子用例。AgentScope 参考项目采用请求级 session 生命周期托管，事务边界更清晰。

## 决策

`app/database/session.py:get_db()` 作为唯一请求级事务边界：

```python
try:
    yield session
    session.commit()
except Exception:
    session.rollback()
    raise
finally:
    session.close()
```

- 请求成功统一 commit。
- 请求路径上的任何异常统一 rollback。
- service 只调用 `flush()` 获取生成 ID、触发约束检查或刷新对象，不调用 `commit()`。
- router 不管理事务；已迁移域不得出现显式 commit/rollback。

## 后果

- 多表用例天然原子，例如租户 provisioning 的四表写入。
- 领域异常抛出后由依赖清理统一回滚，service 不需要了解 FastAPI。
- 存量 router 中的显式 commit 暂时保留，随各自业务域迁移时删除；重复 commit 在迁移期无害。
- 后台任务和脚本如需长事务，应显式创建 Session，不复用 HTTP 请求依赖。

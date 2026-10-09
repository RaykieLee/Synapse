# F21b2b4 Skills 范围与安装安全验收

日期：2026-10-02  
结果：**配置的本地上传和 scoped-workspace 路径通过**

## 环境与命令

可重复验收为 `apps/api/tests/verification/test_f21b2b4_skills_isolation.py`。使用迁移至 Alembic head 的隔离临时 SQLite 数据库、经真实 JWT 身份认证的 Synapse ASGI 请求，以及 `127.0.0.1:6380` 上的 Redis（storage DB 9、bus DB 8）。Redis 数据按本次运行命名空间隔离，并由 pytest finalizers 移除记录；不会清空 Redis 数据库。

```sh
cd apps/api
.venv/bin/pytest tests/verification/test_f21b2b4_skills_isolation.py -q --tb=short
```

安装相关修复后的实际结果：**2 passed**。独立的 archive guard 测试通过。由于嵌入式 app 未注册 Skill hub，无法测试 Hub 目录/下载。

## 通过证据

- 通过真实 `WorkspaceSessionStorage` adapter 在真实 Redis 中插入四条 Skill library records：两个租户、同租户两个 Workspaces、以及两个共享 Workspace 的 actors。ID 不同且由 scope 派生。
- 通过已认证的 `/api/v1/ai/skill` 请求，各 scope 可以列出/读取自己的记录。读取外部 IDs 和旧版未限定记录返回 404；删除外部记录也返回 404。列表排除外部和旧版行。
- `/api/v1/ai/workspace/skill/from-library` 将外部 scope ID 拒绝为 “Not in your library”。随后当前 scope 的 metadata 记录也因其预置 `hub_id` 未注册而 fail closed。未配置外部 Skill hub，因此无法执行真实 hub archive fetch/install。
- 已弃用的路径安装 route 将 `/etc/passwd` 拒绝为 `SKILL_PATH_INSTALL_DISABLED`（HTTP 400）。
- 已认证上传 route 以 HTTP 422 拒绝路径遍历、POSIX 绝对路径、Windows drive 和 `..` 路径。其声明的单文件大小限制也以 HTTP 422 拒绝超大 manifest 条目。
- Workspace available-Skills GET 在安装前返回空列表，安装文件后会反映结果。
- 有效的 multipart 文件夹上传（endpoint 会将其转换为 tar）安装成功。其 available 列表向安装 actor 展示解析出的名称/描述及 Skill markdown。同一 Workspace 的另一 actor 有独立 agent/session，看不到该 Skill。
- 通过真实 `ScopedLocalWorkspaceManager` 和受限文件系统 backend，在同一认证 runtime context 下安装了有效 ZIP 包。安装者 Skill 列表可读取该文件，另一 actor 的列表中没有，并且可从安装者的 scope 分区中移除。HTTP 文件夹上传 endpoint 接收 multipart 文件夹并输出 TAR，因此 ZIP 是通过 scoped installer 而非该特定 HTTP serialization 路径验收。
- 通过已认证 API 移除了上传的 TAR Skill；再次列出时已不存在。
- 对 `ScopedWorkspace.add_skill_archive` 使用受限 fake local backend 直接检查：安全 tar 包可接受；拒绝 ZIP 遍历/绝对路径和符号链接条目，也拒绝 tar 遍历/绝对路径、符号链接、硬链接、FIFO/特殊成员和超出解压大小限制。此项验证 extractor guard 本身，不代表 HTTP 安装路径端到端成功。

## 尚未验证的限制

- 此 factory 没有 hub endpoint 或已配置的 Skill hub，无法端到端验证 hub 目录、读取和 from-library 下载。
- HTTP multipart 上传会构建普通文件 TAR 成员，不能编码链接条目；链接/特殊成员检查是直接对 scoped extractor 执行，没有经 multipart gateway 发送。
- 未测试重启后的持久化。
- ZIP 没有 ZIP filesystem 硬链接成员类型；已测试拒绝 tar 硬链接。

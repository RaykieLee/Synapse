# F21b2b4 AgentScope Skills 隔离

状态：已通过独立验收（Hub 未验，见 `development-status.md` 中 F21b2b4）。本文覆盖已安装 Skill 元数据、workspace 内的 Skill 文件及可用列表，以及服务端路径安装边界。

## 库元数据作用域

`WorkspaceSessionStorage` scopes AgentScope Skill records using verified
F21a `WorkspaceContext`:

```text
Skill ID:     synapse-skill-t{tenant_id}-w{workspace_id}-u{actor_user_id}-{id}
storage user: synapse-skill-owner-t{tenant_id}-w{workspace_id}-u{actor_user_id}
```

The synthetic storage owner is derived on the server; it is not accepted from
clients. Library list, detail/read, delete, hub install, and workspace
from-library lookup all use this scope. Foreign Synapse IDs resolve as absent.
原始 ID 仅在创建记录时接受。未带作用域的旧 Skill 记录不会出现在列表中，也无法通过作用域 API 访问。

## Workspace 文件与可用 Skills

The existing `ScopedLocalWorkspaceManager` places each workspace under a
tenant/Workspace/actor root and hashes the scoped agent ID for its path
segment. AgentScope keeps Skills in that workdir's `skills/` directory, with a
per-agent partition and a `.seed` template. Thus workspace-installed copies,
their indexes, and their available-list results are private to the actor and
scoped agent. The Skills endpoints return only the workspace's current agent
partition. Adding from the scoped library resolves the record by ID first and
then extracts a downloaded archive into that partition through the confined
backend. Removal addresses only a Skill name in that same partition.

已弃用的基于路径安装 endpoint 会被拒绝，因为它会直接读取任意服务器文件系统路径，绕过受限后端。上传路由仍可用：作用域适配器仅解压普通文件和目录，拒绝目录穿越/绝对路径、链接及重复路径，并将写入限制在当前工作目录内。Skills 属于指令内容，可能影响 agent 行为；归档路径检查并不意味着其指令可信。

## 来源与 runtime 限制

内嵌工厂未注册 Skill hub，也未配置全局 `skill_paths`。因此，除非未来部署显式注册获批的 hub，否则 hub 目录及从库下载均不可用。上传的 Skills 仅对当前作用域 agent/workspace 可用。AgentScope 库元数据不保存归档文件；它保存 hub/card/version 及描述信息，后续安装时会从已注册 hub 重新下载。本功能不提供跨 Workspace 共享、全局默认 Skill 集或凭据处理。

F21a context binding is required for Skill library storage. The local files are
persistent at `SYNAPSE_AGENTSCOPE_WORKSPACE_PATH`; they are not migrated from
the old unscoped `{root}/{agent_id}` layout. No test, service startup, hub
request, or filesystem verification was run.

## 独立验收

Verify two tenants, two Workspaces, and two actors cannot enumerate/read/delete
each other's library records or workspace Skills; old unscoped records are
invisible; foreign IDs fail closed in library and from-library routes; agent
partition isolation; upload/archive traversal and symlink cases; absolute path
installation rejection; list/read/remove confinement; and restart persistence
under the configured workdir root. Review frontend/API serialization of Skill
instruction content before enabling external users.

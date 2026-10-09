# FastAPI 多租户授权辅助工具

`apps/api/app/tenancy/context.py` 根据已认证的全局账号和当前数据库成员关系，生成不可变的 `TenantContext` 和 `WorkspaceContext` 对象。`apps/api/app/tenancy/scopes.py` 使用这些可信上下文应用强制 SQL 筛选条件，并构建由服务端负责的行字段。这些模块为租户/Workspace 业务 API 提供可复用基础能力；它们本身不会新增路由或迁移业务模块。

## Workspace 作用域路由

每个处理 Workspace 业务数据的端点都应直接依赖 `get_workspace_context`，或使用 `require_workspace_permission(...)` 依赖。路由包含 `workspace_id` 时，请求必须同时提供相同的 `X-Workspace-ID`；不含该路径参数的路由仍必须提供此 header。依赖会从 Workspace 记录推导 `tenant_id`，并在每次请求时验证账号、租户状态/成员关系、Workspace 状态/成员关系以及路径/header 是否一致。它不会根据租户角色或 `platform_admin` 授予访问权。

```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.documents import Document
from app.tenancy.context import WorkspaceContext, require_workspace_permission
from app.tenancy.scopes import personal_scope, workspace_scope, workspace_values

router = APIRouter()

@router.get("/workspaces/{workspace_id}/documents")
def list_documents(
    context: WorkspaceContext = Depends(require_workspace_permission("resource:read")),
    db: Session = Depends(get_db),
):
    statement = workspace_scope(select(Document), Document, context)
    return db.scalars(statement).all()

@router.post("/workspaces/{workspace_id}/documents")
def create_document(body: DocumentInput, ...):
    context = ...  # Depends(require_workspace_permission("resource:create"))
    document = Document(**workspace_values(context, title=body.title, body=body.body))
    db.add(document)
```

Workspace 模型必须同时保存 `tenant_id` 和 `workspace_id`。两者均参与筛选，可防止租户/Workspace 组合不一致的行越过边界。计数、排序/分页、加载子记录或按 ID 返回资源前，都应先应用作用域。直接查询资源时，应先对查询添加作用域；无结果时按不存在处理。资源 ID 本身不能作为授权依据。

## Tenant 作用域路由

租户管理或租户所有的业务 API 使用 `tenant_id` 路径参数及 `get_tenant_context` 依赖。此依赖会检查 `TenantMember` 是否 active，以及租户状态是否 active。租户角色权限具有作用域限制：owner 获得 `tenant:read`、`tenant:update`、`tenant:archive` 和 `tenant_member:manage`；admin 获得读取、更新和成员管理权限；member 获得读取权限。平台角色不会绕过成员关系检查。

```python
from app.tenancy.context import TenantContext, require_tenant_permission
from app.tenancy.scopes import tenant_scope

@router.get("/tenants/{tenant_id}/departments")
def list_departments(
    context: TenantContext = Depends(require_tenant_permission("tenant:read")),
    db: Session = Depends(get_db),
):
    return db.scalars(tenant_scope(select(Department), Department, context)).all()
```

租户所有的模型必须包含 `tenant_id`。不得使用请求体、查询参数或任意租户 header 作为租户作用域。路由参数只用于确定要验证哪项成员关系；只有返回的上下文才包含可信作用域。

## 个人资源

个人凭据、会话、MCP/Skill 资源及其他私有记录，即使对 Workspace owner/admin 也应保持私有。私有模型必须保存 `owner_user_id`、`tenant_id` 和 `workspace_id`。`personal_scope(...)` 要求三项条件同时匹配，因此 Workspace 角色不会扩大私人数据的访问范围。`personal_values(...)` 会在插入时根据已验证的操作者/上下文设置这些字段。显式共享的资源还需单独检查授权记录；不得为了简化查询而移除所有者条件。

## 归属字段约束

`workspace_values(context, **resource_fields)` 根据可信上下文填入 `tenant_id`、`workspace_id` 和 `created_by`。`personal_values(...)` 还会填入 `owner_user_id`。两个辅助工具都会拒绝调用方自行提供这些保留字段。作用域辅助工具应作为查询的起点，不能先查出记录再视情况添加筛选。

## 默认拒绝行为

Workspace 路径/header 不一致或缺少上下文时，请求会被拒绝。跨租户/Workspace 的标识符无法覆盖推导出的归属。租户已暂停/归档、Workspace 已归档、成员关系无效、Workspace 授权已移除、账号未启用或角色权限不足时，系统会在返回上下文前拒绝请求。重新加入租户不会重新激活已移除的 `WorkspaceMember`；必须显式恢复该 Workspace 授权后才能生成新的上下文。

实现业务端点时，应单独验证资源查询、写入归属和角色操作。可复用辅助工具无法保证未来的路由安全，若路由未使用依赖或跳过作用域调用，仍会有风险。

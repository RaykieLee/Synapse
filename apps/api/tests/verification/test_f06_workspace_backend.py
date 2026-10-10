"""F06 workspace boundary verification using temporary SQLite and real FastAPI routes."""
from datetime import datetime, timezone
from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from sqlalchemy import select


def test_f06_workspace_api_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{tmp_path / 'f06.sqlite'}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f06-verification-only-secret")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "0016_tenant_validity")
    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.user import User
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.tenancy.context import WorkspaceContext, get_workspace_context
    factory = get_session_factory()
    names = ("platform", "owner", "tenant_admin", "tenant_member", "space_admin", "regular", "viewer", "tenant_only", "no_space", "other_owner", "suspended_actor")
    with factory() as db:
        users = [User(user_name=n, nick_name=n, email=f"{n}@example.test", password_hash="unused",
                      platform_role="platform_admin" if n == "platform" else "user", status="active") for n in names]
        db.add_all(users); db.commit(); ids = {u.user_name:u.user_id for u in users}
    tokens = {n:issue_token(uid, 0) for n,uid in ids.items()}
    app = create_app()
    # Test-only dependency probe: no product route or code is added.
    probe = APIRouter()
    @probe.get("/api/v1/__verification/workspace-context")
    def workspace_probe(context: WorkspaceContext = Depends(get_workspace_context)):
        return {"actor_user_id":str(context.actor_user_id), "tenant_id":str(context.tenant_id),
                "workspace_id":str(context.workspace_id), "tenant_role":context.tenant_role,
                "workspace_role":context.workspace_role, "permissions":sorted(context.permission_set),
                "membership_version":context.membership_version}
    app.include_router(probe)
    with TestClient(app) as client:
        def req(method,path,actor,workspace=None,**kwargs):
            headers={"Authorization":f"Bearer {tokens[actor]}"}
            if workspace is not None: headers["X-Workspace-ID"]=str(workspace)
            headers.update(kwargs.pop("headers",{}))
            return getattr(client,method)(path,headers=headers,**kwargs)
        # Platform tenant provisioning creates the initial owner/default workspace, not a platform membership.
        ra=req("post","/api/v1/tenants","platform",json={"slug":"f06-alpha","name":"F06 Alpha","first_owner_user_id":str(ids["owner"])})
        assert ra.status_code==201,ra.text
        alpha=ra.json(); tid=alpha["tenant_id"]; wid=alpha["default_workspace"]["workspace_id"]
        assert tid.isdecimal() and wid.isdecimal() and alpha["default_workspace"]["tenant_id"]==tid
        assert req("get","/api/v1/workspaces","platform").json()["total"]==0
        assert req("get",f"/api/v1/workspaces/{wid}","platform",wid).status_code==403
        assert req("post",f"/api/v1/tenants/{tid}/workspaces","platform",json={"slug":"no","name":"No"}).status_code==403
        rb=req("post","/api/v1/tenants","platform",json={"slug":"f06-beta","name":"F06 Beta","first_owner_user_id":str(ids["other_owner"])})
        assert rb.status_code==201,rb.text
        beta=rb.json(); beta_tid=beta["tenant_id"]; beta_wid=beta["default_workspace"]["workspace_id"]
        # Populate tenant roles. A tenant member cannot create workspaces; tenant admin can, becoming that workspace's owner.
        for n,role in (("tenant_admin","admin"),("tenant_member","member"),("space_admin","member"),("regular","member"),("viewer","member"),("tenant_only","member"),("no_space","member"),("suspended_actor","member")):
            r=req("post",f"/api/v1/tenants/{tid}/members","owner",json={"user_id":str(ids[n]),"tenant_role":role}); assert r.status_code==201,f"{n}: {r.text}"
        assert req("post",f"/api/v1/tenants/{beta_tid}/members","other_owner",json={"user_id":str(ids["tenant_only"])}).status_code==201
        assert req("post",f"/api/v1/tenants/{tid}/workspaces","tenant_member",json={"slug":"deny","name":"Deny"}).status_code==403
        created=req("post",f"/api/v1/tenants/{tid}/workspaces","tenant_admin",json={"slug":"admin-created","name":"Admin Created"})
        assert created.status_code==201,created.text
        assert created.json()["workspace_role"]=="owner"
        assert req("get","/api/v1/workspaces","tenant_admin").json()["total"]==1
        assert req("get",f"/api/v1/workspaces/{wid}","tenant_admin",wid).status_code==403
        assert req("get","/api/v1/workspaces","tenant_member").json()["total"]==0
        assert req("get","/api/v1/workspaces","platform").json()["total"]==0
        assert [x["workspace_id"] for x in req("get","/api/v1/workspaces","owner").json()["items"]]==[wid]
        assert [x["workspace_id"] for x in req("get","/api/v1/workspaces","other_owner").json()["items"]]==[beta_wid]
        assert req("get","/api/v1/workspaces","owner",params={"tenant_id":beta_tid}).json()["total"]==0
        # Explicit workspace membership only. Cross-tenant target is prohibited.
        for n,role in (("space_admin","admin"),("regular","member"),("viewer","viewer")):
            r=req("put",f"/api/v1/workspaces/{wid}/members/{ids[n]}","owner",wid,json={"workspace_role":role}); assert r.status_code==200,r.text
        assert req("put",f"/api/v1/workspaces/{wid}/members/{ids['other_owner']}","owner",wid,json={"workspace_role":"member"}).status_code==422
        assert req("get",f"/api/v1/workspaces/{beta_wid}","owner",beta_wid).status_code==403
        # Trusted-context probe verifies derived tenant and path/header rules.
        probe_path="/api/v1/__verification/workspace-context"
        c=req("get",probe_path,"regular",wid); assert c.status_code==200,c.text
        assert c.json()["tenant_id"]==tid and c.json()["workspace_id"]==wid and c.json()["workspace_role"]=="member"
        assert "resource:read" in c.json()["permissions"]
        assert req("get",f"/api/v1/workspaces/{wid}","regular").status_code==400
        assert req("get",f"/api/v1/workspaces/{wid}","regular",beta_wid).status_code==400
        assert req("get",probe_path,"regular").status_code==400
        assert req("get",probe_path,"regular",headers={"X-Workspace-ID":"nope"}).status_code==400
        assert req("get",probe_path,"regular",beta_wid).status_code==403
        # Active tenant membership is checked even when the workspace-member row remains active.
        with factory() as db:
            tm=db.scalar(select(TenantMember).where(TenantMember.tenant_id==int(tid),TenantMember.user_id==ids["suspended_actor"]))
            db.add(WorkspaceMember(workspace_id=int(wid),tenant_id=int(tid),user_id=ids["suspended_actor"],status="active",workspace_role="member",joined_at=datetime.now(timezone.utc)))
            tm.status="suspended"; db.commit()
        r=req("get",probe_path,"suspended_actor",wid); assert r.status_code==403 and r.json()["code"]=="MEMBERSHIP_INACTIVE"
        with factory() as db:
            db.scalar(select(TenantMember).where(TenantMember.tenant_id==int(tid),TenantMember.user_id==ids["suspended_actor"])).status="active"; db.commit()
        # Account status is part of the same request gate.
        with factory() as db:
            db.get(User, ids["suspended_actor"]).status="inactive"; db.commit()
        assert req("get",probe_path,"suspended_actor",wid).status_code==401
        with factory() as db:
            db.get(User, ids["suspended_actor"]).status="active"; db.commit()
        # Workspace admins can manage regular members but cannot operate on or promote/demote an owner.
        assert req("put",f"/api/v1/workspaces/{wid}/members/{ids['owner']}","space_admin",wid,json={"workspace_role":"member"}).status_code==403
        assert req("put",f"/api/v1/workspaces/{wid}/members/{ids['owner']}","space_admin",wid,json={"workspace_role":"owner"}).status_code==403
        assert req("delete",f"/api/v1/workspaces/{wid}/members/{ids['owner']}","space_admin",wid).status_code==403
        for method,body,expect in (("put",{"workspace_role":"member"},200),("put",{"workspace_role":"viewer"},200),("delete",None,200),("put",{"workspace_role":"member"},200)):
            args={"json":body} if body is not None else {}
            r=req(method,f"/api/v1/workspaces/{wid}/members/{ids['tenant_only']}","space_admin",wid,**args); assert r.status_code==expect,r.text
        assert req("get",probe_path,"viewer",wid).json()["permissions"]==["resource:read"]
        assert req("put",f"/api/v1/workspaces/{wid}/members/{ids['regular']}","viewer",wid,json={"workspace_role":"member"}).status_code==403
        # Sole-owner protection and atomic ownership transfer.
        assert req("delete",f"/api/v1/workspaces/{wid}/members/{ids['owner']}","owner",wid).status_code==409
        assert req("put",f"/api/v1/workspaces/{wid}/members/{ids['owner']}","owner",wid,json={"workspace_role":"admin"}).status_code==409
        assert req("post",f"/api/v1/workspaces/{wid}/transfer-ownership","owner",wid,json={"new_owner_user_id":str(ids["no_space"])}).status_code==422
        assert req("post",f"/api/v1/workspaces/{wid}/transfer-ownership","owner",wid,json={"new_owner_user_id":str(ids["other_owner"])}).status_code==422
        r=req("post",f"/api/v1/workspaces/{wid}/transfer-ownership","owner",wid,json={"new_owner_user_id":str(ids["regular"])})
        assert r.status_code==200,r.text
        assert r.json()["previous_owner_user_id"]==str(ids["owner"]) and r.json()["new_owner_user_id"]==str(ids["regular"])
        assert req("get",probe_path,"regular",wid).json()["workspace_role"]=="owner"
        assert req("get",probe_path,"owner",wid).json()["workspace_role"]=="admin"
        assert req("delete",f"/api/v1/workspaces/{wid}/members/{ids['regular']}","regular",wid).status_code==409
        # Archived workspaces stay manager-discoverable/restorable but cannot be a business context/list result.
        r=req("patch",f"/api/v1/workspaces/{wid}","regular",wid,json={"status":"archived"}); assert r.status_code==200 and r.json()["status"]=="archived"
        assert req("get","/api/v1/workspaces","regular").json()["total"]==0
        r=req("get",probe_path,"regular",wid); assert r.status_code==409 and r.json()["code"]=="WORKSPACE_INACTIVE"
        assert req("get",f"/api/v1/workspaces/{wid}","regular",wid).status_code==200
        assert req("get",f"/api/v1/workspaces/{wid}/members","regular",wid).status_code==200
        r=req("patch",f"/api/v1/workspaces/{wid}","regular",wid,json={"status":"active"}); assert r.status_code==200 and r.json()["status"]=="active"
        assert req("get",probe_path,"regular",wid).status_code==200
        # Tenant roles cannot mutate as member; inactive tenant denies context. Reactivation works, removal revokes space too.
        assert req("patch",f"/api/v1/tenants/{tid}","tenant_member",json={"name":"Forbidden"}).status_code==403
        assert req("patch",f"/api/v1/tenants/{tid}","platform",json={"status":"suspended"}).status_code==200
        r=req("get",probe_path,"regular",wid); assert r.status_code==409 and r.json()["code"]=="TENANT_INACTIVE"
        assert req("patch",f"/api/v1/tenants/{tid}","platform",json={"status":"active"}).status_code==200
        assert req("get",probe_path,"regular",wid).status_code==200
        r=req("patch",f"/api/v1/tenants/{tid}/members/{ids['tenant_only']}","owner",json={"status":"removed"}); assert r.status_code==200,r.text
        r=req("get",probe_path,"tenant_only",wid); assert r.status_code==403 and r.json()["code"]=="MEMBERSHIP_INACTIVE"
        with factory() as db:
            assert db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id==int(wid),WorkspaceMember.user_id==ids["tenant_only"])).status=="removed"
        r=req("post",f"/api/v1/tenants/{tid}/members","owner",json={"user_id":str(ids["tenant_only"]),"tenant_role":"member"}); assert r.status_code==201,r.text
        r=req("get",probe_path,"tenant_only",wid); assert r.status_code==403 and r.json()["code"]=="WORKSPACE_MEMBERSHIP_REQUIRED"
        assert req("get","/api/v1/workspaces","tenant_only").json()["total"]==0

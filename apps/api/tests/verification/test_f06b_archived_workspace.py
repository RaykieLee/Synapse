"""F06b archived-workspace list verification against temporary SQLite and real API routes."""
from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient


def test_f06b_archived_workspace_visibility(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{tmp_path / 'f06b.sqlite'}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f06b-verification-only-secret")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "0016_tenant_validity")
    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.user import User
    from app.models.tenant import Tenant, Workspace
    from app.tenancy.context import WorkspaceContext, get_workspace_context
    factory=get_session_factory()
    names=("platform","owner","admin","member","viewer","other_owner")
    with factory() as db:
        users=[User(user_name=n,nick_name=n,email=f"{n}@example.test",password_hash="unused",
                    platform_role="platform_admin" if n=="platform" else "user",status="active") for n in names]
        db.add_all(users); db.commit(); ids={u.user_name:u.user_id for u in users}
    tokens={n:issue_token(uid,0) for n,uid in ids.items()}
    app=create_app()
    # Test-only route exercises the existing business-context dependency for archived workspaces.
    probe=APIRouter()
    @probe.get("/api/v1/__verification/workspace-context")
    def context_probe(context: WorkspaceContext=Depends(get_workspace_context)):
        return {"tenant_id":str(context.tenant_id),"workspace_id":str(context.workspace_id),"workspace_role":context.workspace_role}
    app.include_router(probe)
    with TestClient(app) as client:
        def req(method,path,actor,**kwargs):
            headers={"Authorization":f"Bearer {tokens[actor]}"}
            if "headers" in kwargs: headers.update(kwargs.pop("headers"))
            return getattr(client,method)(path,headers=headers,**kwargs)
        created=req("post","/api/v1/tenants","platform",json={"slug":"f06b-alpha","name":"F06b Alpha","first_owner_user_id":str(ids["owner"])})
        assert created.status_code==201,created.text
        alpha=created.json(); tid=alpha["tenant_id"]; active=alpha["default_workspace"]["workspace_id"]
        for name,role in (("admin","admin"),("member","member"),("viewer","member")):
            r=req("post",f"/api/v1/tenants/{tid}/members","owner",json={"user_id":str(ids[name]),"tenant_role":role})
            assert r.status_code==201,r.text
        # All actors have explicit membership in the one active workspace.
        for name,role in (("admin","admin"),("member","member"),("viewer","viewer")):
            r=req("put",f"/api/v1/workspaces/{active}/members/{ids[name]}","owner",
                  headers={"X-Workspace-ID":active},json={"workspace_role":role})
            assert r.status_code==200,r.text
        # Owner creates two workspaces and explicitly grants roles before archiving them.
        archived=[]
        for slug in ("archive-one","archive-two"):
            r=req("post",f"/api/v1/tenants/{tid}/workspaces","owner",json={"slug":slug,"name":slug})
            assert r.status_code==201,r.text
            wid=r.json()["workspace_id"]; archived.append(wid)
            for name,role in (("admin","admin"),("member","member"),("viewer","viewer")):
                grant=req("put",f"/api/v1/workspaces/{wid}/members/{ids[name]}","owner",
                          headers={"X-Workspace-ID":wid},json={"workspace_role":role})
                assert grant.status_code==200,grant.text
            patch=req("patch",f"/api/v1/workspaces/{wid}","owner",headers={"X-Workspace-ID":wid},json={"status":"archived"})
            assert patch.status_code==200 and patch.json()["status"]=="archived"
        # A distinct tenant has an archived workspace for tenant_id filtering and isolation.
        created_b=req("post","/api/v1/tenants","platform",json={"slug":"f06b-beta","name":"F06b Beta","first_owner_user_id":str(ids["other_owner"])})
        assert created_b.status_code==201,created_b.text
        beta=created_b.json(); beta_tid=beta["tenant_id"]; beta_wid=beta["default_workspace"]["workspace_id"]
        assert req("patch",f"/api/v1/workspaces/{beta_wid}","other_owner",headers={"X-Workspace-ID":beta_wid},json={"status":"archived"}).status_code==200

        # Default query only includes active workspaces for all roles.
        for actor in ("owner","admin"):
            body=req("get","/api/v1/workspaces",actor).json()
            assert body["total"]==1 and [x["workspace_id"] for x in body["items"]]==[active]
        for actor in ("member","viewer"):
            body=req("get","/api/v1/workspaces",actor).json()
            assert body["total"]==1 and [x["workspace_id"] for x in body["items"]]==[active]
        body=req("get","/api/v1/workspaces","platform").json()
        assert body["total"]==0 and body["items"]==[]
        # include_archived exposes only self's archived workspaces to workspace owners/admins.
        for actor in ("owner","admin"):
            body=req("get","/api/v1/workspaces",actor,params={"include_archived":"true"}).json()
            assert body["total"]==3
            assert set(x["workspace_id"] for x in body["items"])=={active,*archived}
            assert all(x["status"] in {"active","archived"} for x in body["items"])
        for actor in ("member","viewer"):
            body=req("get","/api/v1/workspaces",actor,params={"include_archived":"true"}).json()
            assert body["total"]==1 and [x["workspace_id"] for x in body["items"]]==[active]
        body=req("get","/api/v1/workspaces","platform",params={"include_archived":"true"}).json()
        assert body["total"]==0 and body["items"]==[]
        # Count, filter, order and pagination are computed over the authorized+visible set.
        alpha_page=req("get","/api/v1/workspaces","owner",params={"include_archived":"true","tenant_id":tid,"page":1,"page_size":1}).json()
        assert alpha_page["total"]==3 and alpha_page["page"]==1 and alpha_page["page_size"]==1 and len(alpha_page["items"])==1
        page2=req("get","/api/v1/workspaces","owner",params={"include_archived":"true","tenant_id":tid,"page":2,"page_size":1}).json()
        page3=req("get","/api/v1/workspaces","owner",params={"include_archived":"true","tenant_id":tid,"page":3,"page_size":1}).json()
        page4=req("get","/api/v1/workspaces","owner",params={"include_archived":"true","tenant_id":tid,"page":4,"page_size":1}).json()
        assert page2["total"]==page3["total"]==page4["total"]==3
        assert len(page2["items"])==len(page3["items"])==1 and page4["items"]==[]
        assert len({alpha_page["items"][0]["workspace_id"],page2["items"][0]["workspace_id"],page3["items"][0]["workspace_id"]})==3
        beta_page=req("get","/api/v1/workspaces","other_owner",params={"include_archived":"true","tenant_id":beta_tid}).json()
        assert beta_page["total"]==1 and beta_page["items"][0]["workspace_id"]==beta_wid
        assert req("get","/api/v1/workspaces","owner",params={"include_archived":"true","tenant_id":beta_tid}).json()["total"]==0
        assert req("get","/api/v1/workspaces","other_owner").json()["total"]==0
        # Archived workspaces are never accepted as business context, even for an owner.
        r=req("get","/api/v1/__verification/workspace-context","owner",headers={"X-Workspace-ID":archived[0]})
        assert r.status_code==409 and r.json()["code"]=="WORKSPACE_INACTIVE"
        # Inactive tenant and revoked membership disappear from archived-inclusive listing.
        assert req("patch",f"/api/v1/tenants/{tid}","platform",json={"status":"suspended"}).status_code==200
        assert req("get","/api/v1/workspaces","owner",params={"include_archived":"true"}).json()["total"]==0
        assert req("patch",f"/api/v1/tenants/{tid}","platform",json={"status":"active"}).status_code==200
        assert req("patch",f"/api/v1/tenants/{tid}/members/{ids['admin']}","owner",json={"status":"removed"}).status_code==200
        assert req("get","/api/v1/workspaces","admin",params={"include_archived":"true"}).json()["total"]==0

"""Run F13d2 dynamic sidebar browser acceptance on a disposable SQLite database."""
import json, os, socket, subprocess, sys, tempfile, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API, WEB = ROOT / "apps/api", ROOT / "apps/web"
FLOW = Path(__file__).with_name("f13d2_dynamic_sidebar.mjs")

def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]

def wait(url, proc):
    until = time.time() + 40
    while time.time() < until:
        if proc.poll() is not None: raise RuntimeError(f"server exited {proc.returncode}: {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status < 500: return
        except Exception: time.sleep(.25)
    raise RuntimeError(f"timeout: {url}")

def main():
    build = subprocess.run(["pnpm", "build"], cwd=WEB)
    if build.returncode: return build.returncode
    with tempfile.TemporaryDirectory(prefix="synapse-f13d2-") as td:
        temp = Path(td); db_url = f"sqlite:///{temp / 'f13d2.sqlite'}"; secret = "f13d2-temporary-jwt-secret"
        os.environ.update(SYNAPSE_DATABASE_URL=db_url, SYNAPSE_JWT_SECRET=secret)
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
        from app.models.tenant_menu import TenantMenu
        from app.models.tenant_role import TenantRole
        from app.models.tenant_member_role import TenantMemberRole
        from app.models.tenant_role_menu import TenantRoleMenu
        from app.models.user import User
        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        old = os.getcwd(); os.chdir(API)
        try: command.upgrade(Config("alembic.ini"), "head")
        finally: os.chdir(old)
        factory = get_session_factory(); now = datetime.now(timezone.utc)
        with factory() as s:
            manager = User(user_name="f13d2-manager", nick_name="F13d2 Manager", email="f13d2-manager@example.test", password_hash="unused")
            member = User(user_name="f13d2-member", nick_name="F13d2 Member", email="f13d2-member@example.test", password_hash="unused")
            no_role = User(user_name="f13d2-no-role", nick_name="F13d2 No Role", email="f13d2-no-role@example.test", password_hash="unused")
            s.add_all([manager, member, no_role]); s.flush()
            a = Tenant(slug="f13d2-alpha", name="F13d2 Alpha", status="active", settings_json="{}", membership_version=4)
            b = Tenant(slug="f13d2-beta", name="F13d2 Beta", status="active", settings_json="{}", membership_version=7)
            s.add_all([a,b]); s.flush()
            s.add_all([
                TenantMember(tenant_id=a.tenant_id,user_id=manager.user_id,status="active",tenant_role="owner",joined_at=now),
                TenantMember(tenant_id=a.tenant_id,user_id=member.user_id,status="active",tenant_role="member",joined_at=now),
                TenantMember(tenant_id=a.tenant_id,user_id=no_role.user_id,status="active",tenant_role="member",joined_at=now),
                TenantMember(tenant_id=b.tenant_id,user_id=manager.user_id,status="active",tenant_role="admin",joined_at=now),
            ]); s.flush()
            wa = Workspace(tenant_id=a.tenant_id,slug="alpha-one",name="Alpha One",status="active",settings_json="{}",created_by=manager.user_id)
            wa2 = Workspace(tenant_id=a.tenant_id,slug="alpha-two",name="Alpha Two",status="active",settings_json="{}",created_by=manager.user_id)
            wb = Workspace(tenant_id=b.tenant_id,slug="beta-one",name="Beta One",status="active",settings_json="{}",created_by=manager.user_id)
            s.add_all([wa,wa2,wb]); s.flush()
            for w, u, role in [(wa,manager,"owner"),(wa2,manager,"owner"),(wb,manager,"admin"),(wa,member,"member"),(wa2,member,"member"),(wa,no_role,"member")]:
                s.add(WorkspaceMember(workspace_id=w.workspace_id,tenant_id=w.tenant_id,user_id=u.user_id,status="active",workspace_role=role,joined_at=now))
            ar = TenantMenu(tenant_id=a.tenant_id,parent_id=None,menu_name="Alpha Granted Parent",order_num=10,path="/alpha-parent",is_frame=1,is_cache=0,menu_type="M",visible="0",status="0",icon="#",created_by=manager.user_id,updated_by=manager.user_id)
            ah = TenantMenu(tenant_id=a.tenant_id,parent_id=None,menu_name="Alpha Hidden Parent",order_num=20,path="/alpha-hidden",is_frame=1,is_cache=0,menu_type="M",visible="1",status="0",icon="#",created_by=manager.user_id,updated_by=manager.user_id)
            br = TenantMenu(tenant_id=b.tenant_id,parent_id=None,menu_name="Beta Admin Only",order_num=10,path="/beta-only",is_frame=1,is_cache=0,menu_type="M",visible="0",status="0",icon="#",created_by=manager.user_id,updated_by=manager.user_id)
            s.add_all([ar,ah,br]); s.flush()
            child = TenantMenu(tenant_id=a.tenant_id,parent_id=ar.menu_id,menu_name="Alpha Custom Leaf",order_num=10,path="/alpha-leaf",is_frame=1,is_cache=0,menu_type="C",visible="0",status="0",icon="#",created_by=manager.user_id,updated_by=manager.user_id)
            hidden_child = TenantMenu(tenant_id=a.tenant_id,parent_id=ah.menu_id,menu_name="Hidden Parent Child",order_num=10,path="/hidden-child",is_frame=1,is_cache=0,menu_type="C",visible="0",status="0",icon="#",created_by=manager.user_id,updated_by=manager.user_id)
            s.add_all([child,hidden_child]); s.flush()
            role = TenantRole(tenant_id=a.tenant_id,role_name="F13d2 Custom",role_key="f13d2_custom",role_sort=1,status="active",permissions_json="[]",created_by=manager.user_id,updated_by=manager.user_id)
            s.add(role); s.flush()
            s.add(TenantMemberRole(tenant_id=a.tenant_id,user_id=member.user_id,role_id=role.role_id,assigned_by=manager.user_id))
            s.add_all([TenantRoleMenu(tenant_id=a.tenant_id,role_id=role.role_id,menu_id=ar.menu_id,created_by=manager.user_id),TenantRoleMenu(tenant_id=a.tenant_id,role_id=role.role_id,menu_id=child.menu_id,created_by=manager.user_id)])
            s.commit()
            seed={"actor_token":issue_token(manager.user_id,manager.token_version),"member_token":issue_token(member.user_id,member.token_version),"no_role_token":issue_token(no_role.user_id,no_role.token_version),"actor_id":str(manager.user_id),"member_id":str(member.user_id),"tenant_a":str(a.tenant_id),"tenant_b":str(b.tenant_id),"wa":str(wa.workspace_id),"wa2":str(wa2.workspace_id),"wb":str(wb.workspace_id),"role_id":role.role_id,"alpha_menu":ar.menu_id,"db":str(temp/'f13d2.sqlite')}
        path=temp/"seed.json"; path.write_text(json.dumps(seed))
        env=os.environ.copy(); ap,wp=port(),port()
        env.update(SYNAPSE_DATABASE_URL=db_url,SYNAPSE_JWT_SECRET=secret,SYNAPSE_API_PREFIX="/api/v1",VITE_API_PROXY_TARGET=f"http://127.0.0.1:{ap}")
        al=(temp/"api.log").open("w"); wl=(temp/"web.log").open("w")
        api=subprocess.Popen([sys.executable,"-m","uvicorn","app.main:create_app","--factory","--host","127.0.0.1","--port",str(ap)],cwd=API,env=env,stdout=al,stderr=al)
        web=subprocess.Popen(["pnpm","dev","--host","127.0.0.1","--port",str(wp),"--strictPort"],cwd=WEB,env=env,stdout=wl,stderr=wl)
        seed.update(web=f"http://127.0.0.1:{wp}",api=f"http://127.0.0.1:{ap}/api/v1"); path.write_text(json.dumps(seed))
        try:
            wait(seed["api"]+"/health",api); wait(seed["web"],web)
            flow=subprocess.run(["node",str(FLOW),str(path)],cwd=WEB,env=env)
            return flow.returncode
        finally:
            web.terminate(); api.terminate(); web.wait(timeout=10); api.wait(timeout=10); al.close(); wl.close()

if __name__ == "__main__": raise SystemExit(main())

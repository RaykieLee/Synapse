import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

type Tenant = { tenant_id: string; slug: string; name: string; status: 'active' | 'suspended' | 'archived'; valid_from: string | null; valid_until: string | null; tenant_role: 'owner' | 'admin' | 'member' | null; membership_version: number; created_at: string; updated_at: string }
type Member = { user_id: string; user_name: string; nick_name: string | null; email: string | null; status: 'invited' | 'active' | 'suspended' | 'removed'; tenant_role: 'owner' | 'admin' | 'member'; joined_at: string | null }
type TenantRole = { role_id: string; tenant_id: string; role_name: string; role_key: string; status: 'active' | 'disabled'; permissions: string[] }
type MemberCustomRoleResponse = { user_id: string; role: TenantRole | null }
type Page<T> = { items: T[]; total: number; page: number; page_size: number }
type Invitation = { invitation_id: string; tenant_id: string; email: string | null; target_user_id: string | null; tenant_role: 'admin' | 'member'; status: string; expired: boolean; expires_at: string; created_at: string }
type CreatedInvitation = Invitation & { token: string; invite_link: string }
const label: Record<string, string> = { active: '启用', suspended: '已停用', archived: '已归档', invited: '待加入', removed: '已移除', owner: '所有者', admin: '管理员', member: '成员' }
const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

function toIsoInput(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text ? new Date(text).toISOString() : undefined
}
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Tenants() {
  const actor = useAuthStore((s) => s.auth.user)
  const admin = actor?.platform_role === 'platform_admin'
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const params = new URLSearchParams({ page: String(page), page_size: '20' })
  if (query.trim()) params.set('name', query.trim())
  if (status) params.set('status', status)
  const key = ['synapse', actor?.user_id ?? 'anonymous', 'global', 'personal', 'tenants', admin ? 'platform' : 'member', page, query.trim(), status]
  const tenants = useQuery({ queryKey: key, queryFn: () => api<Page<Tenant>>(`${admin ? '/platform/tenants' : '/tenants'}?${params}`) })
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', 'global', 'personal', 'tenants'] }) }
  const mutation = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), onSuccess: refresh, onError: (e) => setError(errorText(e)) })
  const create = useMutation({ mutationFn: (body: object) => api('/tenants', { method: 'POST', body: JSON.stringify(body) }), onSuccess: async () => { setError(''); setCreateOpen(false); await refresh(); setPage(1) }, onError: (e) => setError(errorText(e)) })
  const [createOpen, setCreateOpen] = useState(false)
  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">租户管理</h1><p className="mt-1 text-sm text-muted-foreground">{admin ? '平台租户目录用于管理租户状态，不代表您拥有租户内业务或成员访问权限。' : '查看您所属的启用租户。'}</p></div>{admin && <button className={primary} onClick={() => { setCreateOpen(!createOpen); setError('') }}>创建租户</button>}</header>
    {admin && createOpen && <form className={`${panel} grid gap-3 md:grid-cols-4`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); create.mutate({ slug: f.get('slug'), name: f.get('name'), first_owner_user_id: f.get('owner'), valid_from: toIsoInput(f.get('valid_from')), valid_until: toIsoInput(f.get('valid_until')) }); }}><label className="text-sm">租户标识<input required name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={64} className={`${input} mt-1`} placeholder="例如 acme" /></label><label className="text-sm">租户名称<input required name="name" maxLength={120} className={`${input} mt-1`} /></label><label className="text-sm">首位所有者的全局账号 ID<input required name="owner" inputMode="numeric" pattern="[0-9]+" className={`${input} mt-1`} /></label><label className="text-sm">有效期开始<input type="datetime-local" name="valid_from" className={`${input} mt-1`} /></label><label className="text-sm">有效期结束<input type="datetime-local" name="valid_until" className={`${input} mt-1`} /></label><div className="flex items-end gap-2"><button className={primary} disabled={create.isPending}>创建</button><button type="button" className={button} onClick={() => setCreateOpen(false)}>取消</button></div></form>}
    {error && <ErrorBox message={error} />}
    <section className={`${panel} space-y-4`}><div className="flex flex-wrap gap-3"><input className={`${input} max-w-sm`} value={query} placeholder="按租户名称搜索" onChange={(e) => { setQuery(e.target.value); setPage(1) }} /><select className={`${input} max-w-48`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">全部状态</option>{['active','suspended','archived'].map((s) => <option key={s} value={s}>{label[s]}</option>)}</select></div>
      {tenants.isLoading ? <p className="text-sm text-muted-foreground">正在加载…</p> : tenants.isError ? <ErrorBox message={errorText(tenants.error)} /> : tenants.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">名称</th><th className="p-3">标识</th><th className="p-3">状态</th>{!admin && <th className="p-3">我的角色</th>}<th className="p-3">操作</th></tr></thead><tbody>{tenants.data.items.map((t) => <tr key={t.tenant_id} className="border-b last:border-0"><td className="p-3 font-medium">{t.name}</td><td className="p-3">{t.slug}</td><td className="p-3">{label[t.status]}</td>{!admin && <td className="p-3">{label[t.tenant_role ?? ''] ?? '—'}</td>}<td className="p-3"><Link className="underline underline-offset-4" to="/tenants/$tenantId" params={{ tenantId: t.tenant_id }}>查看详情</Link>{admin && t.status !== 'archived' && <><button className="ml-4 underline underline-offset-4" onClick={() => mutation.mutate({ id: t.tenant_id, body: { status: t.status === 'active' ? 'suspended' : 'active' } })}>{t.status === 'active' ? '停用' : '重新启用'}</button><button className="ml-3 underline underline-offset-4" onClick={() => { if (window.confirm(`确定归档租户“${t.name}”吗？`)) mutation.mutate({ id: t.tenant_id, body: { status: 'archived' } }) }}>归档</button></>}</td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">暂无租户</p>}
      <Pager page={page} size={20} total={tenants.data?.total ?? 0} setPage={setPage} /></section>
  </main>
}

export function TenantDetail() {
  const actor = useAuthStore((s) => s.auth.user)
  const platformAdmin = actor?.platform_role === 'platform_admin'
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId' })
  const client = useQueryClient()
  const [error, setError] = useState('')
  const [memberPage, setMemberPage] = useState(1)
  const tenantKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant']
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => api<Tenant>(`/tenants/${tenantId}`) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const canManageStatus = platformAdmin
  const membersKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant-members', tenant.data?.membership_version ?? 0, memberPage, 20]
  const members = useQuery({ queryKey: membersKey, enabled: canManage || tenant.data?.tenant_role === 'member', queryFn: () => api<Page<Member>>(`/tenants/${tenantId}/members?page=${memberPage}&page_size=20`) })
  const rolesKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'roles', 'active-assignment-options']
  const activeRoles = useQuery({
    queryKey: rolesKey,
    enabled: canManage,
    queryFn: () => api<Page<TenantRole>>(`/tenants/${tenantId}/roles?page=1&page_size=100&status=active`),
  })
  const invitationKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant-invitations']
  const invitations = useQuery({ queryKey: invitationKey, enabled: canManage, queryFn: () => api<{ items: Invitation[] }>(`/tenants/${tenantId}/invitations`) })
  const [inviteTarget, setInviteTarget] = useState('')
  const [inviteKind, setInviteKind] = useState<'email' | 'user_id'>('email')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [createdInvite, setCreatedInvite] = useState<CreatedInvitation | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const refresh = async () => { await client.invalidateQueries({ queryKey: tenantKey }); await client.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant-members'] }) }
  const patchTenant = useMutation({ mutationFn: (body: object) => api(`/tenants/${tenantId}`, { method: 'PATCH', body: JSON.stringify(body) }), onSuccess: refresh, onError: (e) => setError(errorText(e)) })
  const patchMember = useMutation({ mutationFn: ({ userId, body }: { userId: string; body: object }) => api(`/tenants/${tenantId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }), onSuccess: refresh, onError: (e) => setError(errorText(e)) })
  const add = useMutation({ mutationFn: (body: object) => api(`/tenants/${tenantId}/members`, { method: 'POST', body: JSON.stringify(body) }), onSuccess: refresh, onError: (e) => setError(errorText(e)) })
  const createInvite = useMutation({
    mutationFn: (body: object) => api<CreatedInvitation>(`/tenants/${tenantId}/invitations`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async (invite) => {
      setCreatedInvite(invite)
      setError('')
      setInviteTarget('')
      await client.invalidateQueries({ queryKey: invitationKey })
    },
    onError: (e) => setError(errorText(e)),
  })
  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) => api<void>(`/tenants/${tenantId}/invitations/${invitationId}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(''); await client.invalidateQueries({ queryKey: invitationKey }) },
    onError: (e) => setError(errorText(e)),
  })
  if (tenant.isLoading) return <main className="p-6">正在加载租户…</main>
  if (tenant.isError) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants">返回租户列表</Link><ErrorBox message={errorText(tenant.error)} /></main>
  const item = tenant.data!
  return <main className="space-y-5 p-6"><Link className="text-sm underline" to="/tenants">← 返回租户列表</Link><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">{item.name}</h1><p className="mt-1 text-sm text-muted-foreground">{item.slug} · {label[item.status]}{item.tenant_role ? ` · 我的角色：${label[item.tenant_role]}` : platformAdmin ? ' · 平台管理视图' : ''}</p></div><div className="flex flex-wrap gap-2">{canManage && item.status === 'active' && <><Link className={`${button} inline-flex items-center`} to="/tenants/$tenantId/roles" params={{ tenantId }}>角色管理</Link><Link className={`${button} inline-flex items-center`} to="/tenants/$tenantId/menus" params={{ tenantId }}>菜单管理</Link><Link className={`${button} inline-flex items-center`} to="/tenants/$tenantId/departments" params={{ tenantId }}>部门管理</Link><Link className={`${button} inline-flex items-center`} to="/tenants/$tenantId/dictionaries" params={{ tenantId }}>字典管理</Link><Link className={`${button} inline-flex items-center`} to="/tenants/$tenantId/configs" params={{ tenantId }}>参数配置</Link><Link className={`${button} inline-flex items-center`} to="/tenants/$tenantId/scheduled-tasks" params={{ tenantId }}>系统任务</Link></>}{(canManage || platformAdmin) && <TenantNameForm initial={item.name} onSave={(name) => patchTenant.mutate({ name })} />}{(canManage || platformAdmin) && <TenantValidityForm initialFrom={item.valid_from} initialUntil={item.valid_until} onSave={(valid_from, valid_until) => patchTenant.mutate({ valid_from, valid_until })} />}{canManageStatus && <StatusControl tenant={item} onChange={(status) => patchTenant.mutate({ status })} />}</div></header>
    <section className={panel}><h2 className="font-semibold">租户信息</h2><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">租户 ID</dt><dd>{item.tenant_id}</dd></div><div><dt className="text-muted-foreground">创建时间</dt><dd>{item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '—'}</dd></div><div><dt className="text-muted-foreground">有效期开始</dt><dd>{item.valid_from ? new Date(item.valid_from).toLocaleString('zh-CN') : '—'}</dd></div><div><dt className="text-muted-foreground">有效期结束</dt><dd>{item.valid_until ? new Date(item.valid_until).toLocaleString('zh-CN') : '—'}</dd></div></dl><p className="mt-3 text-sm text-muted-foreground">租户成员关系不会自动授予任何工作区业务数据访问权。</p></section>
    {error && <ErrorBox message={error} />}
    {(canManage || item.tenant_role === 'member') && <section className={`${panel} space-y-4`}><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">租户成员</h2><p className="text-sm text-muted-foreground">添加已有全局账号。邀请通过链接接受，不会自动加入任何 Workspace。</p></div>{canManage && <AddMember onAdd={(userId, role) => add.mutate({ user_id: userId, tenant_role: role })} pending={add.isPending} />}</div>
      {members.isLoading ? <p className="text-sm text-muted-foreground">正在加载成员…</p> : members.isError ? <ErrorBox message={errorText(members.error)} /> : members.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">成员</th><th className="p-3">账号 ID</th><th className="p-3">角色</th><th className="p-3">自定义角色</th><th className="p-3">状态</th>{canManage && <th className="p-3">管理</th>}</tr></thead><tbody>{members.data.items.map((m) => <tr key={m.user_id} className="border-b last:border-0"><td className="p-3">{m.nick_name || m.user_name}{m.email && <span className="block text-muted-foreground">{m.email}</span>}</td><td className="p-3">{m.user_id}</td><td className="p-3">{canManage && m.tenant_role !== 'owner' ? <select aria-label={`${m.user_name}角色`} className="rounded border bg-background p-1" value={m.tenant_role} onChange={(e) => patchMember.mutate({ userId: m.user_id, body: { tenant_role: e.target.value } })}><option value="member">成员</option><option value="admin">管理员</option>{item.tenant_role === 'owner' && <option value="owner">所有者</option>}</select> : label[m.tenant_role]}</td><td className="p-3">{canManage ? <MemberCustomRole tenantId={tenantId} actorId={actor?.user_id ?? 'anonymous'} member={m} roles={activeRoles.data?.items ?? []} rolesLoading={activeRoles.isLoading} rolesError={activeRoles.isError ? errorText(activeRoles.error) : undefined} membershipVersion={item.membership_version} canManage onError={(message) => setError(message)} /> : m.user_id === actor?.user_id && m.status === 'active' && m.tenant_role === 'member' ? <MemberCustomRole tenantId={tenantId} actorId={actor?.user_id ?? 'anonymous'} member={m} roles={[]} rolesLoading={false} membershipVersion={item.membership_version} canManage={false} onError={(message) => setError(message)} /> : '需租户管理员读取'}</td><td className="p-3">{label[m.status]}</td>{canManage && <td className="space-x-3 p-3">{m.tenant_role === 'owner' ? '所有者不可由此操作' : m.status === 'active' ? <><button className="underline" onClick={() => patchMember.mutate({ userId: m.user_id, body: { status: 'suspended' } })}>暂停</button><button className="underline" onClick={() => { if (window.confirm(`确定移除成员“${m.nick_name || m.user_name}”吗？`)) patchMember.mutate({ userId: m.user_id, body: { status: 'removed' } }) }}>移除</button></> : m.status === 'removed' || m.status === 'suspended' ? <button className="underline" onClick={() => patchMember.mutate({ userId: m.user_id, body: { status: 'active' } })}>重新加入</button> : '—'}</td>}</tr>)}</tbody></table></div> : <p className="py-5 text-center text-sm text-muted-foreground">暂无成员</p>}
      <Pager page={memberPage} size={20} total={members.data?.total ?? 0} setPage={setMemberPage} /></section>}
    {canManage && item.status === 'active' && <section className={`${panel} space-y-4`}>
      <div><h2 className="font-semibold">邀请链接</h2><p className="text-sm text-muted-foreground">收件人使用已有 Synapse 账号登录后接受邀请。租户管理员只能邀请为成员。</p></div>
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => {
        event.preventDefault()
        const target = inviteTarget.trim()
        if (!target) return
        createInvite.mutate({ [inviteKind]: target, tenant_role: item.tenant_role === 'owner' ? inviteRole : 'member' })
      }}>
        <label className="space-y-1 text-sm"><span>邀请对象</span><div className="flex gap-2"><select aria-label="邀请对象类型" className="h-10 rounded-md border bg-background px-2" value={inviteKind} onChange={(event) => setInviteKind(event.target.value as 'email' | 'user_id')}><option value="email">邮箱</option><option value="user_id">账号 ID</option></select><input required className={input} value={inviteTarget} onChange={(event) => setInviteTarget(event.target.value)} type={inviteKind === 'email' ? 'email' : 'text'} inputMode={inviteKind === 'user_id' ? 'numeric' : undefined} pattern={inviteKind === 'user_id' ? '[0-9]+' : undefined} placeholder={inviteKind === 'email' ? 'name@example.com' : '全局账号 ID'} /></div></label>
        <label className="space-y-1 text-sm"><span>租户角色</span><select className={input} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')}><option value="member">成员</option>{item.tenant_role === 'owner' && <option value="admin">管理员</option>}</select></label>
        <button className={`${primary} self-end`} disabled={createInvite.isPending}>{createInvite.isPending ? '正在创建…' : '创建邀请'}</button>
      </form>
      {createdInvite && <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">邀请链接已创建</p><p className="mt-1 break-all text-muted-foreground">{absoluteInviteLink(createdInvite.invite_link)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3"><button className={button} onClick={() => void copyInviteLink(createdInvite.invite_link).then(() => setCopyMessage('已复制邀请链接')).catch(() => setCopyMessage('复制失败，请手动复制上方链接'))}>复制链接</button><span role="status" className="text-muted-foreground">{copyMessage}</span><button className="text-sm underline" onClick={() => { setCreatedInvite(null); setCopyMessage('') }}>关闭</button></div>
      </div>}
      {invitations.isLoading ? <p className="text-sm text-muted-foreground">正在加载邀请…</p> : invitations.isError ? <ErrorBox message={errorText(invitations.error)} /> : invitations.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">邀请对象</th><th className="p-3">角色</th><th className="p-3">到期时间</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{invitations.data.items.map((invite) => <tr className="border-b last:border-0" key={invite.invitation_id}><td className="p-3">{invite.email || `账号 ${invite.target_user_id}`}</td><td className="p-3">{label[invite.tenant_role]}</td><td className="p-3">{new Date(invite.expires_at).toLocaleString('zh-CN')}</td><td className="p-3">{invite.expired ? '已过期' : '待接受'}</td><td className="p-3"><button className="underline disabled:opacity-50" disabled={revokeInvite.isPending} onClick={() => { if (window.confirm('撤销此邀请后，原邀请链接将不可使用。继续吗？')) revokeInvite.mutate(invite.invitation_id) }}>撤销</button></td></tr>)}</tbody></table></div> : <p className="py-4 text-center text-sm text-muted-foreground">暂无待处理邀请</p>}
    </section>}
  </main>
}

function absoluteInviteLink(path: string) {
  return new URL(path, window.location.origin).toString()
}

function MemberCustomRole({
  tenantId, actorId, member, roles, rolesLoading, rolesError, membershipVersion, canManage, onError,
}: {
  tenantId: string
  actorId: string
  member: Member
  roles: TenantRole[]
  rolesLoading: boolean
  rolesError?: string
  membershipVersion: number
  canManage: boolean
  onError: (message: string) => void
}) {
  const client = useQueryClient()
  const canAssign = member.status === 'active' && member.tenant_role === 'member'
  const key = ['synapse', actorId, tenantId, 'personal', 'member-custom-role', membershipVersion, member.user_id] as const
  const assignment = useQuery({
    queryKey: key,
    enabled: canAssign,
    queryFn: () => api<MemberCustomRoleResponse>(`/tenants/${tenantId}/members/${member.user_id}/custom-role`),
  })
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'personal', 'member-custom-role'] })
    await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'personal', 'tenant-members'] })
    await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'personal', 'tenant'] })
  }
  const assign = useMutation({
    mutationFn: (roleId: string) => api<MemberCustomRoleResponse>(`/tenants/${tenantId}/members/${member.user_id}/custom-role`, { method: 'PUT', body: JSON.stringify({ role_id: roleId }) }),
    onSuccess: async () => { onError(''); await invalidate() },
    onError: (cause) => onError(errorText(cause)),
  })
  const revoke = useMutation({
    mutationFn: () => api<void>(`/tenants/${tenantId}/members/${member.user_id}/custom-role`, { method: 'DELETE' }),
    onSuccess: async () => { onError(''); await invalidate() },
    onError: (cause) => onError(errorText(cause)),
  })
  if (!canAssign) return <span className="text-muted-foreground">—</span>
  if (assignment.isLoading || (canManage && rolesLoading)) return <span className="text-muted-foreground">加载中…</span>
  if (assignment.isError) return <span role="alert" className="text-destructive">读取失败：{errorText(assignment.error)}</span>
  if (canManage && rolesError) return <span role="alert" className="text-destructive">角色列表加载失败：{rolesError}</span>
  if (!canManage) return <span>{assignment.data?.role?.role_name ?? '未分配'}</span>
  const selected = assignment.data?.role?.role_id ?? ''
  return <div className="flex flex-wrap items-center gap-2">
    <select aria-label={`${member.user_name}自定义角色`} className="max-w-52 rounded border bg-background p-1" value={selected} disabled={assign.isPending || revoke.isPending} onChange={(event) => {
      if (event.target.value) assign.mutate(event.target.value)
    }}>
      <option value="">{assignment.data?.role ? '选择其他角色…' : '未分配'}</option>
      {roles.map((role) => <option key={role.role_id} value={role.role_id}>{role.role_name}</option>)}
    </select>
    {assignment.data?.role && <button className="underline disabled:opacity-50" disabled={assign.isPending || revoke.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? '撤销中…' : '撤销'}</button>}
    {(assign.isPending || revoke.isPending) && <span className="text-muted-foreground">保存中…</span>}
  </div>
}

async function copyInviteLink(path: string) {
  await navigator.clipboard.writeText(absoluteInviteLink(path))
}

function AddMember({ onAdd, pending }: { onAdd: (userId: string, role: string) => void; pending: boolean }) {
  const [open, setOpen] = useState(false)
  return open ? <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); onAdd(String(f.get('user_id')), String(f.get('role'))); e.currentTarget.reset(); setOpen(false) }}><input required name="user_id" inputMode="numeric" pattern="[0-9]+" placeholder="已有账号 ID" className="h-9 rounded-md border bg-background px-3 text-sm" /><select name="role" className="h-9 rounded-md border bg-background px-2 text-sm"><option value="member">成员</option><option value="admin">管理员</option></select><button className={primary} disabled={pending}>添加</button><button type="button" className={button} onClick={() => setOpen(false)}>取消</button></form> : <button className={button} onClick={() => setOpen(true)}>添加已有成员</button>
}
function TenantNameForm({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  return open ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); if (name) onSave(String(name)); setOpen(false) }}><input name="name" required maxLength={120} defaultValue={initial} className="h-9 rounded border bg-background px-2" /><button className={button}>保存名称</button></form> : <button className={button} onClick={() => setOpen(true)}>编辑名称</button>
}
function TenantValidityForm({ initialFrom, initialUntil, onSave }: { initialFrom: string | null; initialUntil: string | null; onSave: (validFrom: string | null, validUntil: string | null) => void }) {
  const [open, setOpen] = useState(false)
  return open ? <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const from = toIsoInput(f.get('valid_from')) ?? null
    const until = toIsoInput(f.get('valid_until')) ?? null
    if (from && until && new Date(until) <= new Date(from)) return
    onSave(from, until)
    setOpen(false)
  }}><input type="datetime-local" name="valid_from" defaultValue={toLocalInput(initialFrom)} aria-label="有效期开始" className="h-9 rounded border bg-background px-2" /><input type="datetime-local" name="valid_until" defaultValue={toLocalInput(initialUntil)} aria-label="有效期结束" className="h-9 rounded border bg-background px-2" /><button className={button}>保存有效期</button><button type="button" className={button} onClick={() => setOpen(false)}>取消</button></form> : <button className={button} onClick={() => setOpen(true)}>编辑有效期</button>
}
function StatusControl({ tenant, onChange }: { tenant: Tenant; onChange: (status: Tenant['status']) => void }) {
  if (tenant.status === 'archived') return null
  return <><button className={button} onClick={() => onChange(tenant.status === 'active' ? 'suspended' : 'active')}>{tenant.status === 'active' ? '停用租户' : '重新启用'}</button><button className={button} onClick={() => { if (window.confirm(`确定归档租户“${tenant.name}”吗？`)) onChange('archived') }}>归档</button></>
}
function Pager({ page, size, total, setPage }: { page: number; size: number; total: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">共 {total} 条</span><div className="flex items-center gap-2"><button className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {pages}</span><button className={button} disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</button></div></div>
}
function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div> }
function errorText(e: unknown) { if (e instanceof ApiProblem) return `${e.message}${e.code ? `（${e.code}）` : ''}`; return e instanceof Error ? e.message : '操作失败，请稍后重试。' }

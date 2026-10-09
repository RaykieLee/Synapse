import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

const route = getRouteApi('/_authenticated/users/')
const pageSizes = [10, 20, 50, 100]

type GlobalUser = {
  user_id: string; user_name: string; nick_name: string | null; email: string | null
  phonenumber: string | null; sex: string | null; avatar: string | null
  status: 'active' | 'disabled'; platform_role: string; created_at: string | null; updated_at: string | null
}
type UserPage = { items: GlobalUser[]; total: number; page: number; page_size: number }
type UserProfile = Pick<GlobalUser, 'nick_name' | 'email' | 'phonenumber' | 'sex' | 'avatar'>

const userKey = (actorId: string, page: number, size: number, search: string) =>
  ['synapse', actorId, 'global', 'personal', 'users', page, size, search] as const

function errorMessage(error: unknown) {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return '用户名或邮箱已被使用。'
    if (error.status === 422) return '请检查输入内容和密码长度（至少 12 个字符）。'
    if (error.status === 403) return '当前账号没有平台用户管理权限。'
    if (error.status === 404) return '用户不存在或已删除，请刷新列表。'
    if (error.status === 0) return '无法连接服务，请稍后重试。'
  }
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

const optional = (value: string) => value.trim() || null

export function Users() {
  const params = route.useSearch()
  const navigate = route.useNavigate()
  const actor = useAuthStore((state) => state.auth.user)
  const actorId = actor?.user_id ?? 'anonymous'
  const client = useQueryClient()
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const search = params.search ?? ''
  const [searchInput, setSearchInput] = React.useState(search)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<GlobalUser | null>(null)
  const [resetting, setResetting] = React.useState<GlobalUser | null>(null)
  const [notice, setNotice] = React.useState('')
  const [actionError, setActionError] = React.useState('')

  React.useEffect(() => setSearchInput(search), [search])
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = searchInput.trim()
      if (value !== search) void navigate({ search: (previous) => ({ ...previous, search: value, page: 1 }) })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [navigate, search, searchInput])

  const users = useQuery({
    queryKey: userKey(actorId, page, pageSize, search),
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (search) query.set('search', search)
      return api<UserPage>(`/users?${query}`)
    },
    enabled: actor?.platform_role === 'platform_admin',
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['synapse', actorId, 'global', 'personal', 'users'] })
  const create = useMutation({
    mutationFn: (body: object) => api<GlobalUser>('/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => { setCreateOpen(false); setActionError(''); setNotice('用户账号已创建。'); await navigate({ search: (old) => ({ ...old, search: '', page: 1 }) }); await refresh() },
    onError: (error) => setActionError(errorMessage(error)),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserProfile }) => api<GlobalUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async () => { setEditing(null); setActionError(''); setNotice('用户资料已更新。'); await refresh() },
    onError: (error) => setActionError(errorMessage(error)),
  })
  const status = useMutation({
    mutationFn: ({ id, value }: { id: string; value: GlobalUser['status'] }) => api<GlobalUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: value }) }),
    onSuccess: async (user) => { setActionError(''); setNotice(user.status === 'active' ? '账号已启用。' : '账号已停用，旧登录令牌已撤销。'); await refresh() },
    onError: (error) => setActionError(errorMessage(error)),
  })
  const reset = useMutation({
    mutationFn: ({ id, new_password }: { id: string; new_password: string }) => api<void>(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password }) }),
    onSuccess: async () => { setResetting(null); setActionError(''); setNotice('密码已重置，旧登录令牌已撤销。'); await refresh() },
    onError: (error) => setActionError(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { setActionError(''); setNotice('账号已软删除；租户和 Workspace 成员关系未修改。'); await refresh() },
    onError: (error) => setActionError(errorMessage(error)),
  })

  const items = users.data?.items ?? []
  const total = users.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const changePage = (next: number) => void navigate({ search: (old) => ({ ...old, page: next }) })
  React.useEffect(() => {
    if (users.data && page > pageCount) {
      void navigate({ search: (old) => ({ ...old, page: pageCount }) })
    }
  }, [navigate, page, pageCount, users.data])

  return <>
    <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'><div><h1 className='text-2xl font-bold tracking-tight'>全局用户</h1><p className='mt-1 text-sm text-muted-foreground'>管理平台账号。租户与 Workspace 成员资格由各自管理页面维护。</p></div><Button onClick={() => { setActionError(''); setCreateOpen(true) }}>创建用户</Button></div>
      <div className='flex flex-wrap items-end justify-between gap-3'><div className='w-full max-w-sm space-y-1.5'><Label htmlFor='global-user-search'>搜索用户</Label><Input id='global-user-search' value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder='用户名、昵称、邮箱或电话号码' /></div><label className='flex items-center gap-2 text-sm text-muted-foreground'>每页<select className='h-9 rounded-md border bg-background px-2 text-foreground' value={pageSize} onChange={(event) => void navigate({ search: (old) => ({ ...old, pageSize: Number(event.target.value), page: 1 }) })}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
      {notice && <div role='status' className='rounded-md border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-sm'>{notice}<button className='float-end underline' onClick={() => setNotice('')}>关闭</button></div>}
      {actionError && <div role='alert' className='rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive'>{actionError}<button className='float-end underline' onClick={() => setActionError('')}>关闭</button></div>}
      <section className='overflow-hidden rounded-md border'>
        {users.isLoading ? <p className='p-8 text-center text-sm text-muted-foreground'>正在加载用户…</p>
          : users.isError ? <div className='space-y-3 p-8 text-center'><p role='alert' className='text-sm text-destructive'>{errorMessage(users.error)}</p><Button variant='outline' onClick={() => void users.refetch()}>重试</Button></div>
            : items.length ? <div className='overflow-x-auto'><table className='w-full text-left text-sm'><thead><tr className='border-b bg-muted/40 text-muted-foreground'><th className='p-3'>用户名 / ID</th><th className='p-3'>昵称</th><th className='p-3'>邮箱</th><th className='p-3'>电话</th><th className='p-3'>状态</th><th className='p-3'>创建时间</th><th className='p-3'>操作</th></tr></thead><tbody>
              {items.map((user) => <tr key={user.user_id} className='border-b last:border-0'><td className='p-3'><span className='font-medium'>{user.user_name}</span><span className='block text-xs text-muted-foreground'>ID {user.user_id} · {user.platform_role}</span></td><td className='p-3'>{user.nick_name || '—'}</td><td className='p-3'>{user.email || '—'}</td><td className='p-3'>{user.phonenumber || '—'}</td><td className='p-3'><span className={`rounded-full px-2 py-1 text-xs ${user.status === 'active' ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{user.status === 'active' ? '正常' : '已停用'}</span></td><td className='p-3 whitespace-nowrap'>{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td><td className='p-3'><div className='flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap'><button className='underline underline-offset-4' onClick={() => { setActionError(''); setEditing(user) }}>编辑</button><button className='underline underline-offset-4' onClick={() => { setActionError(''); setResetting(user) }}>重置密码</button><button className='underline underline-offset-4' disabled={status.isPending} onClick={() => status.mutate({ id: user.user_id, value: user.status === 'active' ? 'disabled' : 'active' })}>{user.status === 'active' ? '停用' : '启用'}</button><button className='text-destructive underline underline-offset-4' disabled={remove.isPending} onClick={() => { if (window.confirm(`软删除账号“${user.user_name}”？这不会删除其租户或 Workspace 成员关系。`)) remove.mutate(user.user_id) }}>删除</button></div></td></tr>)}
            </tbody></table></div> : <p className='p-8 text-center text-sm text-muted-foreground'>{search ? '没有匹配的用户。' : '暂无用户。'}</p>}
      </section>
      <div className='flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground'><span>共 {total} 个账号 · 第 {Math.min(page, pageCount)} / {pageCount} 页</span><div className='flex gap-2'><Button variant='outline' size='sm' disabled={page <= 1 || users.isFetching} onClick={() => changePage(page - 1)}>上一页</Button><Button variant='outline' size='sm' disabled={page >= pageCount || users.isFetching} onClick={() => changePage(page + 1)}>下一页</Button></div></div>
    </Main>
    <UserCreateDialog open={createOpen} onOpenChange={setCreateOpen} pending={create.isPending} error={create.error ? errorMessage(create.error) : ''} onSubmit={(body) => create.mutate(body)} />
    <UserEditDialog user={editing} onOpenChange={(open) => !open && setEditing(null)} pending={update.isPending} error={update.error ? errorMessage(update.error) : ''} onSubmit={(body) => editing && update.mutate({ id: editing.user_id, body })} />
    <PasswordResetDialog user={resetting} onOpenChange={(open) => !open && setResetting(null)} pending={reset.isPending} error={reset.error ? errorMessage(reset.error) : ''} onSubmit={(new_password) => resetting && reset.mutate({ id: resetting.user_id, new_password })} />
  </>
}

function UserCreateDialog({ open, onOpenChange, pending, error, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: string; onSubmit: (body: object) => void }) {
  const [password, setPassword] = React.useState('')
  const [sex, setSex] = React.useState('')
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onSubmit({ user_name: String(values.get('user_name')).trim(), password, nick_name: String(values.get('nick_name')).trim(), email: optional(String(values.get('email') ?? '')), phonenumber: optional(String(values.get('phonenumber') ?? '')), sex: sex || null, avatar: optional(String(values.get('avatar') ?? '')) })
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!value) { setPassword(''); setSex('') }; onOpenChange(value) }}><DialogContent>
    <DialogHeader><DialogTitle>创建全局用户</DialogTitle><DialogDescription>请明确设置初始密码（至少 12 个字符）。新账号以普通用户角色创建。</DialogDescription></DialogHeader>
    <form className='space-y-3' onSubmit={submit}><Field label='用户名' name='user_name' required maxLength={64} /><div className='space-y-1.5'><Label htmlFor='initial-password'>初始密码</Label><Input id='initial-password' type='password' autoComplete='new-password' minLength={12} maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} /></div><Field label='昵称' name='nick_name' maxLength={100} /><Field label='邮箱' name='email' type='email' /><Field label='电话号码' name='phonenumber' maxLength={32} /><SexField value={sex} onChange={setSex} /><Field label='头像 URL' name='avatar' />{error && <p role='alert' className='text-sm text-destructive'>{error}</p>}<DialogFooter><Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button><Button type='submit' disabled={pending || password.length < 12}>{pending ? '创建中…' : '创建账号'}</Button></DialogFooter></form>
  </DialogContent></Dialog>
}

function UserEditDialog({ user, onOpenChange, pending, error, onSubmit }: { user: GlobalUser | null; onOpenChange: (open: boolean) => void; pending: boolean; error: string; onSubmit: (body: UserProfile) => void }) {
  const [sex, setSex] = React.useState(user?.sex ?? '')
  React.useEffect(() => setSex(user?.sex ?? ''), [user])
  if (!user) return null
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onSubmit({ nick_name: String(values.get('nick_name')).trim(), email: optional(String(values.get('email') ?? '')), phonenumber: optional(String(values.get('phonenumber') ?? '')), sex: sex || null, avatar: optional(String(values.get('avatar') ?? '')) })
  }
  return <Dialog open onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>编辑用户资料</DialogTitle><DialogDescription>{user.user_name} · ID {user.user_id}。用户名和平台角色不能在此修改。</DialogDescription></DialogHeader><form className='space-y-3' onSubmit={submit}><Field label='昵称' name='nick_name' defaultValue={user.nick_name ?? ''} maxLength={100} /><Field label='邮箱' name='email' type='email' defaultValue={user.email ?? ''} /><Field label='电话号码' name='phonenumber' defaultValue={user.phonenumber ?? ''} maxLength={32} /><SexField value={sex} onChange={setSex} /><Field label='头像 URL' name='avatar' defaultValue={user.avatar ?? ''} />{error && <p role='alert' className='text-sm text-destructive'>{error}</p>}<DialogFooter><Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button><Button type='submit' disabled={pending}>{pending ? '保存中…' : '保存资料'}</Button></DialogFooter></form></DialogContent></Dialog>
}

function PasswordResetDialog({ user, onOpenChange, pending, error, onSubmit }: { user: GlobalUser | null; onOpenChange: (open: boolean) => void; pending: boolean; error: string; onSubmit: (password: string) => void }) {
  const [password, setPassword] = React.useState('')
  React.useEffect(() => setPassword(''), [user])
  if (!user) return null
  return <Dialog open onOpenChange={(value) => { if (!value) setPassword(''); onOpenChange(value) }}><DialogContent><DialogHeader><DialogTitle>重置密码</DialogTitle><DialogDescription>为 {user.user_name} 设置至少 12 个字符的新密码；旧登录令牌会被撤销。</DialogDescription></DialogHeader><form className='space-y-3' onSubmit={(event) => { event.preventDefault(); onSubmit(password) }}><div className='space-y-1.5'><Label htmlFor='reset-password'>新密码</Label><Input id='reset-password' type='password' autoComplete='new-password' minLength={12} maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>{error && <p role='alert' className='text-sm text-destructive'>{error}</p>}<DialogFooter><Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button><Button type='submit' disabled={pending || password.length < 12}>{pending ? '重置中…' : '重置密码'}</Button></DialogFooter></form></DialogContent></Dialog>
}

function Field({ label, name, type = 'text', required = false, maxLength, defaultValue = '' }: { label: string; name: string; type?: string; required?: boolean; maxLength?: number; defaultValue?: string }) {
  return <div className='space-y-1.5'><Label htmlFor={`global-user-${name}`}>{label}</Label><Input id={`global-user-${name}`} name={name} type={type} required={required} maxLength={maxLength} defaultValue={defaultValue} /></div>
}

function SexField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className='space-y-1.5'><Label htmlFor='global-user-sex'>性别</Label><select id='global-user-sex' className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={value} onChange={(event) => onChange(event.target.value)}><option value=''>未设置</option><option value='0'>未知</option><option value='1'>男</option><option value='2'>女</option></select></div>
}

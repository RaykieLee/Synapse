import * as React from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { DetailDialog } from '@/components/detail-dialog'
import { getLocale, useLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'
import {
  createUser,
  deleteUser,
  listUsers,
  patchUser,
  resetUserPassword,
  type GlobalUser,
  type UserCreatePayload,
  type UserProfilePayload,
} from '@/api/users'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiProblem } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'

const route = getRouteApi('/_authenticated/users/')
const pageSizes = [10, 20, 50, 100]

const userKey = (actorId: string, page: number, size: number, search: string) =>
  ['synapse', actorId, 'global', 'personal', 'users', page, size, search] as const

function errorMessage(error: unknown) {
  const english = getLocale() === 'en'
  if (error instanceof ApiProblem) {
    if (error.status === 409) return english ? 'A username or email is already in use.' : '用户名或邮箱已被使用。'
    if (error.status === 422) return english ? 'Check the input fields and password length (at least 12 characters).' : '请检查输入内容和密码长度（至少 12 个字符）。'
    if (error.status === 403) return english ? 'This account cannot manage platform users.' : '当前账号没有平台用户管理权限。'
    if (error.status === 404) return english ? 'The user was not found or has been deleted. Refresh the list.' : '用户不存在或已删除，请刷新列表。'
    if (error.status === 0) return english ? 'Could not reach the service. Try again later.' : '无法连接服务，请稍后重试。'
    const identifier = error.code || error.status
    return english ? `The request failed (${identifier}). Try again.` : `请求失败（${identifier}），请重试。`
  }
  return english ? 'The operation failed. Try again.' : '操作失败，请重试。'
}

function fieldError(error: unknown, field: string) {
  if (!(error instanceof ApiProblem) || error.status !== 422) return ''
  if (!error.errors?.some((entry) => entry.field === field)) return ''
  const english = getLocale() === 'en'
  const labels: Record<string, string> = english
    ? { user_name: 'username', email: 'email', password: 'password', nick_name: 'nickname', phonenumber: 'phone number', avatar: 'avatar URL', sex: 'sex' }
    : { user_name: '用户名', email: '邮箱', password: '密码', nick_name: '昵称', phonenumber: '电话号码', avatar: '头像 URL', sex: '性别' }
  return english ? `Check the ${labels[field] || 'field'}.` : `请检查${labels[field] || '此字段'}。`
}

function localizedNotice(message: string) {
  if (getLocale() !== 'en') return message
  const translations: Record<string, string> = {
    '用户账号已创建。': 'User account created.',
    '用户资料已更新。': 'User profile updated.',
    '账号已启用。': 'Account enabled.',
    '账号已停用，旧登录令牌已撤销。': 'Account disabled. Existing login tokens were revoked.',
    '密码已重置，旧登录令牌已撤销。': 'Password reset. Existing login tokens were revoked.',
    '账号已软删除；租户和 Workspace 成员关系未修改。': 'Account soft-deleted. Tenant and Workspace memberships were not changed.',
  }
  return translations[message] || message
}

const optional = (value: string) => value.trim() || null

export function Users() {
  const params = route.useSearch()
  const navigate = route.useNavigate()
  const actor = useAuthStore((state) => state.auth.user)
  const actorId = actor?.user_id ?? 'anonymous'
  const locale = useLocale()
  const client = useQueryClient()
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const search = params.search ?? ''
  const [lastSearch, setLastSearch] = React.useState(search)
  const [searchInput, setSearchInput] = React.useState(search)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<GlobalUser | null>(null)
  const [resetting, setResetting] = React.useState<GlobalUser | null>(null)
  const [confirming, setConfirming] = React.useState<{ user: GlobalUser; action: 'disable' | 'enable' | 'delete' } | null>(null)
  const [notice, setNotice] = React.useState('')
  const [actionError, setActionError] = React.useState<unknown>('')

  if (search !== lastSearch) {
    setLastSearch(search)
    setSearchInput(search)
  }
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = searchInput.trim()
      if (value !== search) void navigate({ search: (previous) => ({ ...previous, search: value, page: 1 }) })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [navigate, search, searchInput])

  const users = useQuery({
    queryKey: userKey(actorId, page, pageSize, search),
    queryFn: () =>
      listUsers({ page, pageSize, search: search || undefined }),
    enabled: actor?.platform_role === 'platform_admin',
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['synapse', actorId, 'global', 'personal', 'users'] })
  const create = useMutation({
    mutationFn: (body: UserCreatePayload) => createUser(body),
    onSuccess: async () => { setCreateOpen(false); setActionError(''); setNotice('用户账号已创建。'); await navigate({ search: (old) => ({ ...old, search: '', page: 1 }) }); await refresh() },
    onError: (error) => setActionError(error),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserProfilePayload }) =>
      patchUser(id, body),
    onSuccess: async () => { setEditing(null); setActionError(''); setNotice('用户资料已更新。'); await refresh() },
    onError: (error) => setActionError(error),
  })
  const status = useMutation({
    mutationFn: ({ id, value }: { id: string; value: GlobalUser['status'] }) =>
      patchUser(id, { status: value }),
    onSuccess: async (user) => { setActionError(''); setNotice(user.status === 'active' ? '账号已启用。' : '账号已停用，旧登录令牌已撤销。'); await refresh() },
    onError: (error) => setActionError(error),
  })
  const reset = useMutation({
    mutationFn: ({ id, new_password }: { id: string; new_password: string }) =>
      resetUserPassword(id, { new_password }),
    onSuccess: async () => { setResetting(null); setActionError(''); setNotice('密码已重置，旧登录令牌已撤销。'); await refresh() },
    onError: (error) => setActionError(error),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: async () => { setActionError(''); setNotice('账号已软删除；租户和 Workspace 成员关系未修改。'); await refresh() },
    onError: (error) => setActionError(error),
  })
  const beginConfirmation = (user: GlobalUser, action: 'disable' | 'enable' | 'delete') => {
    status.reset()
    remove.reset()
    setActionError('')
    setConfirming({ user, action })
  }

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
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'><div><h1 className='text-2xl font-bold tracking-tight'><LocalizedText text={"全局用户"} /></h1><p className='mt-1 text-sm text-muted-foreground'><LocalizedText text={"管理平台账号。租户与 Workspace 成员资格由各自管理页面维护。"} /></p></div><Button onClick={() => { setActionError(''); setCreateOpen(true) }}><LocalizedText text={"创建用户"} /></Button></div>
      <div className='flex flex-wrap items-end justify-between gap-3'><div className='w-full max-w-sm space-y-1.5'><Label htmlFor='global-user-search'><LocalizedText text={"搜索用户"} /></Label><Input id='global-user-search' value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder='用户名、昵称、邮箱或电话号码' /></div><label className='flex items-center gap-2 text-sm text-muted-foreground'><LocalizedText text={"每页"} /><LocalizedNativeSelect className='h-9 rounded-md border bg-background px-2 text-foreground' value={pageSize} onChange={(event) => void navigate({ search: (old) => ({ ...old, pageSize: Number(event.target.value), page: 1 }) })}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</LocalizedNativeSelect></label></div>
      {notice && <div role='status' className='rounded-md border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-sm'>{localizedNotice(notice)}<button className='float-end underline' onClick={() => setNotice('')}><LocalizedText text={"关闭"} /></button></div>}
      {Boolean(actionError) && <div role='alert' className='rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive'>{errorMessage(actionError)}<button className='float-end underline' onClick={() => setActionError('')}><LocalizedText text={"关闭"} /></button></div>}
      <section className='overflow-hidden rounded-md border'>
        {users.isLoading ? <p className='p-8 text-center text-sm text-muted-foreground'><LocalizedText text={"正在加载用户…"} /></p>
          : users.isError ? <div className='space-y-3 p-8 text-center'><p role='alert' className='text-sm text-destructive'>{errorMessage(users.error)}</p><Button variant='outline' onClick={() => void users.refetch()}><LocalizedText text={"重试"} /></Button></div>
            : items.length ? <div className='overflow-x-auto'><table className='w-full text-left text-sm'><thead><tr className='border-b bg-muted/40 text-muted-foreground'><th className='p-3'><LocalizedText text={"用户名"} /></th><th className='p-3'><LocalizedText text={"昵称"} /></th><th className='p-3'><LocalizedText text={"邮箱"} /></th><th className='p-3'><LocalizedText text={"电话"} /></th><th className='p-3'><LocalizedText text={"状态"} /></th><th className='p-3'><LocalizedText text={"创建时间"} /></th><th className='p-3'><LocalizedText text={"操作"} /></th></tr></thead><tbody>
      {items.map((user) => <tr key={user.user_id} className='border-b last:border-0'><td className='p-3'><span className='font-medium'>{user.user_name}</span><DetailDialog trigger={<LocalizedText text={"技术信息"} />} title={<LocalizedText text={"用户技术信息"} />} description={user.user_name} triggerClassName='mt-1 h-auto px-0 py-0 text-xs text-muted-foreground underline'><div className='space-y-1 text-sm'><p><LocalizedText text={"账号 ID："} /><code className='break-all'>{user.user_id}</code></p><p><LocalizedText text={"平台角色："} />{user.platform_role}</p></div></DetailDialog></td><td className='p-3'>{user.nick_name || '—'}</td><td className='p-3'>{user.email || '—'}</td><td className='p-3'>{user.phonenumber || '—'}</td><td className='p-3'><span className={`rounded-full px-2 py-1 text-xs ${user.status === 'active' ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{user.status === 'active' ? <LocalizedText text={"正常"} /> : <LocalizedText text={"已停用"} />}</span></td><td className='p-3 whitespace-nowrap'>{user.created_at ? new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'zh-CN').format(new Date(user.created_at)) : <LocalizedText text={"—"} />}</td><td className='p-3'><div className='flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap'><button className='underline underline-offset-4' onClick={() => { setActionError(''); setEditing(user) }}><LocalizedText text={"编辑"} /></button><button className='underline underline-offset-4' onClick={() => { setActionError(''); setResetting(user) }}><LocalizedText text={"重置密码"} /></button><button className='underline underline-offset-4' disabled={status.isPending} onClick={() => beginConfirmation(user, user.status === 'active' ? 'disable' : 'enable')}>{user.status === 'active' ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className='text-destructive underline underline-offset-4' disabled={remove.isPending} onClick={() => beginConfirmation(user, 'delete')}><LocalizedText text={"删除"} /></button></div></td></tr>)}
            </tbody></table></div> : <p className='p-8 text-center text-sm text-muted-foreground'>{search ? <LocalizedText text={"没有匹配的用户。"} /> : <LocalizedText text={"暂无用户。"} />}</p>}
      </section>
      <div className='flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground'><span><LocalizedText text={"共 "} />{total} <LocalizedText text={" 个账号 · 第 "} />{Math.min(page, pageCount)} <LocalizedText text={" / "} />{pageCount} <LocalizedText text={" 页"} /></span><div className='flex gap-2'><Button variant='outline' size='sm' disabled={page <= 1 || users.isFetching} onClick={() => changePage(page - 1)}><LocalizedText text={"上一页"} /></Button><Button variant='outline' size='sm' disabled={page >= pageCount || users.isFetching} onClick={() => changePage(page + 1)}><LocalizedText text={"下一页"} /></Button></div></div>
    </Main>
    <UserCreateDialog open={createOpen} onOpenChange={setCreateOpen} pending={create.isPending} error={create.error} onSubmit={(body) => create.mutate(body)} />
    <UserEditDialog user={editing} onOpenChange={(open) => !open && setEditing(null)} pending={update.isPending} error={update.error} onSubmit={(body) => editing && update.mutate({ id: editing.user_id, body })} />
    <PasswordResetDialog user={resetting} onOpenChange={(open) => !open && setResetting(null)} pending={reset.isPending} error={reset.error ? errorMessage(reset.error) : ''} onSubmit={(new_password) => resetting && reset.mutate({ id: resetting.user_id, new_password })} />
    <Dialog open={!!confirming} onOpenChange={(open) => { if (!open && !status.isPending && !remove.isPending) { setConfirming(null); status.reset(); remove.reset(); setActionError('') } }}><DialogContent><DialogHeader><DialogTitle>{confirming?.action === 'delete' ? <LocalizedText text={"软删除账号"} /> : confirming?.action === 'disable' ? <LocalizedText text={"停用账号"} /> : <LocalizedText text={"启用账号"} />}</DialogTitle><DialogDescription>{confirming && <><LocalizedText text={"目标账号："} /><strong>{confirming.user.user_name}</strong>（{confirming.user.user_id}）。{confirming.action === 'delete' ? <LocalizedText text={"软删除会撤销该账号的旧登录令牌；租户与 Workspace 成员关系保留，但用户不能再登录。"} /> : confirming.action === 'disable' ? <LocalizedText text={"停用会撤销该账号的旧登录令牌；租户与 Workspace 成员关系保留。"} /> : <LocalizedText text={"启用会撤销该账号的旧登录令牌并允许用户再次登录；现有租户与 Workspace 成员关系保持不变。"} />}</>}</DialogDescription></DialogHeader>{confirming && (confirming.action === 'delete' ? remove.error : status.error) && <p role='alert' className='text-sm text-destructive'>{errorMessage(confirming.action === 'delete' ? remove.error : status.error)}</p>}<DialogFooter><Button type='button' variant='outline' disabled={status.isPending || remove.isPending} onClick={() => { setConfirming(null); status.reset(); remove.reset(); setActionError('') }}><LocalizedText text={"取消"} /></Button><Button type='button' variant={confirming?.action === 'delete' ? 'destructive' : 'default'} disabled={status.isPending || remove.isPending} onClick={() => { if (!confirming) return; if (confirming.action === 'delete') remove.mutate(confirming.user.user_id, { onSuccess: () => setConfirming(null) }); else status.mutate({ id: confirming.user.user_id, value: confirming.action === 'disable' ? 'disabled' : 'active' }, { onSuccess: () => setConfirming(null) }) }}>{status.isPending || remove.isPending ? <LocalizedText text={"正在处理…"} /> : <LocalizedText text={confirming?.action === 'delete' ? "确认软删除" : confirming?.action === 'disable' ? "确认停用" : "确认启用"} />}</Button></DialogFooter></DialogContent></Dialog>
  </>
}

function UserCreateDialog({ open, onOpenChange, pending, error, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: unknown; onSubmit: (body: UserCreatePayload) => void }) {
  const [password, setPassword] = React.useState('')
  const [sex, setSex] = React.useState('')
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onSubmit({ user_name: String(values.get('user_name')).trim(), password, nick_name: String(values.get('nick_name')).trim(), email: optional(String(values.get('email') ?? '')), phonenumber: optional(String(values.get('phonenumber') ?? '')), sex: sex || null, avatar: optional(String(values.get('avatar') ?? '')) })
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!value) { setPassword(''); setSex('') }; onOpenChange(value) }}><DialogContent>
    <DialogHeader><DialogTitle><LocalizedText text={"创建全局用户"} /></DialogTitle><DialogDescription><LocalizedText text={"请明确设置初始密码（至少 12 个字符）。新账号以普通用户角色创建。"} /></DialogDescription></DialogHeader>
    <form className='space-y-3' onSubmit={submit}><Field label='用户名' name='user_name' required maxLength={64} error={fieldError(error, 'user_name')} /><div className='space-y-1.5'><Label htmlFor='initial-password'><LocalizedText text={"初始密码"} /></Label><Input id='initial-password' type='password' autoComplete='new-password' minLength={12} maxLength={256} required aria-invalid={!!fieldError(error, 'password')} value={password} onChange={(event) => setPassword(event.target.value)} />{fieldError(error, 'password') && <p className='text-xs text-destructive'>{fieldError(error, 'password')}</p>}</div><Field label='昵称' name='nick_name' maxLength={100} /><Field label='邮箱' name='email' type='email' error={fieldError(error, 'email')} /><Field label='电话号码' name='phonenumber' maxLength={32} /><SexField value={sex} onChange={setSex} /><Field label='头像 URL' name='avatar' />{Boolean(error) && !['user_name', 'email', 'password'].some((field) => fieldError(error, field)) && <p role='alert' className='text-sm text-destructive'>{errorMessage(error)}</p>}<DialogFooter><Button type='button' variant='outline' onClick={() => onOpenChange(false)}><LocalizedText text={"取消"} /></Button><Button type='submit' disabled={pending || password.length < 12}>{pending ? <LocalizedText text={"创建中…"} /> : <LocalizedText text={"创建账号"} />}</Button></DialogFooter></form>
  </DialogContent></Dialog>
}

function UserEditDialog({ user, onOpenChange, pending, error, onSubmit }: { user: GlobalUser | null; onOpenChange: (open: boolean) => void; pending: boolean; error: unknown; onSubmit: (body: UserProfilePayload) => void }) {
  if (!user) return null
  return <UserEditDialogForm key={user.user_id} user={user} onOpenChange={onOpenChange} pending={pending} error={error} onSubmit={onSubmit} />
}

function UserEditDialogForm({ user, onOpenChange, pending, error, onSubmit }: { user: GlobalUser; onOpenChange: (open: boolean) => void; pending: boolean; error: unknown; onSubmit: (body: UserProfilePayload) => void }) {
  const [sex, setSex] = React.useState(user.sex ?? '')
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onSubmit({ nick_name: String(values.get('nick_name')).trim(), email: optional(String(values.get('email') ?? '')), phonenumber: optional(String(values.get('phonenumber') ?? '')), sex: sex || null, avatar: optional(String(values.get('avatar') ?? '')) })
  }
  return <Dialog open onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle><LocalizedText text={"编辑用户资料"} /></DialogTitle><DialogDescription>{user.user_name} <LocalizedText text={" · ID "} />{user.user_id}<LocalizedText text={"。用户名和平台角色不能在此修改。"} /></DialogDescription></DialogHeader><form className='space-y-3' onSubmit={submit}><Field label='昵称' name='nick_name' defaultValue={user.nick_name ?? ''} maxLength={100} /><Field label='邮箱' name='email' type='email' defaultValue={user.email ?? ''} error={fieldError(error, 'email')} /><Field label='电话号码' name='phonenumber' defaultValue={user.phonenumber ?? ''} maxLength={32} /><SexField value={sex} onChange={setSex} /><Field label='头像 URL' name='avatar' defaultValue={user.avatar ?? ''} />{Boolean(error) && !fieldError(error, 'email') && <p role='alert' className='text-sm text-destructive'>{errorMessage(error)}</p>}<DialogFooter><Button type='button' variant='outline' onClick={() => onOpenChange(false)}><LocalizedText text={"取消"} /></Button><Button type='submit' disabled={pending}>{pending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存资料"} />}</Button></DialogFooter></form></DialogContent></Dialog>
}

function PasswordResetDialog({ user, onOpenChange, pending, error, onSubmit }: { user: GlobalUser | null; onOpenChange: (open: boolean) => void; pending: boolean; error: string; onSubmit: (password: string) => void }) {
  if (!user) return null
  return <PasswordResetDialogForm key={user.user_id} user={user} onOpenChange={onOpenChange} pending={pending} error={error} onSubmit={onSubmit} />
}

function PasswordResetDialogForm({ user, onOpenChange, pending, error, onSubmit }: { user: GlobalUser; onOpenChange: (open: boolean) => void; pending: boolean; error: string; onSubmit: (password: string) => void }) {
  const [password, setPassword] = React.useState('')
  return <Dialog open onOpenChange={(value) => { if (!value) setPassword(''); onOpenChange(value) }}><DialogContent><DialogHeader><DialogTitle><LocalizedText text={"重置密码"} /></DialogTitle><DialogDescription><LocalizedText text={"为 "} />{user.user_name} <LocalizedText text={" 设置至少 12 个字符的新密码；旧登录令牌会被撤销。"} /></DialogDescription></DialogHeader><form className='space-y-3' onSubmit={(event) => { event.preventDefault(); onSubmit(password) }}><div className='space-y-1.5'><Label htmlFor='reset-password'><LocalizedText text={"新密码"} /></Label><Input id='reset-password' type='password' autoComplete='new-password' minLength={12} maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>{error && <p role='alert' className='text-sm text-destructive'>{error}</p>}<DialogFooter><Button type='button' variant='outline' onClick={() => onOpenChange(false)}><LocalizedText text={"取消"} /></Button><Button type='submit' disabled={pending || password.length < 12}>{pending ? <LocalizedText text={"重置中…"} /> : <LocalizedText text={"重置密码"} />}</Button></DialogFooter></form></DialogContent></Dialog>
}

function Field({ label, name, type = 'text', required = false, maxLength, defaultValue = '', error = '' }: { label: string; name: string; type?: string; required?: boolean; maxLength?: number; defaultValue?: string; error?: string }) {
  return <div className='space-y-1.5'><Label htmlFor={`global-user-${name}`}><LocalizedText text={label} /></Label><Input id={`global-user-${name}`} name={name} type={type} required={required} maxLength={maxLength} defaultValue={defaultValue} aria-invalid={!!error} />{error && <p className='text-xs text-destructive'>{error}</p>}</div>
}

function SexField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className='space-y-1.5'><Label htmlFor='global-user-sex'><LocalizedText text={"性别"} /></Label><LocalizedNativeSelect id='global-user-sex' className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={value} onChange={(event) => onChange(event.target.value)}><option value=''><LocalizedText text={"未设置"} /></option><option value='0'><LocalizedText text={"未知"} /></option><option value='1'><LocalizedText text={"男"} /></option><option value='2'><LocalizedText text={"女"} /></option></LocalizedNativeSelect></div>
}

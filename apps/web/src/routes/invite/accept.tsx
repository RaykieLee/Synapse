import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  acceptTenantInvitation,
  registerAndAcceptTenantInvitation,
  type TenantInvitationMembership,
} from '@/api/tenant-invitations'
import { ApiProblem, api, type AuthUser } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'


export const Route = createFileRoute('/invite/accept')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: InvitationAcceptPage,
})

function InvitationAcceptPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const accessToken = useAuthStore((state) => state.auth.accessToken)
  const setAccessToken = useAuthStore((state) => state.auth.setAccessToken)
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState<TenantInvitationMembership | null>(
    null
  )

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<{ access_token: string; user: AuthUser }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ user_name: username, password }),
      })
      setAccessToken(result.access_token)
      setUser(result.user)
      setPassword('')
      setConfirmPassword('')
    } catch (cause) {
      setError(invitationError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    if (!token) return
    setBusy(true)
    setError('')
    try {
      const result = await acceptTenantInvitation({ token })
      setAccepted(result)
      await clearInvitationFromUrl()
    } catch (cause) {
      setError(invitationError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 12) {
      setError('密码至少需要 12 个字符。')
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await registerAndAcceptTenantInvitation({
        token,
        user_name: username.trim(),
        password,
      })
      // The API creates the account and tenant membership atomically, and
      // returns a normal Synapse access token. Store no invitation token or
      // password in browser persistence.
      setAccessToken(result.access_token)
      setUser(result.user)
      setAccepted(result.tenant)
      setPassword('')
      setConfirmPassword('')
      await clearInvitationFromUrl()
    } catch (cause) {
      if (cause instanceof ApiProblem && cause.code === 'INVITATION_REQUIRES_EXISTING_ACCOUNT') {
        setAuthMode('signin')
      }
      setError(invitationError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function clearInvitationFromUrl() {
    await navigate({ to: '/invite/accept', search: { token: '' }, replace: true })
  }

  return <main className="grid min-h-svh place-items-center bg-muted/30 p-4">
    <section className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-6 shadow-sm">
      <div><p className="text-sm font-medium text-primary"><LocalizedText text={"Synapse 租户邀请"} /></p><h1 className="mt-1 text-2xl font-semibold"><LocalizedText text={"接受邀请"} /></h1><p className="mt-2 text-sm text-muted-foreground"><LocalizedText text={"此链接只可使用一次，并且需要使用邀请指定的账号接受。接受租户邀请不会自动加入任何 Workspace。"} /></p></div>
      {!token && <ErrorNotice message="邀请链接缺少 token。请向邀请方索取有效链接。" />}
      {error && <ErrorNotice message={error} />}
      {accepted ? <div className="space-y-3 rounded-md border border-emerald-600/30 bg-emerald-500/5 p-4">
        <h2 className="font-medium"><LocalizedText text={"已加入租户"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText text={"租户 ID："} />{accepted.tenant_id} <LocalizedText text={" · 角色："} />{accepted.tenant_role}</p>
        <p className="text-sm text-muted-foreground"><LocalizedText text={"当前没有自动创建 Workspace 成员关系。如需访问空间，请由空间管理员另行添加。"} /></p>
        <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground" onClick={() => void navigate({ to: '/tenants/$tenantId', params: { tenantId: accepted.tenant_id } })}><LocalizedText text={"查看租户"} /></button>
      </div> : accessToken ? <div className="space-y-3">
        <p className="text-sm"><LocalizedText text={"已登录。请确认这是接受此邀请的账号。"} /></p>
        <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50" disabled={!token || busy} onClick={() => void accept()}>{busy ? <LocalizedText text={"处理中…"} /> : <LocalizedText text={"接受租户邀请"} />}</button>
      </div> : <div className="space-y-4">
        <div className="flex gap-2 border-b pb-3"><button type="button" className={`px-2 py-1 text-sm ${authMode === 'signin' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`} onClick={() => { setAuthMode('signin'); setError(''); setPassword(''); setConfirmPassword('') }}><LocalizedText text={"已有账号，登录"} /></button><button type="button" className={`px-2 py-1 text-sm ${authMode === 'register' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`} onClick={() => { setAuthMode('register'); setError(''); setPassword(''); setConfirmPassword('') }}><LocalizedText text={"没有账号，创建账号"} /></button></div>
        {authMode === 'signin' ? <form className="space-y-3" onSubmit={(event) => void signIn(event)}>
          <label className="block space-y-1 text-sm"><span><LocalizedText text={"用户名"} /></span><Input required autoComplete="username" className="h-10 w-full rounded-md border bg-background px-3" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="block space-y-1 text-sm"><span><LocalizedText text={"密码"} /></span><Input required type="password" autoComplete="current-password" className="h-10 w-full rounded-md border bg-background px-3" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !token}>{busy ? <LocalizedText text={"正在登录…"} /> : <LocalizedText text={"登录并继续"} />}</button>
        </form> : <form className="space-y-3" onSubmit={(event) => void register(event)}>
          <p className="text-sm text-muted-foreground"><LocalizedText text={"新账号将绑定到此邀请指定的邮箱和租户。邮箱由邀请链接验证，无需填写；租户成员资格会与账号一并创建。"} /></p>
          <label className="block space-y-1 text-sm"><span><LocalizedText text={"用户名"} /></span><Input required minLength={1} maxLength={64} autoComplete="username" className="h-10 w-full rounded-md border bg-background px-3" value={username} onChange={(event) => setUsername(event.target.value)} /><span className="block text-xs text-muted-foreground"><LocalizedText text={"最多 64 个字符，创建后不可更改。"} /></span></label>
          <label className="block space-y-1 text-sm"><span><LocalizedText text={"创建密码"} /></span><Input required minLength={12} maxLength={256} type="password" autoComplete="new-password" className="h-10 w-full rounded-md border bg-background px-3" value={password} onChange={(event) => setPassword(event.target.value)} /><span className="block text-xs text-muted-foreground"><LocalizedText text={"至少 12 个字符。建议使用较长且唯一的密码。"} /></span></label>
          <PasswordStrength password={password} />
          <label className="block space-y-1 text-sm"><span><LocalizedText text={"确认密码"} /></span><Input required minLength={12} maxLength={256} type="password" autoComplete="new-password" className="h-10 w-full rounded-md border bg-background px-3" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !token || password.length < 12 || password !== confirmPassword || !username.trim()}>{busy ? <LocalizedText text={"正在创建账号并加入租户…"} /> : <LocalizedText text={"创建账号并加入租户"} />}</button>
        </form>}
      </div>}
      <div className="border-t pt-3 text-sm"><Link className="underline" to="/sign-in" search={{ redirect: `${window.location.pathname}${window.location.search}` }}><LocalizedText text={"返回登录页"} /></Link></div>
    </section>
  </main>
}

function invitationError(error: unknown): string {
  if (!(error instanceof ApiProblem)) return error instanceof Error ? error.message : '操作失败，请稍后重试。'
  switch (error.code) {
    case 'INVITATION_EXPIRED': return '此邀请已过期，请向租户管理员索取新链接。'
    case 'INVITATION_NOT_PENDING': return '此邀请已被撤销或已使用，无法再次接受。'
    case 'INVITATION_NOT_FOUND': return '找不到此邀请，请检查链接是否完整。'
    case 'INVITATION_TARGET_MISMATCH': return '当前账号与邀请指定的邮箱或账号不匹配，请切换到受邀账号。'
    case 'INVITATION_REQUIRES_EXISTING_ACCOUNT': return '此邀请已绑定现有账号，请使用该账号登录后接受邀请。'
    case 'TENANT_INACTIVE': return '该租户当前不可加入，请联系租户管理员。'
    case 'ALREADY_TENANT_MEMBER': return '当前账号已经是该租户成员。'
    case 'INVALID_CREDENTIALS': return '用户名或密码不正确。'
    case 'ACCOUNT_INACTIVE': return '此账号已停用，请联系平台管理员。'
    case 'ACCOUNT_CONFLICT': return '此用户名或邮箱已被使用。若邮箱对应已有账号，请切换到登录方式。'
    case 'AUTHENTICATION_REQUIRED': return '登录状态已失效，请重新登录。'
    default: return error.message
  }
}

function PasswordStrength({ password }: { password: string }) {
  const length = password.length >= 12
  const variety = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length
  const strong = length && variety >= 3
  return <p aria-live="polite" className={`text-xs ${strong ? 'text-emerald-700 dark:text-emerald-400' : length ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
    {password ? strong ? <LocalizedText text={"密码强度：较强"} /> : length ? <LocalizedText text={"密码强度：建议增加大小写字母、数字或符号组合"} /> : `密码至少 12 个字符（还差 ${12 - password.length} 个）` : <LocalizedText text={"密码强度：建议混合使用大小写字母、数字和符号"} />}
  </p>
}

function ErrorNotice({ message }: { message: string }) {
  return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</p>
}

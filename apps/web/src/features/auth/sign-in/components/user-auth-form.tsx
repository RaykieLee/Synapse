import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  UserRound,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem, api, type AuthUser } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const REMEMBERED_USERNAME_KEY = 'synapse.login.remembered-username'

const formSchema = z.object({
  user_name: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

function getRememberedUsername() {
  try {
    return window.localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function safeRedirectPath(redirectTo?: string) {
  if (
    !redirectTo ||
    !redirectTo.startsWith('/') ||
    redirectTo.startsWith('//') ||
    redirectTo.includes('\\')
  ) {
    return '/'
  }
  return redirectTo
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [rememberUsername, setRememberUsername] = useState(() =>
    Boolean(getRememberedUsername())
  )
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [dialog, setDialog] = useState<{
    title: string
    description: string
  } | null>(null)
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      user_name: getRememberedUsername(),
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (isLoading) return
    setIsLoading(true)
    setLoginError('')
    try {
      const result = await api<{ access_token: string; user: AuthUser }>(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      )
      auth.setAccessToken(result.access_token)
      auth.setUser(result.user)
      try {
        if (rememberUsername)
          window.localStorage.setItem(REMEMBERED_USERNAME_KEY, data.user_name)
        else window.localStorage.removeItem(REMEMBERED_USERNAME_KEY)
      } catch {
        // Sign-in still works when browser storage is unavailable.
      }
      await navigate({ to: safeRedirectPath(redirectTo), replace: true })
    } catch (error) {
      if (error instanceof ApiProblem) {
        if (error.status === 401) setLoginError('用户名或密码错误，请重试。')
        else if (error.status === 429)
          setLoginError('尝试次数过多，请稍后再试。')
        else if (error.status === 0)
          setLoginError('无法连接服务，请检查网络后重试。')
        else if (error.status >= 500)
          setLoginError('服务暂时不可用，请稍后再试。')
        else setLoginError('登录失败，请检查信息后重试。')
      } else {
        setLoginError('登录失败，请稍后重试。')
      }
    } finally {
      setIsLoading(false)
    }
  }

  function showUnavailable(title: string, description: string) {
    setDialog({ title, description })
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('login-form grid gap-5', className)}
        {...props}
      >
        <div className='login-tabs' aria-label='登录方式'>
          <button type='button' className='login-tab' aria-current='page'>
            账号登录
          </button>
          <button
            type='button'
            className='login-tab'
            onClick={() =>
              showUnavailable(
                '验证码登录暂未开通',
                '当前工作空间仅支持用户名和密码登录。如需其他登录方式，请联系管理员。'
              )
            }
          >
            验证码登录
          </button>
        </div>

        <FormField
          control={form.control}
          name='user_name'
          render={({ field }) => (
            <FormItem className='login-field'>
              <FormLabel className='login-field-label'>账号</FormLabel>
              <span className='login-input-wrap'>
                <UserRound aria-hidden='true' className='login-input-icon' />
                <FormControl>
                  <input
                    {...field}
                    autoComplete='username'
                    placeholder='请输入用户名'
                    className='login-field-input'
                    aria-invalid={Boolean(form.formState.errors.user_name)}
                  />
                </FormControl>
              </span>
              <FormDescription className='sr-only'>
                用于登录工作空间的用户名。
              </FormDescription>
              <FormMessage className='login-field-error' />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem className='login-field'>
              <FormLabel className='login-field-label'>密码</FormLabel>
              <span className='login-input-wrap'>
                <LockKeyhole aria-hidden='true' className='login-input-icon' />
                <FormControl>
                  <input
                    {...field}
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete='current-password'
                    placeholder='请输入密码'
                    className='login-field-input login-password-input'
                    aria-invalid={Boolean(form.formState.errors.password)}
                  />
                </FormControl>
                <button
                  type='button'
                  className='login-password-toggle'
                  aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? (
                    <EyeOff aria-hidden='true' />
                  ) : (
                    <Eye aria-hidden='true' />
                  )}
                </button>
              </span>
              <FormDescription className='sr-only'>
                对应账号的登录密码。
              </FormDescription>
              <FormMessage className='login-field-error' />
            </FormItem>
          )}
        />

        <div className='login-form-options'>
          <label className='login-remember-label'>
            <Checkbox
              checked={rememberUsername}
              onCheckedChange={(checked) =>
                setRememberUsername(checked === true)
              }
              aria-label='记住账号'
            />
            <span>记住账号</span>
          </label>
          <button
            type='button'
            className='login-text-button'
            onClick={() =>
              showUnavailable(
                '暂不支持找回密码',
                '请联系工作空间管理员重置密码。'
              )
            }
          >
            忘记密码？
          </button>
        </div>

        {loginError && (
          <p className='login-error' role='alert'>
            {loginError}
          </p>
        )}

        <Button
          type='submit'
          className='login-submit'
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 aria-hidden='true' className='animate-spin' />
              正在登录…
            </>
          ) : (
            <>
              登录工作空间 <ArrowRight aria-hidden='true' />
            </>
          )}
        </Button>

        <div className='login-divider' aria-hidden='true'>
          <span>或</span>
        </div>

        <Button
          type='button'
          variant='outline'
          className='login-secondary-button'
          onClick={() =>
            showUnavailable(
              '企业 SSO 暂未开通',
              '当前工作空间尚未配置企业单点登录，请使用账号密码登录或联系管理员。'
            )
          }
        >
          <Building2 aria-hidden='true' />
          使用企业 SSO 登录
        </Button>

        <p className='login-admin-help'>
          需要帮助？{' '}
          <button
            type='button'
            className='login-text-button'
            onClick={() =>
              showUnavailable(
                '联系管理员',
                '请通过组织内部渠道联系工作空间管理员，协助开通账号或重置密码。'
              )
            }
          >
            联系管理员
          </button>
        </p>

        <Dialog
          open={Boolean(dialog)}
          onOpenChange={(open) => !open && setDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog?.title}</DialogTitle>
              <DialogDescription>{dialog?.description}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </form>
    </Form>
  )
}

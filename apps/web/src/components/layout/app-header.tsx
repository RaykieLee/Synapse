import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Link, useRouterState } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitch } from '@/components/language-switch'
import { Header } from '@/components/layout/header'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { useWorkspaceDirectory } from '@/features/workspaces/directory'
import { translate, useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Breadcrumb = {
  title: string
  url?: string
}

const tenantPageTitles: Record<string, string> = {
  roles: '角色管理',
  menus: '菜单管理',
  departments: '部门管理',
  dictionaries: '字典管理',
  configs: '参数配置',
  'scheduled-tasks': '系统任务',
}

const workspacePageTitles: Record<string, string> = {
  chat: 'AI 对话',
  agents: '智能体',
  sessions: '会话',
  teams: '子智能体团队',
  models: '模型与凭据',
  credential: 'AgentScope 凭据',
  knowledge: '知识库',
  mcp: 'MCP',
  skills: 'Skills',
  sop: 'SOP 流程',
  schedule: '调度任务',
  channel: '渠道',
  attachments: '附件',
  members: '成员',
  settings: '设置',
}

const settingsPageTitles: Record<string, string> = {
  account: '账号',
  appearance: '外观',
  notifications: '通知',
  display: '显示',
}

function titleFromSegment(segment: string) {
  const knownTitles = {
    apps: '应用',
    chats: '聊天',
    'help-center': '帮助中心',
    tasks: '任务',
    users: '全局用户',
  } as const
  return knownTitles[segment as keyof typeof knownTitles] ?? segment
}

function routeBackTarget(pathname: string) {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments[0] === 'tenants') {
    if (segments.length >= 3) return `/tenants/${segments[1]}`
    if (segments.length === 2) return '/tenants'
  }
  if (segments[0] === 'w' && segments.length >= 3) {
    return `/w/${segments[1]}`
  }
  if (segments[0] === 'settings' && segments.length >= 2) {
    return '/settings'
  }
  if (segments[0] === 'errors' && segments.length >= 2) return '/'
  return null
}

function RouteBackButton() {
  const locale = useLocale()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const target = routeBackTarget(pathname)

  return (
    <div className='flex w-7 shrink-0 justify-center'>
      {target ? (
        <Button asChild variant='ghost' size='icon' className='size-7'>
          <Link
            to={target as never}
            aria-label={translate('返回', locale)}
            title={translate('返回', locale)}
          >
            <ArrowLeft className='size-4' aria-hidden='true' />
          </Link>
        </Button>
      ) : (
        <span aria-hidden='true' className='w-7' />
      )}
    </div>
  )
}

function routeBreadcrumbs(
  pathname: string,
  tenantName: (id: string) => string | undefined,
  workspaceName: (id: string) => string | undefined
): Breadcrumb[] {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (segments.length === 0) return [{ title: '工作台' }]

  if (segments[0] === 'tenants') {
    if (segments.length === 1) return [{ title: '租户管理' }]
    const tenantId = segments[1]
    const tenantTitle = tenantName(tenantId) ?? `租户 ${tenantId}`
    if (segments.length === 2) {
      return [
        { title: '租户管理', url: '/tenants' },
        { title: '成员与邀请', url: `/tenants/${tenantId}` },
      ]
    }
    const page = segments[2]
    return [
      { title: '租户管理', url: '/tenants' },
      { title: tenantTitle, url: `/tenants/${tenantId}` },
      { title: tenantPageTitles[page] ?? page, url: pathname },
    ]
  }

  if (segments[0] === 'w') {
    if (segments.length === 1) return [{ title: '工作台' }]
    const workspaceId = segments[1]
    const workspaceTitle =
      workspaceName(workspaceId) ?? `工作空间 ${workspaceId}`
    if (segments.length === 2) {
      return [{ title: workspaceTitle, url: `/w/${workspaceId}` }]
    }
    const page = segments[2]
    return [
      { title: workspaceTitle, url: `/w/${workspaceId}` },
      {
        title: workspacePageTitles[page] ?? page,
        url: `/w/${workspaceId}/${page}`,
      },
    ]
  }

  if (segments[0] === 'settings') {
    const root = [{ title: '个人设置', url: '/settings' }]
    if (segments.length === 1) return root
    return [
      ...root,
      { title: settingsPageTitles[segments[1]] ?? segments[1], url: pathname },
    ]
  }

  if (segments[0] === 'errors') {
    return [
      { title: '错误页面', url: '/errors/internal-server-error' },
      { title: segments[1] ?? '未知错误' },
    ]
  }

  return [{ title: titleFromSegment(segments[0]) }]
}

export function AppHeader() {
  const locale = useLocale()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const directory = useWorkspaceDirectory(true)
  const breadcrumbs = routeBreadcrumbs(
    pathname,
    (id) => directory.tenantById.get(id)?.name,
    (id) =>
      directory.workspaces.find(
        (workspace) => workspace.workspace_id === id
      )?.name
  )

  return (
    <Header fixed className='border-b bg-background/95 backdrop-blur'>
      <RouteBackButton />
      <nav aria-label={translate('面包屑', locale)} className='min-w-0 flex-1'>
        <ol className='flex min-w-0 items-center gap-1 text-sm'>
          {breadcrumbs.map((breadcrumb, index) => {
            const isLast = index === breadcrumbs.length - 1
            return (
              <li
                key={`${breadcrumb.title}-${breadcrumb.url ?? index}`}
                className={cn(
                  'flex min-w-0 items-center gap-1',
                  index > 0 && !isLast && 'hidden sm:flex'
                )}
              >
                {index > 0 ? (
                  <ChevronRight
                    aria-hidden='true'
                    className='size-3 shrink-0 text-muted-foreground'
                  />
                ) : null}
                {isLast || !breadcrumb.url ? (
                  <span
                    aria-current='page'
                    className='truncate font-medium text-foreground'
                  >
                    {translate(breadcrumb.title, locale)}
                  </span>
                ) : (
                  <Link
                    to={breadcrumb.url as never}
                    className='truncate text-muted-foreground transition-colors hover:text-foreground'
                  >
                    {translate(breadcrumb.title, locale)}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      <Search className='hidden md:flex' />
      <LanguageSwitch />
      <ThemeSwitch />
      <ConfigDrawer />
      <ProfileDropdown />
    </Header>
  )
}

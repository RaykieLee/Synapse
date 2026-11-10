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
import { useAuthStore } from '@/stores/auth-store'
import { translate, useLocale } from '@/lib/i18n'

type Breadcrumb = {
  title: string
  url?: string
}

const tenantPageTitles: Record<string, string> = {
  members: '成员与邀请',
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

export function routeBreadcrumbs(
  pathname: string,
  isPlatformAdmin: boolean,
  tenantById: (id: string) => { name: string; member: boolean } | undefined,
  workspaceById: (
    id: string
  ) => { name: string; tenantId: string } | undefined
): Breadcrumb[] {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (segments.length === 0) return [{ title: '工作台' }]

  if (segments[0] === 'tenants') {
    const directoryTitle = isPlatformAdmin ? '平台租户目录' : '我的租户'
    const scope: Breadcrumb = isPlatformAdmin
      ? { title: '平台管理' }
      : { title: '个人', url: '/' }
    if (segments.length === 1)
      return [scope, { title: directoryTitle }]
    const tenantId = segments[1]
    const tenant = tenantById(tenantId)
    const breadcrumbs: Breadcrumb[] = [
      scope,
      { title: directoryTitle, url: '/tenants' },
      { title: tenant?.name ?? '租户' },
    ]
    if (segments.length === 2) return breadcrumbs

    breadcrumbs[1] = {
      ...breadcrumbs[1],
      url: tenant?.member ? `/tenants/${tenantId}` : undefined,
    }
    const pageSegments = segments.slice(2)
    pageSegments.forEach((page, index) => {
      const isLast = index === pageSegments.length - 1
      breadcrumbs.push({
        title: tenantPageTitles[page] ?? (isLast ? '租户页面' : '租户设置'),
        url: isLast ? undefined : `/tenants/${segments.slice(1, index + 3).join('/')}`,
      })
    })
    return breadcrumbs
  }

  if (segments[0] === 'w') {
    if (segments.length === 1) return [{ title: '工作台' }]
    const workspaceId = segments[1]
    const workspace = workspaceById(workspaceId)
    const tenant = workspace ? tenantById(workspace.tenantId) : undefined
    const breadcrumbs: Breadcrumb[] = [
      {
        title: tenant?.name ?? '租户',
        url: tenant?.member ? `/tenants/${workspace!.tenantId}` : undefined,
      },
      {
        title: workspace?.name ?? 'Workspace（工作空间）',
        url: workspace ? `/w/${workspaceId}` : undefined,
      },
    ]
    if (segments.length === 2) return breadcrumbs

    breadcrumbs.push({ title: 'Workspace 工作台', url: `/w/${workspaceId}` })

    const pageSegments = segments.slice(2)
    pageSegments.forEach((page, index) => {
      const isLast = index === pageSegments.length - 1
      const parentPath = `/w/${segments.slice(1, index + 3).join('/')}`
      breadcrumbs.push({
        title: workspacePageTitles[page] ?? (isLast ? 'Workspace 页面' : 'Workspace 分区'),
        url: isLast ? undefined : parentPath,
      })
    })
    return breadcrumbs
  }

  if (segments[0] === 'settings') {
    const root = [
      { title: '个人', url: '/' },
      { title: '个人设置', url: '/settings' },
    ]
    if (segments.length === 1)
      return [{ title: '个人', url: '/' }, { title: '个人设置' }]
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

  if (segments[0] === 'users') {
    return [{ title: '平台管理' }, { title: '全局用户' }]
  }

  return [{ title: titleFromSegment(segments[0]) }]
}

export function BreadcrumbTrail({
  breadcrumbs,
  locale,
  announcement,
}: {
  breadcrumbs: Breadcrumb[]
  locale: ReturnType<typeof useLocale>
  announcement: string
}) {
  return (
    <>
      <nav
        aria-label={translate('面包屑', locale)}
        className='min-w-0 flex-1 overflow-x-auto'
      >
        <ol className='flex min-w-max items-center gap-1 whitespace-nowrap text-sm'>
          {breadcrumbs.map((breadcrumb, index) => {
            const isLast = index === breadcrumbs.length - 1
            return (
              <li
                key={`${breadcrumb.title}-${breadcrumb.url ?? index}`}
                className='flex min-w-0 shrink-0 items-center gap-1'
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
                    id='route-destination'
                    tabIndex={-1}
                    className='max-w-40 truncate font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                  >
                    {translate(breadcrumb.title, locale)}
                  </span>
                ) : (
                  <Link
                    to={breadcrumb.url as never}
                    className='truncate text-muted-foreground transition-colors hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                  >
                    {translate(breadcrumb.title, locale)}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      <span className='sr-only' role='status' aria-live='polite' aria-atomic='true'>
        {announcement}
      </span>
    </>
  )
}

export function AppHeader() {
  const locale = useLocale()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const directory = useWorkspaceDirectory(true)
  const user = useAuthStore((state) => state.auth.user)
  const breadcrumbs = routeBreadcrumbs(
    pathname,
    user?.platform_role === 'platform_admin',
    (id) => {
      const tenant = directory.tenantById.get(id)
      return tenant
        ? { name: tenant.name, member: tenant.tenant_role !== null }
        : undefined
    },
    (id) => {
      const workspace = directory.workspaces.find(
        (item) => item.workspace_id === id
      )
      return workspace
        ? { name: workspace.name, tenantId: workspace.tenant_id }
        : undefined
    }
  )
  const activeWorkspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1]
  const activeWorkspace = directory.workspaces.find(
    (workspace) => workspace.workspace_id === activeWorkspaceId
  )
  const destinationAnnouncement = activeWorkspaceId
    ? `${translate('当前 Workspace：', locale)} ${activeWorkspace?.name ?? translate('Workspace', locale)}`
    : translate(breadcrumbs.at(-1)?.title ?? '', locale)

  return (
    <Header fixed className='border-b bg-background/95 backdrop-blur'>
      <RouteBackButton />
      <BreadcrumbTrail
        breadcrumbs={breadcrumbs}
        locale={locale}
        announcement={destinationAnnouncement}
      />
      <Search className='hidden md:flex' />
      <LanguageSwitch />
      <ThemeSwitch />
      <ConfigDrawer />
      <ProfileDropdown />
    </Header>
  )
}

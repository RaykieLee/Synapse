import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Bell,
  Building2,
  BookOpen,
  CalendarClock,
  FileText,
  Folder,
  FolderTree,
  Home,
  LayoutDashboard,
  Layers3,
  Monitor,
  Palette,
  Settings,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { getWorkspace } from '@/api/workspaces'
import { translate, useLocale } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import {
  TeamSwitcher,
  useWorkspaceDirectory,
} from '@/features/workspaces/directory'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import type { NavGroup as NavGroupType, NavItem, NavLink } from './types'

type NavigationMenu = {
  menu_id: string
  parent_id: string | null
  menu_name: string
  order_num: number
  path: string
  component: string | null
  query: string | null
  is_frame: number
  is_cache: number
  menu_type: 'M' | 'C'
  visible: '0'
  perms: string | null
  icon: string
  children: NavigationMenu[]
}
type NavigationResponse = {
  tenant_id: string
  membership_version: number
  items: NavigationMenu[]
}

const iconMap: Record<string, LucideIcon> = {
  Building2,
  FileText,
  Folder,
  FolderTree,
  Home,
  LayoutDashboard,
  Monitor,
  Palette,
  Settings,
  UserCog,
  Users,
  Wrench,
  Bell,
}
function workspaceSystemGroups(
  workspaceId: string,
  isPlatformAdmin: boolean
): NavGroupType[] {
  return [
    {
      title: '系统',
      items: [
        { title: '附件', url: `/w/${workspaceId}/attachments`, icon: FileText },
        { title: '模型与凭据', url: `/w/${workspaceId}/models`, icon: Wrench },
        { title: '租户管理', url: '/tenants', icon: Building2 },
        ...(isPlatformAdmin
          ? [{ title: '全局用户', url: '/users', icon: Users }]
          : []),
      ],
    },
    {
      title: '个人设置',
      items: [
        {
          title: '设置',
          icon: Settings,
          items: [
            { title: '个人资料', url: '/settings', icon: UserCog },
            { title: '账号', url: '/settings/account', icon: Wrench },
            { title: '外观', url: '/settings/appearance', icon: Palette },
            { title: '通知', url: '/settings/notifications', icon: Bell },
            { title: '显示', url: '/settings/display', icon: Monitor },
          ],
        },
      ],
    },
  ]
}

function workspaceIdFromPath(pathname: string) {
  return pathname.match(/^\/w\/([^/]+)/)?.[1]
}

function tenantIdFromPath(pathname: string) {
  return pathname.match(/^\/tenants\/([^/]+)/)?.[1]
}

function tenantManagementGroup(
  tenantId: string,
  tenantRole: 'owner' | 'admin' | 'member' | null
): NavGroupType | null {
  if (!tenantRole) return null

  const overview = {
    title: '成员与邀请',
    url: `/tenants/${tenantId}`,
    icon: Users,
  }
  if (tenantRole === 'member') {
    return { title: '当前租户配置', items: [overview] }
  }

  return {
    title: '当前租户配置',
    items: [
      overview,
      { title: '角色管理', url: `/tenants/${tenantId}/roles`, icon: UserCog },
      { title: '菜单管理', url: `/tenants/${tenantId}/menus`, icon: FileText },
      {
        title: '部门管理',
        url: `/tenants/${tenantId}/departments`,
        icon: FolderTree,
      },
      {
        title: '字典管理',
        url: `/tenants/${tenantId}/dictionaries`,
        icon: BookOpen,
      },
      {
        title: '参数配置',
        url: `/tenants/${tenantId}/configs`,
        icon: Settings,
      },
      {
        title: '系统任务',
        url: `/tenants/${tenantId}/scheduled-tasks`,
        icon: CalendarClock,
      },
    ],
  }
}

function menuIcon(name: string): LucideIcon {
  return iconMap[name] ?? Folder
}

function toNavLinks(menus: NavigationMenu[], prefix = ''): NavLink[] {
  return menus.flatMap((menu) => {
    const title = prefix ? `${prefix} / ${menu.menu_name}` : menu.menu_name
    const current: NavLink[] = menu.path
      ? [
          {
            title,
            url: menu.path,
            external: menu.is_frame === 0,
            icon:
              menu.icon && menu.icon !== '#' ? menuIcon(menu.icon) : undefined,
          },
        ]
      : []
    return [...current, ...toNavLinks(menu.children, title)]
  })
}

export function AppSidebar() {
  const locale = useLocale()
  const { collapsible, variant } = useLayout()
  const authUser = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const directory = useWorkspaceDirectory(true)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const routeTenantId = tenantIdFromPath(pathname)
  const activeWorkspaceId = workspaceIdFromPath(pathname)
  const workspace = activeWorkspaceId
    ? directory.workspaces.find(
        (item) => item.workspace_id === activeWorkspaceId
      )
    : undefined

  // Share the verified detail query used by the workspace route. Menus remain
  // hidden until a fresh workspace-context response confirms this URL's scope.
  const detail = useQuery({
    queryKey: [
      'synapse',
      directory.actorId,
      workspace?.tenant_id ?? 'unresolved',
      activeWorkspaceId ?? 'none',
      'workspace-detail',
      workspace?.membership_version ?? 0,
    ],
    queryFn: () => getWorkspace(activeWorkspaceId!),
    enabled: Boolean(authUser && workspace && activeWorkspaceId),
    initialData: workspace,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const contextReady = Boolean(
    workspace &&
    detail.data &&
    detail.isFetched &&
    !detail.isFetching &&
    !detail.isError &&
    detail.data.workspace_id === activeWorkspaceId &&
    detail.data.tenant_id === workspace.tenant_id
  )
  const current = contextReady ? detail.data : undefined
  const activeTenantId = routeTenantId ?? current?.tenant_id
  const activeTenant = activeTenantId
    ? directory.tenantById.get(activeTenantId)
    : undefined
  const tenantGroup = activeTenant
    ? tenantManagementGroup(activeTenant.tenant_id, activeTenant.tenant_role)
    : null
  const navigationKey = current
    ? ([
        'synapse',
        directory.actorId,
        current.tenant_id,
        'tenant-navigation',
        current.workspace_id,
        current.membership_version ?? 0,
      ] as const)
    : ([
        'synapse',
        directory.actorId,
        'unresolved',
        'tenant-navigation',
        activeWorkspaceId ?? 'none',
        0,
      ] as const)
  const navigation = useQuery({
    queryKey: navigationKey,
    queryFn: () =>
      api<NavigationResponse>(
        `/tenants/${current!.tenant_id}/menus/visible-tree`
      ),
    enabled: Boolean(current),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  const scopeRef = useRef<string | null>(null)
  const scope = current
    ? `${directory.actorId}:${current.tenant_id}:${current.workspace_id}:${current.membership_version ?? 0}`
    : null
  useEffect(() => {
    const previous = scopeRef.current
    if (previous && previous !== scope) {
      const [actorId, tenantId, workspaceId] = previous.split(':')
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === 'synapse' &&
          query.queryKey[1] === actorId &&
          query.queryKey[2] === tenantId &&
          query.queryKey[3] === 'tenant-navigation' &&
          query.queryKey[4] === workspaceId,
      })
    }
    scopeRef.current = scope
  }, [queryClient, scope])

  const dynamicItems =
    contextReady &&
    navigation.isSuccess &&
    !navigation.isFetching &&
    navigation.data.tenant_id === current?.tenant_id &&
    navigation.data.membership_version === (current?.membership_version ?? 0)
      ? toNavLinks(navigation.data.items)
      : []
  const inWorkspaceRoute = Boolean(activeWorkspaceId)
  const navGroups = inWorkspaceRoute
    ? [
        ...(tenantGroup
          ? [localizeStaticGroup(tenantGroup, locale)]
          : []),
        ...(dynamicItems.length
          ? [{ title: '工作空间', items: dynamicItems }]
          : []),
        ...workspaceSystemGroups(
          activeWorkspaceId!,
          authUser?.platform_role === 'platform_admin'
        ).map((group) => localizeStaticGroup(group, locale)),
      ]
    : [
        ...(tenantGroup ? [localizeStaticGroup(tenantGroup, locale)] : []),
        ...sidebarData.navGroups.map((group) => ({
          ...group,
          title: translate(group.title, locale),
          items: group.items.filter(
            (item) =>
              item.title !== '全局用户' ||
              authUser?.platform_role === 'platform_admin'
          ).map((item) => localizeStaticItem(item, locale)),
        })),
      ]

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
        {!inWorkspaceRoute &&
          (directory.tenantQuery.isError ||
            directory.workspaceQuery.isError ||
            (directory.tenantQuery.isSuccess &&
              directory.workspaceQuery.isSuccess &&
              directory.workspaces.length === 0)) && (
            <SidebarGroup>
              <SidebarGroupLabel>{translate('工作空间', locale)}</SidebarGroupLabel>
              <div className='px-2 pb-2 text-xs leading-relaxed text-muted-foreground'>
                {directory.tenantQuery.isError || directory.workspaceQuery.isError
                  ? translate('无法加载租户或工作空间目录。', locale)
                  : translate('当前账号还没有可访问的工作空间。可以先查看租户成员资格，或通过上方选择器创建有权限的空间。', locale)}
              </div>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to='/tenants'>
                      <Layers3 />
                      <span>{translate('前往租户管理', locale)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: authUser?.nick_name || authUser?.user_name || '',
            email: authUser?.email || authUser?.user_name || '',
            avatar: authUser?.avatar || '',
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function localizeStaticGroup(group: NavGroupType, locale: ReturnType<typeof useLocale>): NavGroupType {
  if (group.title === '工作空间') return { ...group, title: translate(group.title, locale) }
  return {
    ...group,
    title: translate(group.title, locale),
    items: group.items.map((item) => localizeStaticItem(item, locale)),
  }
}

function localizeStaticItem(item: NavItem, locale: ReturnType<typeof useLocale>): NavItem {
  return 'items' in item && item.items
    ? { ...item, title: translate(item.title, locale), items: item.items.map((child) => ({ ...child, title: translate(child.title, locale) })) }
    : { ...item, title: translate(item.title, locale) }
}

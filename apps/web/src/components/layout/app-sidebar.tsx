import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import {
  Bell,
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
  type LucideIcon,
} from 'lucide-react'
import { getWorkspace } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import {
  TeamSwitcher,
  useWorkspaceDirectory,
} from '@/features/workspaces/directory'
import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import type { NavGroup as NavGroupType, NavLink } from './types'

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
  const { collapsible, variant } = useLayout()
  const authUser = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const directory = useWorkspaceDirectory(true)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
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
        ...(dynamicItems.length
          ? [{ title: '工作空间', items: dynamicItems }]
          : []),
        ...workspaceSystemGroups(
          activeWorkspaceId!,
          authUser?.platform_role === 'platform_admin'
        ),
      ]
    : sidebarData.navGroups.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.title !== 'Users' ||
            authUser?.platform_role === 'platform_admin'
        ),
      }))

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
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

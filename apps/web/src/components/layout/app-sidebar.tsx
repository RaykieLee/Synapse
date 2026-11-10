import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import {
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Database,
  FileText,
  Folder,
  Home,
  KeyRound,
  LayoutDashboard,
  Layers3,
  MessageSquare,
  Radio,
  Sparkles,
  Users,
  UserCog,
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
  useSidebar,
} from '@/components/ui/sidebar'
import {
  TeamSwitcher,
  useWorkspaceDirectory,
} from '@/features/workspaces/directory'
import {
  buildTenantNavigationGroup,
  buildWorkspaceNavigationGroup,
  selectPlatformNavigationGroup,
  isNavigationScopeRecoveryFailure,
  selectFreshAuthorizedNavigationCandidates,
  sidebarData,
  type AuthorizedNavigationCandidate,
  type NavigationMenuResponse,
  type VerifiedNavigationScope,
} from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import type { NavGroup as NavGroupType, NavItem, NavLink } from './types'

const iconMap: Record<string, LucideIcon> = {
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Database,
  FileText,
  Folder,
  Home,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Sparkles,
  Users,
  UserCog,
  Wrench,
}

function workspaceIdFromPath(pathname: string) {
  return pathname.match(/^\/w\/([^/]+)/)?.[1]
}

function tenantIdFromPath(pathname: string) {
  return pathname.match(/^\/tenants\/([^/]+)/)?.[1]
}

function navigationLinks(
  candidates: AuthorizedNavigationCandidate[],
  existingItems: NavItem[]
): NavLink[] {
  const existingUrls = new Set<string>()
  for (const item of existingItems) {
    if ('url' in item && item.url) existingUrls.add(item.url)
    if ('items' in item && item.items) {
      for (const child of item.items) {
        if (child.url) existingUrls.add(child.url)
      }
    }
  }

  const seenUrls = new Set(existingUrls)
  return candidates.flatMap((candidate) => {
    if (seenUrls.has(candidate.url)) return []
    seenUrls.add(candidate.url)
    return [{
      title: candidate.title,
      url: candidate.url,
      external: candidate.external,
      icon: candidate.icon ? iconMap[candidate.icon] ?? Folder : undefined,
    }]
  })
}

function localizeStaticGroup(
  group: NavGroupType,
  locale: ReturnType<typeof useLocale>
): NavGroupType {
  return {
    ...group,
    title: translate(group.title, locale),
    items: group.items.map((item) => localizeStaticItem(item, locale)),
  }
}

function localizeStaticItem(
  item: NavItem,
  locale: ReturnType<typeof useLocale>
): NavItem {
  return 'items' in item && item.items
    ? {
        ...item,
        title: translate(item.title, locale),
        items: item.items.map((child) => ({
          ...child,
          title: translate(child.title, locale),
        })),
      }
    : { ...item, title: translate(item.title, locale) }
}

function NavigationStatus({
  title,
  message,
  state,
  onRetry,
}: {
  title: string
  message: string
  state: 'loading' | 'empty' | 'error'
  onRetry?: () => void
}) {
  const locale = useLocale()
  const { state: sidebarState, isMobile } = useSidebar()
  if (sidebarState === 'collapsed' && !isMobile) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{translate(title, locale)}</SidebarGroupLabel>
      <div
        className='px-2 pb-1 text-xs leading-relaxed text-muted-foreground'
        role={state === 'error' ? 'alert' : 'status'}
        aria-live={state === 'error' ? 'assertive' : 'polite'}
      >
        {translate(message, locale)}
      </div>
      {state === 'error' && onRetry ? (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <button type='button' onClick={onRetry}>
                <span>{translate('重试', locale)}</span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : null}
    </SidebarGroup>
  )
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
    enabled: Boolean(authUser?.user_id && workspace && activeWorkspaceId),
    initialData: workspace,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const detailVersion = detail.data?.membership_version
  const contextReady = Boolean(
    authUser?.user_id &&
      workspace &&
      directory.tenantQuery.isSuccess &&
      detail.data &&
      detail.isFetched &&
      !detail.isFetching &&
      !detail.isError &&
      detail.data.workspace_id === activeWorkspaceId &&
      detail.data.tenant_id === workspace.tenant_id &&
      Number.isInteger(detailVersion) &&
      detailVersion! >= 0 &&
      directory.tenantById.has(detail.data.tenant_id)
  )
  const current = contextReady ? detail.data : undefined
  const currentMembershipVersion = current?.membership_version
  const scope = useMemo<VerifiedNavigationScope | null>(() => {
    if (
      !contextReady ||
      !authUser?.user_id ||
      !current ||
      !activeWorkspaceId ||
      !Number.isInteger(currentMembershipVersion) ||
      currentMembershipVersion! < 0
    ) {
      return null
    }
    return {
      verified: true,
      actorId: authUser.user_id,
      tenantId: current.tenant_id,
      workspaceId: current.workspace_id,
      membershipVersion: currentMembershipVersion!,
    }
  }, [
    activeWorkspaceId,
    authUser?.user_id,
    contextReady,
    current,
    currentMembershipVersion,
  ])

  useEffect(() => {
    if (
      workspace &&
      detail.data?.membership_version !== undefined &&
      detail.data.membership_version !== workspace.membership_version
    ) {
      void queryClient.invalidateQueries({
        queryKey: [
          'synapse',
          directory.actorId,
          'global',
          'personal',
          'workspace-directory',
        ],
      })
    }
  }, [
    detail.data?.membership_version,
    directory.actorId,
    queryClient,
    workspace,
  ])

  const navigationKey = scope
    ? ([
        'synapse',
        scope.actorId,
        scope.tenantId,
        'tenant-navigation',
        scope.workspaceId,
        scope.membershipVersion,
      ] as const)
    : ([
        'synapse',
        authUser?.user_id ?? 'anonymous',
        'unresolved',
        'tenant-navigation',
        activeWorkspaceId ?? 'none',
        0,
      ] as const)
  const navigation = useQuery({
    queryKey: navigationKey,
    queryFn: () =>
      api<NavigationMenuResponse>(
        `/tenants/${scope!.tenantId}/menus/visible-tree`
      ),
    enabled: Boolean(scope),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  const scopeRef = useRef<string | null>(null)
  const scopeKey = scope
    ? JSON.stringify([
        scope.actorId,
        scope.tenantId,
        scope.workspaceId,
        scope.membershipVersion,
      ])
    : null
  useEffect(() => {
    const previous = scopeRef.current
    if (previous && previous !== scopeKey) {
      const [actorId, tenantId, workspaceId] = JSON.parse(previous) as string[]
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === 'synapse' &&
          query.queryKey[1] === actorId &&
          query.queryKey[2] === tenantId &&
          query.queryKey[3] === 'tenant-navigation' &&
          query.queryKey[4] === workspaceId,
      })
    }
    scopeRef.current = scopeKey
  }, [queryClient, scopeKey])

  const candidates = selectFreshAuthorizedNavigationCandidates(
    navigation.data,
    scope,
    navigation.isError
  )
  const inWorkspaceRoute = Boolean(activeWorkspaceId)
  const isPlatformAdmin = authUser?.platform_role === 'platform_admin'
  const activeTenantId = routeTenantId ?? current?.tenant_id
  const activeTenant =
    activeTenantId && directory.tenantQuery.isSuccess
      ? directory.tenantById.get(activeTenantId)
      : undefined

  const navGroups: NavGroupType[] = []
  const platformGroup = selectPlatformNavigationGroup(isPlatformAdmin)
  if (platformGroup) {
    navGroups.push(localizeStaticGroup(platformGroup, locale))
  } else {
    navGroups.push({
      title: translate('租户', locale),
      items: [
        {
          title: translate('我的租户', locale),
          url: '/tenants',
          icon: Layers3,
        },
      ],
    })
  }

  if (activeTenant?.tenant_role) {
    const tenantGroup = buildTenantNavigationGroup(
      activeTenant.tenant_id,
      activeTenant.tenant_role
    )
    if (tenantGroup) navGroups.push(localizeStaticGroup(tenantGroup, locale))
  }

  if (inWorkspaceRoute && contextReady && activeWorkspaceId && current) {
    const group = buildWorkspaceNavigationGroup(
      activeWorkspaceId,
      current.workspace_role
    )
    if (candidates?.length) {
      group.items.push(...navigationLinks(candidates, group.items))
    }
    navGroups.push(localizeStaticGroup(group, locale))
  }

  const personalGroup = sidebarData.navGroups.find(
    (group) => group.title === '个人'
  )
  if (personalGroup) navGroups.push(localizeStaticGroup(personalGroup, locale))

  const retryDirectory = () => {
    void Promise.all([
      directory.tenantQuery.refetch(),
      directory.workspaceQuery.refetch(),
    ])
  }

  let contextStatus: {
    state: 'loading' | 'empty' | 'error'
    message: string
    onRetry?: () => void
  } | null = null

  if (inWorkspaceRoute) {
    if (directory.tenantQuery.isError || directory.workspaceQuery.isError) {
      contextStatus = {
        state: 'error',
        message: '无法加载租户或 Workspace 目录。',
        onRetry: retryDirectory,
      }
    } else if (
      directory.tenantQuery.isLoading ||
      directory.workspaceQuery.isLoading
    ) {
      contextStatus = {
        state: 'loading',
        message: '正在确认 Workspace 访问权限…',
      }
    } else if (!workspace) {
      contextStatus = {
        state: 'empty',
        message: '无法在当前已授权目录中确认此 Workspace；请使用上方切换器选择可访问的 Workspace。',
      }
    } else if (detail.isError) {
      contextStatus = {
        state: 'error',
        message: '无法确认当前 Workspace 的授权上下文。',
        onRetry: () => void detail.refetch(),
      }
    } else if (!contextReady) {
      contextStatus = {
        state: 'loading',
        message: '正在确认 Workspace 与租户成员资格…',
      }
    } else if (
      navigation.isError &&
      isNavigationScopeRecoveryFailure(navigation.error)
    ) {
      contextStatus = {
        state: 'error',
        message: 'Workspace 访问上下文无法确认；请使用切换器重新选择可访问的 Workspace。',
      }
    } else if (navigation.isError) {
      contextStatus = {
        state: 'error',
        message: 'Workspace 菜单加载失败；固定工作台入口仍可用。',
        onRetry: () => void navigation.refetch(),
      }
    } else if (navigation.isFetching || !navigation.isSuccess) {
      contextStatus = {
        state: 'loading',
        message: '正在加载 Workspace 菜单…',
      }
    } else if (!candidates) {
      contextStatus = {
        state: 'error',
        message: 'Workspace 菜单与当前授权范围不匹配，已隐藏菜单链接。',
        onRetry: () => void navigation.refetch(),
      }
    } else if (candidates.length === 0) {
      contextStatus = {
        state: 'empty',
        message: '此 Workspace 没有额外的动态菜单；上方固定工作台入口仍可用。',
      }
    }
  } else if (directory.tenantQuery.isError || directory.workspaceQuery.isError) {
    contextStatus = {
      state: 'error',
      message: '无法加载租户或 Workspace 目录。',
      onRetry: retryDirectory,
    }
  } else if (
    directory.tenantQuery.isLoading ||
    directory.workspaceQuery.isLoading
  ) {
    contextStatus = {
      state: 'loading',
      message: '正在加载可访问的 Workspace…',
    }
  } else if (directory.workspaces.length === 0) {
    contextStatus = {
      state: 'empty',
      message: '当前账号没有可访问的 Workspace；可以使用上方切换器查看或创建有权限的空间。',
    }
  }

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavGroup key={group.title} {...group} />
        ))}
        {contextStatus ? (
          <NavigationStatus
            title={inWorkspaceRoute ? 'Workspace 菜单状态' : 'Workspace（工作空间）'}
            message={contextStatus.message}
            state={contextStatus.state}
            onRetry={contextStatus.onRetry}
          />
        ) : null}
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

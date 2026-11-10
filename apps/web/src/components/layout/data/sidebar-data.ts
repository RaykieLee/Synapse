import {
  Bot,
  Boxes,
  Bell,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Database,
  FileText,
  Folder,
  KeyRound,
  MessageSquare,
  Monitor,
  Palette,
  Radio,
  Settings,
  Sparkles,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react'
import type { WorkspaceRole } from '@/api/workspaces'
import { ApiProblem } from '@/lib/api'
import { type NavGroup, type SidebarData } from '../types'

export type NavigationMenuNode = {
  menu_id: string
  menu_name: string
  path: string | null
  icon: string | null
  is_frame: number
  children?: NavigationMenuNode[] | null
}

export type NavigationMenuResponse = {
  tenant_id: string
  membership_version: number
  items: NavigationMenuNode[]
}

export type VerifiedNavigationScope = Readonly<{
  verified: true
  actorId: string
  tenantId: string
  workspaceId: string
  membershipVersion: number
}>

export type AuthorizedNavigationCandidate = Readonly<{
  id: string
  title: string
  url: string
  external: boolean
  icon?: string
  actorId: string
  tenantId: string
  workspaceId: string
  membershipVersion: number
}>

export function selectFreshAuthorizedNavigationCandidates(
  response: NavigationMenuResponse | null | undefined,
  scope: VerifiedNavigationScope | null | undefined,
  refetchFailed: boolean
) {
  if (refetchFailed) return null
  return selectAuthorizedNavigationCandidates(response, scope)
}

export function isNavigationScopeRecoveryFailure(error: unknown) {
  if (!(error instanceof ApiProblem)) return false
  return (
    error.status === 403 ||
    [
      'WORKSPACE_CONTEXT_REQUIRED',
      'CONTEXT_MISMATCH',
      'MEMBERSHIP_INACTIVE',
      'WORKSPACE_MEMBERSHIP_REQUIRED',
      'WORKSPACE_INACTIVE',
    ].includes(error.code ?? '')
  )
}

/**
 * Normalizes a tenant menu only after the caller has confirmed the complete
 * actor/tenant/workspace context. The API response is tenant-scoped, so the
 * response's tenant and membership version must also match that context.
 */
export function selectAuthorizedNavigationCandidates(
  response: NavigationMenuResponse | null | undefined,
  scope: VerifiedNavigationScope | null | undefined
): AuthorizedNavigationCandidate[] | null {
  if (
    !response ||
    !scope?.verified ||
    !scope.actorId ||
    !scope.tenantId ||
    !scope.workspaceId ||
    !Number.isInteger(scope.membershipVersion) ||
    scope.membershipVersion < 0 ||
    response.tenant_id !== scope.tenantId ||
    response.membership_version !== scope.membershipVersion ||
    !Array.isArray(response.items)
  ) {
    return null
  }

  const candidates: AuthorizedNavigationCandidate[] = []
  const visit = (items: NavigationMenuNode[], parentTitle = '') => {
    for (const item of items) {
      const title = parentTitle
        ? `${parentTitle} / ${item.menu_name}`
        : item.menu_name
      if (item.path && item.path !== '#') {
        candidates.push({
          id: item.menu_id,
          title,
          url: item.path,
          external: item.is_frame === 0,
          icon: item.icon && item.icon !== '#' ? item.icon : undefined,
          actorId: scope.actorId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          membershipVersion: scope.membershipVersion,
        })
      }
      if (Array.isArray(item.children)) visit(item.children, title)
    }
  }
  visit(response.items)
  return candidates
}

export function buildTenantNavigationGroup(
  tenantId: string,
  tenantRole: 'owner' | 'admin' | 'member' | null | undefined
): NavGroup | null {
  if (!tenantRole) return null
  const overview = {
    title: '成员与邀请',
    url: `/tenants/${tenantId}`,
    icon: Users,
  }
  if (tenantRole === 'member') {
    return { title: '当前租户', items: [overview] }
  }
  return {
    title: '当前租户',
    items: [
      overview,
      { title: '角色管理', url: `/tenants/${tenantId}/roles`, icon: UserCog },
      { title: '菜单管理', url: `/tenants/${tenantId}/menus`, icon: FileText },
      {
        title: '部门管理',
        url: `/tenants/${tenantId}/departments`,
        icon: Folder,
      },
      {
        title: '字典管理',
        url: `/tenants/${tenantId}/dictionaries`,
        icon: Database,
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

export function buildWorkspaceNavigationGroup(
  workspaceId: string,
  workspaceRole: WorkspaceRole
): NavGroup {
  const items = [
    { title: 'AI 对话', url: `/w/${workspaceId}/chat`, icon: Bot },
    { title: '智能体', url: `/w/${workspaceId}/agents`, icon: Bot },
    { title: '会话', url: `/w/${workspaceId}/sessions`, icon: MessageSquare },
    {
      title: 'AgentScope 凭据',
      url: `/w/${workspaceId}/credential`,
      icon: KeyRound,
    },
    { title: '知识库', url: `/w/${workspaceId}/knowledge`, icon: Database },
    { title: 'MCP', url: `/w/${workspaceId}/mcp`, icon: Boxes },
    { title: 'Skills', url: `/w/${workspaceId}/skills`, icon: Sparkles },
    { title: 'SOP 流程', url: `/w/${workspaceId}/sop`, icon: ClipboardCheck },
    {
      title: '调度任务',
      url: `/w/${workspaceId}/schedule`,
      icon: CalendarClock,
    },
    { title: '渠道', url: `/w/${workspaceId}/channel`, icon: Radio },
    { title: '附件', url: `/w/${workspaceId}/attachments`, icon: FileText },
    { title: '模型与凭据', url: `/w/${workspaceId}/models`, icon: Wrench },
    { title: '成员管理', url: `/w/${workspaceId}/members`, icon: Users },
  ]
  if (workspaceRole === 'owner' || workspaceRole === 'admin') {
    items.push({
      title: 'Workspace 设置',
      url: `/w/${workspaceId}/settings`,
      icon: Settings,
    })
  }
  return { title: '当前 Workspace（工作空间）', items }
}

export const sidebarData: SidebarData = {
  user: { name: '', email: '', avatar: '' },
  teams: [],
  navGroups: [
    {
      title: '平台管理',
      items: [
        { title: '平台租户目录', url: '/tenants', icon: Building2 },
        { title: '全局用户', url: '/users', icon: Users },
      ],
    },
    {
      title: '个人',
      items: [
        {
          title: '个人设置',
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
  ],
}

export function selectPlatformNavigationGroup(
  isPlatformAdmin: boolean
): NavGroup | null {
  if (!isPlatformAdmin) return null
  return sidebarData.navGroups.find((group) => group.title === '平台管理') ?? null
}

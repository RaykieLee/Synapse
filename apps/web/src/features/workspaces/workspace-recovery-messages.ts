export type WorkspaceRecoveryReason =
  | 'actionDenied'
  | 'contextConflict'
  | 'resourceUnavailable'
  | 'tenantInactive'
  | 'workspaceInactive'
  | 'workspaceMembershipInactive'
  | 'tenantMembershipInactive'
  | 'requestFailed'

export type WorkspaceRecoveryMessage =
  | WorkspaceRecoveryReason
  | 'checking'
  | 'retrying'
  | 'retry'
  | 'title'
  | 'viewAccessible'

type Locale = 'zh-CN' | 'en'

const messages: Record<Locale, Record<WorkspaceRecoveryMessage, string>> = {
  'zh-CN': {
    actionDenied: '当前请求未获准，无法确认此空间。请重试，或查看可访问空间。',
    checking: '正在确认空间访问…',
    contextConflict: '空间上下文无法确认，尚未加载空间内容。',
    requestFailed: '无法确认此空间的访问状态。请重试，或查看可访问空间。',
    resourceUnavailable: '此空间不存在或当前不可用。',
    retry: '重试',
    retrying: '正在重新确认访问…',
    tenantMembershipInactive: '你目前无法访问此空间所属范围。',
    tenantInactive: '此空间所属范围目前不可用。',
    title: '无法打开此空间',
    viewAccessible: '查看可访问空间',
    workspaceInactive: '此空间目前不可用。',
    workspaceMembershipInactive: '你目前无法访问此空间。',
  },
  en: {
    actionDenied:
      'This request was not allowed, so Workspace access could not be confirmed. Retry or view accessible Workspaces.',
    checking: 'Confirming Workspace access…',
    contextConflict:
      'Workspace context could not be confirmed. No Workspace content was loaded.',
    requestFailed:
      'Workspace access could not be confirmed. Retry or view accessible Workspaces.',
    resourceUnavailable: 'This Workspace does not exist or is unavailable.',
    retry: 'Retry',
    retrying: 'Checking access again…',
    tenantMembershipInactive:
      'You cannot access the organization for this Workspace right now.',
    tenantInactive:
      'The organization for this Workspace is currently unavailable.',
    title: 'Unable to open this Workspace',
    viewAccessible: 'View accessible Workspaces',
    workspaceInactive: 'This Workspace is currently unavailable.',
    workspaceMembershipInactive: 'You cannot access this Workspace right now.',
  },
}

export function workspaceRecoveryReason(
  status: number,
  code?: string
): WorkspaceRecoveryReason {
  if (status === 403) {
    if (code === 'MEMBERSHIP_INACTIVE') return 'tenantMembershipInactive'
    if (code === 'WORKSPACE_MEMBERSHIP_REQUIRED')
      return 'workspaceMembershipInactive'
    if (code === 'FORBIDDEN') return 'actionDenied'
  }
  if (status === 404 && code === 'RESOURCE_NOT_FOUND')
    return 'resourceUnavailable'
  if (status === 409) {
    if (code === 'TENANT_INACTIVE') return 'tenantInactive'
    if (code === 'WORKSPACE_INACTIVE') return 'workspaceInactive'
    if (code === 'LAST_OWNER_REQUIRED' || code === 'SLUG_CONFLICT')
      return 'contextConflict'
  }
  if (
    status === 400 &&
    (code === 'WORKSPACE_CONTEXT_REQUIRED' || code === 'CONTEXT_MISMATCH')
  )
    return 'contextConflict'
  return 'requestFailed'
}

export function isWorkspaceAccessUnavailable(reason: WorkspaceRecoveryReason) {
  return (
    reason === 'tenantMembershipInactive' ||
    reason === 'workspaceMembershipInactive' ||
    reason === 'resourceUnavailable' ||
    reason === 'tenantInactive' ||
    reason === 'workspaceInactive'
  )
}

export function workspaceRecoveryCopy(
  locale: Locale,
  key: WorkspaceRecoveryMessage
) {
  return messages[locale][key]
}

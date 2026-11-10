export type WorkspaceProblemState =
  | 'context_required'
  | 'context_mismatch'
  | 'tenant_membership_inactive'
  | 'workspace_membership_inactive'
  | 'scope_inactive'
  | 'permission_denied'
  | 'resource_unavailable'
  | 'session_expired'
  | 'context_unverified'
  | 'request_failed'

type ProblemMapping = {
  status: number
  state: WorkspaceProblemState
  message: string
}

const codeMappings: Record<string, ProblemMapping> = {
  WORKSPACE_CONTEXT_REQUIRED: {
    status: 400,
    state: 'context_required',
    message: '此请求缺少空间上下文。',
  },
  CONTEXT_MISMATCH: {
    status: 400,
    state: 'context_mismatch',
    message: '页面与请求的空间不一致，尚未提交更改。',
  },
  MEMBERSHIP_INACTIVE: {
    status: 403,
    state: 'tenant_membership_inactive',
    message: '你目前无法访问此租户。',
  },
  WORKSPACE_MEMBERSHIP_REQUIRED: {
    status: 403,
    state: 'workspace_membership_inactive',
    message: '你目前无法访问此空间。请联系租户或空间管理员。',
  },
  TENANT_INACTIVE: {
    status: 409,
    state: 'scope_inactive',
    message: '此租户暂不可用。',
  },
  WORKSPACE_INACTIVE: {
    status: 409,
    state: 'scope_inactive',
    message: '此空间暂不可用。',
  },
  FORBIDDEN: {
    status: 403,
    state: 'permission_denied',
    message: '当前账号无权执行此操作。请保留草稿，并联系管理员或刷新后重试。',
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    state: 'resource_unavailable',
    message: '内容不存在或不可用。',
  },
}

export function workspaceProblemState(
  status: number,
  code?: string
): WorkspaceProblemState {
  if (status === 401) return 'session_expired'
  if (
    status === 0 &&
    (code === 'NETWORK_ERROR' || code === 'REQUEST_TIMEOUT')
  )
    return 'context_unverified'
  const mapping = code ? codeMappings[code] : undefined
  return mapping?.status === status ? mapping.state : 'request_failed'
}

export function workspaceProblemMessage(
  status: number,
  code?: string
): string | undefined {
  if (status === 401) return '登录已失效，请重新登录。'
  if (workspaceProblemState(status, code) === 'context_unverified')
    return '无法确认空间访问状态。请检查连接后重试。'
  const mapping = code ? codeMappings[code] : undefined
  return mapping?.status === status ? mapping.message : undefined
}

export function workspaceProblemMessageKey(
  status: number,
  code?: string
): string | undefined {
  return workspaceProblemMessage(status, code)
}

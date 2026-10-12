import { api, apiBlob } from '@/lib/api'

export type AttachmentScopeKind = 'workspace' | 'personal'

export type Attachment = {
  attachment_id: string
  tenant_id: string
  workspace_id: string
  scope_kind: AttachmentScopeKind
  owner_user_id: string | null
  filename: string
  media_type: string
  size_bytes: number
  created_by: string
  created_at: string
}

export type AttachmentPage = {
  items: Attachment[]
  total: number
  page: number
  page_size: number
}

type AttachmentRequest = {
  workspaceId: string
  headers?: HeadersInit
  signal?: AbortSignal
}

function attachmentBase(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/attachments`
}

function scopedHeaders(workspaceId: string, headers?: HeadersInit) {
  const result = new Headers(headers)
  result.set('X-Workspace-ID', workspaceId)
  return result
}

export function listAttachments({
  workspaceId,
  scopeKind = 'workspace',
  page = 1,
  pageSize = 20,
  headers,
  signal,
}: AttachmentRequest & {
  scopeKind?: AttachmentScopeKind
  page?: number
  pageSize?: number
}) {
  const params = new URLSearchParams({
    scope_kind: scopeKind,
    page: String(page),
    page_size: String(pageSize),
  })
  return api<AttachmentPage>(`${attachmentBase(workspaceId)}?${params}`, {
    headers: scopedHeaders(workspaceId, headers),
    signal,
  })
}

export function uploadAttachment(
  workspaceId: string,
  file: File,
  scopeKind: AttachmentScopeKind = 'workspace',
  options: Pick<AttachmentRequest, 'headers' | 'signal'> = {},
) {
  const body = new FormData()
  body.append('file', file)
  body.append('scope_kind', scopeKind)
  return api<Attachment>(attachmentBase(workspaceId), {
    method: 'POST',
    headers: scopedHeaders(workspaceId, options.headers),
    body,
    signal: options.signal,
  })
}

export function downloadAttachment(
  workspaceId: string,
  attachmentId: string,
  scopeKind: AttachmentScopeKind = 'workspace',
  options: Pick<AttachmentRequest, 'headers' | 'signal'> = {},
) {
  const params = new URLSearchParams({ scope_kind: scopeKind })
  return apiBlob(
    `${attachmentBase(workspaceId)}/${encodeURIComponent(attachmentId)}/download?${params}`,
    {
      headers: scopedHeaders(workspaceId, options.headers),
      signal: options.signal,
    },
  )
}

export function deleteAttachment(
  workspaceId: string,
  attachmentId: string,
  scopeKind: AttachmentScopeKind = 'workspace',
  options: Pick<AttachmentRequest, 'headers' | 'signal'> = {},
) {
  const params = new URLSearchParams({ scope_kind: scopeKind })
  return api<void>(
    `${attachmentBase(workspaceId)}/${encodeURIComponent(attachmentId)}?${params}`,
    {
      method: 'DELETE',
      headers: scopedHeaders(workspaceId, options.headers),
      signal: options.signal,
    },
  )
}

const attachmentMessageKeys: Record<string, string> = {
  FILE_TOO_LARGE: '文件超过 25 MiB 限制。',
  UNSUPPORTED_FILE_TYPE: '文件类型不受支持。',
  FILE_TYPE_MISMATCH: '文件扩展名与类型不匹配。',
  INVALID_FILE_CONTENT: '文件内容与所选类型不匹配。',
  INVALID_FILENAME: '文件名无效。',
  FILENAME_TOO_LONG: '文件名过长。',
  EMPTY_FILE: '不能上传空文件。',
  FILE_NOT_FOUND: '附件文件已不存在，请刷新列表后重试。',
  FILE_CLEANUP_FAILED: '附件清理失败，请稍后重试。',
  FORBIDDEN: '当前账号没有执行此操作的权限。',
  RESOURCE_NOT_FOUND: '附件不存在或当前账号无权访问。',
  NETWORK_ERROR: '无法连接服务器，请检查网络后重试。',
}

export function attachmentErrorMessage(cause: unknown) {
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code?: unknown }).code ?? '')
      : ''
  return attachmentMessageKeys[code] ?? '附件操作失败，请稍后重试。'
}

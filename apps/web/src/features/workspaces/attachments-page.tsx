import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, File, FileUp, Trash2 } from 'lucide-react'
import { api, apiBlob } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useWorkspace } from './context'

type ScopeKind = 'workspace' | 'personal'
type Attachment = {
  attachment_id: string
  tenant_id: string
  workspace_id: string
  scope_kind: ScopeKind
  owner_user_id: string | null
  filename: string
  media_type: string
  size_bytes: number
  created_by: string
  created_at: string
}
type AttachmentPage = { items: Attachment[]; total: number; page: number; page_size: number }

const acceptedExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.csv', '.docx', '.xlsx', '.pptx'])
const maxBytes = 25 * 1024 * 1024
const accepted = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.docx,.xlsx,.pptx'
const panel = 'rounded-xl border bg-card p-5'
const attachmentBase = (workspaceId: string) => `/workspaces/${workspaceId}/attachments`
const scopedHeaders = (workspaceId: string) => ({ 'X-Workspace-ID': workspaceId })
const scopePrefix = (actorId: string, tenantId: string, workspaceId: string) =>
  ['synapse', actorId, tenantId, workspaceId, 'attachments'] as const

export function WorkspaceAttachments() {
  const { workspace, actorId } = useWorkspace()
  return <WorkspaceAttachmentsContent key={`${actorId}:${workspace.tenant_id}:${workspace.workspace_id}`} workspace={workspace} actorId={actorId} />
}

function WorkspaceAttachmentsContent({ workspace, actorId }: { workspace: { tenant_id: string; workspace_id: string; name: string; status: string; workspace_role: string; membership_version?: number }; actorId: string }) {
  const client = useQueryClient()
  const [scopeKind, setScopeKind] = React.useState<ScopeKind>('workspace')
  const [page, setPage] = React.useState(1)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [error, setError] = React.useState('')
  const fileInput = React.useRef<HTMLInputElement>(null)
  const canUpload = ['owner', 'admin', 'member'].includes(workspace.workspace_role) && workspace.status === 'active'
  const canDeleteWorkspaceFiles = ['owner', 'admin'].includes(workspace.workspace_role)
  const keyPrefix = scopePrefix(actorId, workspace.tenant_id, workspace.workspace_id)
  const queryKey = [...keyPrefix, scopeKind, page, 20, workspace.membership_version ?? 0] as const

  React.useEffect(() => {
    setSelectedFile(null)
    setError('')
    setPage(1)
    if (fileInput.current) fileInput.current.value = ''
  }, [scopeKind])

  const attachments = useQuery({
    queryKey,
    enabled: workspace.status === 'active',
    queryFn: () => api<AttachmentPage>(`${attachmentBase(workspace.workspace_id)}?scope_kind=${scopeKind}&page=${page}&page_size=20`, { headers: scopedHeaders(workspace.workspace_id) }),
  })
  const refresh = () => client.invalidateQueries({ queryKey: [...keyPrefix, scopeKind] })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      body.append('scope_kind', scopeKind)
      return api<Attachment>(attachmentBase(workspace.workspace_id), { method: 'POST', headers: scopedHeaders(workspace.workspace_id), body })
    },
    onSuccess: async () => {
      setError('')
      setSelectedFile(null)
      setPage(1)
      if (fileInput.current) fileInput.current.value = ''
      await refresh()
    },
    onError: (cause) => setError(errorMessage(cause)),
  })
  const remove = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: ScopeKind }) => api<void>(`${attachmentBase(workspace.workspace_id)}/${id}?scope_kind=${scope}`, { method: 'DELETE', headers: scopedHeaders(workspace.workspace_id) }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorMessage(cause)),
  })

  const chooseFile = (file?: File) => {
    setError('')
    setSelectedFile(null)
    if (!file) return
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
    if (!acceptedExtensions.has(extension)) {
      setError('文件类型不受支持。请选择 PNG、JPEG、GIF、WebP、PDF、TXT、CSV、DOCX、XLSX 或 PPTX。')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size === 0) {
      setError('不能上传空文件。')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size > maxBytes) {
      setError('文件超过 25 MiB 限制。')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setSelectedFile(file)
  }

  const download = async (attachment: Attachment) => {
    setError('')
    try {
      const blob = await apiBlob(`${attachmentBase(workspace.workspace_id)}/${attachment.attachment_id}/download?scope_kind=${scopeKind}`, { headers: scopedHeaders(workspace.workspace_id) })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <main className='space-y-6 p-6'>
      <header>
        <Link className='text-sm underline underline-offset-4' to='/w/$workspaceId' params={{ workspaceId: workspace.workspace_id }}>← 返回空间</Link>
        <p className='mt-3 text-sm text-muted-foreground'>Workspace · {workspace.name}</p>
        <h1 className='mt-1 text-2xl font-semibold'>附件</h1>
        <p className='mt-2 text-sm text-muted-foreground'>管理此空间中的文件。个人附件只对上传者本人可见。</p>
      </header>

      {workspace.status !== 'active' ? <section className={`${panel} text-sm text-muted-foreground`}>空间已归档，附件当前为只读不可用状态。恢复空间后可以继续访问。</section> : <>
        <section className={`${panel} space-y-4`}>
          <div>
            <h2 className='font-semibold'>存储范围</h2>
            <p className='mt-1 text-sm text-muted-foreground'>Workspace 附件对有访问权限的空间成员开放；个人附件仅当前账号可见。</p>
          </div>
          <div className='flex flex-wrap gap-2' role='group' aria-label='附件存储范围'>
            <Button type='button' variant={scopeKind === 'workspace' ? 'default' : 'outline'} aria-pressed={scopeKind === 'workspace'} onClick={() => setScopeKind('workspace')}>Workspace 附件</Button>
            <Button type='button' variant={scopeKind === 'personal' ? 'default' : 'outline'} aria-pressed={scopeKind === 'personal'} onClick={() => setScopeKind('personal')}>我的个人附件</Button>
          </div>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
            <div className='min-w-0 flex-1 space-y-2'>
              <label className='text-sm font-medium' htmlFor='workspace-attachment-file'>选择文件</label>
              <input ref={fileInput} id='workspace-attachment-file' type='file' accept={accepted} disabled={!canUpload || upload.isPending} onChange={(event) => chooseFile(event.target.files?.[0])} className='block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5' />
              <p className='text-xs text-muted-foreground'>单个文件最大 25 MiB。支持 PNG、JPEG、GIF、WebP、PDF、TXT、CSV、DOCX、XLSX、PPTX。</p>
            </div>
            <Button type='button' disabled={!canUpload || !selectedFile || upload.isPending} onClick={() => selectedFile && upload.mutate(selectedFile)}>
              <FileUp className='mr-2 size-4' />{upload.isPending ? '上传中…' : '上传附件'}
            </Button>
          </div>
          {selectedFile && <p className='text-sm text-muted-foreground'>待上传：{selectedFile.name} · {formatSize(selectedFile.size)}</p>}
          {!canUpload && <p className='text-sm text-muted-foreground'>当前空间角色无上传权限。</p>}
        </section>

        <section className={panel}>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div><h2 className='font-semibold'>{scopeKind === 'workspace' ? 'Workspace 附件' : '我的个人附件'}</h2><p className='mt-1 text-sm text-muted-foreground'>{scopeKind === 'workspace' ? '当前 Workspace 可见的附件。' : '只有你可以列出、下载或删除这些附件。'}</p></div>
            {attachments.data && <span className='text-sm text-muted-foreground'>共 {attachments.data.total} 个文件</span>}
          </div>
          {attachments.isLoading ? <p className='py-8 text-center text-sm text-muted-foreground'>正在加载附件…</p> : attachments.isError ? <p role='alert' className='py-8 text-center text-sm text-destructive'>{errorMessage(attachments.error)}</p> : attachments.data?.items.length ? <div className='mt-4 divide-y'>
            {attachments.data.items.map((attachment) => {
              const canDelete = scopeKind === 'personal' || canDeleteWorkspaceFiles
              return <article key={attachment.attachment_id} className='flex flex-col gap-3 py-3 sm:flex-row sm:items-center'>
                <File className='hidden size-5 shrink-0 text-muted-foreground sm:block' aria-hidden='true' />
                <div className='min-w-0 flex-1'><p className='truncate font-medium' title={attachment.filename}>{attachment.filename}</p><p className='mt-1 text-xs text-muted-foreground'>{formatSize(attachment.size_bytes)} · {attachment.media_type} · {new Date(attachment.created_at).toLocaleString()}</p></div>
                <div className='flex shrink-0 gap-2'>
                  <Button type='button' size='sm' variant='outline' onClick={() => void download(attachment)}><Download className='mr-2 size-4' />下载</Button>
                  {canDelete && <Button type='button' size='sm' variant='outline' disabled={remove.isPending} onClick={() => {
                    if (window.confirm(`确定删除“${attachment.filename}”吗？`)) remove.mutate({ id: attachment.attachment_id, scope: scopeKind })
                  }}><Trash2 className='mr-2 size-4' />删除</Button>}
                </div>
              </article>
            })}
            <div className='flex items-center justify-between pt-4 text-sm'><span>第 {page} 页</span><div className='flex gap-2'><Button size='sm' variant='outline' disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><Button size='sm' variant='outline' disabled={page * 20 >= attachments.data.total} onClick={() => setPage((value) => value + 1)}>下一页</Button></div></div>
          </div> : <div className='py-10 text-center'><File className='mx-auto size-8 text-muted-foreground/60' /><p className='mt-3 text-sm text-muted-foreground'>{scopeKind === 'workspace' ? '此 Workspace 暂无附件。' : '你还没有个人附件。'}</p></div>}
        </section>
      </>}
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
    </main>
  )
}

function errorMessage(cause: unknown) {
  if (!(cause instanceof Error)) return '附件操作失败，请稍后重试。'
  const code = 'code' in cause ? String(cause.code ?? '') : ''
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: '文件超过 25 MiB 限制。',
    UNSUPPORTED_FILE_TYPE: '文件类型不受支持。',
    FILE_TYPE_MISMATCH: '文件扩展名与类型不匹配。',
    INVALID_FILE_CONTENT: '文件内容与所选类型不匹配。',
    INVALID_FILENAME: '文件名无效。',
    EMPTY_FILE: '不能上传空文件。',
    FORBIDDEN: '当前账号没有执行此操作的权限。',
    RESOURCE_NOT_FOUND: '附件不存在或当前账号无权访问。',
    NETWORK_ERROR: '无法连接服务器，请检查网络后重试。',
  }
  return messages[code] ?? cause.message
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

import * as React from 'react'
import { getRouteApi } from '@tanstack/react-router'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Download, File, FileUp, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { ApiProblem } from '@/lib/api'
import {
  attachmentErrorMessage,
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
  type Attachment,
  type AttachmentScopeKind,
} from '@/api/attachments'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useWorkspace } from './context'
import { LocalizedText } from '@/components/localized-text'
import { useLocaleText } from '@/lib/i18n'

const attachmentsRoute = getRouteApi('/_authenticated/w/$workspaceId/attachments')
const acceptedExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
  '.docx',
  '.xlsx',
  '.pptx',
])
const maxBytes = 25 * 1024 * 1024
const accepted = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.docx,.xlsx,.pptx'
const pageSizeDefault = 20
const panel = 'rounded-xl border bg-card p-5'

export function WorkspaceAttachments() {
  const { workspace, actorId } = useWorkspace()
  return (
    <WorkspaceAttachmentsContent
      key={`${actorId}:${workspace.tenant_id}:${workspace.workspace_id}`}
      workspace={workspace}
      actorId={actorId}
    />
  )
}

function WorkspaceAttachmentsContent({
  workspace,
  actorId,
}: {
  workspace: {
    tenant_id: string
    workspace_id: string
    name: string
    status: string
    workspace_role: string
    membership_version?: number
  }
  actorId: string
}) {
  const t = useLocaleText()
  const client = useQueryClient()
  const search = attachmentsRoute.useSearch()
  const navigate = attachmentsRoute.useNavigate()
  const scopeKind: AttachmentScopeKind = search.scope_kind ?? 'workspace'
  const page = search.page ?? 1
  const pageSize = search.page_size ?? pageSizeDefault
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [uploadError, setUploadError] = React.useState('')
  const [downloadError, setDownloadError] = React.useState('')
  const [deleteError, setDeleteError] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<Attachment | null>(null)
  const [deletingIds, setDeletingIds] = React.useState<Set<string>>(new Set())
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const canUpload =
    ['owner', 'admin', 'member'].includes(workspace.workspace_role) &&
    workspace.status === 'active'
  const canDeleteWorkspaceFiles = ['owner', 'admin'].includes(
    workspace.workspace_role,
  )
  const keyPrefix = [
    'synapse',
    actorId,
    workspace.tenant_id,
    workspace.workspace_id,
    'attachments',
  ] as const
  const queryKey = [
    ...keyPrefix,
    {
      scopeKind,
      page,
      pageSize,
      workspaceId: workspace.workspace_id,
      membershipVersion: workspace.membership_version ?? 0,
    },
  ] as const

  const changeScope = (nextScope: AttachmentScopeKind) => {
    if (nextScope === scopeKind) return
    setSelectedFile(null)
    setUploadError('')
    setDownloadError('')
    setDeleteError('')
    if (fileInput.current) fileInput.current.value = ''
    void navigate({
      search: (previous) => ({
        ...previous,
        scope_kind: nextScope,
        page: 1,
      }),
      replace: true,
    })
  }

  const setPage = React.useCallback(
    (nextPage: number) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          page: Math.max(1, nextPage),
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const attachments = useQuery({
    queryKey,
    enabled: workspace.status === 'active',
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listAttachments({
        workspaceId: workspace.workspace_id,
        scopeKind,
        page,
        pageSize,
        headers: { 'X-Workspace-ID': workspace.workspace_id },
        signal,
      }),
  })

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: keyPrefix })
  }

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadAttachment(workspace.workspace_id, file, scopeKind, {
        headers: { 'X-Workspace-ID': workspace.workspace_id },
      }),
    onSuccess: async () => {
      setUploadError('')
      setSelectedFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setPage(1)
      await refresh()
    },
    onError: (cause) => setUploadError(t(attachmentErrorMessage(cause))),
  })

  const remove = useMutation({
    mutationFn: ({
      id,
      scope,
    }: {
      id: string
      scope: AttachmentScopeKind
      filename: string
    }) =>
      deleteAttachment(workspace.workspace_id, id, scope, {
        headers: { 'X-Workspace-ID': workspace.workspace_id },
      }),
    onMutate: ({ id }) => {
      setDeleteError('')
      setDeletingIds((current) => new Set(current).add(id))
    },
    onSuccess: async () => {
      setDeleteTarget(null)
      await refresh()
    },
    onError: async (cause, variables) => {
      setDeleteError(
        `${t('删除失败：')}“${variables.filename}”：${t(attachmentErrorMessage(cause))}`,
      )
      if (cause instanceof ApiProblem && cause.status === 404) {
        await refresh()
      }
    },
    onSettled: (_data, _error, variables) => {
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(variables.id)
        return next
      })
    },
  })

  React.useEffect(() => {
    const total = attachments.data?.total
    if (total === undefined || page <= 1) return
    const lastPage = Math.max(1, Math.ceil(total / pageSize))
    if (page > lastPage) setPage(lastPage)
  }, [attachments.data?.total, page, pageSize, setPage])

  const chooseFile = (file?: File) => {
    setUploadError('')
    setSelectedFile(null)
    if (!file) return
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
    if (!acceptedExtensions.has(extension)) {
      setUploadError(
        '文件类型不受支持。请选择 PNG、JPEG、GIF、WebP、PDF、TXT、CSV、DOCX、XLSX 或 PPTX。',
      )
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size === 0) {
      setUploadError('不能上传空文件。')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size > maxBytes) {
      setUploadError('文件超过 25 MiB 限制。')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setSelectedFile(file)
  }

  const download = async (attachment: Attachment) => {
    setDownloadError('')
    setDownloadingId(attachment.attachment_id)
    try {
      const blob = await downloadAttachment(
        workspace.workspace_id,
        attachment.attachment_id,
        scopeKind,
        {
          headers: { 'X-Workspace-ID': workspace.workspace_id },
        },
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setDownloadError(
        `${t('下载失败：')}“${attachment.filename}”：${t(attachmentErrorMessage(cause))}`,
      )
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <main className='space-y-6 p-6'>
      <header>
        <p className='mt-3 text-sm text-muted-foreground'>
          <LocalizedText text={'Workspace · '} />
          {workspace.name}
        </p>
        <h1 className='mt-1 text-2xl font-semibold'>
          <LocalizedText text={'附件'} />
        </h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          <LocalizedText text={'管理此空间中的文件。个人附件只对上传者本人可见。'} />
        </p>
      </header>

      {workspace.status !== 'active' ? (
        <section className={`${panel} text-sm text-muted-foreground`}>
          <LocalizedText
            text={'空间已归档，附件当前为只读不可用状态。恢复空间后可以继续访问。'}
          />
        </section>
      ) : (
        <>
          <section className={`${panel} space-y-4`}>
            <div>
              <h2 className='font-semibold'>
                <LocalizedText text={'存储范围'} />
              </h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                <LocalizedText
                  text={
                    'Workspace 附件对有访问权限的空间成员开放；个人附件仅当前账号可见。'
                  }
                />
              </p>
            </div>
            <div
              className='flex flex-wrap gap-2'
              role='group'
              aria-label={t('附件存储范围')}
            >
              <Button
                type='button'
                variant={scopeKind === 'workspace' ? 'default' : 'outline'}
                aria-pressed={scopeKind === 'workspace'}
                onClick={() => changeScope('workspace')}
              >
                <LocalizedText text={'Workspace 附件'} />
              </Button>
              <Button
                type='button'
                variant={scopeKind === 'personal' ? 'default' : 'outline'}
                aria-pressed={scopeKind === 'personal'}
                onClick={() => changeScope('personal')}
              >
                <LocalizedText text={'我的个人附件'} />
              </Button>
            </div>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
              <div className='min-w-0 flex-1 space-y-2'>
                <label
                  className='text-sm font-medium'
                  htmlFor='workspace-attachment-file'
                >
                  <LocalizedText text={'选择文件'} />
                </label>
                <Input
                  ref={fileInput}
                  id='workspace-attachment-file'
                  type='file'
                  accept={accepted}
                  disabled={!canUpload || upload.isPending}
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                  className='block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5'
                />
                <p className='text-xs text-muted-foreground'>
                  <LocalizedText
                    text={
                      '单个文件最大 25 MiB。支持 PNG、JPEG、GIF、WebP、PDF、TXT、CSV、DOCX、XLSX、PPTX。'
                    }
                  />
                </p>
              </div>
              <Button
                type='button'
                disabled={!canUpload || !selectedFile || upload.isPending}
                onClick={() => selectedFile && upload.mutate(selectedFile)}
              >
                <FileUp className='mr-2 size-4' />
                {upload.isPending ? (
                  <LocalizedText text={'上传中…'} />
                ) : (
                  <LocalizedText text={'上传附件'} />
                )}
              </Button>
            </div>
            {selectedFile && (
              <p className='text-sm text-muted-foreground'>
                <LocalizedText text={'待上传：'} />
                {selectedFile.name}
                <LocalizedText text={' · '} />
                {formatSize(selectedFile.size)}
              </p>
            )}
            {uploadError && (
              <p role='alert' className='text-sm text-destructive'>
                {t(uploadError)}
              </p>
            )}
            {!canUpload && (
              <p className='text-sm text-muted-foreground'>
                <LocalizedText text={'当前空间角色无上传权限。'} />
              </p>
            )}
          </section>

          <section className={panel}>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 className='font-semibold'>
                  {scopeKind === 'workspace' ? (
                    <LocalizedText text={'Workspace 附件'} />
                  ) : (
                    <LocalizedText text={'我的个人附件'} />
                  )}
                </h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {scopeKind === 'workspace' ? (
                    <LocalizedText text={'当前 Workspace 可见的附件。'} />
                  ) : (
                    <LocalizedText text={'只有你可以列出、下载或删除这些附件。'} />
                  )}
                </p>
              </div>
              {attachments.data && (
                <span className='text-sm text-muted-foreground'>
                  <LocalizedText text={'共 '} />
                  {attachments.data.total}
                  <LocalizedText text={' 个文件'} />
                </span>
              )}
            </div>
            {attachments.isError && (
              <div
                className='mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm'
                role='alert'
              >
                <span className='text-destructive'>
                  {t(attachmentErrorMessage(attachments.error))}
                </span>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => void attachments.refetch()}
                >
                  <RotateCcw className='mr-2 size-4' />
                  <LocalizedText text={'重试加载'} />
                </Button>
              </div>
            )}
            {attachments.isPending && !attachments.data ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                <LocalizedText text={'正在加载附件…'} />
              </p>
            ) : attachments.data?.items.length ? (
              <div className='mt-4 divide-y'>
                {attachments.data.items.map((attachment) => {
                  const canDelete =
                    scopeKind === 'personal' || canDeleteWorkspaceFiles
                  const isDeleting = deletingIds.has(attachment.attachment_id)
                  const isDownloading =
                    downloadingId === attachment.attachment_id
                  return (
                    <article
                      key={attachment.attachment_id}
                      className='flex flex-col gap-3 py-3 sm:flex-row sm:items-center'
                    >
                      <File
                        className='hidden size-5 shrink-0 text-muted-foreground sm:block'
                        aria-hidden='true'
                      />
                      <div className='min-w-0 flex-1'>
                        <p
                          className='truncate font-medium'
                          title={attachment.filename}
                        >
                          {attachment.filename}
                        </p>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {formatSize(attachment.size_bytes)}
                          <LocalizedText text={' · '} />
                          {attachment.media_type}
                          <LocalizedText text={' · '} />
                          {new Date(attachment.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className='flex shrink-0 gap-2'>
                        <Button
                          type='button'
                          size='sm'
                          variant='outline'
                          disabled={isDownloading || isDeleting}
                          onClick={() => void download(attachment)}
                        >
                          {isDownloading ? (
                            <Loader2 className='mr-2 size-4 animate-spin' />
                          ) : (
                            <Download className='mr-2 size-4' />
                          )}
                          {isDownloading ? (
                            <LocalizedText text={'下载中…'} />
                          ) : (
                            <LocalizedText text={'下载'} />
                          )}
                        </Button>
                        {canDelete && (
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            disabled={isDeleting || isDownloading}
                            onClick={() => {
                              setDeleteError('')
                              setDeleteTarget(attachment)
                            }}
                          >
                            {isDeleting ? (
                              <Loader2 className='mr-2 size-4 animate-spin' />
                            ) : (
                              <Trash2 className='mr-2 size-4' />
                            )}
                            {isDeleting ? (
                              <LocalizedText text={'删除中…'} />
                            ) : (
                              <LocalizedText text={'删除'} />
                            )}
                          </Button>
                        )}
                      </div>
                    </article>
                  )
                })}
                <div className='flex items-center justify-between pt-4 text-sm'>
                  <span>
                    <LocalizedText text={'第 '} />
                    {page}
                    <LocalizedText text={' 页'} />
                  </span>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <LocalizedText text={'上一页'} />
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={page * pageSize >= attachments.data.total}
                      onClick={() => setPage(page + 1)}
                    >
                      <LocalizedText text={'下一页'} />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className='py-10 text-center'>
                <File className='mx-auto size-8 text-muted-foreground/60' />
                <p className='mt-3 text-sm text-muted-foreground'>
                  {scopeKind === 'workspace' ? (
                    <LocalizedText text={'此 Workspace 暂无附件。'} />
                  ) : (
                    <LocalizedText text={'你还没有个人附件。'} />
                  )}
                </p>
              </div>
            )}
            {downloadError && (
              <p role='alert' className='mt-4 text-sm text-destructive'>
                {downloadError}
              </p>
            )}
            {deleteError && (
              <p role='alert' className='mt-4 text-sm text-destructive'>
                {deleteError}
              </p>
            )}
          </section>
        </>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <LocalizedText text={'删除附件'} />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <LocalizedText text={'确定删除“'} />
              {deleteTarget?.filename}
              <LocalizedText text={'”吗？删除后无法恢复。'} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              <LocalizedText text={'取消'} />
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending || !deleteTarget}
              onClick={(event) => {
                event.preventDefault()
                if (!deleteTarget) return
                remove.mutate({
                  id: deleteTarget.attachment_id,
                  scope: scopeKind,
                  filename: deleteTarget.filename,
                })
              }}
            >
              {remove.isPending ? (
                <LocalizedText text={'删除中…'} />
              ) : (
                <LocalizedText text={'确认删除'} />
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

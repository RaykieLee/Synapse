import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  listKnowledgeBases,
  listKnowledgeChunkers,
  listKnowledgeDocuments,
  listKnowledgeEmbeddingModels,
  updateKnowledgeBase,
  uploadKnowledgeDocument,
  type ChunkersResponse,
  type EmbeddingModelsResponse,
  type KnowledgeBaseView,
  type KnowledgeDocumentView,
} from '@/api/agentscope-resources'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormDialog } from '@/components/form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/features/workspaces/context'
import { api, apiBlob, ApiProblem } from '@/lib/api'
import {
  EmptyState,
  PageButton,
  ResourceError,
  ResourceLoading,
  SearchBox,
} from './shared'
import { formatBytes, formatDate, panel } from './shared-utils'

const AI_BASE = '/ai'
const API_PREFIX = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')
const POLL_INTERVAL_MS = 1500
const CHUNK_PAGE_SIZE = 20
const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024
const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']

type SchemaValue = string | number | boolean | null | undefined

type JsonSchemaProperty = {
  title?: string
  description?: string
  type?: string
  enum?: unknown[]
  anyOf?: Array<{ type?: string; enum?: unknown[] }>
  default?: unknown
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  format?: string
  const?: unknown
}

type JsonSchema = {
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

type EmbeddingModelCard = {
  name: string
  label?: string
  dimensions: number
  supported_dimensions?: number[] | null
}

type EmbeddingOption = {
  key: string
  type: string
  credentialId: string
  credentialLabel: string
  model: EmbeddingModelCard
}

type ChunkerOption = {
  type: string
  schema: JsonSchema
}

type BaseDraft = {
  id?: string
  name: string
  description: string
  embeddingKey?: string
  dimensions?: number
  chunkerType?: string
  chunkerParams: Record<string, SchemaValue>
}

type KnowledgeChunk = {
  content: { type: string; text?: unknown; [key: string]: unknown }
  source: string
  chunk_index: number
  total_chunks: number
  metadata?: Record<string, unknown>
}

type SearchHit = {
  score: number
  document_id: string
  chunk: KnowledgeChunk
}

type DocumentStatusResponse = { items: KnowledgeDocumentView[] }
type DocumentChunksResponse = {
  chunks: KnowledgeChunk[]
  total: number
  page: number
  page_size: number
}
type DownloadTokenResponse = { token: string; expires_at: number }
type SupportedContentTypesResponse = { media_types: string[]; extensions: string[] }
type KnowledgeSearchResponse = { results: SearchHit[]; total: number }

const workspaceHeaders = (workspaceId: string) => ({ 'X-Workspace-ID': workspaceId })

const knowledgePath = (knowledgeBaseId: string, suffix = '') =>
  `${AI_BASE}/knowledge_bases/${encodeURIComponent(knowledgeBaseId)}${suffix}`

async function listDocumentStatuses(
  workspaceId: string,
  knowledgeBaseId: string,
  ids: string[]
) {
  const search = new URLSearchParams({ ids: ids.join(',') })
  return api<DocumentStatusResponse>(
    `${knowledgePath(knowledgeBaseId, '/documents/status')}?${search}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

function listDocumentChunks(
  workspaceId: string,
  knowledgeBaseId: string,
  documentId: string,
  page: number
) {
  const search = new URLSearchParams({
    page: String(page),
    page_size: String(CHUNK_PAGE_SIZE),
  })
  return api<DocumentChunksResponse>(
    `${knowledgePath(knowledgeBaseId, `/documents/${encodeURIComponent(documentId)}/chunks`)}?${search}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

async function fetchDocumentText(
  workspaceId: string,
  knowledgeBaseId: string,
  documentId: string
) {
  const blob = await apiBlob(
    knowledgePath(knowledgeBaseId, `/documents/${encodeURIComponent(documentId)}`),
    { headers: workspaceHeaders(workspaceId) }
  )
  return blob.text()
}

function createDownloadToken(
  workspaceId: string,
  knowledgeBaseId: string,
  documentId: string
) {
  return api<DownloadTokenResponse>(
    knowledgePath(knowledgeBaseId, `/documents/${encodeURIComponent(documentId)}/download_token`),
    { method: 'POST', headers: workspaceHeaders(workspaceId) }
  )
}

function listSupportedContentTypes(workspaceId: string) {
  return api<SupportedContentTypesResponse>(`${AI_BASE}/knowledge_bases/supported_content_types`, {
    headers: workspaceHeaders(workspaceId),
  })
}

function searchKnowledge(
  workspaceId: string,
  knowledgeBaseId: string,
  body: { query: string; top_k: number }
) {
  return api<KnowledgeSearchResponse>(knowledgePath(knowledgeBaseId, '/search'), {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

function documentContentUrl(knowledgeBaseId: string, documentId: string, token: string) {
  const prefix = API_PREFIX.startsWith('http')
    ? API_PREFIX
    : `${window.location.origin}${API_PREFIX}`
  const search = new URLSearchParams({ token })
  return `${prefix}${knowledgePath(knowledgeBaseId, `/documents/${encodeURIComponent(documentId)}`)}?${search}`
}

function isTerminalStatus(status: string) {
  return status === 'ready' || status === 'error'
}

function schemaType(prop: JsonSchemaProperty) {
  return prop.type ?? prop.anyOf?.find((variant) => variant.type !== 'null')?.type ?? 'string'
}

function schemaEnum(prop: JsonSchemaProperty) {
  return prop.enum ?? prop.anyOf?.find((variant) => variant.enum)?.enum ?? null
}

function schemaDefaults(schema: JsonSchema) {
  const values: Record<string, SchemaValue> = {}
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.const !== undefined || prop.default === undefined) continue
    values[key] = prop.default as SchemaValue
  }
  return values
}

function normalizeEmbeddingOptions(data: EmbeddingModelsResponse): EmbeddingOption[] {
  return data.providers.flatMap((provider) => {
    const credential = provider.credential as {
      id?: string
      data?: { type?: string; name?: string }
    }
    const credentialId = credential?.id
    if (!credentialId) return []
    const type = credential.data?.type ?? 'unknown'
    const label = credential.data?.name ?? credentialId.slice(0, 8)
    return (provider.models as EmbeddingModelCard[]).map((model) => ({
      key: `${credentialId}:${model.name}`,
      type,
      credentialId,
      credentialLabel: label,
      model,
    }))
  })
}

function normalizeChunkers(data: ChunkersResponse): ChunkerOption[] {
  return data.chunkers.map((chunker) => ({
    type: chunker.type,
    schema: chunker.parameter_schema as JsonSchema,
  }))
}

function chunkText(content: KnowledgeChunk['content']) {
  if (typeof content.text === 'string') return content.text
  return JSON.stringify(content, null, 2)
}

function mediaType(document: KnowledgeDocumentView) {
  return (document.content_type ?? '').split(';')[0].trim().toLowerCase()
}

function readEmbeddingConfig(value: KnowledgeBaseView) {
  return (value.embedding_model_config ?? {}) as {
    model?: string
    dimensions?: number
    credential_id?: string
  }
}

function readChunkerConfig(value: KnowledgeBaseView) {
  return (value.chunker_config ?? null) as {
    type?: string
    parameters?: Record<string, unknown>
  } | null
}

export function AgentScopeKnowledgePage({
  workspaceId: workspaceIdProp,
}: {
  workspaceId?: string
}) {
  const workspace = useWorkspace()
  const workspaceId = workspaceIdProp ?? workspace.workspace.workspace_id
  const client = useQueryClient()
  const [search, setSearch] = React.useState('')
  const query = search
  const [page, setPage] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<BaseDraft | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<KnowledgeBaseView | null>(null)
  const [docDeleteTarget, setDocDeleteTarget] = React.useState<KnowledgeDocumentView | null>(null)
  const [uploadFiles, setUploadFiles] = React.useState<File[]>([])
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploadError, setUploadError] = React.useState('')
  const [docSearch, setDocSearch] = React.useState('')
  const [docPage, setDocPage] = React.useState(1)
  const [detailTarget, setDetailTarget] = React.useState<KnowledgeDocumentView | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)

  const bases = useQuery({
    queryKey: ['agentscope', workspaceId, 'knowledge-bases', page, query],
    queryFn: () => listKnowledgeBases(workspaceId, { page, name: query }),
  })
  const selected = React.useMemo(
    () => bases.data?.knowledge_bases.find((item) => item.id === selectedId) ?? null,
    [bases.data, selectedId]
  )
  const documents = useQuery({
    queryKey: [
      'agentscope',
      workspaceId,
      'knowledge-documents',
      selected?.id,
      docPage,
      docSearch,
    ],
    queryFn: () =>
      listKnowledgeDocuments(workspaceId, selected!.id, {
        page: docPage,
        keywords: docSearch,
      }),
    enabled: Boolean(selected),
  })
  const capabilities = useQuery({
    queryKey: ['agentscope', workspaceId, 'knowledge-capabilities'],
    queryFn: async () => {
      const [embedding, chunkers] = await Promise.all([
        listKnowledgeEmbeddingModels(workspaceId),
        listKnowledgeChunkers(workspaceId),
      ])
      return {
        embeddings: normalizeEmbeddingOptions(embedding),
        chunkers: normalizeChunkers(chunkers),
        policy: embedding.policy as { kind?: string; dimension?: number | null },
      }
    },
    enabled: Boolean(draft && !draft.id),
  })
  const supportedTypes = useQuery({
    queryKey: ['agentscope', workspaceId, 'knowledge-supported-content-types'],
    queryFn: () => listSupportedContentTypes(workspaceId),
    enabled: Boolean(selected),
  })

  const listedDocuments = React.useMemo(
    () => documents.data?.documents ?? [],
    [documents.data]
  )
  const pollIds = React.useMemo(
    () => listedDocuments.filter((item) => !isTerminalStatus(item.status)).map((item) => item.id),
    [listedDocuments]
  )
  const pollIdsKey = pollIds.join(',')
  const statuses = useQuery({
    queryKey: [
      'agentscope',
      workspaceId,
      'knowledge-document-status',
      selected?.id,
      pollIdsKey,
    ],
    queryFn: () =>
      listDocumentStatuses(workspaceId, selected!.id, pollIdsKey ? pollIdsKey.split(',') : []),
    enabled: Boolean(selected && pollIds.length > 0),
    refetchInterval: POLL_INTERVAL_MS,
  })
  const statusById = React.useMemo(() => {
    const result = new Map<string, KnowledgeDocumentView>()
    for (const item of statuses.data?.items ?? []) result.set(item.id, item)
    return result
  }, [statuses.data])
  const visibleDocuments = listedDocuments.map((item) => statusById.get(item.id) ?? item)

  // The status endpoint intentionally omits some final fields such as chunk
  // counts. Refetch the canonical lists once a polled row becomes terminal.
  const terminalTransition = statuses.data?.items.some((item) => {
    const listed = listedDocuments.find((candidate) => candidate.id === item.id)
    return listed && isTerminalStatus(item.status) && listed.status !== item.status
  })
  React.useEffect(() => {
    if (!terminalTransition || !selected) return
    void client.invalidateQueries({
      queryKey: ['agentscope', workspaceId, 'knowledge-documents', selected.id],
    })
    void client.invalidateQueries({
      queryKey: ['agentscope', workspaceId, 'knowledge-bases'],
    })
  }, [client, selected, terminalTransition, workspaceId])

  const embeddingOptions = React.useMemo(
    () => capabilities.data?.embeddings ?? [],
    [capabilities.data]
  )
  const defaultEmbedding = embeddingOptions[0] ?? null
  const selectedEmbedding = React.useMemo(
    () =>
      embeddingOptions.find((item) => item.key === draft?.embeddingKey) ?? defaultEmbedding,
    [defaultEmbedding, draft?.embeddingKey, embeddingOptions]
  )
  const selectedChunker = React.useMemo(() => {
    const chunkers = capabilities.data?.chunkers ?? []
    return chunkers.find((item) => item.type === draft?.chunkerType) ?? chunkers[0] ?? null
  }, [capabilities.data, draft?.chunkerType])
  const selectedDimensions = React.useMemo(() => {
    if (draft?.dimensions != null) return draft.dimensions
    if (!selectedEmbedding) return null
    return (
      selectedEmbedding.model.supported_dimensions?.find(
        (item) => item === selectedEmbedding.model.dimensions
      ) ??
      selectedEmbedding.model.supported_dimensions?.[0] ??
      selectedEmbedding.model.dimensions
    )
  }, [draft?.dimensions, selectedEmbedding])
  const selectedChunkerParams = React.useMemo(
    () =>
      selectedChunker && draft?.chunkerType === selectedChunker.type
        ? draft.chunkerParams
        : schemaDefaults(selectedChunker?.schema ?? {}),
    [draft, selectedChunker]
  )

  const refreshBases = () =>
    client.invalidateQueries({ queryKey: ['agentscope', workspaceId, 'knowledge-bases'] })
  const save = useMutation({
    mutationFn: async (value: BaseDraft) => {
      if (value.id) {
        return updateKnowledgeBase(workspaceId, value.id, {
          name: value.name.trim(),
          description: value.description.trim(),
        })
      }
      if (!selectedEmbedding || !selectedChunker || selectedDimensions == null) {
        throw new Error('请选择 embedding 模型、维度和 chunker。')
      }
      const parameters = Object.fromEntries(
        Object.entries(selectedChunkerParams).filter(
          ([, item]) => item !== undefined && item !== null && item !== ''
        )
      )
      return createKnowledgeBase(workspaceId, {
        name: value.name.trim(),
        description: value.description.trim(),
        embedding_model_config: {
          type: selectedEmbedding.type,
          credential_id: selectedEmbedding.credentialId,
          model: selectedEmbedding.model.name,
          dimensions: selectedDimensions,
          parameters: {},
        },
        chunker_config: {
          type: selectedChunker.type,
          parameters,
        },
      })
    },
    onSuccess: async () => {
      setDraft(null)
      await refreshBases()
    },
  })
  const remove = useMutation({
    mutationFn: (value: KnowledgeBaseView) => deleteKnowledgeBase(workspaceId, value.id),
    onSuccess: async (_result, value) => {
      setDeleteTarget(null)
      if (selectedId === value.id) setSelectedId(null)
      await refreshBases()
    },
  })
  const upload = useMutation({
    mutationFn: (files: File[]) =>
      Promise.all(
        files.map((file) =>
          selected
            ? uploadKnowledgeDocument(workspaceId, selected.id, file)
            : Promise.reject(new Error('请先选择知识库。'))
        )
      ),
    onSuccess: async () => {
      setUploadOpen(false)
      setUploadFiles([])
      setUploadError('')
      if (selected) {
        await client.invalidateQueries({
          queryKey: ['agentscope', workspaceId, 'knowledge-documents', selected.id],
        })
      }
      await refreshBases()
    },
  })
  const removeDocument = useMutation({
    mutationFn: (value: KnowledgeDocumentView) => {
      if (!selected) throw new Error('请先选择知识库。')
      return deleteKnowledgeDocument(workspaceId, selected.id, value.id)
    },
    onSuccess: async (_result, value) => {
      setDocDeleteTarget(null)
      if (detailTarget?.id === value.id) setDetailTarget(null)
      if (selected) {
        await client.invalidateQueries({
          queryKey: ['agentscope', workspaceId, 'knowledge-documents', selected.id],
        })
      }
      await refreshBases()
    },
  })

  const openCreate = () => {
    setDraft({ name: '', description: '', chunkerParams: {} })
  }
  const openEdit = (value: KnowledgeBaseView) => {
    setDraft({ id: value.id, name: value.name, description: value.description, chunkerParams: {} })
  }
  const chooseUploadFiles = (files: File[]) => {
    const extensions = new Set(
      supportedTypes.data?.extensions.map((item) => item.toLowerCase()) ?? []
    )
    if (extensions.size === 0) {
      setUploadFiles(files)
      setUploadError('')
      return
    }
    const accepted = files.filter((file) => {
      const dot = file.name.lastIndexOf('.')
      const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
      return extension && extensions.has(extension)
    })
    setUploadFiles(accepted)
    setUploadError(
      accepted.length === files.length
        ? ''
        : `已过滤 ${files.length - accepted.length} 个后端不支持的文件。支持：${[...extensions].join(', ')}`
    )
  }

  const dimensionOptions = selectedEmbedding
    ? selectedEmbedding.model.supported_dimensions?.length
      ? selectedEmbedding.model.supported_dimensions
      : [selectedEmbedding.model.dimensions]
    : []
  const createDisabled =
    !draft?.name.trim() ||
    (!draft.id && (!selectedEmbedding || selectedDimensions == null || !selectedChunker))

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm text-muted-foreground'>AgentScope Resources</p>
          <h1 className='text-2xl font-semibold'>Knowledge</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            管理知识库、文档索引、检索测试和原始文件。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className='mr-2 size-4' />
          创建知识库
        </Button>
      </header>

      <section className={panel}>
        <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder='按名称搜索知识库'
          />
          <span className='text-sm text-muted-foreground'>共 {bases.data?.total ?? 0} 个</span>
        </div>
        {bases.isLoading ? (
          <ResourceLoading />
        ) : bases.isError ? (
          <ResourceError error={bases.error} />
        ) : bases.data?.knowledge_bases.length ? (
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead>
                <tr className='border-b text-muted-foreground'>
                  <th className='p-3'>名称</th>
                  <th className='p-3'>Embedding</th>
                  <th className='p-3'>文档 / Chunk</th>
                  <th className='p-3'>权限</th>
                  <th className='p-3'>操作</th>
                </tr>
              </thead>
              <tbody>
                {bases.data.knowledge_bases.map((item) => (
                  <tr key={item.id} className='border-b last:border-0'>
                    <td className='p-3'>
                      <button
                        className='font-medium underline underline-offset-4'
                        onClick={() => {
                          setSelectedId(item.id)
                          setDocPage(1)
                          setDocSearch('')
                        }}
                      >
                        {item.name}
                      </button>
                      <span className='block max-w-xs truncate text-xs text-muted-foreground'>
                        {item.credential_name ?? readEmbeddingConfig(item).credential_id ?? '—'}
                      </span>
                    </td>
                    <td className='max-w-xs p-3'>
                      <span className='block truncate'>
                        {readEmbeddingConfig(item).model ?? '—'}
                      </span>
                      <span className='block text-xs text-muted-foreground'>
                        {readEmbeddingConfig(item).dimensions ?? '—'}d ·{' '}
                        {readChunkerConfig(item)?.type ?? '无 chunker'}
                      </span>
                    </td>
                    <td className='p-3'>
                      {item.document_count ?? 0} / {item.chunk_count ?? 0}
                    </td>
                    <td className='p-3'>{item.editable ? '可编辑' : '只读'}</td>
                    <td className='space-x-3 whitespace-nowrap p-3'>
                      <button
                        className='underline'
                        disabled={!item.editable}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className='mr-1 inline size-3.5' />
                        编辑
                      </button>
                      <button
                        className='text-destructive underline'
                        disabled={!item.editable}
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 className='mr-1 inline size-3.5' />
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>暂无知识库。</EmptyState>
        )}
        <div className='mt-4 flex items-center justify-end gap-2'>
          <PageButton disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            上一页
          </PageButton>
          <span className='text-sm text-muted-foreground'>第 {page} 页</span>
          <PageButton
            disabled={!bases.data || page * bases.data.page_size >= bases.data.total}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </PageButton>
        </div>
      </section>

      <FormDialog
        open={Boolean(draft)}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? '编辑知识库' : '创建知识库'}
        formAriaLabel={draft?.id ? '编辑知识库' : '创建知识库'}
        description={
          draft?.id
            ? 'embedding 和 chunker 配置创建后不可修改。'
            : '表单项由后端 capability 与 JSON Schema 自动生成。'
        }
        error={save.error instanceof Error ? save.error.message : ''}
        pending={save.isPending}
        disabled={createDisabled}
        submitLabel={draft?.id ? '保存修改' : '创建知识库'}
        onCancel={() => setDraft(null)}
        onSubmit={() => draft && save.mutate(draft)}
        contentClassName='sm:max-w-4xl'
      >
        <div className='space-y-4'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='block space-y-1 text-sm'>
              名称
              <Input
                value={draft?.name ?? ''}
                onChange={(event) =>
                  setDraft((value) => value && { ...value, name: event.target.value })
                }
              />
            </label>
            {!draft?.id && (
              <label className='block space-y-1 text-sm'>
                Embedding 模型
                <Select
                  value={selectedEmbedding?.key ?? ''}
                  onValueChange={(value) => {
                    const option = embeddingOptions.find((item) => item.key === value)
                    if (!option) return
                    const dimensions =
                      option.model.supported_dimensions?.find(
                        (item) => item === option.model.dimensions
                      ) ??
                      option.model.supported_dimensions?.[0] ??
                      option.model.dimensions
                    setDraft((current) =>
                      current ? { ...current, embeddingKey: value, dimensions } : current
                    )
                  }}
                >
                  <SelectTrigger className='w-full' aria-label='Embedding 模型'>
                    <SelectValue placeholder='选择模型' />
                  </SelectTrigger>
                  <SelectContent>
                    {embeddingOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.model.label ?? option.model.name} · {option.credentialLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
          <label className='block space-y-1 text-sm'>
            描述
            <Textarea
              value={draft?.description ?? ''}
              onChange={(event) =>
                setDraft((value) => value && { ...value, description: event.target.value })
              }
            />
          </label>
          {!draft?.id && (
            <>
              {capabilities.isLoading ? (
                <ResourceLoading />
              ) : capabilities.isError ? (
                <ResourceError error={capabilities.error} />
              ) : (
                <div className='space-y-4 rounded-lg border p-4'>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='block space-y-1 text-sm'>
                      向量维度
                      <Select
                        value={selectedDimensions != null ? String(selectedDimensions) : ''}
                        onValueChange={(value) =>
                          setDraft((current) =>
                            current ? { ...current, dimensions: Number(value) } : current
                          )
                        }
                        disabled={dimensionOptions.length <= 1}
                      >
                        <SelectTrigger className='w-full' aria-label='向量维度'>
                          <SelectValue placeholder='选择维度' />
                        </SelectTrigger>
                        <SelectContent>
                          {dimensionOptions.map((dimension) => (
                            <SelectItem key={dimension} value={String(dimension)}>
                              {dimension}d
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className='block space-y-1 text-sm'>
                      Chunker
                      <Select
                        value={draft?.chunkerType ?? ''}
                        onValueChange={(value) => {
                          const chunker = capabilities.data?.chunkers.find(
                            (item) => item.type === value
                          )
                          if (!chunker) return
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  chunkerType: value,
                                  chunkerParams: schemaDefaults(chunker.schema),
                                }
                              : current
                          )
                        }}
                      >
                        <SelectTrigger className='w-full' aria-label='Chunker'>
                          <SelectValue placeholder='选择 chunker' />
                        </SelectTrigger>
                        <SelectContent>
                          {(capabilities.data?.chunkers ?? []).map((chunker) => (
                            <SelectItem key={chunker.type} value={chunker.type}>
                              {chunker.type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  {selectedChunker && (
                    <SchemaFormControl
                      schema={selectedChunker.schema}
                      values={selectedChunkerParams}
                      onChange={(key, value) =>
                        setDraft((current) =>
                          current && current.chunkerType === selectedChunker?.type
                            ? {
                                ...current,
                                chunkerParams: { ...current.chunkerParams, [key]: value },
                              }
                            : current && selectedChunker
                              ? {
                                  ...current,
                                  chunkerType: selectedChunker.type,
                                  chunkerParams: { [key]: value },
                                }
                              : current
                        )
                      }
                    />
                  )}
                  {capabilities.data?.policy.kind &&
                    capabilities.data.policy.kind !== 'any' &&
                    capabilities.data.policy.dimension != null && (
                      <p className='text-xs text-muted-foreground'>
                        当前后端维度策略为 {capabilities.data.policy.kind}（
                        {capabilities.data.policy.dimension}d），可选模型已由服务端过滤。
                      </p>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title='删除知识库'
        desc={`将永久删除“${deleteTarget?.name ?? ''}”及其文档索引。`}
        destructive
        confirmText='确认删除'
        isLoading={remove.isPending}
        handleConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />

      <FormDialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadOpen(false)
            setUploadFiles([])
            setUploadError('')
          }
        }}
        title='上传知识库文档'
        formAriaLabel='上传知识库文档'
        description={
          supportedTypes.data
            ? `支持：${supportedTypes.data.extensions.join(', ')}`
            : '正在读取后端支持的文件类型。'
        }
        submitLabel='开始上传'
        pending={upload.isPending}
        disabled={uploadFiles.length === 0}
        error={[uploadError, upload.error instanceof Error ? upload.error.message : '']
          .filter(Boolean)
          .join(' ')}
        onCancel={() => {
          setUploadOpen(false)
          setUploadFiles([])
          setUploadError('')
        }}
        onSubmit={() => uploadFiles.length > 0 && upload.mutate(uploadFiles)}
      >
        <label className='block space-y-2 text-sm'>
          文件
          <Input
            type='file'
            multiple
            accept={
              supportedTypes.data
                ? [...supportedTypes.data.extensions, ...supportedTypes.data.media_types].join(',')
                : undefined
            }
            onChange={(event) => chooseUploadFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        {uploadFiles.length > 0 && (
          <ul className='space-y-1 text-xs text-muted-foreground'>
            {uploadFiles.map((file) => (
              <li key={`${file.name}-${file.size}`} className='truncate'>
                {file.name} · {formatBytes(file.size)}
              </li>
            ))}
          </ul>
        )}
      </FormDialog>

      <DocumentDialog
        base={selected}
        documents={visibleDocuments}
        loading={documents.isLoading}
        error={documents.error}
        page={docPage}
        total={documents.data?.total ?? 0}
        pageSize={documents.data?.page_size ?? 30}
        search={docSearch}
        onSearch={(value) => {
          setDocSearch(value)
          setDocPage(1)
        }}
        onClose={() => setSelectedId(null)}
        onUpload={() => setUploadOpen(true)}
        onDelete={setDocDeleteTarget}
        onOpenDetail={setDetailTarget}
        onPage={setDocPage}
        onTest={() => setSearchOpen(true)}
      />

      <ConfirmDialog
        open={Boolean(docDeleteTarget)}
        onOpenChange={(open) => !open && setDocDeleteTarget(null)}
        title='删除文档'
        desc={`将从知识库删除“${docDeleteTarget?.filename ?? ''}”及其索引。`}
        destructive
        confirmText='确认删除'
        isLoading={removeDocument.isPending}
        handleConfirm={() => docDeleteTarget && removeDocument.mutate(docDeleteTarget)}
      />

      {selected && (
        <KnowledgeSearchSheet
          open={searchOpen}
          onOpenChange={setSearchOpen}
          workspaceId={workspaceId}
          knowledgeBaseId={selected.id}
          knowledgeBaseName={selected.name}
        />
      )}
      {selected && detailTarget && (
        <DocumentDetailDialog
          key={detailTarget.id}
          workspaceId={workspaceId}
          knowledgeBaseId={selected.id}
          document={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </main>
  )
}

function SchemaFormControl({
  schema,
  values,
  onChange,
}: {
  schema: JsonSchema
  values: Record<string, SchemaValue>
  onChange: (key: string, value: SchemaValue) => void
}) {
  const entries = Object.entries(schema.properties ?? {}).filter(
    ([key, prop]) => prop.const === undefined && !['id', 'type'].includes(key)
  )
  if (entries.length === 0) {
    return <p className='text-sm text-muted-foreground'>该 chunker 没有可调参数。</p>
  }

  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      {entries.map(([key, prop]) => {
        const type = schemaType(prop)
        const options = schemaEnum(prop)
        const label = prop.title ?? key
        const required = schema.required?.includes(key)
        const fieldId = `chunker-${key}`
        const current = values[key]

        return (
          <label key={key} className='block space-y-1 text-sm' htmlFor={fieldId}>
            <span>
              {label}
              {required && <span className='text-destructive'> *</span>}
            </span>
            {type === 'boolean' ? (
              <Input
                id={fieldId}
                type='checkbox'
                checked={Boolean(current ?? prop.default)}
                onChange={(event) => onChange(key, event.target.checked)}
                className='size-4'
              />
            ) : options ? (
              <Select
                value={current == null ? String(prop.default ?? '') : String(current)}
                onValueChange={(value) => onChange(key, value)}
              >
                <SelectTrigger id={fieldId} className='w-full'>
                  <SelectValue placeholder={prop.description} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {String(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : type === 'number' || type === 'integer' ? (
              <Input
                id={fieldId}
                type='number'
                value={current == null ? '' : String(current)}
                min={prop.minimum ?? prop.exclusiveMinimum}
                max={prop.maximum ?? prop.exclusiveMaximum}
                step={type === 'integer' ? 1 : 'any'}
                placeholder={prop.default == null ? undefined : String(prop.default)}
                onChange={(event) => {
                  if (event.target.value === '') {
                    onChange(key, undefined)
                    return
                  }
                  const parsed =
                    type === 'integer'
                      ? parseInt(event.target.value, 10)
                      : parseFloat(event.target.value)
                  onChange(key, Number.isNaN(parsed) ? event.target.value : parsed)
                }}
              />
            ) : (
              <Input
                id={fieldId}
                value={current == null ? '' : String(current)}
                placeholder={prop.default == null ? undefined : String(prop.default)}
                onChange={(event) => onChange(key, event.target.value)}
              />
            )}
            {prop.description && (
              <span className='block text-xs text-muted-foreground'>{prop.description}</span>
            )}
          </label>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const terminal = isTerminalStatus(status)
  const Icon = status === 'ready' ? CheckCircle2 : status === 'error' ? AlertCircle : Loader2
  return (
    <Badge variant={status === 'error' ? 'destructive' : terminal ? 'secondary' : 'outline'}>
      <Icon className={`size-3 ${terminal ? '' : 'animate-spin'}`} />
      {status}
    </Badge>
  )
}

function DocumentDialog({
  base,
  documents,
  loading,
  error,
  page,
  total,
  pageSize,
  search,
  onSearch,
  onClose,
  onUpload,
  onDelete,
  onOpenDetail,
  onPage,
  onTest,
}: {
  base: KnowledgeBaseView | null
  documents: KnowledgeDocumentView[]
  loading: boolean
  error: unknown
  page: number
  total: number
  pageSize: number
  search: string
  onSearch: (value: string) => void
  onClose: () => void
  onUpload: () => void
  onDelete: (value: KnowledgeDocumentView) => void
  onOpenDetail: (value: KnowledgeDocumentView) => void
  onPage: (value: number) => void
  onTest: () => void
}) {
  return (
    <Dialog open={Boolean(base)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[min(85vh,52rem)] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>知识库文档：{base?.name ?? ''}</DialogTitle>
          <DialogDescription>
            查看索引状态、chunk、原始文件预览，或对知识库执行检索测试。
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <SearchBox value={search} onChange={onSearch} placeholder='按文件名搜索' />
            <div className='flex gap-2'>
              <Button type='button' variant='outline' onClick={onTest}>
                <FlaskConical className='mr-2 size-4' />
                检索测试
              </Button>
              <Button type='button' variant='outline' onClick={onUpload} disabled={!base?.editable}>
                <Upload className='mr-2 size-4' />
                上传
              </Button>
            </div>
          </div>
          {loading ? (
            <ResourceLoading />
          ) : error ? (
            <ResourceError error={error} />
          ) : documents.length ? (
            <div className='overflow-x-auto'>
              <table className='w-full text-left text-xs'>
                <thead>
                  <tr className='border-b'>
                    <th className='p-2'>文件</th>
                    <th className='p-2'>状态</th>
                    <th className='p-2'>大小 / Chunk</th>
                    <th className='p-2'>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((item) => (
                    <tr key={item.id} className='border-b last:border-0'>
                      <td className='p-2'>
                        <button
                          type='button'
                          className='font-medium underline underline-offset-4 disabled:no-underline disabled:opacity-60'
                          disabled={item.status !== 'ready'}
                          onClick={() => onOpenDetail(item)}
                        >
                          {item.filename}
                        </button>
                        <span className='block text-muted-foreground'>
                          {formatDate(item.updated_at)}
                        </span>
                      </td>
                      <td className='p-2'>
                        <StatusBadge status={item.status} />
                        {item.error && <span className='block text-destructive'>{item.error}</span>}
                      </td>
                      <td className='p-2'>
                        {formatBytes(item.size)}
                        <span className='block text-muted-foreground'>
                          {item.chunk_count} chunks
                        </span>
                      </td>
                      <td className='space-x-3 whitespace-nowrap p-2'>
                        <button
                          type='button'
                          className='underline disabled:opacity-60'
                          disabled={item.status !== 'ready'}
                          onClick={() => onOpenDetail(item)}
                        >
                          <Eye className='mr-1 inline size-3' />
                          详情
                        </button>
                        <button
                          type='button'
                          className='text-destructive underline disabled:opacity-60'
                          disabled={!base?.editable}
                          onClick={() => onDelete(item)}
                        >
                          <Trash2 className='mr-1 inline size-3' />
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>暂无文档。</EmptyState>
          )}
          <div className='flex justify-end gap-2'>
            <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)}>
              上一页
            </PageButton>
            <PageButton disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>
              下一页
            </PageButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KnowledgeSearchSheet({
  open,
  onOpenChange,
  workspaceId,
  knowledgeBaseId,
  knowledgeBaseName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  knowledgeBaseId: string
  knowledgeBaseName: string
}) {
  const [query, setQuery] = React.useState('')
  const [topK, setTopK] = React.useState(5)
  const search = useMutation({
    mutationFn: () =>
      searchKnowledge(workspaceId, knowledgeBaseId, {
        query: query.trim(),
        top_k: topK,
      }),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-0 sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            <FlaskConical className='size-4' />
            检索测试
          </SheetTitle>
          <SheetDescription className='truncate'>{knowledgeBaseName}</SheetDescription>
        </SheetHeader>
        <form
          className='space-y-3 px-4'
          onSubmit={(event) => {
            event.preventDefault()
            if (query.trim()) search.mutate()
          }}
        >
          <label className='block space-y-1 text-sm'>
            查询
            <Textarea
              value={query}
              rows={3}
              onChange={(event) => setQuery(event.target.value)}
              disabled={search.isPending}
            />
          </label>
          <div className='flex items-end gap-3'>
            <label className='space-y-1 text-sm'>
              Top K
              <Input
                type='number'
                min={1}
                max={50}
                value={topK}
                className='w-24'
                onChange={(event) =>
                  setTopK(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
                }
              />
            </label>
            <Button
              type='submit'
              className='ml-auto'
              disabled={search.isPending || !query.trim()}
            >
              {search.isPending ? (
                <Loader2 className='mr-2 size-4 animate-spin' />
              ) : (
                <Search className='mr-2 size-4' />
              )}
              搜索
            </Button>
          </div>
          {search.isError && <ResourceError error={search.error} />}
        </form>
        <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-4'>
          {search.data && search.data.results.length === 0 && (
            <EmptyState>没有匹配的 chunk。</EmptyState>
          )}
          {search.data?.results.map((hit, index) => (
            <article
              key={`${hit.document_id}-${hit.chunk.chunk_index}-${index}`}
              className='rounded-lg border p-3'
            >
              <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                <Badge variant='secondary'>#{index + 1}</Badge>
                <Badge variant='outline'>score {hit.score.toFixed(4)}</Badge>
                <span className='max-w-full truncate'>{hit.chunk.source}</span>
              </div>
              <p className='whitespace-pre-wrap break-words text-sm'>
                {chunkText(hit.chunk.content)}
              </p>
              <p className='mt-2 text-xs text-muted-foreground'>
                chunk {hit.chunk.chunk_index + 1} / {hit.chunk.total_chunks}
              </p>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DocumentDetailDialog({
  workspaceId,
  knowledgeBaseId,
  document,
  onClose,
}: {
  workspaceId: string
  knowledgeBaseId: string
  document: KnowledgeDocumentView
  onClose: () => void
}) {
  const [chunkPage, setChunkPage] = React.useState(1)

  const chunks = useQuery({
    queryKey: [
      'agentscope',
      workspaceId,
      'knowledge-document-chunks',
      knowledgeBaseId,
      document.id,
      chunkPage,
    ],
    queryFn: () => listDocumentChunks(workspaceId, knowledgeBaseId, document.id, chunkPage),
  })
  const media = mediaType(document)
  const isTextType = media === 'text/markdown' || media === 'text/plain'
  const isPdf = media === 'application/pdf'
  const isImage = INLINE_IMAGE_TYPES.includes(media)
  const tooLarge = isTextType && document.size > MAX_INLINE_TEXT_BYTES
  const preview = useQuery({
    queryKey: [
      'agentscope',
      workspaceId,
      'knowledge-document-preview',
      knowledgeBaseId,
      document.id,
      media,
      isTextType,
      tooLarge,
      isPdf,
      isImage,
    ],
    queryFn: async () => {
      if (isTextType && !tooLarge) {
        return {
          kind: 'text' as const,
          text: await fetchDocumentText(workspaceId, knowledgeBaseId, document.id),
        }
      }
      if (isPdf || isImage) {
        const token = await createDownloadToken(workspaceId, knowledgeBaseId, document.id)
        return {
          kind: media.startsWith('image/') ? ('image' as const) : ('pdf' as const),
          url: documentContentUrl(knowledgeBaseId, document.id, token.token),
        }
      }
      return { kind: 'unsupported' as const }
    },
  })
  const download = useMutation({
    mutationFn: async () => {
      const token = await createDownloadToken(workspaceId, knowledgeBaseId, document.id)
      const url = documentContentUrl(knowledgeBaseId, document.id, token.token)
      window.open(`${url}&download=true`, '_blank', 'noopener')
    },
  })
  const chunkUnsupported = chunks.error instanceof ApiProblem && chunks.error.status === 501

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[min(88vh,56rem)] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <FileText className='size-4 shrink-0' />
            <span className='truncate'>{document.filename}</span>
          </DialogTitle>
          <DialogDescription>
            {formatBytes(document.size)} · {document.chunk_count} chunks ·{' '}
            {formatDate(document.updated_at)}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue='chunks' className='gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <TabsList>
              <TabsTrigger value='chunks'>Chunks</TabsTrigger>
              <TabsTrigger value='preview'>预览</TabsTrigger>
            </TabsList>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={download.isPending}
              onClick={() => download.mutate()}
            >
              {download.isPending ? (
                <Loader2 className='mr-2 size-3.5 animate-spin' />
              ) : (
                <Download className='mr-2 size-3.5' />
              )}
              下载
            </Button>
          </div>
          <TabsContent value='chunks' className='min-h-64 space-y-3'>
            {chunks.isLoading ? (
              <ResourceLoading />
            ) : chunkUnsupported ? (
              <EmptyState>当前向量存储不支持列出 chunks。</EmptyState>
            ) : chunks.isError ? (
              <ResourceError error={chunks.error} />
            ) : chunks.data?.chunks.length ? (
              <>
                {chunks.data.chunks.map((chunk) => (
                  <article key={chunk.chunk_index} className='rounded-lg border p-3'>
                    <Badge variant='secondary' className='mb-2 font-mono'>
                      chunk {chunk.chunk_index + 1} / {chunk.total_chunks}
                    </Badge>
                    <p className='whitespace-pre-wrap break-words text-sm'>
                      {chunkText(chunk.content)}
                    </p>
                    <p className='mt-2 truncate text-xs text-muted-foreground'>{chunk.source}</p>
                  </article>
                ))}
                <div className='flex items-center justify-end gap-2'>
                  <PageButton
                    disabled={chunkPage <= 1 || chunks.isFetching}
                    onClick={() => setChunkPage((value) => value - 1)}
                  >
                    上一页
                  </PageButton>
                  <span className='text-xs text-muted-foreground'>
                    第 {chunks.data.page} /{' '}
                    {Math.max(1, Math.ceil(chunks.data.total / CHUNK_PAGE_SIZE))} 页
                  </span>
                  <PageButton
                    disabled={
                      chunkPage * CHUNK_PAGE_SIZE >= chunks.data.total || chunks.isFetching
                    }
                    onClick={() => setChunkPage((value) => value + 1)}
                  >
                    下一页
                  </PageButton>
                </div>
              </>
            ) : (
              <EmptyState>暂无 chunk。</EmptyState>
            )}
          </TabsContent>
          <TabsContent value='preview' className='min-h-64'>
            {preview.isLoading ? (
              <ResourceLoading />
            ) : preview.isError ? (
              <ResourceError error={preview.error} />
            ) : preview.data?.kind === 'text' ? (
              <pre className='max-h-[60vh] overflow-auto rounded-lg border p-4 text-xs whitespace-pre-wrap'>
                {preview.data.text}
              </pre>
            ) : preview.data?.kind === 'image' ? (
              <img
                src={preview.data.url}
                alt={document.filename}
                className='max-h-[60vh] max-w-full'
              />
            ) : preview.data?.kind === 'pdf' ? (
              <iframe
                src={preview.data.url}
                title={document.filename}
                className='h-[60vh] w-full rounded-lg border'
              />
            ) : (
              <EmptyState>
                {tooLarge
                  ? '文本文件超过 2 MiB，为避免浏览器卡顿已停用内联预览。'
                  : '该文件类型暂不支持内联预览，可下载查看。'}
              </EmptyState>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

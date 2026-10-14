import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BookText, Loader2, Plug, SlidersHorizontal } from 'lucide-react'
import {
  listKnowledgeBases,
  listMcps,
  listSkills,
} from '@/api/agentscope-resources'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { LocalizedText } from '@/components/localized-text'
import type { Workspace } from '@/features/workspaces/types'
import {
  addSessionMcpsFromLibrary,
  addSessionSkillsFromLibrary,
  listCredentialModelGroups,
  listKnowledgeMiddlewareSchema,
  listRealtimeModelGroups,
  listSessionMcps,
  listSessionSkills,
  removeSessionMcp,
  removeSessionSkill,
} from '../api'
import type {
  CredentialWithModels,
  CredentialWithRealtimeModels,
  JSONSchema,
  JSONSchemaProperty,
  LibraryResource,
  ModelConfig,
  ModelParameters,
  RealtimeModelCard,
  SessionConfigPatch,
  SessionConfigView,
} from '../types'

const modelId = (config: ModelConfig) =>
  [config.type, config.credential_id, config.model].join('\u0000')

const parseModelId = (
  value: string
): Omit<ModelConfig, 'parameters'> | null => {
  const [type, credentialId, model] = value.split('\u0000')
  return type && credentialId && model
    ? { type, credential_id: credentialId, model }
    : null
}

const flattenGroups = (groups: Record<string, CredentialWithModels[]>) =>
  Object.values(groups).flatMap((entries) => entries)

const findModelCard = (
  groups: Record<string, CredentialWithModels[]>,
  config: ModelConfig | null | undefined
) =>
  config
    ? (flattenGroups(groups)
        .find(({ credential }) => credential.id === config.credential_id)
        ?.models.find((model) => model.name === config.model) ?? null)
    : null

const firstChatModel = (
  groups: Record<string, CredentialWithModels[]>
): ModelConfig | null => {
  const entry = flattenGroups(groups).find(({ models }) => models.length)
  const model = entry?.models[0]
  if (!entry || !model) return null
  return {
    type: String(entry.credential.data.type ?? ''),
    credential_id: entry.credential.id,
    model: model.name,
    parameters: extractDefaults(model.parameter_schema),
  }
}

function asSchema(value: unknown): JSONSchema | null {
  return value && typeof value === 'object' && 'properties' in value
    ? (value as JSONSchema)
    : null
}

function extractDefaults(schemaValue: unknown): ModelParameters {
  const schema = asSchema(schemaValue)
  const defaults: ModelParameters = {}
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    if (property.default !== undefined) defaults[key] = property.default
  }
  return defaults
}

function resolveProperty(property: JSONSchemaProperty): {
  type: string
  enumValues: unknown[] | null
} {
  if (property.type && property.type !== 'null')
    return { type: property.type, enumValues: property.enum ?? null }
  const variant = property.anyOf?.find(
    (item) => item.type && item.type !== 'null'
  )
  if (variant?.type)
    return {
      type: variant.type,
      enumValues: variant.enum ?? property.enum ?? null,
    }
  return { type: 'string', enumValues: property.enum ?? null }
}

const propertyLabel = (key: string, property: JSONSchemaProperty) =>
  property.title ?? key.replace(/_/g, ' ')

function ParameterFields({
  idPrefix,
  schema,
  values,
  onChange,
}: {
  idPrefix: string
  schema: JSONSchema | null
  values: ModelParameters
  onChange: (next: ModelParameters) => void
}) {
  const entries = Object.entries(schema?.properties ?? {})
  if (!entries.length)
    return (
      <p className='text-sm text-muted-foreground'>
        <LocalizedText text={'当前模型没有可配置参数。'} />
      </p>
    )

  const update = (key: string, value: unknown) => {
    const next = { ...values }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next)
  }

  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      {entries.map(([key, property]) => {
        const id = `${idPrefix}-${key}`
        const label = propertyLabel(key, property)
        const { type, enumValues } = resolveProperty(property)
        const value = values[key]
        let control: React.ReactNode
        if (type === 'boolean') {
          control = (
            <Switch
              id={id}
              checked={
                value !== undefined ? Boolean(value) : Boolean(property.default)
              }
              onCheckedChange={(checked) => update(key, checked)}
            />
          )
        } else if (enumValues?.length) {
          const display =
            value === undefined || value === null ? '' : String(value)
          control = (
            <LocalizedNativeSelect
              id={id}
              className='h-9 w-full rounded-md border bg-background px-2 text-sm'
              value={display}
              onChange={(event) =>
                update(
                  key,
                  event.target.value === '' ? undefined : event.target.value
                )
              }
            >
              <option value=''>
                <LocalizedText text={'使用默认值'} />
              </option>
              {enumValues.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </LocalizedNativeSelect>
          )
        } else if (type === 'number' || type === 'integer') {
          control = (
            <Input
              id={id}
              type='number'
              min={property.minimum}
              max={property.maximum}
              step={type === 'integer' ? 1 : 'any'}
              value={value === undefined || value === null ? '' : String(value)}
              placeholder={
                property.default === undefined || property.default === null
                  ? undefined
                  : String(property.default)
              }
              onChange={(event) => {
                if (event.target.value === '') {
                  update(key, undefined)
                  return
                }
                const parsed =
                  type === 'integer'
                    ? Number.parseInt(event.target.value, 10)
                    : Number(event.target.value)
                if (!Number.isNaN(parsed)) update(key, parsed)
              }}
            />
          )
        } else if (type === 'array' || type === 'object') {
          control = (
            <ArrayParameterInput
              key={JSON.stringify(value)}
              id={id}
              value={value}
              onChange={(next) => update(key, next)}
            />
          )
        } else {
          control = (
            <Input
              id={id}
              value={value === undefined || value === null ? '' : String(value)}
              placeholder={
                property.default === undefined || property.default === null
                  ? undefined
                  : String(property.default)
              }
              onChange={(event) => update(key, event.target.value)}
            />
          )
        }
        return (
          <div key={key} className='space-y-1.5'>
            <Label
              htmlFor={id}
              className='flex items-baseline justify-between gap-2'
            >
              <span>{label}</span>
              {property.description ? (
                <span className='text-xs font-normal text-muted-foreground'>
                  {property.description}
                </span>
              ) : null}
            </Label>
            {control}
          </div>
        )
      })}
    </div>
  )
}

function ArrayParameterInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (next: unknown) => void
}) {
  const [draft, setDraft] = React.useState(() =>
    value === undefined ? '' : JSON.stringify(value, null, 2)
  )
  const [error, setError] = React.useState('')
  return (
    <div className='space-y-1'>
      <textarea
        id={id}
        className='min-h-20 w-full rounded-md border bg-background p-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value)
          if (!event.target.value.trim()) {
            setError('')
            onChange(undefined)
            return
          }
          try {
            onChange(JSON.parse(event.target.value))
            setError('')
          } catch {
            setError('JSON 格式无效')
          }
        }}
      />
      {error ? <p className='text-xs text-destructive'>{error}</p> : null}
    </div>
  )
}

function ModelSelect({
  id,
  groups,
  value,
  loading,
  disabled,
  emptyLabel,
  onChange,
}: {
  id: string
  groups: Record<string, CredentialWithModels[]>
  value: ModelConfig | null
  loading: boolean
  disabled: boolean
  emptyLabel: string
  onChange: (config: ModelConfig | null) => void
}) {
  const selectedKey = value ? modelId(value) : ''
  const entries = flattenGroups(groups)
  const selectedMissing =
    Boolean(value) &&
    !entries.some(
      ({ credential, models }) =>
        value &&
        credential.id === value.credential_id &&
        models.some((model) => model.name === value.model)
    )
  return (
    <Select
      value={selectedKey}
      onValueChange={(next) => {
        if (!next) {
          onChange(null)
          return
        }
        const base = parseModelId(next)
        if (!base) return
        const model = entries
          .find(({ credential }) => credential.id === base.credential_id)
          ?.models.find((item) => item.name === base.model)
        onChange({
          ...base,
          parameters: extractDefaults(model?.parameter_schema),
        })
      }}
    >
      <SelectTrigger id={id} className='w-full' disabled={disabled || loading}>
        <SelectValue placeholder={loading ? '正在加载模型…' : emptyLabel} />
      </SelectTrigger>
      <SelectContent className='max-h-72'>
        {selectedMissing && value ? (
          <SelectItem value={selectedKey}>
            {value.model}
            <LocalizedText text={'（凭据或模型已不可用）'} />
          </SelectItem>
        ) : null}
        {Object.entries(groups).map(([provider, providerEntries]) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider}</SelectLabel>
            {providerEntries.map(({ credential, models }) => (
              <SelectGroup key={credential.id}>
                <SelectLabel className='text-xs'>
                  {credential.data.name || credential.id}
                </SelectLabel>
                {models.map((model) => {
                  const key = modelId({
                    type: provider,
                    credential_id: credential.id,
                    model: model.name,
                    parameters: {},
                  })
                  return (
                    <SelectItem key={key} value={key}>
                      {model.label || model.name}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            ))}
          </SelectGroup>
        ))}
        {!Object.keys(groups).length && !loading ? (
          <div className='px-2 py-3 text-sm text-muted-foreground'>
            <LocalizedText text={'没有可用模型，请先配置凭据。'} />
          </div>
        ) : null}
      </SelectContent>
    </Select>
  )
}

function RealtimeModelSelect({
  id,
  groups,
  value,
  loading,
  disabled,
  emptyLabel,
  onChange,
}: {
  id: string
  groups: Record<string, CredentialWithRealtimeModels[]>
  value: ModelConfig | null
  loading: boolean
  disabled: boolean
  emptyLabel: string
  onChange: (config: ModelConfig | null) => void
}) {
  const selectedKey = value ? modelId(value) : ''
  const entries = Object.values(groups).flatMap((items) => items)
  const selectedMissing =
    Boolean(value) &&
    !entries.some(
      ({ credential, models }) =>
        value &&
        credential.id === value.credential_id &&
        models.some(
          (model) =>
            model.name === value.model && model.model_type === value.type
        )
    )

  return (
    <Select
      value={selectedKey}
      onValueChange={(next) => {
        const [type, credentialId, modelName] = next.split('\u0000')
        if (!type || !credentialId || !modelName) return
        const model = entries
          .find(({ credential }) => credential.id === credentialId)
          ?.models.find(
            (item) => item.name === modelName && item.model_type === type
          )
        if (!model) return
        onChange({
          type: model.model_type,
          credential_id: credentialId,
          model: model.name,
          parameters: extractDefaults(model.parameter_schema),
        })
      }}
    >
      <SelectTrigger id={id} className='w-full' disabled={disabled || loading}>
        <SelectValue
          placeholder={loading ? '正在加载实时语音模型…' : emptyLabel}
        />
      </SelectTrigger>
      <SelectContent className='max-h-72'>
        {selectedMissing && value ? (
          <SelectItem value={selectedKey}>
            {value.model}
            <LocalizedText text={'（模型或凭据已不可用）'} />
          </SelectItem>
        ) : null}
        {Object.entries(groups).map(([provider, providerEntries]) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider}</SelectLabel>
            {providerEntries.map(({ credential, models }) => (
              <SelectGroup key={credential.id}>
                <SelectLabel className='text-xs'>
                  {credential.data.name || credential.id}
                </SelectLabel>
                {models.map((model) => {
                  const key = modelId({
                    type: model.model_type,
                    credential_id: credential.id,
                    model: model.name,
                    parameters: {},
                  })
                  return (
                    <SelectItem key={key} value={key}>
                      {model.label || model.name}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            ))}
          </SelectGroup>
        ))}
        {!Object.keys(groups).length && !loading ? (
          <div className='px-2 py-3 text-sm text-muted-foreground'>
            <LocalizedText text={'没有可用实时语音模型，请先配置凭据。'} />
          </div>
        ) : null}
      </SelectContent>
    </Select>
  )
}

function findRealtimeModelCard(
  groups: Record<string, CredentialWithRealtimeModels[]>,
  config: ModelConfig | null | undefined
): RealtimeModelCard | null {
  if (!config) return null
  return (
    Object.values(groups)
      .flatMap((entries) => entries)
      .find(({ credential }) => credential.id === config.credential_id)
      ?.models.find(
        (model) =>
          model.name === config.model && model.model_type === config.type
      ) ?? null
  )
}

function ParameterPopover({
  schema,
  values,
  title,
  description,
  disabled,
  onApply,
}: {
  schema: JSONSchema | null
  values: ModelParameters
  title: string
  description: string
  disabled: boolean
  onApply: (next: ModelParameters) => void
}) {
  const [draft, setDraft] = React.useState(values)
  const dirty = JSON.stringify(draft) !== JSON.stringify(values)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          disabled={disabled}
          aria-label={title}
          title={title}
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='max-h-[28rem] w-[32rem] overflow-y-auto'
      >
        <div className='space-y-3'>
          <div>
            <p className='text-sm font-medium'>{title}</p>
            <p className='text-xs text-muted-foreground'>{description}</p>
          </div>
          <ParameterFields
            idPrefix='session-parameter'
            schema={schema}
            values={draft}
            onChange={setDraft}
          />
          <Button size='sm' disabled={!dirty} onClick={() => onApply(draft)}>
            <LocalizedText text={'应用参数'} />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ResourceSelector({
  icon,
  title,
  description,
  resources,
  selectedNames,
  loading,
  disabled,
  busyName,
  error,
  onToggle,
}: {
  icon: React.ReactNode
  title: string
  description: string
  resources: LibraryResource[]
  selectedNames: Set<string>
  loading: boolean
  disabled: boolean
  busyName: string | null
  error: string
  onToggle: (resource: LibraryResource, checked: boolean) => Promise<void>
}) {
  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <header className='flex items-start gap-3'>
        <span className='mt-0.5 text-muted-foreground'>{icon}</span>
        <div>
          <h3 className='text-sm font-medium'>{title}</h3>
          <p className='text-xs text-muted-foreground'>{description}</p>
        </div>
      </header>
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <p className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='size-4 animate-spin' />
          <LocalizedText text={'正在加载…'} />
        </p>
      ) : resources.length ? (
        <div className='max-h-56 space-y-2 overflow-y-auto'>
          {resources.map((resource) => {
            const checked = selectedNames.has(resource.name)
            const id = `${title}-${resource.id}`
            return (
              <label
                key={resource.id}
                htmlFor={id}
                className='flex items-start gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-accent'
              >
                <Checkbox
                  id={id}
                  className='mt-0.5'
                  checked={checked}
                  disabled={
                    disabled || !resource.enabled || busyName === resource.name
                  }
                  onCheckedChange={(next) =>
                    void onToggle(resource, next === true)
                  }
                />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium'>
                    {resource.display_name || resource.name}
                    {!resource.enabled ? '（已停用）' : ''}
                  </span>
                  <span className='mt-0.5 line-clamp-2 block text-xs text-muted-foreground'>
                    {resource.description || resource.name}
                  </span>
                </span>
                {busyName === resource.name ? (
                  <Loader2 className='mt-0.5 size-4 animate-spin text-muted-foreground' />
                ) : null}
              </label>
            )
          })}
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          <LocalizedText text={'当前 Workspace 没有可选项。'} />
        </p>
      )}
    </section>
  )
}

export function SessionConfigPanel({
  actorId,
  workspace,
  agentId,
  sessionId,
  config,
  pending,
  error,
  disabled,
  onPatch,
}: {
  actorId: string
  workspace: Workspace
  agentId: string
  sessionId: string
  config: SessionConfigView
  pending: boolean
  error: unknown
  disabled: boolean
  onPatch: (patch: SessionConfigPatch) => Promise<void>
}) {
  const scopeKey = React.useMemo(
    () =>
      [
        'synapse',
        actorId,
        workspace.tenant_id,
        workspace.workspace_id,
        workspace.membership_version ?? 0,
      ] as const,
    [
      actorId,
      workspace.tenant_id,
      workspace.workspace_id,
      workspace.membership_version,
    ]
  )
  const chatModels = useQuery({
    queryKey: [...scopeKey, 'agent-scope-chat-models', workspace],
    queryFn: () => listCredentialModelGroups(workspace, 'chat'),
    enabled: workspace.status === 'active',
  })
  const ttsModels = useQuery({
    queryKey: [...scopeKey, 'agent-scope-tts-models', workspace],
    queryFn: () => listCredentialModelGroups(workspace, 'tts'),
    enabled: workspace.status === 'active',
  })
  const realtimeModels = useQuery({
    queryKey: [...scopeKey, 'agent-scope-realtime-models', workspace],
    queryFn: () => listRealtimeModelGroups(workspace),
    enabled: workspace.status === 'active',
  })
  const knowledgeBases = useQuery({
    queryKey: [
      ...scopeKey,
      'agent-scope-knowledge-bases',
      workspace.workspace_id,
    ],
    queryFn: () =>
      listKnowledgeBases(workspace.workspace_id, { page: 1, pageSize: 100 }),
    enabled: workspace.status === 'active',
  })
  const middlewareSchema = useQuery({
    queryKey: [...scopeKey, 'agent-scope-knowledge-middleware', workspace],
    queryFn: () => listKnowledgeMiddlewareSchema(workspace),
    enabled: workspace.status === 'active',
  })
  const libraryMcps = useQuery({
    queryKey: [...scopeKey, 'agent-scope-mcp-library', workspace.workspace_id],
    queryFn: () => listMcps(workspace.workspace_id),
    enabled: workspace.status === 'active',
  })
  const librarySkills = useQuery({
    queryKey: [
      ...scopeKey,
      'agent-scope-skill-library',
      workspace.workspace_id,
    ],
    queryFn: () => listSkills(workspace.workspace_id),
    enabled: workspace.status === 'active',
  })
  const sessionMcps = useQuery({
    queryKey: [...scopeKey, agentId, sessionId, 'workspace-mcp', workspace],
    queryFn: () => listSessionMcps(workspace, agentId, sessionId),
    enabled: workspace.status === 'active' && !disabled,
  })
  const sessionSkills = useQuery({
    queryKey: [...scopeKey, agentId, sessionId, 'workspace-skill', workspace],
    queryFn: () => listSessionSkills(workspace, agentId, sessionId),
    enabled: workspace.status === 'active' && !disabled,
  })
  const [resourceBusy, setResourceBusy] = React.useState<string | null>(null)
  const [resourceError, setResourceError] = React.useState('')
  const autoModelRef = React.useRef('')

  const chatModel = config.chat_model_config ?? null
  const chatCard = findModelCard(chatModels.data ?? {}, chatModel)
  const ttsModel = config.tts_model_config ?? null
  const ttsCard = findModelCard(ttsModels.data ?? {}, ttsModel)
  const realtimeModel = config.realtime_model_config ?? null
  const realtimeCard = findRealtimeModelCard(
    realtimeModels.data ?? {},
    realtimeModel
  )
  const knowledgeConfig = config.knowledge_config ?? null
  const selectedMcpNames = new Set(
    (sessionMcps.data ?? []).map((item) => item.name)
  )
  const selectedSkillNames = new Set(
    (sessionSkills.data ?? []).map((item) => item.name)
  )

  React.useEffect(() => {
    if (
      disabled ||
      pending ||
      !chatModels.data ||
      chatModel ||
      autoModelRef.current === sessionId
    )
      return
    const first = firstChatModel(chatModels.data)
    if (!first) return
    autoModelRef.current = sessionId
    void onPatch({ chat_model_config: first })
  }, [chatModel, chatModels.data, disabled, onPatch, pending, sessionId])

  const patchModel = (next: ModelConfig | null, field: 'chat_model_config') => {
    if (next) void onPatch({ [field]: next })
  }

  const toggleKnowledgeBase = (id: string, checked: boolean) => {
    const ids = new Set(knowledgeConfig?.knowledge_base_ids ?? [])
    if (checked) ids.add(id)
    else ids.delete(id)
    if (!ids.size) {
      void onPatch({ knowledge_config: null })
      return
    }
    void onPatch({
      knowledge_config: {
        knowledge_base_ids: [...ids],
        parameters: knowledgeConfig?.parameters ?? {},
      },
    })
  }

  const toggleResource = async (
    kind: 'mcp' | 'skill',
    resource: LibraryResource,
    checked: boolean
  ) => {
    setResourceError('')
    setResourceBusy(resource.name)
    try {
      if (checked) {
        if (kind === 'mcp')
          await addSessionMcpsFromLibrary(workspace, agentId, sessionId, [
            resource.id,
          ])
        else
          await addSessionSkillsFromLibrary(workspace, agentId, sessionId, [
            resource.id,
          ])
      } else if (kind === 'mcp') {
        await removeSessionMcp(workspace, agentId, sessionId, resource.name)
      } else {
        await removeSessionSkill(workspace, agentId, sessionId, resource.name)
      }
      await Promise.all([
        kind === 'mcp' ? sessionMcps.refetch() : sessionSkills.refetch(),
        kind === 'mcp' ? libraryMcps.refetch() : librarySkills.refetch(),
      ])
    } catch (nextError) {
      setResourceError(
        nextError instanceof Error
          ? nextError.message
          : '资源选择失败，请重试。'
      )
    } finally {
      setResourceBusy(null)
    }
  }

  const modelError =
    error ??
    chatModels.error ??
    ttsModels.error ??
    realtimeModels.error ??
    knowledgeBases.error ??
    middlewareSchema.error

  return (
    <section className='rounded-xl border bg-card'>
      <Tabs defaultValue='models'>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
          <div>
            <h2 className='font-semibold'>
              <LocalizedText text={'会话能力配置'} />
            </h2>
            <p className='text-xs text-muted-foreground'>
              <LocalizedText
                text={
                  '模型、知识库和会话级 MCP / Skill 均使用当前 Workspace 凭据。'
                }
              />
            </p>
          </div>
          <TabsList>
            <TabsTrigger value='models'>
              <LocalizedText text={'模型'} />
            </TabsTrigger>
            <TabsTrigger value='knowledge'>
              <LocalizedText text={'知识'} />
            </TabsTrigger>
            <TabsTrigger value='tools'>
              <LocalizedText text={'工具'} />
            </TabsTrigger>
          </TabsList>
        </div>
        <div className='p-4'>
          {modelError ? (
            <Alert variant='destructive' className='mb-4'>
              <AlertDescription>
                {modelError instanceof Error
                  ? modelError.message
                  : '配置读取或保存失败，请重试。'}
              </AlertDescription>
            </Alert>
          ) : null}
          <TabsContent value='models' className='mt-0 space-y-4'>
            <div className='grid gap-4 lg:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='session-chat-model'>
                  <LocalizedText text={'主模型'} />
                </Label>
                <ModelSelect
                  id='session-chat-model'
                  groups={chatModels.data ?? {}}
                  value={chatModel}
                  loading={chatModels.isLoading}
                  disabled={disabled || pending}
                  emptyLabel='选择主模型'
                  onChange={(next) => patchModel(next, 'chat_model_config')}
                />
                <p className='text-xs text-muted-foreground'>
                  {chatCard?.context_size
                    ? `${chatCard.context_size} context · ${chatCard.output_size ?? '—'} output`
                    : '主模型为空时不能发送消息。'}
                </p>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='session-fallback-model'>
                  <LocalizedText text={'Fallback 模型'} />
                </Label>
                <ModelSelect
                  id='session-fallback-model'
                  groups={chatModels.data ?? {}}
                  value={config.fallback_chat_model_config ?? null}
                  loading={chatModels.isLoading}
                  disabled={disabled || pending}
                  emptyLabel='主模型失败时不切换'
                  onChange={(next) =>
                    void onPatch({ fallback_chat_model_config: next })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='session-tts-model'>
                  <LocalizedText text={'TTS 模型'} />
                </Label>
                <ModelSelect
                  id='session-tts-model'
                  groups={ttsModels.data ?? {}}
                  value={ttsModel}
                  loading={ttsModels.isLoading}
                  disabled={disabled || pending}
                  emptyLabel='不启用 TTS'
                  onChange={(next) => void onPatch({ tts_model_config: next })}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='session-realtime-model'>
                  <LocalizedText text={'实时语音模型'} />
                </Label>
                <RealtimeModelSelect
                  id='session-realtime-model'
                  groups={realtimeModels.data ?? {}}
                  value={realtimeModel}
                  loading={realtimeModels.isLoading}
                  disabled={disabled || pending}
                  emptyLabel='不启用实时语音'
                  onChange={(next) =>
                    void onPatch({ realtime_model_config: next })
                  }
                />
                <p className='text-xs text-muted-foreground'>
                  <LocalizedText
                    text={
                      realtimeModel
                        ? '配置后可在消息区开启浏览器麦克风语音对话。'
                        : '需要配置支持 Realtime 的凭据后才能开启语音对话。'
                    }
                  />
                </p>
              </div>
              <div className='space-y-2'>
                <span className='text-sm font-medium'>
                  <LocalizedText text={'模型参数'} />
                </span>
                <div className='flex flex-wrap gap-2'>
                  <ParameterPopover
                    key={`chat-parameters-${JSON.stringify(
                      chatModel?.parameters ?? {}
                    )}-${chatModel?.model ?? ''}`}
                    schema={asSchema(chatCard?.parameter_schema)}
                    values={chatModel?.parameters ?? {}}
                    title='主模型参数'
                    description='按模型 schema 保存推理参数。'
                    disabled={disabled || pending || !chatModel}
                    onApply={(parameters) =>
                      chatModel &&
                      void onPatch({
                        chat_model_config: { ...chatModel, parameters },
                      })
                    }
                  />
                  <ParameterPopover
                    key={`tts-parameters-${JSON.stringify(
                      ttsModel?.parameters ?? {}
                    )}-${ttsModel?.model ?? ''}`}
                    schema={asSchema(ttsCard?.parameter_schema)}
                    values={ttsModel?.parameters ?? {}}
                    title='TTS 参数'
                    description='按 TTS 模型 schema 保存语音参数。'
                    disabled={disabled || pending || !ttsModel}
                    onApply={(parameters) =>
                      ttsModel &&
                      void onPatch({
                        tts_model_config: { ...ttsModel, parameters },
                      })
                    }
                  />
                  <ParameterPopover
                    key={`realtime-parameters-${JSON.stringify(
                      realtimeModel?.parameters ?? {}
                    )}-${realtimeModel?.model ?? ''}`}
                    schema={asSchema(realtimeCard?.parameter_schema)}
                    values={realtimeModel?.parameters ?? {}}
                    title='实时语音参数'
                    description='按实时语音模型 schema 保存语音参数。'
                    disabled={disabled || pending || !realtimeModel}
                    onApply={(parameters) =>
                      realtimeModel &&
                      void onPatch({
                        realtime_model_config: {
                          ...realtimeModel,
                          parameters,
                        },
                      })
                    }
                  />
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={
                      disabled || pending || !config.fallback_chat_model_config
                    }
                    onClick={() =>
                      void onPatch({ fallback_chat_model_config: null })
                    }
                  >
                    <LocalizedText text={'清除 Fallback'} />
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={disabled || pending || !ttsModel}
                    onClick={() => void onPatch({ tts_model_config: null })}
                  >
                    <LocalizedText text={'关闭 TTS'} />
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={disabled || pending || !realtimeModel}
                    onClick={() =>
                      void onPatch({ realtime_model_config: null })
                    }
                  >
                    <LocalizedText text={'关闭实时语音'} />
                  </Button>
                </div>
              </div>
            </div>
            {!chatModels.isLoading &&
            !Object.keys(chatModels.data ?? {}).length ? (
              <Alert>
                <AlertDescription>
                  <LocalizedText text={'没有可用模型。'} />
                  <Link
                    className='ml-1 underline'
                    to='/w/$workspaceId/credential'
                    params={{ workspaceId: workspace.workspace_id }}
                  >
                    <LocalizedText text={'前往配置凭据'} />
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
          </TabsContent>
          <TabsContent value='knowledge' className='mt-0 space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <h3 className='text-sm font-medium'>
                  <LocalizedText text={'知识库'} />
                </h3>
                <p className='text-xs text-muted-foreground'>
                  <LocalizedText
                    text={'选中后会话会挂载 RAG Middleware；取消全部则卸载。'}
                  />
                </p>
              </div>
              <ParameterPopover
                key={`knowledge-parameters-${JSON.stringify(
                  knowledgeConfig?.parameters ?? {}
                )}`}
                schema={middlewareSchema.data ?? null}
                values={knowledgeConfig?.parameters ?? {}}
                title='知识库参数'
                description='配置检索中间件参数。'
                disabled={
                  disabled ||
                  pending ||
                  !knowledgeConfig?.knowledge_base_ids.length
                }
                onApply={(parameters) =>
                  knowledgeConfig &&
                  void onPatch({
                    knowledge_config: { ...knowledgeConfig, parameters },
                  })
                }
              />
            </div>
            {knowledgeBases.isLoading ? (
              <p className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' />
                <LocalizedText text={'正在加载知识库…'} />
              </p>
            ) : knowledgeBases.data?.knowledge_bases.length ? (
              <div className='max-h-64 space-y-2 overflow-y-auto'>
                {knowledgeBases.data.knowledge_bases.map((item) => {
                  const id = `session-knowledge-${item.id}`
                  const checked = knowledgeConfig?.knowledge_base_ids.includes(
                    item.id
                  )
                  return (
                    <label
                      key={item.id}
                      htmlFor={id}
                      className='flex items-start gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-accent'
                    >
                      <Checkbox
                        id={id}
                        className='mt-0.5'
                        checked={Boolean(checked)}
                        disabled={disabled || pending}
                        onCheckedChange={(next) =>
                          toggleKnowledgeBase(item.id, next === true)
                        }
                      />
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate font-medium'>
                          {item.name}
                        </span>
                        <span className='mt-0.5 line-clamp-2 block text-xs text-muted-foreground'>
                          {item.description || item.id}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                <LocalizedText text={'当前 Workspace 没有知识库。'} />
              </p>
            )}
          </TabsContent>
          <TabsContent value='tools' className='mt-0 space-y-4'>
            <ResourceSelector
              icon={<Plug className='size-4' />}
              title='MCP'
              description='把 Workspace 凭据库中的 MCP 挂载到当前会话。'
              resources={libraryMcps.data ?? []}
              selectedNames={selectedMcpNames}
              loading={libraryMcps.isLoading || sessionMcps.isLoading}
              disabled={disabled || pending}
              busyName={resourceBusy}
              error={
                resourceError ||
                formatResourceError(libraryMcps.error, sessionMcps.error)
              }
              onToggle={(resource, checked) =>
                toggleResource('mcp', resource, checked)
              }
            />
            <ResourceSelector
              icon={<BookText className='size-4' />}
              title='Skill'
              description='把 Workspace 凭据库中的 Skill 挂载到当前会话。'
              resources={librarySkills.data ?? []}
              selectedNames={selectedSkillNames}
              loading={librarySkills.isLoading || sessionSkills.isLoading}
              disabled={disabled || pending}
              busyName={resourceBusy}
              error={formatResourceError(
                librarySkills.error,
                sessionSkills.error
              )}
              onToggle={(resource, checked) =>
                toggleResource('skill', resource, checked)
              }
            />
            {sessionMcps.data?.length ? (
              <p className='text-xs text-muted-foreground'>
                已挂载 MCP：
                {sessionMcps.data.map((item) => (
                  <span key={item.name} className='mr-1'>
                    {item.name}
                    {item.is_healthy === false ? '（ unhealthy ）' : ''}
                  </span>
                ))}
              </p>
            ) : null}
            {sessionSkills.data?.length ? (
              <p className='text-xs text-muted-foreground'>
                已挂载 Skill：
                {sessionSkills.data.map((item) => item.name).join('、')}
              </p>
            ) : null}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  )
}

function formatResourceError(...errors: Array<Error | null>): string {
  const error = errors.find(Boolean)
  return error ? error.message : ''
}

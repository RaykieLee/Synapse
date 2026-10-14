import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  createCredential,
  deleteCredential,
  listAgentScopeModels,
  listCredentialSchemas,
  listCredentials,
  updateCredential,
  type CredentialSchema,
  type CredentialSchemaProperty,
  type CredentialView,
} from '@/api/agentscope-credentials'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormDialog } from '@/components/form-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/features/workspaces/context'

type FormValue = string | number | boolean | null | undefined
type CredentialDraft = {
  id?: string
  type: string
  values: Record<string, FormValue>
}

const panel = 'rounded-xl border bg-card p-5'

function propertyType(property: CredentialSchemaProperty) {
  return (
    property.type ??
    property.anyOf?.find((item) => item.type && item.type !== 'null')?.type ??
    'string'
  )
}

function enumValues(property: CredentialSchemaProperty) {
  return (
    property.enum ??
    property.anyOf?.flatMap((item) => item.enum ?? []) ??
    []
  )
}

function isBlank(value: FormValue) {
  return value === undefined || value === null || value === ''
}

function initialValues(schema: CredentialSchema) {
  const values: Record<string, FormValue> = {}
  for (const [key, property] of Object.entries(schema.properties)) {
    if (key === 'id' || key === 'type' || property.const !== undefined) continue
    if (property.default !== undefined) values[key] = property.default as FormValue
  }
  return values
}

function schemaFor(
  schemas: CredentialSchema[],
  type: string | undefined
) {
  return schemas.find((item) => item.properties.type?.const === type)
}

function displayName(credential: CredentialView) {
  const name = credential.data.name
  return typeof name === 'string' && name.trim() ? name : credential.id
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试。'
}

export function AgentScopeCredentialPage() {
  const { workspace } = useWorkspace()
  const workspaceId = workspace.workspace_id
  const client = useQueryClient()
  const [draft, setDraft] = React.useState<CredentialDraft | null>(null)
  const [deleteTarget, setDeleteTarget] =
    React.useState<CredentialView | null>(null)
  const [selected, setSelected] = React.useState<CredentialView | null>(null)
  const [formError, setFormError] = React.useState('')

  const schemas = useQuery({
    queryKey: ['agentscope', workspaceId, 'credential-schemas'],
    queryFn: () => listCredentialSchemas(workspaceId),
  })
  const credentials = useQuery({
    queryKey: ['agentscope', workspaceId, 'credentials'],
    queryFn: () => listCredentials(workspaceId),
  })

  const schemaItems = schemas.data?.schemas ?? []
  const credentialItems = credentials.data?.credentials ?? []
  const selectedSchema = schemaFor(
    schemaItems,
    selected?.data.type as string | undefined
  )

  const refresh = () =>
    client.invalidateQueries({
      queryKey: ['agentscope', workspaceId, 'credentials'],
    })

  const save = useMutation({
    mutationFn: async (value: CredentialDraft) => {
      const schema = schemaFor(schemaItems, value.type)
      if (!schema) throw new Error('未找到对应的 Credential schema。')
      const data: Record<string, unknown> = { type: value.type }
      for (const [key, property] of Object.entries(schema.properties)) {
        if (key === 'id' || key === 'type' || property.const !== undefined)
          continue
        const item = value.values[key]
        if (!isBlank(item)) data[key] = item
      }
      const required = new Set(schema.required ?? [])
      for (const key of required) {
        if (isBlank(value.values[key]))
          throw new Error(`请填写必填字段：${schema.properties[key]?.title ?? key}`)
      }
      if (value.id) return updateCredential(workspaceId, value.id, data)
      return createCredential(workspaceId, data)
    },
    onSuccess: async () => {
      setDraft(null)
      setFormError('')
      await refresh()
    },
    onError: (cause) => setFormError(errorText(cause)),
  })

  const remove = useMutation({
    mutationFn: (value: CredentialView) =>
      deleteCredential(workspaceId, value.id),
    onSuccess: async () => {
      if (selected?.id === deleteTarget?.id) setSelected(null)
      setDeleteTarget(null)
      await refresh()
    },
  })

  const openCreate = () => {
    setFormError('')
    const first = schemaItems[0]
    if (!first) return
    setDraft({
      type: String(first.properties.type?.const ?? ''),
      values: initialValues(first),
    })
  }

  const openEdit = (credential: CredentialView) => {
    setFormError('')
    const schema = schemaFor(schemaItems, credential.data.type as string)
    if (!schema) {
      setFormError('未找到此凭据类型的 schema。')
      return
    }
    const values = initialValues(schema)
    for (const [key, property] of Object.entries(schema.properties)) {
      if (key === 'id' || key === 'type' || property.writeOnly) continue
      const value = credential.data[key]
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      )
        values[key] = value
    }
    setDraft({ id: credential.id, type: credential.data.type as string, values })
  }

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm text-muted-foreground'>AgentScope</p>
          <h1 className='mt-1 text-2xl font-semibold'>凭据</h1>
          <p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
            使用 AgentScope 官方 schema 管理当前 Workspace 下的模型凭据。密钥只写入后端，
            不会从列表接口回显。
          </p>
        </div>
        <Button onClick={openCreate} disabled={!schemaItems.length}>
          <Plus className='mr-2 size-4' />
          新建凭据
        </Button>
      </header>

      {schemas.isError && (
        <p role='alert' className='text-sm text-destructive'>
          加载凭据 schema 失败：{errorText(schemas.error)}
        </p>
      )}
      {credentials.isError && (
        <p role='alert' className='text-sm text-destructive'>
          加载凭据失败：{errorText(credentials.error)}
        </p>
      )}

      <section className={panel}>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <div>
            <h2 className='font-semibold'>已保存凭据</h2>
            <p className='text-sm text-muted-foreground'>
              共 {credentials.data?.total ?? 0} 个，按当前账号和 Workspace 隔离。
            </p>
          </div>
          <KeyRound className='size-5 text-muted-foreground' />
        </div>
        {credentials.isLoading ? (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            正在加载…
          </p>
        ) : credentialItems.length ? (
          <div className='grid gap-3 md:grid-cols-2'>
            {credentialItems.map((credential) => (
              <div
                key={credential.id}
                className={`rounded-lg border p-4 ${
                  selected?.id === credential.id
                    ? 'border-primary ring-1 ring-primary/30'
                    : ''
                }`}
              >
                <button
                  type='button'
                  className='w-full text-left'
                  onClick={() => setSelected(credential)}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h3 className='truncate font-medium'>
                        {displayName(credential)}
                      </h3>
                      <p className='mt-1 break-all font-mono text-xs text-muted-foreground'>
                        {String(credential.data.type ?? 'unknown')}
                      </p>
                    </div>
                    <span className='rounded-full bg-muted px-2 py-1 text-xs'>
                      {credential.editable ? '可编辑' : '只读'}
                    </span>
                  </div>
                </button>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setSelected(credential)}
                  >
                    <Eye className='mr-1 size-3.5' />
                    查看能力
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={!credential.editable}
                    onClick={() => openEdit(credential)}
                  >
                    <Pencil className='mr-1 size-3.5' />
                    编辑
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={!credential.editable}
                    onClick={() => setDeleteTarget(credential)}
                  >
                    <Trash2 className='mr-1 size-3.5' />
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className='rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground'>
            当前 Workspace 还没有 AgentScope 凭据。
          </p>
        )}
      </section>

      {selected && (
        <CredentialDetail
          workspaceId={workspaceId}
          credential={selected}
          schema={selectedSchema}
          onClose={() => setSelected(null)}
        />
      )}

      <CredentialEditor
        key={`${draft?.id ?? 'new'}:${draft?.type ?? 'empty'}`}
        draft={draft}
        schemas={schemaItems}
        pending={save.isPending}
        error={formError || (save.error ? errorText(save.error) : '')}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSubmit={() => draft && save.mutate(draft)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title='删除 AgentScope 凭据'
        desc={`将永久删除“${deleteTarget ? displayName(deleteTarget) : ''}”，并使引用它的会话配置失效。`}
        destructive
        confirmText='确认删除'
        isLoading={remove.isPending}
        handleConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </main>
  )
}

function CredentialDetail({
  workspaceId,
  credential,
  schema,
  onClose,
}: {
  workspaceId: string
  credential: CredentialView
  schema?: CredentialSchema
  onClose: () => void
}) {
  const provider = String(credential.data.type ?? '')
  const models = useQuery({
    queryKey: ['agentscope', workspaceId, 'models', provider],
    queryFn: () => listAgentScopeModels(workspaceId, provider),
    enabled: Boolean(provider),
  })

  return (
    <section className={`${panel} space-y-4`}>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-xs text-muted-foreground'>凭据详情</p>
          <h2 className='text-lg font-semibold'>{displayName(credential)}</h2>
          <p className='font-mono text-xs text-muted-foreground'>{provider}</p>
        </div>
        <Button variant='ghost' size='sm' onClick={onClose}>
          收起
        </Button>
      </div>
      <div className='grid gap-2 text-sm sm:grid-cols-2'>
        {schema &&
          Object.entries(schema.properties).map(([key, property]) => {
            if (
              key === 'id' ||
              key === 'type' ||
              property.writeOnly ||
              credential.data[key] === undefined
            )
              return null
            return (
              <div key={key}>
                <dt className='text-xs text-muted-foreground'>
                  {property.title ?? key}
                </dt>
                <dd className='break-all'>{String(credential.data[key])}</dd>
              </div>
            )
          })}
      </div>
      <div>
        <div className='mb-2 flex items-center justify-between gap-2'>
          <h3 className='font-medium'>可用模型</h3>
          <span className='text-xs text-muted-foreground'>
            {models.data?.total ?? 0}
          </span>
        </div>
        {models.isLoading ? (
          <p className='text-sm text-muted-foreground'>正在加载模型目录…</p>
        ) : models.isError ? (
          <p className='text-sm text-muted-foreground'>
            当前 provider 暂时无法返回模型目录：{errorText(models.error)}
          </p>
        ) : models.data?.models.length ? (
          <div className='flex flex-wrap gap-2'>
            {models.data.models.map((model) => (
              <span
                key={model.name}
                className='rounded-full bg-muted px-2 py-1 font-mono text-xs'
              >
                {model.label || model.name}
              </span>
            ))}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>暂无可用模型。</p>
        )}
      </div>
    </section>
  )
}

function CredentialEditor({
  draft,
  schemas,
  pending,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: CredentialDraft | null
  schemas: CredentialSchema[]
  pending: boolean
  error: string
  onChange: (draft: CredentialDraft | null) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const schema = schemaFor(schemas, draft?.type)
  const required = new Set(schema?.required ?? [])
  const disabled =
    !draft ||
    !schema ||
    [...required].some((key) => isBlank(draft.values[key]))

  return (
    <FormDialog
      open={Boolean(draft)}
      onOpenChange={(open) => !open && onCancel()}
      title={draft?.id ? '编辑 AgentScope 凭据' : '新建 AgentScope 凭据'}
      description='字段来自 AgentScope 官方 credential schema。密钥字段不会预填，编辑时需要重新输入必填密钥。'
      error={error}
      pending={pending}
      disabled={disabled}
      formAriaLabel='AgentScope 凭据表单'
      submitLabel={draft?.id ? '保存修改' : '创建凭据'}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      {draft && schema && (
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='agentscope-credential-type'>提供商类型</Label>
            <select
              id='agentscope-credential-type'
              className='h-10 w-full rounded-md border bg-background px-3 text-sm'
              value={draft.type}
              disabled={Boolean(draft.id)}
              onChange={(event) => {
                const next = schemaFor(schemas, event.target.value)
                onChange({
                  ...draft,
                  type: event.target.value,
                  values: next ? initialValues(next) : {},
                })
              }}
            >
              {schemas.map((item) => (
                <option
                  key={String(item.properties.type?.const)}
                  value={String(item.properties.type?.const)}
                >
                  {item.title}
                </option>
              ))}
            </select>
          </div>
          {Object.entries(schema.properties).map(([key, property]) => {
            if (key === 'id' || key === 'type' || property.const !== undefined)
              return null
            return (
              <SchemaField
                key={key}
                name={key}
                property={property}
                required={required.has(key)}
                value={draft.values[key]}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    values: { ...draft.values, [key]: value },
                  })
                }
              />
            )
          })}
        </div>
      )}
    </FormDialog>
  )
}

function SchemaField({
  name,
  property,
  required,
  value,
  onChange,
}: {
  name: string
  property: CredentialSchemaProperty
  required: boolean
  value: FormValue
  onChange: (value: FormValue) => void
}) {
  const type = propertyType(property)
  const options = enumValues(property)
  const label = property.title ?? name.replace(/_/g, ' ')
  const inputId = `agentscope-credential-${name}`
  const description = property.description
  if (type === 'boolean') {
    return (
      <label className='flex items-start gap-3 text-sm' htmlFor={inputId}>
        <Checkbox
          id={inputId}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
        <span>
          <span className='font-medium'>{label}</span>
          {description && (
            <span className='mt-1 block text-xs text-muted-foreground'>
              {description}
            </span>
          )}
        </span>
      </label>
    )
  }
  return (
    <div className='space-y-2'>
      <Label htmlFor={inputId}>
        {label}
        {required && <span className='ml-1 text-destructive'>*</span>}
      </Label>
      {options.length ? (
        <select
          id={inputId}
          className='h-10 w-full rounded-md border bg-background px-3 text-sm'
          value={value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value=''>请选择</option>
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : property.format === 'textarea' ? (
        <Textarea
          id={inputId}
          value={typeof value === 'string' ? value : ''}
          placeholder={description}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={inputId}
          type={
            property.writeOnly || property.format === 'password'
              ? 'password'
              : type === 'number' || type === 'integer'
                ? 'number'
                : 'text'
          }
          value={value == null ? '' : String(value)}
          placeholder={description}
          onChange={(event) => {
            const raw = event.target.value
            if (type === 'integer') onChange(raw === '' ? undefined : Number(raw))
            else if (type === 'number')
              onChange(raw === '' ? undefined : Number(raw))
            else onChange(raw)
          }}
        />
      )}
      {description && property.format !== 'textarea' && (
        <p className='text-xs text-muted-foreground'>{description}</p>
      )}
    </div>
  )
}

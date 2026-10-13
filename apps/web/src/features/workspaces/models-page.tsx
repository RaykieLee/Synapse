import * as React from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ServerCog,
  Trash2,
} from 'lucide-react'
import {
  createCredential,
  createModelBinding,
  deleteCredential,
  deleteModelBinding,
  listCredentials,
  listModelBindings,
  listProviders,
  updateCredential,
  type Credential,
  type CredentialPatchPayload,
} from '@/api/model-providers'
import type { Workspace } from '@/api/workspaces'
import { ApiProblem } from '@/lib/api'
import { useLocaleText } from '@/lib/i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { FormDialog } from '@/components/form-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocalizedText } from '@/components/localized-text'
import { useWorkspace } from './context'
import { modelProviderQueryKey } from './model-provider-query-key'

const panel = 'rounded-xl border bg-card p-5'
const emptyCredential = {
  name: '',
  api_key: '',
  base_url: 'https://api.openai.com/v1',
}
const emptyModel = { display_name: '', model: '', credential_id: '' }

export function WorkspaceModelsPage() {
  const { workspace, actorId } = useWorkspace()
  // Discard private drafts and dialogs when identity, scope or access changes.
  const scope = JSON.stringify([
    actorId,
    workspace.tenant_id,
    workspace.workspace_id,
    workspace.membership_version ?? 0,
    workspace.workspace_role,
    workspace.status,
  ])
  return (
    <WorkspaceModelsContent
      key={scope}
      workspace={workspace}
      actorId={actorId}
    />
  )
}

function WorkspaceModelsContent({
  workspace,
  actorId,
}: {
  workspace: Workspace
  actorId: string
}) {
  const t = useLocaleText()
  const queryClient = useQueryClient()
  const workspaceId = workspace.workspace_id
  const active = workspace.status === 'active'
  const manager = ['owner', 'admin'].includes(workspace.workspace_role)
  const canWriteOwnCredential = ['owner', 'admin', 'member'].includes(
    workspace.workspace_role
  )
  const key = modelProviderQueryKey(
    actorId,
    workspace.tenant_id,
    workspaceId,
    workspace.membership_version ?? 0
  )
  const providers = useQuery({
    queryKey: [...key, 'providers', workspaceId],
    queryFn: () => listProviders(workspaceId),
    enabled: active,
  })
  const credentials = useQuery({
    queryKey: [...key, 'credentials', workspaceId],
    queryFn: () => listCredentials(workspaceId),
    enabled: active,
  })
  const models = useQuery({
    queryKey: [...key, 'models', workspaceId],
    queryFn: () => listModelBindings(workspaceId),
    enabled: active,
  })
  const [credential, setCredential] = React.useState(emptyCredential)
  const [model, setModel] = React.useState(emptyModel)
  const [credentialError, setCredentialError] = React.useState('')
  const [modelError, setModelError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [credentialOpen, setCredentialOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const credentialSelectId = React.useId()
  const firstProvider = providers.isSuccess ? providers.data[0] : undefined
  const credentialsReady = credentials.isSuccess
  const availableCredentials = credentialsReady
    ? credentials.data.filter(
        (item) =>
          item.owner &&
          providers.data?.some(
            (provider) => provider.provider_type === item.provider_type
          )
      )
    : []
  const selectedCredential = availableCredentials.find(
    (item) => item.credential_id === model.credential_id
  )
  const scopeDenied = [providers, credentials, models].some(
    (query) =>
      query.isError &&
      query.error instanceof ApiProblem &&
      [401, 403, 404, 409].includes(query.error.status)
  )
  const canCreateCredential = canWriteOwnCredential && !scopeDenied
  const canManage = manager && !scopeDenied
  const refreshResources = async (message: string) => {
    setNotice(message)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...key, 'credentials'] }),
      queryClient.invalidateQueries({ queryKey: [...key, 'models'] }),
    ])
  }
  const credentialMutation = useMutation({
    gcTime: 0,
    mutationFn: () => {
      if (!firstProvider || !canCreateCredential)
        throw new Error('Credential creation unavailable')
      return createCredential(workspaceId, {
        provider_type: firstProvider.provider_type,
        ...credential,
      })
    },
    onSuccess: async (created) => {
      setCredential(emptyCredential)
      setCredentialOpen(false)
      if (canManage)
        setModel((current) => ({
          ...current,
          credential_id: created.credential_id,
        }))
      await refreshResources('凭据已添加。')
    },
    onError: (cause) => {
      setCredential((current) => ({ ...current, api_key: '' }))
      setCredentialError(errorText(cause))
    },
  })
  const modelMutation = useMutation({
    mutationFn: () => {
      if (!selectedCredential || !canManage)
        throw new Error('Model creation unavailable')
      return createModelBinding(workspaceId, {
        ...model,
        kind: 'chat',
        provider_type: selectedCredential.provider_type,
      })
    },
    onSuccess: async () => {
      setModel(emptyModel)
      setModelOpen(false)
      await refreshResources('模型已添加。')
    },
    onError: (cause) => setModelError(errorText(cause)),
  })

  return (
    <main className='min-w-0 space-y-6 p-6'>
      <header>
        <p className='text-sm break-words text-muted-foreground'>
          <LocalizedText text='工作区' /> · {workspace.name}
        </p>
        <h1 className='mt-1 text-2xl font-semibold'>
          <LocalizedText text='模型与凭据' />
        </h1>
        <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
          <LocalizedText text='管理 OpenAI-compatible endpoint 和 Workspace 可选择的自定义模型。密钥只写入，不会回显。' />
        </p>
        <p className='mt-3 rounded-md border bg-muted/30 p-3 text-sm'>
          <LocalizedText text='当前仅管理配置；尚未接入 AgentScope 运行时，也未验证提供商连接。' />
        </p>
      </header>
      <p
        role='status'
        aria-live='polite'
        className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}
      >
        <LocalizedText text={notice} />
      </p>
      {!active ? (
        <section className={panel}>
          <LocalizedText text='空间已归档，模型和凭据当前为只读不可用状态。' />
        </section>
      ) : (
        <>
          {!canWriteOwnCredential && (
            <p className='rounded-md border p-3 text-sm text-muted-foreground'>
              <LocalizedText text='当前账号只有只读权限，不能添加、编辑或删除模型与凭据。' />
            </p>
          )}
          {scopeDenied && (
            <p className='rounded-md border p-3 text-sm text-muted-foreground'>
              <LocalizedText text='当前空间权限无法验证，修改操作已停用。请重试加载。' />
            </p>
          )}
          {workspace.workspace_role === 'member' && !scopeDenied && (
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text='成员可添加和更新自己的凭据；删除凭据和管理模型需要 Workspace 所有者或管理员权限。' />
            </p>
          )}
          <section aria-label={t('已注册提供商')} className={panel}>
            <div className='flex items-center gap-2'>
              <ServerCog aria-hidden='true' className='size-5' />
              <h2 className='font-semibold'>
                <LocalizedText text='已注册提供商' />
              </h2>
            </div>
            <QueryFeedback
              query={providers}
              loading='正在加载提供商…'
              failed='无法加载提供商。'
            />
            {providers.isSuccess && (
              <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                {providers.data.map((provider) => (
                  <div
                    key={provider.provider_type}
                    className='min-w-0 rounded-lg border p-4 break-words'
                  >
                    <p className='font-medium'>{provider.label}</p>
                    <p className='mt-1 text-sm text-muted-foreground'>
                      {provider.provider_type} ·{' '}
                      {provider.capabilities.join(', ')}
                    </p>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      <LocalizedText
                        text={
                          provider.supports_custom_model_id
                            ? '支持自定义模型 ID'
                            : '仅支持内置模型'
                        }
                      />
                    </p>
                  </div>
                ))}
                {!providers.data.length && (
                  <p className='text-sm text-muted-foreground'>
                    <LocalizedText text='当前没有可用的提供商。' />
                  </p>
                )}
              </div>
            )}
          </section>
          <section aria-label={t('我的凭据')} className={panel + ' space-y-4'}>
            <div className='flex items-center gap-2'>
              <KeyRound aria-hidden='true' className='size-5' />
              <h2 className='font-semibold'>
                <LocalizedText text='我的凭据' />
              </h2>
            </div>
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text='凭据属于当前账号；其他 Workspace 成员只能看到模型状态，不能读取你的密钥。' />
            </p>
            <QueryFeedback
              query={credentials}
              loading='正在加载凭据…'
              failed='无法加载凭据。'
            />
            {credentialsReady && (
              <>
                {!credentials.data.length && (
                  <p className='text-sm text-muted-foreground'>
                    <LocalizedText text='当前账号在此空间还没有凭据。' />
                  </p>
                )}
                {credentials.data.map((item) => (
                  <CredentialRow
                    key={item.credential_id}
                    item={item}
                    workspaceId={workspaceId}
                    canEdit={canCreateCredential && item.owner}
                    canDelete={canManage && item.owner}
                    onUpdated={() => refreshResources('凭据已更新。')}
                    onDeleted={() => refreshResources('凭据已删除。')}
                  />
                ))}
              </>
            )}
            {canCreateCredential && firstProvider && credentialsReady && (
              <Button onClick={() => setCredentialOpen(true)}>
                <Plus aria-hidden='true' className='mr-2 size-4' />
                <LocalizedText text='添加凭据' />
              </Button>
            )}
            <FormDialog
              open={credentialOpen}
              onOpenChange={(open) => {
                setCredentialOpen(open)
                if (!open) setCredentialError('')
              }}
              title={<LocalizedText text='添加凭据' />}
              formAriaLabel='添加凭据'
              description={
                <LocalizedText text='凭据只属于当前账号；API key 仅提交时发送，保存后不会回显。' />
              }
              submitLabel={<LocalizedText text='添加凭据' />}
              pending={credentialMutation.isPending}
              disabled={
                !credential.name.trim() ||
                !credential.api_key.trim() ||
                !credential.base_url.trim()
              }
              onSubmit={() => {
                setCredentialError('')
                setNotice('')
                credentialMutation.mutate()
              }}
              onCancel={() => {
                setCredentialOpen(false)
                setCredentialError('')
              }}
            >
                {credentialError && (
                  <p role='alert' className='text-sm text-destructive'>
                    <LocalizedText text={credentialError} />
                  </p>
                )}
                <fieldset
                  disabled={credentialMutation.isPending}
                  className='grid gap-3 md:grid-cols-3'
                >
                  <legend className='sr-only'>
                    <LocalizedText text='添加凭据' />
                  </legend>
                  <Field
                    label='名称'
                    value={credential.name}
                    onChange={(name) =>
                      setCredential((current) => ({ ...current, name }))
                    }
                    placeholder='公司网关'
                    required
                    maxLength={100}
                  />
                  <Field
                    label='Endpoint'
                    value={credential.base_url}
                    onChange={(base_url) =>
                      setCredential((current) => ({ ...current, base_url }))
                    }
                    placeholder='https://llm.example.com/v1'
                    type='url'
                    required
                    maxLength={500}
                  />
                  <Field
                    label='API key'
                    value={credential.api_key}
                    onChange={(api_key) =>
                      setCredential((current) => ({ ...current, api_key }))
                    }
                    placeholder='只在提交时发送'
                    type='password'
                    required
                    maxLength={4096}
                  />
                </fieldset>
            </FormDialog>
          </section>
          <section
            aria-label={t('Workspace 模型')}
            className={panel + ' space-y-4'}
          >
            <div>
              <h2 className='font-semibold'>
                <LocalizedText text='Workspace 模型' />
              </h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                <LocalizedText text='模型定义共享，凭据仍按创建者隔离。' />
              </p>
            </div>
            <QueryFeedback
              query={models}
              loading='正在加载模型…'
              failed='无法加载模型。'
            />
            {models.isSuccess && (
              <>
                {!models.data.length && (
                  <p className='text-sm text-muted-foreground'>
                    <LocalizedText text='此空间还没有模型定义。' />
                  </p>
                )}
                {models.data.map((item) => (
                  <article
                    aria-label={item.display_name}
                    key={item.model_binding_id}
                    className='flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center'
                  >
                    <div className='min-w-0 flex-1 break-words'>
                      <p className='font-medium'>{item.display_name}</p>
                      <p className='text-sm text-muted-foreground'>
                        {item.provider_type} · {item.model}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        <LocalizedText
                          text={
                            item.credential_status === 'available'
                              ? '当前账号的凭据'
                              : item.credential_status === 'owner_only'
                                ? '凭据归其他成员所有'
                                : '凭据不可用'
                          }
                        />
                      </p>
                    </div>
                    <span className='text-xs text-muted-foreground'>
                      <LocalizedText
                        text={item.status === 'active' ? '启用' : '停用'}
                      />
                    </span>
                    {canManage && (
                      <DeleteResourceButton
                        kind='model'
                        name={item.display_name}
                        remove={() =>
                          deleteModelBinding(workspaceId, item.model_binding_id)
                        }
                        onDeleted={() => refreshResources('模型已删除。')}
                      />
                    )}
                  </article>
                ))}
              </>
            )}
            {canManage &&
              firstProvider &&
              credentialsReady &&
              models.isSuccess && (
                <Button onClick={() => setModelOpen(true)}>
                  <Plus aria-hidden='true' className='mr-2 size-4' />
                  <LocalizedText text='添加模型' />
                </Button>
              )}
            <FormDialog
              open={modelOpen}
              onOpenChange={(open) => {
                setModelOpen(open)
                if (!open) setModelError('')
              }}
              title={<LocalizedText text='添加模型' />}
              formAriaLabel='添加模型'
              description={
                <LocalizedText text='模型定义共享给 Workspace；执行时使用你自己的凭据。' />
              }
              submitLabel={<LocalizedText text='添加模型' />}
              pending={modelMutation.isPending}
              disabled={
                !model.display_name.trim() ||
                !model.model.trim() ||
                !selectedCredential
              }
              onSubmit={() => {
                setModelError('')
                setNotice('')
                modelMutation.mutate()
              }}
              onCancel={() => {
                setModelOpen(false)
                setModelError('')
              }}
            >
                  {modelError && (
                    <p role='alert' className='text-sm text-destructive'>
                      <LocalizedText text={modelError} />
                    </p>
                  )}
                  {!availableCredentials.length && (
                    <p className='text-sm text-muted-foreground'>
                      <LocalizedText text='请先添加自己的凭据，再创建模型。' />
                    </p>
                  )}
                  <fieldset
                    disabled={
                      modelMutation.isPending || !availableCredentials.length
                    }
                    className='grid gap-3 md:grid-cols-3'
                  >
                    <legend className='sr-only'>
                      <LocalizedText text='添加模型' />
                    </legend>
                    <Field
                      label='显示名称'
                      value={model.display_name}
                      onChange={(display_name) =>
                        setModel((current) => ({ ...current, display_name }))
                      }
                      placeholder='公司 Chat'
                      required
                      maxLength={100}
                    />
                    <Field
                      label='上游模型 ID'
                      value={model.model}
                      onChange={(value) =>
                        setModel((current) => ({ ...current, model: value }))
                      }
                      placeholder='company-chat-v3'
                      required
                      maxLength={200}
                    />
                    <div className='space-y-2'>
                      <Label htmlFor={credentialSelectId}>
                        <LocalizedText text='凭据' />
                      </Label>
                      <select
                        id={credentialSelectId}
                        required
                        className='h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm'
                        value={model.credential_id}
                        onChange={(event) =>
                          setModel((current) => ({
                            ...current,
                            credential_id: event.target.value,
                          }))
                        }
                      >
                        <option value=''>{t('请选择')}</option>
                        {availableCredentials.map((item) => (
                          <option
                            key={item.credential_id}
                            value={item.credential_id}
                          >
                            {item.name} · {item.endpoint_host}
                          </option>
                        ))}
                      </select>
                    </div>
                  </fieldset>
            </FormDialog>
          </section>
        </>
      )}
    </main>
  )
}

function QueryFeedback({
  query,
  loading,
  failed,
}: {
  query: Pick<
    UseQueryResult,
    'isPending' | 'isError' | 'isFetching' | 'error' | 'refetch'
  >
  loading: string
  failed: string
}) {
  const t = useLocaleText()
  if (query.isPending)
    return (
      <p
        role='status'
        aria-live='polite'
        className='mt-3 flex items-center gap-2 text-sm text-muted-foreground'
      >
        <Loader2 aria-hidden='true' className='size-4 animate-spin' />
        <LocalizedText text={loading} />
      </p>
    )
  if (!query.isError) return null
  return (
    <div className='mt-3 space-y-2 rounded-md border border-destructive/30 p-3'>
      <p role='alert' className='text-sm text-destructive'>
        <LocalizedText text={failed} /> {t(errorText(query.error))}
      </p>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        <LocalizedText text='重试' />
      </Button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  maxLength,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
  required?: boolean
  maxLength?: number
  autoFocus?: boolean
}) {
  const id = React.useId()
  const t = useLocaleText()
  return (
    <div className='min-w-0 space-y-2'>
      <Label htmlFor={id}>
        <LocalizedText text={label} />
      </Label>
      <Input
        id={id}
        type={type}
        autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        value={value}
        placeholder={t(placeholder)}
        required={required}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function CredentialRow({
  item,
  workspaceId,
  canEdit,
  canDelete,
  onUpdated,
  onDeleted,
}: {
  item: Credential
  workspaceId: string
  canEdit: boolean
  canDelete: boolean
  onUpdated: () => Promise<unknown>
  onDeleted: () => Promise<unknown>
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState({
    name: item.name,
    api_key: '',
    base_url: '',
  })
  const [error, setError] = React.useState('')
  const editTrigger = React.useRef<HTMLButtonElement>(null)
  const closeEditor = () => {
    setDraft({ name: item.name, api_key: '', base_url: '' })
    setError('')
    setEditing(false)
    requestAnimationFrame(() => editTrigger.current?.focus())
  }
  const update = useMutation({
    gcTime: 0,
    mutationFn: () => {
      const body: CredentialPatchPayload = {}
      if (draft.name.trim() !== item.name) body.name = draft.name.trim()
      if (draft.api_key.trim()) body.api_key = draft.api_key
      if (draft.base_url.trim()) body.base_url = draft.base_url.trim()
      return updateCredential(workspaceId, item.credential_id, body)
    },
    onSuccess: async () => {
      closeEditor()
      await onUpdated()
    },
    onError: (cause) => {
      setDraft((current) => ({ ...current, api_key: '' }))
      setError(errorText(cause))
    },
  })
  const dirty =
    draft.name.trim() !== item.name ||
    Boolean(draft.api_key.trim() || draft.base_url.trim())

  return (
    <article
      aria-label={item.name}
      className='space-y-3 rounded-lg border p-3 text-sm'
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
        <KeyRound
          aria-hidden='true'
          className='size-4 shrink-0 text-muted-foreground'
        />
        <div className='min-w-0 flex-1 break-words'>
          <p className='font-medium'>{item.name}</p>
          <p className='text-xs text-muted-foreground'>
            {item.provider_type} · {item.endpoint_host} ·{' '}
            <LocalizedText
              text={item.has_secret ? '已配置密钥' : '未配置密钥'}
            />
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {canEdit && !editing && (
            <Button
              ref={editTrigger}
              size='sm'
              variant='outline'
              onClick={() => {
                setDraft({ name: item.name, api_key: '', base_url: '' })
                setError('')
                setEditing(true)
              }}
            >
              <Pencil aria-hidden='true' className='mr-2 size-4' />
              <LocalizedText text='编辑 / 轮换' />
            </Button>
          )}
          {canDelete && !editing && (
            <DeleteResourceButton
              kind='credential'
              name={item.name}
              remove={() => deleteCredential(workspaceId, item.credential_id)}
              onDeleted={onDeleted}
            />
          )}
        </div>
      </div>
      {!item.owner && (
        <p className='text-xs text-muted-foreground'>
          <LocalizedText text='仅凭据所有者可编辑或删除。' />
        </p>
      )}
      {editing && canEdit && (
        <FormDialog
          open
          onOpenChange={(open) => { if (!open) closeEditor() }}
          title={<LocalizedText text='编辑凭据' />}
          formAriaLabel='编辑凭据'
          description={
            <LocalizedText text='原密钥和完整地址不会回显。留空表示保留；填写新 API key 会替换原密钥。' />
          }
          submitLabel={<LocalizedText text='保存凭据' />}
          pending={update.isPending}
          disabled={!dirty || !draft.name.trim()}
          onSubmit={() => {
            setError('')
            update.mutate()
          }}
          onCancel={closeEditor}
        >
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              <LocalizedText text={error} />
            </p>
          )}
          <fieldset
            disabled={update.isPending}
            className='grid gap-3 md:grid-cols-3'
          >
            <legend className='sr-only'>
              <LocalizedText text='编辑凭据' />
            </legend>
            <Field
              label='名称'
              value={draft.name}
              onChange={(name) => setDraft((current) => ({ ...current, name }))}
              placeholder='公司网关'
              required
              maxLength={100}
              autoFocus
            />
            <Field
              label='Endpoint'
              value={draft.base_url}
              onChange={(base_url) =>
                setDraft((current) => ({ ...current, base_url }))
              }
              placeholder='留空保留完整地址'
              type='url'
              maxLength={500}
            />
            <Field
              label='新 API key'
              value={draft.api_key}
              onChange={(api_key) =>
                setDraft((current) => ({ ...current, api_key }))
              }
              placeholder='留空保留原密钥'
              type='password'
              maxLength={4096}
            />
          </fieldset>
        </FormDialog>
      )}
    </article>
  )
}

function DeleteResourceButton({
  kind,
  name,
  remove,
  onDeleted,
}: {
  kind: 'credential' | 'model'
  name: string
  remove: () => Promise<void>
  onDeleted: () => Promise<unknown>
}) {
  const title = kind === 'credential' ? '删除凭据' : '删除模型'
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const deletion = useMutation({
    mutationFn: remove,
    onSuccess: async () => {
      setError('')
      setOpen(false)
      await onDeleted()
    },
    onError: (cause) => setError(errorText(cause)),
  })
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deletion.isPending) return
        setError('')
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type='button' size='sm' variant='outline'>
          <Trash2 aria-hidden='true' className='mr-2 size-4' />
          <LocalizedText text={title} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <LocalizedText text={title} />
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className='space-y-2'>
              <p className='font-medium break-words'>{name}</p>
              <p>
                <LocalizedText
                  text={
                    kind === 'credential'
                      ? '删除后无法恢复。被模型引用的凭据无法删除，请先处理关联模型。'
                      : '删除后无法恢复。被其他资源引用的模型无法删除，请先解除引用。'
                  }
                />
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role='alert' className='text-sm text-destructive'>
            <LocalizedText text={error} />
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>
            <LocalizedText text='取消' />
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={deletion.isPending}
            onClick={(event) => {
              event.preventDefault()
              if (deletion.isPending) return
              setError('')
              deletion.mutate()
            }}
          >
            <LocalizedText text={deletion.isPending ? '删除中…' : '确认删除'} />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function errorText(cause: unknown) {
  if (cause instanceof ApiProblem) {
    const messages: Record<string, string> = {
      CREDENTIAL_IN_USE: '凭据正被模型引用，请先删除关联模型后重试。',
      MODEL_BINDING_IN_USE:
        '模型正被其他资源引用，无法删除。请先解除引用后重试。',
      MODEL_NAME_CONFLICT: '模型显示名称已存在，请更换名称。',
      CREDENTIAL_CONFLICT: '凭据与现有记录冲突，请刷新后重试。',
      MODEL_ENDPOINT_NOT_ALLOWED:
        'Endpoint 不符合服务端安全规则，请检查地址后重试。',
      UNSUPPORTED_PROVIDER: '当前提供商不可用，请刷新提供商列表。',
    }
    if (cause.code && messages[cause.code]) return messages[cause.code]
    if (cause.status === 401) return '登录已失效，请重新登录。'
    if (cause.status === 403) return '当前账号没有执行此操作的权限。'
    if (cause.status === 404)
      return '资源已不存在或当前账号不可访问，请刷新后重试。'
    if (cause.status === 409) return '资源状态已变更，请刷新后重试。'
    if (cause.status === 422 || cause.status === 400)
      return '提交内容无效，请检查字段后重试。'
    if (cause.status === 429) return '请求过于频繁，请稍后重试。'
    if (cause.status === 503) return '服务暂不可用，请稍后重试。'
    if (cause.status === 0) return '网络连接失败，请检查网络后重试。'
  }
  return '操作失败，请稍后重试。'
}

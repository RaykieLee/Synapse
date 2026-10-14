import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type {
  JsonObject,
  SopAgentOption,
  SopCredentialOption,
} from './api'

export type JsonSchema = {
  title?: string
  description?: string
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  default?: unknown
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  discriminator?: {
    propertyName: string
    mapping?: Record<string, string>
  }
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minItems?: number
  [key: string]: unknown
}

export type SchemaEditorResources = {
  agents: SopAgentOption[]
  credentials: SopCredentialOption[]
}

const inputClass = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const selectClass = inputClass

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asSchema(value: unknown): JsonSchema | undefined {
  return isRecord(value) ? (value as JsonSchema) : undefined
}

function resolveSchema(
  document: JsonObject,
  schema: JsonSchema
): JsonSchema {
  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) {
    return schema
  }
  let current: unknown = document
  for (const part of schema.$ref.slice(2).split('/')) {
    if (!isRecord(current)) return schema
    current = current[part]
  }
  return asSchema(current) ?? schema
}

function unionVariants(document: JsonObject, schema: JsonSchema) {
  const variants = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]
  return variants.flatMap((item, index) => {
    const resolved = resolveSchema(document, item)
    return [{ schema: resolved, original: item, index }]
  })
}

function isUnionSchema(schema: JsonSchema) {
  return Boolean(schema.anyOf?.length || schema.oneOf?.length)
}

function nullVariant(
  variants: Array<{ schema: JsonSchema; index: number }>
) {
  return variants.find((variant) => variant.schema.type === 'null')
}

function variantKey(schema: JsonSchema, propertyName?: string) {
  if (!propertyName) return undefined
  const property = schema.properties?.[propertyName]
  if (!property) return undefined
  return property.const ?? property.default ?? property.enum?.[0]
}

function selectedVariant(
  schema: JsonSchema,
  value: unknown,
  variants: Array<{ schema: JsonSchema; index: number }>
) {
  if (value === null || value === undefined) return nullVariant(variants)
  if (isRecord(value) && schema.discriminator) {
    const propertyName = schema.discriminator.propertyName
    const actual = value[propertyName]
    return (
      variants.find(
        (variant) => variantKey(variant.schema, propertyName) === actual
      ) ?? variants.find((variant) => variant.schema.type !== 'null')
    )
  }
  return variants.find((variant) => variant.schema.type !== 'null')
}

export function schemaDefault(document: JsonObject, schema: JsonSchema): unknown {
  schema = resolveSchema(document, schema)
  if ('default' in schema) return schema.default
  if ('const' in schema) return schema.const
  if (schema.enum?.length) return schema.enum[0]
  if (isUnionSchema(schema)) {
    const variants = unionVariants(document, schema)
    if (nullVariant(variants)) return null
    const variant = variants.find((item) => item.schema.type !== 'null')
    return variant ? schemaDefault(document, variant.schema) : undefined
  }
  if (schema.type === 'object' || schema.properties) {
    const value: JsonObject = {}
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const resolved = resolveSchema(document, property)
      if ('default' in resolved || 'const' in resolved || resolved.enum?.length) {
        value[key] = schemaDefault(document, resolved)
      }
    }
    return value
  }
  if (schema.type === 'array') return []
  if (schema.type === 'boolean') return false
  if (schema.type === 'number' || schema.type === 'integer') {
    return typeof schema.minimum === 'number'
      ? schema.minimum
      : typeof schema.exclusiveMinimum === 'number'
        ? schema.exclusiveMinimum + 1
        : 0
  }
  return ''
}

export function normalizeForSchema(
  document: JsonObject,
  schema: JsonSchema,
  value: unknown
): unknown {
  const resolved = resolveSchema(document, schema)
  if (isUnionSchema(resolved)) {
    if (value === null) return null
    const variants = unionVariants(document, resolved)
    const variant = selectedVariant(resolved, value, variants)
    if (!variant) return null
    return normalizeForSchema(document, variant.schema, value)
  }
  if (resolved.type === 'object' || resolved.properties) {
    const source = isRecord(value) ? value : {}
    const result: JsonObject = {}
    for (const [key, property] of Object.entries(resolved.properties ?? {})) {
      const propertySchema = resolveSchema(document, property)
      if ('const' in propertySchema) result[key] = propertySchema.const
      else if (source[key] !== undefined)
        result[key] = normalizeForSchema(document, propertySchema, source[key])
      else if ('default' in propertySchema)
        result[key] = propertySchema.default
    }
    const known = new Set(Object.keys(resolved.properties ?? {}))
    for (const [key, item] of Object.entries(source)) {
      if (known.has(key)) continue
      result[key] =
        resolved.additionalProperties && resolved.additionalProperties !== true
          ? normalizeForSchema(
              document,
              resolved.additionalProperties,
              item
            )
          : item
    }
    return result
  }
  if (resolved.type === 'array') {
    if (!Array.isArray(value)) return []
    return value.map((item) =>
      resolved.items
        ? normalizeForSchema(document, resolved.items, item)
        : item
    )
  }
  return value
}

function isBlank(value: unknown) {
  return value === undefined || value === null || value === ''
}

export function collectSchemaIssues(
  document: JsonObject,
  schema: JsonSchema,
  value: unknown,
  path = 'SOP'
): string[] {
  const resolved = resolveSchema(document, schema)
  if (isUnionSchema(resolved)) {
    if (value === null) return []
    const variant = selectedVariant(
      resolved,
      value,
      unionVariants(document, resolved)
    )
    return variant
      ? collectSchemaIssues(document, variant.schema, value, path)
      : [`${path} 的取值类型无效。`]
  }
  if (resolved.type === 'object' || resolved.properties) {
    if (!isRecord(value)) return [`${path} 必须是对象。`]
    const required = new Set(resolved.required ?? [])
    const issues: string[] = []
    for (const key of required) {
      if (isBlank(value[key]))
        issues.push(`请填写 ${resolved.properties?.[key]?.title ?? key}。`)
    }
    for (const [key, property] of Object.entries(resolved.properties ?? {})) {
      if (value[key] === undefined) continue
      issues.push(
        ...collectSchemaIssues(
          document,
          property,
          value[key],
          `${path}.${key}`
        )
      )
    }
    return issues
  }
  if (resolved.type === 'array') {
    if (!Array.isArray(value)) return [`${path} 必须是数组。`]
    const issues: string[] = []
    if (resolved.minItems !== undefined && value.length < resolved.minItems)
      issues.push(`${path} 至少需要 ${resolved.minItems} 项。`)
    value.forEach((item, index) => {
      if (resolved.items)
        issues.push(
          ...collectSchemaIssues(
            document,
            resolved.items,
            item,
            `${path}[${index}]`
          )
        )
    })
    return issues
  }
  if (resolved.enum && !resolved.enum.some((item) => item === value)) {
    return [`${path} 的值不在 schema 枚举内。`]
  }
  if (
    (resolved.type === 'number' || resolved.type === 'integer') &&
    typeof value === 'number'
  ) {
    if (
      resolved.minimum !== undefined && value < resolved.minimum ||
      resolved.exclusiveMinimum !== undefined &&
        value <= resolved.exclusiveMinimum ||
      resolved.maximum !== undefined && value > resolved.maximum ||
      resolved.exclusiveMaximum !== undefined &&
        value >= resolved.exclusiveMaximum
    ) {
      return [`${path} 超出 schema 允许的数值范围。`]
    }
  }
  return []
}

function fieldId(path: string) {
  return `sop-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

function displayValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function JsonInput({
  label,
  value,
  path,
  onChange,
  onError,
}: {
  label: string
  value: unknown
  path: string
  onChange: (value: unknown) => void
  onError: (path: string, error: string) => void
}) {
  const serialized = JSON.stringify(value ?? null, null, 2)
  const [text, setText] = React.useState(serialized)

  return (
    <div className='space-y-2'>
      <Label htmlFor={fieldId(path)}>{label}</Label>
      <Textarea
        id={fieldId(path)}
        className='min-h-28 font-mono text-xs'
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          try {
            onChange(next.trim() ? JSON.parse(next) : null)
            onError(path, '')
          } catch {
            onError(path, `${label} 必须是有效 JSON。`)
          }
        }}
      />
    </div>
  )
}

function ChatModelConfigInput({
  path,
  value,
  resources,
  onChange,
  onError,
}: {
  path: string
  value: unknown
  resources: SchemaEditorResources
  onChange: (value: unknown) => void
  onError: (path: string, error: string) => void
}) {
  const current = isRecord(value) ? value : {}
  const selectedCredential = resources.credentials.find(
    (item) => item.id === current.credential_id
  )
  const set = (key: string, next: unknown) =>
    onChange({ ...current, [key]: next })

  return (
    <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor={`${fieldId(path)}-credential`}>凭据</Label>
          <select
            id={`${fieldId(path)}-credential`}
            className={selectClass}
            value={displayValue(current.credential_id)}
            onChange={(event) => {
              const credential = resources.credentials.find(
                (item) => item.id === event.target.value
              )
              onChange({
                ...current,
                credential_id: event.target.value,
                type: credential?.type || String(current.type ?? ''),
              })
            }}
          >
            <option value=''>请选择凭据</option>
            {resources.credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.name}
              </option>
            ))}
            {Boolean(current.credential_id) &&
              !resources.credentials.some(
                (item) => item.id === current.credential_id
              ) && (
                <option value={String(current.credential_id)}>
                  {String(current.credential_id)}
                </option>
              )}
          </select>
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${fieldId(path)}-type`}>Provider Type</Label>
          <Input
            id={`${fieldId(path)}-type`}
            value={displayValue(current.type)}
            onChange={(event) => set('type', event.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${fieldId(path)}-model`}>模型</Label>
          <Input
            id={`${fieldId(path)}-model`}
            value={displayValue(current.model)}
            placeholder={selectedCredential?.type ?? '例如 gpt-4o-mini'}
            onChange={(event) => set('model', event.target.value)}
          />
        </div>
      </div>
      <JsonInput
        label='模型参数 JSON'
        path={`${path}.parameters`}
        value={current.parameters ?? {}}
        onChange={(next) => set('parameters', next ?? {})}
        onError={onError}
      />
    </div>
  )
}

function SchemaFieldInput({
  name,
  path,
  schema,
  value,
  required,
  resources,
  onChange,
  onError,
}: {
  name: string
  path: string
  schema: JsonSchema
  value: unknown
  required: boolean
  resources: SchemaEditorResources
  onChange: (value: unknown) => void
  onError: (path: string, error: string) => void
}) {
  const label = schema.title ?? name.replace(/_/g, ' ')
  const id = fieldId(path)
  const type = schema.type ?? 'string'
  const isAgentId = /(^|\.)agent_id$/.test(path)

  if (/\.chat_model_config$/.test(path) || path === 'chat_model_config') {
    return (
      <div className='space-y-2'>
        <Label>{label}{required ? ' *' : ''}</Label>
        <ChatModelConfigInput
          path={path}
          value={value}
          resources={resources}
          onChange={onChange}
          onError={onError}
        />
        {schema.description && (
          <p className='text-xs text-muted-foreground'>{schema.description}</p>
        )}
      </div>
    )
  }

  if (schema.enum?.length) {
    return (
      <div className='space-y-2'>
        <Label htmlFor={id}>
          {label}
          {required ? ' *' : ''}
        </Label>
        <select
          id={id}
          className={selectClass}
          value={displayValue(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value=''>请选择</option>
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (type === 'boolean') {
    return (
      <label className='flex items-start gap-3 text-sm' htmlFor={id}>
        <Checkbox
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
        <span>
          <span className='font-medium'>{label}</span>
          {schema.description && (
            <span className='mt-1 block text-xs text-muted-foreground'>
              {schema.description}
            </span>
          )}
        </span>
      </label>
    )
  }

  if (isAgentId) {
    return (
      <div className='space-y-2'>
        <Label htmlFor={id}>
          {label}
          {required ? ' *' : ''}
        </Label>
        <select
          id={id}
          className={selectClass}
          value={displayValue(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value=''>请选择 Agent</option>
          {resources.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
          {Boolean(value) &&
            !resources.agents.some((agent) => agent.id === String(value)) && (
              <option value={String(value)}>{String(value)}</option>
            )}
        </select>
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </Label>
      <Input
        id={id}
        type={
          schema.format === 'password'
            ? 'password'
            : type === 'number' || type === 'integer'
              ? 'number'
              : 'text'
        }
        value={displayValue(value)}
        placeholder={schema.description}
        onChange={(event) => {
          const raw = event.target.value
          if (type === 'integer' || type === 'number')
            onChange(raw === '' ? undefined : Number(raw))
          else onChange(raw)
        }}
      />
      {schema.description && (
        <p className='text-xs text-muted-foreground'>{schema.description}</p>
      )}
    </div>
  )
}

function SchemaNode({
  document,
  schema,
  value,
  path,
  resources,
  onChange,
  onError,
}: {
  document: JsonObject
  schema: JsonSchema
  value: unknown
  path: string
  resources: SchemaEditorResources
  onChange: (value: unknown) => void
  onError: (path: string, error: string) => void
}) {
  const resolved = resolveSchema(document, schema)

  if (isUnionSchema(resolved)) {
    const variants = unionVariants(document, resolved)
    const propertyName = resolved.discriminator?.propertyName
    const active = selectedVariant(resolved, value, variants)
    return (
      <div className='space-y-3 rounded-md border p-3'>
        <div className='space-y-2'>
          <Label htmlFor={`${fieldId(path)}-variant`}>
            {resolved.title ?? path.split('.').pop()}
          </Label>
          <select
            id={`${fieldId(path)}-variant`}
            className={selectClass}
            value={
              active
                ? String(variantKey(active.schema, propertyName) ?? active.index)
                : 'null'
            }
            onChange={(event) => {
              if (event.target.value === 'null') {
                onChange(null)
                return
              }
              const variant = variants.find(
                (item) =>
                  String(variantKey(item.schema, propertyName) ?? item.index) ===
                  event.target.value
              )
              if (variant) onChange(schemaDefault(document, variant.schema))
            }}
          >
            <option value='null'>无</option>
            {variants
              .filter((variant) => variant.schema.type !== 'null')
              .map((variant) => {
                const key = String(
                  variantKey(variant.schema, propertyName) ?? variant.index
                )
                return (
                  <option key={key} value={key}>
                    {variant.schema.title ?? key}
                  </option>
                )
              })}
          </select>
          {resolved.description && (
            <p className='text-xs text-muted-foreground'>
              {resolved.description}
            </p>
          )}
        </div>
        {active && (
          <SchemaNode
            document={document}
            schema={active.schema}
            value={value}
            path={path}
            resources={resources}
            onChange={onChange}
            onError={onError}
          />
        )}
      </div>
    )
  }

  if (resolved.type === 'array') {
    const items = Array.isArray(value) ? value : []
    return (
      <div className='space-y-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <h3 className='text-sm font-medium'>
              {resolved.title ?? path.split('.').pop()}
            </h3>
            {resolved.description && (
              <p className='text-xs text-muted-foreground'>
                {resolved.description}
              </p>
            )}
          </div>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() =>
              onChange([
                ...items,
                resolved.items
                  ? schemaDefault(document, resolved.items)
                  : null,
              ])
            }
          >
            <Plus className='mr-1 size-3.5' />
            添加
          </Button>
        </div>
        {items.map((item, index) => (
          <div key={index} className='space-y-2 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs font-medium text-muted-foreground'>
                #{index + 1}
              </span>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='text-destructive'
                onClick={() =>
                  onChange(items.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 className='size-4' />
              </Button>
            </div>
            <SchemaNode
              document={document}
              schema={resolved.items ?? {}}
              value={item}
              path={`${path}[${index}]`}
              resources={resources}
              onChange={(next) =>
                onChange(
                  items.map((old, itemIndex) =>
                    itemIndex === index ? next : old
                  )
                )
              }
              onError={onError}
            />
          </div>
        ))}
      </div>
    )
  }

  if (resolved.type === 'object' || resolved.properties) {
    const current = isRecord(value) ? value : {}
    const properties = Object.entries(resolved.properties ?? {})
    const additionalSchema =
      resolved.additionalProperties && resolved.additionalProperties !== true
        ? resolved.additionalProperties
        : undefined

    if (!properties.length && !additionalSchema) {
      return (
        <JsonInput
          label={resolved.title ?? path.split('.').pop() ?? 'JSON'}
          value={current}
          path={path}
          onChange={onChange}
          onError={onError}
        />
      )
    }

    const known = new Set(properties.map(([key]) => key))
    const mapEntries = Object.entries(current).filter(
      ([key]) => !known.has(key)
    )

    return (
      <div className='space-y-4'>
        {properties.length > 0 && (
          <div className='grid gap-4 sm:grid-cols-2'>
            {properties.map(([key, property]) => {
              if (property.const !== undefined || property.type === 'null')
                return null
              return (
                <div
                  key={key}
                  className={
                    property.type === 'object' ||
                    property.type === 'array' ||
                    property.$ref
                      ? 'sm:col-span-2'
                      : undefined
                  }
                >
                  <SchemaNode
                    document={document}
                    schema={property}
                    value={current[key] ?? schemaDefault(document, property)}
                    path={`${path}.${key}`}
                    resources={resources}
                    onChange={(next) => onChange({ ...current, [key]: next })}
                    onError={onError}
                  />
                </div>
              )
            })}
          </div>
        )}
        {additionalSchema && (
          <div className='space-y-3 rounded-md border p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <h3 className='text-sm font-medium'>
                  {resolved.title ?? '映射配置'}
                </h3>
                <p className='text-xs text-muted-foreground'>
                  键名来自步骤中的 session key。
                </p>
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => {
                  const key = `session-${mapEntries.length + 1}`
                  onChange({
                    ...current,
                    [key]: schemaDefault(document, additionalSchema),
                  })
                }}
              >
                <Plus className='mr-1 size-3.5' />
                添加键
              </Button>
            </div>
            {mapEntries.map(([key, item]) => (
              <div key={key} className='space-y-2 rounded-md bg-muted/30 p-3'>
                <div className='flex items-end gap-2'>
                  <div className='flex-1 space-y-2'>
                    <Label htmlFor={`${fieldId(path)}-${key}-name`}>键名</Label>
                    <Input
                      id={`${fieldId(path)}-${key}-name`}
                      value={key}
                      onChange={(event) => {
                        const nextKey = event.target.value
                        if (!nextKey || mapEntries.some(([name]) => name === nextKey))
                          return
                        const next = { ...current }
                        delete next[key]
                        onChange({ ...next, [nextKey]: item })
                      }}
                    />
                  </div>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='text-destructive'
                    onClick={() => {
                      const next = { ...current }
                      delete next[key]
                      onChange(next)
                    }}
                  >
                    <Trash2 className='size-4' />
                  </Button>
                </div>
                <SchemaNode
                  document={document}
                  schema={additionalSchema}
                  value={item}
                  path={`${path}.${key}`}
                  resources={resources}
                  onChange={(next) => onChange({ ...current, [key]: next })}
                  onError={onError}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <SchemaFieldInput
      name={path.split('.').pop() ?? 'value'}
      path={path}
      schema={resolved}
      value={value}
      required={false}
      resources={resources}
      onChange={onChange}
      onError={onError}
    />
  )
}

export function SchemaDrivenEditor({
  schema,
  value,
  resources,
  onChange,
  onValidationChange,
}: {
  schema: JsonObject
  value: unknown
  resources: SchemaEditorResources
  onChange: (value: unknown) => void
  onValidationChange: (invalid: boolean) => void
}) {
  const [jsonErrors, setJsonErrors] = React.useState<Record<string, string>>({})
  const issues = React.useMemo(
    () => collectSchemaIssues(schema, schema, value),
    [schema, value]
  )
  const jsonIssueList = Object.entries(jsonErrors).filter(
    ([, error]) => error
  )
  const invalid = Boolean(issues.length || jsonIssueList.length)

  React.useEffect(() => {
    onValidationChange(invalid)
  }, [invalid, onValidationChange])

  return (
    <div className='space-y-4'>
      <SchemaNode
        document={schema}
        schema={schema}
        value={value}
        path='data'
        resources={resources}
        onChange={onChange}
        onError={(path, error) =>
          setJsonErrors((current) => ({ ...current, [path]: error }))
        }
      />
      {(issues.length > 0 || jsonIssueList.length > 0) && (
        <div role='alert' className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
          <ul className='list-inside list-disc space-y-1'>
            {[...issues, ...jsonIssueList.map(([, error]) => error)].map(
              (issue, index) => (
                <li key={`${issue}-${index}`}>{issue}</li>
              )
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

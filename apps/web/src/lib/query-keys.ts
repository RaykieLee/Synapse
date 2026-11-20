export type QueryKeyScope = {
  actorId: string
  tenantId?: string | null
  workspaceId?: string | null
  membershipVersion?: number | string | null
}

export type QueryKey = readonly unknown[]
export type QueryResourcePath = string | readonly string[]
export type QueryKeyParams = Readonly<Record<string, unknown>>

type WorkspaceScopeSource = {
  tenant_id: string
  workspace_id: string
  membership_version?: number
}

function assertScope(scope: QueryKeyScope) {
  if (!scope.actorId.trim()) {
    throw new Error('Query keys require an actor ID.')
  }
  if (scope.workspaceId != null && scope.tenantId == null) {
    throw new Error('Workspace query keys require a tenant ID.')
  }
}

function resourceParts(resource: QueryResourcePath): readonly string[] {
  const parts = typeof resource === 'string' ? [resource] : resource
  if (parts.length === 0 || parts.some((part) => !part.trim())) {
    throw new Error('Query keys require a non-empty resource path.')
  }
  return parts
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, normalizeValue(entry)] as const)
    return Object.fromEntries(entries)
  }
  return value
}

export function normalizeQueryKeyParams(
  params: QueryKeyParams = {}
): Record<string, unknown> {
  return normalizeValue(params) as Record<string, unknown>
}

export function queryScopeKey(scope: QueryKeyScope) {
  assertScope(scope)
  return [
    'synapse',
    scope.actorId,
    scope.tenantId ?? 'global',
    scope.workspaceId ?? 'personal',
  ] as const
}

export function queryContextKey(scope: QueryKeyScope) {
  return [
    ...queryScopeKey(scope),
    'membership',
    scope.membershipVersion ?? 'unversioned',
  ] as const
}

export function queryDomainKey(scope: QueryKeyScope, domain: string) {
  if (!domain.trim()) throw new Error('Query keys require a domain.')
  return [...queryContextKey(scope), domain] as const
}

export function queryResourceKey(
  scope: QueryKeyScope,
  domain: string,
  resource: QueryResourcePath
) {
  return [...queryDomainKey(scope, domain), ...resourceParts(resource)] as const
}

export function createQueryKey(
  scope: QueryKeyScope,
  domain: string,
  resource: QueryResourcePath,
  params: QueryKeyParams = {}
) {
  return [
    ...queryResourceKey(scope, domain, resource),
    normalizeQueryKeyParams(params),
  ] as const
}

export function extendQueryKey(key: QueryKey, ...segments: readonly unknown[]) {
  return [...key, ...segments] as const
}

export function actorQueryScope(actorId: string): QueryKeyScope {
  return { actorId }
}

export function workspaceQueryScope(
  actorId: string,
  workspace: WorkspaceScopeSource
): QueryKeyScope {
  return {
    actorId,
    tenantId: workspace.tenant_id,
    workspaceId: workspace.workspace_id,
    membershipVersion: workspace.membership_version ?? 0,
  }
}

function domainFactory(domain: string) {
  return {
    domain: (scope: QueryKeyScope) => queryDomainKey(scope, domain),
    resource: (scope: QueryKeyScope, resource: QueryResourcePath) =>
      queryResourceKey(scope, domain, resource),
    query: (
      scope: QueryKeyScope,
      resource: QueryResourcePath,
      params?: QueryKeyParams
    ) => createQueryKey(scope, domain, resource, params),
  }
}

export const queryKeys = {
  scope: queryScopeKey,
  context: queryContextKey,
  domain: queryDomainKey,
  resource: queryResourceKey,
  query: createQueryKey,
  extend: extendQueryKey,
  actorScope: actorQueryScope,
  workspaceScope: workspaceQueryScope,
  tenant: domainFactory('tenant'),
  global: domainFactory('global'),
  workspace: domainFactory('workspace'),
  agentscope: domainFactory('agentscope'),
}

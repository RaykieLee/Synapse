import { describe, expect, it } from 'vitest'
import {
  workspaceProblemMessage,
  workspaceProblemState,
} from './problem-state'

describe('workspace API problem state mapping', () => {
  it.each([
    [400, 'WORKSPACE_CONTEXT_REQUIRED', 'context_required'],
    [400, 'CONTEXT_MISMATCH', 'context_mismatch'],
    [403, 'MEMBERSHIP_INACTIVE', 'tenant_membership_inactive'],
    [403, 'WORKSPACE_MEMBERSHIP_REQUIRED', 'workspace_membership_inactive'],
    [409, 'TENANT_INACTIVE', 'scope_inactive'],
    [409, 'WORKSPACE_INACTIVE', 'scope_inactive'],
    [403, 'FORBIDDEN', 'permission_denied'],
    [404, 'RESOURCE_NOT_FOUND', 'resource_unavailable'],
    [401, 'AUTHENTICATION_REQUIRED', 'session_expired'],
    [0, 'NETWORK_ERROR', 'context_unverified'],
    [0, 'REQUEST_TIMEOUT', 'context_unverified'],
  ] as const)('maps %i %s without changing its backend identity', (status, code, state) => {
    expect(workspaceProblemState(status, code)).toBe(state)
  })

  it('does not infer a membership state from a generic status', () => {
    expect(workspaceProblemState(403, 'UNRECOGNIZED')).toBe('request_failed')
    expect(workspaceProblemState(404, 'RESOURCE_NOT_FOUND')).toBe(
      'resource_unavailable'
    )
    expect(workspaceProblemState(409, 'TENANT_INACTIVE')).toBe('scope_inactive')
  })

  it('returns privacy-safe copy instead of backend detail for mapped failures', () => {
    expect(workspaceProblemMessage(404, 'RESOURCE_NOT_FOUND')).toBe(
      '内容不存在或不可用。'
    )
    expect(workspaceProblemMessage(403, 'WORKSPACE_MEMBERSHIP_REQUIRED')).not.toContain(
      'RESOURCE'
    )
    expect(workspaceProblemMessage(403, 'UNKNOWN')).toBeUndefined()
  })
})

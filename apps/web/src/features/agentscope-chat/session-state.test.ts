import { describe, expect, it } from 'vitest'
import {
  createSessionMachineState,
  scopeSessionMachineAction,
  sessionMachineReducer,
  sessionMachineScopeKey,
  type ChatSessionStatus,
  type SessionMachineAction,
  type SessionMachineScope,
  type SessionMachineState,
  type ScopedSessionMachineAction,
} from './session-state'

const baseScope: SessionMachineScope = {
  actorId: 'user-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  membershipVersion: 3,
  agentId: 'agent-1',
  sessionId: 'session-1',
  workspaceStatus: 'active',
}

const scopeMutations: Array<{
  label: string
  mutate: (scope: SessionMachineScope) => SessionMachineScope
}> = [
  { label: 'actor', mutate: (scope) => ({ ...scope, actorId: 'user-2' }) },
  { label: 'tenant', mutate: (scope) => ({ ...scope, tenantId: 'tenant-2' }) },
  {
    label: 'workspace',
    mutate: (scope) => ({ ...scope, workspaceId: 'workspace-2' }),
  },
  {
    label: 'membership version',
    mutate: (scope) => ({ ...scope, membershipVersion: 4 }),
  },
  { label: 'agent', mutate: (scope) => ({ ...scope, agentId: 'agent-2' }) },
  {
    label: 'session',
    mutate: (scope) => ({ ...scope, sessionId: 'session-2' }),
  },
  {
    label: 'workspace status',
    mutate: (scope) => ({ ...scope, workspaceStatus: 'archived' }),
  },
]

function createState(
  scope = baseScope,
  initialStatus: ChatSessionStatus = 'idle',
  initiallyRunning = false
): SessionMachineState {
  return createSessionMachineState({ scope, initialStatus, initiallyRunning })
}

function transition(
  state: SessionMachineState,
  action: ScopedSessionMachineAction
): SessionMachineState {
  return sessionMachineReducer(state, scopeSessionMachineAction(state.scope, action))
}

describe('shared session state machine', () => {
  it('allows send and retry after transient failure, but rejects illegal sends', () => {
    let state = createState()
    const emptySend = transition(state, { type: 'send/start' })
    expect(emptySend).toBe(state)

    state = transition(state, { type: 'composer/text-changed', value: 'draft' })
    state = transition(state, {
      type: 'composer/attachment-toggled',
      attachmentId: 'attachment-1',
    })
    state = transition(state, { type: 'send/start' })
    expect(state.submitting).toBe(true)
    expect(transition(state, { type: 'send/start' })).toBe(state)
    expect(
      transition(state, { type: 'composer/text-changed', value: 'late edit' }).text
    ).toBe('draft')

    state = transition(state, {
      type: 'send/failed',
      error: 'temporary outage',
    })
    expect(state.submitting).toBe(false)
    expect(state.sendError).toBe('temporary outage')
    expect(state.text).toBe('draft')
    expect(state.selectedAttachments).toEqual(['attachment-1'])

    state = transition(state, { type: 'send/start' })
    state = transition(state, { type: 'send/accepted' })
    expect(state.sending).toBe(true)
    expect(state.sessionStatus).toBe('running')
    expect(state.text).toBe('')
    expect(state.selectedAttachments).toEqual([])
  })

  it('keeps partial stream text across disconnect and deduplicates replayed events', () => {
    let state = createState()
    state = transition(state, { type: 'stream/connecting' })
    state = transition(state, { type: 'stream/connected' })
    state = transition(state, {
      type: 'stream/event',
      event: { id: 'reply-start', type: 'REPLY_START', reply_id: 'reply-1' },
    })
    const delta = {
      id: 'text-delta-1',
      type: 'TEXT_BLOCK_DELTA',
      reply_id: 'reply-1',
      block_id: 'block-1',
      delta: 'hello',
    }
    state = transition(state, { type: 'stream/event', event: delta })
    const afterFirstDelta = state
    state = transition(state, { type: 'stream/event', event: delta })
    expect(state).toBe(afterFirstDelta)
    expect(state.liveReplies[0]?.blocks[0]?.text).toBe('hello')

    state = transition(state, {
      type: 'stream/failed',
      error: 'connection lost',
    })
    expect(state.streamConnected).toBe(false)
    expect(state.streamError).toBe('connection lost')
    expect(state.liveReplies[0]?.blocks[0]?.text).toBe('hello')
    state = transition(state, { type: 'stream/retry' })
    expect(state.streamRetry).toBe(1)
    expect(state.streamError).toBe('')
    expect(state.liveReplies[0]?.blocks[0]?.text).toBe('hello')
  })

  it('interrupts only active runs and recovers from a failed interrupt', () => {
    let state = createState()
    const invalidInterrupt = transition(state, { type: 'interrupt/requested' })
    expect(invalidInterrupt).toBe(state)

    state = transition(state, {
      type: 'run/status-updated',
      status: 'running',
    })
    state = transition(state, { type: 'interrupt/requested' })
    expect(state.interruptPending).toBe(true)
    expect(state.sending).toBe(true)
    state = transition(state, {
      type: 'interrupt/failed',
      error: 'interrupt unavailable',
    })
    expect(state.interruptPending).toBe(true)
    expect(state.sending).toBe(true)
    expect(state.stopRequested).toBe(false)
    expect(state.sendError).toBe('interrupt unavailable')
    state = transition(state, { type: 'interrupt/settled' })
    expect(state.interruptPending).toBe(false)

    state = transition(state, {
      type: 'run/status-updated',
      status: 'idle',
    })
    expect(state.sending).toBe(false)
    expect(transition(state, { type: 'interrupt/requested' })).toBe(state)
  })

  it('deduplicates confirmations and preserves retryable versus stale outcomes', () => {
    let state = createState()
    const requestEvent = {
      id: 'confirm-1',
      type: 'REQUIRE_USER_CONFIRM',
      reply_id: 'reply-2',
      tool_calls: [{ id: 'tool-1', name: 'write_file', input: '{"path":"a"}' }],
    }
    state = transition(state, { type: 'stream/event', event: requestEvent })
    const request = state.confirmationRequests[0]
    expect(request?.key).toBe('reply-2:tool-1')
    expect(state.toolEvents[0]?.state).toBe('awaiting_confirmation')

    const afterRegistration = state
    state = transition(state, { type: 'stream/event', event: requestEvent })
    expect(state).toBe(afterRegistration)

    state = transition(state, {
      type: 'confirmation/begin',
      request: request!,
    })
    expect(state.confirmationRequests[0]?.status).toBe('submitting')
    state = transition(state, {
      type: 'confirmation/failed',
      request: request!,
      error: 'network error',
      sendError: '提交确认失败：network error',
      stale: false,
    })
    expect(state.confirmationRequests[0]?.status).toBe('pending')
    expect(state.confirmationRequests[0]?.error).toBe('network error')

    state = transition(state, {
      type: 'confirmation/begin',
      request: state.confirmationRequests[0]!,
    })
    state = transition(state, {
      type: 'confirmation/failed',
      request: state.confirmationRequests[0]!,
      error: 'request expired',
      sendError: '确认请求已失效，消息与运行状态已刷新。',
      stale: true,
    })
    expect(state.confirmationRequests[0]?.status).toBe('stale')
    expect(
      transition(state, {
        type: 'confirmation/begin',
        request: state.confirmationRequests[0]!,
      })
    ).toBe(state)
    state = transition(state, {
      type: 'confirmation/dismiss',
      key: 'reply-2:tool-1',
    })
    expect(state.confirmationRequests).toEqual([])
    expect(state.resolvedConfirmationKeys).toContain('reply-2:tool-1')
  })

  it('retains editable external results through retry and blocks late completion after denial', () => {
    let state = createState()
    state = transition(state, {
      type: 'stream/event',
      event: {
        id: 'external-1',
        type: 'REQUIRE_EXTERNAL_EXECUTION',
        reply_id: 'reply-4',
        tool_calls: [{ id: 'tool-2', name: 'deploy', input: '{"target":"test"}' }],
      },
    })
    const request = state.externalRequests[0]!
    state = transition(state, {
      type: 'external/edit',
      request,
      output: 'deployment result',
    })
    state = transition(state, {
      type: 'external/begin',
      request: { ...request, output: 'deployment result' },
    })
    state = transition(state, {
      type: 'external/failed',
      request,
      error: 'temporary outage',
      sendError: '提交外部结果失败：temporary outage',
      stale: false,
    })
    expect(state.externalRequests[0]?.status).toBe('pending')
    expect(state.externalRequests[0]?.output).toBe('deployment result')
    expect(state.externalRequests[0]?.error).toBe('temporary outage')

    state = transition(state, { type: 'access/denied' })
    const denied = state
    state = transition(state, { type: 'external/accepted', key: request.key })
    expect(state).toBe(denied)
    expect(state.externalRequests).toEqual([])
  })

  it('clears private draft state after denial and isolates session and membership scope changes', () => {
    let state = createState()
    state = transition(state, { type: 'composer/text-changed', value: 'private draft' })
    state = transition(state, {
      type: 'composer/attachment-toggled',
      attachmentId: 'private-file',
    })
    state = transition(state, {
      type: 'stream/event',
      event: {
        id: 'reply-start-2',
        type: 'REPLY_START',
        reply_id: 'reply-3',
      },
    })
    state = transition(state, {
      type: 'access/denied',
      confirmationKeys: ['historical-confirmation'],
    })
    expect(state.accessDenied).toBe(true)
    expect(state.text).toBe('')
    expect(state.selectedAttachments).toEqual([])
    expect(state.liveReplies).toEqual([])
    expect(state.resolvedConfirmationKeys).toContain('historical-confirmation')
    expect(transition(state, { type: 'send/start' })).toBe(state)

    const nextScope = {
      ...baseScope,
      workspaceId: 'workspace-2',
      membershipVersion: 4,
      agentId: 'agent-2',
      sessionId: 'session-2',
    }
    expect(sessionMachineScopeKey(nextScope)).not.toBe(
      sessionMachineScopeKey(baseScope)
    )
    state = sessionMachineReducer(state, {
      type: 'session/switch',
      scopeKey: sessionMachineScopeKey(state.scope),
      scope: nextScope,
      initialStatus: 'idle',
      initiallyRunning: false,
    })
    expect(state.scope).toEqual(nextScope)
    expect(state.accessDenied).toBe(false)
    expect(state.liveReplies).toEqual([])

    const staleAction = scopeSessionMachineAction(baseScope, {
      type: 'composer/text-changed',
      value: 'from previous workspace',
    })
    expect(sessionMachineReducer(state, staleAction)).toBe(state)

    const staleSwitch: SessionMachineAction = {
      type: 'session/switch',
      scopeKey: sessionMachineScopeKey(baseScope),
      scope: { ...nextScope, workspaceId: 'workspace-3', sessionId: 'session-3' },
      initialStatus: 'idle',
      initiallyRunning: false,
    }
    expect(sessionMachineReducer(state, staleSwitch)).toBe(state)
  })

  it('fails closed for actions without a scope key', () => {
    const state = transition(createState(), {
      type: 'composer/text-changed',
      value: 'active scope draft',
    })
    const unscopedAction = {
      type: 'composer/text-changed',
      value: 'unscoped draft',
    } as unknown as SessionMachineAction
    const unscopedSwitch = {
      type: 'session/switch',
      scope: { ...baseScope, workspaceId: 'workspace-2' },
      initialStatus: 'idle',
      initiallyRunning: false,
    } as unknown as SessionMachineAction

    expect(sessionMachineReducer(state, unscopedAction)).toBe(state)
    expect(sessionMachineReducer(state, unscopedSwitch)).toBe(state)
  })

  it.each(scopeMutations)(
    'rejects stale actions and switches when the $label changes',
    ({ mutate }) => {
      const state = transition(createState(), {
        type: 'composer/text-changed',
        value: 'active scope draft',
      })
      const staleScope = mutate(state.scope)
      const staleAction = scopeSessionMachineAction(staleScope, {
        type: 'composer/text-changed',
        value: 'stale scope draft',
      })
      const staleSwitch: SessionMachineAction = {
        type: 'session/switch',
        scopeKey: sessionMachineScopeKey(staleScope),
        scope: { ...state.scope, workspaceId: 'new-workspace' },
        initialStatus: 'idle',
        initiallyRunning: false,
      }

      expect(sessionMachineScopeKey(staleScope)).not.toBe(
        sessionMachineScopeKey(state.scope)
      )
      expect(sessionMachineReducer(state, staleAction)).toBe(state)
      expect(sessionMachineReducer(state, staleSwitch)).toBe(state)
      expect(state.text).toBe('active scope draft')
      expect(state.scope).toEqual(baseScope)
    }
  )

  it('uses identical transition behavior for both chat surfaces with their own scope', () => {
    const workspacesSessionScope: SessionMachineScope = {
      ...baseScope,
      workspaceId: 'workspace-2',
      sessionId: 'workspace-session',
    }
    const agentScopeChat = transition(createState(), {
      type: 'composer/text-changed',
      value: 'AgentScope draft',
    })
    const workspaceChat = transition(createState(workspacesSessionScope), {
      type: 'composer/text-changed',
      value: 'Workspace draft',
    })
    expect(agentScopeChat.text).toBe('AgentScope draft')
    expect(workspaceChat.text).toBe('Workspace draft')
    expect(workspaceChat.scope.workspaceId).toBe('workspace-2')
    expect(workspaceChat.scope.actorId).toBe(baseScope.actorId)
    expect(workspaceChat.scope.tenantId).toBe(baseScope.tenantId)
  })
})

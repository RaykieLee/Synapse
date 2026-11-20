export type ChatSessionStatus =
  | 'running'
  | 'idle'
  | 'awaiting_permission'
  | 'awaiting_external_result'

export type SessionMachineScope = {
  actorId: string
  tenantId: string
  workspaceId: string
  membershipVersion: number
  agentId: string
  sessionId: string
  workspaceStatus: 'active' | 'archived'
}

export type SessionMachineInitialState = {
  scope: SessionMachineScope
  initialStatus: ChatSessionStatus
  initiallyRunning: boolean
}

export type PendingToolCall = {
  type?: 'tool_call'
  id: string
  name: string
  input: string
  state?: string
  suggested_rules?: unknown[]
  created_at?: string
  finished_at?: string | null
}

export type PendingConfirmation = {
  key: string
  replyId: string
  toolCall: PendingToolCall
  status: 'pending' | 'submitting' | 'stale'
  error?: string
}

export type PendingExternalResult = {
  key: string
  replyId: string
  toolCall: PendingToolCall
  status: 'pending' | 'submitting' | 'stale'
  output: string
  error?: string
}

export type ToolExecution = {
  id: string
  replyId: string
  name: string
  state:
    | 'requesting'
    | 'awaiting_confirmation'
    | 'awaiting_external_result'
    | 'running'
    | 'success'
    | 'error'
    | 'interrupted'
    | 'denied'
    | 'finished'
  startedAt?: string
  finishedAt?: string
  argumentsSummary?: string
  resultText?: string
  resultTruncated?: boolean
}

export type LiveReply = {
  id: string
  name: string
  blocks: Array<{ id: string; text: string }>
}

export type SessionStreamEvent = {
  id?: string
  sequence?: number
  seq?: number
  payload?: string | SessionStreamEvent
  type?: string
  reply_id?: string
  block_id?: string
  tool_call_id?: string
  tool_call_name?: string
  delta?: string
  text?: string | null
  state?: string
  media_type?: string
  name?: string
  data?: string | null
  created_at?: string
  tool_calls?: PendingToolCall[]
  execution_results?: Array<{ id: string }>
  confirm_results?: Array<{ confirmed: boolean; tool_call: { id: string } }>
  value?: {
    event_type?: string
    reply_id?: string
    event?: SessionStreamEvent
    worker_session_id?: string
  }
}

export type SessionMachineState = {
  scope: SessionMachineScope
  sessionStatus: ChatSessionStatus
  text: string
  selectedAttachments: string[]
  sending: boolean
  submitting: boolean
  sendError: string
  accessDenied: boolean
  streamError: string
  streamConnected: boolean
  streamRetry: number
  liveReplies: LiveReply[]
  toolEvents: ToolExecution[]
  confirmationRequests: PendingConfirmation[]
  externalRequests: PendingExternalResult[]
  resolvedConfirmationKeys: string[]
  resolvedExternalKeys: string[]
  seenEventIds: string[]
  toolCallBuffers: Record<string, string>
  interruptPending: boolean
  interruptWasRunning: boolean
  stopRequested: boolean
}

type SessionMachineActionPayload =
  | {
      type: 'session/switch'
      scope: SessionMachineScope
      initialStatus: ChatSessionStatus
      initiallyRunning: boolean
    }
  | { type: 'composer/text-changed'; value: string }
  | { type: 'composer/attachments-replaced'; attachmentIds: string[] }
  | { type: 'composer/attachment-toggled'; attachmentId: string }
  | { type: 'send/start' }
  | { type: 'send/accepted' }
  | {
      type: 'send/failed'
      error: string
      accessDenied?: boolean
      confirmationKeys?: string[]
      externalKeys?: string[]
    }
  | { type: 'send/settled' }
  | { type: 'send/clear-error' }
  | { type: 'run/status-updated'; status: ChatSessionStatus }
  | {
      type: 'run/status-failed'
      error: string
      accessDenied?: boolean
      confirmationKeys?: string[]
      externalKeys?: string[]
    }
  | { type: 'run/resumed' }
  | { type: 'interrupt/requested' }
  | { type: 'interrupt/accepted' }
  | {
      type: 'interrupt/failed'
      error: string
      accessDenied?: boolean
      confirmationKeys?: string[]
      externalKeys?: string[]
    }
  | { type: 'interrupt/settled' }
  | { type: 'stream/connecting' }
  | { type: 'stream/connected' }
  | { type: 'stream/failed'; error: string }
  | { type: 'stream/retry' }
  | {
      type: 'stream/event'
      event: SessionStreamEvent
      historyConfirmationKeys?: string[]
      historyExternalKeys?: string[]
    }
  | { type: 'confirmation/begin'; request: PendingConfirmation }
  | { type: 'confirmation/accepted'; key: string }
  | {
      type: 'confirmation/failed'
      request: PendingConfirmation
      error: string
      sendError?: string
      stale: boolean
      accessDenied?: boolean
      confirmationKeys?: string[]
      externalKeys?: string[]
    }
  | { type: 'confirmation/dismiss'; key: string }
  | {
      type: 'external/edit'
      request: PendingExternalResult
      output: string
    }
  | {
      type: 'external/invalid'
      request: PendingExternalResult
      error: string
    }
  | { type: 'external/begin'; request: PendingExternalResult }
  | { type: 'external/accepted'; key: string }
  | {
      type: 'external/failed'
      request: PendingExternalResult
      error: string
      sendError?: string
      stale: boolean
      accessDenied?: boolean
      confirmationKeys?: string[]
      externalKeys?: string[]
    }
  | { type: 'external/dismiss'; key: string }
  | {
      type: 'access/denied'
      confirmationKeys?: string[]
      externalKeys?: string[]
    }

export type SessionMachineAction = SessionMachineActionPayload & {
  scopeKey: string
}

export type ScopedSessionMachineAction = Exclude<
  SessionMachineActionPayload,
  { type: 'session/switch' }
>

export const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_TOOL_ARGUMENTS_CHARS = 1200
export const MAX_TOOL_RESULT_CHARS = 6000
export const MAX_EXTERNAL_RESULT_CHARS = 4000

const MAX_SEEN_EVENT_IDS = 5000

export function sessionMachineScopeKey(scope: SessionMachineScope): string {
  return JSON.stringify([
    scope.actorId,
    scope.tenantId,
    scope.workspaceId,
    scope.membershipVersion,
    scope.agentId,
    scope.sessionId,
    scope.workspaceStatus,
  ])
}

export function scopeSessionMachineAction(
  scope: SessionMachineScope,
  action: ScopedSessionMachineAction
): SessionMachineAction {
  return { ...action, scopeKey: sessionMachineScopeKey(scope) }
}

export function createSessionMachineState({
  scope,
  initialStatus,
  initiallyRunning,
}: SessionMachineInitialState): SessionMachineState {
  return {
    scope,
    sessionStatus: initialStatus,
    text: '',
    selectedAttachments: [],
    sending: initiallyRunning,
    submitting: false,
    sendError: '',
    accessDenied: false,
    streamError: '',
    streamConnected: false,
    streamRetry: 0,
    liveReplies: [],
    toolEvents: [],
    confirmationRequests: [],
    externalRequests: [],
    resolvedConfirmationKeys: [],
    resolvedExternalKeys: [],
    seenEventIds: [],
    toolCallBuffers: {},
    interruptPending: false,
    interruptWasRunning: false,
    stopRequested: false,
  }
}

export function sessionStreamEventKey(event: SessionStreamEvent): string | undefined {
  if (event.id) return `id:${event.id}`
  const sequence = event.sequence ?? event.seq
  return typeof sequence === 'number'
    ? `seq:${event.reply_id ?? ''}:${sequence}`
    : undefined
}

export function redactToolText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      '[已隐藏的私钥]'
    )
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]')
    .replace(
      /((?:password|passwd|passphrase|token|secret|credential|api[_-]?key|authorization|cookie|private[_-]?key)\s*["']?\s*[:=]\s*["']?)[^"'\s,}\]]+/gi,
      '$1[已隐藏]'
    )
}

function safeToolValue(value: unknown, key = ''): unknown {
  if (
    /(password|passwd|passphrase|token|secret|credential|api[_-]?key|authorization|cookie|private[_-]?key)/i.test(
      key
    )
  )
    return '[已隐藏]'
  if (typeof value === 'string') return redactToolText(value).slice(0, 240)
  if (Array.isArray(value))
    return value.slice(0, 8).map((item) => safeToolValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([childKey, child]) => [childKey, safeToolValue(child, childKey)])
    )
  }
  return value
}

export function summarizeToolArguments(raw: string): string {
  try {
    return JSON.stringify(safeToolValue(JSON.parse(raw))).slice(
      0,
      MAX_TOOL_ARGUMENTS_CHARS
    )
  } catch {
    return '参数摘要不可用'
  }
}

export function summarizeToolResult(output: unknown): {
  text: string
  truncated: boolean
} {
  let text: string
  if (typeof output === 'string') text = output
  else if (Array.isArray(output)) {
    text = output
      .map((block) => {
        if (
          block &&
          typeof block === 'object' &&
          'text' in block &&
          typeof block.text === 'string'
        )
          return block.text
        if (
          block &&
          typeof block === 'object' &&
          ('media_type' in block || 'type' in block)
        ) {
          const mediaType =
            'media_type' in block && typeof block.media_type === 'string'
              ? block.media_type
              : '附件'
          const name =
            'name' in block && typeof block.name === 'string'
              ? ` ${block.name}`
              : ''
          return `[已隐藏附件内容：${mediaType}${name}]`
        }
        return '[已隐藏非文本结果]'
      })
      .join('\n')
  } else text = ''
  const sanitized = redactToolText(text)
  return {
    text: sanitized.slice(0, MAX_TOOL_RESULT_CHARS),
    truncated: sanitized.length > MAX_TOOL_RESULT_CHARS,
  }
}

function ensureToolExecution(
  items: ToolExecution[],
  id: string,
  replyId: string,
  name: string
): ToolExecution[] {
  return items.some((item) => item.id === id)
    ? items
    : [...items, { id, replyId, name: name || '工具', state: 'requesting' }]
}

function ensureLiveReply(replies: LiveReply[], id: string): LiveReply[] {
  return replies.some((reply) => reply.id === id)
    ? replies
    : [...replies, { id, name: '智能体', blocks: [] }]
}

function addUnique(values: string[], additions: string[]): string[] {
  if (additions.length === 0) return values
  const next = new Set(values)
  for (const value of additions) next.add(value)
  return [...next]
}

function resolveReplyRequests(
  state: SessionMachineState,
  replyId: string,
  historyConfirmationKeys: string[] = [],
  historyExternalKeys: string[] = []
): SessionMachineState {
  const confirmationKeys = state.confirmationRequests
    .filter((item) => item.replyId === replyId)
    .map((item) => item.key)
  const externalKeys = state.externalRequests
    .filter((item) => item.replyId === replyId)
    .map((item) => item.key)
  return {
    ...state,
    confirmationRequests: state.confirmationRequests.filter(
      (item) => item.replyId !== replyId
    ),
    externalRequests: state.externalRequests.filter(
      (item) => item.replyId !== replyId
    ),
    resolvedConfirmationKeys: addUnique(state.resolvedConfirmationKeys, [
      ...confirmationKeys,
      ...historyConfirmationKeys,
    ]),
    resolvedExternalKeys: addUnique(state.resolvedExternalKeys, [
      ...externalKeys,
      ...historyExternalKeys,
    ]),
  }
}

function denyAccess(
  state: SessionMachineState,
  confirmationKeys: string[] = [],
  externalKeys: string[] = []
): SessionMachineState {
  return {
    ...state,
    text: '',
    selectedAttachments: [],
    sending: false,
    submitting: false,
    accessDenied: true,
    liveReplies: [],
    toolEvents: [],
    confirmationRequests: [],
    externalRequests: [],
    resolvedConfirmationKeys: addUnique(
      state.resolvedConfirmationKeys,
      confirmationKeys
    ),
    resolvedExternalKeys: addUnique(state.resolvedExternalKeys, externalKeys),
    toolCallBuffers: {},
    interruptPending: false,
    interruptWasRunning: false,
    stopRequested: false,
  }
}

function registerConfirmationCalls(
  state: SessionMachineState,
  replyId: string,
  calls: PendingToolCall[]
): SessionMachineState {
  const requests = [...state.confirmationRequests]
  let toolEvents = state.toolEvents
  for (const call of calls) {
    if (
      !call ||
      typeof call.id !== 'string' ||
      typeof call.name !== 'string' ||
      typeof call.input !== 'string'
    )
      continue
    const key = `${replyId}:${call.id}`
    if (
      state.resolvedConfirmationKeys.includes(key) ||
      requests.some((item) => item.key === key)
    )
      continue
    requests.push({ key, replyId, toolCall: call, status: 'pending' })
    toolEvents = ensureToolExecution(toolEvents, call.id, replyId, call.name).map(
      (item) =>
        item.id === call.id
          ? {
              ...item,
              replyId,
              name: call.name,
              state: 'awaiting_confirmation',
              argumentsSummary: summarizeToolArguments(call.input),
            }
          : item
    )
  }
  return { ...state, confirmationRequests: requests, toolEvents }
}

function registerExternalCalls(
  state: SessionMachineState,
  replyId: string,
  calls: PendingToolCall[]
): SessionMachineState {
  const requests = [...state.externalRequests]
  let toolEvents = state.toolEvents
  for (const call of calls) {
    if (
      !call ||
      typeof call.id !== 'string' ||
      typeof call.name !== 'string' ||
      typeof call.input !== 'string'
    )
      continue
    const key = `${replyId}:${call.id}`
    if (
      state.resolvedExternalKeys.includes(key) ||
      requests.some((item) => item.key === key)
    )
      continue
    requests.push({
      key,
      replyId,
      toolCall: call,
      status: 'pending',
      output: '',
    })
    toolEvents = ensureToolExecution(toolEvents, call.id, replyId, call.name).map(
      (item) =>
        item.id === call.id
          ? {
              ...item,
              replyId,
              name: call.name,
              state: 'awaiting_external_result',
              argumentsSummary: summarizeToolArguments(call.input),
            }
          : item
    )
  }
  return { ...state, externalRequests: requests, toolEvents }
}

function applyStreamEvent(
  originalState: SessionMachineState,
  event: SessionStreamEvent,
  historyConfirmationKeys: string[] = [],
  historyExternalKeys: string[] = []
): SessionMachineState {
  if (originalState.accessDenied) return originalState
  const eventKey = sessionStreamEventKey(event)
  if (eventKey && originalState.seenEventIds.includes(eventKey))
    return originalState
  const state = eventKey
    ? {
        ...originalState,
        seenEventIds: [
          ...originalState.seenEventIds,
          eventKey,
        ].slice(-MAX_SEEN_EVENT_IDS),
      }
    : originalState

  if (!event || typeof event.type !== 'string') return state

  if (
    event.type === 'CUSTOM' &&
    event.name === 'subagent_require_user_confirm'
  ) {
    const projected = event.value?.event
    const replyId = projected?.reply_id ?? event.value?.reply_id
    const calls = projected?.tool_calls ?? []
    if (!replyId) return state
    return event.value?.event_type === 'require_external_execution'
      ? registerExternalCalls(state, replyId, calls)
      : registerConfirmationCalls(state, replyId, calls)
  }

  if (
    event.type === 'CUSTOM' &&
    event.name === 'subagent_user_confirm_result'
  ) {
    const replyId = event.value?.reply_id
    if (!replyId) return state
    return {
      ...resolveReplyRequests(
        state,
        replyId,
        historyConfirmationKeys,
        historyExternalKeys
      ),
      sessionStatus: 'running',
      sending: true,
    }
  }

  if (event.type === 'REQUIRE_USER_CONFIRM' && event.reply_id)
    return registerConfirmationCalls(state, event.reply_id, event.tool_calls ?? [])

  if (event.type === 'REQUIRE_EXTERNAL_EXECUTION' && event.reply_id)
    return registerExternalCalls(state, event.reply_id, event.tool_calls ?? [])

  if (event.type === 'EXTERNAL_EXECUTION_RESULT' && event.reply_id) {
    const keys = (event.execution_results ?? []).map(
      (result) => `${event.reply_id}:${result.id}`
    )
    const resolved = addUnique(state.resolvedExternalKeys, keys)
    return {
      ...state,
      externalRequests: state.externalRequests.filter(
        (item) => !resolved.includes(item.key)
      ),
      resolvedExternalKeys: resolved,
      sessionStatus: 'running',
      sending: true,
    }
  }

  if (event.type === 'USER_CONFIRM_RESULT' && event.reply_id) {
    const keys = (event.confirm_results ?? []).map(
      (result) => `${event.reply_id}:${result.tool_call.id}`
    )
    const resolved = addUnique(state.resolvedConfirmationKeys, keys)
    return {
      ...state,
      confirmationRequests: state.confirmationRequests.filter(
        (item) => !resolved.includes(item.key)
      ),
      resolvedConfirmationKeys: resolved,
      sessionStatus: 'running',
      sending: true,
    }
  }

  const replyId = event.reply_id
  if (!replyId) return state

  if (event.type === 'REPLY_START') {
    if (state.liveReplies.some((reply) => reply.id === replyId)) return state
    return {
      ...state,
      liveReplies: [
        ...state.liveReplies,
        { id: replyId, name: event.name || '智能体', blocks: [] },
      ],
    }
  }

  if (event.type === 'TEXT_BLOCK_START' && event.block_id) {
    const blockId = event.block_id
    const replies = ensureLiveReply(state.liveReplies, replyId)
    return {
      ...state,
      liveReplies: replies.map((reply) =>
        reply.id !== replyId || reply.blocks.some((block) => block.id === blockId)
          ? reply
          : { ...reply, blocks: [...reply.blocks, { id: blockId, text: '' }] }
      ),
    }
  }

  if (
    event.type === 'TEXT_BLOCK_DELTA' &&
    event.block_id &&
    typeof event.delta === 'string'
  ) {
    const blockId = event.block_id
    const delta = event.delta
    const replies = ensureLiveReply(state.liveReplies, replyId)
    return {
      ...state,
      liveReplies: replies.map((reply) =>
        reply.id !== replyId
          ? reply
          : {
              ...reply,
              blocks: reply.blocks.some((block) => block.id === blockId)
                ? reply.blocks.map((block) =>
                    block.id === blockId
                      ? { ...block, text: block.text + delta }
                      : block
                  )
                : [...reply.blocks, { id: blockId, text: delta }],
            }
      ),
    }
  }

  if (
    event.type === 'TEXT_BLOCK_END' &&
    event.block_id &&
    typeof event.text === 'string'
  ) {
    return {
      ...state,
      liveReplies: state.liveReplies.map((reply) =>
        reply.id !== replyId
          ? reply
          : {
              ...reply,
              blocks: reply.blocks.map((block) =>
                block.id === event.block_id
                  ? { ...block, text: event.text as string }
                  : block
              ),
            }
      ),
    }
  }

  if (event.type === 'TOOL_CALL_START' && event.tool_call_id) {
    const toolId = event.tool_call_id
    const name = event.tool_call_name || '工具'
    return {
      ...state,
      toolCallBuffers: { ...state.toolCallBuffers, [toolId]: '' },
      toolEvents: ensureToolExecution(
        state.toolEvents,
        toolId,
        replyId,
        name
      ).map((item) =>
        item.id === toolId
          ? {
              ...item,
              replyId,
              name,
              state: 'requesting',
              startedAt: event.created_at ?? item.startedAt,
            }
          : item
      ),
    }
  }

  if (
    event.type === 'TOOL_CALL_DELTA' &&
    event.tool_call_id &&
    typeof event.delta === 'string'
  ) {
    const previous = state.toolCallBuffers[event.tool_call_id] ?? ''
    return {
      ...state,
      toolCallBuffers: {
        ...state.toolCallBuffers,
        [event.tool_call_id]: (previous + event.delta).slice(
          0,
          MAX_TOOL_ARGUMENTS_CHARS * 10
        ),
      },
    }
  }

  if (event.type === 'TOOL_CALL_END' && event.tool_call_id) {
    const toolId = event.tool_call_id
    const rawArguments = state.toolCallBuffers[toolId] ?? ''
    const toolCallBuffers = { ...state.toolCallBuffers }
    delete toolCallBuffers[toolId]
    return {
      ...state,
      toolCallBuffers,
      toolEvents: ensureToolExecution(
        state.toolEvents,
        toolId,
        replyId,
        event.tool_call_name || '工具'
      ).map((item) =>
        item.id === toolId
          ? {
              ...item,
              state: 'requesting',
              ...(rawArguments
                ? { argumentsSummary: summarizeToolArguments(rawArguments) }
                : {}),
            }
          : item
      ),
    }
  }

  if (event.type === 'TOOL_RESULT_START' && event.tool_call_id) {
    const toolId = event.tool_call_id
    return {
      ...state,
      toolEvents: ensureToolExecution(
        state.toolEvents,
        toolId,
        replyId,
        event.tool_call_name || '工具'
      ).map((item) =>
        item.id === toolId
          ? {
              ...item,
              replyId,
              name: event.tool_call_name || item.name,
              state: 'running',
              startedAt: event.created_at ?? item.startedAt,
              resultText: '',
              resultTruncated: false,
            }
          : item
      ),
    }
  }

  if (
    event.type === 'TOOL_RESULT_TEXT_DELTA' &&
    event.tool_call_id &&
    typeof event.delta === 'string'
  ) {
    const toolId = event.tool_call_id
    const delta = event.delta
    return {
      ...state,
      toolEvents: state.toolEvents.map((item) => {
        if (item.id !== toolId) return item
        const resultText = `${item.resultText ?? ''}${delta}`
        return {
          ...item,
          resultText: resultText.slice(0, MAX_TOOL_RESULT_CHARS + 1),
          resultTruncated: resultText.length > MAX_TOOL_RESULT_CHARS,
        }
      }),
    }
  }

  if (event.type === 'TOOL_RESULT_DATA_DELTA' && event.tool_call_id) {
    const toolId = event.tool_call_id
    return {
      ...state,
      toolEvents: state.toolEvents.map((item) => {
        if (item.id !== toolId) return item
        const resultText = item.resultText
          ? `${item.resultText}\n[已隐藏附件或二进制结果]`
          : '[已隐藏附件或二进制结果]'
        return {
          ...item,
          resultText: resultText.slice(0, MAX_TOOL_RESULT_CHARS + 1),
          resultTruncated:
            item.resultTruncated || resultText.length > MAX_TOOL_RESULT_CHARS,
        }
      }),
    }
  }

  if (event.type === 'TOOL_RESULT_END' && event.tool_call_id) {
    const toolId = event.tool_call_id
    const toolState = ['success', 'error', 'interrupted', 'denied'].includes(
      event.state ?? ''
    )
      ? (event.state as ToolExecution['state'])
      : 'finished'
    return {
      ...state,
      toolEvents: ensureToolExecution(
        state.toolEvents,
        toolId,
        replyId,
        event.tool_call_name || '工具'
      ).map((item) =>
        item.id !== toolId
          ? item
          : {
              ...item,
              state: toolState,
              finishedAt: event.created_at ?? item.finishedAt,
              resultText: item.resultText
                ? redactToolText(item.resultText)
                : item.resultText,
            }
      ),
    }
  }

  if (event.type === 'REPLY_END')
    return resolveReplyRequests(
      state,
      replyId,
      historyConfirmationKeys,
      historyExternalKeys
    )

  return state
}

function upsertConfirmation(
  state: SessionMachineState,
  request: PendingConfirmation,
  patch: Partial<PendingConfirmation>,
  allowInsert: boolean
): SessionMachineState {
  const current = state.confirmationRequests.find(
    (item) => item.key === request.key
  )
  if (!current && !allowInsert) return state
  if (current && current.status === 'stale' && patch.status === 'submitting')
    return state
  const next = { ...(current ?? request), ...patch }
  return {
    ...state,
    confirmationRequests: current
      ? state.confirmationRequests.map((item) =>
          item.key === request.key ? next : item
        )
      : [...state.confirmationRequests, next],
  }
}

function upsertExternalRequest(
  state: SessionMachineState,
  request: PendingExternalResult,
  patch: Partial<PendingExternalResult>,
  allowInsert: boolean
): SessionMachineState {
  const current = state.externalRequests.find(
    (item) => item.key === request.key
  )
  if (!current && !allowInsert) return state
  if (current && current.status === 'stale' && patch.status === 'submitting')
    return state
  const next = { ...(current ?? request), ...patch }
  return {
    ...state,
    externalRequests: current
      ? state.externalRequests.map((item) =>
          item.key === request.key ? next : item
        )
      : [...state.externalRequests, next],
  }
}

export function sessionMachineReducer(
  state: SessionMachineState,
  action: SessionMachineAction
): SessionMachineState {
  if (action.scopeKey !== sessionMachineScopeKey(state.scope)) return state
  if (action.type === 'session/switch')
    return createSessionMachineState(action)

  switch (action.type) {
    case 'composer/text-changed':
      return state.accessDenied || state.sending || state.submitting
        ? state
        : { ...state, text: action.value }

    case 'composer/attachments-replaced':
      return state.accessDenied || state.sending || state.submitting
        ? state
        : { ...state, selectedAttachments: [...action.attachmentIds] }

    case 'composer/attachment-toggled':
      if (state.accessDenied || state.sending || state.submitting) return state
      return {
        ...state,
        selectedAttachments: state.selectedAttachments.includes(
          action.attachmentId
        )
          ? state.selectedAttachments.filter(
              (id) => id !== action.attachmentId
            )
          : [...state.selectedAttachments, action.attachmentId],
      }

    case 'send/start':
      if (
        state.scope.workspaceStatus !== 'active' ||
        state.accessDenied ||
        state.sending ||
        state.submitting ||
        (!state.text.trim() && state.selectedAttachments.length === 0)
      )
        return state
      return { ...state, submitting: true, sendError: '' }

    case 'send/accepted':
      if (!state.submitting || state.accessDenied) return state
      return {
        ...state,
        text: '',
        selectedAttachments: [],
        sending: true,
        submitting: false,
        sessionStatus: 'running',
        sendError: '',
      }

    case 'send/failed': {
      const next = {
        ...state,
        submitting: false,
        sendError: action.error,
      }
      return action.accessDenied
        ? denyAccess(next, action.confirmationKeys, action.externalKeys)
        : next
    }

    case 'send/settled':
      return state.submitting ? { ...state, submitting: false } : state

    case 'send/clear-error':
      return state.sendError ? { ...state, sendError: '' } : state

    case 'run/status-updated':
      if (state.accessDenied) return state
      if (
        state.sessionStatus === action.status &&
        state.sending === (action.status === 'running') &&
        (action.status === 'running' || !state.stopRequested)
      )
        return state
      return {
        ...state,
        sessionStatus: action.status,
        sending: action.status === 'running',
        stopRequested: action.status === 'running' ? state.stopRequested : false,
      }

    case 'run/status-failed': {
      const next = {
        ...state,
        sending: false,
        stopRequested: false,
        sendError: action.error,
      }
      return action.accessDenied
        ? denyAccess(next, action.confirmationKeys, action.externalKeys)
        : next
    }

    case 'run/resumed':
      return state.accessDenied
        ? state
        : {
            ...state,
            sessionStatus: 'running',
            sending: true,
            sendError: '',
          }

    case 'interrupt/requested': {
      const interruptible =
        state.sending ||
        state.sessionStatus === 'running' ||
        state.sessionStatus === 'awaiting_permission' ||
        state.sessionStatus === 'awaiting_external_result'
      if (state.interruptPending || state.accessDenied || !interruptible)
        return state
      return {
        ...state,
        interruptPending: true,
        interruptWasRunning:
          state.sending || state.sessionStatus === 'running',
        sending: true,
        sendError: '',
      }
    }

    case 'interrupt/accepted':
      return !state.interruptPending
        ? state
        : {
            ...state,
            stopRequested: state.interruptWasRunning,
          }

    case 'interrupt/failed': {
      if (!state.interruptPending) return state
      const next = {
        ...state,
        sending: state.interruptWasRunning,
        stopRequested: false,
        sendError: action.error,
      }
      return action.accessDenied
        ? denyAccess(next, action.confirmationKeys, action.externalKeys)
        : next
    }

    case 'interrupt/settled':
      return state.interruptPending || state.interruptWasRunning
        ? { ...state, interruptPending: false, interruptWasRunning: false }
        : state

    case 'stream/connecting':
      return { ...state, streamConnected: false, streamError: '' }

    case 'stream/connected':
      return { ...state, streamConnected: true, streamError: '' }

    case 'stream/failed':
      return {
        ...state,
        streamConnected: false,
        streamError: action.error,
      }

    case 'stream/retry':
      return {
        ...state,
        streamConnected: false,
        streamError: '',
        streamRetry: state.streamRetry + 1,
      }

    case 'stream/event':
      return applyStreamEvent(
        state,
        action.event,
        action.historyConfirmationKeys,
        action.historyExternalKeys
      )

    case 'confirmation/begin':
      if (
        state.accessDenied ||
        action.request.status !== 'pending' ||
        state.resolvedConfirmationKeys.includes(action.request.key)
      )
        return state
      if (
        state.confirmationRequests.some(
          (item) => item.key === action.request.key && item.status !== 'pending'
        )
      )
        return state
      return {
        ...upsertConfirmation(
          state,
          action.request,
          { status: 'submitting', error: undefined },
          true
        ),
        sendError: '',
      }

    case 'confirmation/accepted': {
      if (state.accessDenied) return state
      const current = state.confirmationRequests.find(
        (item) => item.key === action.key
      )
      if (
        !current ||
        current.status !== 'submitting' ||
        state.resolvedConfirmationKeys.includes(action.key)
      )
        return state
      const stateWithoutRequest = {
        ...state,
        confirmationRequests: state.confirmationRequests.filter(
          (item) => item.key !== action.key
        ),
        resolvedConfirmationKeys: addUnique(state.resolvedConfirmationKeys, [
          action.key,
        ]),
      }
      return {
        ...stateWithoutRequest,
        sessionStatus: 'running',
        sending: true,
        sendError: '',
      }
    }

    case 'confirmation/failed': {
      if (state.accessDenied && !action.accessDenied) return state
      if (
        state.resolvedConfirmationKeys.includes(action.request.key) ||
        (!state.confirmationRequests.some(
          (item) =>
            item.key === action.request.key && item.status === 'submitting'
        ) && !action.accessDenied)
      )
        return state
      const next = upsertConfirmation(
        state,
        action.request,
        {
          status: action.stale ? 'stale' : 'pending',
          error: action.error,
        },
        true
      )
      const withError = action.sendError
        ? { ...next, sendError: action.sendError }
        : next
      return action.accessDenied
        ? denyAccess(withError, action.confirmationKeys, action.externalKeys)
        : withError
    }

    case 'confirmation/dismiss':
      return {
        ...state,
        confirmationRequests: state.confirmationRequests.filter(
          (item) => item.key !== action.key
        ),
        resolvedConfirmationKeys: addUnique(state.resolvedConfirmationKeys, [
          action.key,
        ]),
      }

    case 'external/edit':
      if (
        state.accessDenied ||
        state.resolvedExternalKeys.includes(action.request.key)
      )
        return state
      return upsertExternalRequest(
        state,
        action.request,
        { output: action.output, error: undefined },
        true
      )

    case 'external/invalid':
      if (
        state.accessDenied ||
        state.resolvedExternalKeys.includes(action.request.key)
      )
        return state
      return upsertExternalRequest(
        state,
        action.request,
        { error: action.error },
        true
      )

    case 'external/begin':
      if (
        state.accessDenied ||
        action.request.status !== 'pending' ||
        state.resolvedExternalKeys.includes(action.request.key)
      )
        return state
      if (
        state.externalRequests.some(
          (item) => item.key === action.request.key && item.status !== 'pending'
        )
      )
        return state
      return {
        ...upsertExternalRequest(
          state,
          action.request,
          { status: 'submitting', error: undefined },
          true
        ),
        sendError: '',
      }

    case 'external/accepted': {
      if (state.accessDenied) return state
      const current = state.externalRequests.find(
        (item) => item.key === action.key
      )
      if (
        !current ||
        current.status !== 'submitting' ||
        state.resolvedExternalKeys.includes(action.key)
      )
        return state
      const stateWithoutRequest = {
        ...state,
        externalRequests: state.externalRequests.filter(
          (item) => item.key !== action.key
        ),
        resolvedExternalKeys: addUnique(state.resolvedExternalKeys, [
          action.key,
        ]),
      }
      return {
        ...stateWithoutRequest,
        sessionStatus: 'running',
        sending: true,
        sendError: '',
      }
    }

    case 'external/failed': {
      if (state.accessDenied && !action.accessDenied) return state
      if (
        state.resolvedExternalKeys.includes(action.request.key) ||
        (!state.externalRequests.some(
          (item) =>
            item.key === action.request.key && item.status === 'submitting'
        ) && !action.accessDenied)
      )
        return state
      const next = upsertExternalRequest(
        state,
        action.request,
        {
          status: action.stale ? 'stale' : 'pending',
          error: action.error,
        },
        true
      )
      const withError = action.sendError
        ? { ...next, sendError: action.sendError }
        : next
      return action.accessDenied
        ? denyAccess(withError, action.confirmationKeys, action.externalKeys)
        : withError
    }

    case 'external/dismiss':
      return {
        ...state,
        externalRequests: state.externalRequests.filter(
          (item) => item.key !== action.key
        ),
        resolvedExternalKeys: addUnique(state.resolvedExternalKeys, [
          action.key,
        ]),
      }

    case 'access/denied':
      return denyAccess(
        state,
        action.confirmationKeys,
        action.externalKeys
      )

    default:
      return state
  }
}

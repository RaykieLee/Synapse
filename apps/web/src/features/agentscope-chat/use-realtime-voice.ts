import * as React from 'react'
import type { Workspace } from '@/features/workspaces/types'
import {
  BrowserWebRTCTransport,
  type RealtimeConnectionState,
  type RealtimeUserConfirmEvent,
} from './realtime'

export function useRealtimeVoice(
  workspace: Workspace,
  agentId: string,
  sessionId: string
) {
  const [state, setState] = React.useState<RealtimeConnectionState>('idle')
  const [error, setError] = React.useState<Error | null>(null)
  const transportRef = React.useRef<BrowserWebRTCTransport | null>(null)

  const stop = React.useCallback(async () => {
    const transport = transportRef.current
    transportRef.current = null
    if (transport) await transport.stop()
    setState('idle')
  }, [])

  React.useEffect(() => {
    return () => {
      const transport = transportRef.current
      if (transport) {
        transportRef.current = null
        void transport.stop()
      }
    }
  }, [agentId, sessionId])

  const start = React.useCallback(async () => {
    if (transportRef.current) return
    setError(null)
    const transport = new BrowserWebRTCTransport({
      workspace,
      agentId,
      sessionId,
      onStateChange: (nextState) => {
        if (transportRef.current === transport) setState(nextState)
      },
      onError: (nextError) => {
        if (transportRef.current !== transport) return
        transportRef.current = null
        setState('error')
        setError(nextError)
      },
    })
    transportRef.current = transport
    try {
      await transport.start()
    } catch (nextError) {
      await transport.stop()
      if (transportRef.current === transport) {
        transportRef.current = null
        setState('error')
        setError(
          nextError instanceof Error
            ? nextError
            : new Error('实时语音启动失败。')
        )
      }
    }
  }, [agentId, sessionId, workspace])

  const toggle = React.useCallback(async () => {
    if (state === 'active' || state === 'connecting') await stop()
    else await start()
  }, [start, state, stop])

  const userConfirm = React.useCallback(
    async (event: RealtimeUserConfirmEvent) => {
      const transport = transportRef.current
      if (!transport) throw new Error('实时语音模式未启动。')
      transport.userConfirm(event)
    },
    []
  )

  return {
    error,
    isBusy: state === 'active' || state === 'connecting',
    state,
    toggle,
    userConfirm,
  }
}

import type { Workspace } from '@/features/workspaces/types'
import { agentScopeRequest, workspaceHeaders } from './api'

export type RealtimeConnectionState = 'idle' | 'connecting' | 'active' | 'error'

export type RealtimeUserConfirmEvent = {
  type: 'USER_CONFIRM_RESULT'
  reply_id: string
  confirm_results: Array<{
    confirmed: boolean
    tool_call: Record<string, unknown>
  }>
}

type RealtimeIceServer = {
  urls: string | string[]
  username?: string
  credential?: string
  credentialType?: 'password' | 'oauth'
}

type RealtimeConfigResponse = {
  ice_servers: RealtimeIceServer[]
}

type RealtimeOfferResponse = {
  sdp: string
  type: 'answer'
}

type BrowserWebRTCTransportOptions = {
  workspace: Workspace
  agentId: string
  sessionId: string
  onStateChange: (state: RealtimeConnectionState) => void
  onError: (error: Error) => void
}

type AudioStartFrame = {
  type: 'audio_start'
  item_id: string
  track_time_ms: number
}

type AudioDurationFrame = {
  type: 'audio_duration'
  item_id: string
  duration_ms: number
}

type ClearAudioFrame = {
  type: 'clear_audio'
  request_id: string
  resume_track_time_ms: number
}

type RealtimeErrorFrame = {
  type: 'error'
  detail: string
}

type RealtimeServerFrame =
  | AudioStartFrame
  | AudioDurationFrame
  | ClearAudioFrame
  | RealtimeErrorFrame

const ICE_GATHERING_TIMEOUT_MS = 10_000
const CONNECTION_TIMEOUT_MS = 20_000
const PLAYOUT_FENCE_POLL_MS = 20
const PLAYOUT_FENCE_POLL_TIMEOUT_MS = 5_000

/**
 * Browser-side WebRTC transport for AgentScope's realtime service.
 *
 * The server owns the model and session state. The browser only captures the
 * microphone, negotiates the peer connection, and sends control frames.
 */
export class BrowserWebRTCTransport {
  private readonly options: BrowserWebRTCTransportOptions
  private peerConnection: RTCPeerConnection | null = null
  private controlChannel: RTCDataChannel | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private audioElement: HTMLAudioElement | null = null
  private progressTimer: number | null = null
  private playoutFenceTimer: number | null = null
  private playoutFenceAudio: HTMLAudioElement | null = null
  private playoutFenceListener: (() => void) | null = null
  private readonly itemStarts: AudioStartFrame[] = []
  private readonly durationsMs = new Map<string, number>()
  private intentionalClose = false
  private failed = false
  private active = false
  private failureError: Error | null = null

  constructor(options: BrowserWebRTCTransportOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    this.intentionalClose = false
    this.failed = false
    this.active = false
    this.failureError = null
    this.options.onStateChange('connecting')

    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error('当前浏览器不支持 WebRTC 麦克风采集。')
    }

    const { ice_servers: iceServers } =
      await agentScopeRequest<RealtimeConfigResponse>('/ai/realtime/config', {
        headers: workspaceHeaders(this.options.workspace),
        timeoutMs: 10_000,
      })
    this.throwIfStopped()

    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.localStream = localStream
    this.throwIfStopped()

    const peerConnection = new RTCPeerConnection({ iceServers })
    this.peerConnection = peerConnection
    const controlChannel = peerConnection.createDataChannel('control', {
      ordered: true,
    })
    this.controlChannel = controlChannel
    controlChannel.onmessage = (event) => this.handleMessage(event.data)
    controlChannel.onclose = () => {
      if (!this.intentionalClose)
        this.fail(new Error('实时语音控制通道已关闭。'))
    }

    peerConnection.ontrack = (event) => this.attachRemoteTrack(event.track)
    peerConnection.onconnectionstatechange = () => {
      if (
        !this.intentionalClose &&
        (peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed')
      ) {
        this.fail(new Error('实时语音媒体连接已断开。'))
      }
    }
    for (const track of localStream.getTracks())
      peerConnection.addTrack(track, localStream)

    const channelReady = this.waitForControlChannel(controlChannel)
    void channelReady.catch(() => undefined)
    const offer = await peerConnection.createOffer()
    this.throwIfStopped()
    await peerConnection.setLocalDescription(offer)
    await this.waitForIceGathering(peerConnection)
    this.throwIfStopped()

    const localDescription = peerConnection.localDescription
    if (!localDescription || localDescription.type !== 'offer')
      throw new Error('浏览器没有生成有效的 WebRTC Offer。')

    const answer = await agentScopeRequest<RealtimeOfferResponse>(
      `/ai/realtime/sessions/${encodeURIComponent(this.options.sessionId)}/offer`,
      {
        method: 'POST',
        headers: {
          ...workspaceHeaders(this.options.workspace),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.options.agentId,
          sdp: localDescription.sdp,
          type: 'offer',
        }),
        timeoutMs: 20_000,
      }
    )
    this.throwIfStopped()
    await peerConnection.setRemoteDescription({
      sdp: answer.sdp,
      type: answer.type,
    })
    await channelReady
    this.throwIfStopped()

    this.progressTimer = window.setInterval(() => this.reportPlayout(), 100)
    this.active = true
    this.options.onStateChange('active')
  }

  async stop(): Promise<void> {
    this.intentionalClose = true
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer)
      this.progressTimer = null
    }
    this.clearPlayoutFence()
    this.sendJson({ type: 'close' })
    this.controlChannel?.close()
    this.peerConnection?.close()
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.remoteStream?.getTracks().forEach((track) => track.stop())
    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.srcObject = null
    }
    this.controlChannel = null
    this.peerConnection = null
    this.localStream = null
    this.remoteStream = null
    this.audioElement = null
    this.itemStarts.length = 0
    this.durationsMs.clear()
    this.active = false
    this.options.onStateChange('idle')
  }

  userConfirm(event: RealtimeUserConfirmEvent): void {
    if (this.controlChannel?.readyState !== 'open')
      throw new Error('实时语音控制通道尚未打开。')
    this.controlChannel.send(JSON.stringify({ type: 'control', control: 'user_confirm', data: event }))
  }

  private attachRemoteTrack(track: MediaStreamTrack): void {
    if (track.kind !== 'audio') return
    this.clearPlayoutFence()
    this.remoteStream = new MediaStream([track])
    const audio = new Audio()
    audio.autoplay = true
    audio.srcObject = this.remoteStream
    this.audioElement = audio
    void audio.play().catch(() => {
      this.fail(new Error('浏览器阻止了实时语音播放。'))
    })
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    let frame: RealtimeServerFrame
    try {
      frame = JSON.parse(raw) as RealtimeServerFrame
    } catch {
      this.fail(new Error('服务端返回了无效的实时语音控制帧。'))
      return
    }

    if (frame.type === 'audio_start') {
      this.itemStarts.push(frame)
      this.itemStarts.sort((left, right) => left.track_time_ms - right.track_time_ms)
    } else if (frame.type === 'audio_duration') {
      this.durationsMs.set(frame.item_id, frame.duration_ms)
    } else if (frame.type === 'clear_audio') {
      this.acknowledgeClear(frame)
    } else if (frame.type === 'error') {
      this.fail(new Error(frame.detail))
    }
  }

  private acknowledgeClear(frame: ClearAudioFrame): void {
    const position = this.currentPosition()
    this.muteUntilTrackTime(frame.resume_track_time_ms)
    this.sendJson({
      type: 'playout_cleared',
      request_id: frame.request_id,
      ...position,
    })
    this.itemStarts.length = 0
    this.durationsMs.clear()
  }

  private muteUntilTrackTime(trackTimeMs: number): void {
    const audio = this.audioElement
    if (!audio || !Number.isFinite(trackTimeMs)) return
    this.clearPlayoutFence()
    audio.muted = true
    const deadline = performance.now() + PLAYOUT_FENCE_POLL_TIMEOUT_MS
    const releaseIfCaughtUp = () => {
      if (this.audioElement !== audio) {
        this.clearPlayoutFence()
        return true
      }
      if (audio.currentTime * 1000 < trackTimeMs) return false
      audio.muted = false
      this.clearPlayoutFence()
      return true
    }
    const release = () => {
      if (releaseIfCaughtUp()) return
      if (performance.now() >= deadline) {
        this.playoutFenceTimer = null
        this.playoutFenceAudio = audio
        this.playoutFenceListener = () => {
          releaseIfCaughtUp()
        }
        audio.addEventListener('playing', this.playoutFenceListener)
        audio.addEventListener('timeupdate', this.playoutFenceListener)
        return
      }
      this.playoutFenceTimer = window.setTimeout(release, PLAYOUT_FENCE_POLL_MS)
    }
    release()
  }

  private clearPlayoutFence(): void {
    if (this.playoutFenceTimer !== null) {
      window.clearTimeout(this.playoutFenceTimer)
      this.playoutFenceTimer = null
    }
    if (this.playoutFenceAudio && this.playoutFenceListener) {
      this.playoutFenceAudio.removeEventListener('playing', this.playoutFenceListener)
      this.playoutFenceAudio.removeEventListener('timeupdate', this.playoutFenceListener)
    }
    this.playoutFenceAudio = null
    this.playoutFenceListener = null
  }

  private currentPosition(): { item_id: string; played_ms: number } {
    const currentTimeMs = (this.audioElement?.currentTime ?? 0) * 1000
    if (!Number.isFinite(currentTimeMs)) return { item_id: '', played_ms: 0 }

    let currentIndex = -1
    for (let index = 0; index < this.itemStarts.length; index += 1) {
      if (this.itemStarts[index].track_time_ms > currentTimeMs) break
      currentIndex = index
    }
    if (currentIndex < 0) return { item_id: '', played_ms: 0 }

    const current = this.itemStarts[currentIndex]
    for (const completed of this.itemStarts.splice(0, currentIndex))
      this.durationsMs.delete(completed.item_id)
    const elapsed = Math.max(0, currentTimeMs - current.track_time_ms)
    const duration = this.durationsMs.get(current.item_id) ?? 0
    return {
      item_id: current.item_id,
      played_ms: Math.round(Math.min(elapsed, duration)),
    }
  }

  private reportPlayout(): void {
    const position = this.currentPosition()
    if (position.item_id) this.sendJson({ type: 'playout', ...position })
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.controlChannel?.readyState === 'open')
      this.controlChannel.send(JSON.stringify(payload))
  }

  private throwIfStopped(): void {
    if (this.intentionalClose)
      throw this.failureError ?? new Error('实时语音连接已停止。')
  }

  private waitForIceGathering(peerConnection: RTCPeerConnection): Promise<void> {
    if (peerConnection.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        peerConnection.removeEventListener('icegatheringstatechange', onChange)
        reject(new Error('等待 WebRTC 网络候选超时。'))
      }, ICE_GATHERING_TIMEOUT_MS)
      const onChange = () => {
        if (peerConnection.iceGatheringState !== 'complete') return
        window.clearTimeout(timeout)
        peerConnection.removeEventListener('icegatheringstatechange', onChange)
        resolve()
      }
      peerConnection.addEventListener('icegatheringstatechange', onChange)
    })
  }

  private waitForControlChannel(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === 'open') return Promise.resolve()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout)
        channel.removeEventListener('open', onOpen)
        channel.removeEventListener('close', onClose)
      }
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error('等待实时语音控制通道超时。'))
      }, CONNECTION_TIMEOUT_MS)
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onClose = () => {
        cleanup()
        reject(this.failureError ?? new Error('实时语音控制通道已关闭。'))
      }
      channel.addEventListener('open', onOpen)
      channel.addEventListener('close', onClose)
    })
  }

  private fail(error: Error): void {
    if (this.failed || this.intentionalClose) return
    this.failed = true
    this.failureError = error
    if (this.active) this.options.onError(error)
    void this.stop().finally(() => this.options.onStateChange('error'))
  }
}

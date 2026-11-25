import { createUuid } from './uuid'
import type { ImCallSignal, ImCallType, ImContact, ImVoiceCallOptions } from './types'
import type { ImLocaleKey } from './locales'

export interface VoiceCallState {
  phase: 'idle' | 'incoming' | 'requesting' | 'calling' | 'connecting' | 'connected' | 'ended'
  type: ImCallType
  contact?: ImContact
  muted: boolean
  cameraOff: boolean
  duration: number
  playbackBlocked: boolean
  reason?: ImLocaleKey
}

/** One active media connection per widget, independent of the selected conversation. */
export function createVoiceCall(options: () => ImVoiceCallOptions | undefined, update: (state: VoiceCallState) => void) {
  let state: VoiceCallState = { phase: 'idle', type: 'voice', muted: false, cameraOff: false, duration: 0, playbackBlocked: false }
  let current: { id: string; type: ImCallType; contact: ImContact; incoming: boolean; sdp?: string; peer?: RTCPeerConnection; stream?: MediaStream; remoteStream?: MediaStream; audio?: HTMLAudioElement; cancelGather?: () => void } | undefined
  let localVideo: HTMLVideoElement | null = null
  let remoteVideo: HTMLVideoElement | null = null
  let deadline: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  let disconnected: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<void> | undefined
  let disposed = false
  const publish = (patch: Partial<VoiceCallState>) => { state = { ...state, ...patch }; if (!disposed) update(state) }
  const send = (signal: ImCallSignal) => {
    let delivery: Promise<unknown>
    try { delivery = queue ? queue.then(() => options()?.sendSignal(signal)) : Promise.resolve(options()?.sendSignal(signal)) }
    catch (error) { delivery = Promise.reject(error) }
    const settled = queue = delivery.then(() => {}, () => {})
    void settled.then(() => { if (queue === settled) queue = undefined })
    return delivery
  }

  function finish(reason: ImLocaleKey = 'callEnded', notify = false): void {
    const call = current
    current = undefined
    clearTimeout(deadline)
    clearTimeout(disconnected)
    clearInterval(ticker)
    call?.cancelGather?.()
    if (call?.peer) { call.peer.ontrack = call.peer.onconnectionstatechange = null; call.peer.close() }
    call?.stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    if (call?.audio) { call.audio.pause(); call.audio.srcObject = null }
    void bindVideo(localVideo)
    void bindVideo(remoteVideo)
    if (call && notify) void send({ callId: call.id, id: call.contact.id, action: state.phase === 'incoming' ? 'reject' : 'end' }).catch(() => {})
    publish({ phase: 'ended', reason, playbackBlocked: false })
  }

  function timeout(milliseconds: number): void {
    clearTimeout(deadline)
    deadline = setTimeout(() => finish('callTimeout', true), milliseconds)
  }

  function bindVideo(element: HTMLVideoElement | null, stream?: MediaStream): Promise<void> {
    if (!element) return Promise.resolve()
    element.muted = element.autoplay = element.playsInline = true
    if (element.srcObject !== (stream ?? null)) element.srcObject = stream ?? null
    if (stream) return element.play()
    element.pause()
    return Promise.resolve()
  }

  async function play(): Promise<void> {
    const call = current
    if (!call?.audio) return
    try { await Promise.all([call.audio.play(), bindVideo(remoteVideo, call.remoteStream)]); if (current === call) publish({ playbackBlocked: false }) }
    catch { if (current === call) publish({ playbackBlocked: true }) }
  }

  async function connect(call: NonNullable<typeof current>): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') { finish('callUnsupported', true); return }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.type === 'video' })
      if (current !== call) { stream.getTracks().forEach(track => track.stop()); return }
      call.stream = stream
      if (call.type === 'video') void bindVideo(localVideo, stream).catch(() => {})
      const peer = call.peer = new RTCPeerConnection({ iceServers: options()?.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }] })
      const audio = call.audio = new Audio()
      audio.autoplay = true
      peer.ontrack = event => {
        if (current !== call) return
        call.remoteStream ??= event.streams[0] ?? new MediaStream()
        if (event.track && !call.remoteStream.getTracks().includes(event.track)) call.remoteStream.addTrack(event.track)
        audio.srcObject = call.remoteStream
        void play()
      }
      peer.onconnectionstatechange = () => {
        if (current !== call) return
        clearTimeout(disconnected)
        if (peer.connectionState === 'connected') {
          clearTimeout(deadline)
          if (state.phase !== 'connected') {
            publish({ phase: 'connected' })
            const started = Date.now()
            ticker = setInterval(() => {
              publish({ duration: Math.floor((Date.now() - started) / 1000) })
              if (state.duration % 30 === 0) void send({ callId: call.id, id: call.contact.id, action: 'keepalive' })
                .catch(() => { if (current === call) finish('callConnectionFailed', true) })
            }, 1000)
          }
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') finish('callConnectionFailed', true)
        else if (peer.connectionState === 'disconnected') disconnected = setTimeout(() => finish('callConnectionFailed', true), 15000)
      }
      stream.getTracks().forEach(track => { peer.addTrack(track, stream); track.onended = () => { if (current === call) finish(track.kind === 'video' ? 'cameraUnavailable' : 'microphoneUnavailable', true) } })
      if (call.incoming) await peer.setRemoteDescription({ type: 'offer', sdp: call.sdp })
      if (current !== call) return
      await peer.setLocalDescription(call.incoming ? await peer.createAnswer() : await peer.createOffer())
      if (current !== call) return
      if (peer.iceGatheringState !== 'complete') await new Promise<void>(resolve => {
        const complete = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); call.cancelGather = undefined; resolve() }
        const changed = () => { if (peer.iceGatheringState === 'complete') complete() }
        const timer = setTimeout(complete, 10000)
        call.cancelGather = complete
        peer.addEventListener('icegatheringstatechange', changed)
        changed()
      })
      if (current !== call) return
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('Missing session description')
      publish({ phase: call.incoming ? 'connecting' : 'calling' })
      await send({ callId: call.id, id: call.contact.id, action: call.incoming ? 'answer' : 'offer', sdp, ...(call.type === 'video' ? { type: 'video' as const } : {}) })
      if (current === call && state.phase !== 'connected') timeout(call.incoming ? 30000 : 60000)
    } catch (error) {
      if (current !== call) return
      if (call.incoming && typeof error === 'object' && error !== null && 'status' in error && error.status === 409) {
        finish('callAnsweredElsewhere')
        return
      }
      const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined
      finish(name === 'NotAllowedError' ? (call.type === 'video' ? 'cameraDenied' : 'microphoneDenied')
        : call.type === 'video' && ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(String(name)) ? 'cameraUnavailable'
        : typeof error === 'object' && error !== null && 'status' in error && error.status === 423 ? 'callBusy' : 'callConnectionFailed', true)
    }
  }

  return {
    mount: () => { disposed = false },
    start(contact: ImContact, type: ImCallType = 'voice'): void {
      if (disposed || current || !options()) return
      const call = current = { id: createUuid(), type, contact: { ...contact }, incoming: false }
      publish({ phase: 'requesting', type, contact: call.contact, muted: false, cameraOff: false, duration: 0, reason: undefined })
      timeout(60000)
      void connect(call)
    },
    accept(): void {
      if (!current || state.phase !== 'incoming') return
      publish({ phase: 'requesting' })
      void connect(current)
    },
    receive(signal: ImCallSignal): void {
      if (disposed || !options()) return
      if (signal.action === 'offer') {
        if (!signal.sdp || !signal.expiresAt || signal.expiresAt <= Date.now()) return
        if (current?.id === signal.callId) return
        if (current) { void send({ callId: signal.callId, id: signal.id, action: 'reject' }).catch(() => {}); return }
        current = { id: signal.callId, type: signal.type === 'video' ? 'video' : 'voice', contact: { ...signal.contact, id: signal.id, type: 'friend' }, incoming: true, sdp: signal.sdp }
        publish({ phase: 'incoming', type: current.type, contact: current.contact, muted: false, cameraOff: false, duration: 0, reason: undefined })
        timeout(Math.min(60000, signal.expiresAt - Date.now()))
      } else if (current?.id === signal.callId && String(current.contact.id) === String(signal.id)) {
        const call = current
        if (signal.action === 'answer' && !call.incoming && call.peer && signal.sdp && state.phase === 'calling') {
          publish({ phase: 'connecting' })
          timeout(30000)
          void call.peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(() => { if (current === call) finish('callConnectionFailed', true) })
        } else if (signal.action === 'end' || signal.action === 'reject') finish(signal.action === 'reject' ? 'callRejected' : 'callEnded')
        else if (signal.action === 'answered' && call.incoming && ['incoming', 'requesting'].includes(state.phase)) finish('callAnsweredElsewhere')
      }
    },
    hangup: () => { if (current) finish('callEnded', true) },
    mute(): void {
      if (!current?.stream) return
      publish({ muted: !state.muted })
      current.stream.getAudioTracks().forEach(track => { track.enabled = !state.muted })
    },
    camera(): void {
      if (current?.type !== 'video' || !current.stream) return
      publish({ cameraOff: !state.cameraOff })
      current.stream.getVideoTracks().forEach(track => { track.enabled = !state.cameraOff })
    },
    setLocalVideo(element: HTMLVideoElement | null): void {
      if (localVideo === element) return
      void bindVideo(localVideo)
      localVideo = element
      void bindVideo(localVideo, current?.type === 'video' ? current.stream : undefined).catch(() => {})
    },
    setRemoteVideo(element: HTMLVideoElement | null): void {
      if (remoteVideo === element) return
      void bindVideo(remoteVideo)
      remoteVideo = element
      if (current?.remoteStream) void play()
      else void bindVideo(remoteVideo)
    },
    play,
    dismiss: () => { if (!current) publish({ phase: 'idle' }) },
    destroy: () => { if (disposed) return; disposed = true; finish('callEnded', true) },
  }
}

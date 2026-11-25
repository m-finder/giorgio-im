import { createUuid } from './uuid'
import type { VoiceCallState } from './call'
import type { ImCallSignal, ImCallType, ImContact, ImId, ImUser, ImVoiceCallOptions } from './types'
import type { ImLocaleKey } from './locales'

export interface GroupCallState extends VoiceCallState {
  groupId?: ImId
  participants: (ImContact & { connected: boolean })[]
}

/** Mesh media connections for the joined members of one group call. */
export function createGroupCall(options: () => ImVoiceCallOptions | undefined, user: () => ImContact | ImUser | ImId, update: (state: GroupCallState) => void) {
  type Member = { contact: ImContact; peer?: RTCPeerConnection; stream?: MediaStream; audio?: HTMLAudioElement; queue?: Promise<void>; cancelGather?: () => void; deadline?: ReturnType<typeof setTimeout>; disconnected?: ReturnType<typeof setTimeout> }
  let state: GroupCallState = { phase: 'idle', type: 'voice', muted: false, cameraOff: false, duration: 0, playbackBlocked: false, participants: [] }
  let current: { id: string; contact: ImContact; type: ImCallType; incoming: boolean; joined: boolean; stream?: MediaStream; members: Map<string, Member> } | undefined
  let localVideo: HTMLVideoElement | null = null
  const remoteVideos = new Map<string, HTMLVideoElement>()
  let deadline: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  let sendQueue: Promise<void> | undefined
  let disposed = false
  const userId = () => { const identity = user(); return typeof identity === 'object' ? identity.id : identity }
  const publish = (patch: Partial<GroupCallState> = {}) => {
    state = { ...state, ...patch, participants: current ? [...current.members.values()].map(member => ({ ...member.contact, connected: member.peer?.connectionState === 'connected' })) : [] }
    if (!disposed) update(state)
  }
  const send = (signal: ImCallSignal) => {
    let delivery: Promise<unknown>
    try { delivery = sendQueue ? sendQueue.then(() => options()?.sendSignal(signal)) : Promise.resolve(options()?.sendSignal(signal)) }
    catch (error) { delivery = Promise.reject(error) }
    const settled = sendQueue = delivery.then(() => {}, () => {})
    void settled.then(() => { if (sendQueue === settled) sendQueue = undefined })
    return delivery
  }

  function bindVideo(element: HTMLVideoElement | null | undefined, stream?: MediaStream): Promise<void> {
    if (!element) return Promise.resolve()
    element.muted = element.playsInline = element.autoplay = true
    if (element.srcObject !== (stream ?? null)) element.srcObject = stream ?? null
    if (stream) return element.play()
    element.pause()
    return Promise.resolve()
  }

  function closeMember(member: Member): void {
    clearTimeout(member.deadline)
    clearTimeout(member.disconnected)
    member.cancelGather?.()
    if (member.peer) { member.peer.ontrack = member.peer.onconnectionstatechange = null; member.peer.close(); member.peer = undefined }
    if (member.audio) { member.audio.pause(); member.audio.srcObject = null }
    member.audio = undefined
    member.stream = undefined
    void bindVideo(remoteVideos.get(String(member.contact.id)))
  }

  function finish(reason: ImLocaleKey = 'callEnded', notify = false): void {
    const call = current
    current = undefined
    clearTimeout(deadline)
    clearInterval(ticker)
    call?.members.forEach(closeMember)
    call?.stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    void bindVideo(localVideo)
    remoteVideos.forEach(element => { void bindVideo(element) })
    if (call && notify) void send({ callId: call.id, id: call.contact.id, groupId: call.contact.id, action: state.phase === 'incoming' ? 'reject' : call.incoming ? 'leave' : 'end' }).catch(() => {})
    publish({ phase: 'ended', reason, playbackBlocked: false })
  }

  async function playMember(call: NonNullable<typeof current>, member: Member): Promise<void> {
    if (!member.audio || !member.stream) return
    await Promise.all([member.audio.play(), bindVideo(remoteVideos.get(String(member.contact.id)), member.stream)])
    if (current !== call) return
  }

  async function play(): Promise<void> {
    const call = current
    if (!call) return
    try {
      await Promise.all([...call.members.values()].map(member => playMember(call, member)))
      if (current === call) publish({ playbackBlocked: false })
    } catch { if (current === call) publish({ playbackBlocked: true }) }
  }

  function peerFor(call: NonNullable<typeof current>, member: Member): RTCPeerConnection {
    if (member.peer) return member.peer
    const peer = member.peer = new RTCPeerConnection({ iceServers: options()?.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }] })
    const audio = member.audio = new Audio()
    audio.autoplay = true
    const live = () => current === call && member.peer === peer
    call.stream!.getTracks().forEach(track => peer.addTrack(track, call.stream!))
    peer.ontrack = event => {
      if (!live()) return
      member.stream ??= event.streams[0] ?? new MediaStream()
      if (event.track && !member.stream.getTracks().includes(event.track)) member.stream.addTrack(event.track)
      audio.srcObject = member.stream
      void play().catch(() => {})
    }
    peer.onconnectionstatechange = () => {
      if (!live()) return
      clearTimeout(member.disconnected)
      if (peer.connectionState === 'connected') {
        clearTimeout(deadline)
        clearTimeout(member.deadline)
        publish({ phase: 'connected' })
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        closeMember(member)
        publish()
      } else if (peer.connectionState === 'disconnected') member.disconnected = setTimeout(() => { if (live()) { closeMember(member); publish() } }, 15000)
    }
    member.deadline = setTimeout(() => { if (live() && peer.connectionState !== 'connected') { closeMember(member); publish() } }, 30000)
    return peer
  }

  async function description(call: NonNullable<typeof current>, member: Member, offer?: string): Promise<void> {
    const peer = peerFor(call, member)
    const live = () => current === call && member.peer === peer
    if (offer) await peer.setRemoteDescription({ type: 'offer', sdp: offer })
    if (!live()) return
    await peer.setLocalDescription(offer ? await peer.createAnswer() : await peer.createOffer())
    if (!live()) return
    if (peer.iceGatheringState !== 'complete') await new Promise<void>(resolve => {
      const complete = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); member.cancelGather = undefined; resolve() }
      const changed = () => { if (peer.iceGatheringState === 'complete') complete() }
      const timer = setTimeout(complete, 10000)
      member.cancelGather = complete
      peer.addEventListener('icegatheringstatechange', changed)
      changed()
    })
    if (!live()) return
    const sdp = peer.localDescription?.sdp
    if (!sdp) throw new Error('Missing group session description')
    await send({ callId: call.id, id: member.contact.id, groupId: call.contact.id, type: call.type, action: offer ? 'answer' : 'offer', sdp })
  }

  function enqueue(call: NonNullable<typeof current>, member: Member, action: () => Promise<void>): void {
    member.queue = (member.queue ?? Promise.resolve()).then(async () => { if (current === call && call.members.get(String(member.contact.id)) === member) await action() })
      .catch(() => { if (current === call) { closeMember(member); publish() } })
  }

  function roster(call: NonNullable<typeof current>, participants: ImContact[]): void {
    const contacts = participants.filter(contact => String(contact.id) !== String(userId()))
    const included = new Set(contacts.map(contact => String(contact.id)))
    for (const [id, member] of call.members) if (!included.has(id)) { closeMember(member); call.members.delete(id) }
    for (const contact of contacts) {
      const id = String(contact.id)
      let member = call.members.get(id)
      if (!member) { member = { contact: { ...contact } }; call.members.set(id, member) }
      else member.contact = { ...contact }
      if (call.joined && call.stream && !member.peer) {
        peerFor(call, member)
        if (String(userId()) < id) enqueue(call, member, () => description(call, member!))
      }
    }
    publish()
  }

  async function join(call: NonNullable<typeof current>): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') { finish('callUnsupported', true); return }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.type === 'video' })
      if (current !== call) { stream.getTracks().forEach(track => track.stop()); return }
      call.stream = stream
      stream.getTracks().forEach(track => { track.onended = () => { if (current === call) finish(track.kind === 'video' ? 'cameraUnavailable' : 'microphoneUnavailable', true) } })
      if (call.type === 'video') void bindVideo(localVideo, stream).catch(() => {})
      if (call.incoming) {
        call.joined = true
        publish({ phase: 'connecting' })
        await send({ callId: call.id, id: call.contact.id, groupId: call.contact.id, type: call.type, action: 'join' })
      } else {
        await send({ callId: call.id, id: call.contact.id, groupId: call.contact.id, type: call.type, action: 'invite' })
        if (current !== call) return
        call.joined = true
        publish({ phase: 'calling' })
      }
      if (current !== call) return
      if (call.incoming) clearTimeout(deadline)
      roster(call, [...call.members.values()].map(member => member.contact))
      const started = Date.now()
      ticker = setInterval(() => {
        publish({ duration: Math.floor((Date.now() - started) / 1000) })
        if (state.duration % 30 === 0) void send({ callId: call.id, id: call.contact.id, groupId: call.contact.id, action: 'keepalive' })
          .catch(() => { if (current === call) finish('callConnectionFailed', true) })
      }, 1000)
    } catch (error) {
      if (current !== call) return
      const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined
      finish(name === 'NotAllowedError' ? call.type === 'video' ? 'cameraDenied' : 'microphoneDenied'
        : ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(String(name)) ? call.type === 'video' ? 'cameraUnavailable' : 'microphoneUnavailable'
          : 'callConnectionFailed', true)
    }
  }

  return {
    mount: () => { disposed = false },
    start(group: ImContact, membersOrType: ImContact[] | ImCallType = 'voice', requestedType: ImCallType = 'voice'): void {
      if (disposed || current || !options()) return
      const type = Array.isArray(membersOrType) ? requestedType : membersOrType
      const call = current = { id: createUuid(), contact: { ...group, type: 'group' }, type, incoming: false, joined: false, members: new Map<string, Member>() }
      publish({ phase: 'requesting', groupId: group.id, type, contact: call.contact, muted: false, cameraOff: false, duration: 0, playbackBlocked: false, reason: undefined })
      deadline = setTimeout(() => finish('callTimeout', true), 60000)
      void join(call)
    },
    accept(): void {
      if (!current || state.phase !== 'incoming') return
      publish({ phase: 'requesting' })
      void join(current)
    },
    receive(signal: ImCallSignal): void {
      if (disposed || !options() || signal.groupId === undefined) return
      if (signal.action === 'invite') {
        if (!signal.expiresAt || signal.expiresAt <= Date.now() || current?.id === signal.callId) return
        if (current) { void send({ callId: signal.callId, id: signal.groupId, groupId: signal.groupId, action: 'reject' }).catch(() => {}); return }
        current = { id: signal.callId, contact: { ...signal.group, id: signal.groupId, type: 'group' }, type: signal.type === 'video' ? 'video' : 'voice', incoming: true, joined: false, members: new Map() }
        roster(current, signal.participants ?? [])
        publish({ phase: 'incoming', groupId: signal.groupId, type: current.type, contact: current.contact, muted: false, cameraOff: false, duration: 0, playbackBlocked: false, reason: undefined })
        deadline = setTimeout(() => finish('callTimeout', true), Math.min(60000, signal.expiresAt - Date.now()))
        return
      }
      const call = current
      if (!call || call.id !== signal.callId || String(call.contact.id) !== String(signal.groupId)) return
      if (signal.action === 'end') { finish(); return }
      if (signal.action === 'leave') {
        if (String(signal.id) === String(userId())) { finish(); return }
        const member = call.members.get(String(signal.id))
        if (member) { closeMember(member); call.members.delete(String(signal.id)) }
        if (signal.participants) roster(call, signal.participants)
        else publish()
        return
      }
      if (signal.action === 'join') { if (signal.participants) roster(call, signal.participants); return }
      if (!call.joined || !call.stream || String(signal.id) === String(userId())) return
      const member = call.members.get(String(signal.id))
      if (!member || !signal.sdp) return
      if (signal.action === 'offer' && String(signal.id) < String(userId())) enqueue(call, member, () => description(call, member, signal.sdp))
      else if (signal.action === 'answer' && member.peer && String(userId()) < String(signal.id)) enqueue(call, member, async () => { await member.peer?.setRemoteDescription({ type: 'answer', sdp: signal.sdp }) })
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
    setRemoteVideo(id: ImId, element: HTMLVideoElement | null): void {
      const key = String(id)
      if (remoteVideos.get(key) === element) return
      void bindVideo(remoteVideos.get(key))
      if (element) remoteVideos.set(key, element)
      else remoteVideos.delete(key)
      const call = current, member = call?.members.get(key)
      if (call && member?.stream) void play()
      else void bindVideo(element)
    },
    play,
    dismiss: () => { if (!current) publish({ phase: 'idle' }) },
    destroy: () => { if (disposed) return; disposed = true; finish('callEnded', true) },
  }
}

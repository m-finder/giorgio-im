import { createIM } from './index'
import { assertImTransport, type ImTransportOptions } from './transport'
import { createUuid } from './uuid'
import type { ImChatNotice, ImContact, ImFriendGroup, ImGroupMember, ImId, ImInit, ImMessage, ImNotice, ImOptions, ImReadPayload, ImReadReceipt, ImSendPayload, ImTypingPayload, ImTypingState, ImUser, ImWidgetApi } from './types'

export type ImConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'closed'

export interface ImConnectionOptions {
  /** Laravel IM API root, such as '/api/im'. */
  apiUrl?: string
  /** Sanctum bearer token, or a function returning the current token. */
  token: string | (() => string | Promise<string>)
  /** Overrides socketUrl returned by the init endpoint. */
  socketUrl?: string
  /** Maximum HTTP request time in milliseconds. Defaults to 15000. */
  requestTimeout?: number
  /** TLS policy for API requests and the socket connection. */
  transport?: ImTransportOptions
  /** Widget UI options and optional application callbacks. Server data supplies init. */
  widget?: Omit<ImOptions, 'init'>
  onConnectionChange?: (state: ImConnectionState) => void
  onError?: (error: Error, operation: string, payload?: ImSendPayload) => void
}

export interface ConnectedIM extends ImWidgetApi {
  readonly connectionState: ImConnectionState
  /** Retry after connectivity or credentials change. */
  reconnect: () => void
  /** Fetch pending events through the authenticated socket in server order. */
  sync: () => Promise<void>
  /** Send or retry a payload. Reuse its mid to avoid duplicate delivery. */
  sendMessage: (payload: ImSendPayload) => Promise<ImMessage>
  destroy: () => void
}

export class ImHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ImHttpError' }
}

interface Snapshot { init: ImInit; notices: ImNotice[]; cursor: number; socketUrl: string }
interface ServerEvent { id: number; type: string; data: Record<string, unknown>; timestamp?: number }
interface EventPage { events: ServerEvent[]; cursor: number; hasMore: boolean }

/** Connect a widget to the Laravel Giorgio IM API and Giorgio Socket transport. */
export async function createConnectedIM(options: ImConnectionOptions): Promise<ConnectedIM> {
  const root = (options.apiUrl ?? '/api/im').replace(/\/$/, '')
  assertImTransport(root, 'http', options.transport)
  const controllers = new Set<AbortController>()
  let alive = true
  let state: ImConnectionState = 'connecting'
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let authenticationTimer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let epoch = 0
  let lastPong = 0
  let syncing: Promise<void> | undefined
  let syncAgain = false
  let syncSequence = 0
  let pendingPage: { id: number; resolve: (page: EventPage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  let profileQueue = Promise.resolve()
  let profileRevision = 0
  const pendingReads = new Map<string, ImReadPayload>()
  let reading: Promise<void> | undefined
  let typingQueue = Promise.resolve()
  const report = (error: unknown, operation: string, payload?: ImSendPayload) => {
    if (alive) options.onError?.(error instanceof Error ? error : new Error(String(error)), operation, payload)
  }
  const changeState = (next: ImConnectionState) => {
    if (state !== next) { state = next; options.onConnectionChange?.(next) }
  }
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!alive) throw new Error('IM connection is closed')
    const controller = new AbortController()
    controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), options.requestTimeout ?? 15000)
    try {
      const token = typeof options.token === 'function' ? await options.token() : options.token
      if (!alive) throw new Error('IM connection is closed')
      const form = body instanceof FormData
      const response = await fetch(`${root}${path}`, {
        method, signal: controller.signal, redirect: 'error',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { message?: string }
        throw new ImHttpError(response.status, data.message || `HTTP ${response.status}`)
      }
      return await response.json() as T
    } finally { clearTimeout(timer); controllers.delete(controller) }
  }
  const snapshot = await request<Snapshot>('/init')
  const socketUrl = options.socketUrl ?? snapshot.socketUrl
  assertImTransport(socketUrl, 'socket', options.transport)
  let cursor = snapshot.cursor
  let savedUser = snapshot.init.user
  const ui = options.widget ?? {}
  const groupPath = (contact: ImContact) => `/groups/${encodeURIComponent(contact.id)}`
  const memberPath = (group: ImContact, member: ImContact) => `${groupPath(group)}/members/${encodeURIComponent(member.id)}`
  const upload = async (file: File, kind: string) => {
    const form = new FormData()
    form.set('file', file)
    form.set('kind', kind)
    return (await request<{ url: string }>('/uploads', 'POST', form)).url
  }
  const patchUser = (patch: Partial<ImUser>) => {
    const revision = ++profileRevision
    profileQueue = profileQueue.then(async () => {
      try {
        savedUser = await request<ImUser>('/user', 'PATCH', patch)
        if (alive && revision === profileRevision) im.setUser(savedUser)
      } catch (error) {
        if (alive && revision === profileRevision) im.setUser(savedUser)
        report(error, 'updateUser')
      } finally { if (revision === profileRevision) profileRevision = 0 }
    })
  }
  async function sendMessage(payload: ImSendPayload): Promise<ImMessage> {
    if (payload.receiver.type === 'ai') throw new Error('AI requests must use widget.onSendMessage')
    payload.mid ??= createUuid()
    return request<ImMessage>('/messages', 'POST', {
      id: payload.receiver.id, type: payload.receiver.type, mid: payload.mid,
      content: payload.content, ...(payload.attachment ? { attachment: payload.attachment } : {}),
    })
  }
  function queueRead(payload: ImReadPayload): void {
    const key = `${payload.type}:${payload.id}`
    const previous = pendingReads.get(key)
    pendingReads.set(key, { ...payload, mids: [...new Set([...(previous?.mids || []), ...payload.mids])] })
    void flushReads()
  }
  async function flushReads(): Promise<void> {
    if (reading) return reading
    reading = (async () => {
      for (const [key, pending] of pendingReads) {
        while (alive && pendingReads.has(key)) {
          const receipt = { ...pending, mids: pendingReads.get(key)!.mids.slice(0, 100) }
          try {
            await request('/messages/read', 'POST', receipt)
            if (!alive) return
            const confirmed = new Set(receipt.mids)
            const remaining = pendingReads.get(key)!.mids.filter(mid => !confirmed.has(mid))
            if (remaining.length) pendingReads.set(key, { ...pending, mids: remaining })
            else pendingReads.delete(key)
            im.setMessageRead({ ...receipt, readerId: snapshot.init.user.id })
          } catch (error) {
            if (error instanceof ImHttpError && [403, 404, 422].includes(error.status)) pendingReads.delete(key)
            report(error, 'readMessages')
            return
          }
        }
      }
    })().finally(() => { reading = undefined })
    return reading
  }
  function publishTyping(payload: ImTypingPayload): void {
    const queuedAt = Date.now()
    typingQueue = typingQueue.then(async () => {
      if (!alive || (payload.typing && Date.now() - queuedAt > 3000)) return
      try { await request('/conversations/typing', 'POST', payload) }
      catch (error) { report(error, 'typing') }
    })
  }
  const im = createIM({
    ...ui, init: snapshot.init, notices: snapshot.notices,
    loadHistory: async receiver => receiver.type === 'ai' ? await ui.loadHistory?.(receiver) ?? []
      : (await request<{ messages: ImMessage[] }>(`/messages?type=${receiver.type}&id=${encodeURIComponent(receiver.id)}`)).messages,
    loadGroupMembers: receiver => request<ImGroupMember[]>(`${groupPath(receiver)}/members`),
    findContacts: query => request<ImContact[]>(`/users?q=${encodeURIComponent(query)}`),
    requestFriend: async contact => { await request('/friend-requests', 'POST', { id: contact.id }) },
    deleteFriend: async contact => { await request(`/friends/${encodeURIComponent(contact.id)}`, 'DELETE') },
    blockFriend: async contact => { await request(`/blocks/${encodeURIComponent(contact.id)}`, 'POST') },
    unblockFriend: async contact => { await request(`/blocks/${encodeURIComponent(contact.id)}`, 'DELETE') },
    acceptFriend: async (_contact, groupId, notice) => { await request(`/notices/${encodeURIComponent(notice.id)}`, 'POST', { action: 'accept', groupId }) },
    createFriendGroup: groupname => request<ImFriendGroup>('/friend-groups', 'POST', { groupname }),
    moveFriend: async (contact, groupId) => { await request(`/friends/${encodeURIComponent(contact.id)}/group`, 'PATCH', { groupId }) },
    createGroup: payload => request<ImContact>('/groups', 'POST', { groupname: payload.groupname, members: payload.members.map(member => member.id) }),
    leaveGroup: async group => { await request(`${groupPath(group)}/leave`, 'POST') },
    inviteGroupMembers: async (group, members) => { await request(`${groupPath(group)}/members`, 'POST', { members: members.map(member => member.id) }) },
    removeGroupMember: async (group, member) => { await request(memberPath(group, member), 'DELETE') },
    dismissGroup: async group => { await request(groupPath(group), 'DELETE') },
    muteGroupMember: async (group, member, muted) => { await request(`${memberPath(group, member)}/mute`, 'PATCH', { muted }) },
    muteGroup: async (group, muted) => { await request(`${groupPath(group)}/mute`, 'PATCH', { muted }) },
    setGroupAdmin: async (group, member, admin) => { await request(`${memberPath(group, member)}/admin`, 'PATCH', { admin }) },
    renameGroup: async (group, groupname) => { await request(groupPath(group), 'PATCH', { groupname }) },
    uploadGroupAvatar: async (file, group) => {
      const avatar = await upload(file, 'image')
      await request(groupPath(group), 'PATCH', { avatar })
      return avatar
    },
    uploadAvatar: async file => {
      const avatar = await upload(file, 'image')
      savedUser = await request<ImUser>('/user', 'PATCH', { avatar })
      return avatar
    },
    uploadAttachment: (file) => upload(file, file.type.startsWith('image/') ? 'image' : 'file'),
    uploadVoice: file => upload(file, 'audio'),
    onSendMessage: payload => {
      if (payload.receiver.type === 'ai') { ui.onSendMessage?.(payload); return }
      void sendMessage(payload).then(() => {
        if (alive) { im.setChatStatus('', payload.receiver); ui.onSendMessage?.(payload) }
      }).catch(error => {
        if (alive) im.setChatStatus(error instanceof Error ? error.message : 'Message failed', payload.receiver)
        report(error, 'sendMessage', payload)
      })
    },
    onRead: payload => { queueRead(payload); ui.onRead?.(payload) },
    onTyping: payload => { publishTyping(payload); ui.onTyping?.(payload) },
    onUsername: value => { patchUser({ username: value }); ui.onUsername?.(value) },
    onSign: value => { patchUser({ sign: value }); ui.onSign?.(value) },
    onOnline: value => { patchUser({ status: value }); ui.onOnline?.(value) },
    onNoticeAction: (notice, action, groupId) => {
      if (action !== 'accept') void request(`/notices/${encodeURIComponent(notice.id)}`, 'POST', { action }).catch(error => report(error, 'noticeAction'))
      ui.onNoticeAction?.(notice, action, groupId)
    },
  })
  // The server remains authoritative when an optional local backup is restored.
  im.setUser(savedUser)
  im.setContacts(snapshot.init)

  async function apply(event: ServerEvent): Promise<void> {
    const data = event.data
    switch (event.type) {
      case 'message': im.getMessage(data as unknown as ImMessage); break
      case 'user.updated': savedUser = data as unknown as ImUser; if (!profileRevision) im.setUser(savedUser); break
      case 'contact.updated': {
        const contact = data.contact as ImContact & { type: 'friend' }
        im.updateContact(contact, data.groupId as ImId | undefined)
        if (data.notice) im.getChatNotice({ ...(data.notice as ImChatNotice), mid: `event:${event.id}` })
        if (data.presenceChanged) im.getChatNotice({ id: contact.id, event: contact.status === 'online' ? 'online' : 'offline', mid: `presence:${event.id}`, timestamp: event.timestamp })
        break
      }
      case 'category.updated': im.addFriendGroup(data as unknown as ImFriendGroup); break
      case 'friend.moved': im.moveFriend(data.id as ImId, data.groupId as ImId); break
      case 'friend.removed': im.removeFriend(data.id as ImId); break
      case 'user.blocked': im.setFriendBlocked(data.contact as ImContact, true); break
      case 'user.unblocked': im.setFriendBlocked({ id: data.id as ImId }, false); break
      case 'group.removed': im.removeGroup(data.id as ImId); break
      case 'notice.updated': im.getNotice(data as unknown as ImNotice); break
      case 'presence':
        im.setFriendStatus(data.id as ImId, data.status as 'online' | 'offline')
        im.getChatNotice({ id: data.id as ImId, event: data.status === 'online' ? 'online' : 'offline', mid: `event:${event.id}`, timestamp: data.timestamp as number | undefined ?? event.timestamp })
        break
      case 'message.read': im.setMessageRead(data as unknown as ImReadReceipt); break
      case 'typing': im.setTyping(data as unknown as ImTypingState); break
      case 'group.updated': {
        const group = data.contact as ImContact & { type: 'group' }
        im.updateContact(group)
        try { im.setGroupMembers(group.id, await request<ImGroupMember[]>(`${groupPath(group)}/members`)) }
        catch (error) { if (!(error instanceof ImHttpError && [403, 404].includes(error.status))) throw error }
        break
      }
    }
  }
  async function sync(): Promise<void> {
    if (!alive) return
    if (syncing) { syncAgain = true; return syncing }
    syncing = (async () => {
      let more = true
      while (alive && more) {
        syncAgain = false
        const page = await requestEvents()
        if (!alive) return
        for (const event of page.events) {
          if (event.id <= cursor) continue
          await apply(event)
          cursor = event.id
        }
        if (page.hasMore && !page.events.length) throw new Error('Invalid event cursor')
        more = page.hasMore || syncAgain
      }
    })().finally(() => { syncing = undefined; if (syncAgain) backgroundSync() })
    return syncing
  }
  function cancelPage(error: Error): void {
    if (!pendingPage) return
    const pending = pendingPage
    pendingPage = undefined
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  function requestEvents(): Promise<EventPage> {
    const ws = socket
    if (state !== 'online' || !ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Socket is not connected'))
    return new Promise((resolve, reject) => {
      const id = ++syncSequence
      const timer = setTimeout(() => { cancelPage(new Error('Socket event sync timed out')); ws.close() }, options.requestTimeout ?? 15000)
      pendingPage = { id, resolve, reject, timer }
      try { ws.send(JSON.stringify({ type: 'sync', after: cursor, request_id: id })) }
      catch (error) { cancelPage(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  const backgroundSync = () => {
    if (state !== 'online') return
    const ws = socket
    void sync().then(flushReads).catch(error => {
      if (!(error instanceof Error && ['Socket disconnected', 'Socket reconnecting'].includes(error.message))) report(error, 'sync')
      if (alive && socket === ws) ws?.close()
    })
  }
  function scheduleReconnect(): void {
    if (!alive || reconnectTimer) return
    changeState('reconnecting')
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 250
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void connect() }, delay)
  }
  async function connect(): Promise<void> {
    if (!alive) return
    const session = ++epoch
    clearInterval(heartbeatTimer)
    clearTimeout(authenticationTimer)
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    cancelPage(new Error('Socket reconnecting'))
    socket?.close()
    changeState(attempts ? 'reconnecting' : 'connecting')
    try {
      const ticket = await request<{ token: string }>('/socket-ticket', 'POST')
      if (!alive || session !== epoch) return
      const ws = new WebSocket(socketUrl)
      socket = ws
      // The ticket stays out of URLs and server access logs.
      ws.onopen = () => { if (alive && session === epoch) ws.send(JSON.stringify({ type: 'connect', token: ticket.token })) }
      authenticationTimer = setTimeout(() => { if (session === epoch && ws.readyState !== WebSocket.CLOSED && state !== 'online') ws.close() }, 10000)
      ws.onmessage = event => {
        if (!alive || session !== epoch) return
        try {
          const packet = JSON.parse(String(event.data)) as EventPage & { type?: string; user_id?: ImId; request_id?: number }
          if (packet.type === 'connected') {
            if (String(packet.user_id) !== String(snapshot.init.user.id)) { ws.close(); throw new Error('Socket identity mismatch') }
            clearTimeout(authenticationTimer)
            attempts = 0
            lastPong = Date.now()
            changeState('online')
            backgroundSync()
            clearInterval(heartbeatTimer)
            heartbeatTimer = setInterval(() => {
              if (Date.now() - lastPong > 60000) { ws.close(); return }
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
            }, 25000)
          } else if (packet.type === 'events' && pendingPage && pendingPage.id === packet.request_id) {
            if (!Array.isArray(packet.events) || typeof packet.hasMore !== 'boolean'
              || !packet.events.every((item, index) => Number.isSafeInteger(item.id) && item.id > 0
                && (!index || item.id > packet.events[index - 1].id)
                && typeof item.type === 'string' && item.data && typeof item.data === 'object')) {
              cancelPage(new Error('Invalid socket event page')); ws.close(); return
            }
            const pending = pendingPage
            pendingPage = undefined
            clearTimeout(pending.timer)
            pending.resolve(packet)
          } else if (packet.type === 'pong') { lastPong = Date.now(); void flushReads() }
          else if (packet.type === 'system') backgroundSync()
          else if (packet.type === 'error') report(new Error('Socket rejected a packet'), 'socket')
        } catch (error) { report(error, 'socket') }
      }
      ws.onerror = () => { if (alive && session === epoch) ws.close() }
      ws.onclose = () => {
        if (!alive || session !== epoch) return
        clearTimeout(authenticationTimer)
        clearInterval(heartbeatTimer)
        cancelPage(new Error('Socket disconnected'))
        scheduleReconnect()
      }
    } catch (error) {
      if (!alive || session !== epoch) return
      report(error, 'connect')
      if (error instanceof ImHttpError && [401, 403].includes(error.status)) changeState('offline')
      else scheduleReconnect()
    }
  }
  const visibleSync = () => { if (document.visibilityState !== 'hidden') backgroundSync() }
  window.addEventListener('online', backgroundSync)
  document.addEventListener('visibilitychange', visibleSync)
  void connect()
  return {
    ...im, get connectionState() { return state }, reconnect: () => { attempts = 0; void connect() }, sync, sendMessage,
    destroy: () => {
      if (!alive) return
      alive = false
      epoch++
      clearTimeout(reconnectTimer)
      clearInterval(heartbeatTimer)
      clearTimeout(authenticationTimer)
      cancelPage(new Error('IM connection is closed'))
      for (const controller of controllers) controller.abort()
      socket?.close()
      window.removeEventListener('online', backgroundSync)
      document.removeEventListener('visibilitychange', visibleSync)
      changeState('closed')
      im.destroy()
    },
  }
}

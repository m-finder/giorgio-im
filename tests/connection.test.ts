import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createConnectedIM, type ConnectedIM, type ImInit, type ImSendPayload } from '../src'

const init: ImInit = {
  user: { id: 1, username: 'Me' },
  friend: [{ id: 1, groupname: 'Friends', list: [{ id: 2, username: 'Alice' }] }],
  group: [{ id: 3, groupname: 'Team', ownerId: 2, members: 2 }],
}
const instances: ConnectedIM[] = []
class Socket {
  static OPEN = 1
  static CLOSED = 3
  static instances: Socket[] = []
  static events: (after: number) => Promise<unknown>
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { Socket.instances.push(this) }
  send(data: string) {
    this.sent.push(data)
    const packet = JSON.parse(data)
    if (packet.type === 'sync') void Socket.events(packet.after).then(page => this.receive({ type: 'events', request_id: packet.request_id, ...page as object }))
  }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  receive(packet: unknown) { this.onmessage?.({ data: JSON.stringify(packet) }) }
}
function setup(handler?: (path: string, options?: RequestInit) => unknown) {
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  Socket.events = async after => await handler?.(`/socket-events?after=${after}`) ?? { events: [], cursor: after, hasMore: false }
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.replace('/api/im', '')
    const value = await handler?.(path, options)
    if (value instanceof Response) return value
    return new Response(JSON.stringify(value ?? (path === '/init' ? { init, notices: [], cursor: 0, socketUrl: 'ws://localhost:9501' }
      : path === '/socket-ticket' ? { token: 'secret-ticket' }
        : {})), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
async function connect(options: Parameters<typeof createConnectedIM>[0] = { token: 'token' }, authenticate = true) {
  const im = await createConnectedIM({ ...options, widget: { target: document.createElement('div'), ...options.widget } })
  instances.push(im)
  await flushPromises()
  if (authenticate && Socket.instances.length) {
    const ws = Socket.instances.at(-1)!
    ws.open()
    ws.receive({ type: 'connected', user_id: 1 })
    await flushPromises()
  }
  return im
}
afterEach(() => {
  for (const im of instances.splice(0)) im.destroy()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Laravel and Giorgio Socket connection', () => {
  it('does not poll HTTP or Socket events while idle, and syncs through Socket on a push', async () => {
    vi.useFakeTimers()
    const fetch = setup()
    await connect()
    const ws = Socket.instances[0]
    const initialRequests = fetch.mock.calls.length
    const initialPackets = ws.sent.length
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetch.mock.calls).toHaveLength(initialRequests)
    expect(ws.sent).toHaveLength(initialPackets)
    ws.receive({ type: 'system', data: { id: 9, type: 'presence' } })
    await flushPromises()
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ type: 'sync', after: 0 })
    expect(fetch.mock.calls.some(([url]) => url.includes('/events?'))).toBe(false)
  })

  it('pages missed events through Socket and preserves the last applied cursor on reconnect', async () => {
    vi.useFakeTimers()
    setup()
    const target = document.createElement('div')
    const im = await connect({ token: 'token', widget: { target } })
    const requested: number[] = []
    Socket.events = async after => {
      requested.push(after)
      return { events: after === 0 ? [{ id: 4, type: 'user.updated', data: { id: 1, username: 'Updated' } }]
        : after === 4 ? [{ id: 8, type: 'user.updated', data: { id: 1, username: 'Newest' } }] : [], hasMore: after === 0 }
    }
    await im.sync()
    expect(requested).toEqual([0, 4])
    im.open(); await nextTick()
    expect(target.querySelector<HTMLInputElement>('.gim-profile-name')?.value).toBe('Newest')
    Socket.instances[0].close()
    await vi.advanceTimersByTimeAsync(1300)
    const next = Socket.instances.at(-1)!
    next.open(); next.receive({ type: 'connected', user_id: 1 })
    await flushPromises()
    expect(JSON.parse(next.sent[1])).toMatchObject({ type: 'sync', after: 8 })
  })

  it('does not lose a push arriving during an in-flight sync and ignores unrelated replies', async () => {
    setup()
    const im = await connect()
    let finish!: (page: unknown) => void
    Socket.events = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const syncing = im.sync()
    const ws = Socket.instances[0]
    const requestId = JSON.parse(ws.sent.at(-1)!).request_id
    ws.receive({ type: 'events', request_id: requestId - 1, events: [], hasMore: false })
    ws.receive({ type: 'system' })
    Socket.events = vi.fn(async () => ({ events: [], hasMore: false }))
    finish({ events: [{ id: 6, type: 'presence', data: { id: 2, status: 'online' } }], hasMore: false })
    await syncing
    expect(Socket.events).toHaveBeenCalledWith(6)
  })

  it('rejects an interrupted replay and ignores its stale response after reconnect', async () => {
    vi.useFakeTimers()
    setup()
    const im = await connect()
    let finish!: (page: unknown) => void
    Socket.events = () => new Promise(resolve => { finish = resolve })
    const result = expect(im.sync()).rejects.toThrow('Socket disconnected')
    const old = Socket.instances[0]
    old.close()
    await result
    Socket.events = async () => ({ events: [], hasMore: false })
    await vi.advanceTimersByTimeAsync(1300)
    const next = Socket.instances.at(-1)!
    next.open(); next.receive({ type: 'connected', user_id: 1 })
    await flushPromises()
    finish({ events: [{ id: 99, type: 'presence', data: { id: 2, status: 'online' } }], hasMore: false })
    await flushPromises()
    await im.sync()
    expect(JSON.parse(next.sent.at(-1)!)).toMatchObject({ type: 'sync', after: 0 })
  })

  it('rejects insecure remote APIs before resolving credentials or sending a request', async () => {
    const fetch = setup()
    const token = vi.fn(() => 'secret')
    await expect(connect({ apiUrl: 'http://im.example/api/im', token })).rejects.toThrow(/TLS/)
    expect({ requests: fetch.mock.calls.length, credentials: token.mock.calls.length }).toEqual({ requests: 0, credentials: 0 })
  })

  it('rejects an insecure socket URL from init before mounting or issuing a socket ticket', async () => {
    const fetch = setup(path => path === '/init' ? { init, notices: [], cursor: 0, socketUrl: 'ws://im.example/socket' } : undefined)
    const target = document.createElement('div')
    await expect(connect({ token: 'token', widget: { target } })).rejects.toThrow(/TLS/)
    expect({ requests: fetch.mock.calls.length, children: target.children.length, sockets: Socket.instances.length })
      .toEqual({ requests: 1, children: 0, sockets: 0 })
  })

  it('uses a bearer token for HTTP and authenticates the socket without putting tickets in its URL', async () => {
    const fetch = setup()
    const im = await connect({ token: 'token' }, false)
    const ws = Socket.instances[0]
    ws.open()
    expect({ url: ws.url, packet: JSON.parse(ws.sent[0]), headers: fetch.mock.calls[0][1]?.headers, redirect: fetch.mock.calls[0][1]?.redirect })
      .toEqual({ url: 'ws://localhost:9501', packet: { type: 'connect', token: 'secret-ticket' }, headers: expect.objectContaining({ Authorization: 'Bearer token' }), redirect: 'error' })
    expect(im.connectionState).toBe('connecting')
    ws.receive({ type: 'connected', user_id: 1 })
    await flushPromises()
    expect(im.connectionState).toBe('online')
  })

  it('applies ordered events exactly once, refreshes group permissions and removes kicked groups', async () => {
    let events = [
      { id: 1, type: 'message', data: { id: 2, type: 'friend', content: 'Hi', mid: 'one' } },
      { id: 2, type: 'group.updated', data: { contact: { ...init.group![0], type: 'group', muteAll: true, adminIds: [] } } },
    ]
    setup(path => path.startsWith('/socket-events?') ? { events, hasMore: false, cursor: 2 }
      : path === '/groups/3/members' ? [{ id: 1, username: 'Me', muted: true }, { id: 2, username: 'Owner' }] : undefined)
    const target = document.createElement('div')
    const im = await connect({ token: 'token', widget: { target } })
    await im.sync()
    await im.sync()
    await nextTick()
    expect(target.querySelector('.gim-message-alert-count')?.textContent).toBe('1')
    im.chat({ ...init.group![0], type: 'group' })
    await flushPromises()
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
    events = [{ id: 3, type: 'group.removed', data: { id: 3 } }] as typeof events
    await im.sync()
    await nextTick()
    expect(target.querySelector('.gim-chat')).toBeNull()
  })

  it('reuses the optimistic message ID for sends and retries, without duplicating the server echo', async () => {
    let payload: ImSendPayload | undefined
    const sent: Record<string, unknown>[] = []
    const fetch = setup((path, options) => {
      if (path === '/messages' && options?.method === 'POST') {
        sent.push(JSON.parse(options.body as string))
        return { ...sent.at(-1), mine: true, fromid: 1 }
      }
      if (path.startsWith('/messages?')) return { messages: [] }
      if (path.startsWith('/socket-events?')) return { events: payload ? [{ id: 1, type: 'message', data: { id: 2, type: 'friend', mid: payload.mid, content: 'Hello', mine: true } }] : [], hasMore: false, cursor: 1 }
    })
    const target = document.createElement('div')
    const im = await connect({ token: 'token', widget: { target, onSendMessage: value => { payload = value } } })
    im.chat({ id: 2, type: 'friend', username: 'Alice' })
    await flushPromises()
    const input = target.querySelector<HTMLTextAreaElement>('textarea')!
    input.value = 'Hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(payload?.mid).toEqual(expect.any(String))
    await im.sendMessage(payload!)
    await im.sync()
    await nextTick()
    expect({ ids: sent.map(message => message.mid), bubbles: target.querySelectorAll('.gim-bubble').length, authenticated: fetch.mock.calls.every(([, options]) => (options?.headers as Record<string, string>).Authorization === 'Bearer token') })
      .toEqual({ ids: [payload!.mid, payload!.mid], bubbles: 1, authenticated: true })
  })

  it('shows a rejected message reason in the chat and reports the failed send to the host', async () => {
    const reason = '发送失败，消息包含敏感词，请修改后重试。'
    setup((path, options) => path === '/messages' && options?.method === 'POST'
      ? new Response(JSON.stringify({ message: reason }), { status: 422 })
      : path.startsWith('/messages?') ? { messages: [] } : undefined)
    const target = document.createElement('div')
    const onError = vi.fn()
    const onSendMessage = vi.fn()
    const im = await connect({ token: 'token', onError, widget: { target, onSendMessage } })
    im.chat({ id: 2, type: 'friend', username: 'Alice' })
    await flushPromises()
    const input = target.querySelector<HTMLTextAreaElement>('textarea')!
    input.value = '禁止词'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect({ status: target.querySelector('.gim-chat-heading small')?.textContent,
      error: onError.mock.calls[0]?.[0], operation: onError.mock.calls[0]?.[1],
      payload: onError.mock.calls[0]?.[2], successes: onSendMessage.mock.calls.length })
      .toEqual({ status: reason, error: expect.objectContaining({ status: 422, message: reason }), operation: 'sendMessage',
        payload: expect.objectContaining({ content: '禁止词', mid: expect.any(String) }), successes: 0 })
    await expect(im.sendMessage({ user: init.user, receiver: { id: 2, type: 'friend' }, content: '禁止词', timestamp: Date.now() }))
      .rejects.toMatchObject({ status: 422, message: reason })
  })

  it('applies quiet state events and sends authenticated read and typing updates', async () => {
    let events: { id: number; type: string; data: Record<string, unknown> }[] = []
    const updates = [
      { id: 1, type: 'presence', data: { id: 2, status: 'online' } },
      { id: 2, type: 'contact.updated', data: { contact: { id: 2, type: 'friend', username: 'Alice', sign: 'Updated' }, notice: { id: 2, event: 'signature', sign: 'Updated' } } },
      { id: 3, type: 'typing', data: { id: 2, type: 'friend', fromid: 2, typing: true, expiresAt: Date.now() + 6000 } },
    ]
    const audio = vi.fn()
    vi.stubGlobal('Audio', audio)
    const fetch = setup((path, options) => path.startsWith('/socket-events?') ? { events, cursor: events.at(-1)?.id ?? 0, hasMore: false }
      : path.startsWith('/messages?') ? { messages: [] } : undefined)
    const target = document.createElement('div')
    const im = await connect({ token: 'token', widget: { target } })
    im.chat({ id: 2, type: 'friend', username: 'Alice' })
    await flushPromises()
    events = updates
    await im.sync()
    await nextTick()
    expect({ notices: target.querySelectorAll('.gim-chat-notice').length, typing: target.querySelector('.gim-chat-heading small')?.textContent,
      alert: target.querySelector('.gim-message-alert'), sounds: audio.mock.calls.length })
      .toEqual({ notices: 2, typing: '对方正在输入…', alert: null, sounds: 0 })
    im.getMessage({ id: 2, type: 'friend', mid: 'outgoing', content: 'Sent', mine: true })
    events = [
      { id: 4, type: 'message.read', data: { id: 2, type: 'friend', mids: ['outgoing'], readerId: 2 } },
      { id: 5, type: 'message', data: { id: 2, type: 'friend', mid: 'incoming', content: 'Hello', fromid: 2 } },
    ]
    await im.sync()
    await flushPromises()
    expect(target.querySelector('.gim-read-state')?.textContent).toBe('已读')
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/messages/read')).map(([, options]) => JSON.parse(options!.body as string)))
      .toEqual([{ id: 2, type: 'friend', mids: ['incoming'] }])
    const input = target.querySelector<HTMLTextAreaElement>('textarea')!
    input.value = 'draft never leaves the browser'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    im.close()
    await flushPromises()
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/conversations/typing')).map(([, options]) => JSON.parse(options!.body as string)))
      .toEqual([{ id: 2, type: 'friend', typing: true }, { id: 2, type: 'friend', typing: false }])
  })

  it('retries failed read receipts on the next socket heartbeat response', async () => {
    vi.useFakeTimers()
    let reads = 0
    setup((path, options) => {
      if (path.startsWith('/messages?')) return { messages: [] }
      if (path === '/messages/read' && options?.method === 'POST') {
        reads++
        return reads === 1 ? new Response(JSON.stringify({ message: 'Temporary failure' }), { status: 503 }) : { ok: true }
      }
    })
    const onError = vi.fn()
    const im = await connect({ token: 'token', onError })
    im.chat({ id: 2, type: 'friend', username: 'Alice' })
    im.getMessage({ id: 2, type: 'friend', mid: 'retry-read', content: 'Hello', fromid: 2 })
    await flushPromises()
    expect(reads).toBe(1)
    Socket.instances[0].receive({ type: 'pong' })
    await flushPromises()
    expect({ reads, errors: onError.mock.calls.map(call => call[1]) }).toEqual({ reads: 2, errors: ['readMessages'] })
  })

  it('reconnects with a fresh ticket, sends heartbeat and cancels timers on destruction', async () => {
    vi.useFakeTimers()
    const fetch = setup()
    const im = await connect()
    const ws = Socket.instances[0]
    ws.open()
    ws.receive({ type: 'connected', user_id: 1 })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(25000)
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: 'ping' })
    ws.close()
    await vi.advanceTimersByTimeAsync(1300)
    await flushPromises()
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/socket-ticket'))).toHaveLength(2)
    im.destroy()
    expect({ state: im.connectionState, timers: vi.getTimerCount() }).toEqual({ state: 'closed', timers: 0 })
  })

  it('never falls back to HTTP events when the socket is unavailable and ignores late tickets after destroy', async () => {
    let resolveTicket!: (value: unknown) => void
    const ticket = new Promise(resolve => { resolveTicket = resolve })
    const fetch = setup(path => path === '/socket-ticket' ? ticket : undefined)
    const im = await connect()
    await expect(im.sync()).rejects.toThrow('Socket is not connected')
    expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/im/events?'))).toBe(false)
    im.destroy()
    resolveTicket({ token: 'late' })
    await flushPromises()
    expect(Socket.instances).toHaveLength(0)
  })

  it('persists edits and rolls back rejected profile changes through the server update API', async () => {
    const onError = vi.fn()
    setup((path, options) => path === '/user' ? new Response(JSON.stringify({ message: 'Rejected' }), { status: 422 }) : undefined)
    const target = document.createElement('div')
    const im = await connect({ token: 'token', onError, widget: { target } })
    im.open()
    await nextTick()
    const input = target.querySelector<HTMLInputElement>('[aria-label="用户昵称"]')!
    input.value = 'Changed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect({ name: input.value, operation: onError.mock.calls[0]?.[1] }).toEqual({ name: 'Me', operation: 'updateUser' })
  })
})

describe('connected blocklist and retained history', () => {
  it('loads historical nonfriends, applies block events and persists management commands', async () => {
    let events: Record<string, unknown>[] = []
    const fetch = setup((path, request) => {
      if (path === '/init') return { init: { ...init, friend: [{ id: 1, groupname: 'Friends', list: [] }], blocked: [{ id: 2, username: 'Alice' }], recent: [{ id: 2, type: 'friend', username: 'Alice' }] }, notices: [], cursor: 0, socketUrl: 'ws://localhost:9501' }
      if (path.startsWith('/messages?')) return { messages: [{ id: 2, type: 'friend', content: 'Retained', fromid: 2 }] }
      if (path.startsWith('/socket-events?')) return { events, hasMore: false }
      if (path === '/blocks/2' && request?.method === 'DELETE') return { ok: true }
    })
    const target = document.createElement('div')
    const im = await connect({ token: 'token', widget: { target } })
    im.open(); await nextTick()
    target.querySelectorAll<HTMLButtonElement>('.gim-tabs button')[2].click(); await nextTick()
    expect(target.querySelector('.gim-contact-scroll')?.textContent).toContain('Alice')
    im.chat({ id: 2, type: 'friend', username: 'Alice' }); await flushPromises()
    expect(target.querySelector('.gim-message.gim-blocked')?.textContent).toContain('Retained')
    await im.unblockFriend(2); await nextTick()
    expect(im.getBlockedUsers()).toEqual([])
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
    expect(fetch.mock.calls.some(([url, options]) => url.endsWith('/blocks/2') && options?.method === 'DELETE')).toBe(true)
    events = [{ id: 1, type: 'user.blocked', data: { contact: { id: 2, username: 'Alice' } } }, { id: 2, type: 'contact.updated', data: { contact: { id: 2, type: 'friend', username: 'Alice' }, groupId: 1 } }]
    await im.sync(); await nextTick()
    expect(im.getBlockedUsers().map(contact => contact.id)).toEqual([2])
    expect(target.querySelector('.gim-message.gim-blocked')).not.toBeNull()
    expect(target.querySelectorAll('.gim-contact-row')).toHaveLength(0)
    events = [{ id: 3, type: 'user.unblocked', data: { id: 2 } }]
    await im.sync(); await nextTick()
    expect(target.querySelector('.gim-message.gim-blocked')).toBeNull()
  })
})

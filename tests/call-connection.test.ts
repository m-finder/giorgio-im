import { afterEach, expect, it, vi } from 'vitest'
import type { ImOptions } from '../src/types'
import { createConnectedIM } from '../src/connection'

const state = vi.hoisted(() => ({ ending: undefined as unknown }))
vi.mock('../src/index', () => ({ createIM: (options: ImOptions) => {
  return { setUser: vi.fn(), setContacts: vi.fn(), destroy: () => { state.ending = options.voiceCall?.sendSignal({ callId: 'room', id: 2, groupId: 2, action: 'leave' }) } }
} }))
afterEach(() => vi.unstubAllGlobals())
it('delivers a group leave signal when the connector is destroyed', async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/init')
    ? { init: { user: { id: 1, username: 'Me' }, friend: [] }, notices: [], cursor: 0, socketUrl: 'ws://localhost:9501' }
    : { token: 'ticket', ok: true }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('WebSocket', class { close() {} })
  const im = await createConnectedIM({ token: async () => 'token' })
  im.destroy()
  await expect(state.ending).resolves.toEqual({ ok: true, token: 'ticket' })
  expect(fetch).toHaveBeenCalledWith('/api/im/calls/signals', expect.objectContaining({ keepalive: true, body: JSON.stringify({ callId: 'room', id: 2, groupId: 2, action: 'leave' }) }))
})

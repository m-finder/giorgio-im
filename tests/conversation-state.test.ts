import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createIM, type ImInit, type ImOptions } from '../src'

const init: ImInit = {
  user: { id: 'me', username: 'Me' },
  friend: [{ id: 'friends', groupname: 'Friends', list: [
    { id: 'alice', username: 'Alice', status: 'offline' }, { id: 'bob', username: 'Bob' },
  ] }],
  group: [{ id: 'team', groupname: 'Team' }],
}
const alice = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const bob = { id: 'bob', type: 'friend' as const, username: 'Bob' }
const instances: ReturnType<typeof createIM>[] = []
function setup(options: Partial<ImOptions> = {}) {
  const target = document.createElement('div')
  const im = createIM({ init, target, ...options })
  instances.push(im)
  return { target, im }
}
beforeEach(() => {
  vi.stubGlobal('Audio', vi.fn(() => ({ play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() })))
})
afterEach(() => {
  for (const im of instances.splice(0)) im.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('quiet conversation state', () => {
  it('renders distinct notices only for open conversations, including background conversations, without alerts', async () => {
    const { target, im } = setup()
    im.getChatNotice({ id: 'alice', event: 'online' })
    im.chat(bob)
    im.chat(alice)
    im.getChatNotice({ id: 'alice', event: 'online', mid: 'status-1' })
    im.getChatNotice({ id: 'alice', event: 'online', mid: 'status-1' })
    im.getChatNotice({ id: 'bob', event: 'offline', mid: 'status-2' })
    await nextTick()
    expect({ notices: target.querySelectorAll('.gim-chat-notice').length,
      text: target.querySelector('.gim-chat-notice')?.textContent,
      messages: target.querySelectorAll('.gim-message').length, alerts: target.querySelectorAll('.gim-message-alert').length,
      sounds: vi.mocked(Audio).mock.calls.length }).toEqual({ notices: 1, text: expect.stringContaining('Alice 已上线'), messages: 0, alerts: 0, sounds: 0 })
    im.chat(bob)
    await nextTick()
    expect(target.querySelector('.gim-chat-notice')?.textContent).toContain('Bob 已下线')
    im.close()
    im.getChatNotice({ id: 'bob', event: 'online' })
    im.chat(bob)
    await nextTick()
    expect(target.querySelectorAll('.gim-chat-notice')).toHaveLength(1)
  })

  it('supports notice switches, language changes and safe signature text', async () => {
    const { target, im } = setup({ chatNotices: { signature: false } })
    im.chat(alice)
    im.updateContact({ ...alice, sign: 'Updated' })
    im.getChatNotice({ id: 'alice', event: 'signature', sign: 'Updated' })
    im.getChatNotice({ id: 'alice', event: 'offline' })
    await nextTick()
    expect(target.querySelectorAll('.gim-chat-notice')).toHaveLength(1)
    im.setLocale('en')
    await nextTick()
    expect(target.querySelector('.gim-chat-notice')?.textContent).toContain('Alice is offline')
    const other = setup({ locale: 'en', chatNotices: { presence: false } })
    other.im.chat(alice)
    other.im.getChatNotice({ id: 'alice', event: 'online' })
    other.im.getChatNotice({ id: 'alice', event: 'signature', sign: '<img src=x onerror=alert(1)>' })
    await nextTick()
    expect({ count: other.target.querySelectorAll('.gim-chat-notice').length, injected: other.target.querySelector('.gim-chat-notice img'), text: other.target.querySelector('.gim-chat-notice')?.textContent })
      .toEqual({ count: 1, injected: null, text: expect.stringContaining('updated their signature: <img') })
  })

  it('only reports received messages read in the active visible conversation', async () => {
    let hidden = false
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
    const onRead = vi.fn()
    const { im } = setup({ onRead })
    im.chat(bob)
    im.chat(alice)
    im.getMessage({ ...bob, content: 'Background', mid: 'b1' })
    im.getMessage({ ...alice, content: 'Visible', mid: 'a1' })
    im.getMessage({ ...alice, content: 'Own', mid: 'own', mine: true })
    im.getChatNotice({ id: 'alice', event: 'online', mid: 'system' })
    await nextTick()
    expect(onRead.mock.calls).toEqual([[{ id: 'alice', type: 'friend', mids: ['a1'] }]])
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    im.getMessage({ ...alice, content: 'Hidden', mid: 'a2' })
    await nextTick()
    expect(onRead).toHaveBeenCalledOnce()
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    im.chat(bob)
    await nextTick()
    expect(onRead.mock.calls.slice(1)).toEqual([
      [{ id: 'alice', type: 'friend', mids: ['a2'] }], [{ id: 'bob', type: 'friend', mids: ['b1'] }],
    ])
  })

  it('applies read receipts before history loads and counts unique group readers', async () => {
    const { target, im } = setup({ locale: 'en', loadHistory: () => [{ ...alice, content: 'Sent', mine: true, mid: 'sent' }] })
    im.setMessageRead({ ...alice, mids: ['sent'], readerId: 'alice' })
    im.chat(alice)
    await flushPromises()
    expect(target.querySelector('.gim-read-state')?.textContent).toBe('Read')
    const group = { id: 'team', type: 'group' as const, groupname: 'Team' }
    im.chat(group)
    await flushPromises()
    im.getMessage({ ...group, content: 'Group message', mine: true, mid: 'group-sent' })
    for (const readerId of ['alice', 'alice', 'me', 'bob']) im.setMessageRead({ ...group, mids: ['group-sent'], readerId })
    await nextTick()
    expect(target.querySelectorAll('.gim-read-state')[1]?.textContent).toBe('Read by 2')
    expect(target.querySelector('.gim-message-alert')).toBeNull()
  })

  it('does not repeat read callbacks for duplicates or messages already read in server history', async () => {
    const onRead = vi.fn()
    const { im } = setup({ onRead, loadHistory: () => [{ ...alice, content: 'Read before', mid: 'old', readBy: ['me'] }] })
    im.chat(alice)
    await flushPromises()
    im.getMessage({ ...alice, content: 'New', mid: 'new' })
    im.getMessage({ ...alice, content: 'New', mid: 'new' })
    await nextTick()
    expect(onRead.mock.calls).toEqual([[{ id: 'alice', type: 'friend', mids: ['new'] }]])
  })

  it('throttles outgoing typing, sends no draft text and stops after inactivity or conversation changes', async () => {
    vi.useFakeTimers()
    const onTyping = vi.fn()
    const { target, im } = setup({ onTyping })
    im.chat(alice)
    await nextTick()
    const input = target.querySelector<HTMLTextAreaElement>('textarea')!
    for (const value of ['a', 'ab']) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
    expect(onTyping.mock.calls).toEqual([[{ id: 'alice', type: 'friend', typing: true }]])
    await vi.advanceTimersByTimeAsync(2100)
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(onTyping).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3100)
    expect(onTyping.mock.calls.at(-1)?.[0]).toEqual({ id: 'alice', type: 'friend', typing: false })
    input.value = 'abcd'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    im.chat(bob)
    expect(onTyping.mock.calls.at(-1)?.[0]).toEqual({ id: 'alice', type: 'friend', typing: false })
  })

  it('expires incoming typing, ignores delayed events and clears typing when a message arrives', async () => {
    vi.useFakeTimers()
    const { target, im } = setup()
    im.chat(alice)
    im.setTyping({ ...alice, fromid: 'alice', typing: true, expiresAt: Date.now() + 6000 })
    await nextTick()
    expect(target.querySelector('.gim-chat-heading small')?.textContent).toBe('对方正在输入…')
    await vi.advanceTimersByTimeAsync(6100)
    expect(target.querySelector('.gim-chat-heading small')?.textContent).toBe('离线')
    im.setTyping({ ...alice, fromid: 'alice', typing: true, expiresAt: Date.now() - 1 })
    await nextTick()
    expect(target.querySelector('.gim-chat-heading small')?.textContent).toBe('离线')
    im.setTyping({ ...alice, fromid: 'alice', typing: true })
    im.getMessage({ ...alice, fromid: 'alice', content: 'Done', mid: 'done' })
    await nextTick()
    expect({ typing: target.querySelector('.gim-chat-heading small')?.textContent, alerts: target.querySelectorAll('.gim-message-alert').length, sounds: vi.mocked(Audio).mock.calls.length })
      .toEqual({ typing: '离线', alerts: 0, sounds: 0 })
  })
})

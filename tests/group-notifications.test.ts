import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM, type ImInit, type ImOptions, type ImWidgetApi } from '../src'

const group = { id: 'team', type: 'group' as const, groupname: 'Team' }
const friend = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const init: ImInit = {
  user: { id: 0, username: 'Me' },
  friend: [{ id: 'friends', groupname: 'Friends', list: [friend] }],
  group: [{ ...group, ownerId: 'owner' }],
}
const wrappers: ReturnType<typeof mount>[] = []
const cleanups: (() => void)[] = []

async function setup(options: Partial<ImOptions> = {}) {
  const wrapper = mount(ImWidget, { props: { init, messageSound: false, ...options } })
  wrappers.push(wrapper)
  const api = wrapper.vm as unknown as ImWidgetApi
  api.open()
  await nextTick()
  await wrapper.get('.gim-tabs button:nth-child(2)').trigger('click')
  return { wrapper, api }
}

function groupRow(wrapper: ReturnType<typeof mount>) {
  return new DOMWrapper(wrapper.get('.gim-group-actions').element.parentElement!)
}

function pointer(target: Element, type: string, x: number, y = 10) {
  const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true })
  Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: 'touch' } })
  ;(type === 'pointerdown' ? target : window).dispatchEvent(event)
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('reveals group notification actions on a horizontal swipe and restores them on right swipe or cancellation', async () => {
  const { wrapper } = await setup()
  const row = groupRow(wrapper)
  const contact = row.get('.gim-contact')
  pointer(contact.element, 'pointerdown', 110)
  pointer(contact.element, 'pointermove', 10)
  await nextTick()
  expect(contact.attributes('style')).toContain('translateX(-72px)')
  pointer(contact.element, 'pointerup', 10)
  await nextTick()
  expect(row.classes()).toContain('gim-actions-open')
  expect(wrapper.find('.gim-chat').exists()).toBe(false)
  pointer(contact.element, 'pointerdown', 10)
  pointer(contact.element, 'pointermove', 110)
  pointer(contact.element, 'pointerup', 110)
  await nextTick()
  expect(row.classes()).not.toContain('gim-actions-open')
  pointer(contact.element, 'pointerdown', 110)
  pointer(contact.element, 'pointermove', 10)
  pointer(contact.element, 'pointercancel', 10)
  await nextTick()
  expect(row.classes()).not.toContain('gim-actions-open')
  expect(row.classes()).not.toContain('gim-swiping')
})

it('preserves vertical touch scrolling and supports keyboard access to the mute action', async () => {
  const { wrapper } = await setup()
  const row = groupRow(wrapper)
  const contact = row.get('.gim-contact')
  pointer(contact.element, 'pointerdown', 110, 10)
  pointer(contact.element, 'pointermove', 95, 100)
  pointer(contact.element, 'pointerup', 95, 100)
  await nextTick()
  expect(row.classes()).not.toContain('gim-actions-open')
  await contact.trigger('keydown', { key: 'F10', shiftKey: true })
  expect(row.classes()).toContain('gim-actions-open')
  await contact.trigger('keydown', { key: 'Escape' })
  expect(row.classes()).not.toContain('gim-actions-open')
})

it('commits mute state and emits the event only after the persistence callback succeeds', async () => {
  let finish!: (accepted: boolean) => void
  const muteGroupNotifications = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const { wrapper } = await setup({ muteGroupNotifications })
  await groupRow(wrapper).get('.gim-contact').trigger('contextmenu')
  await wrapper.get('[aria-label="静音 Team 的消息"]').trigger('click')
  expect(muteGroupNotifications).toHaveBeenCalledWith(expect.objectContaining({ id: 'team', type: 'group' }), true)
  expect(wrapper.find('.gim-group-notifications-muted').exists()).toBe(false)
  expect(wrapper.emitted('groupNotificationsMuted')).toBeUndefined()
  finish(true)
  await flushPromises()
  expect(wrapper.get('.gim-group-notifications-muted').attributes('aria-label')).toBe('消息已静音')
  expect(wrapper.emitted('groupNotificationsMuted')?.[0]).toEqual([expect.objectContaining({ id: 'team' }), true])
  expect(init.group![0]).not.toHaveProperty('notificationsMuted')
  await groupRow(wrapper).get('.gim-contact').trigger('contextmenu')
  await wrapper.get('[aria-label="取消静音 Team 的消息"]').trigger('click')
  finish(true)
  await flushPromises()
  expect(wrapper.find('.gim-group-notifications-muted').exists()).toBe(false)
  expect(wrapper.emitted('groupNotificationsMuted')).toHaveLength(2)
})

it('leaves mute state unchanged after a rejected save and allows retry', async () => {
  const muteGroupNotifications = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const { wrapper } = await setup({ muteGroupNotifications })
  await groupRow(wrapper).get('.gim-contact').trigger('contextmenu')
  await wrapper.get('[aria-label="静音 Team 的消息"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('.gim-group-notifications-muted').exists()).toBe(false)
  expect(wrapper.emitted('groupNotificationsMuted')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('失败')
  await wrapper.get('[aria-label="静音 Team 的消息"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('.gim-group-notifications-muted').exists()).toBe(true)
})

it('shows mute status in group, recent and multiple-conversation lists and clears it through the public API', async () => {
  const { wrapper, api } = await setup({ init: { ...init, group: [{ ...init.group![0], notificationsMuted: true }] } })
  expect(wrapper.findAll('.gim-panel .gim-group-notifications-muted')).toHaveLength(1)
  api.chat(group)
  api.chat(friend)
  await nextTick()
  expect(wrapper.findAll('.gim-conversation-row .gim-group-notifications-muted')).toHaveLength(1)
  expect(wrapper.find('.gim-conversation-name .gim-group-notifications-muted').exists()).toBe(false)
  await wrapper.get('.gim-tabs button:nth-child(3)').trigger('click')
  expect(wrapper.findAll('.gim-panel .gim-group-notifications-muted')).toHaveLength(1)
  api.setGroupNotificationsMuted('team', false)
  await nextTick()
  expect(wrapper.find('.gim-group-notifications-muted').exists()).toBe(false)
})

it('keeps ordinary muted messages unread without a sound or global notification and still alerts for a validated self mention', async () => {
  const play = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('Audio', vi.fn(() => ({ play, pause: vi.fn() })))
  const { wrapper, api } = await setup({ messageSound: '/message.mp3', init: { ...init, group: [{ ...init.group![0], notificationsMuted: true }] } })
  const received = { ...group, fromid: 'alice', username: 'Alice' }
  api.getMessage({ ...received, mid: 'plain', content: 'Ordinary update' })
  api.getMessage({ ...received, mid: 'other', content: '@Other hello', mentions: [{ id: 'other', username: 'Other', start: 0, end: 6 }] })
  api.getMessage({ ...received, mid: 'invalid', content: '@Someone hello', mentions: [{ id: 0, username: 'Me', start: 0, end: 3 }] })
  await nextTick()
  expect(wrapper.get('.gim-panel .gim-unread').text()).toBe('3')
  expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
  expect(play).not.toHaveBeenCalled()
  api.getMessage({ ...received, mid: 'mentioned', content: '@Me hello', mentions: [{ id: '0', username: 'Me', start: 0, end: 3 }] })
  await nextTick()
  expect(wrapper.get('.gim-message-alert-count').text()).toBe('1')
  expect(play).toHaveBeenCalledOnce()
  api.getMessage({ ...received, mid: 'after', content: 'After the mention' })
  api.getMessage({ ...received, mid: 'mentioned', content: '@Me hello', mentions: [{ id: 0, username: 'Me', start: 0, end: 3 }] })
  await nextTick()
  expect(wrapper.get('.gim-message-alert-count').text()).toBe('1')
  expect(wrapper.get('.gim-panel .gim-unread').text()).toBe('5')
  expect(play).toHaveBeenCalledOnce()
})

it('alerts for a self mention in an open background group but stays silent while that group is being viewed', async () => {
  const play = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('Audio', vi.fn(() => ({ play, pause: vi.fn() })))
  const { wrapper, api } = await setup({ messageSound: '/message.mp3', init: { ...init, group: [{ ...init.group![0], notificationsMuted: true }] } })
  api.chat(group)
  api.chat(friend)
  api.getMessage({ ...group, fromid: 'alice', mid: 'mention', content: '@Me hello', mentions: [{ id: 0, username: 'Me', start: 0, end: 3 }] })
  await nextTick()
  expect(wrapper.get('.gim-message-alert-count').text()).toBe('1')
  expect(play).toHaveBeenCalledOnce()
  api.chat(group)
  api.getMessage({ ...group, fromid: 'alice', mid: 'visible', content: '@Me hello', mentions: [{ id: 0, username: 'Me', start: 0, end: 3 }] })
  await nextTick()
  expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
  expect(play).toHaveBeenCalledOnce()
})

it('separates personal notification mute from group speech permissions', async () => {
  const { wrapper, api } = await setup()
  api.chat(group)
  api.setGroupNotificationsMuted('team', true)
  await nextTick()
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.disabled).toBe(false)
  await wrapper.get('textarea').setValue('Still allowed to speak')
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')).toHaveLength(1)
  api.setGroupMute('team', true)
  api.setGroupNotificationsMuted('team', false)
  await nextTick()
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.disabled).toBe(true)
})

it('restores personal mute from an encrypted backup and accepts a subsequent authoritative server preference', async () => {
  const target = document.createElement('div')
  const im = createIM({ init, target, enableLocalStorage: true, messageSound: false })
  cleanups.push(im.destroy)
  im.setGroupNotificationsMuted('team', true)
  await nextTick()
  im.destroy()
  cleanups.pop()
  const restored = createIM({ init, target, enableLocalStorage: true, messageSound: false })
  cleanups.push(restored.destroy)
  restored.open()
  await nextTick()
  ;(target.querySelector('.gim-tabs button:nth-child(2)') as HTMLButtonElement).click()
  await nextTick()
  expect(target.querySelector('.gim-panel .gim-group-notifications-muted')).not.toBeNull()
  restored.setContacts({ friend: init.friend, group: [{ ...init.group![0], notificationsMuted: false }] })
  await nextTick()
  expect(target.querySelector('.gim-group-notifications-muted')).toBeNull()
})

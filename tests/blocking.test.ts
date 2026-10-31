import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM, type ImInit, type ImWidgetApi } from '../src'

const init: ImInit = { user: { id: 1, username: 'Me' }, friend: [{ id: 1, groupname: 'Friends', list: [{ id: 2, username: 'Alice' }] }] }
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); localStorage.clear() })
async function swipe(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('.gim-contact-row > .gim-contact').trigger('pointerdown', { button: 0, clientX: 110, clientY: 10 })
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 14, cancelable: true }))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 14 }))
  await nextTick()
}
describe('friend deletion and blocklist', () => {
  it('reveals actions on left swipe and preserves recent history after confirmed deletion', async () => {
    const deleteFriend = vi.fn().mockResolvedValue(true)
    const wrapper = mount(ImWidget, { props: { init, deleteFriend } })
    cleanups.push(() => wrapper.unmount())
    const im = wrapper.vm as unknown as ImWidgetApi
    im.open(); im.chat({ id: 2, type: 'friend', username: 'Alice' }); im.getMessage({ id: 2, type: 'friend', content: 'Keep me', fromid: 2 })
    await nextTick()
    await swipe(wrapper)
    expect(wrapper.get('.gim-contact-row').classes()).toContain('gim-actions-open')
    await wrapper.get('[aria-label="删除好友 Alice"]').trigger('click')
    await wrapper.get('.gim-friend-confirm').trigger('submit')
    await flushPromises()
    expect(deleteFriend).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(wrapper.find('.gim-contact-row').exists()).toBe(false)
    expect(wrapper.get('.gim-messages').text()).toContain('Keep me')
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    await wrapper.findAll('.gim-tabs button')[2].trigger('click')
    expect(wrapper.get('.gim-contact-scroll').text()).toContain('Alice')
  })

  it('waits for block persistence, shows failure, then greys history and supports unblocking in settings', async () => {
    const blockFriend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const unblockFriend = vi.fn().mockResolvedValue(true)
    const wrapper = mount(ImWidget, { props: { init, blockFriend, unblockFriend } })
    cleanups.push(() => wrapper.unmount())
    const im = wrapper.vm as unknown as ImWidgetApi
    im.open(); im.chat({ id: 2, type: 'friend', username: 'Alice' }); im.getMessage({ id: 2, type: 'friend', content: 'Old', fromid: 2 })
    await nextTick(); await swipe(wrapper)
    await wrapper.get('[aria-label="拉黑 Alice"]').trigger('click')
    await wrapper.get('.gim-friend-confirm').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('失败')
    expect(wrapper.find('.gim-contact-row').exists()).toBe(true)
    await wrapper.get('.gim-friend-confirm').trigger('submit'); await flushPromises()
    expect(wrapper.get('.gim-message').classes()).toContain('gim-blocked')
    expect(wrapper.get('.gim-message-meta').text()).toContain('已被拉黑')
    im.getMessage({ id: 2, type: 'friend', content: 'Do not deliver', fromid: 2 }); await nextTick()
    expect(wrapper.text()).not.toContain('Do not deliver')
    await wrapper.get('[aria-label="设置"]').trigger('click')
    await wrapper.get('[aria-label="黑名单"]').trigger('click')
    await wrapper.get('[aria-label="解除拉黑 Alice"]').trigger('click'); await flushPromises()
    expect(unblockFriend).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(wrapper.find('.gim-message.gim-blocked').exists()).toBe(false)
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.gim-contact-row').exists()).toBe(false)
  })

  it('exposes management APIs, persists blocks and marks shared group messages by sender', async () => {
    const target = document.createElement('div')
    const im = createIM({ init, target, enableLocalStorage: true })
    im.open(); im.chat({ id: 'room', type: 'group', groupname: 'Room' }); im.getMessage({ id: 'room', type: 'group', fromid: 2, content: 'Shared history' })
    await im.blockFriend(2); await nextTick()
    expect(im.getBlockedUsers().map(user => user.id)).toEqual([2])
    expect(target.querySelector('.gim-message.gim-blocked')).not.toBeNull()
    im.destroy()
    const restored = createIM({ init, target, enableLocalStorage: true })
    cleanups.push(restored.destroy)
    await nextTick()
    expect(restored.getBlockedUsers().map(user => user.id)).toEqual([2])
    expect(target.querySelector('.gim-message.gim-blocked')).not.toBeNull()
    restored.setBlockedUsers([]); await nextTick()
    expect(target.querySelector('.gim-message.gim-blocked')).toBeNull()
  })
})

it('supports touch swipes, closes actions on right swipe and restores the row after cancellation', async () => {
  const wrapper = mount(ImWidget, { props: { init } })
  cleanups.push(() => wrapper.unmount())
  ;(wrapper.vm as unknown as ImWidgetApi).open()
  await nextTick()
  const row = wrapper.get('.gim-contact-row')
  const contact = row.get('.gim-contact')
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 10, bubbles: true, cancelable: true })
    Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: 'touch' } })
    ;(type === 'pointerdown' ? contact.element : window).dispatchEvent(event)
  }
  pointer('pointerdown', 110); pointer('pointermove', 10); await nextTick()
  expect(contact.attributes('style')).toContain('translateX(-100px)')
  pointer('pointerup', 10); await nextTick()
  expect(row.classes()).toContain('gim-actions-open')
  expect(wrapper.find('.gim-chat').exists()).toBe(false)
  pointer('pointerdown', 10); pointer('pointermove', 110); pointer('pointerup', 110); await nextTick()
  expect(row.classes()).not.toContain('gim-actions-open')
  pointer('pointerdown', 110); pointer('pointermove', 10); pointer('pointercancel', 10); await nextTick()
  expect(row.classes()).not.toContain('gim-actions-open')
  expect(row.classes()).not.toContain('gim-swiping')
})

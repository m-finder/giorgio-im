import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM } from '../src'
import type { ImInit, ImWidgetApi } from '../src/types'

const init: ImInit = {
  user: { id: 'me', username: '我' },
  friend: [{ id: 1, groupname: '好友', list: [{ id: 'alice', username: 'Alice', status: 'online' }] }],
  group: [{ id: 'team', groupname: '团队', members: 3 }],
}

describe('ImWidget', () => {
  it('forwards profile edits through createIM callbacks and sends the edited profile', async () => {
    const target = document.createElement('div')
    const onSign = vi.fn()
    const onUsername = vi.fn()
    const onSendMessage = vi.fn()
    const im = createIM({ init, target, onSign, onUsername, onSendMessage })
    im.open()
    await nextTick()
    const name = target.querySelector<HTMLInputElement>('[aria-label="用户昵称"]')!
    name.value = '新的昵称'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    name.dispatchEvent(new Event('blur'))
    const sign = target.querySelector<HTMLInputElement>('[aria-label="个性签名"]')!
    sign.value = '新的签名'
    sign.dispatchEvent(new Event('input', { bubbles: true }))
    sign.dispatchEvent(new Event('blur'))
    sign.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(onUsername).toHaveBeenCalledWith('新的昵称')
    expect(onSign).toHaveBeenCalledWith('新的签名')
    expect(onSign).toHaveBeenCalledTimes(1)
    im.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    const composer = target.querySelector<HTMLTextAreaElement>('textarea')!
    composer.value = '你好'
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ username: '新的昵称', sign: '新的签名' }) }))
    expect(target.querySelector('.gim-message-meta')?.textContent).toContain('新的昵称')
    expect(init.user).toEqual({ id: 'me', username: '我' })
    im.destroy()
  })

  it('rejects empty nicknames and emits a trimmed nickname only when it changes', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    const name = wrapper.get<HTMLInputElement>('[aria-label="用户昵称"]')
    await name.setValue('   ')
    await name.trigger('blur')
    expect(name.element.value).toBe('我')
    expect(wrapper.emitted('username')).toBeUndefined()
    await name.setValue('  新昵称  ')
    await name.trigger('blur')
    await name.trigger('blur')
    expect(name.element.value).toBe('新昵称')
    expect(wrapper.emitted('username')).toEqual([['新昵称']])
    wrapper.unmount()
  })

  it('accepts host profile updates without emitting edit callbacks', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    await wrapper.setProps({ init: { ...init, user: { ...init.user, username: '服务端昵称', sign: '服务端签名' } } })
    expect(wrapper.get<HTMLInputElement>('[aria-label="用户昵称"]').element.value).toBe('服务端昵称')
    expect(wrapper.get<HTMLInputElement>('[aria-label="个性签名"]').element.value).toBe('服务端签名')
    expect(wrapper.emitted('username')).toBeUndefined()
    expect(wrapper.emitted('sign')).toBeUndefined()
    wrapper.unmount()
  })

  it('opens a contact, sends text, and keeps line breaks in the composer', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    await wrapper.get('[aria-label="打开聊天"]').trigger('click')
    await wrapper.get('.gim-contact').trigger('click')
    const input = wrapper.get<HTMLTextAreaElement>('[aria-label="输入消息"]')
    await input.setValue('你好')
    await input.trigger('keydown', { key: 'Enter', shiftKey: false })
    expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ content: '你好', receiver: { id: 'alice', type: 'friend' } })
    expect(wrapper.find('.gim-bubble').text()).toBe('你好')
    expect(input.element.value).toBe('')
    wrapper.unmount()
  })

  it('counts incoming messages and clears unread when the conversation opens', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage({ id: 'alice', type: 'friend', username: 'Alice', content: '在吗？' })
    await nextTick()
    expect(wrapper.get('.gim-launcher-badge').text()).toBe('1')
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    expect(wrapper.find('.gim-launcher-badge').exists()).toBe(false)
    expect(wrapper.get('.gim-bubble').text()).toBe('在吗？')
    wrapper.unmount()
  })

  it('loads history once and renders received HTML as text', async () => {
    const loadHistory = vi.fn(() => [{ id: 'alice', type: 'friend' as const, content: '<img src=x onerror=alert(1)>', mid: 'old' }])
    const wrapper = mount(ImWidget, { props: { init, loadHistory } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    await nextTick()
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    expect(loadHistory).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.gim-bubble img').exists()).toBe(false)
    expect(wrapper.get('.gim-bubble').text()).toBe('<img src=x onerror=alert(1)>')
    wrapper.unmount()
  })

  it('mounts and removes the drop-in widget', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const im = createIM({ init, target })
    im.open()
    await nextTick()
    expect(target.querySelector('[aria-label="聊天联系人"]')).not.toBeNull()
    expect(document.getElementById('giorgio-im-style')).not.toBeNull()
    im.destroy()
    expect(target.childElementCount).toBe(0)
    target.remove()
  })

  it('keeps the contact and chat windows separate and moves each by its header', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.open()
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    expect(wrapper.find('.gim-panel').element.parentElement).toBe(wrapper.find('.gim-chat').element.parentElement)
    await wrapper.get('.gim-profile').trigger('pointerdown', { button: 0, clientX: 100, clientY: 100 })
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 130 }))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(wrapper.get('.gim-panel').attributes('style')).toContain('left:')
    await wrapper.get('.gim-chat-header').trigger('pointerdown', { button: 0, clientX: 100, clientY: 100 })
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 130 }))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(wrapper.get('.gim-chat').attributes('style')).toContain('left:')
    wrapper.unmount()
  })

  it('shows multiple conversations in a side list', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    api.chat({ id: 'team', type: 'group', groupname: '团队' })
    await nextTick()
    expect(wrapper.findAll('.gim-conversation-row')).toHaveLength(2)
    expect(wrapper.find('.gim-chat-tabs').exists()).toBe(false)
    wrapper.unmount()
  })

  it('finds and adds a friend, and accepts a request from the inbox', async () => {
    const findContacts = vi.fn(() => [{ id: 'bob', username: 'Bob' }])
    const requestFriend = vi.fn(() => true)
    const wrapper = mount(ImWidget, { props: {
      init, findContacts, requestFriend,
      notices: [{ id: 'request', type: 'friend-request', title: '申请', content: 'Carol 想添加你', contact: { id: 'carol', username: 'Carol' } }],
    } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    await wrapper.get('[aria-label="添加好友"]').trigger('click')
    await nextTick()
    await wrapper.get('.gim-find-row button').trigger('click')
    await nextTick()
    expect(requestFriend).toHaveBeenCalledWith({ id: 'bob', username: 'Bob' })
    expect(wrapper.emitted('friendAdded')).toHaveLength(1)
    await wrapper.get('[aria-label="关闭弹窗"]').trigger('click')
    await wrapper.get('[aria-label="消息盒子"]').trigger('click')
    await wrapper.get('.gim-notice-actions button').trigger('click')
    await wrapper.get('.gim-management-form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('noticeAction')?.[0]?.[1]).toBe('accept')
    wrapper.unmount()
  })

  it('opens the emoji toolbar and inserts a selected emoji', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    await wrapper.get('[aria-label="表情"]').trigger('click')
    await wrapper.get('.gim-emoji-picker button').trigger('click')
    expect(wrapper.get<HTMLTextAreaElement>('[aria-label="输入消息"]').element.value).toBe('😀')
    wrapper.unmount()
  })

  it('keeps a sent friend request pending until it is accepted', async () => {
    const wrapper = mount(ImWidget, { props: {
      init,
      findContacts: () => [{ id: 'bob', username: 'Bob' }],
      requestFriend: () => undefined,
    } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    await wrapper.get('[aria-label="添加好友"]').trigger('click')
    await nextTick()
    await wrapper.get('.gim-find-row button').trigger('click')
    await nextTick()
    expect(wrapper.get('.gim-find-row button').text()).toBe('已申请')
    expect(wrapper.emitted('friendAdded')).toBeUndefined()
    wrapper.unmount()
  })

  it('uploads an image through the host callback and emits its attachment', async () => {
    const uploadAttachment = vi.fn(() => 'https://example.test/photo.png')
    const wrapper = mount(ImWidget, { props: { init, uploadAttachment } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    const input = wrapper.get<HTMLInputElement>('input[type="file"][accept="image/*"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['image'], 'photo.png', { type: 'image/png' })] })
    await input.trigger('change')
    await nextTick()
    expect(uploadAttachment).toHaveBeenCalledOnce()
    expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ attachment: { kind: 'image', url: 'https://example.test/photo.png', name: 'photo.png' } })
    wrapper.unmount()
  })

  it('uses image avatars for users and opens search only from the find button', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    expect(wrapper.get('.gim-own-avatar img').attributes('src')).toContain('default-avatar.png')
    expect(wrapper.find('.gim-search-wrap').exists()).toBe(false)
    await wrapper.get('[aria-label="查找"]').trigger('click')
    await wrapper.get('[aria-label="查找当前列表"]').setValue('Alice')
    expect(wrapper.find('.gim-modal').exists()).toBe(false)
    expect(wrapper.findAll('.gim-contact')).toHaveLength(1)
    wrapper.unmount()
  })

  it('collapses and expands friend groups', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    const heading = wrapper.get('.gim-contact-group h3 button')
    expect(heading.attributes('aria-expanded')).toBe('true')
    await heading.trigger('click')
    expect(heading.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.gim-contact').exists()).toBe(false)
    await heading.trigger('click')
    expect(wrapper.find('.gim-contact').exists()).toBe(true)
    wrapper.unmount()
  })

  it('places chat history last in the toolbar and renders vector icons', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    expect(wrapper.get('.gim-chat-tools > button:last-of-type').attributes('aria-label')).toBe('聊天记录')
    expect(wrapper.findAll('.gim-chat-tools > button svg')).toHaveLength(7)
    wrapper.unmount()
  })

  it('shows group members and opens a private chat with a selected member', async () => {
    const loadGroupMembers = vi.fn().mockResolvedValue([init.user, init.friend![0].list[0]])
    const wrapper = mount(ImWidget, { props: { init, loadGroupMembers } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    expect(wrapper.find('[aria-label="查看群成员"]').exists()).toBe(false)
    api.chat({ id: 'team', type: 'group', groupname: '团队', members: 3 })
    await nextTick()
    await wrapper.get('.gim-chat-header [aria-label="查看群成员"]').trigger('click')
    await flushPromises()
    expect(loadGroupMembers).toHaveBeenCalledWith(expect.objectContaining({ id: 'team', type: 'group' }))
    expect(wrapper.findAll('.gim-modal .gim-contact')).toHaveLength(2)
    expect(wrapper.get('.gim-modal .gim-contact:disabled').text()).toContain('我')
    await wrapper.get('.gim-modal .gim-contact:not(:disabled)').trigger('click')
    expect(wrapper.get('.gim-chat-heading strong').text()).toBe('Alice')
    expect(wrapper.find('.gim-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retries a failed group member request and shows an empty result', async () => {
    const loadGroupMembers = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const wrapper = mount(ImWidget, { props: { init, loadGroupMembers } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat({ id: 'team', type: 'group', groupname: '团队' })
    await nextTick()
    await wrapper.get('[aria-label="查看群成员"]').trigger('click')
    await flushPromises()
    await wrapper.get('.gim-modal .gim-history-error').trigger('click')
    await flushPromises()
    expect(loadGroupMembers).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.gim-modal').text()).toContain('暂无群成员')
    wrapper.unmount()
  })
})

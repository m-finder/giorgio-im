import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM } from '../src'
import type { ImInit, ImWidgetApi } from '../src/types'

const init: ImInit = {
  user: { id: 0, username: '原昵称', sign: '原签名', avatar: 'https://example.com/me.png' },
  friend: [{ id: 'friends', groupname: '好友', list: [{ id: 'alice', username: 'Alice' }] }],
}
const alice = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const storageName = 'giorgio-im-backup:0'

beforeEach(() => localStorage.clear())
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('encrypted local backup', () => {
  it('keeps removed friends and groups removed after a refresh, including numeric ID zero', async () => {
    const data: ImInit = { ...init,
      friend: [{ id: 'friends', groupname: '好友', list: [{ id: 0, username: '零号好友' }] }],
      group: [{ id: 0, groupname: '零号群聊' }],
    }
    const wrapper = mount(ImWidget, { props: { init: data, enableLocalStorage: true } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.open()
    api.removeFriend(0)
    api.removeGroup(0)
    wrapper.unmount()
    const restored = mount(ImWidget, { props: { init: data, enableLocalStorage: true } })
    const restoredApi = restored.vm as unknown as ImWidgetApi
    restoredApi.getMessage({ id: 0, type: 'friend', content: '被删除好友的消息' })
    restoredApi.getMessage({ id: 0, type: 'group', content: '已退出群的消息' })
    await nextTick()
    expect(restored.findAll('.gim-panel .gim-contact')).toHaveLength(0)
    await restored.get('.gim-tabs button:nth-child(2)').trigger('click')
    expect(restored.findAll('.gim-panel .gim-contact')).toHaveLength(0)
    await restored.get('.gim-tabs button:nth-child(3)').trigger('click')
    expect(restored.findAll('.gim-panel .gim-contact')).toHaveLength(0)
    restored.unmount()
  })

  it('does not read or write backups unless enabled', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(alice)
    api.getMessage({ ...alice, content: '不保存的消息' })
    await nextTick()
    window.dispatchEvent(new Event('pagehide'))
    wrapper.unmount()
    expect(localStorage.getItem(storageName)).toBeNull()
    expect(getItem.mock.calls.filter(([key]) => key === storageName)).toHaveLength(1)
  })

  it('restores the edited profile, conversations, messages and unread counts without callbacks', async () => {
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.open()
    await nextTick()
    await wrapper.get('[aria-label="用户昵称"]').setValue('新的昵称')
    await wrapper.get('[aria-label="用户昵称"]').trigger('blur')
    await wrapper.get('[aria-label="个性签名"]').setValue('新的签名 🔐')
    await wrapper.get('[aria-label="个性签名"]').trigger('blur')
    api.chat(alice)
    await nextTick()
    await wrapper.get('textarea').setValue('保存我的消息')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    api.getMessage({ ...alice, content: '保存回复', mid: 'reply' })
    api.getMessage({ id: 'other', type: 'group', groupname: '其他会话', content: '未读消息' })
    window.dispatchEvent(new Event('pagehide'))
    const encrypted = localStorage.getItem(storageName)!
    expect(encrypted).toBeTruthy()
    expect(encrypted).not.toContain('保存')
    expect(encrypted).not.toContain('新的昵称')
    expect(encrypted).not.toContain('example.com')
    expect(encrypted).not.toContain('giorgio-im')
    wrapper.unmount()
    const restored = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    await nextTick()
    expect(restored.get<HTMLInputElement>('[aria-label="用户昵称"]').element.value).toBe('新的昵称')
    expect(restored.get<HTMLInputElement>('[aria-label="个性签名"]').element.value).toBe('新的签名 🔐')
    expect(restored.get('.gim-chat-heading strong').text()).toBe('Alice')
    expect(restored.findAll('.gim-bubble').map(item => item.text())).toEqual(['保存我的消息', '保存回复'])
    expect(restored.emitted('username')).toBeUndefined()
    expect(restored.emitted('sign')).toBeUndefined()
    expect(restored.emitted('sendMessage')).toBeUndefined()
    ;(restored.vm as unknown as ImWidgetApi).close()
    await nextTick()
    expect(restored.get('.gim-launcher-badge').text()).toBe('1')
    restored.unmount()
    expect(init.user.username).toBe('原昵称')
  })

  it('uses the configured key, preserves unreadable backups and isolates accounts', async () => {
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true, encryptionKey: 'custom-secret' } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(alice)
    api.getMessage({ ...alice, content: '密钥保护的消息' })
    wrapper.unmount()
    const backup = localStorage.getItem(storageName)
    const onStorageError = vi.fn()
    const target = document.createElement('div')
    const wrongKey = createIM({ init, target, enableLocalStorage: true, onStorageError })
    wrongKey.chat(alice)
    await nextTick()
    expect(target.textContent).not.toContain('密钥保护的消息')
    expect(onStorageError).toHaveBeenCalledWith(expect.any(Error))
    wrongKey.destroy()
    expect(localStorage.getItem(storageName)).toBe(backup)
    const other = mount(ImWidget, { props: { init: { user: { id: 'other-user', username: '其他用户' } }, enableLocalStorage: true, encryptionKey: 'custom-secret' } })
    ;(other.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    expect(other.text()).not.toContain('密钥保护的消息')
    other.unmount()
    const restored = mount(ImWidget, { props: { init, enableLocalStorage: true, encryptionKey: 'custom-secret' } })
    await nextTick()
    expect(restored.get('.gim-bubble').text()).toBe('密钥保护的消息')
    restored.unmount()
  })

  it('preserves partial AI replies as interrupted and does not duplicate cached history', async () => {
    const loadHistory = vi.fn(receiver => receiver.type === 'friend' ? [{ ...alice, content: '历史消息', mid: 'history' }] : [])
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true, loadHistory } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(alice)
    await nextTick()
    await nextTick()
    api.chat({ id: 'bot', type: 'ai', username: 'AI 助手' })
    await nextTick()
    await wrapper.get('textarea').setValue('问题')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    api.getMessage({ id: 'bot', type: 'ai', content: '部分回复', finished: false, mid: 'partial' })
    wrapper.unmount()
    loadHistory.mockClear()
    const restored = mount(ImWidget, { props: { init, enableLocalStorage: true, loadHistory } })
    await nextTick()
    expect(restored.text()).toContain('部分回复')
    expect(restored.get('[role="alert"]').text()).toContain('中断')
    expect(restored.get('textarea').attributes('disabled')).toBeUndefined()
    ;(restored.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    expect(restored.findAll('.gim-bubble')).toHaveLength(1)
    expect(loadHistory).not.toHaveBeenCalled()
    restored.unmount()
  })

  it('reports tampering and quota errors without breaking messaging', async () => {
    localStorage.setItem(storageName, '{"version":1,"data":"invalid"}')
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    expect(wrapper.emitted('storageError')?.[0]?.[0]).toBeInstanceOf(Error)
    ;(wrapper.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    expect(wrapper.find('textarea').exists()).toBe(true)
    wrapper.unmount()
    localStorage.clear()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    const full = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    ;(full.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    await full.get('textarea').setValue('仍可发送')
    await full.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(full.emitted('sendMessage')).toHaveLength(1)
    expect(full.emitted('storageError')?.[0]?.[0]).toBeInstanceOf(Error)
    full.unmount()
  })

  it('authenticates ciphertext and uses a new IV for subsequent changes', async () => {
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    const first = JSON.parse(localStorage.getItem(storageName)!)
    ;(wrapper.vm as unknown as ImWidgetApi).getMessage({ ...alice, content: '另一条消息' })
    await nextTick()
    const second = JSON.parse(localStorage.getItem(storageName)!)
    expect(second.iv).not.toBe(first.iv)
    expect(second.data).not.toBe(first.data)
    wrapper.unmount()
    second.data = `${second.data[0] === 'A' ? 'B' : 'A'}${second.data.slice(1)}`
    localStorage.setItem(storageName, JSON.stringify(second))
    const tampered = localStorage.getItem(storageName)
    const restored = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    expect(restored.emitted('storageError')?.[0]?.[0]).toBeInstanceOf(Error)
    restored.unmount()
    expect(localStorage.getItem(storageName)).toBe(tampered)
  })

  it('stops saving when the configuration switch is turned off', async () => {
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: false } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(alice)
    api.getMessage({ ...alice, content: '开启前的消息' })
    await wrapper.setProps({ enableLocalStorage: true })
    const stored = localStorage.getItem(storageName)
    expect(stored).toBeTruthy()
    await wrapper.setProps({ enableLocalStorage: false })
    api.getMessage({ ...alice, content: '关闭后的消息' })
    await nextTick()
    window.dispatchEvent(new Event('pagehide'))
    wrapper.unmount()
    expect(localStorage.getItem(storageName)).toBe(stored)
  })
})

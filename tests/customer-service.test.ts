import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createIM, ImWidget, type ImWidgetApi } from '../src'

const init = { user: { id: 'me', username: '访客' } }
const customerService = { id: 'support', type: 'friend' as const, username: '在线客服' }

describe('customer service mode', () => {
  it('opens one chat from the launcher and minimises on both close and collapse', async () => {
    const wrapper = mount(ImWidget, { props: { init, customerService } })
    await wrapper.get('[aria-label="打开客服聊天"]').trigger('click')
    expect(wrapper.find('.gim-panel').exists()).toBe(false)
    expect(wrapper.get('.gim-chat-heading strong').text()).toBe('在线客服')
    await wrapper.get('textarea').setValue('保留草稿')
    await wrapper.get('[aria-label="关闭当前会话"]').trigger('click')
    expect(wrapper.find('.gim-chat').exists()).toBe(false)
    expect(wrapper.find('[aria-label="打开客服聊天"]').exists()).toBe(true)
    await wrapper.get('[aria-label="打开客服聊天"]').trigger('click')
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('保留草稿')
    await wrapper.get('[aria-label="收起会话"]').trigger('click')
    expect(wrapper.find('[aria-label="打开客服聊天"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps only the configured conversation and shows its unread badge while minimised', async () => {
    const target = document.createElement('div')
    const im = createIM({ init, target, customerService })
    im.getMessage({ ...customerService, content: '您好，需要帮助吗？' })
    im.getMessage({ id: 'other', type: 'friend', content: '其他消息' })
    await nextTick()
    expect(target.querySelector('.gim-launcher-badge')?.textContent).toBe('1')
    im.open()
    im.chat({ id: 'other', type: 'friend', username: '其他人' })
    await nextTick()
    expect(target.querySelector('.gim-chat-heading strong')?.textContent).toBe('在线客服')
    expect(target.querySelector('.gim-panel')).toBeNull()
    expect(target.querySelector('.gim-conversation-list')).toBeNull()
    expect(target.textContent).not.toContain('其他消息')
    im.close()
    await nextTick()
    expect(target.querySelector('.gim-launcher')).not.toBeNull()
    im.destroy()
  })

  it('restores service chats from an isolated encrypted backup without overwriting standard-mode data', async () => {
    localStorage.clear()
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(customerService)
    api.getMessage({ ...customerService, content: '保留的客服消息' })
    api.chat({ id: 'other', type: 'friend', username: '其他人' })
    wrapper.unmount()
    const standardBackup = localStorage.getItem('giorgio-im-backup:me')
    const service = mount(ImWidget, { props: { init, customerService, enableLocalStorage: true } })
    const serviceApi = service.vm as unknown as ImWidgetApi
    serviceApi.open()
    serviceApi.getMessage({ ...customerService, content: '单独保存的客服消息' })
    serviceApi.close()
    service.unmount()
    const restored = mount(ImWidget, { props: { init, customerService, enableLocalStorage: true } })
    expect(restored.find('.gim-chat').exists()).toBe(false)
    ;(restored.vm as unknown as ImWidgetApi).open()
    await nextTick()
    expect(restored.get('.gim-bubble').text()).toBe('单独保存的客服消息')
    expect(restored.find('.gim-conversation-list').exists()).toBe(false)
    expect(restored.find('.gim-panel').exists()).toBe(false)
    restored.unmount()
    expect(localStorage.getItem('giorgio-im-backup:me')).toBe(standardBackup)
    localStorage.clear()
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createIM, ImWidget, type ImWidgetApi } from '../src'

const init = { user: { id: 'window-reset', username: '我' } }
const friend = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const assistant = { id: 'ai', type: 'ai' as const, username: 'AI' }

afterEach(() => localStorage.clear())

describe('window reset', () => {
  it('resets dragged positions, maximisation and open windows without removing conversations', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const im = wrapper.vm as unknown as ImWidgetApi
    im.open()
    im.chat(friend)
    im.getMessage({ ...friend, content: '保留消息' })
    await nextTick()
    for (const header of ['.gim-profile', '.gim-chat-header']) {
      await wrapper.get(header).trigger('pointerdown', { button: 0, clientX: 100, clientY: 100 })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 140 }))
      window.dispatchEvent(new Event('pointerup'))
    }
    im.chat({ ...assistant, maximized: true })
    await nextTick()
    expect(wrapper.get('.gim-chat').classes()).toContain('gim-chat-maximized')
    expect(wrapper.get('.gim-panel').attributes('style')).toContain('left:')
    im.resetWindows()
    await nextTick()
    expect(wrapper.find('.gim-window').exists()).toBe(false)
    im.chat(assistant)
    im.open()
    await nextTick()
    expect(wrapper.get('.gim-chat').classes()).not.toContain('gim-chat-maximized')
    expect(wrapper.get('.gim-chat').attributes('style')).not.toContain('left:')
    expect(wrapper.get('.gim-panel').attributes('style')).not.toContain('left:')
    expect(wrapper.find('.gim-conversation-list').exists()).toBe(false)
    im.chat(friend)
    await nextTick()
    expect(wrapper.get('.gim-bubble').text()).toBe('保留消息')
    wrapper.unmount()
  })

  it('exposes resetWindows through createIM and persists the reset while retaining backed-up data', async () => {
    const target = document.createElement('div')
    const im = createIM({ init, target, enableLocalStorage: true })
    im.open()
    im.chat({ ...assistant, maximized: true })
    im.chat(friend)
    im.getMessage({ ...friend, content: '刷新后仍在' })
    im.resetWindows()
    im.destroy()
    const restored = createIM({ init, target, enableLocalStorage: true })
    await nextTick()
    expect(target.querySelector('.gim-window')).toBeNull()
    restored.chat(assistant)
    await nextTick()
    expect(target.querySelector('.gim-chat-maximized')).toBeNull()
    expect(target.querySelector('.gim-conversation-list')).toBeNull()
    restored.chat(friend)
    await nextTick()
    expect(target.querySelector('.gim-bubble')?.textContent).toBe('刷新后仍在')
    restored.destroy()
  })
})

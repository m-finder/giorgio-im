import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM } from '../src'
import type { ImInit, ImWidgetApi } from '../src/types'

const init: ImInit = { user: { id: 'me', username: '我' } }
const assistant = { id: 'assistant', type: 'ai' as const, username: 'AI 助手' }

afterEach(() => vi.useRealTimers())

describe('AI conversations', () => {
  it('opens configured AI contacts and keeps the assistant identity when sending', async () => {
    const wrapper = mount(ImWidget, { props: { init: {
      user: { ...init.user, avatar: 'https://example.com/me.png' },
      friend: [{ id: 'bots', groupname: 'AI 助手', list: [assistant] }],
    } } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    await wrapper.get('.gim-contact').trigger('click')
    await wrapper.get('textarea').setValue('你好')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ receiver: assistant })
    expect(wrapper.get('.gim-chat-header img').attributes('src')).not.toBe('https://example.com/me.png')
    expect(wrapper.get('.gim-chat-heading strong').text()).toBe('AI 助手')
    wrapper.unmount()
  })

  it('streams cumulative content into a single reply and unlocks sending only when finished', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(assistant)
    await nextTick()
    await wrapper.get('textarea').setValue('你好')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ receiver: assistant, content: '你好' })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('正在思考')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('sendMessage')).toHaveLength(1)
    api.getMessage({ ...assistant, mid: 'reply-1', content: '你好，', finished: false })
    await nextTick()
    api.getMessage({ ...assistant, mid: 'reply-1', content: '你好，**世界**！', finished: false })
    await nextTick()
    expect(wrapper.findAll('.gim-message')).toHaveLength(2)
    expect(wrapper.get('.gim-markdown strong').text()).toBe('世界')
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    api.getMessage({ ...assistant, mid: 'reply-1', content: '你好，**世界**！', finished: true })
    api.getMessage({ ...assistant, mid: 'reply-1', content: '重复回复' })
    await nextTick()
    expect(wrapper.findAll('.gim-message')).toHaveLength(2)
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.gim-ai-progress').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps AI sessions independent and counts only a completed background reply as unread', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(assistant)
    await nextTick()
    await wrapper.get('textarea').setValue('第一个问题')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    api.chat({ ...assistant, id: 'second', username: '另一个助手' })
    await nextTick()
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    api.getMessage({ ...assistant, content: '后台回复', finished: false })
    await nextTick()
    expect(wrapper.find('.gim-launcher-badge').exists()).toBe(false)
    api.getMessage({ ...assistant, content: '后台完整回复' })
    await nextTick()
    expect(wrapper.get('.gim-launcher-badge').text()).toBe('1')
    api.chat(assistant)
    await nextTick()
    expect(wrapper.get('.gim-chat-heading strong').text()).toBe('AI 助手')
    expect(wrapper.findAll('.gim-message')).toHaveLength(2)
    expect(wrapper.findAll('.gim-bubble').at(-1)?.text()).toBe('后台完整回复')
    wrapper.unmount()
  })

  it('recovers after timeout or host errors and clears timers on unmount', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ImWidget, { props: { init, chatTimeout: 1000 } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(assistant)
    await nextTick()
    await wrapper.get('textarea').setValue('问题')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('[role="alert"]').text()).toContain('超时')
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    await wrapper.get('textarea').setValue('再问一次')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    api.getMessage({ ...assistant, content: '已有部分内容', finished: false })
    api.getMessage({ ...assistant, content: '', error: '服务暂不可用' })
    await nextTick()
    expect(wrapper.findAll('.gim-bubble').at(-1)?.text()).toContain('已有部分内容')
    expect(wrapper.findAll('[role="alert"]').at(-1)?.text()).toBe('服务暂不可用')
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    await wrapper.get('textarea').setValue('第三个问题')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders safe Markdown for AI replies while preserving ordinary messages as text', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(assistant)
    api.getMessage({ ...assistant, content: '# 标题\n\n- 列表\n\n```ts\nconst n = 1\n```\n\n<img src=x onerror=alert(1)>\n[危险](javascript:alert(1))' })
    await nextTick()
    expect(wrapper.get('.gim-markdown h1').text()).toBe('标题')
    expect(wrapper.get('.gim-markdown li').text()).toBe('列表')
    expect(wrapper.get('.gim-markdown pre code').text()).toContain('const n = 1')
    expect(wrapper.find('.gim-markdown img').exists()).toBe(false)
    expect(wrapper.find('.gim-markdown a[href^="javascript:"]').exists()).toBe(false)
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    api.getMessage({ id: 'alice', type: 'friend', content: '**原样显示** <img src=x>' })
    await nextTick()
    expect(wrapper.get('.gim-bubble').text()).toBe('**原样显示** <img src=x>')
    expect(wrapper.find('.gim-bubble strong').exists()).toBe(false)
    wrapper.unmount()
  })

  it('supports immediate replies via createIM and a maximised AI window', async () => {
    const target = document.createElement('div')
    const im = createIM({ init, target, onSendMessage({ receiver }) {
      im.getMessage({ ...receiver, content: '即时回复' })
    } })
    im.chat({ ...assistant, maximized: true })
    await nextTick()
    const composer = target.querySelector('textarea')!
    composer.value = '你好'
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(target.querySelector('.gim-chat-maximized')).not.toBeNull()
    expect(target.querySelector('.gim-ai-progress')).toBeNull()
    expect(target.querySelectorAll('.gim-message')).toHaveLength(2)
    expect(composer.disabled).toBe(false)
    target.querySelector<HTMLButtonElement>('[aria-label="还原窗口"]')!.click()
    await nextTick()
    expect(target.querySelector('.gim-chat-maximized')).toBeNull()
    im.destroy()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createIM, en, ImWidget, zhCN, type ImWidgetApi } from '../src'

const init = {
  user: { id: 'locale-user', username: '我', sign: '保留签名' },
  friend: [{ id: 'team', groupname: '同事', list: [{ id: 'alice', username: 'Alice' }] }],
  group: [{ id: 'group', groupname: 'Project', ownerId: 'locale-user', members: 2 }],
}
const friend = { id: 'alice', type: 'friend' as const, username: 'Alice' }

afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('IM languages', () => {
  it('keeps Chinese by default and translates built-in UI without translating user data', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const im = wrapper.vm as unknown as ImWidgetApi
    im.open()
    im.chat(friend)
    im.getMessage({ ...friend, content: '原始消息' })
    await nextTick()
    expect(wrapper.find('[aria-label="设置"]').exists()).toBe(true)
    im.setLocale('en')
    await nextTick()
    expect(wrapper.get('.gim-root').attributes('lang')).toBe('en')
    expect(wrapper.find('[aria-label="Voice call"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Nickname"]').element.getAttribute('title')).toContain('Enter')
    expect(wrapper.get('.gim-bubble').text()).toBe('原始消息')
    expect(wrapper.get<HTMLInputElement>('[aria-label="Signature"]').element.value).toBe('保留签名')
    await wrapper.get('[aria-label="Settings"]').trigger('click')
    expect(wrapper.find('[aria-label="Dark mode"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Close dialog"]').trigger('click')
    await wrapper.get('[aria-label="New category"]').trigger('click')
    await wrapper.get('.gim-management-form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe(en.enterCategoryName)
    im.setLocale('zh-CN')
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toBe(zhCN.enterCategoryName)
    wrapper.unmount()
  })

  it('accepts partial custom languages, safely interpolates names and reacts to Vue language props', async () => {
    const name = '<img src=x onerror=alert(1)>$&'
    const wrapper = mount(ImWidget, { props: { init, locale: 'custom', locales: {
      custom: { send: '传送', emptyChat: 'Hello {name}!', chatWith: 'Talk to {name}' },
    } } })
    const im = wrapper.vm as unknown as ImWidgetApi
    im.chat({ ...friend, username: name })
    await nextTick()
    expect(wrapper.get('.gim-message-empty').text()).toBe(`Hello ${name}!`)
    expect(wrapper.get('.gim-chat').attributes('aria-label')).toBe(`Talk to ${name}`)
    expect(wrapper.find('.gim-message-empty img').exists()).toBe(false)
    expect(wrapper.get('.gim-composer-footer button').text()).toContain('传送')
    expect(wrapper.find('[aria-label="聊天记录"]').exists()).toBe(true)
    await wrapper.get('textarea').setValue('保留草稿')
    await wrapper.setProps({ locale: 'en' })
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('保留草稿')
    expect(wrapper.get('.gim-composer-footer button').text()).toContain('Send')
    await wrapper.setProps({ locales: { en: { send: 'Send now' } } })
    expect(wrapper.get('.gim-composer-footer button').text()).toContain('Send now')
    wrapper.unmount()
  })

  it('exposes runtime customisation through createIM and isolates languages between instances', async () => {
    const target = document.createElement('div')
    const first = createIM({ init, target, locale: 'en-US' })
    const secondTarget = document.createElement('div')
    const second = createIM({ init, target: secondTarget })
    first.chat(friend)
    second.chat(friend)
    first.setLocale('fr', { ...en, send: 'Envoyer', emptyChat: 'Parler avec {name}' })
    await nextTick()
    expect(target.querySelector('.gim-composer-footer button')?.textContent).toContain('Envoyer')
    expect(target.querySelector('.gim-message-empty')?.textContent).toBe('Parler avec Alice')
    expect(secondTarget.querySelector('.gim-composer-footer button')?.textContent).toContain('发送')
    first.setLocale('en')
    await nextTick()
    expect(target.querySelector('[aria-label="Chat history"]')).not.toBeNull()
    first.destroy()
    second.destroy()
  })

  it('translates customer service, group permissions and member actions', async () => {
    const wrapper = mount(ImWidget, { props: { init, locale: 'en', loadGroupMembers: () => [
      { ...init.user }, { id: 'alice', username: 'Alice' },
    ] } })
    const im = wrapper.vm as unknown as ImWidgetApi
    im.chat({ ...init.group[0], type: 'group' })
    await nextTick()
    await wrapper.get('[aria-label="View group members"]').trigger('click')
    await nextTick()
    expect(wrapper.get('.gim-owner-badge').text()).toBe('Owner')
    expect(wrapper.find('[aria-label="Make Alice an administrator"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Remove Alice"]').trigger('click')
    expect(wrapper.get('.gim-management-form').text()).toContain('Alice')
    expect(wrapper.get('.gim-management-form').text()).toContain('Project')
    expect(wrapper.get('.gim-management-form').text()).not.toMatch(/\p{Script=Han}/u)
    wrapper.unmount()
    const service = mount(ImWidget, { props: { init, locale: 'en', customerService: friend } })
    expect(service.find('[aria-label="Open support chat"]').exists()).toBe(true)
    expect(service.get('.gim-service-launcher-label').text()).toBe('Support')
    service.unmount()
  })

  it('translates recording errors and keeps errors reactive when switching languages', async () => {
    const wrapper = mount(ImWidget, { props: { init, locale: 'en' } })
    const im = wrapper.vm as unknown as ImWidgetApi
    im.chat(friend)
    await nextTick()
    await wrapper.get('[aria-label="Voice message"]').trigger('click')
    expect(wrapper.get('.gim-toolbar-error').text()).toBe(en.recordingUnsupported)
    im.setLocale('custom', { recordingUnsupported: 'No microphone available' })
    await nextTick()
    expect(wrapper.get('.gim-toolbar-error').text()).toBe('No microphone available')
    wrapper.unmount()
  })

  it('translates internal AI errors after a locale change and preserves host error messages', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ImWidget, { props: { init, locale: 'en', chatTimeout: 10 } })
    const im = wrapper.vm as unknown as ImWidgetApi
    const ai = { id: 'ai', type: 'ai' as const, username: 'AI' }
    im.chat(ai)
    await nextTick()
    await wrapper.get('textarea').setValue('Hello')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await vi.advanceTimersByTimeAsync(10)
    expect(wrapper.get('[role="alert"]').text()).toBe(en.aiTimeout)
    im.setLocale('zh-CN')
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toBe(zhCN.aiTimeout)
    im.getMessage({ ...ai, content: '', mid: 'host-error', error: '服务端原始错误' })
    await nextTick()
    expect(wrapper.findAll('[role="alert"]').at(-1)?.text()).toBe('服务端原始错误')
    wrapper.unmount()
  })

  it('keeps the same interpolation parameters in built-in language packs', () => {
    expect(Object.entries(zhCN).every(([key, message]) => {
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
      return JSON.stringify(placeholders(message)) === JSON.stringify(placeholders(en[key as keyof typeof en]))
    })).toBe(true)
  })
})

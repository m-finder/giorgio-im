import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createIM, ImWidget, type ImInit, type ImWidgetApi } from '../src'
import messageSound from '../src/assets/message.mp3?inline'

const init: ImInit = {
  user: { id: 'me', username: 'Me' },
  friend: [{ id: 'friends', groupname: 'Friends', list: [
    { id: 'alice', username: 'Alice', avatar: '/alice.png' },
    { id: 'bob', username: 'Bob' },
  ] }],
  group: [{ id: 'team', groupname: 'Team', avatar: '/team.png' }],
}

const alice = { id: 'alice', type: 'friend' as const, content: 'Hello', mid: 'alice-1' }

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('incoming message notifications', () => {
  it.each([
    { id: 'bob', type: 'friend' as const, username: 'Bob' },
    { id: 'team', type: 'group' as const, groupname: 'Team' },
    { id: 'assistant', type: 'ai' as const, username: 'Assistant' },
  ])('silences an open background $type conversation while keeping its unread dot', async contact => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Audio', vi.fn(() => ({ play, pause: vi.fn() })))
    const wrapper = mount(ImWidget, { props: { init, messageSound: '/message.mp3' } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(contact)
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    api.getMessage({ ...contact, content: 'Background update', mid: 'background-1' })
    await nextTick()
    expect({ prompt: wrapper.find('.gim-message-alert').exists(), sounds: play.mock.calls.length,
      active: wrapper.get('.gim-chat-heading strong').text(), dots: wrapper.findAll('.gim-tab-dot').length })
      .toEqual({ prompt: false, sounds: 0, active: 'Alice', dots: 1 })

    const other = contact.type === 'group' ? { id: 'bob', type: 'friend' as const } : { id: 'team', type: 'group' as const }
    api.getMessage({ ...other, content: 'Another update', mid: 'other-1' })
    await nextTick()
    const animate = vi.fn()
    wrapper.get('.gim-message-alert').element.animate = animate
    api.getMessage({ ...contact, content: 'Another background update', mid: 'background-2' })
    await nextTick()
    expect({ count: wrapper.get('.gim-message-alert-count').text(), sounds: play.mock.calls.length, vibrations: animate.mock.calls.length,
      names: wrapper.get('.gim-message-alert-copy small').text() })
      .toEqual({ count: '1', sounds: 1, vibrations: 0, names: contact.type === 'group' ? 'Bob' : 'Team' })
    wrapper.unmount()
  })

  it('resumes alerts for open background conversations when the chat is minimised', async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Audio', vi.fn(() => ({ play, pause: vi.fn() })))
    const wrapper = mount(ImWidget, { props: { init, messageSound: '/message.mp3' } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'bob', type: 'friend', username: 'Bob' })
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    api.getMessage({ id: 'bob', type: 'friend', content: 'Background', mid: 'background' })
    await nextTick()
    api.close()
    api.getMessage({ id: 'bob', type: 'friend', content: 'Hidden', mid: 'hidden' })
    await nextTick()
    expect({ count: wrapper.get('.gim-message-alert-count').text(), sounds: play.mock.calls.length })
      .toEqual({ count: '2', sounds: 1 })
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    expect({ prompt: wrapper.find('.gim-message-alert').exists(), dots: wrapper.findAll('.gim-tab-dot').length })
      .toEqual({ prompt: false, dots: 1 })
    wrapper.unmount()
  })

  it('silences the conversation being viewed while still alerting for other conversations', async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Audio', vi.fn(() => ({ play, pause: vi.fn() })))
    const wrapper = mount(ImWidget, { props: { init, messageSound: '/message.mp3' } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    api.getMessage(alice)
    await nextTick()
    expect({ sounds: play.mock.calls.length, prompt: wrapper.find('.gim-message-alert').exists() })
      .toEqual({ sounds: 0, prompt: false })
    api.getMessage({ id: 'bob', type: 'friend', content: 'Hello' })
    await nextTick()
    expect({ sounds: play.mock.calls.length, prompt: wrapper.get('.gim-message-alert').text() })
      .toEqual({ sounds: 1, prompt: expect.stringContaining('Bob') })
    wrapper.unmount()
  })

  it('restarts vibration for new unread messages without replacing the prompt, and respects reduced motion', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage(alice)
    await nextTick()
    const prompt = wrapper.get('.gim-message-alert').element as HTMLButtonElement
    const cancel = vi.fn()
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation)
    prompt.animate = animate
    api.getMessage({ ...alice, mid: 'alice-2' })
    await nextTick()
    expect(animate).toHaveBeenCalledOnce()
    api.getMessage({ ...alice, mid: 'alice-2' })
    api.getMessage({ ...alice, mid: 'own', mine: true })
    await nextTick()
    expect(animate).toHaveBeenCalledOnce()
    api.getMessage({ ...alice, mid: 'alice-3' })
    await nextTick()
    expect({ starts: animate.mock.calls.length, cancellations: cancel.mock.calls.length, samePrompt: wrapper.get('.gim-message-alert').element === prompt })
      .toEqual({ starts: 2, cancellations: 1, samePrompt: true })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    api.getMessage({ ...alice, mid: 'alice-4' })
    await nextTick()
    expect(animate).toHaveBeenCalledTimes(2)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    api.getMessage({ ...alice, mid: 'alice-5' })
    await nextTick()
    wrapper.unmount()
    expect(cancel).toHaveBeenCalledTimes(3)
  })

  it('groups unread conversations into a prompt and opens them without reading background conversations', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage(alice)
    api.getMessage({ id: 'team', type: 'group', username: 'Bob', content: 'Team update' })
    await nextTick()
    expect({ text: wrapper.get('.gim-message-alert').text(), avatar: wrapper.get('.gim-message-alert img').attributes('src') })
      .toEqual({ text: expect.stringContaining('2'), avatar: '/team.png' })
    await wrapper.get('.gim-message-alert').trigger('click')
    expect({ conversations: wrapper.findAll('.gim-conversation-row').length, active: wrapper.get('.gim-chat-heading strong').text(), prompt: wrapper.find('.gim-message-alert').exists(), dots: wrapper.findAll('.gim-tab-dot').length })
      .toEqual({ conversations: 2, active: 'Team', prompt: false, dots: 1 })
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    await nextTick()
    expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores own messages and duplicates, and does not prompt for the visible conversation', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage({ ...alice, mine: true })
    api.getMessage(alice)
    await nextTick()
    expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    api.getMessage({ ...alice, mid: 'alice-2' })
    await nextTick()
    expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
    api.close()
    api.getMessage({ ...alice, mid: 'alice-3' })
    api.getMessage({ ...alice, mid: 'alice-3' })
    await nextTick()
    expect(wrapper.get('.gim-message-alert-count').text()).toBe('1')
    wrapper.unmount()
  })

  it('prompts for a hidden page and clears the active conversation on return', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    api.getMessage(alice)
    await nextTick()
    expect(wrapper.get('.gim-message-alert-count').text()).toBe('1')
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
    wrapper.unmount()
  })

  it('waits for a complete AI reply and removes its prompt when the contact is removed', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage({ id: 'ai', type: 'ai', username: 'Assistant', mid: 'reply', content: 'Hi', finished: false })
    await nextTick()
    expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
    api.getMessage({ id: 'ai', type: 'ai', mid: 'reply', content: 'Hi there', finished: true })
    api.getMessage({ id: 'ai', type: 'ai', mid: 'reply', content: 'Hi there', finished: true })
    await nextTick()
    expect(wrapper.get('.gim-message-alert-count').text()).toBe('1')
    api.removeFriend('ai')
    await nextTick()
    expect(wrapper.find('.gim-message-alert').exists()).toBe(false)
    wrapper.unmount()
  })

  it('supports disabling prompts without disabling unread counts, and translates prompt copy', async () => {
    const wrapper = mount(ImWidget, { props: { init, messageNotification: false } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage(alice)
    await nextTick()
    expect({ prompt: wrapper.find('.gim-message-alert').exists(), unread: wrapper.get('.gim-launcher-badge').text() })
      .toEqual({ prompt: false, unread: '1' })
    await wrapper.setProps({ messageNotification: true, locale: 'en' })
    expect(wrapper.get('.gim-message-alert').text()).toContain('New message')
    api.setLocale('custom', { newMessages: 'Updates', viewUnreadMessages: 'Read {count}' })
    await nextTick()
    expect(wrapper.get('.gim-message-alert').attributes('aria-label')).toBe('Read 1')
    wrapper.unmount()
  })

  it('opens the sole support conversation from its unread prompt', async () => {
    const customerService = { id: 'support', type: 'friend' as const, username: 'Support' }
    const wrapper = mount(ImWidget, { props: { init, customerService } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage({ ...customerService, content: 'Can I help?' })
    await nextTick()
    await wrapper.get('.gim-message-alert').trigger('click')
    expect({ title: wrapper.get('.gim-chat-heading strong').text(), panel: wrapper.find('.gim-panel').exists(), prompt: wrapper.find('.gim-message-alert').exists() })
      .toEqual({ title: 'Support', panel: false, prompt: false })
    wrapper.unmount()
  })

  it('restores unread prompts without replaying sounds', async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Audio', vi.fn(() => ({ play, pause: vi.fn() })))
    const target = document.createElement('div')
    const im = createIM({ init, target, enableLocalStorage: true, messageSound: '/message.mp3' })
    im.getMessage(alice)
    await nextTick()
    im.destroy()
    const restored = createIM({ init, target, enableLocalStorage: true, messageSound: '/message.mp3' })
    await nextTick()
    expect({ prompts: target.querySelectorAll('.gim-message-alert').length, sounds: play.mock.calls.length })
      .toEqual({ prompts: 1, sounds: 1 })
    restored.destroy()
  })

  it('handles custom sound rejection and throttles bursts without playing own, duplicate or AI messages', async () => {
    const play = vi.fn().mockRejectedValue(new Error('Autoplay blocked'))
    const pause = vi.fn()
    vi.stubGlobal('Audio', vi.fn(() => ({ play, pause })))
    const wrapper = mount(ImWidget, { props: { init, messageSound: '/message.mp3' } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.getMessage({ ...alice, mid: 'own', mine: true })
    api.getMessage({ id: 'ai', type: 'ai', content: 'Hi' })
    api.getMessage(alice)
    api.getMessage(alice)
    api.getMessage({ ...alice, mid: 'burst' })
    await nextTick()
    expect(play).toHaveBeenCalledOnce()
    wrapper.unmount()
    expect(pause).toHaveBeenCalledOnce()
  })

  it.each([
    { setting: undefined, source: messageSound },
    { setting: true, source: messageSound },
    { setting: '/custom-message.mp3', source: '/custom-message.mp3' },
  ])('plays the configured sound ($setting) and stops it on unmount', async ({ setting, source }) => {
    const play = vi.fn().mockResolvedValue(undefined)
    const pause = vi.fn()
    const audio = vi.fn((_source: string) => ({ play, pause }))
    vi.stubGlobal('Audio', audio)
    const wrapper = mount(ImWidget, { props: { init, messageSound: setting } })
    ;(wrapper.vm as unknown as ImWidgetApi).getMessage(alice)
    await flushPromises()
    wrapper.unmount()
    expect({ source: audio.mock.calls[0]?.[0], played: play.mock.calls.length, stopped: pause.mock.calls.length })
      .toEqual({ source, played: 1, stopped: 1 })
  })

  it('allows sounds to be disabled independently of visual notifications', async () => {
    const audio = vi.fn()
    const context = vi.fn()
    vi.stubGlobal('Audio', audio)
    vi.stubGlobal('AudioContext', context)
    const wrapper = mount(ImWidget, { props: { init, messageSound: false } })
    ;(wrapper.vm as unknown as ImWidgetApi).getMessage(alice)
    await nextTick()
    expect({ sounds: audio.mock.calls.length + context.mock.calls.length, prompt: wrapper.find('.gim-message-alert').exists() })
      .toEqual({ sounds: 0, prompt: true })
    wrapper.unmount()
  })
})

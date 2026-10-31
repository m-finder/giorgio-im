import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createIM, ImWidget, type ImWidgetApi } from '../src'

const init = { user: { id: 'me', username: '我' } }
const receiver = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const stopTrack = vi.fn()
const stream = { getTracks: () => [{ stop: stopTrack }] }
const getUserMedia = vi.fn()
class Recorder {
  static isTypeSupported = () => true
  static latest: Recorder
  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  onerror?: () => void
  constructor() { Recorder.latest = this }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['recorded audio'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

beforeEach(() => {
  getUserMedia.mockResolvedValue(stream)
  vi.stubGlobal('MediaRecorder', Recorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:voice-preview'); static revokeObjectURL = vi.fn() })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); getUserMedia.mockReset(); stopTrack.mockReset() })

describe('calls and voice messages', () => {
  it.each([
    ['zh-CN', '语音电话', '第三方服务', '自主开发', '知道了'],
    ['en', 'Video call', 'third-party service', 'own calling service', 'Got it'],
  ])('shows integration guidance in %s without requesting media or sending messages', async (locale, label, thirdParty, custom, dismiss) => {
    const wrapper = mount(ImWidget, { props: { init, locale } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(receiver)
    await nextTick()
    await wrapper.get(`[aria-label="${label}"]`).trigger('click')
    const dialog = wrapper.get('.gim-call-info')
    expect(dialog.text()).toContain(thirdParty)
    expect(dialog.text()).toContain(custom)
    expect(dialog.text()).toContain('onCall')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(wrapper.emitted('sendMessage')).toBeUndefined()
    await wrapper.get(`[aria-label="${dismiss}"]`).trigger('click')
    expect(wrapper.find('.gim-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('locks repeated call requests until completion and reports host failures', async () => {
    let reject!: (cause: Error) => void
    const onCall = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    const wrapper = mount(ImWidget, { props: { init, onCall } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(receiver)
    await nextTick()
    await wrapper.get('[aria-label="语音电话"]').trigger('click')
    expect(wrapper.get<HTMLButtonElement>('[aria-label="视频电话"]').element.disabled).toBe(true)
    await wrapper.get('[aria-label="语音电话"]').trigger('click')
    expect(onCall).toHaveBeenCalledTimes(1)
    reject(new Error('连接失败'))
    await flushPromises()
    expect(wrapper.get('.gim-toolbar-error').text()).toContain('发起通话失败')
    expect(wrapper.get<HTMLButtonElement>('[aria-label="视频电话"]').element.disabled).toBe(false)
    wrapper.unmount()
  })

  it('reports unsupported recording and releases an active microphone on unmount', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(receiver)
    await nextTick()
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.gim-toolbar-error').text()).toContain('不支持录音')
    expect(getUserMedia).not.toHaveBeenCalled()
    vi.stubGlobal('MediaRecorder', Recorder)
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('forwards voice and video calls through createIM without sending chat messages', async () => {
    const target = document.createElement('div')
    const onCall = vi.fn()
    const onSendMessage = vi.fn()
    const im = createIM({ init, target, onCall, onSendMessage })
    im.chat(receiver)
    await nextTick()
    target.querySelector<HTMLButtonElement>('[aria-label="语音电话"]')!.click()
    await flushPromises()
    target.querySelector<HTMLButtonElement>('[aria-label="视频电话"]')!.click()
    await flushPromises()
    expect(onCall.mock.calls.map(([payload]) => payload)).toEqual([
      { type: 'voice', user: expect.objectContaining(init.user), receiver: expect.objectContaining(receiver) },
      { type: 'video', user: expect.objectContaining(init.user), receiver: expect.objectContaining(receiver) },
    ])
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    im.destroy()
  })

  it('records, previews and uploads a voice message only after explicit send', async () => {
    const uploadVoice = vi.fn(() => 'https://example.com/voice.webm')
    const wrapper = mount(ImWidget, { props: { init, uploadVoice } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(receiver)
    await nextTick()
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    await wrapper.get('[aria-label="停止录音"]').trigger('click')
    expect(wrapper.get('audio').attributes('src')).toBe('blob:voice-preview')
    expect(uploadVoice).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="发送语音"]').trigger('click')
    await flushPromises()
    expect(uploadVoice).toHaveBeenCalledWith(expect.any(File), expect.objectContaining(receiver), expect.any(Number))
    expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ content: '[语音消息]', attachment: {
      kind: 'audio', url: 'https://example.com/voice.webm', duration: 1,
    } })
    expect(wrapper.get('.gim-message audio').attributes('src')).toBe('https://example.com/voice.webm')
    expect(stopTrack).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('releases a late microphone grant when cancelled and never starts recording', async () => {
    let finish!: (value: typeof stream) => void
    getUserMedia.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(receiver)
    await nextTick()
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    api.chat({ id: 'bob', type: 'friend', username: 'Bob' })
    finish(stream)
    await flushPromises()
    expect(stopTrack).toHaveBeenCalled()
    expect(wrapper.find('[aria-label="停止录音"]').exists()).toBe(false)
    expect(wrapper.emitted('sendMessage')).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels recording on mute and ignores an upload result after leaving the conversation', async () => {
    let finish!: (value: string) => void
    const wrapper = mount(ImWidget, { props: { init, uploadVoice: () => new Promise(resolve => { finish = resolve }) } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'team', type: 'group', groupname: '群', ownerId: 'other' })
    await nextTick()
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    api.setGroupMute('team', true)
    await nextTick()
    expect(stopTrack).toHaveBeenCalled()
    expect(wrapper.find('[aria-label="停止录音"]').exists()).toBe(false)
    api.setGroupMute('team', false)
    await nextTick()
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="停止录音"]').trigger('click')
    await wrapper.get('[aria-label="发送语音"]').trigger('click')
    api.removeGroup('team')
    finish('https://example.com/late.webm')
    await flushPromises()
    expect(wrapper.emitted('sendMessage')).toBeUndefined()
    wrapper.unmount()
  })

  it('reports denied permission, missing integration and upload failures with retry', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(receiver)
    await nextTick()
    await wrapper.get('[aria-label="语音电话"]').trigger('click')
    expect(wrapper.get('.gim-call-info').text()).toContain('onCall')
    await wrapper.get('[aria-label="知道了"]').trigger('click')
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.gim-toolbar-error').text()).toContain('麦克风')
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="停止录音"]').trigger('click')
    await wrapper.get('[aria-label="发送语音"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.gim-toolbar-error').text()).toContain('uploadVoice')
    const uploadAttachment = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue('https://example.com/retry.webm')
    await wrapper.setProps({ uploadAttachment })
    await wrapper.get('[aria-label="发送语音"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.gim-toolbar-error').text()).toContain('上传失败')
    await wrapper.get('[aria-label="发送语音"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('sendMessage')).toHaveLength(1)
    wrapper.unmount()
  })

  it('stops at 60 seconds and revokes the preview on cancellation', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ImWidget, { props: { init } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(receiver)
    await nextTick()
    await wrapper.get('[aria-label="语音消息"]').trigger('click')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(60000)
    expect(wrapper.find('audio').exists()).toBe(true)
    await wrapper.get('[aria-label="取消录音"]').trigger('click')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-preview')
    expect(wrapper.find('audio').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides media tools for AI, receives audio messages and rejects unsafe audio URLs', async () => {
    const wrapper = mount(ImWidget, { props: { init } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'ai', type: 'ai', username: 'AI' })
    await nextTick()
    expect(wrapper.find('[aria-label="语音消息"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="视频电话"]').exists()).toBe(false)
    api.chat(receiver)
    api.getMessage({ ...receiver, content: '[语音消息]', attachment: { kind: 'audio', url: 'https://example.com/audio.mp3', name: '语音', duration: 3 } })
    api.getMessage({ ...receiver, content: '[语音消息]', attachment: { kind: 'audio', url: 'javascript:alert(1)', name: '语音' } })
    await nextTick()
    expect(wrapper.findAll('.gim-message audio')).toHaveLength(1)
    expect(wrapper.get('.gim-message audio').attributes('preload')).toBe('none')
    wrapper.unmount()
  })
})

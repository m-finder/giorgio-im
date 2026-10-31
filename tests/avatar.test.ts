import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM } from '../src'
import type { ImInit, ImWidgetApi } from '../src/types'

const init: ImInit = { user: { id: 'me', username: '我', avatar: 'https://example.com/old.png' } }
const file = new File(['image'], 'avatar.png', { type: 'image/png' })

afterEach(() => localStorage.clear())

describe('current user avatar', () => {
  it('uploads before changing the avatar, forwards callbacks and updates own messages', async () => {
    let finish!: (url: string) => void
    const uploadAvatar = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
    const onAvatar = vi.fn()
    const onSendMessage = vi.fn()
    const target = document.createElement('div')
    const im = createIM({ init, target, uploadAvatar, onAvatar, onSendMessage })
    im.open()
    im.chat({ id: 'alice', type: 'friend', username: 'Alice' })
    im.getMessage({ id: 'alice', type: 'friend', content: '旧消息', mine: true, avatar: init.user.avatar })
    await nextTick()
    const input = target.querySelector<HTMLInputElement>('[aria-label="选择头像图片"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(uploadAvatar).toHaveBeenCalledWith(file, expect.objectContaining(init.user))
    expect(target.querySelector<HTMLButtonElement>('[aria-label="更换头像"]')!.disabled).toBe(true)
    expect(target.querySelector('.gim-own-avatar img')?.getAttribute('src')).toBe(init.user.avatar)
    finish('https://example.com/new.png')
    await flushPromises()
    expect(onAvatar.mock.calls).toEqual([['https://example.com/new.png']])
    expect(target.querySelector('.gim-own-avatar img')?.getAttribute('src')).toBe('https://example.com/new.png')
    expect(target.querySelector('.mine .gim-message-avatar img')?.getAttribute('src')).toBe('https://example.com/new.png')
    const composer = target.querySelector('textarea')!
    composer.value = '新消息'
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ avatar: 'https://example.com/new.png' }) }))
    expect(init.user.avatar).toBe('https://example.com/old.png')
    im.destroy()
  })

  it('keeps the original avatar on invalid files, failed uploads or unsafe URLs', async () => {
    const uploadAvatar = vi.fn().mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue('javascript:alert(1)')
    const wrapper = mount(ImWidget, { props: { init, uploadAvatar } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    const input = wrapper.get<HTMLInputElement>('[aria-label="选择头像图片"]')
    for (const selected of [new File(['x'], 'text.txt', { type: 'text/plain' }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), file, file]) {
      Object.defineProperty(input.element, 'files', { configurable: true, value: [selected] })
      await input.trigger('change')
      await flushPromises()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(wrapper.get('.gim-own-avatar img').attributes('src')).toBe(init.user.avatar)
    }
    expect(uploadAvatar).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('avatar')).toBeUndefined()
    wrapper.unmount()
  })

  it('stores a data URL without an upload callback and restores it from the encrypted backup', async () => {
    const dataUrl = 'data:image/png;base64,aW1hZ2U='
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: dataUrl })
      this.dispatchEvent(new ProgressEvent('load'))
    })
    const wrapper = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    const input = wrapper.get<HTMLInputElement>('[aria-label="选择头像图片"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.emitted('avatar')).toEqual([[dataUrl]])
    wrapper.unmount()
    const restored = mount(ImWidget, { props: { init, enableLocalStorage: true } })
    await nextTick()
    expect(restored.get('.gim-own-avatar img').attributes('src')).toBe(dataUrl)
    expect(restored.emitted('avatar')).toBeUndefined()
    restored.unmount()
    read.mockRestore()
  })

  it('syncs host avatar changes without callbacks and ignores uploads completed after unmount', async () => {
    let finish!: (url: string) => void
    const onAvatar = vi.fn()
    const wrapper = mount(ImWidget, { props: { init, onAvatar, uploadAvatar: () => new Promise<string>(resolve => { finish = resolve }) } })
    ;(wrapper.vm as unknown as ImWidgetApi).open()
    await nextTick()
    await wrapper.setProps({ init: { user: { ...init.user, avatar: 'https://example.com/host.png' } } })
    expect(wrapper.get('.gim-own-avatar img').attributes('src')).toBe('https://example.com/host.png')
    expect(onAvatar).not.toHaveBeenCalled()
    const input = wrapper.get<HTMLInputElement>('[aria-label="选择头像图片"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    wrapper.unmount()
    finish('https://example.com/late.png')
    await flushPromises()
    expect(onAvatar).not.toHaveBeenCalled()
  })
})

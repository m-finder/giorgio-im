import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM } from '../src'
import type { ImInit, ImOptions, ImWidgetApi } from '../src/types'

const init: ImInit = {
  user: { id: 'me', username: '我' },
  group: [{ id: 0, groupname: '讨论组', avatar: 'https://example.com/old.png', ownerId: 'me' }],
}
const file = new File(['image'], 'group.png', { type: 'image/png' })

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

async function openMembers(props: Partial<ImOptions> = {}) {
  const wrapper = mount(ImWidget, { props: { init, ...props } })
  const api = wrapper.vm as unknown as ImWidgetApi
  api.open()
  api.chat({ ...init.group![0], type: 'group' })
  await nextTick()
  await wrapper.get('[aria-label="查看群成员"]').trigger('click')
  return { wrapper, api }
}

it('renames only after saving and syncs lists, existing conversations and send payloads', async () => {
  let finish!: (result: boolean) => void
  const renameGroup = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const onGroupRenamed = vi.fn()
  const onSendMessage = vi.fn()
  const target = document.createElement('div')
  const im = createIM({ init, target, renameGroup, onGroupRenamed, onSendMessage })
  im.open()
  im.chat({ ...init.group![0], type: 'group' })
  await nextTick()
  target.querySelector<HTMLButtonElement>('[aria-label="查看群成员"]')!.click()
  await nextTick()
  target.querySelector<HTMLButtonElement>('[aria-label="修改群名"]')!.click()
  await nextTick()
  const input = target.querySelector<HTMLInputElement>('[aria-label="群名称"]')!
  input.value = '  新讨论组  '
  input.dispatchEvent(new Event('input', { bubbles: true }))
  target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
  expect(renameGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 0, groupname: '讨论组' }), '新讨论组')
  expect(target.querySelector('.gim-chat-heading strong')?.textContent).toBe('讨论组')
  expect(target.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')?.disabled).toBe(true)
  finish(true)
  await flushPromises()
  expect(onGroupRenamed.mock.calls).toEqual([[expect.objectContaining({ id: 0, groupname: '新讨论组' })]])
  expect(target.querySelector('.gim-chat-heading strong')?.textContent).toBe('新讨论组')
  target.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click()
  im.chat({ ...init.group![0], type: 'group' })
  await nextTick()
  expect(target.querySelector('.gim-chat-heading strong')?.textContent).toBe('新讨论组')
  const composer = target.querySelector('textarea')!
  composer.value = '消息'
  composer.dispatchEvent(new Event('input', { bubbles: true }))
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  target.querySelector<HTMLButtonElement>('.gim-tabs button:nth-child(2)')!.click()
  await nextTick()
  expect(target.querySelector('.gim-contact-copy strong')?.textContent).toBe('新讨论组')
  expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({ receiver: expect.objectContaining({ groupname: '新讨论组' }) }))
  expect(init.group![0].groupname).toBe('讨论组')
  im.destroy()
})

it('rejects empty names and failed saves, and skips unchanged names', async () => {
  const renameGroup = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('保存失败'))
  const { wrapper } = await openMembers({ renameGroup })
  await wrapper.get('[aria-label="修改群名"]').trigger('click')
  await wrapper.get('[aria-label="群名称"]').setValue('   ')
  await wrapper.get('form').trigger('submit')
  expect(renameGroup).not.toHaveBeenCalled()
  expect(wrapper.get('[role="alert"]').text()).toContain('群名称')
  await wrapper.get('[aria-label="群名称"]').setValue('新名字')
  for (let attempt = 0; attempt < 2; attempt++) {
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('失败')
    expect(wrapper.get('.gim-chat-heading strong').text()).toBe('讨论组')
  }
  await wrapper.get('[aria-label="群名称"]').setValue('讨论组')
  await wrapper.get('form').trigger('submit')
  expect(renameGroup).toHaveBeenCalledTimes(2)
  expect(wrapper.emitted('groupRenamed')).toBeUndefined()
  wrapper.unmount()
})

it('uploads group avatars before applying them and retains old avatars on invalid input or failures', async () => {
  const uploadGroupAvatar = vi.fn().mockRejectedValueOnce(new Error('上传失败')).mockResolvedValueOnce('javascript:alert(1)').mockResolvedValue('https://example.com/new.png')
  const { wrapper } = await openMembers({ uploadGroupAvatar })
  const input = wrapper.get<HTMLInputElement>('[aria-label="选择群头像图片"]')
  for (const selected of [new File(['x'], 'text.txt', { type: 'text/plain' }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), file, file]) {
    Object.defineProperty(input.element, 'files', { configurable: true, value: [selected] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.get('.gim-chat-header .gim-avatar img').attributes('src')).toBe(init.group![0].avatar)
  }
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await flushPromises()
  expect(uploadGroupAvatar).toHaveBeenLastCalledWith(file, expect.objectContaining({ id: 0, ownerId: 'me' }))
  expect(wrapper.get('.gim-chat-header .gim-avatar img').attributes('src')).toBe('https://example.com/new.png')
  expect(wrapper.emitted('groupAvatarChanged')).toEqual([[expect.objectContaining({ id: 0, avatar: 'https://example.com/new.png' })]])
  await wrapper.get('[aria-label="关闭弹窗"]').trigger('click')
  await wrapper.get('.gim-tabs button:nth-child(2)').trigger('click')
  expect(wrapper.get('.gim-contact .gim-avatar img').attributes('src')).toBe('https://example.com/new.png')
  expect(init.group![0].avatar).toBe('https://example.com/old.png')
  wrapper.unmount()
})

it('restores changed group names and local avatar data from encrypted backups without callbacks', async () => {
  const dataUrl = 'data:image/png;base64,aW1hZ2U='
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: dataUrl })
    this.dispatchEvent(new ProgressEvent('load'))
  })
  const { wrapper } = await openMembers({ enableLocalStorage: true })
  await wrapper.get('[aria-label="修改群名"]').trigger('click')
  await wrapper.get('[aria-label="群名称"]').setValue('保存的群名')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  const input = wrapper.get<HTMLInputElement>('[aria-label="选择群头像图片"]')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  await flushPromises()
  wrapper.unmount()
  const restored = mount(ImWidget, { props: { init, enableLocalStorage: true } })
  await nextTick()
  expect(restored.get('.gim-chat-heading strong').text()).toBe('保存的群名')
  expect(restored.get('.gim-chat-header .gim-avatar img').attributes('src')).toBe(dataUrl)
  expect(restored.emitted('groupRenamed')).toBeUndefined()
  expect(restored.emitted('groupAvatarChanged')).toBeUndefined()
  restored.unmount()
})

it('hides editing from ordinary members and rechecks ownership after an upload', async () => {
  const ordinary = await openMembers({ init: { ...init, user: { id: 'alice', username: 'Alice' } } })
  expect(ordinary.wrapper.find('[aria-label="修改群名"]').exists()).toBe(false)
  expect(ordinary.wrapper.find('[aria-label="更换群头像"]').exists()).toBe(false)
  ordinary.wrapper.unmount()
  let finish!: (url: string) => void
  const { wrapper } = await openMembers({ uploadGroupAvatar: () => new Promise<string>(resolve => { finish = resolve }) })
  const input = wrapper.get<HTMLInputElement>('[aria-label="选择群头像图片"]')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  await wrapper.setProps({ init: { ...init, group: [{ ...init.group![0], ownerId: 'alice' }] } })
  finish('https://example.com/late.png')
  await flushPromises()
  expect(wrapper.emitted('groupAvatarChanged')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('群主')
  wrapper.unmount()
})

it.each(['removed', 'unmounted'])('ignores a group rename completed after the group is %s', async state => {
  let finish!: (result: boolean) => void
  const { wrapper, api } = await openMembers({ renameGroup: () => new Promise<boolean>(resolve => { finish = resolve }) })
  await wrapper.get('[aria-label="修改群名"]').trigger('click')
  await wrapper.get('[aria-label="群名称"]').setValue('晚到的群名')
  await wrapper.get('form').trigger('submit')
  if (state === 'removed') api.removeGroup(0)
  else wrapper.unmount()
  finish(true)
  await flushPromises()
  expect(wrapper.emitted('groupRenamed')).toBeUndefined()
  if (state === 'removed') wrapper.unmount()
})

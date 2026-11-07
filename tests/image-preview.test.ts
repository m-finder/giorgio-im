import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import type { ImOptions, ImWidgetApi } from '../src'

const friend = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const photo = (name: string) => ({ kind: 'image' as const, url: `https://example.test/${name}.png`, name: `${name}.png` })
const wrappers: ReturnType<typeof mount>[] = []

async function setup(options: Partial<ImOptions> = {}) {
  const wrapper = mount(ImWidget, { attachTo: document.body, props: { init: { user: { id: 'me', username: 'Me' } }, messageSound: false, ...options } })
  wrappers.push(wrapper)
  const api = wrapper.vm as unknown as ImWidgetApi
  api.chat(friend)
  await nextTick()
  return { wrapper, api }
}

afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

it('opens the clicked image and navigates across single and multiple image messages without wrapping', async () => {
  const { wrapper, api } = await setup()
  api.getMessage({ ...friend, content: 'Two photos', attachments: [photo('one'), photo('two')] })
  api.getMessage({ ...friend, content: 'Last photo', attachment: photo('three') })
  await nextTick()
  await wrapper.findAll('.gim-message-image')[1].trigger('click')
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('two').url)
  expect(wrapper.get('.gim-image-counter').text()).toBe('2 / 3')
  await wrapper.get('[aria-label="上一张"]').trigger('click')
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('one').url)
  expect(wrapper.get<HTMLButtonElement>('[aria-label="上一张"]').element.disabled).toBe(true)
  await wrapper.get('[aria-label="下一张"]').trigger('click')
  await wrapper.get('[aria-label="下一张"]').trigger('click')
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('three').url)
  expect(wrapper.get<HTMLButtonElement>('[aria-label="下一张"]').element.disabled).toBe(true)
})

it('supports keyboard navigation, traps focus and restores it after Escape or backdrop dismissal', async () => {
  const { wrapper, api } = await setup()
  api.getMessage({ ...friend, content: '', attachments: [photo('one'), photo('two')] })
  await nextTick()
  const trigger = wrapper.get('.gim-image-button')
  await trigger.trigger('click')
  const viewer = wrapper.get('.gim-image-viewer')
  expect(document.activeElement).toBe(viewer.element)
  await viewer.trigger('keydown', { key: 'ArrowRight' })
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('two').url)
  await viewer.trigger('keydown', { key: 'ArrowLeft' })
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('one').url)
  const close = wrapper.get<HTMLButtonElement>('[aria-label="关闭图片预览"]')
  close.element.focus()
  await close.trigger('keydown', { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(wrapper.get('[aria-label="下一张"]').element)
  await viewer.trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('.gim-image-viewer').exists()).toBe(false)
  expect(document.activeElement).toBe(trigger.element)
  await trigger.trigger('click')
  await wrapper.get('.gim-image-viewer').trigger('click')
  expect(wrapper.find('.gim-image-viewer').exists()).toBe(false)
})

it('previews historical quote images, removes duplicate URLs and excludes unsafe images', async () => {
  const { wrapper } = await setup({ loadHistory: () => [
    { ...friend, content: 'Original', attachment: photo('one') },
    { ...friend, content: 'Reply', replyTo: { mid: 'original', fromid: 'alice', username: 'Alice', content: 'Caption',
      attachments: [photo('one'), photo('two'), { kind: 'image', url: 'javascript:alert(1)', name: 'unsafe.png' }] } },
  ] })
  await flushPromises()
  await wrapper.findAll('.gim-message-quote img')[1].trigger('click')
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('two').url)
  expect(wrapper.get('.gim-image-counter').text()).toBe('2 / 2')
  await wrapper.get('[aria-label="上一张"]').trigger('click')
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('one').url)
})

it('hides single-image navigation and closes the viewer when switching or closing conversations', async () => {
  const { wrapper, api } = await setup()
  api.getMessage({ ...friend, content: '', attachment: photo('one') })
  await nextTick()
  await wrapper.get('.gim-message-image').trigger('click')
  expect(wrapper.find('[aria-label="上一张"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="下一张"]').exists()).toBe(false)
  api.chat({ id: 'bob', type: 'friend', username: 'Bob' })
  await nextTick()
  expect(wrapper.find('.gim-image-viewer').exists()).toBe(false)
  api.chat(friend)
  await nextTick()
  await wrapper.get('.gim-message-image').trigger('click')
  api.close()
  await nextTick()
  expect(wrapper.find('.gim-image-viewer').exists()).toBe(false)
})

it('opens image attachments in AI chats', async () => {
  const { wrapper, api } = await setup()
  const assistant = { id: 'assistant', type: 'ai' as const, username: 'Assistant' }
  api.chat(assistant)
  api.getMessage({ ...assistant, mine: true, content: '', attachment: photo('one') })
  await nextTick()
  await wrapper.get('.gim-message-image').trigger('click')
  expect(wrapper.get('.gim-preview-image').attributes('src')).toBe(photo('one').url)
})

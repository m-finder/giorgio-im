import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import type { ImOptions, ImWidgetApi } from '../src'

const group = { id: 'team', type: 'group' as const, groupname: 'Team' }
const friend = { id: 'alice', type: 'friend' as const, username: 'Alice' }
const members = [{ id: 'me', username: 'Me' }, { id: 'alice', username: 'Alice' }, { id: 'bob', username: 'Bob' }]
const wrappers: ReturnType<typeof mount>[] = []

async function setup(options: Partial<ImOptions> = {}) {
  const wrapper = mount(ImWidget, { props: { init: { user: members[0], group: [group] }, messageSound: false, loadGroupMembers: () => members, ...options } })
  wrappers.push(wrapper)
  const api = wrapper.vm as unknown as ImWidgetApi
  api.chat(group)
  await nextTick()
  return { wrapper, api }
}

afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })

it('selects a filtered group mention with Enter before sending and preserves its identity', async () => {
  const { wrapper } = await setup()
  const input = wrapper.get('textarea')
  await input.setValue('  😀 @ali')
  await flushPromises()
  await input.trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')).toBeUndefined()
  await input.setValue('  😀 @Alice hello')
  await input.trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ content: '😀 @Alice hello', mentions: [{ id: 'alice', username: 'Alice', start: 3, end: 9 }] })
  expect(wrapper.get('.gim-mention').text()).toBe('@Alice')
})

it('removes mention identity when its text is edited', async () => {
  const { wrapper } = await setup()
  await wrapper.get('textarea').setValue('@Ali')
  await flushPromises()
  await wrapper.get('.gim-mention-option').trigger('click')
  await wrapper.get('textarea').setValue('@Alicia hello')
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).not.toHaveProperty('mentions')
})

it.each([group, friend])('quotes messages in a $type chat, cancels a quote and resets it on a conversation switch', async receiver => {
  const { wrapper, api } = await setup()
  api.chat(receiver)
  api.getMessage({ ...receiver, mid: 'original', fromid: 'alice', username: 'Alice', content: 'Original message' })
  await nextTick()
  await wrapper.get('[aria-label="引用消息"]').trigger('click')
  expect(wrapper.get('.gim-reply-preview').text()).toContain('Original message')
  await wrapper.get('[aria-label="取消引用"]').trigger('click')
  expect(wrapper.find('.gim-reply-preview').exists()).toBe(false)
  await wrapper.get('[aria-label="引用消息"]').trigger('click')
  await wrapper.get('textarea').setValue('Reply')
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ content: 'Reply', replyTo: { mid: 'original', fromid: 'alice', username: 'Alice', content: 'Original message' } })
  expect(wrapper.get('.gim-message-quote').text()).toContain('Original message')
  await wrapper.findAll('[aria-label="引用消息"]')[0].trigger('click')
  api.chat({ id: 'elsewhere', type: 'group', groupname: 'Other' })
  await nextTick()
  expect(wrapper.find('.gim-reply-preview').exists()).toBe(false)
})

it('orders multiple mentions by their positions when a second one is inserted before the first', async () => {
  const { wrapper } = await setup()
  const input = wrapper.get<HTMLTextAreaElement>('textarea')
  await input.setValue('@Ali')
  await flushPromises()
  await wrapper.get('.gim-mention-option').trigger('click')
  await input.setValue('@Bo @Alice ')
  input.element.setSelectionRange(3, 3)
  await input.trigger('click')
  await wrapper.get('.gim-mention-option').trigger('click')
  await input.trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ content: '@Bob  @Alice', mentions: [
    { id: 'bob', username: 'Bob', start: 0, end: 4 }, { id: 'alice', username: 'Alice', start: 6, end: 12 },
  ] })
})

it('excludes self, searches duplicate names by their stable member identity and accepts pushed members', async () => {
  const { wrapper, api } = await setup({ loadGroupMembers: undefined })
  api.setGroupMembers('team', [members[0], { id: 1, username: '同名' }, { id: 2, username: '同名' }])
  await wrapper.get('textarea').setValue('@')
  await wrapper.get('textarea').trigger('keydown', { key: 'ArrowDown' })
  await wrapper.get('textarea').trigger('keydown', { key: 'Tab' })
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ mentions: [{ id: 2, username: '同名', start: 0, end: 3 }] })
})

it('retries member loading and dismisses the picker without sending', async () => {
  const loadGroupMembers = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(members)
  const { wrapper } = await setup({ loadGroupMembers })
  await wrapper.get('textarea').setValue('@Ali')
  await flushPromises()
  await wrapper.get('.gim-mention-picker button').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('.gim-mention-option')).toHaveLength(1)
  await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
  expect({ picker: wrapper.find('.gim-mention-picker').exists(), sends: wrapper.emitted('sendMessage') }).toEqual({ picker: false, sends: undefined })
})

it('prevents IME confirmation from selecting or sending and offers mentions only in groups', async () => {
  const { wrapper, api } = await setup()
  await wrapper.get('textarea').setValue('@Ali')
  await flushPromises()
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true })
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('@Ali')
  api.chat(friend)
  await nextTick()
  await wrapper.get('textarea').setValue('@Bob')
  expect(wrapper.find('.gim-mention-picker').exists()).toBe(false)
})

it('quotes an own private message and attaches the quote to an uploaded file', async () => {
  const { wrapper, api } = await setup({ uploadAttachment: () => 'https://example.test/note.txt' })
  api.chat(friend)
  api.getMessage({ ...friend, mid: 'mine', mine: true, content: 'My message' })
  await nextTick()
  await wrapper.get('[aria-label="引用消息"]').trigger('click')
  const input = wrapper.get('input[type="file"]:not([accept])')
  Object.defineProperty(input.element, 'files', { value: [new File(['file'], 'note.txt')] })
  await input.trigger('change')
  await flushPromises()
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ attachment: { kind: 'file' }, replyTo: { mid: 'mine', fromid: 'me', username: 'Me' } })
  expect(wrapper.find('.gim-reply-preview').exists()).toBe(false)
})

it('renders received and historical quotes as text and identifies mentions of the current user', async () => {
  const { wrapper } = await setup({ loadHistory: () => [{ ...group, mid: 'reply', fromid: 'alice', content: '@Me hello',
    mentions: [{ id: 'me', username: 'Me', start: 0, end: 3 }],
    replyTo: { mid: 'original', fromid: 'me', username: 'Me', content: '<img src=x onerror=alert(1)>' },
  }] })
  await flushPromises()
  expect(wrapper.get('.gim-mention-me').text()).toBe('@Me')
  expect(wrapper.get('.gim-message-quote').text()).toContain('<img src=x onerror=alert(1)>')
  expect(wrapper.find('.gim-message-quote img').exists()).toBe(false)
})

it('keeps quote metadata when an image upload fails and includes it on retry', async () => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:image'; static revokeObjectURL = vi.fn() })
  const uploadAttachment = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('https://example.test/image.png')
  const { wrapper, api } = await setup({ uploadAttachment })
  api.getMessage({ ...group, mid: 'original', fromid: 'alice', username: 'Alice', content: 'Photo please' })
  await nextTick()
  await wrapper.get('[aria-label="引用消息"]').trigger('click')
  const input = wrapper.get('input[type="file"][accept="image/*"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'image.png', { type: 'image/png' })] })
  await input.trigger('change')
  await wrapper.get('.gim-composer-footer button').trigger('click')
  await flushPromises()
  expect(wrapper.find('.gim-reply-preview').exists()).toBe(true)
  await wrapper.get('.gim-composer-footer button').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ attachment: { kind: 'image' }, replyTo: { mid: 'original' } })
})

it.each(['photo.png', 'https://example.test/photo.png'])('shows a quoted image instead of its %s placeholder', async content => {
  const { wrapper, api } = await setup()
  api.chat(friend)
  const attachment = { kind: 'image' as const, url: 'https://example.test/photo.png', name: 'photo.png' }
  api.getMessage({ ...friend, mid: 'photo', fromid: 'alice', username: 'Alice', content, attachment })
  await nextTick()
  await wrapper.get('[aria-label="引用消息"]').trigger('click')
  expect(wrapper.get('.gim-reply-preview img').attributes('src')).toBe(attachment.url)
  expect(wrapper.get('.gim-reply-preview').text()).not.toContain(content)
  await wrapper.get('textarea').setValue('Reply')
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ replyTo: { content, attachment } })
  expect(wrapper.get('.gim-message-quote img').attributes('src')).toBe(attachment.url)
  expect(wrapper.get('.gim-message-quote').text()).not.toContain(content)
})

it.each([1, 2])('preserves %i images and the caption when quoting an image and text message', async count => {
  const { wrapper, api } = await setup()
  const attachments = ['one', 'two'].slice(0, count).map(name => ({ kind: 'image' as const, url: `https://example.test/${name}.png`, name: `${name}.png` }))
  api.getMessage({ ...group, mid: 'photos', fromid: 'alice', username: 'Alice', content: 'Two photos', attachments })
  await nextTick()
  await wrapper.get('[aria-label="引用消息"]').trigger('click')
  expect(wrapper.findAll('.gim-reply-preview img').map(image => image.attributes('src'))).toEqual(attachments.map(image => image.url))
  expect(wrapper.get('.gim-reply-preview').text()).toContain('Two photos')
  await wrapper.get('textarea').setValue('Reply')
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('sendMessage')?.[0]?.[0]).toMatchObject({ replyTo: { content: 'Two photos', attachments } })
  expect(wrapper.findAll('.gim-message-quote img')).toHaveLength(count)
  expect(wrapper.get('.gim-message-quote').text()).toContain('Two photos')
})

it('shows historical quote images and captions while rejecting unsafe image URLs', async () => {
  const { wrapper } = await setup({ loadHistory: () => [{ ...group, mid: 'reply', fromid: 'alice', content: 'Reply',
    replyTo: { mid: 'photos', fromid: 'me', username: 'Me', content: '<b>Caption</b>', attachments: [
      { kind: 'image', url: 'https://example.test/photo.png', name: 'photo.png' },
      { kind: 'image', url: 'javascript:alert(1)', name: 'unsafe.png' },
    ] },
  }] })
  await flushPromises()
  expect(wrapper.findAll('.gim-message-quote img')).toHaveLength(1)
  expect(wrapper.get('.gim-message-quote').text()).toContain('<b>Caption</b>')
  expect(wrapper.find('.gim-message-quote b').exists()).toBe(false)
  await wrapper.get('[aria-label="聊天记录"]').trigger('click')
  expect(wrapper.findAll('.gim-history-row .gim-message-quote img')).toHaveLength(1)
  expect(wrapper.get('.gim-history-row .gim-message-quote').text()).toContain('<b>Caption</b>')
})

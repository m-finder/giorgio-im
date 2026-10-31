import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createIM, ImWidget, type ImInit, type ImToolbarContext, type ImWidgetApi } from '../src'

const init: ImInit = { user: { id: 'me', username: '我' } }
const alice = { id: 'alice', username: 'Alice', type: 'friend' as const }

describe('chat toolbar extensions', () => {
  it('merges built-in overrides and inserts custom tools before right-aligned history', async () => {
    const wrapper = mount(ImWidget, { props: { init, toolbar: [
      { id: 'file', visible: false },
      { id: 'image', label: '相册', title: '选择照片', icon: 'M3 3h18v18H3Z' },
      { id: 'quick', label: '快捷回复', text: 'Hi', order: 5 },
    ] } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    expect(wrapper.findAll('.gim-chat-tools > button').map(button => button.attributes('aria-label')))
      .toEqual(['快捷回复', '表情', '相册', '语音消息', '语音电话', '视频电话', '聊天记录'])
    expect(wrapper.get('[aria-label="相册"] path').attributes('d')).toBe('M3 3h18v18H3Z')
    expect(wrapper.get('[aria-label="相册"]').attributes('title')).toBe('选择照片')
    expect(wrapper.get('[aria-label="聊天记录"]').classes()).toContain('gim-tool-right-start')
    wrapper.unmount()
  })

  it('replaces a built-in handler and optionally invokes its original action', async () => {
    const onClick = vi.fn((context: ImToolbarContext) => context.runDefault())
    const wrapper = mount(ImWidget, { props: { init, toolbar: [{ id: 'emoji', onClick }] } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    await wrapper.get('[aria-label="表情"]').trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.gim-emoji-picker').exists()).toBe(true)
    await wrapper.setProps({ toolbar: [{ id: 'emoji', onClick: () => {} }] })
    await wrapper.get('[aria-label="表情"]').trigger('click')
    expect(wrapper.find('.gim-emoji-picker').exists()).toBe(false)
    wrapper.unmount()
  })

  it('provides conversation, user and draft helpers to custom actions', async () => {
    const onClick = vi.fn((context: ImToolbarContext) => {
      context.setDraft(context.draft + '！')
      context.insertText(' 收到')
    })
    const wrapper = mount(ImWidget, { props: { init, toolbar: [{ id: 'quick', label: '快捷回复', onClick }] } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    await wrapper.get('textarea').setValue('你好')
    await wrapper.get('[aria-label="快捷回复"]').trigger('click')
    expect(onClick.mock.calls[0][0]).toMatchObject({ id: 'quick', user: init.user, receiver: alice, draft: '你好', restriction: '' })
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('你好！ 收到')
    wrapper.unmount()
  })

  it('supports reactive visibility and disabled predicates plus runtime configuration through createIM', async () => {
    const target = document.createElement('div')
    const onClick = vi.fn()
    const im = createIM({ init, target, toolbar: [{ id: 'quick', label: '快捷回复',
      visible: context => context.receiver.type === 'friend', disabled: context => !context.draft, onClick,
    }] })
    im.chat(alice)
    await nextTick()
    expect(target.querySelector<HTMLButtonElement>('[aria-label="快捷回复"]')?.disabled).toBe(true)
    const input = target.querySelector('textarea')!
    input.value = '你好'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    target.querySelector<HTMLButtonElement>('[aria-label="快捷回复"]')!.click()
    await flushPromises()
    expect(onClick).toHaveBeenCalledTimes(1)
    im.chat({ id: 'ai', type: 'ai', username: 'AI' })
    await nextTick()
    expect(target.querySelector('[aria-label="快捷回复"]')).toBeNull()
    im.setToolbar([{ id: 'image', visible: false }])
    await nextTick()
    expect(target.querySelector('[aria-label="图片"]')).toBeNull()
    im.setToolbar([])
    await nextTick()
    expect(target.querySelectorAll('.gim-chat-tools > button')).toHaveLength(4) // AI 隐藏通话与语音消息
    im.destroy()
  })

  it('keeps custom actions disabled by moderation while leaving history available', async () => {
    const onClick = vi.fn()
    const wrapper = mount(ImWidget, { props: { init, toolbar: [{ id: 'quick', label: '快捷回复', disabled: false, onClick }] } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat({ id: 'team', type: 'group', groupname: '团队', ownerId: 'other' })
    api.setGroupMute('team', true)
    await nextTick()
    expect(wrapper.get<HTMLButtonElement>('[aria-label="快捷回复"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[aria-label="聊天记录"]').element.disabled).toBe(false)
    await wrapper.get('[aria-label="快捷回复"]').trigger('click')
    expect(onClick).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('prevents duplicate asynchronous clicks and reports action failures', async () => {
    let reject!: (reason: Error) => void
    const onClick = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    const wrapper = mount(ImWidget, { props: { init, toolbar: [{ id: 'quick', label: '快捷回复', onClick }] } })
    ;(wrapper.vm as unknown as ImWidgetApi).chat(alice)
    await nextTick()
    await wrapper.get('[aria-label="快捷回复"]').trigger('click')
    await wrapper.get('[aria-label="快捷回复"]').trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
    reject(new Error('Network error'))
    await flushPromises()
    expect(wrapper.get('.gim-toolbar-error').text()).toBe('操作失败，请重试')
    expect(wrapper.get<HTMLButtonElement>('[aria-label="快捷回复"]').element.disabled).toBe(false)
    wrapper.unmount()
  })

  it('does not let a late action modify a different conversation draft', async () => {
    let finish!: () => void
    const wrapper = mount(ImWidget, { props: { init, toolbar: [{ id: 'quick', label: '快捷回复', async onClick(context) {
      await new Promise<void>(resolve => { finish = resolve })
      context.setDraft('旧会话的回复')
      context.runDefault()
    } }] } })
    const api = wrapper.vm as unknown as ImWidgetApi
    api.chat(alice)
    await nextTick()
    await wrapper.get('[aria-label="快捷回复"]').trigger('click')
    api.chat({ id: 'bob', type: 'friend', username: 'Bob' })
    await nextTick()
    await wrapper.get('textarea').setValue('Bob 的草稿')
    finish()
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('Bob 的草稿')
    wrapper.unmount()
  })
})

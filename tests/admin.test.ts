import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImWidget from '../src/ImWidget.vue'
import { createIM } from '../src'
import type { ImInit, ImOptions, ImWidgetApi } from '../src/types'

const init: ImInit = {
  user: { id: 'owner', username: '群主' },
  group: [{ id: 0, groupname: '讨论组', ownerId: 'owner', adminIds: ['admin'] }],
}
const members = [
  { id: 'owner', username: '群主' }, { id: 'admin', username: '管理员甲' },
  { id: 'member', username: '普通成员' }, { id: 0, username: '零号成员' },
]

afterEach(() => localStorage.clear())

async function openMembers(options: Partial<ImOptions> = {}) {
  const wrapper = mount(ImWidget, { props: { init, loadGroupMembers: () => members, ...options } })
  const api = wrapper.vm as unknown as ImWidgetApi
  api.open()
  api.chat({ ...init.group![0], type: 'group' })
  await nextTick()
  await wrapper.get('[aria-label="查看群成员"]').trigger('click')
  await flushPromises()
  return { wrapper, api }
}

it.each(['owner', 'admin', 'member'])('shows role badges and the permissions for %s', async id => {
  const { wrapper, api } = await openMembers({ init: { ...init, user: { id, username: id } } })
  expect(wrapper.findAll('.gim-owner-badge')).toHaveLength(1)
  expect(wrapper.findAll('.gim-admin-badge')).toHaveLength(1)
  expect(wrapper.find('[aria-label="设普通成员为管理员"]').exists()).toBe(id === 'owner')
  expect(wrapper.find('[aria-label="取消管理员甲的管理员"]').exists()).toBe(id === 'owner')
  expect(wrapper.find('[aria-label="移出管理员甲"]').exists()).toBe(id === 'owner')
  expect(wrapper.find('[aria-label="移出群主"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="解散群聊"]').exists()).toBe(id === 'owner')
  expect(wrapper.find('[aria-label="退出群聊"]').exists()).toBe(id !== 'owner')
  expect(wrapper.find('[aria-label="修改群名"]').exists()).toBe(id !== 'member')
  expect(wrapper.find('[aria-label="更换群头像"]').exists()).toBe(id !== 'member')
  expect(wrapper.find('[aria-label="全员禁言"]').exists()).toBe(id !== 'member')
  if (id === 'admin') expect(wrapper.find('[aria-label="禁言普通成员"]').exists()).toBe(true)
  api.getMessage({ id: 0, type: 'group', fromid: 'admin', username: '管理员甲', content: '管理员消息' })
  await nextTick()
  expect(wrapper.get('.gim-message .gim-admin-badge').text()).toBe('管理员')
  wrapper.unmount()
})

it('waits for administrator saves, preserves failures and reports promotion and demotion', async () => {
  let finish!: (result: boolean) => void
  const setGroupAdmin = vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve })).mockResolvedValue(true)
  const { wrapper } = await openMembers({ setGroupAdmin })
  await wrapper.get('[aria-label="设普通成员为管理员"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('失败')
  expect(wrapper.emitted('groupAdminChanged')).toBeUndefined()
  await wrapper.get('[aria-label="设普通成员为管理员"]').trigger('click')
  expect(wrapper.get('[aria-label="关闭弹窗"]').attributes('disabled')).toBeDefined()
  expect(wrapper.findAll('.gim-admin-badge')).toHaveLength(1)
  finish(true)
  await flushPromises()
  expect(setGroupAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ id: 0 }), expect.objectContaining({ id: 'member' }), true)
  expect(wrapper.findAll('.gim-admin-badge')).toHaveLength(2)
  await wrapper.get('[aria-label="取消普通成员的管理员"]').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('groupAdminChanged')).toEqual([
    [expect.objectContaining({ adminIds: ['admin', 'member'] }), expect.objectContaining({ id: 'member' }), true],
    [expect.objectContaining({ adminIds: ['admin'] }), expect.objectContaining({ id: 'member' }), false],
  ])
  expect(init.group![0].adminIds).toEqual(['admin'])
  wrapper.unmount()
})

it('lets administrators update group details, mute ordinary members and remove them', async () => {
  const renameGroup = vi.fn()
  const muteGroupMember = vi.fn()
  const removeGroupMember = vi.fn()
  const { wrapper } = await openMembers({ init: { ...init, user: { id: 'admin', username: '管理员甲' } }, renameGroup, muteGroupMember, removeGroupMember })
  await wrapper.get('[aria-label="修改群名"]').trigger('click')
  await wrapper.get('[aria-label="群名称"]').setValue('管理员修改的群名')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.get('.gim-chat-heading strong').text()).toBe('管理员修改的群名')
  await wrapper.get('[aria-label="禁言普通成员"]').trigger('click')
  await flushPromises()
  expect(muteGroupMember).toHaveBeenCalledWith(expect.objectContaining({ id: 0 }), expect.objectContaining({ id: 'member' }), true)
  await wrapper.get('[aria-label="移出普通成员"]').trigger('click')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(removeGroupMember).toHaveBeenCalledWith(expect.objectContaining({ id: 0 }), expect.objectContaining({ id: 'member' }))
  expect(wrapper.findAll('.gim-member-row')).toHaveLength(3)
  wrapper.unmount()
})

it('rechecks permissions when confirming a removal and after a pending mute', async () => {
  const removeGroupMember = vi.fn()
  let finish!: () => void
  const muteGroupMember = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const { wrapper, api } = await openMembers({ init: { ...init, user: { id: 'admin', username: '管理员甲' } }, removeGroupMember, muteGroupMember })
  await wrapper.get('[aria-label="移出普通成员"]').trigger('click')
  api.setGroupAdmin(0, 'member', true)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(removeGroupMember).not.toHaveBeenCalled()
  expect(wrapper.get('[role="alert"]').text()).toContain('权限')
  await wrapper.get('.gim-management-footer button:first-child').trigger('click')
  await wrapper.get('[aria-label="禁言零号成员"]').trigger('click')
  api.setGroupAdmin(0, 'admin', false)
  finish()
  await flushPromises()
  expect(wrapper.emitted('groupMemberMuted')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('权限')
  wrapper.unmount()
})

it('applies server role changes through createIM, handles ID zero and keeps personal mutes effective', async () => {
  const setGroupAdmin = vi.fn()
  const onGroupAdminChanged = vi.fn()
  const target = document.createElement('div')
  const im = createIM({ init: { ...init, user: { id: 0, username: '零号成员' } }, target, setGroupAdmin, onGroupAdminChanged })
  im.chat({ ...init.group![0], type: 'group' })
  im.setGroupMute(0, true)
  await nextTick()
  expect(target.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
  im.setGroupAdmin(0, '0', true)
  im.setGroupAdmin(0, 0, true)
  await nextTick()
  expect(target.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false)
  im.setGroupMute(0, true, 0)
  await nextTick()
  expect(target.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
  im.setGroupMute(0, false, 0)
  im.setGroupAdmin(0, 0, false)
  await nextTick()
  expect(target.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
  expect(setGroupAdmin).not.toHaveBeenCalled()
  expect(onGroupAdminChanged).not.toHaveBeenCalled()
  im.destroy()
})

it('forwards administrator change callbacks through createIM and restores roles from encrypted backup', async () => {
  const target = document.createElement('div')
  const onGroupAdminChanged = vi.fn()
  const im = createIM({ init, target, enableLocalStorage: true, loadGroupMembers: () => members, onGroupAdminChanged })
  im.open()
  im.chat({ ...init.group![0], type: 'group' })
  await nextTick()
  target.querySelector<HTMLButtonElement>('[aria-label="查看群成员"]')!.click()
  await flushPromises()
  target.querySelector<HTMLButtonElement>('[aria-label="设零号成员为管理员"]')!.click()
  await flushPromises()
  expect(onGroupAdminChanged).toHaveBeenCalledWith(expect.objectContaining({ adminIds: ['admin', 0] }), expect.objectContaining({ id: 0 }), true)
  im.destroy()
  const { wrapper } = await openMembers({ enableLocalStorage: true })
  expect(wrapper.find('[aria-label="取消零号成员的管理员"]').exists()).toBe(true)
  expect(wrapper.emitted('groupAdminChanged')).toBeUndefined()
  wrapper.unmount()
})

it('removes an administrator from the role list when the owner removes that member', async () => {
  const { wrapper, api } = await openMembers()
  await wrapper.get('[aria-label="移出管理员甲"]').trigger('click')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  api.getMessage({ id: 0, type: 'group', fromid: 'admin', content: '旧身份消息' })
  await nextTick()
  expect(wrapper.find('.gim-message .gim-admin-badge').exists()).toBe(false)
  expect(wrapper.find('[aria-label="取消管理员甲的管理员"]').exists()).toBe(false)
  wrapper.unmount()
})

it.each(['removed', 'unmounted', 'transferred'])('ignores an administrator save after the group is %s', async state => {
  let finish!: () => void
  const { wrapper, api } = await openMembers({ setGroupAdmin: () => new Promise<void>(resolve => { finish = resolve }) })
  await wrapper.get('[aria-label="设普通成员为管理员"]').trigger('click')
  if (state === 'removed') api.removeGroup(0)
  else if (state === 'unmounted') wrapper.unmount()
  else await wrapper.setProps({ init: { ...init, group: [{ ...init.group![0], ownerId: 'member' }] } })
  finish()
  await flushPromises()
  expect(wrapper.emitted('groupAdminChanged')).toBeUndefined()
  if (state !== 'unmounted') wrapper.unmount()
})

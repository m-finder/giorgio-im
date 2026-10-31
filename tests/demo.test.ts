import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImOptions } from '../src'

const { createIM, im } = vi.hoisted(() => {
  const im = { open: vi.fn(), chat: vi.fn(), resetWindows: vi.fn() }
  return { createIM: vi.fn((_options: ImOptions) => im), im }
})

vi.mock('../src', () => ({ createIM }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="app"></div>'
  history.replaceState(null, '', '/')
})

describe('demo navigation', () => {
  it('defaults to Chinese and offers an English page', async () => {
    await import('../demo/main')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(createIM.mock.calls[0][0].locale).toBe('zh-CN')
    expect(document.querySelector('#open-demo')?.textContent).toContain('打开聊天体验')
    expect(document.querySelector<HTMLAnchorElement>('[lang="en"]')?.search).toBe('?lang=en')
  })

  it('renders English demo copy and preserves the mode and other URL parameters when changing language', async () => {
    history.replaceState(null, '', '/?mode=customer-service&lang=en&preview=1#demo')
    await import('../demo/main')
    expect(document.documentElement.lang).toBe('en')
    expect(createIM.mock.calls[0][0].locale).toBe('en')
    expect(document.querySelector('#open-demo')?.textContent).toContain('Try chat')
    expect(document.querySelector<HTMLAnchorElement>('[lang="zh-CN"]')?.href)
      .toBe(`${location.origin}/?mode=customer-service&preview=1#demo`)
  })

  it.each([
    ['', 'me', '林间晚风', '把灵感分享给彼此', '我的团队', '小鱼', '设计灵感交流'],
    ['?lang=en', 'me-en', 'Evening Breeze', 'Share a little inspiration', 'My team', 'Xiaoyu', 'Design inspiration'],
  ])('uses separate localised demo profiles and backup accounts for %s', async (query, id, username, sign, category, friend, groupname) => {
    history.replaceState(null, '', `/${query}`)
    await import('../demo/main')
    const options = createIM.mock.calls[0][0]
    expect({
      user: options.init.user,
      category: options.init.friend?.[0].groupname,
      friend: options.init.friend?.[0].list[0].username,
      group: options.init.group?.[0],
      owner: (await options.loadGroupMembers!({ id: 'design', type: 'group', groupname }))[0],
    }).toMatchObject({
      user: { id, username, sign },
      category,
      friend,
      group: { id: 'design', groupname, ownerId: id },
      owner: { id, username },
    })
  })

  it.each([
    ['#open-demo', 'chat', 'xiaoyu', 'friend'],
    ['#open-ai-demo', 'ai', 'ai-demo', 'ai'],
  ])('leaves customer service through %s and opens the requested conversation', async (selector, mode, id, type) => {
    history.replaceState(null, '', '/?mode=customer-service&lang=en')
    await import('../demo/main')
    const destination = document.querySelector<HTMLAnchorElement>(selector)!
    expect(destination.search).toBe(`?mode=${mode}&lang=en&resetWindows=1`)
    history.replaceState(null, '', destination.href)
    vi.resetModules()
    await import('../demo/main')
    expect(createIM.mock.calls.at(-1)?.[0]).toMatchObject({ customerService: undefined })
    expect(im.resetWindows).toHaveBeenCalledOnce()
    expect(location.search).toBe(`?mode=${mode}&lang=en`)
    expect(im.chat).toHaveBeenLastCalledWith(expect.objectContaining({ id, type }))
  })

  it('resets windows when switching normal and AI modes, and retains the current mode on language links', async () => {
    await import('../demo/main')
    document.querySelector<HTMLAnchorElement>('#open-demo')!.click()
    expect(im.chat).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'xiaoyu' }))
    expect(im.resetWindows).not.toHaveBeenCalled()
    document.querySelector<HTMLAnchorElement>('#open-ai-demo')!.click()
    expect(im.resetWindows).toHaveBeenCalledOnce()
    expect(im.chat).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ai' }))
    expect(document.querySelector<HTMLAnchorElement>('[lang="en"]')?.search).toBe('?mode=ai&lang=en')
    document.querySelector<HTMLAnchorElement>('#open-ai-demo')!.click()
    expect(im.resetWindows).toHaveBeenCalledOnce()
  })

  it('resets restored customer service windows only on mode entry, keeping ordinary refreshes intact', async () => {
    history.replaceState(null, '', '/?mode=customer-service&resetWindows=1')
    await import('../demo/main')
    expect(im.resetWindows).toHaveBeenCalledOnce()
    vi.resetModules()
    vi.clearAllMocks()
    await import('../demo/main')
    expect(im.resetWindows).not.toHaveBeenCalled()
  })
})

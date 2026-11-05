import { createIM, type ImContact, type ImGroupMember, type ImInit } from '../src'
import { createUuid } from '../src/uuid'
import './page.css'

const english = new URLSearchParams(location.search).get('lang') === 'en'
const t = (zh: string, en: string) => english ? en : zh
const mode = new URLSearchParams(location.search).get('mode')
const customerService = mode === 'customer-service'
const resetWindows = new URLSearchParams(location.search).get('resetWindows') === '1'
if (resetWindows) {
  const url = new URL(location.href)
  url.searchParams.delete('resetWindows')
  history.replaceState(null, '', url.href)
}
document.documentElement.lang = english ? 'en' : 'zh-CN'
document.title = t('Giorgio IM · Vue 组件演示', 'Giorgio IM · Vue component demo')

// Separate demo accounts keep each language's encrypted backup independent.
const demoUserId = english ? 'me-en' : 'me'
const init: ImInit = {
  user: { id: demoUserId, username: t('林间晚风', 'Evening Breeze'), sign: t('把灵感分享给彼此', 'Share a little inspiration'), status: 'online' },
  friend: [
    { id: 'team', groupname: t('我的团队', 'My team'), list: [
      { id: 'xiaoyu', username: t('小鱼', 'Xiaoyu'), sign: t('正在设计新的界面', 'Designing a new interface'), status: 'online' },
      { id: 'ak', username: t('阿凯', 'Kai'), sign: t('代码和咖啡都不能停', 'Powered by code and coffee'), status: 'online' },
      { id: 'momo', username: t('沫沫', 'Momo'), sign: t('今天也要保持好心情', 'Stay positive today'), status: 'offline' },
    ] },
    { id: 'friends', groupname: t('好友', 'Friends'), list: [
      { id: 'moon', username: t('月亮', 'Moon'), sign: t('今晚见！', 'See you tonight!'), status: 'online' },
    ] },
    { id: 'assistants', groupname: t('AI 助手', 'AI assistants'), list: [
      { id: 'ai-demo', type: 'ai', username: 'Giorgio AI', sign: t('流式对话 · Markdown · 多轮问答', 'Streaming · Markdown · Follow-up questions') },
    ] },
  ],
  group: [
    { id: 'design', groupname: t('设计灵感交流', 'Design inspiration'), members: 5, ownerId: demoUserId },
    { id: 'frontend', groupname: t('前端小组', 'Frontend team'), members: 4, ownerId: 'ak' },
  ],
}

const discoverable: ImContact[] = [
  { id: 'nana', username: t('娜娜', 'Nana'), sign: t('寻找有趣的想法', 'Looking for interesting ideas'), status: 'online' },
  { id: 'kiki', username: t('琪琪', 'Kiki'), sign: t('热爱插画和旅行', 'Loves illustration and travel'), status: 'online' },
  { id: 'leo', username: 'Leo', sign: t('一起聊聊新项目', 'Let’s talk about a new project'), status: 'offline' },
]

const demoUser: ImContact = { id: init.user.id, username: init.user.username, avatar: init.user.avatar }
const demoGroupMembers: Record<string, ImGroupMember[]> = {
  design: [demoUser, ...(init.friend?.flatMap(group => group.list).filter(contact => contact.type !== 'ai') || [])],
  frontend: [demoUser, ...(init.friend?.[0].list || [])],
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="demo-page">
    <header class="demo-nav">
      <div class="demo-brand"><span class="demo-brand-icon">◈</span> GIORGIO <span>IM</span></div>
      <div class="demo-nav-tools"><span class="demo-version">Vue 3 · TypeScript</span>
        <a class="demo-framework" data-framework="react" href="/react/">${t('切换到 React 版', 'Switch to React')}</a>
        <nav class="demo-language" aria-label="${t('页面语言', 'Page language')}">
          <a lang="zh-CN" data-language="zh" ${english ? '' : 'aria-current="page"'}>中文</a>
          <a lang="en" data-language="en" ${english ? 'aria-current="page"' : ''}>English</a>
        </nav>
      </div>
    </header>
    <section class="demo-hero"><div class="demo-kicker">A SIMPLE WAY TO STAY CONNECTED</div>
      <h1>${t('让每一次对话', 'Let every conversation')}<br /><em>${t('都自然发生。', 'flow naturally.')}</em></h1>
      <p>${t('一个轻量的 Vue 即时通讯组件。接入现有数据和消息通道，即可拥有联系人、群聊和消息窗口。', 'A lightweight Vue messaging component. Connect your data and messaging service to bring contacts, group chats and conversations to your app.')}</p>
      <div class="demo-actions">
        <a class="demo-primary-link" id="open-demo" data-mode="chat">${t('打开聊天体验', 'Try chat')} <span>↗</span></a>
        <a class="demo-primary-link" id="open-ai-demo" data-mode="ai">${t('AI 对话体验', 'Try AI chat')} <span>✦</span></a>
        <a class="demo-service-link" data-mode="customer-service">${t('客服模式体验', 'Try customer service')} ↗</a>
        <span>${t('点击右下角也可以打开', 'You can also use the launcher below')}</span>
      </div>
    </section>
    <div class="demo-orb demo-orb-one"></div><div class="demo-orb demo-orb-two"></div>
    <footer class="demo-footer"><span>GIORGIO IM</span><span>${t('为你和团队的沟通而设计', 'Made for you and your team')}</span></footer>
  </main>
`

function updateLinks() {
  document.querySelectorAll<HTMLAnchorElement>('[data-mode], [data-language], [data-framework]').forEach(link => {
    const url = new URL(location.href)
    if (link.dataset.framework) {
      url.pathname = '/react/'
      url.search = english ? '?lang=en' : ''
    } else if (link.dataset.mode) {
      if (link.dataset.mode !== (url.searchParams.get('mode') || 'chat')) url.searchParams.set('resetWindows', '1')
      url.searchParams.set('mode', link.dataset.mode)
    } else if (link.dataset.language === 'en') url.searchParams.set('lang', 'en')
    else url.searchParams.delete('lang')
    link.href = url.href
  })
}
updateLinks()

const aiQuestions: Record<string, string[]> = {}
const im = createIM({
  init,
  locale: english ? 'en' : 'zh-CN',
  customerService: customerService
    ? { id: 'support', type: 'friend', username: t('在线客服', 'Customer support'), sign: t('很高兴为你服务', 'Happy to help') } : undefined,
  enableLocalStorage: true,
  encryptionKey: 'giorgio-im',
  toolbar: [{
    id: 'quick-reply',
    label: t('快捷回复', 'Quick reply'),
    title: t('插入快捷回复（自定义工具栏示例）', 'Insert a quick reply (custom toolbar example)'),
    icon: 'm13 3-9 11h7l-1 7 10-12h-7l1-6Z',
    onClick({ insertText }) { insertText(t('收到，稍后回复你。', 'Got it. I’ll get back to you soon.')) },
  }],
  onUsername(username) {
    demoUser.username = username
  },
  onSign(sign) {
    demoUser.sign = sign
  },
  onAvatar(avatar) {
    demoUser.avatar = avatar
  },
  onSendMessage({ receiver, content }) {
    if (!content) return
    if (receiver.type === 'ai') {
      const questions = aiQuestions[String(receiver.id)] ||= []
      questions.push(content)
      const response = t(
        `你好，我是 **Giorgio AI**。${questions.length > 1 ? `这是我们的第 ${questions.length} 轮对话，上一个问题是「${questions.at(-2)}」。` : '很高兴和你开始对话！'}\n\n你刚才说：\n> ${content.replace(/\n/g, '\n> ')}\n\n### 这个演示支持\n- 流式输出，逐步展示回复\n- **Markdown**、列表和代码块\n- 独立会话与多轮对话\n\n使用方式：\n\n\`\`\`ts\nim.chat({ type: 'ai', id: 'assistant', username: 'AI 助手' })\n\`\`\`\n\n这是一条本地模拟回复。真实项目可在发送回调中请求自己的服务端。`,
        `Hi, I’m **Giorgio AI**. ${questions.length > 1 ? `This is turn ${questions.length}. Your previous question was “${questions.at(-2)}”.` : 'Great to meet you!'}\n\nYou said:\n> ${content.replace(/\n/g, '\n> ')}\n\n### This demo supports\n- Streaming replies\n- **Markdown**, lists and code blocks\n- Separate conversations and follow-up questions\n\nUsage:\n\n\`\`\`ts\nim.chat({ type: 'ai', id: 'assistant', username: 'AI assistant' })\n\`\`\`\n\nThis is a simulated local reply. In your app, call your own server from the send callback.`,
      )
      const mid = createUuid()
      let length = 0
      window.setTimeout(() => {
        const timer = window.setInterval(() => {
          length = Math.min(length + 10, response.length)
          im.getMessage({ ...receiver, type: 'ai', mid, content: response.slice(0, length), finished: length === response.length })
          if (length === response.length) window.clearInterval(timer)
        }, 40)
      }, 700)
      return
    }
    window.setTimeout(() => {
      im.getMessage({
        id: receiver.id,
        type: receiver.type,
        username: receiver.type === 'group' ? t('小鱼', 'Xiaoyu') : receiver.username,
        content: t(`收到「${content}」。这是演示自动回复，实际项目请在这里发送到你的服务端。`, `Received “${content}”. This is a demo reply. In your app, send messages to your server here.`),
      })
    }, 800)
  },
  loadHistory(receiver) {
    if (receiver.type === 'ai') return [{ ...receiver, type: 'ai', content: t('你好，我是 **Giorgio AI**。\n\n可以向我提问，体验流式回复和 Markdown 展示。*当前为本地模拟演示。*', 'Hi, I’m **Giorgio AI**.\n\nAsk me a question to try streaming replies and Markdown. *This is a local demo.*'), mid: `welcome:${receiver.id}` }]
    if (receiver.id !== 'xiaoyu') return []
    return [{ id: 'xiaoyu', type: 'friend', username: t('小鱼', 'Xiaoyu'), content: t('嗨！欢迎体验 Giorgio IM 👋', 'Hi! Welcome to Giorgio IM 👋'), timestamp: Date.now() - 120000 }]
  },
  loadGroupMembers(receiver) {
    return demoGroupMembers[String(receiver.id)] || []
  },
  createGroup({ groupname, members }) {
    const group = { id: createUuid(), groupname, members: members.length + 1 }
    demoGroupMembers[group.id] = [demoUser, ...members]
    return group
  },
  inviteGroupMembers(receiver, members) {
    demoGroupMembers[String(receiver.id)] = [...new Map([
      ...(demoGroupMembers[String(receiver.id)] || []), ...members,
    ].map(member => [String(member.id), member])).values()]
    return true
  },
  leaveGroup(receiver) {
    delete demoGroupMembers[String(receiver.id)]
    return true
  },
  removeGroupMember(receiver, member) {
    demoGroupMembers[String(receiver.id)] = (demoGroupMembers[String(receiver.id)] || []).filter(item => String(item.id) !== String(member.id))
    return true
  },
  dismissGroup(receiver) {
    delete demoGroupMembers[String(receiver.id)]
    return true
  },
  muteGroupMember(receiver, member, muted) {
    const target = demoGroupMembers[String(receiver.id)]?.find(item => String(item.id) === String(member.id))
    if (!target) return false
    target.muted = muted
    return true
  },
  findContacts(query) {
    const keyword = query.toLocaleLowerCase()
    return discoverable.filter(contact => `${contact.username} ${contact.id}`.toLocaleLowerCase().includes(keyword))
  },
  requestFriend() {
    return true
  },
  uploadAttachment(file) {
    return URL.createObjectURL(file)
  },
  notices: [
    { id: 'welcome', type: 'system', title: t('欢迎使用 Giorgio IM', 'Welcome to Giorgio IM'), content: t('在这里查看系统通知和好友申请。', 'View notifications and friend requests here.'), timestamp: Date.now() - 3600000 },
    { id: 'request-nana', type: 'friend-request', title: t('新的好友申请', 'New friend request'), content: t('娜娜想添加你为好友。', 'Nana wants to add you as a friend.'), contact: discoverable[0], timestamp: Date.now() - 600000 },
  ],
})

function openDemo(mode: string) {
  if (mode === 'chat') {
    im.open()
    im.chat({ id: 'xiaoyu', username: t('小鱼', 'Xiaoyu'), type: 'friend', status: 'online' })
  } else {
    im.chat({ id: 'ai-demo', username: 'Giorgio AI', type: 'ai' })
  }
}

document.querySelectorAll<HTMLAnchorElement>('[data-mode="chat"], [data-mode="ai"]').forEach(link => {
  link.addEventListener('click', event => {
    if (customerService || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const url = new URL(link.href)
    if (url.searchParams.has('resetWindows')) im.resetWindows()
    url.searchParams.delete('resetWindows')
    history.replaceState(null, '', url.href)
    updateLinks()
    openDemo(link.dataset.mode!)
  })
})

if (resetWindows) im.resetWindows()
if (mode === 'chat' || mode === 'ai') openDemo(mode)

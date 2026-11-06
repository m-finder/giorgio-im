<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ensureStyles } from './style'
import { createLocalBackup, type LocalBackup } from './storage'
import { useVoiceRecorder } from './voice'
import { useMessageSound } from './notifications'
import { createUuid } from './uuid'
import { LocaleError, useImLocale } from './i18n'
import type { ImLocaleKey } from './locales'
import defaultAvatar from './assets/default-avatar.png'
import aiAvatar from './assets/ai-avatar.svg'
import MarkdownIt from 'markdown-it'
import type { ImAttachment, ImCallType, ImChatNotice, ImChatType, ImContact, ImFriendGroup, ImGroupMember, ImId, ImInit, ImMessage, ImNotice, ImOptions, ImReadPayload, ImReadReceipt, ImSendPayload, ImToolbarItem, ImToolbarState, ImTypingPayload, ImTypingState } from './types'

type ChatContact = ImContact & { type: ImChatType }
type GroupContact = ImContact & { type: 'group' }
type ViewMessage = ImMessage & { timestamp: number; mine: boolean; pending?: boolean; errorKey?: ImLocaleKey }
type Utility = 'call-info' | 'delete-friend' | 'block-friend' | 'blocklist' | 'add' | 'settings' | 'inbox' | 'history' | 'members' | 'friend-group' | 'accept-friend' | 'create-group' | 'invite' | 'leave-group' | 'remove-member' | 'dismiss-group' | 'rename-group'

const props = withDefaults(defineProps<{
  init: ImInit
  locale?: ImOptions['locale']
  locales?: ImOptions['locales']
  customerService?: ImOptions['customerService']
  loadHistory?: (receiver: ChatContact) => Promise<ImMessage[]> | ImMessage[]
  loadGroupMembers?: ImOptions['loadGroupMembers']
  findContacts?: (query: string) => Promise<ImContact[]> | ImContact[]
  requestFriend?: (contact: ImContact) => Promise<boolean | void> | boolean | void
  deleteFriend?: ImOptions['deleteFriend']
  blockFriend?: ImOptions['blockFriend']
  unblockFriend?: ImOptions['unblockFriend']
  acceptFriend?: ImOptions['acceptFriend']
  createFriendGroup?: ImOptions['createFriendGroup']
  moveFriend?: ImOptions['moveFriend']
  createGroup?: ImOptions['createGroup']
  leaveGroup?: ImOptions['leaveGroup']
  inviteGroupMembers?: ImOptions['inviteGroupMembers']
  removeGroupMember?: ImOptions['removeGroupMember']
  dismissGroup?: ImOptions['dismissGroup']
  muteGroupMember?: ImOptions['muteGroupMember']
  muteGroup?: ImOptions['muteGroup']
  setGroupAdmin?: ImOptions['setGroupAdmin']
  renameGroup?: ImOptions['renameGroup']
  uploadGroupAvatar?: ImOptions['uploadGroupAvatar']
  uploadAttachment?: (file: File, receiver: ChatContact) => Promise<string> | string
  uploadVoice?: ImOptions['uploadVoice']
  onCall?: ImOptions['onCall']
  toolbar?: ImToolbarItem[]
  uploadAvatar?: ImOptions['uploadAvatar']
  notices?: ImNotice[]
  messageNotification?: ImOptions['messageNotification']
  messageSound?: ImOptions['messageSound']
  chatNotices?: ImOptions['chatNotices']
  chatTimeout?: number
  enableLocalStorage?: boolean
  encryptionKey?: string
}>(), { messageNotification: true, messageSound: true })

const { locale, t, setLocale, errorText, timeFormatter } = useImLocale(props)

const emit = defineEmits<{
  sendMessage: [payload: ImSendPayload]
  read: [payload: ImReadPayload]
  typing: [payload: ImTypingPayload]
  online: [status: 'online' | 'hide']
  sign: [sign: string]
  username: [username: string]
  avatar: [avatar: string]
  storageError: [error: Error]
  chatChange: [receiver: ChatContact]
  friendAdded: [contact: ImContact, groupId?: ImId]
  noticeAction: [notice: ImNotice, action: 'accept' | 'reject' | 'read', groupId?: ImId]
  friendGroupAdded: [group: ImFriendGroup]
  friendRemoved: [contact: ImContact]
  friendBlocked: [contact: ImContact]
  friendUnblocked: [contact: ImContact]
  friendMoved: [contact: ImContact, groupId: ImId]
  groupCreated: [group: ImContact]
  groupLeft: [group: ImContact]
  groupMembersInvited: [group: ImContact, members: ImContact[]]
  groupMemberRemoved: [group: ImContact, member: ImGroupMember]
  groupDismissed: [group: ImContact]
  groupMemberMuted: [group: ImContact, member: ImGroupMember, muted: boolean]
  groupMuted: [group: ImContact, muted: boolean]
  groupRenamed: [group: ImContact]
  groupAvatarChanged: [group: ImContact]
  groupAdminChanged: [group: ImContact, member: ImGroupMember, admin: boolean]
}>()

const panelOpen = ref(false)
const chatOpen = ref(false)
const pageVisible = ref(typeof document === 'undefined' || document.visibilityState !== 'hidden')
const playMessageSound = useMessageSound(() => props.messageSound)
const messageAlert = ref<HTMLButtonElement | null>(null)
const messageAlertVersion = ref(0)
let messageAlertAnimation: Animation | undefined
const tab = ref<'friend' | 'group' | 'history'>('friend')
const search = ref('')
const searchOpen = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const collapsedGroups = ref<Set<string>>(new Set())
const draggedFriend = ref<ImContact | null>(null)
const friendDropTarget = ref<ImId | null>(null)
const friendMoveBusy = ref(false)
const friendMoveError = ref<string | Error>('')
const friendDragClick = ref(false)
const friendActionsId = ref<string | null>(null)
const friendSwipe = ref<{ id: string; offset: number } | null>(null)
const blockedUsers = ref<ImContact[]>((props.init.blocked || []).map(contact => ({ ...contact })))
const draft = ref('')
const pendingImages = ref<{ file: File; url: string }[]>([])
const imageSending = ref(false)
const sign = ref(props.init.user.sign || '')
const savedSign = ref(sign.value)
const username = ref(props.init.user.username)
const usernameDraft = ref(username.value)
const userAvatar = ref(props.init.user.avatar)
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarBusy = ref(false)
const avatarError = ref<string | Error>('')
let avatarRequest = 0
const online = ref<'online' | 'hide'>(props.init.user.status || 'online')
const currentUser = computed(() => ({ ...props.init.user, username: username.value, sign: savedSign.value, avatar: userAvatar.value, status: online.value }))
const activeKey = ref<string | null>(null)
const openKeys = ref<string[]>([])
const recentKeys = ref<string[]>([])
const conversations = reactive<Record<string, ChatContact>>({})
const messages = reactive<Record<string, ViewMessage[]>>({})
const aiPending = reactive<Record<string, ViewMessage>>({})
const aiTimers = new Map<string, ReturnType<typeof setTimeout>>()
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true })
const unread = reactive<Record<string, number>>({})
const friendStatus = reactive<Record<string, 'online' | 'offline'>>({})
const chatStatus = reactive<Record<string, string>>({})
const readReceipts = reactive<Record<string, Record<string, ImId[]>>>({})
const readNotified = new Map<string, Set<string>>()
const typingStates = reactive<Record<string, Record<string, ImTypingState>>>({})
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
let localTyping: ImTypingPayload | undefined
let typingIdleTimer: ReturnType<typeof setTimeout> | undefined
let lastTypingSentAt = -Infinity
const historyError = reactive<Record<string, boolean>>({})
const loadedHistory = new Set<string>()
const messageList = ref<HTMLElement | null>(null)
const panelElement = ref<HTMLElement | null>(null)
const chatElement = ref<HTMLElement | null>(null)
const panelPosition = ref<{ left: number; top: number } | null>(null)
const chatPosition = ref<{ left: number; top: number } | null>(null)
const frontWindow = ref<'panel' | 'chat'>('chat')
const utility = ref<Utility | null>(null)
const managementBusy = ref(false)
const managementError = ref<string | Error>('')
const newFriendGroupName = ref('')
const creatingFriendGroup = ref(false)
const selectedGroupId = ref<ImId | null>(null)
const managedFriend = ref<ImContact | null>(null)
const pendingNotice = ref<ImNotice | null>(null)
const managedGroup = ref<GroupContact | null>(null)
const managedMember = ref<ImGroupMember | null>(null)
const newGroupName = ref('')
const groupAvatarInput = ref<HTMLInputElement | null>(null)
const memberQuery = ref('')
const selectedMemberIds = ref<string[]>([])
const groupMembers = reactive<Record<string, ImGroupMember[]>>({})
const groupMuteStates = reactive<Record<string, boolean>>({})
const groupMemberMuteStates = reactive<Record<string, Record<string, boolean>>>({})
const groupMembersBusy = reactive<Record<string, boolean>>({})
const groupMembersError = reactive<Record<string, boolean>>({})
const findQuery = ref('')
const findResults = ref<ImContact[]>([])
const findBusy = ref(false)
const findError = ref<string | Error>('')
const addBusy = ref<string | null>(null)
const requestedIds = ref<Set<string>>(new Set())
const notices = ref<ImNotice[]>((props.notices || []).map(notice => ({ ...notice })))
const theme = ref<'light' | 'dark'>('light')
const sendKey = ref<'enter' | 'ctrl-enter'>('enter')
const emojiOpen = ref(false)
const toolbarError = ref<string | Error>('')
const toolbarOverrides = ref<ImToolbarItem[] | null>(null)
const toolbarBusy = reactive(new Set<string>())
let toolbarSession = 0
const callBusy = ref(false)
const voiceSending = ref(false)
const { state: voiceState, duration: voiceDuration, preview: voicePreview, file: voiceFile, error: voiceError,
  start: startVoice, stop: stopVoice, cancel: cancelVoice } = useVoiceRecorder()
const imageInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const emojis = [
  '😀', '😄', '😂', '😍', '🥰', '👍', '👏', '🎉',
  '❤️', '👋', '🤔', '😎', '😭', '🙏', '🔥', '✨',
  '😃', '😁', '😆', '😅', '🤣', '😊', '😇', '🙂',
  '🙃', '😉', '😌', '😘', '😋', '😛', '😜', '🤪',
  '🤗', '🤭', '🫢', '🫣', '🤫', '🫡', '🤐', '🤨',
  '😐', '😑', '😶', '😏', '🙄', '😬', '😮', '😲',
  '😳', '🥺', '🥹', '😢', '😤', '😠', '🤯', '😱',
  '😰', '😓', '😥', '😴', '🥱', '🤤', '🤒', '🤧',
  '🥳', '🤩', '🤓', '🧐', '🤖', '👻', '😺', '😸',
  '👌', '🤌', '✌️', '🤞', '🤟', '🤙', '💪', '🙌',
  '🤝', '🫶', '👊', '✊', '🤜', '🤛', '👀', '🧠',
  '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎',
  '💔', '💕', '💞', '💓', '💖', '💝', '💯', '💬',
  '🎊', '🎈', '🎁', '🎂', '🏆', '🥇', '⭐', '🌟',
  '🌈', '☀️', '🌙', '🌸', '🌹', '🍀', '🐱', '🐶',
  '🍎', '🍉', '🍓', '🍕', '🍔', '🍰', '☕', '🚀',
]
let stopDrag: (() => void) | null = null
let stopFriendDrag: (() => void) | null = null
let localBackup: ReturnType<typeof createLocalBackup> | undefined
const backupUserId = props.init.user.id
let backupMounted = false
let disposed = false

const keyOf = (type: ImChatType, id: ImId) => `${type}:${id}`
const contactSnapshot = ref<Pick<ImInit, 'friend' | 'group' | 'blocked' | 'recent'> | null>(null)
const friends = computed(() => friendGroups.value.flatMap(group => group.list.map(contact => ({ ...contact, type: contact.type === 'ai' ? 'ai' as const : 'friend' as const }))))
const addedGroups = ref<ImContact[]>([])
const removedFriendIds = ref<Set<string>>(new Set())
const removedGroupIds = ref<Set<string>>(new Set())
const groupMemberCounts = reactive<Record<string, number>>({})
const groupProfiles = reactive<Record<string, { groupname?: string; avatar?: string; adminIds?: ImId[] }>>({})
const groups = computed(() => [...new Map([...(contactSnapshot.value?.group ?? props.init.group ?? []), ...addedGroups.value].map(contact => [String(contact.id), contact])).values()]
  .filter(contact => !removedGroupIds.value.has(String(contact.id)))
  .map(contact => ({ ...contact, ...groupProfiles[String(contact.id)], members: groupMemberCounts[String(contact.id)] ?? contact.members, type: 'group' as const })))
const active = computed(() => activeKey.value ? conversations[activeKey.value] : null)
const composerRestriction = computed(() => active.value ? messageRestriction(active.value) : '')
const toolbarState = computed<ImToolbarState | null>(() => active.value ? {
  user: { ...currentUser.value }, receiver: { ...active.value }, draft: draft.value, restriction: composerRestriction.value,
} : null)
const toolbarItems = computed(() => {
  const state = toolbarState.value
  if (!state) return []
  const defaults: ImToolbarItem[] = [
    { id: 'emoji', label: t('emoji'), order: 10, icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 14c1 2 2.3 3 4 3s3-1 4-3M8.5 9.5h.01m7 0h.01' },
    { id: 'image', label: t('image'), title: t('sendImage'), order: 20, icon: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM10 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM4 17l5-5 4 4 3-3 4 4' },
    { id: 'file', label: t('file'), title: t('sendFile'), order: 30, icon: 'M8 3h6l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2ZM14 3v5h5M8 13h8m-8 4h6' },
    { id: 'voice', label: t('voiceMessage'), order: 40, visible: state.receiver.type !== 'ai', icon: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8' },
    { id: 'voice-call', label: t('voiceCall'), order: 50, visible: state.receiver.type !== 'ai', icon: 'M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z' },
    { id: 'video-call', label: t('videoCall'), order: 60, visible: state.receiver.type !== 'ai', icon: 'M4 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM16 9l6-3v12l-6-3' },
    { id: 'history', label: t('chatHistory'), align: 'right', order: 1000, icon: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 7v5l3 2' },
  ]
  const items = new Map(defaults.map(item => [item.id, item]))
  for (const item of toolbarOverrides.value ?? props.toolbar ?? []) items.set(item.id, { ...items.get(item.id), ...item })
  return [...items.values()]
    .filter(item => typeof item.visible === 'function' ? item.visible(state) : item.visible !== false)
    .map(item => ({ ...item, label: item.label || item.id, align: item.align || 'left', order: item.order ?? 100,
      disabled: (item.id !== 'history' && !!state.restriction) || toolbarBusy.has(`${activeKey.value}:${item.id}`)
        || (item.id !== 'history' && voiceState.value !== 'idle')
        || (['voice-call', 'video-call'].includes(item.id) && callBusy.value)
        || (typeof item.disabled === 'function' ? item.disabled(state) : !!item.disabled),
    }))
    .sort((a, b) => Number(a.align === 'right') - Number(b.align === 'right') || a.order - b.order)
})
const activeMessages = computed(() => activeKey.value ? messages[activeKey.value] || [] : [])
const typingLabel = computed(() => {
  const states = Object.values(typingStates[activeKey.value || ''] || {})
  if (!states.length) return ''
  return active.value?.type === 'group'
    ? t('membersTyping', { name: states.map(state => state.username || t('unnamedConversation')).join(', ') })
    : t('peerTyping')
})
const totalUnread = computed(() => props.customerService ? unread[keyOf(props.customerService.type, props.customerService.id)] || 0 : Object.values(unread).reduce((sum, count) => sum + count, 0))
const unreadContacts = computed(() => recentKeys.value
  .filter(key => unread[key] > 0 && conversations[key] && !isConversationOpen(key))
  .map(key => conversations[key]))
const notificationUnread = computed(() => unreadContacts.value.reduce((sum, contact) => sum + unread[keyOf(contact.type, contact.id)], 0))
const unreadNotices = computed(() => notices.value.filter(notice => !notice.read).length)
const addedFriends = ref<{ contact: ImContact; groupId?: ImId }[]>([])
const addedFriendGroups = ref<ImFriendGroup[]>([])
const friendGroupAssignments = reactive<Record<string, ImId>>({})
const friendGroups = computed<ImFriendGroup[]>(() => {
  const initial = contactSnapshot.value?.friend ?? props.init.friend ?? []
  const source = [
    ...initial.map(group => addedFriendGroups.value.find(item => String(item.id) === String(group.id)) || group),
    ...addedFriendGroups.value.filter(group => !initial.some(item => String(item.id) === String(group.id))),
  ]
  const groups: ImFriendGroup[] = source.map(group => ({ ...group, list: [] }))
  const seen = new Set<string>()
  for (const item of [...source.flatMap(group => group.list.map(contact => ({ contact, groupId: group.id }))), ...addedFriends.value]) {
    if (seen.has(String(item.contact.id)) || isBlocked(item.contact.id) || removedFriendIds.value.has(String(item.contact.id))) continue
    seen.add(String(item.contact.id))
    const groupId = friendGroupAssignments[String(item.contact.id)] ?? item.groupId ?? source[0]?.id
    let group = groups.find(group => String(group.id) === String(groupId))
    if (!group) {
      group = groups.find(group => group.id === 'new')
      if (!group) { group = { id: 'new', groupname: t('newFriends'), list: [] }; groups.push(group) }
    }
    group.list.push(item.contact)
  }
  return groups
})
const utilityTitle = computed(() => utility.value ? {
  add: t('addFriend'), settings: t('settings'), inbox: t('inbox'), history: t('chatHistory'), members: t('groupMembers'),
  'friend-group': t('newCategory'), 'accept-friend': t('chooseFriendCategory'),
  'create-group': t('createGroup'), invite: t('inviteToGroup'), 'leave-group': t('leaveGroup'),
  'remove-member': t('removeGroupMember'), 'dismiss-group': t('dismissGroup'),
  'call-info': t('callIntegrationTitle'), 'rename-group': t('renameGroup'), 'delete-friend': t('deleteFriend'), 'block-friend': t('blockFriend'), blocklist: t('blocklist'),
}[utility.value] : '')
const selectableFriends = computed(() => friends.value.filter(contact => contact.type !== 'ai' && String(contact.id) !== String(props.init.user.id)
  && `${displayName(contact)} ${contact.sign || ''}`.toLocaleLowerCase().includes(memberQuery.value.trim().toLocaleLowerCase())))
const existingMemberIds = computed(() => new Set([
  String(props.init.user.id),
  ...(managedGroup.value ? groupMembers[keyOf('group', managedGroup.value.id)] || [] : []).map(member => String(member.id)),
]))
const managedGroupKey = computed(() => managedGroup.value ? keyOf('group', managedGroup.value.id) : '')
const query = computed(() => search.value.trim().toLocaleLowerCase())
const visibleGroups = computed(() => friendGroups.value.map(group => ({
  ...group,
  list: group.list.filter(contact => !query.value || `${contact.username || ''} ${contact.sign || ''}`.toLocaleLowerCase().includes(query.value)),
})).filter(group => group.list.length || !query.value))
const visibleChats = computed(() => (tab.value === 'group' ? groups.value : friends.value)
  .filter(contact => !query.value || `${contact.username || contact.groupname || ''} ${contact.sign || ''}`.toLocaleLowerCase().includes(query.value)))
const visibleRecent = computed(() => recentKeys.value
  .filter(key => conversations[key] && (!query.value || displayName(conversations[key]).toLocaleLowerCase().includes(query.value))))

watch(() => props.init.blocked, value => setBlockedUsers(value || []), { deep: true })
watch(() => props.init.user.sign, value => { sign.value = savedSign.value = value || '' })
watch(() => [props.init.friend, props.init.group], () => { contactSnapshot.value = null }, { deep: true })
watch(() => props.init.user.username, value => { username.value = usernameDraft.value = value })
watch(() => props.init.user.avatar, value => {
  avatarRequest++
  avatarBusy.value = false
  avatarError.value = ''
  userAvatar.value = value
})
watch(() => props.notices, value => {
  for (const notice of value || []) if (!notices.value.some(item => String(item.id) === String(notice.id))) notices.value.push({ ...notice })
}, { deep: true })
watch(activeMessages, () => scrollToBottom(), { deep: true })
watch([activeKey, chatOpen, pageVisible, activeMessages], markViewedMessages, { deep: true, flush: 'post' })
watch(draft, value => { if (!value.trim()) stopTyping() })
watch([activeKey, chatOpen, pageVisible, composerRestriction], stopTyping, { flush: 'sync' })
watch(activeKey, () => {
  clearPendingImages()
  if (!managementBusy.value && ['members', 'invite', 'leave-group', 'remove-member', 'dismiss-group', 'rename-group'].includes(utility.value || '')) utility.value = null
})
watch(() => props.toolbar, () => { toolbarOverrides.value = null }, { deep: true, flush: 'sync' })
watch([activeKey, toolbarOverrides, () => props.toolbar], () => {
  toolbarSession++
  emojiOpen.value = false
  toolbarError.value = ''
}, { deep: true, flush: 'sync' })
watch([activeKey, chatOpen, composerRestriction], () => { cancelVoice(); voiceSending.value = false }, { flush: 'sync' })
watch(voiceError, value => { if (value) toolbarError.value = value })
watch(messageAlertVersion, () => {
  messageAlertAnimation?.cancel()
  messageAlertAnimation = undefined
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  messageAlertAnimation = messageAlert.value?.animate?.([
    { transform: 'none' },
    { transform: 'translateX(-4px) rotate(-1deg)' },
    { transform: 'translateX(4px) rotate(1deg)' },
    { transform: 'translateX(-4px) rotate(-1deg)' },
    { transform: 'translateX(3px) rotate(1deg)' },
    { transform: 'translateX(-2px)' },
    { transform: 'none' },
  ], { duration: 480, easing: 'ease-in-out' })
}, { flush: 'post' })
watch(() => props.enableLocalStorage ? backupSnapshot() : null, saveBackup, { deep: true })
watch(() => [props.enableLocalStorage, props.encryptionKey, props.init.user.id], () => {
  if (backupMounted) configureBackup(false)
})
onMounted(() => {
  ensureStyles()
  backupMounted = true
  configureBackup(true)
  for (const contact of props.init.recent || []) {
    const key = ensureConversation(contact)
    if (!recentKeys.value.includes(key)) remember(key)
    if (contact.type === 'friend' && !friends.value.some(friend => String(friend.id) === String(contact.id))) removedFriendIds.value.add(String(contact.id))
  }
  window.addEventListener('pagehide', saveBackup)
  document.addEventListener('visibilitychange', updatePageVisibility)
  try {
    const saved = JSON.parse(localStorage.getItem(`giorgio-im-settings:${props.init.user.id}`) || '{}')
    if (saved.theme === 'dark') theme.value = 'dark'
    if (saved.sendKey === 'ctrl-enter') sendKey.value = 'ctrl-enter'
  } catch { /* Storage may be unavailable. */ }
})
onUnmounted(() => {
  clearPendingImages()
  stopTyping()
  disposed = true
  messageAlertAnimation?.cancel()
  avatarRequest++
  saveBackup()
  window.removeEventListener('pagehide', saveBackup)
  document.removeEventListener('visibilitychange', updatePageVisibility)
  stopDrag?.()
  stopFriendDrag?.()
  for (const timer of aiTimers.values()) clearTimeout(timer)
  for (const timer of typingTimers.values()) clearTimeout(timer)
})

function backupSnapshot(): LocalBackup {
  return {
    version: 1, user: currentUser.value,
    friend: friendGroups.value, group: groups.value,
    removedGroupIds: [...removedGroupIds.value],
    removedFriendIds: [...removedFriendIds.value], blocked: blockedUsers.value,
    conversations, messages, unread, friendStatus, notices: notices.value,
    openKeys: openKeys.value, recentKeys: recentKeys.value, activeKey: activeKey.value,
    panelOpen: panelOpen.value, chatOpen: chatOpen.value, draft: draft.value,
    loadedHistory: [...loadedHistory],
  }
}

function saveBackup(): void {
  if (props.enableLocalStorage && String(props.init.user.id) === String(backupUserId)) localBackup?.write(backupSnapshot())
}

function configureBackup(restore: boolean): void {
  localBackup = undefined
  if (!props.enableLocalStorage || String(props.init.user.id) !== String(backupUserId)) return
  localBackup = createLocalBackup(backupUserId, props.encryptionKey ?? 'giorgio-im', error => emit('storageError', error),
    props.customerService ? `service:${props.customerService.type}:${props.customerService.id}` : undefined)
  const backup = localBackup.read()
  if (restore && backup) {
    username.value = usernameDraft.value = backup.user.username
    sign.value = savedSign.value = backup.user.sign || ''
    userAvatar.value = backup.user.avatar
    online.value = backup.user.status === 'hide' ? 'hide' : 'online'
    addedFriendGroups.value = backup.friend
    addedGroups.value = backup.group
    removedGroupIds.value = new Set(backup.removedGroupIds)
    removedFriendIds.value = new Set(backup.removedFriendIds || [])
    blockedUsers.value = (backup.blocked || props.init.blocked || []).map(contact => ({ ...contact }))
    Object.assign(conversations, backup.conversations)
    if (props.customerService) {
      const serviceKey = keyOf(props.customerService.type, props.customerService.id)
      for (const key of Object.keys(conversations)) if (key !== serviceKey) delete conversations[key]
    }
    for (const [key, items] of Object.entries(backup.messages)) {
      if (!conversations[key]) continue
      messages[key] = items.map(message => message.pending
        ? { ...message, pending: false, finished: true, error: undefined, errorKey: 'aiInterrupted' as const }
        : message)
    }
    for (const key of Object.keys(conversations)) messages[key] ||= []
    for (const [key, count] of Object.entries(backup.unread)) if (conversations[key]) unread[key] = count
    Object.assign(friendStatus, backup.friendStatus)
    notices.value = [...new Map([...notices.value, ...backup.notices].map(notice => [String(notice.id), notice])).values()]
    openKeys.value = backup.openKeys.filter(key => Object.hasOwn(conversations, key))
    recentKeys.value = backup.recentKeys.filter(key => Object.hasOwn(conversations, key))
    activeKey.value = backup.activeKey && openKeys.value.includes(backup.activeKey) ? backup.activeKey : null
    panelOpen.value = !props.customerService && backup.panelOpen
    chatOpen.value = backup.chatOpen && activeKey.value !== null
    draft.value = props.customerService && activeKey.value !== backup.activeKey ? '' : backup.draft
    for (const key of backup.loadedHistory) if (Object.hasOwn(conversations, key)) loadedHistory.add(key)
    scrollToBottom()
  }
  saveBackup()
}

function displayName(contact: { username?: string; groupname?: string }): string {
  return contact.username || contact.groupname || t('unnamedConversation')
}

function avatarLetter(contact: { username?: string; groupname?: string }): string {
  return [...displayName(contact)][0] || '?'
}

function isOffline(contact: ImContact): boolean {
  return contact.type !== 'group' && contact.type !== 'ai' && (friendStatus[String(contact.id)]
    ?? friends.value.find(friend => String(friend.id) === String(contact.id))?.status
    ?? contact.status) === 'offline'
}

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) void nextTick(() => searchInput.value?.focus())
  else search.value = ''
}

function toggleGroup(id: ImId): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(String(id))) next.delete(String(id))
  else next.add(String(id))
  collapsedGroups.value = next
}

function scrollToBottom(): void {
  nextTick(() => {
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
  })
}

function normalise(message: ImMessage): ViewMessage {
  const mine = message.mine ?? (message.fromid !== undefined && String(message.fromid) === String(props.init.user.id))
  return {
    ...message,
    timestamp: message.timestamp || Date.now(),
    mine,
    readBy: [...new Map([...(message.readBy || []), ...(readReceipts[keyOf(message.type, message.id)]?.[String(message.mid)] || [])]
      .filter(id => String(id) !== String(mine ? props.init.user.id : message.fromid)).map(id => [String(id), id])).values()],
  }
}

function remember(key: string): void {
  recentKeys.value = [key, ...recentKeys.value.filter(item => item !== key)]
}

function ensureConversation(contact: ChatContact): string {
  const key = keyOf(contact.type, contact.id)
  conversations[key] = { ...conversations[key], ...(contact.type === 'group' ? groupInfo({ ...contact, type: 'group' }) : contact) }
  messages[key] ||= []
  return key
}

async function fetchHistory(key: string, receiver: ChatContact): Promise<void> {
  if (!props.loadHistory || loadedHistory.has(key)) return
  const currentMessages = messages[key]
  loadedHistory.add(key)
  try {
    const history = await props.loadHistory(receiver)
    if (disposed || messages[key] !== currentMessages) return
    for (const message of history) {
      if (message.mid === undefined || message.type === 'ai') continue
      for (const readerId of message.readBy || []) setMessageRead({ id: message.id, type: message.type, mids: [message.mid], readerId })
    }
    const existingIds = new Set(messages[key].filter(item => item.mid !== undefined).map(item => String(item.mid)))
    messages[key] = [
      ...history.filter(item => item.mid === undefined || !existingIds.has(String(item.mid))).map(normalise),
      ...messages[key],
    ]
    historyError[key] = false
    scrollToBottom()
  } catch {
    if (disposed || messages[key] !== currentMessages) return
    historyError[key] = true
    loadedHistory.delete(key)
  }
}

function chat(contact: ChatContact): void {
  if (props.customerService && keyOf(contact.type, contact.id) !== keyOf(props.customerService.type, props.customerService.id)) return
  if (contact.type === 'group' && removedGroupIds.value.has(String(contact.id))) return
  if (contact.type !== 'group' && removedFriendIds.value.has(String(contact.id)) && !conversations[keyOf(contact.type, contact.id)]) return
  const key = ensureConversation(contact)
  if (!openKeys.value.includes(key)) {
    const oldWidth = chatElement.value?.getBoundingClientRect().width
    openKeys.value.push(key)
    adjustDraggedChatWidth(oldWidth)
  }
  activeKey.value = key
  chatOpen.value = true
  frontWindow.value = 'chat'
  if (pageVisible.value) unread[key] = 0
  remember(key)
  emit('chatChange', conversations[key])
  void fetchHistory(key, conversations[key])
  scrollToBottom()
}

function updatePageVisibility(): void {
  pageVisible.value = document.visibilityState !== 'hidden'
  if (pageVisible.value && chatOpen.value && activeKey.value) unread[activeKey.value] = 0
}

function isConversationVisible(key: string): boolean {
  return pageVisible.value && chatOpen.value && activeKey.value === key
}
function isConversationOpen(key: string): boolean {
  return pageVisible.value && chatOpen.value && openKeys.value.includes(key)
}
function markUnread(key: string): void {
  if (isConversationVisible(key)) return
  unread[key] = (unread[key] || 0) + 1
  if (!isConversationOpen(key)) messageAlertVersion.value++
}

function openUnreadMessages(): void {
  const pending = unreadContacts.value
  if (!pending.length) return
  const oldWidth = chatElement.value?.getBoundingClientRect().width
  for (const contact of [...pending].reverse()) {
    const key = keyOf(contact.type, contact.id)
    if (!openKeys.value.includes(key)) openKeys.value.push(key)
  }
  chat(pending[0])
  adjustDraggedChatWidth(oldWidth)
}

function open(): void {
  if (props.customerService) { chat(props.customerService); return }
  panelOpen.value = true
  frontWindow.value = 'panel'
}

function close(): void {
  panelOpen.value = false
  chatOpen.value = false
  utility.value = null
}

function resetWindows(): void {
  close()
  stopDrag?.()
  stopFriendDrag?.()
  panelPosition.value = chatPosition.value = null
  openKeys.value = []
  activeKey.value = null
  draft.value = ''
  tab.value = 'friend'
  search.value = ''
  searchOpen.value = false
  collapsedGroups.value = new Set()
  emojiOpen.value = false
  frontWindow.value = 'chat'
  for (const contact of Object.values(conversations)) contact.maximized = false
  saveBackup()
}

function windowStyle(which: 'panel' | 'chat'): Record<string, string | number> {
  const position = which === 'panel' ? panelPosition.value : chatPosition.value
  return {
    zIndex: frontWindow.value === which ? 10002 : 10001,
    ...(position ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto', transform: 'none' } : {}),
  }
}

function adjustDraggedChatWidth(oldWidth?: number): void {
  if (!chatPosition.value || !oldWidth) return
  void nextTick(() => {
    const newWidth = chatElement.value?.getBoundingClientRect().width
    if (newWidth && chatPosition.value) chatPosition.value = {
      ...chatPosition.value,
      left: Math.max(0, Math.min(window.innerWidth - newWidth, chatPosition.value.left + oldWidth - newWidth)),
    }
  })
}

function startDrag(event: PointerEvent, which: 'panel' | 'chat'): void {
  if (which === 'chat' && active.value?.type === 'ai' && active.value.maximized) return
  if (event.button !== 0 || window.innerWidth <= 540 || (event.target as HTMLElement).closest('button, input, select, textarea')) return
  const element = which === 'panel' ? panelElement.value : chatElement.value
  if (!element) return
  event.preventDefault()
  frontWindow.value = which
  stopDrag?.()
  const bounds = element.getBoundingClientRect()
  const originX = event.clientX
  const originY = event.clientY
  const move = (next: PointerEvent) => {
    const position = {
      left: Math.max(0, Math.min(window.innerWidth - bounds.width, bounds.left + next.clientX - originX)),
      top: Math.max(0, Math.min(window.innerHeight - bounds.height, bounds.top + next.clientY - originY)),
    }
    if (which === 'panel') panelPosition.value = position
    else chatPosition.value = position
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    stopDrag = null
  }
  stopDrag = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

function addContacts(contact: ChatContact, groupId?: ImId): void {
  if (contact.type === 'group') {
    removedGroupIds.value.delete(String(contact.id))
    if (!groups.value.some(item => String(item.id) === String(contact.id))) addedGroups.value.push(contact)
  } else {
    if (isBlocked(contact.id)) return
    removedFriendIds.value.delete(String(contact.id))
    if (!friends.value.some(item => String(item.id) === String(contact.id))) addedFriends.value.push({ contact, groupId })
  }
}

function addFriendGroup(group: ImFriendGroup): void {
  const index = addedFriendGroups.value.findIndex(item => String(item.id) === String(group.id))
  if (index === -1) addedFriendGroups.value.push({ ...group, list: [...group.list] })
  else addedFriendGroups.value[index] = { ...group, list: [...group.list] }
}

function setUser(user: Partial<Omit<import('./types').ImUser, 'id'>>): void {
  if (user.username !== undefined) username.value = usernameDraft.value = user.username
  if (user.sign !== undefined) sign.value = savedSign.value = user.sign
  if (user.avatar !== undefined) { avatarRequest++; userAvatar.value = user.avatar; avatarBusy.value = false }
  if (user.status !== undefined) online.value = user.status
}

function setContacts(contacts: Pick<ImInit, 'friend' | 'group' | 'blocked' | 'recent'>): void {
  if (contacts.blocked !== undefined) setBlockedUsers(contacts.blocked)
  const friend = contacts.friend ?? []
  const group = contacts.group ?? []
  const friendIds = new Set(friend.flatMap(category => category.list.map(contact => String(contact.id))))
  const groupIds = new Set(group.map(contact => String(contact.id)))
  for (const contact of friends.value) if (!friendIds.has(String(contact.id))) removeFriend(contact.id)
  for (const contact of groups.value) if (!groupIds.has(String(contact.id))) removeGroup(contact.id)
  contactSnapshot.value = { friend: friend.map(category => ({ ...category, list: category.list.map(contact => ({ ...contact })) })), group: group.map(contact => ({ ...contact })) }
  addedFriendGroups.value = []
  addedFriends.value = []
  addedGroups.value = []
  removedFriendIds.value = new Set(Object.values(conversations).filter(contact => contact.type !== 'group' && !friendIds.has(String(contact.id))).map(contact => String(contact.id)))
  removedGroupIds.value = new Set()
  for (const id of Object.keys(friendGroupAssignments)) delete friendGroupAssignments[id]
  for (const id of Object.keys(friendStatus)) delete friendStatus[id]
  for (const id of Object.keys(groupProfiles)) delete groupProfiles[id]
  for (const category of friend) for (const contact of category.list) updateContact({ ...contact, type: contact.type === 'ai' ? 'ai' : 'friend' }, category.id)
  for (const contact of group) updateContact({ ...contact, type: 'group' })
  for (const contact of contacts.recent || []) {
    const key = ensureConversation(contact)
    if (!recentKeys.value.includes(key)) remember(key)
    if (contact.type !== 'group' && !friendIds.has(String(contact.id))) removedFriendIds.value.add(String(contact.id))
  }
  loadedHistory.clear()
  for (const key of openKeys.value) if (conversations[key]) void fetchHistory(key, conversations[key])
}

function updateContact(contact: ChatContact, groupId?: ImId): void {
  if (contact.type !== 'group' && isBlocked(contact.id)) return
  addContacts(contact, groupId)
  if (contact.type === 'group') {
    addedGroups.value = addedGroups.value.map(item => String(item.id) === String(contact.id) ? { ...item, ...contact } : item)
    applyGroupProfile(contact as GroupContact, contact)
    if (contact.members !== undefined) updateMemberCount(contact.id, contact.members)
    if (contact.muteAll !== undefined) setGroupMute(contact.id, contact.muteAll)
  } else {
    for (const group of friendGroups.value) {
      if (group.list.some(item => String(item.id) === String(contact.id))) addFriendGroup({ ...group, list: group.list.map(item => String(item.id) === String(contact.id) ? { ...item, ...contact } : item) })
    }
    addedFriends.value = addedFriends.value.map(item => String(item.contact.id) === String(contact.id) ? { ...item, contact: { ...item.contact, ...contact } } : item)
    if (contact.status) setFriendStatus(contact.id, contact.status)
    if (groupId !== undefined) moveFriend(contact.id, groupId)
  }
  const conversation = conversations[keyOf(contact.type, contact.id)]
  if (conversation) Object.assign(conversation, contact)
}

function setGroupMembers(id: ImId, members: ImGroupMember[]): void {
  if (!groups.value.some(group => String(group.id) === String(id))) return
  const key = keyOf('group', id)
  groupMembers[key] = members.map(member => ({ ...member }))
  groupMemberMuteStates[String(id)] = Object.fromEntries(members.map(member => [String(member.id), !!member.muted]))
  updateMemberCount(id, members.length)
}

function moveFriend(id: ImId, groupId: ImId): boolean {
  if (!friends.value.some(friend => String(friend.id) === String(id)) || !friendGroups.value.some(group => String(group.id) === String(groupId))) return false
  friendGroupAssignments[String(id)] = groupId
  return true
}

function removeConversation(key: string): void {
  if (activeKey.value === key) {
    draft.value = ''
    emojiOpen.value = false
    if (utility.value === 'history') utility.value = null
  }
  finishAIReply(key)
  closeChat(key)
  recentKeys.value = recentKeys.value.filter(item => item !== key)
  delete conversations[key]
  delete messages[key]
  delete unread[key]
  delete chatStatus[key]
  delete readReceipts[key]
  readNotified.delete(key)
  for (const state of Object.values(typingStates[key] || {})) setTyping({ ...state, typing: false })
  delete typingStates[key]
  delete historyError[key]
  loadedHistory.delete(key)
}

function removeFriend(id: ImId): void {
  for (const group of friendGroups.value) {
    if (group.list.some(contact => String(contact.id) === String(id))) {
      addFriendGroup({ ...group, list: group.list.filter(contact => String(contact.id) !== String(id)) })
    }
  }
  removedFriendIds.value.add(String(id))
  addedFriends.value = addedFriends.value.filter(item => String(item.contact.id) !== String(id))
  delete friendGroupAssignments[String(id)]
  delete friendStatus[String(id)]
  for (const type of ['friend', 'ai'] as const) {
    const key = keyOf(type, id)
    if (conversations[key]) unread[key] = 0
    else delete unread[key]
    delete chatStatus[key]
    for (const state of Object.values(typingStates[key] || {})) setTyping({ ...state, typing: false })
  }
  if (active.value?.type !== 'group' && String(active.value?.id) === String(id)) { stopTyping(); cancelVoice() }
  if (friendActionsId.value === String(id)) friendActionsId.value = null
  if (draggedFriend.value && String(draggedFriend.value.id) === String(id)) stopFriendDrag?.()
}

function isBlocked(id?: ImId): boolean {
  return id !== undefined && blockedUsers.value.some(contact => String(contact.id) === String(id))
}

function isBlockedContact(contact: ChatContact): boolean {
  return contact.type === 'friend' && isBlocked(contact.id)
}

function isBlockedMessage(message: ImMessage): boolean {
  return !message.mine && isBlocked(message.fromid ?? (message.type === 'friend' ? message.id : undefined))
}

function getBlockedUsers(): ImContact[] {
  return blockedUsers.value.map(contact => ({ ...contact }))
}

function setFriendBlocked(contact: ImContact, blocked: boolean): void {
  if (String(contact.id) === String(props.init.user.id)) return
  if (blocked) {
    const existing = blockedUsers.value.find(item => String(item.id) === String(contact.id))
    if (existing) Object.assign(existing, contact)
    else blockedUsers.value.push({ ...contact })
    removeFriend(contact.id)
    for (const notice of notices.value) if (notice.type === 'friend-request' && String(notice.contact?.id) === String(contact.id)) {
      notice.read = notice.resolved = true
    }
  } else {
    blockedUsers.value = blockedUsers.value.filter(item => String(item.id) !== String(contact.id))
    requestedIds.value.delete(String(contact.id))
  }
}

function setBlockedUsers(contacts: ImContact[]): void {
  blockedUsers.value = []
  for (const contact of contacts) setFriendBlocked(contact, true)
}

async function changeFriend(action: 'delete' | 'block' | 'unblock', id: ImId): Promise<boolean> {
  if (managementBusy.value || String(id) === String(props.init.user.id)) return false
  const contact = friends.value.find(item => String(item.id) === String(id))
    || blockedUsers.value.find(item => String(item.id) === String(id))
    || conversations[keyOf('friend', id)] || { id, type: 'friend' as const }
  managementBusy.value = true
  try {
    const handler = action === 'delete' ? props.deleteFriend : action === 'block' ? props.blockFriend : props.unblockFriend
    if (await handler?.({ ...contact }) === false) return false
    if (disposed) return false
    if (action === 'delete') { removeFriend(id); emit('friendRemoved', contact) }
    else if (action === 'block') { setFriendBlocked(contact, true); emit('friendBlocked', contact) }
    else { setFriendBlocked(contact, false); emit('friendUnblocked', contact) }
    return true
  } finally { managementBusy.value = false }
}

const deleteFriend = (id: ImId) => changeFriend('delete', id)
const blockFriend = (id: ImId) => changeFriend('block', id)
const unblockFriend = (id: ImId) => changeFriend('unblock', id)

function confirmFriendAction(mode: 'delete-friend' | 'block-friend', contact: ImContact): void {
  managedFriend.value = { ...contact }
  openUtility(mode)
}

async function submitFriendAction(action: 'delete' | 'block' | 'unblock', contact: ImContact): Promise<void> {
  managementError.value = ''
  try {
    if (!await changeFriend(action, contact.id)) throw new LocaleError('friendActionFailed')
    if (action !== 'unblock') utility.value = null
  } catch (error) { managementError.value = error instanceof Error ? error : new LocaleError('friendActionFailed') }
}

function removeGroup(id: ImId): void {
  const key = keyOf('group', id)
  removedGroupIds.value.add(String(id))
  addedGroups.value = addedGroups.value.filter(group => String(group.id) !== String(id))
  removeConversation(key)
  delete groupMembers[key]
  delete groupMemberCounts[String(id)]
  delete groupProfiles[String(id)]
  delete groupMuteStates[String(id)]
  delete groupMemberMuteStates[String(id)]
  if (managedGroup.value && String(managedGroup.value.id) === String(id)) utility.value = null
}

function getNotice(notice: ImNotice): void {
  const existing = notices.value.find(item => String(item.id) === String(notice.id))
  if (existing) Object.assign(existing, notice)
  else notices.value.unshift({ ...notice })
}

function openUtility(mode: Utility): void {
  if (managementBusy.value) return
  utility.value = mode
  managementError.value = ''
  findError.value = ''
  if (mode === 'friend-group') newFriendGroupName.value = ''
  if (mode === 'create-group' || mode === 'invite') {
    selectedMemberIds.value = []
    memberQuery.value = ''
    newGroupName.value = ''
  }
  if (['members', 'invite', 'leave-group', 'remove-member', 'dismiss-group', 'rename-group'].includes(mode) && active.value?.type === 'group') {
    managedGroup.value = groupInfo({ ...active.value, type: 'group' })
  }
  if (mode === 'rename-group' && managedGroup.value) newGroupName.value = managedGroup.value.groupname || ''
  if (mode === 'add') void runFind()
  if (mode === 'members' && active.value) void fetchGroupMembers(active.value)
  if (mode === 'invite' && managedGroup.value) void fetchGroupMembers(managedGroup.value)
}

async function fetchGroupMembers(receiver: ChatContact): Promise<void> {
  if (receiver.type !== 'group' || !props.loadGroupMembers) return
  const key = keyOf('group', receiver.id)
  if (groupMembersBusy[key]) return
  groupMembersBusy[key] = true
  groupMembersError[key] = false
  try {
    const members = await props.loadGroupMembers({ ...receiver, type: 'group' })
    if (!removedGroupIds.value.has(String(receiver.id))) {
      groupMembers[key] = members
      updateMemberCount(receiver.id, members.length)
    }
  } catch {
    groupMembersError[key] = true
  } finally {
    groupMembersBusy[key] = false
  }
}

function updateMemberCount(id: ImId, count: number): void {
  groupMemberCounts[String(id)] = count
  if (conversations[keyOf('group', id)]) conversations[keyOf('group', id)].members = count
}

function groupInfo(receiver: GroupContact): GroupContact {
  return { ...receiver, ...groups.value.find(group => String(group.id) === String(receiver.id)), ...groupProfiles[String(receiver.id)], type: 'group' }
}

function applyGroupProfile(receiver: GroupContact, profile: { groupname?: string; avatar?: string; adminIds?: ImId[] }): GroupContact {
  groupProfiles[String(receiver.id)] = { ...groupProfiles[String(receiver.id)], ...profile }
  const group = groupInfo(receiver)
  const key = keyOf('group', receiver.id)
  if (conversations[key]) Object.assign(conversations[key], profile)
  if (managedGroup.value && String(managedGroup.value.id) === String(receiver.id)) managedGroup.value = group
  return group
}

async function saveGroupProfile(event?: Event): Promise<void> {
  const input = event?.target as HTMLInputElement | undefined
  const file = input?.files?.[0]
  if (input) input.value = ''
  if (managementBusy.value || !managedGroup.value || (event && !file)) return
  const receiver = groupInfo(managedGroup.value)
  managementError.value = ''
  managementBusy.value = true
  try {
    if (!canManageGroup(receiver)) throw new LocaleError('groupProfilePermission')
    if (removedGroupIds.value.has(String(receiver.id))) throw new LocaleError('groupUnavailable')
    let profile: { groupname?: string; avatar?: string }
    if (file) {
      const upload = props.uploadGroupAvatar
      profile = { avatar: await readAvatar(file, upload ? () => upload(file, receiver) : undefined) }
    } else {
      const groupname = newGroupName.value.trim()
      if (!groupname) throw new LocaleError('enterGroupName')
      if (groupname.length > 40) throw new LocaleError('groupNameTooLong')
      if (groupname === receiver.groupname) { utility.value = 'members'; return }
      if (await props.renameGroup?.(receiver, groupname) === false) throw new LocaleError('renameGroupFailed')
      profile = { groupname }
    }
    if (disposed || removedGroupIds.value.has(String(receiver.id))) return
    if (!canManageGroup(receiver)) throw new LocaleError('groupProfilePermission')
    if (file && profile.avatar === groupInfo(receiver).avatar) return
    const group = applyGroupProfile(receiver, profile)
    if (file) emit('groupAvatarChanged', group)
    else { emit('groupRenamed', group); utility.value = 'members' }
  } catch (error) {
    if (!disposed) managementError.value = error instanceof Error ? error : new LocaleError('groupProfileFailed')
  } finally {
    managementBusy.value = false
    if (activeKey.value !== keyOf('group', receiver.id)) utility.value = null
  }
}

function isGroupOwner(receiver: GroupContact, memberId: ImId = props.init.user.id): boolean {
  const ownerId = groupInfo(receiver).ownerId
  return ownerId !== undefined && String(ownerId) === String(memberId)
}

function isGroupAdmin(receiver: GroupContact, memberId: ImId = props.init.user.id): boolean {
  return !isGroupOwner(receiver, memberId) && !!groupInfo(receiver).adminIds?.some(id => String(id) === String(memberId))
}

function canManageGroup(receiver: GroupContact): boolean {
  return isGroupOwner(receiver) || isGroupAdmin(receiver)
}

function canManageMember(receiver: GroupContact, member: ImGroupMember): boolean {
  return canManageGroup(receiver) && String(member.id) !== String(props.init.user.id)
    && !isGroupOwner(receiver, member.id) && (isGroupOwner(receiver) || !isGroupAdmin(receiver, member.id))
}

function setGroupAdmin(id: ImId, memberId: ImId, admin: boolean): void {
  if (removedGroupIds.value.has(String(id))) return
  const receiver = groupInfo({ ...conversations[keyOf('group', id)], id, type: 'group' })
  if (isGroupOwner(receiver, memberId)) return
  if (isGroupAdmin(receiver, memberId) === admin) return
  const adminIds = (receiver.adminIds || []).filter(item => String(item) !== String(memberId))
  if (admin) adminIds.push(memberId)
  applyGroupProfile(receiver, { adminIds })
}

function assertGroupManagement(receiver: GroupContact, action: 'remove' | 'dismiss' | 'mute' | 'admin', member?: ImGroupMember): void {
  if ((action === 'dismiss' || action === 'admin') ? !isGroupOwner(receiver) : !canManageGroup(receiver)) throw new LocaleError('groupManagementPermission')
  if (member && !canManageMember(receiver, member)) throw new LocaleError('memberManagementPermission')
  if (member && !groupMembers[keyOf('group', receiver.id)]?.some(item => String(item.id) === String(member.id))) throw new LocaleError('memberUnavailable')
}

function isGroupMuted(receiver: GroupContact): boolean {
  return groupMuteStates[String(receiver.id)] ?? groupInfo(receiver).muteAll ?? false
}

function isMemberMuted(receiver: GroupContact, member: Pick<ImGroupMember, 'id' | 'muted'>): boolean {
  return groupMemberMuteStates[String(receiver.id)]?.[String(member.id)]
    ?? groupMembers[keyOf('group', receiver.id)]?.find(item => String(item.id) === String(member.id))?.muted
    ?? member.muted ?? false
}

function setGroupMute(id: ImId, muted: boolean, memberId?: ImId): void {
  if (memberId === undefined) groupMuteStates[String(id)] = muted
  else {
    groupMemberMuteStates[String(id)] ||= {}
    groupMemberMuteStates[String(id)][String(memberId)] = muted
  }
}

function messageRestriction(receiver: ChatContact): string {
  if (isBlockedContact(receiver)) return t('blockedUser')
  if (receiver.type !== 'group' && removedFriendIds.value.has(String(receiver.id))) return t('contactDeleted')
  if (receiver.type === 'ai' && aiPending[keyOf('ai', receiver.id)]) return t('aiReplyingRestriction')
  if (receiver.type !== 'group') return ''
  if (removedGroupIds.value.has(String(receiver.id))) return t('groupUnavailable')
  const group = { ...receiver, type: 'group' as const }
  if (isGroupOwner(group)) return ''
  if (isMemberMuted(group, props.init.user)) return t('youAreMuted')
  return isGroupMuted(group) && !isGroupAdmin(group) ? t('groupMutedHint') : ''
}

async function moderateGroup(action: 'remove' | 'dismiss' | 'mute' | 'admin', member?: ImGroupMember): Promise<void> {
  if (managementBusy.value || !managedGroup.value) return
  const receiver = groupInfo(managedGroup.value)
  managementBusy.value = true
  managementError.value = ''
  try {
    if (removedGroupIds.value.has(String(receiver.id))) throw new LocaleError('groupUnavailable')
    assertGroupManagement(receiver, action, member)
    const key = keyOf('group', receiver.id)
    if (action === 'remove' && member) {
      if (await props.removeGroupMember?.(receiver, member) === false) throw new LocaleError('removeMemberFailed')
      if (disposed || removedGroupIds.value.has(String(receiver.id))) return
      assertGroupManagement(receiver, action, member)
      groupMembers[key] = groupMembers[key].filter(item => String(item.id) !== String(member.id))
      setGroupAdmin(receiver.id, member.id, false)
      delete groupMemberMuteStates[String(receiver.id)]?.[String(member.id)]
      updateMemberCount(receiver.id, groupMembers[key].length)
      emit('groupMemberRemoved', groupInfo(receiver), member)
      utility.value = 'members'
    } else if (action === 'dismiss') {
      if (await props.dismissGroup?.(receiver) === false) throw new LocaleError('dismissGroupFailed')
      if (disposed || removedGroupIds.value.has(String(receiver.id))) return
      assertGroupManagement(receiver, action)
      removeGroup(receiver.id)
      emit('groupDismissed', receiver)
    } else if (action === 'mute') {
      const muted = member ? !isMemberMuted(receiver, member) : !isGroupMuted(receiver)
      const result = member ? await props.muteGroupMember?.(receiver, member, muted) : await props.muteGroup?.(receiver, muted)
      if (result === false) throw new LocaleError('muteFailed')
      if (disposed || removedGroupIds.value.has(String(receiver.id))) return
      assertGroupManagement(receiver, action, member)
      setGroupMute(receiver.id, muted, member?.id)
      if (member) emit('groupMemberMuted', receiver, member, muted)
      else emit('groupMuted', receiver, muted)
    } else if (action === 'admin' && member) {
      const admin = !isGroupAdmin(receiver, member.id)
      if (await props.setGroupAdmin?.(receiver, member, admin) === false) throw new LocaleError('adminFailed')
      if (disposed || removedGroupIds.value.has(String(receiver.id))) return
      assertGroupManagement(receiver, action, member)
      setGroupAdmin(receiver.id, member.id, admin)
      emit('groupAdminChanged', groupInfo(receiver), member, admin)
    }
  } catch (error) {
    if (!disposed) managementError.value = error instanceof Error ? error : new LocaleError('operationFailed')
  } finally {
    managementBusy.value = false
    if (activeKey.value !== keyOf('group', receiver.id)) utility.value = null
  }
}

function startFriendDrag(event: PointerEvent, contact: ImContact, groupId: ImId): void {
  if ((event.button !== 0 && event.pointerType !== 'touch') || friendMoveBusy.value || managementBusy.value) return
  stopFriendDrag?.()
  const element = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startY = event.clientY
  const wasOpen = friendActionsId.value === String(contact.id)
  let axis: 'swipe' | 'drag' | 'scroll' | undefined
  let distance = 0
  const move = (pointer: PointerEvent) => {
    if (pointer.pointerId !== event.pointerId) return
    const dx = pointer.clientX - startX
    const dy = pointer.clientY - startY
    if (!axis) {
      if (Math.hypot(dx, dy) < 8) return
      axis = contact.type !== 'ai' && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'swipe' : event.pointerType === 'touch' ? 'scroll' : 'drag'
      if (axis !== 'scroll') element.setPointerCapture?.(event.pointerId)
    }
    if (axis === 'scroll') return
    pointer.preventDefault()
    friendDragClick.value = true
    if (axis === 'swipe') {
      distance = dx
      friendSwipe.value = { id: String(contact.id), offset: Math.max(-144, Math.min(0, (wasOpen ? -144 : 0) + dx)) }
      return
    }
    friendActionsId.value = null
    draggedFriend.value = contact
    const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-gim-friend-group]')
    friendDropTarget.value = target && panelElement.value?.contains(target)
      ? friendGroups.value.find(group => String(group.id) === target.dataset.gimFriendGroup && String(group.id) !== String(groupId))?.id ?? null
      : null
  }
  const finish = (pointer: PointerEvent) => {
    if (pointer.pointerId !== event.pointerId) return
    const target = friendDropTarget.value
    const source = draggedFriend.value
    if (pointer.type === 'pointerup') {
      if (axis === 'swipe') friendActionsId.value = distance < -40 ? String(contact.id) : distance > 40 ? null : wasOpen ? String(contact.id) : null
      if (axis === 'drag' && source && target !== null) void dropFriend(source, target)
    }
    stopFriendDrag?.()
    setTimeout(() => { friendDragClick.value = false }, 0)
  }
  stopFriendDrag = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId)
    friendSwipe.value = null
    draggedFriend.value = null
    friendDropTarget.value = null
    stopFriendDrag = null
  }
  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
  friendMoveError.value = ''
}

async function dropFriend(contact: ImContact, groupId: ImId): Promise<void> {
  if (friendMoveBusy.value) return
  friendMoveBusy.value = true
  friendMoveError.value = ''
  try {
    if (await props.moveFriend?.(contact, groupId) === false) throw new LocaleError('moveFriendFailed')
    if (!moveFriend(contact.id, groupId)) throw new LocaleError('friendOrCategoryMissing')
    collapsedGroups.value.delete(String(groupId))
    emit('friendMoved', contact, groupId)
  } catch (error) {
    friendMoveError.value = error instanceof Error ? error : new LocaleError('moveFriendFailed')
  } finally {
    friendMoveBusy.value = false
  }
}

async function saveFriendGroup(): Promise<ImFriendGroup> {
  const groupname = newFriendGroupName.value.trim()
  if (!groupname) throw new LocaleError('enterCategoryName')
  if (friendGroups.value.some(group => group.groupname === groupname)) throw new LocaleError('categoryExists')
  const group = props.createFriendGroup
    ? await props.createFriendGroup(groupname)
    : { id: createUuid(), groupname, list: [] }
  if (group.id === undefined || group.id === null) throw new LocaleError('createCategoryFailed')
  addFriendGroup(group)
  emit('friendGroupAdded', group)
  return group
}

async function submitFriendManagement(): Promise<void> {
  if (managementBusy.value) return
  const mode = utility.value
  const contact = managedFriend.value
  const notice = pendingNotice.value
  managementBusy.value = true
  managementError.value = ''
  try {
    if (mode === 'friend-group') await saveFriendGroup()
    else if (contact) {
      if (creatingFriendGroup.value) {
        selectedGroupId.value = (await saveFriendGroup()).id
        creatingFriendGroup.value = false
      }
      const groupId = selectedGroupId.value
      if (groupId === null || !friendGroups.value.some(group => String(group.id) === String(groupId))) throw new LocaleError('selectFriendCategory')
      if (mode === 'accept-friend' && notice) {
        if (isBlocked(contact.id)) throw new LocaleError('blockedUser')
        if (await props.acceptFriend?.(contact, groupId, notice) === false) throw new LocaleError('acceptFriendFailed')
        addContacts({ ...contact, type: 'friend' }, groupId)
        moveFriend(contact.id, groupId)
        notice.read = true
        notice.resolved = true
        emit('friendAdded', contact, groupId)
        emit('noticeAction', notice, 'accept', groupId)
      }
    }
    if (utility.value === mode) utility.value = null
  } catch (error) {
    managementError.value = error instanceof Error ? error : new LocaleError('operationFailed')
  } finally {
    managementBusy.value = false
  }
}

async function submitGroupManagement(): Promise<void> {
  if (managementBusy.value) return
  const mode = utility.value
  const receiver = managedGroup.value
  const members = friends.value.filter(friend => selectedMemberIds.value.includes(String(friend.id))
    && String(friend.id) !== String(props.init.user.id)
    && (mode !== 'invite' || !existingMemberIds.value.has(String(friend.id))))
  managementBusy.value = true
  managementError.value = ''
  try {
    if (mode === 'create-group') {
      const groupname = newGroupName.value.trim()
      if (!groupname) throw new LocaleError('enterGroupName')
      if (!members.length) throw new LocaleError('selectAtLeastOneFriend')
      const created: ImContact = props.createGroup
        ? await props.createGroup({ groupname, members })
        : { id: createUuid(), groupname }
      const group = { ...created, ownerId: created.ownerId ?? props.init.user.id }
      if (group.id === undefined || group.id === null) throw new LocaleError('createGroupFailed')
      addContacts({ ...group, groupname: group.groupname || groupname, type: 'group' })
      groupMembers[keyOf('group', group.id)] = [
        { id: props.init.user.id, username: username.value, avatar: userAvatar.value }, ...members,
      ]
      updateMemberCount(group.id, members.length + 1)
      emit('groupCreated', groups.value.find(item => String(item.id) === String(group.id)) || group)
      chat({ ...group, groupname: group.groupname || groupname, members: members.length + 1, type: 'group' })
    } else if (mode === 'invite' && receiver) {
      if (!members.length) throw new LocaleError('selectFriendsToInvite')
      if (await props.inviteGroupMembers?.(receiver, members) === false) throw new LocaleError('inviteFailed')
      if (!removedGroupIds.value.has(String(receiver.id))) {
        const key = keyOf('group', receiver.id)
        if (groupMembers[key]) {
          groupMembers[key] = [...new Map([...groupMembers[key], ...members].map(member => [String(member.id), member])).values()]
          updateMemberCount(receiver.id, groupMembers[key].length)
        } else updateMemberCount(receiver.id, (receiver.members || 0) + members.length)
        if (props.loadGroupMembers) await fetchGroupMembers(receiver)
        emit('groupMembersInvited', receiver, members)
      }
    } else if (mode === 'leave-group' && receiver) {
      if (isGroupOwner(receiver)) throw new LocaleError('ownerMustDismiss')
      if (await props.leaveGroup?.(receiver) === false) throw new LocaleError('leaveGroupFailed')
      removeGroup(receiver.id)
      emit('groupLeft', receiver)
    }
    if (utility.value === mode) utility.value = null
  } catch (error) {
    managementError.value = error instanceof Error ? error : new LocaleError('operationFailed')
  } finally {
    managementBusy.value = false
  }
}

async function runFind(): Promise<void> {
  findBusy.value = true
  findError.value = ''
  try {
    const found = props.findContacts
      ? await props.findContacts(findQuery.value.trim())
      : [...friends.value, ...groups.value].filter(contact => displayName(contact).toLocaleLowerCase().includes(findQuery.value.trim().toLocaleLowerCase()))
    findResults.value = found.filter(contact => utility.value !== 'add' || contact.type !== 'group')
  } catch {
    findError.value = new LocaleError('findFailed')
  } finally {
    findBusy.value = false
  }
}

async function requestAdd(contact: ImContact): Promise<void> {
  if (isBlocked(contact.id)) { findError.value = new LocaleError('blockedUser'); return }
  addBusy.value = String(contact.id)
  findError.value = ''
  try {
    const result = await props.requestFriend?.(contact)
    if (result === false) {
      findError.value = new LocaleError('addFriendFailed')
      return
    }
    if (props.requestFriend && result === undefined) {
      requestedIds.value = new Set(requestedIds.value).add(String(contact.id))
      return
    }
    if (isBlocked(contact.id)) return
    addContacts({ ...contact, type: 'friend' })
    emit('friendAdded', contact)
  } catch {
    findError.value = new LocaleError('addFriendRetry')
  } finally {
    addBusy.value = null
  }
}

function actOnNotice(notice: ImNotice, action: 'accept' | 'reject' | 'read'): void {
  if (action === 'accept' && notice.contact) {
    pendingNotice.value = notice
    managedFriend.value = notice.contact
    selectedGroupId.value = friendGroups.value[0]?.id ?? null
    creatingFriendGroup.value = !friendGroups.value.length
    newFriendGroupName.value = ''
    openUtility('accept-friend')
    return
  }
  notice.read = true
  if (action !== 'read') notice.resolved = true
  emit('noticeAction', notice, action)
}

function saveSettings(): void {
  try {
    localStorage.setItem(`giorgio-im-settings:${props.init.user.id}`, JSON.stringify({ theme: theme.value, sendKey: sendKey.value }))
  } catch { /* Storage may be unavailable. */ }
}

function closeChat(key: string): void {
  const oldWidth = chatElement.value?.getBoundingClientRect().width
  openKeys.value = openKeys.value.filter(item => item !== key)
  if (activeKey.value === key) {
    activeKey.value = openKeys.value.at(-1) || null
    chatOpen.value = Boolean(activeKey.value)
    if (activeKey.value) unread[activeKey.value] = 0
  }
  adjustDraggedChatWidth(oldWidth)
}

function getMessage(message: ImMessage): void {
  if (message.notice) {
    if (message.type === 'friend') getChatNotice({ ...message.notice, id: message.id, mid: message.mid, timestamp: message.timestamp })
    return
  }
  if (props.customerService && keyOf(message.type, message.id) !== keyOf(props.customerService.type, props.customerService.id)) return
  if (message.type === 'group' && removedGroupIds.value.has(String(message.id))) return
  if (message.type !== 'group' && (isBlocked(message.id) || removedFriendIds.value.has(String(message.id)))) return
  const key = keyOf(message.type, message.id)
  const item = normalise(message)
  const known = message.type === 'group'
    ? groups.value.find(contact => String(contact.id) === String(message.id))
    : message.type === 'ai' ? conversations[key] || friends.value.find(contact => contact.type === 'ai' && String(contact.id) === String(message.id))
      : friends.value.find(contact => contact.type === 'friend' && String(contact.id) === String(message.id))
  ensureConversation({
    ...known,
    id: message.id,
    type: message.type,
    username: message.type === 'ai' ? known?.username || (item.mine ? undefined : message.username)
      : message.type === 'friend' ? known?.username || message.username : undefined,
    groupname: message.type === 'group' ? known?.groupname || message.groupname : undefined,
    avatar: known?.avatar || (message.type === 'ai' && item.mine ? undefined : message.avatar),
  })
  if (message.type === 'ai' && !item.mine) {
    receiveAIMessage(key, message)
    return
  }
  if (!item.mine && message.type !== 'ai') setTyping({ id: message.id, type: message.type, fromid: message.fromid ?? message.id, typing: false })
  const existing = message.mid !== undefined ? messages[key].find(item => String(item.mid) === String(message.mid)) : undefined
  if (existing) {
    existing.readBy = [...new Map([...(existing.readBy || []), ...(item.readBy || [])].map(id => [String(id), id])).values()]
    return
  }
  messages[key].push(item)
  remember(key)
  if (!item.mine && !isConversationVisible(key)) {
    markUnread(key)
    if (!isConversationOpen(key)) void playMessageSound()
  }
  scrollToBottom()
}

function finishAIReply(key: string, error?: string, errorKey?: ImLocaleKey): void {
  clearTimeout(aiTimers.get(key))
  aiTimers.delete(key)
  if (aiPending[key]) {
    aiPending[key].pending = false
    aiPending[key].error = error
    aiPending[key].errorKey = errorKey
    delete aiPending[key]
  }
}

function waitForAI(key: string): void {
  clearTimeout(aiTimers.get(key))
  aiTimers.set(key, setTimeout(() => {
    finishAIReply(key, undefined, 'aiTimeout')
  }, Math.max(1, props.chatTimeout ?? 60000)))
}

function startAIReply(receiver: ChatContact): void {
  const key = keyOf('ai', receiver.id)
  aiPending[key] = { ...normalise({ ...receiver, type: 'ai', content: '', mine: false }), pending: true }
  messages[key].push(aiPending[key])
  emojiOpen.value = false
  waitForAI(key)
  scrollToBottom()
}

function receiveAIMessage(key: string, message: ImMessage): void {
  if (message.mid !== undefined && messages[key].some(item => item !== aiPending[key] && String(item.mid) === String(message.mid))) return
  if (!aiPending[key]) {
    aiPending[key] = normalise({ ...message, mine: false })
    messages[key].push(aiPending[key])
  }
  const reply = aiPending[key]
  if (!message.error || message.content) reply.content = message.content
  if (message.mid !== undefined) reply.mid = message.mid
  if (message.username) reply.username = message.username
  if (message.avatar) reply.avatar = message.avatar
  reply.pending = !message.error && message.finished === false
  if (reply.pending) waitForAI(key)
  else {
    finishAIReply(key, message.error)
    markUnread(key)
  }
  remember(key)
  scrollToBottom()
}

function getChatNotice(notice: ImChatNotice): void {
  const key = keyOf('friend', notice.id)
  if (!chatOpen.value || !openKeys.value.includes(key) || !conversations[key]) return
  if (notice.event === 'signature' ? props.chatNotices?.signature === false : props.chatNotices?.presence === false) return
  if (notice.mid !== undefined && messages[key].some(message => String(message.mid) === String(notice.mid))) return
  messages[key].push(normalise({ id: notice.id, type: 'friend', content: '', mine: false,
    mid: notice.mid ?? createUuid(), timestamp: notice.timestamp, notice: { event: notice.event, sign: notice.sign } }))
}

function chatNoticeText(message: ImMessage): string {
  const name = displayName(conversations[keyOf(message.type, message.id)])
  if (message.notice?.event === 'signature') return message.notice.sign
    ? t('friendSignatureChanged', { name, sign: message.notice.sign }) : t('friendSignatureCleared', { name })
  return t(message.notice?.event === 'online' ? 'friendOnline' : 'friendOffline', { name })
}

function setMessageRead(receipt: ImReadReceipt): void {
  const key = keyOf(receipt.type, receipt.id)
  readReceipts[key] ||= {}
  for (const mid of receipt.mids) {
    const message = messages[key]?.find(message => !message.notice && String(message.mid) === String(mid))
    if (message?.mine && String(receipt.readerId) === String(props.init.user.id)) continue
    const readers = readReceipts[key][String(mid)] ||= []
    if (!readers.some(id => String(id) === String(receipt.readerId))) readers.push(receipt.readerId)
    if (message) message.readBy = [...new Map([...(message.readBy || []), ...readers].map(id => [String(id), id])).values()]
  }
}

function markViewedMessages(): void {
  const receiver = active.value
  if (!receiver || receiver.type === 'ai' || (receiver.type === 'friend' && messageRestriction(receiver)) || !activeKey.value || !isConversationVisible(activeKey.value)) return
  let notified = readNotified.get(activeKey.value)
  if (!notified) { notified = new Set(); readNotified.set(activeKey.value, notified) }
  const mids = activeMessages.value.filter(message => !message.mine && !message.notice && message.mid !== undefined
    && !message.readBy?.some(id => String(id) === String(props.init.user.id)) && !notified.has(String(message.mid))).map(message => message.mid!)
  for (const mid of mids) notified.add(String(mid))
  const batchSize = 100
  for (let index = 0; index < mids.length; index += batchSize) emit('read', { id: receiver.id, type: receiver.type, mids: mids.slice(index, index + batchSize) })
}

function setTyping(state: ImTypingState): void {
  if (String(state.fromid) === String(props.init.user.id) || (state.typing && state.type === 'friend' && (isBlocked(state.id) || removedFriendIds.value.has(String(state.id))))) return
  const key = keyOf(state.type, state.id)
  const timerKey = `${key}:${state.fromid}`
  clearTimeout(typingTimers.get(timerKey))
  typingTimers.delete(timerKey)
  if (typingStates[key]) delete typingStates[key][String(state.fromid)]
  const remaining = Math.min(6000, (state.expiresAt ?? Date.now() + 6000) - Date.now())
  if (!state.typing || remaining <= 0 || !chatOpen.value || !openKeys.value.includes(key)) return
  typingStates[key] ||= {}
  typingStates[key][String(state.fromid)] = state
  typingTimers.set(timerKey, setTimeout(() => {
    delete typingStates[key]?.[String(state.fromid)]
    typingTimers.delete(timerKey)
  }, remaining))
}

function publishTyping(): void {
  const receiver = active.value
  if (!receiver || receiver.type === 'ai' || !chatOpen.value || !pageVisible.value || composerRestriction.value || !draft.value.trim()) { stopTyping(); return }
  if (!localTyping || Date.now() - lastTypingSentAt >= 2000) {
    localTyping = { id: receiver.id, type: receiver.type, typing: true }
    lastTypingSentAt = Date.now()
    emit('typing', localTyping)
  }
  clearTimeout(typingIdleTimer)
  typingIdleTimer = setTimeout(stopTyping, 3000)
}

function stopTyping(): void {
  clearTimeout(typingIdleTimer)
  if (localTyping) emit('typing', { ...localTyping, typing: false })
  localTyping = undefined
  lastTypingSentAt = -Infinity
}

function setFriendStatus(id: ImId, status: 'online' | 'offline'): void {
  friendStatus[String(id)] = status
  if (status === 'offline') setTyping({ id, type: 'friend', fromid: id, typing: false })
}

function setChatStatus(status: string, receiver?: { id: ImId; type: ImChatType }): void {
  const key = receiver ? keyOf(receiver.type, receiver.id) : activeKey.value
  if (key) chatStatus[key] = status
}

async function send(): Promise<void> {
  const content = draft.value.trim()
  const receiver = active.value
  const images = pendingImages.value
  if ((!content && !images.length) || !receiver || messageRestriction(receiver) || voiceState.value !== 'idle' || imageSending.value) return
  let attachment: ImAttachment | undefined
  let attachments: ImAttachment[] | undefined
  if (images.length) {
    toolbarError.value = ''
    if (!props.uploadAttachment) { toolbarError.value = new LocaleError('uploadAttachmentRequired'); return }
    imageSending.value = true
    try {
      const uploaded: ImAttachment[] = []
      for (const image of images) {
        const url = safeAttachmentUrl(await props.uploadAttachment(image.file, receiver))
        if (!url) throw new Error('Invalid attachment URL')
        if (disposed || active.value !== receiver || pendingImages.value !== images || messageRestriction(receiver)) return
        uploaded.push({ kind: 'image', url, name: image.file.name })
      }
      if (uploaded.length === 1) attachment = uploaded[0]
      else attachments = uploaded
    } catch {
      toolbarError.value = new LocaleError('uploadFailed')
      return
    } finally {
      imageSending.value = false
    }
  }
  const messageContent = content || images[0]?.file.name || ''
  const timestamp = Date.now()
  const mid = createUuid()
  getMessage({ id: receiver.id, type: receiver.type, content: messageContent, ...(attachment ? { attachment } : {}), ...(attachments ? { attachments } : {}), mid, username: username.value, avatar: userAvatar.value, timestamp, fromid: props.init.user.id, mine: true })
  draft.value = ''
  clearPendingImages()
  if (receiver.type === 'ai') startAIReply(receiver)
  emit('sendMessage', { user: currentUser.value, receiver, content: messageContent, ...(attachment ? { attachment } : {}), ...(attachments ? { attachments } : {}), timestamp, mid })
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.isComposing && (sendKey.value === 'ctrl-enter' ? event.ctrlKey || event.metaKey : !event.shiftKey && !event.ctrlKey && !event.metaKey)) {
    event.preventDefault()
    send()
  }
}

function insertEmoji(emoji: string): void {
  draft.value += emoji
  emojiOpen.value = false
}

function setToolbar(items: ImToolbarItem[]): void {
  toolbarOverrides.value = items.map(item => ({ ...item }))
}

async function runToolbar(item: typeof toolbarItems.value[number]): Promise<void> {
  const state = toolbarState.value
  if (!state || item.disabled || disposed) return
  const session = toolbarSession
  const key = `${activeKey.value}:${item.id}`
  const isCurrent = () => !disposed && chatOpen.value && session === toolbarSession
  const canCompose = () => isCurrent() && !composerRestriction.value
  const runDefault = () => {
    if (!isCurrent() || (item.id !== 'history' && !canCompose())) return
    if (item.id === 'emoji') emojiOpen.value = !emojiOpen.value
    else if (item.id === 'image') imageInput.value?.click()
    else if (item.id === 'file') fileInput.value?.click()
    else if (item.id === 'voice' && state.receiver.type !== 'ai') { emojiOpen.value = false; void startVoice() }
    else if (item.id === 'voice-call') void requestCall('voice')
    else if (item.id === 'video-call') void requestCall('video')
    else if (item.id === 'history') openUtility('history')
  }
  toolbarError.value = ''
  if (!item.onClick) { runDefault(); return }
  if (toolbarBusy.has(key)) return
  toolbarBusy.add(key)
  try {
    await item.onClick({ ...state, id: item.id, runDefault,
      setDraft: value => { if (canCompose()) draft.value = value },
      insertText: value => { if (canCompose()) draft.value += value },
    })
  } catch {
    if (isCurrent()) toolbarError.value = new LocaleError('operationFailed')
  } finally {
    toolbarBusy.delete(key)
  }
}

function safeAttachmentUrl(url: string): string {
  try {
    return ['http:', 'https:', 'blob:'].includes(new URL(url, typeof location === 'undefined' ? 'http://localhost' : location.href).protocol) ? url : ''
  } catch { return '' }
}

function clearPendingImages(): void {
  for (const image of pendingImages.value) URL.revokeObjectURL(image.url)
  pendingImages.value = []
}

function removePendingImage(index: number): void {
  const image = pendingImages.value[index]
  if (!image) return
  URL.revokeObjectURL(image.url)
  pendingImages.value = pendingImages.value.filter((_, position) => position !== index)
}

function onComposerImage(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = event.type === 'paste'
    ? Array.from((event as ClipboardEvent).clipboardData?.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => file !== null)
    : Array.from(input.files ?? []).filter(file => file.type.startsWith('image/'))
  if (event.type !== 'paste') input.value = ''
  if (!files.length || composerRestriction.value || imageSending.value) return
  if (event.type === 'paste') event.preventDefault()
  pendingImages.value = [...pendingImages.value, ...files.map(file => ({ file: file.name ? file : new File([file], `image.${file.type.split('/')[1] || 'png'}`, { type: file.type }), url: URL.createObjectURL(file) }))]
  toolbarError.value = ''
}

async function sendAttachment(event: Event, kind: ImAttachment['kind']): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const receiver = active.value
  input.value = ''
  if (!file || !receiver || messageRestriction(receiver)) return
  toolbarError.value = ''
  if (!props.uploadAttachment) {
    toolbarError.value = new LocaleError('uploadAttachmentRequired')
    return
  }
  try {
    const url = safeAttachmentUrl(await props.uploadAttachment(file, receiver))
    if (messageRestriction(receiver)) return
    if (!url) throw new Error('Invalid attachment URL')
    const attachment = { kind, url, name: file.name }
    const timestamp = Date.now()
    const mid = createUuid()
    getMessage({ id: receiver.id, type: receiver.type, content: file.name, attachment, timestamp, mid, mine: true, username: username.value, fromid: props.init.user.id })
    if (receiver.type === 'ai') startAIReply(receiver)
    emit('sendMessage', { user: currentUser.value, receiver, content: file.name, attachment, timestamp, mid })
  } catch {
    toolbarError.value = new LocaleError('uploadFailed')
  }
}

async function requestCall(type: ImCallType): Promise<void> {
  const receiver = active.value
  if (!receiver || receiver.type === 'ai' || composerRestriction.value || callBusy.value) return
  const session = toolbarSession
  if (!props.onCall) { openUtility('call-info'); return }
  callBusy.value = true
  try {
    await props.onCall({ type, receiver: { ...receiver }, user: { ...currentUser.value } })
  } catch {
    if (!disposed && toolbarSession === session) toolbarError.value = new LocaleError('callFailed')
  } finally {
    callBusy.value = false
  }
}

async function sendVoice(): Promise<void> {
  const file = voiceFile.value
  const receiver = active.value
  if (!file || !receiver || voiceSending.value || messageRestriction(receiver)) return
  toolbarError.value = ''
  const upload = props.uploadVoice ?? props.uploadAttachment
  if (!upload) { toolbarError.value = new LocaleError('uploadVoiceRequired'); return }
  const duration = voiceDuration.value
  const session = toolbarSession
  const isCurrent = () => !disposed && chatOpen.value && session === toolbarSession && voiceFile.value === file && !messageRestriction(receiver)
  voiceSending.value = true
  try {
    const url = safeAttachmentUrl(await upload(file, receiver, duration))
    if (!isCurrent()) return
    if (!url) throw new Error('Invalid audio URL')
    const attachment: ImAttachment = { kind: 'audio', url, name: file.name, duration }
    const timestamp = Date.now()
    const mid = createUuid()
    getMessage({ ...receiver, content: t('voiceContent'), attachment, timestamp, mid, fromid: currentUser.value.id, mine: true, username: username.value, avatar: userAvatar.value })
    emit('sendMessage', { user: currentUser.value, receiver, content: t('voiceContent'), timestamp, attachment, mid })
    cancelVoice()
    voiceSending.value = false
  } catch {
    if (isCurrent()) toolbarError.value = new LocaleError('uploadFailed')
  } finally {
    if (voiceFile.value === file) voiceSending.value = false
  }
}

function updateOnline(status: 'online' | 'hide'): void {
  online.value = status
  emit('online', status)
}

function updateSign(): void {
  if (sign.value === savedSign.value) return
  savedSign.value = sign.value
  emit('sign', sign.value)
}

function updateUsername(): void {
  const value = usernameDraft.value.trim()
  usernameDraft.value = value || username.value
  if (!value || value === username.value) return
  username.value = value
  emit('username', value)
}

async function readAvatar(file: File, upload?: () => Promise<string> | string): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/i.test(file.type)) throw new LocaleError('avatarTypeInvalid')
  const maxAvatarBytes = 2 * 1024 * 1024
  if (file.size > maxAvatarBytes) throw new LocaleError('avatarTooLarge')
  const avatar = upload ? await upload() : await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new LocaleError('avatarReadFailed'))
    reader.onerror = reader.onabort = () => reject(new LocaleError('avatarReadRetry'))
    reader.readAsDataURL(file)
  })
  if (typeof avatar !== 'string' || !avatar.trim() || (!/^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/i.test(avatar)
    && !['http:', 'https:'].includes(new URL(avatar, location.href).protocol))) throw new LocaleError('avatarUrlInvalid')
  return avatar
}

async function updateAvatar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || avatarBusy.value) return
  avatarError.value = ''
  const request = ++avatarRequest
  avatarBusy.value = true
  try {
    const upload = props.uploadAvatar
    const avatar = await readAvatar(file, upload ? () => upload(file, currentUser.value) : undefined)
    if (request !== avatarRequest) return
    if (avatar === userAvatar.value) return
    userAvatar.value = avatar
    emit('avatar', avatar)
  } catch (error) {
    if (request === avatarRequest) avatarError.value = error instanceof Error ? error : new LocaleError('avatarChangeFailed')
  } finally {
    if (request === avatarRequest) avatarBusy.value = false
  }
}

function timeLabel(timestamp: number): string {
  return timeFormatter.value.format(timestamp)
}

defineExpose({ setContacts, setUser, updateContact, setGroupMembers, chat, getMessage, getChatNotice, setMessageRead, setTyping, addContacts, addFriendGroup, moveFriend, removeFriend, deleteFriend, blockFriend, unblockFriend, setFriendBlocked, setBlockedUsers, getBlockedUsers, removeGroup, setGroupMute, setGroupAdmin, getNotice, setFriendStatus, setChatStatus, setToolbar, open, close, resetWindows, setLocale })
</script>

<template>
  <div class="gim-root" :lang="locale" :class="{ 'gim-dark': theme === 'dark' }">
    <button v-if="customerService ? !chatOpen : !panelOpen" class="gim-launcher" :class="{ 'gim-service-launcher': customerService }" type="button" :aria-label="customerService ? t('openSupport') : t('openChat')" :title="customerService ? displayName(customerService) : undefined" @click="open">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.4-.76L4 20l1.76-5.1A8 8 0 0 1 5 11.5a7.5 7.5 0 0 1 15 0Z"/><path d="M8.5 11.5h8m-8 3h5"/></svg>
      <span v-if="totalUnread" class="gim-launcher-badge">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
      <span v-if="customerService" class="gim-service-launcher-label">{{ t('support') }}</span>
    </button>

    <button v-if="messageNotification !== false && notificationUnread" ref="messageAlert" class="gim-message-alert" :class="{ 'gim-message-alert-panel': panelOpen && !customerService }" type="button" :aria-label="t('viewUnreadMessages', { count: notificationUnread })" @click="openUnreadMessages">
      <span class="gim-avatar" :class="{ 'gim-group-avatar': unreadContacts[0].type === 'group' }">
        <img v-if="unreadContacts[0].avatar || unreadContacts[0].type !== 'group'" :src="unreadContacts[0].avatar || (unreadContacts[0].type === 'ai' ? aiAvatar : defaultAvatar)" alt="" />
        <span v-else>{{ avatarLetter(unreadContacts[0]) }}</span>
      </span>
      <span class="gim-message-alert-copy" role="status" aria-live="polite" aria-atomic="true"><strong>{{ t('newMessages') }}</strong><small>{{ unreadContacts.map(displayName).join(' · ') }}</small></span>
      <span class="gim-message-alert-count">{{ notificationUnread > 99 ? '99+' : notificationUnread }}</span>
    </button>

      <section v-if="panelOpen && !customerService" ref="panelElement" class="gim-panel gim-window" :style="windowStyle('panel')" :aria-label="t('contactsPanel')" @pointerdown="frontWindow = 'panel'">
        <header class="gim-profile gim-drag-handle" @pointerdown="startDrag($event, 'panel')">
          <button class="gim-avatar gim-own-avatar" type="button" :aria-label="t('changeAvatar')" :title="avatarBusy ? t('changingAvatar') : t('changeAvatarHint')" :disabled="avatarBusy" :aria-busy="avatarBusy" @click="avatarInput?.click()">
            <img :src="userAvatar || defaultAvatar" :alt="username" />
            <span class="gim-avatar-edit" :class="{ 'gim-avatar-loading': avatarBusy }" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 6 2-3h4l2 3h4v14H4V6Z"/><circle cx="12" cy="12" r="3"/></svg></span>
          </button>
          <input ref="avatarInput" type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" :aria-label="t('chooseAvatar')" :disabled="avatarBusy" @change="updateAvatar" />
          <div class="gim-profile-info">
            <input v-model="usernameDraft" class="gim-profile-name" :aria-label="t('nickname')" :title="t('nicknameHint')" maxlength="30" @blur="updateUsername" @keydown.enter="!$event.isComposing && ($event.target as HTMLInputElement).blur()" />
            <input v-model="sign" :aria-label="t('signature')" :title="t('signatureHint')" :placeholder="t('signaturePlaceholder')" maxlength="80" @blur="updateSign" @keydown.enter="!$event.isComposing && ($event.target as HTMLInputElement).blur()" />
          </div>
          <button class="gim-icon-button gim-panel-close" type="button" :aria-label="t('minimiseContacts')" @click="panelOpen = false">×</button>
        </header>
        <p v-if="avatarError" class="gim-avatar-error" role="alert">{{ errorText(avatarError) }}</p>

        <div class="gim-presence">
          <span class="gim-status-dot" :class="online" />
          <select :value="online" :aria-label="t('onlineStatus')" @change="updateOnline(($event.target as HTMLSelectElement).value as 'online' | 'hide')">
            <option value="online">{{ t('online') }}</option>
            <option value="hide">{{ t('invisible') }}</option>
          </select>
        </div>

        <nav class="gim-tabs" :aria-label="t('contactTabs')">
          <button type="button" :class="{ active: tab === 'friend' }" @click="tab = 'friend'">{{ t('contacts') }}</button>
          <button type="button" :class="{ active: tab === 'group' }" @click="tab = 'group'">{{ t('groups') }}</button>
          <button type="button" :class="{ active: tab === 'history' }" @click="tab = 'history'">{{ t('recent') }}</button>
        </nav>

        <div v-if="searchOpen" class="gim-search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>
          <input ref="searchInput" v-model="search" :aria-label="t('searchCurrentList')" :placeholder="t('searchCurrentList')" @keydown.esc="toggleSearch" />
          <button type="button" :aria-label="t('closeSearch')" @click="toggleSearch">×</button>
        </div>

        <div class="gim-contact-scroll">
          <div v-if="tab !== 'history'" class="gim-list-actions">
            <button v-if="tab === 'friend'" type="button" :aria-label="t('newCategory')" @click="openUtility('friend-group')">＋ {{ t('newCategory') }}</button>
            <button v-else type="button" :aria-label="t('createGroup')" @click="openUtility('create-group')">＋ {{ t('createGroup') }}</button>
          </div>
          <template v-if="tab === 'friend'">
            <p v-if="friendMoveBusy" class="gim-form-hint" role="status">{{ t('movingFriend') }}</p>
            <p v-if="friendMoveError" class="gim-form-error" role="alert">{{ errorText(friendMoveError) }}</p>
            <section v-for="group in visibleGroups" :key="group.id" class="gim-contact-group" :data-gim-friend-group="group.id" :class="{ 'gim-drop-target': friendDropTarget === group.id }">
              <h3><button type="button" :aria-expanded="query ? true : !collapsedGroups.has(String(group.id))" @click="toggleGroup(group.id)"><svg class="gim-group-chevron" :class="{ collapsed: collapsedGroups.has(String(group.id)) && !query }" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6" /></svg>{{ group.groupname }} <span>{{ group.list.length }}</span></button></h3>
              <div v-for="contact in query || !collapsedGroups.has(String(group.id)) ? group.list : []" :key="contact.id" class="gim-contact-row" :class="{ 'gim-dragging': draggedFriend?.id === contact.id, 'gim-actions-open': friendActionsId === String(contact.id), 'gim-swiping': friendSwipe?.id === String(contact.id) }">
                <div v-if="contact.type !== 'ai'" class="gim-friend-actions" :aria-label="t('friendActions', { name: displayName(contact) })" :inert="friendActionsId !== String(contact.id)">
                  <button type="button" :aria-label="t('deleteNamedFriend', { name: displayName(contact) })" :disabled="managementBusy" @click="confirmFriendAction('delete-friend', contact)">{{ t('deleteFriend') }}</button>
                  <button type="button" :aria-label="t('blockNamedFriend', { name: displayName(contact) })" :disabled="managementBusy" @click="confirmFriendAction('block-friend', contact)">{{ t('blockFriend') }}</button>
                </div>
                <button class="gim-contact" type="button" :style="friendSwipe?.id === String(contact.id) ? { transform: `translateX(${friendSwipe.offset}px)` } : undefined" :draggable="false" :title="t('swipeFriendHint')" @contextmenu.prevent="contact.type !== 'ai' && (friendActionsId = friendActionsId === String(contact.id) ? null : String(contact.id))" @keydown.shift.f10.prevent="contact.type !== 'ai' && (friendActionsId = String(contact.id))" @keydown.esc="friendActionsId = null" @pointerdown="startFriendDrag($event, contact, group.id)" @click="!friendDragClick && chat({ ...contact, type: contact.type === 'ai' ? 'ai' : 'friend' })">
                <span class="gim-avatar" :class="{ 'gim-offline': isOffline(contact) }"><img :src="contact.avatar || (contact.type === 'ai' ? aiAvatar : defaultAvatar)" :alt="contact.username || ''" :draggable="false" /></span>
                <span class="gim-contact-copy"><strong>{{ displayName(contact) }}</strong><small>{{ contact.sign || (isOffline(contact) ? t('offline') : t('online')) }}</small></span>
                <span v-if="(friendStatus[String(contact.id)] || contact.status) === 'online'" class="gim-online-dot" />
                <span v-if="unread[keyOf(contact.type === 'ai' ? 'ai' : 'friend', contact.id)]" class="gim-unread">{{ unread[keyOf(contact.type === 'ai' ? 'ai' : 'friend', contact.id)] }}</span>
                </button>
              </div>
            </section>
            <p v-if="!visibleGroups.some(group => group.list.length)" class="gim-empty">{{ t('noContacts') }}</p>
          </template>
          <template v-else-if="tab === 'group'">
            <button v-for="contact in visibleChats" :key="contact.id" class="gim-contact" type="button" @click="chat(contact)">
              <span class="gim-avatar gim-group-avatar"><img v-if="contact.avatar" :src="contact.avatar" :alt="displayName(contact)" /><span v-else>{{ avatarLetter(contact) }}</span></span>
              <span class="gim-contact-copy"><strong>{{ displayName(contact) }}</strong><small>{{ contact.members !== undefined ? t('memberCount', { count: contact.members }) : t('groupChat') }}</small></span>
              <span v-if="unread[`group:${contact.id}`]" class="gim-unread">{{ unread[`group:${contact.id}`] }}</span>
            </button>
            <p v-if="!visibleChats.length" class="gim-empty">{{ t('noGroups') }}</p>
          </template>
          <template v-else>
            <button v-for="key in visibleRecent" :key="key" class="gim-contact" :class="{ 'gim-blocked-contact': isBlockedContact(conversations[key]) }" type="button" @click="chat(conversations[key])">
              <span class="gim-avatar" :class="{ 'gim-group-avatar': conversations[key].type === 'group', 'gim-offline': isOffline(conversations[key]), 'gim-blocked': isBlockedContact(conversations[key]) }"><img v-if="conversations[key].avatar || conversations[key].type !== 'group'" :src="conversations[key].avatar || (conversations[key].type === 'ai' ? aiAvatar : defaultAvatar)" :alt="displayName(conversations[key])" /><span v-else>{{ avatarLetter(conversations[key]) }}</span></span>
              <span class="gim-contact-copy"><strong>{{ displayName(conversations[key]) }}<span v-if="isBlockedContact(conversations[key])" class="gim-blocked-label">{{ t('blockedUser') }}</span></strong><small>{{ messages[key]?.filter(message => !message.notice).at(-1)?.content || (conversations[key].type === 'group' ? t('groupChat') : t('startChat')) }}</small></span>
              <span v-if="unread[key]" class="gim-unread">{{ unread[key] }}</span>
            </button>
            <p v-if="!visibleRecent.length" class="gim-empty">{{ t('noRecentChats') }}</p>
          </template>
        </div>
        <footer class="gim-panel-footer gim-tools">
          <button type="button" :aria-label="t('addFriend')" @click="openUtility('add')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>{{ t('add') }}</button>
          <button type="button" :aria-label="t('find')" :aria-pressed="searchOpen" @click="toggleSearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>{{ t('find') }}</button>
          <button type="button" :aria-label="t('inbox')" @click="openUtility('inbox')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{{ t('messages') }}<i v-if="unreadNotices" class="gim-tool-badge">{{ unreadNotices }}</i></button>
          <button type="button" :aria-label="t('settings')" @click="openUtility('settings')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-.6 2.5-1.6.9-2.5-.7-2 3.5 1.9 1.8v2l-1.9 1.8 2 3.5 2.5-.7 1.6.9.6 2.5h4l.6-2.5 1.6-.9 2.5.7 2-3.5-1.9-1.8v-2l1.9-1.8-2-3.5-2.5.7-1.6-.9L14 3Z"/><circle cx="12" cy="12" r="3"/></svg>{{ t('settings') }}</button>
        </footer>
      </section>

      <section v-if="chatOpen && active" ref="chatElement" class="gim-chat gim-window" :class="{ 'gim-chat-many': !customerService && openKeys.length > 1, 'gim-service-chat': customerService, 'gim-ai-chat': active.type === 'ai', 'gim-chat-maximized': active.type === 'ai' && active.maximized }" :style="windowStyle('chat')" :aria-label="t('chatWith', { name: displayName(active) })" @pointerdown="frontWindow = 'chat'">
        <aside v-if="!customerService && openKeys.length > 1" class="gim-conversation-list" :aria-label="t('openConversations')">
          <div class="gim-conversation-label">{{ t('conversations') }}<span>{{ openKeys.length }}</span></div>
          <div class="gim-conversation-scroll">
            <div v-for="key in openKeys" :key="key" class="gim-conversation-row" :class="{ active: activeKey === key, 'gim-blocked-contact': isBlockedContact(conversations[key]) }">
              <button type="button" :aria-label="t('switchConversation', { name: displayName(conversations[key]) })" @click="chat(conversations[key])">
                <span class="gim-avatar" :class="{ 'gim-group-avatar': conversations[key].type === 'group', 'gim-offline': isOffline(conversations[key]), 'gim-blocked': isBlockedContact(conversations[key]) }"><img v-if="conversations[key].avatar || conversations[key].type !== 'group'" :src="conversations[key].avatar || (conversations[key].type === 'ai' ? aiAvatar : defaultAvatar)" :alt="displayName(conversations[key])" /><span v-else>{{ avatarLetter(conversations[key]) }}</span></span>
                <span class="gim-conversation-name">{{ displayName(conversations[key]) }}<small v-if="isBlockedContact(conversations[key])" class="gim-blocked-label">{{ t('blockedUser') }}</small></span>
                <i v-if="unread[key]" class="gim-tab-dot" />
              </button>
              <button class="gim-conversation-close" type="button" :aria-label="t('closeConversation', { name: displayName(conversations[key]) })" @click="closeChat(key)">×</button>
            </div>
          </div>
        </aside>
        <div class="gim-chat-main">
          <header class="gim-chat-header gim-drag-handle" @pointerdown="startDrag($event, 'chat')">
            <div class="gim-avatar" :class="{ 'gim-group-avatar': active.type === 'group', 'gim-offline': isOffline(active), 'gim-blocked': isBlockedContact(active) }"><img v-if="active.avatar || active.type !== 'group'" :src="active.avatar || (active.type === 'ai' ? aiAvatar : defaultAvatar)" :alt="displayName(active)" /><span v-else>{{ avatarLetter(active) }}</span></div>
            <div class="gim-chat-heading" :class="{ 'gim-blocked-contact': isBlockedContact(active) }"><strong>{{ displayName(active) }}<span v-if="isBlockedContact(active)" class="gim-blocked-label">{{ t('blockedUser') }}</span></strong><small>{{ chatStatus[activeKey || ''] || typingLabel || (active.type === 'ai' ? composerRestriction ? t('replying') : t('aiChat') : active.type === 'group' ? t('groupChat') : isOffline(active) ? t('offline') : t('online')) }}</small></div>
            <button v-if="active.type === 'group'" type="button" class="gim-group-members-trigger" :aria-label="t('viewGroupMembers')" :title="t('viewGroupMembers')" @click="openUtility('members')"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></svg><span>{{ active.members !== undefined ? t('groupMembersCount', { count: active.members }) : t('groupMembers') }}</span></button>
            <div class="gim-chat-controls"><button v-if="active.type === 'ai'" type="button" :aria-label="active.maximized ? t('restoreWindow') : t('maximiseWindow')" :title="active.maximized ? t('restoreWindow') : t('maximiseWindow')" @click="active.maximized = !active.maximized"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="active.maximized" d="M8 8V4h12v12h-4M4 8h12v12H4Z"/><rect v-else x="4" y="4" width="16" height="16" rx="1"/></svg></button><button type="button" :aria-label="t('minimiseChat')" @click="chatOpen = false">−</button><button type="button" :aria-label="t('closeChat')" @click="customerService ? (chatOpen = false) : activeKey && closeChat(activeKey)">×</button></div>
          </header>
          <div ref="messageList" class="gim-messages" role="log" aria-live="polite">
            <button v-if="historyError[activeKey || '']" class="gim-history-error" type="button" @click="activeKey && fetchHistory(activeKey, active)">{{ t('historyLoadFailed') }}</button>
            <p v-if="!activeMessages.length" class="gim-message-empty">{{ t('emptyChat', { name: displayName(active) }) }}</p>
            <template v-for="(message, index) in activeMessages" :key="message.mid || `${message.timestamp}-${index}`">
            <div v-if="message.notice" class="gim-chat-notice"><span><time>{{ timeLabel(message.timestamp) }}</time>{{ chatNoticeText(message) }}</span></div>
            <div v-else class="gim-message" :class="{ mine: message.mine, 'gim-blocked': isBlockedMessage(message) }">
              <span class="gim-avatar gim-message-avatar"><img :src="(message.mine ? userAvatar : message.avatar || (active.type !== 'group' ? active.avatar || (active.type === 'ai' ? aiAvatar : undefined) : undefined)) || defaultAvatar" :alt="message.username || ''" /></span>
              <div class="gim-message-body">
                <div class="gim-message-meta"><span>{{ message.mine ? username : message.username || displayName(active) }}</span><span v-if="isBlockedMessage(message)" class="gim-blocked-label">{{ t('blockedUser') }}</span><template v-if="active.type === 'group' && (message.fromid !== undefined || message.mine)"><span v-if="isGroupOwner({ ...active, type: 'group' }, message.mine ? init.user.id : message.fromid)" class="gim-owner-badge">{{ t('owner') }}</span><span v-else-if="isGroupAdmin({ ...active, type: 'group' }, message.mine ? init.user.id : message.fromid)" class="gim-admin-badge">{{ t('administrator') }}</span></template><time>{{ timeLabel(message.timestamp) }}</time></div>
                <div class="gim-bubble">
                  <template v-if="message.attachments?.length"><div class="gim-message-images"><template v-for="image in message.attachments" :key="image.url"><img v-if="image.kind === 'image' && safeAttachmentUrl(image.url)" class="gim-message-image" :src="image.url" :alt="image.name" /></template></div><span v-if="message.content && message.content !== message.attachments[0]?.name" class="gim-message-caption">{{ message.content }}</span></template>
                  <template v-else-if="message.attachment?.kind === 'image' && safeAttachmentUrl(message.attachment.url)"><img class="gim-message-image" :src="message.attachment.url" :alt="message.attachment.name" /><span v-if="message.content && message.content !== message.attachment.name" class="gim-message-caption">{{ message.content }}</span></template>
                  <div v-else-if="message.attachment?.kind === 'audio' && safeAttachmentUrl(message.attachment.url)" class="gim-voice-message"><audio controls preload="none" :src="message.attachment.url" :aria-label="t('playVoice')" /><small v-if="message.attachment.duration">{{ t('durationSeconds', { count: message.attachment.duration }) }}</small></div>
                  <a v-else-if="message.attachment?.kind === 'file' && safeAttachmentUrl(message.attachment.url)" :href="message.attachment.url" target="_blank" rel="noopener noreferrer" download>{{ message.attachment.name }} ↗</a>
                  <div v-else-if="active.type === 'ai' && !message.mine && message.content" class="gim-markdown" v-html="markdown.render(message.content)" />
                  <template v-else>{{ message.content }}</template>
                  <span v-if="message.pending" class="gim-ai-progress" role="status"><span class="gim-ai-dots" aria-hidden="true">● ● ●</span>{{ message.content ? t('generating') : t('thinking') }}</span>
                  <span v-if="message.error || message.errorKey" class="gim-ai-error" role="alert">{{ message.errorKey ? t(message.errorKey) : message.error }}</span>
                </div>
                <small v-if="message.mine && active.type !== 'ai'" class="gim-read-state" :class="{ 'is-read': message.readBy?.length }">{{ message.readBy?.length ? active.type === 'group' ? t('messageReadCount', { count: message.readBy.length }) : t('messageRead') : t('messageUnread') }}</small>
              </div>
            </div>
            </template>
          </div>
          <div class="gim-composer">
            <div class="gim-chat-tools">
              <button v-for="(tool, index) in toolbarItems" :key="tool.id" type="button"
                :class="{ 'gim-tool-right-start': tool.align === 'right' && toolbarItems[index - 1]?.align !== 'right', 'gim-tool-text': tool.text !== undefined }"
                :aria-label="tool.label" :title="tool.title || tool.label" :disabled="tool.disabled" :aria-busy="toolbarBusy.has(`${activeKey}:${tool.id}`) || undefined"
                @click="runToolbar(tool)">
                <span v-if="tool.text !== undefined">{{ tool.text }}</span>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path :d="tool.icon || 'M12 5v14M5 12h14'" /></svg>
              </button>
              <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onComposerImage" />
              <input ref="fileInput" type="file" hidden @change="sendAttachment($event, 'file')" />
              <div v-if="emojiOpen && !composerRestriction" class="gim-emoji-picker"><button v-for="emoji in emojis" :key="emoji" type="button" :aria-label="t('insertEmoji', { emoji })" @click="insertEmoji(emoji)">{{ emoji }}</button></div>
            </div>
            <p v-if="toolbarError" class="gim-toolbar-error" role="alert">{{ errorText(toolbarError) }}</p>
            <div v-if="voiceState !== 'idle'" class="gim-voice-recorder">
              <span v-if="voiceState === 'requesting'" role="status">{{ t('requestingMicrophone') }}</span>
              <template v-else-if="voiceState === 'recording'"><span class="gim-recording-dot" aria-hidden="true" /><span role="status">{{ t('recordingProgress', { count: voiceDuration }) }}</span><button type="button" :aria-label="t('stopRecording')" @click="stopVoice">{{ t('stop') }}</button></template>
              <audio v-else controls preload="metadata" :src="voicePreview" :aria-label="t('previewRecording')" />
              <button type="button" :aria-label="t('cancelRecording')" @click="cancelVoice(); voiceSending = false; toolbarError = ''">{{ t('cancel') }}</button>
            </div>
            <div v-else class="gim-composer-input">
              <div v-if="pendingImages.length" class="gim-image-previews"><div v-for="(image, index) in pendingImages" :key="image.url" class="gim-image-preview"><img :src="image.url" :alt="image.file.name" /><button type="button" :aria-label="t('removeImage')" :disabled="imageSending" @click="removePendingImage(index)">×</button></div></div>
              <textarea v-model="draft" :aria-label="t('messageInput')" :disabled="!!composerRestriction || imageSending" :placeholder="composerRestriction || (sendKey === 'enter' ? t('messagePlaceholder') : t('ctrlMessagePlaceholder'))" rows="3" @input="publishTyping" @keydown="onComposerKeydown" @paste="onComposerImage" @blur="stopTyping" />
            </div>
            <div class="gim-composer-footer"><span>{{ composerRestriction || (voiceState !== 'idle' ? voiceState === 'preview' ? t('voicePreviewHint', { count: voiceDuration }) : t('stopToPreview') : sendKey === 'enter' ? t('newLineHint') : t('ctrlSend')) }}</span><button v-if="voiceState !== 'idle'" type="button" :aria-label="t('sendVoice')" :disabled="voiceState !== 'preview' || voiceSending || !!composerRestriction" @click="sendVoice">{{ voiceSending ? t('uploading') : t('send') }} <span>↗</span></button><button v-else type="button" :disabled="(!draft.trim() && !pendingImages.length) || !!composerRestriction || imageSending" @click="send">{{ imageSending ? t('uploading') : t('send') }} <span>↗</span></button></div>
          </div>
        </div>
      </section>

      <div v-if="utility" class="gim-modal-backdrop" @click.self="!managementBusy && (utility = null)">
        <section class="gim-modal" :aria-label="utilityTitle">
          <header><strong>{{ utilityTitle }}</strong><button type="button" :aria-label="t('closeDialog')" :disabled="managementBusy" @click="utility = null">×</button></header>
          <div v-if="utility === 'call-info'" class="gim-management-form gim-call-info" role="status">
            <p>{{ t('callRequired') }}</p>
            <p class="gim-form-hint">{{ t('callIntegrationHint') }}</p>
            <footer class="gim-management-footer"><button type="button" :aria-label="t('callIntegrationConfirm')" @click="utility = null">{{ t('callIntegrationConfirm') }}</button></footer>
          </div>
          <template v-else-if="utility === 'add'">
            <form class="gim-find-form" @submit.prevent="runFind"><input v-model="findQuery" :aria-label="t('findUser')" :placeholder="t('findUserPlaceholder')" /><button type="submit">{{ t('find') }}</button></form>
            <p v-if="findError" class="gim-form-error">{{ errorText(findError) }}</p>
            <p v-if="findBusy" class="gim-empty">{{ t('finding') }}</p>
            <div v-else class="gim-modal-list">
              <div v-for="contact in findResults" :key="`${contact.type}:${contact.id}`" class="gim-find-row"><span class="gim-avatar" :class="{ 'gim-group-avatar': contact.type === 'group' }"><img v-if="contact.type !== 'group' || contact.avatar" :src="contact.avatar || defaultAvatar" :alt="displayName(contact)" /><span v-else>{{ avatarLetter(contact) }}</span></span><span><strong>{{ displayName(contact) }}</strong><small>{{ contact.sign || (contact.type === 'group' ? t('groups') : t('contactId', { id: contact.id })) }}</small></span><button v-if="contact.type === 'group'" type="button" @click="chat({ ...contact, type: 'group' }); utility = null">{{ t('chat') }}</button><button v-else type="button" :disabled="isBlocked(contact.id) || friends.some(item => String(item.id) === String(contact.id)) || requestedIds.has(String(contact.id)) || addBusy === String(contact.id)" @click="requestAdd(contact)">{{ isBlocked(contact.id) ? t('blockedUser') : friends.some(item => String(item.id) === String(contact.id)) ? t('alreadyAdded') : requestedIds.has(String(contact.id)) ? t('requested') : t('add') }}</button></div>
              <p v-if="!findResults.length" class="gim-empty">{{ findContacts ? t('noResults') : t('findContactsRequired') }}</p>
            </div>
          </template>
          <form v-else-if="utility === 'friend-group' || utility === 'accept-friend'" class="gim-management-form" @submit.prevent="submitFriendManagement">
            <p v-if="managedFriend && utility === 'accept-friend'">{{ t('addToCategory', { name: displayName(managedFriend) }) }}</p>
            <label v-if="utility !== 'friend-group' && !creatingFriendGroup">{{ t('friendCategory') }}<select v-model="selectedGroupId" :aria-label="t('chooseCategory')" :disabled="managementBusy"><option v-for="group in friendGroups" :key="group.id" :value="group.id">{{ group.groupname }}</option></select>
            </label>
            <label v-if="utility === 'friend-group' || creatingFriendGroup">{{ t('categoryName') }}<input v-model="newFriendGroupName" :aria-label="t('categoryName')" :placeholder="t('categoryNamePlaceholder')" maxlength="30" :disabled="managementBusy" /></label>
            <button v-if="utility !== 'friend-group' && !creatingFriendGroup" type="button" class="gim-text-action" :disabled="managementBusy" @click="creatingFriendGroup = true; newFriendGroupName = ''">＋ {{ t('newCategory') }}</button>
            <button v-else-if="creatingFriendGroup && friendGroups.length" type="button" class="gim-text-action" :disabled="managementBusy" @click="creatingFriendGroup = false">{{ t('chooseExistingCategory') }}</button>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <footer class="gim-management-footer"><button type="button" :disabled="managementBusy" @click="utility = utility === 'accept-friend' ? 'inbox' : null">{{ t('cancel') }}</button><button type="submit" :disabled="managementBusy">{{ managementBusy ? t('saving') : utility === 'accept-friend' ? t('acceptAndAdd') : t('confirm') }}</button></footer>
          </form>
          <form v-else-if="utility === 'create-group' || utility === 'invite'" class="gim-management-form" @submit.prevent="submitGroupManagement">
            <label v-if="utility === 'create-group'">{{ t('groupName') }}<input v-model="newGroupName" :aria-label="t('groupName')" :placeholder="t('groupNamePlaceholder')" maxlength="40" :disabled="managementBusy" /></label>
            <p v-else>{{ t('inviteToNamedGroup', { name: managedGroup ? displayName(managedGroup) : '' }) }}</p>
            <input v-model="memberQuery" :aria-label="t('searchSelectableFriends')" :placeholder="t('searchFriends')" :disabled="managementBusy" />
            <p v-if="utility === 'invite' && groupMembersBusy[activeKey || '']" class="gim-form-hint">{{ t('loadingMembers') }}</p>
            <button v-else-if="utility === 'invite' && groupMembersError[activeKey || '']" class="gim-history-error" type="button" @click="managedGroup && fetchGroupMembers(managedGroup)">{{ t('membersLoadFailed') }}</button>
            <div class="gim-member-options">
              <label v-for="friend in selectableFriends" :key="friend.id" class="gim-member-option">
                <input v-model="selectedMemberIds" type="checkbox" :value="String(friend.id)" :disabled="managementBusy || (utility === 'invite' && (existingMemberIds.has(String(friend.id)) || groupMembersBusy[activeKey || ''] || groupMembersError[activeKey || '']))" />
                <span class="gim-avatar" :class="{ 'gim-offline': isOffline(friend) }"><img :src="friend.avatar || defaultAvatar" :alt="friend.username || ''" /></span>
                <span class="gim-contact-copy"><strong>{{ displayName(friend) }}</strong><small>{{ utility === 'invite' && existingMemberIds.has(String(friend.id)) ? t('alreadyInGroup') : friend.sign || (isOffline(friend) ? t('offline') : t('friend')) }}</small></span>
              </label>
              <p v-if="!selectableFriends.length" class="gim-form-hint">{{ t('noSelectableFriends') }}</p>
            </div>
            <p class="gim-form-hint">{{ t('selectedFriends', { count: selectedMemberIds.length }) }}</p>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <footer class="gim-management-footer"><button type="button" :disabled="managementBusy" @click="utility = null">{{ t('cancel') }}</button><button type="submit" :disabled="managementBusy || (utility === 'invite' && (groupMembersBusy[activeKey || ''] || groupMembersError[activeKey || '']))">{{ managementBusy ? t('submitting') : utility === 'create-group' ? t('createGroupConfirm') : t('sendInvites') }}</button></footer>
          </form>
          <form v-else-if="utility === 'rename-group'" class="gim-management-form" @submit.prevent="saveGroupProfile()">
            <label>{{ t('groupName') }}<input v-model="newGroupName" :aria-label="t('groupName')" :placeholder="t('groupNamePlaceholder')" maxlength="40" :disabled="managementBusy" /></label>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <footer class="gim-management-footer"><button type="button" :disabled="managementBusy" @click="utility = 'members'; managementError = ''">{{ t('cancel') }}</button><button type="submit" :disabled="managementBusy">{{ managementBusy ? t('saving') : t('saveGroupName') }}</button></footer>
          </form>
          <form v-else-if="utility === 'remove-member' || utility === 'dismiss-group'" class="gim-management-form" @submit.prevent="moderateGroup(utility === 'remove-member' ? 'remove' : 'dismiss', utility === 'remove-member' ? managedMember || undefined : undefined)">
            <template v-if="utility === 'remove-member'"><p>{{ t('confirmRemoveMember', { name: managedMember ? displayName(managedMember) : '', group: managedGroup ? displayName(managedGroup) : '' }) }}</p><p class="gim-form-hint">{{ t('removeMemberHint') }}</p></template>
            <template v-else><p>{{ t('confirmDismissGroup', { name: managedGroup ? displayName(managedGroup) : '' }) }}</p><p class="gim-form-hint">{{ t('dismissGroupHint') }}</p></template>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <footer class="gim-management-footer"><button type="button" :disabled="managementBusy" @click="utility = 'members'; managementError = ''">{{ t('cancel') }}</button><button type="submit" class="gim-danger" :disabled="managementBusy">{{ managementBusy ? t('submitting') : utility === 'remove-member' ? t('confirmRemove') : t('confirmDismiss') }}</button></footer>
          </form>
          <form v-else-if="utility === 'leave-group'" class="gim-management-form" @submit.prevent="submitGroupManagement">
            <p>{{ t('confirmLeaveGroup', { name: managedGroup ? displayName(managedGroup) : '' }) }}</p><p class="gim-form-hint">{{ t('leaveGroupHint') }}</p>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <footer class="gim-management-footer"><button type="button" :disabled="managementBusy" @click="utility = null">{{ t('cancel') }}</button><button type="submit" class="gim-danger" :disabled="managementBusy">{{ managementBusy ? t('leaving') : t('confirmLeave') }}</button></footer>
          </form>
          <div v-else-if="utility === 'settings'" class="gim-settings"><button type="button" class="gim-blocklist-entry" :aria-label="t('blocklist')" @click="openUtility('blocklist')">{{ t('blocklist') }}<span>{{ blockedUsers.length }} ›</span></button><label>{{ t('darkMode') }}<button class="gim-theme-switch" type="button" role="switch" :aria-label="t('darkMode')" :aria-checked="theme === 'dark'" @click="theme = theme === 'dark' ? 'light' : 'dark'; saveSettings()"><span aria-hidden="true" /></button></label><label>{{ t('sendShortcut') }}<select v-model="sendKey" @change="saveSettings"><option value="enter">{{ t('enterSend') }}</option><option value="ctrl-enter">{{ t('ctrlSend') }}</option></select></label></div>
          <form v-else-if="(utility === 'delete-friend' || utility === 'block-friend') && managedFriend" class="gim-management-form gim-friend-confirm" @submit.prevent="submitFriendAction(utility === 'delete-friend' ? 'delete' : 'block', managedFriend)">
            <p>{{ t(utility === 'delete-friend' ? 'confirmDeleteFriend' : 'confirmBlockFriend', { name: displayName(managedFriend) }) }}</p>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <footer class="gim-management-footer"><button type="button" :disabled="managementBusy" @click="utility = null">{{ t('cancel') }}</button><button type="submit" class="gim-danger" :disabled="managementBusy">{{ managementBusy ? t('submitting') : utility === 'delete-friend' ? t('deleteFriend') : t('blockFriend') }}</button></footer>
          </form>
          <div v-else-if="utility === 'blocklist'" class="gim-modal-list gim-blocklist">
            <p class="gim-form-hint">{{ t('unblockHint') }}</p>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <div v-for="contact in blockedUsers" :key="contact.id" class="gim-blocklist-row">
              <span class="gim-avatar gim-blocked"><img :src="contact.avatar || defaultAvatar" :alt="displayName(contact)" /></span>
              <span class="gim-contact-copy"><strong>{{ displayName(contact) }}</strong><small>{{ t('blockedUser') }}</small></span>
              <button type="button" :aria-label="t('unblockNamedFriend', { name: displayName(contact) })" :disabled="managementBusy" @click="submitFriendAction('unblock', contact)">{{ t('unblockFriend') }}</button>
            </div>
            <p v-if="!blockedUsers.length" class="gim-empty">{{ t('emptyBlocklist') }}</p>
          </div>
          <div v-else-if="utility === 'inbox'" class="gim-modal-list"><div v-for="notice in notices" :key="notice.id" class="gim-notice"><div><strong>{{ notice.title }}</strong><small>{{ notice.timestamp ? timeLabel(notice.timestamp) : '' }}</small></div><p>{{ notice.content }}</p><div v-if="!notice.resolved" class="gim-notice-actions"><template v-if="notice.type === 'friend-request' && notice.contact"><button type="button" @click="actOnNotice(notice, 'accept')">{{ t('accept') }}</button><button type="button" @click="actOnNotice(notice, 'reject')">{{ t('reject') }}</button></template><button v-else-if="!notice.read" type="button" @click="actOnNotice(notice, 'read')">{{ t('markRead') }}</button></div><small v-else>{{ t('resolved') }}</small></div><p v-if="!notices.length" class="gim-empty">{{ t('noMessages') }}</p></div>
          <div v-else-if="utility === 'members' && managedGroup" class="gim-modal-list">
            <div class="gim-group-profile">
              <button v-if="canManageGroup(managedGroup)" type="button" class="gim-avatar gim-own-avatar gim-group-avatar" :aria-label="t('changeGroupAvatar')" :title="managementBusy ? t('savingProfile') : t('changeGroupAvatarHint')" :disabled="managementBusy" :aria-busy="managementBusy" @click="groupAvatarInput?.click()">
                <img v-if="groupInfo(managedGroup).avatar" :src="groupInfo(managedGroup).avatar" :alt="displayName(groupInfo(managedGroup))" /><span v-else>{{ avatarLetter(groupInfo(managedGroup)) }}</span>
                <span class="gim-avatar-edit" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 6 2-3h4l2 3h4v14H4V6Z"/><circle cx="12" cy="12" r="3"/></svg></span>
              </button>
              <span v-else class="gim-avatar gim-group-avatar"><img v-if="groupInfo(managedGroup).avatar" :src="groupInfo(managedGroup).avatar" :alt="displayName(groupInfo(managedGroup))" /><span v-else>{{ avatarLetter(groupInfo(managedGroup)) }}</span></span>
              <input v-if="canManageGroup(managedGroup)" ref="groupAvatarInput" type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" :aria-label="t('chooseGroupAvatar')" :disabled="managementBusy" @change="saveGroupProfile($event)" />
              <div class="gim-contact-copy"><strong>{{ displayName(groupInfo(managedGroup)) }}</strong><small>{{ canManageGroup(managedGroup) ? t('groupAvatarHint') : t('groupProfile') }}</small></div>
              <button v-if="canManageGroup(managedGroup)" type="button" class="gim-text-action" :aria-label="t('renameGroup')" :disabled="managementBusy" @click="openUtility('rename-group')">{{ t('renameGroup') }}</button>
            </div>
            <div class="gim-member-actions">
              <button type="button" :aria-label="t('inviteToGroup')" :disabled="managementBusy" @click="openUtility('invite')">＋ {{ t('inviteFriends') }}</button>
              <button v-if="canManageGroup(managedGroup)" type="button" :aria-label="isGroupMuted(managedGroup) ? t('unmuteGroup') : t('muteGroup')" :disabled="managementBusy" @click="moderateGroup('mute')">{{ isGroupMuted(managedGroup) ? t('unmuteGroup') : t('muteGroup') }}</button>
              <button v-if="isGroupOwner(managedGroup)" type="button" class="gim-danger" :aria-label="t('dismissGroup')" :disabled="managementBusy" @click="openUtility('dismiss-group')">{{ t('dismissGroup') }}</button>
              <button v-else type="button" class="gim-danger" :aria-label="t('leaveGroup')" :disabled="managementBusy" @click="openUtility('leave-group')">{{ t('leaveGroup') }}</button>
            </div>
            <p v-if="isGroupMuted(managedGroup)" class="gim-form-hint">{{ t('groupMutedHint') }}</p>
            <p v-if="managementError" class="gim-form-error" role="alert">{{ errorText(managementError) }}</p>
            <p v-if="groupMembersBusy[managedGroupKey]" class="gim-empty">{{ t('loadingMembers') }}</p>
            <button v-else-if="groupMembersError[managedGroupKey]" type="button" class="gim-history-error" @click="fetchGroupMembers(managedGroup)">{{ t('membersLoadFailed') }}</button>
            <p v-else-if="!loadGroupMembers && !groupMembers[managedGroupKey]" class="gim-empty">{{ t('membersUnavailable') }}</p>
            <template v-else>
              <div v-for="member in groupMembers[managedGroupKey] || []" :key="member.id" class="gim-member-row">
                <button type="button" class="gim-contact" :disabled="managementBusy || String(member.id) === String(init.user.id)" @click="chat({ ...member, type: 'friend' }); utility = null">
                  <span class="gim-avatar" :class="{ 'gim-offline': String(member.id) !== String(init.user.id) && isOffline(member) }"><img :src="(String(member.id) === String(init.user.id) ? userAvatar : member.avatar) || defaultAvatar" :alt="member.username || ''" /></span>
                  <span class="gim-contact-copy"><strong><span>{{ String(member.id) === String(init.user.id) ? username : displayName(member) }}</span><span v-if="isGroupOwner(managedGroup, member.id)" class="gim-owner-badge">{{ t('owner') }}</span><span v-else-if="isGroupAdmin(managedGroup, member.id)" class="gim-admin-badge">{{ t('administrator') }}</span></strong><small><span v-if="isMemberMuted(managedGroup, member)" class="gim-muted-badge">{{ t('muted') }}</span><template v-else>{{ String(member.id) === String(init.user.id) ? t('me') : member.sign || t('privateChatHint') }}</template></small></span>
                </button>
                <div v-if="canManageMember(managedGroup, member)" class="gim-member-controls">
                  <button v-if="isGroupOwner(managedGroup)" type="button" class="gim-admin-action" :aria-label="isGroupAdmin(managedGroup, member.id) ? t('removeNamedAdmin', { name: displayName(member) }) : t('makeNamedAdmin', { name: displayName(member) })" :disabled="managementBusy" @click="moderateGroup('admin', member)">{{ isGroupAdmin(managedGroup, member.id) ? t('removeAdmin') : t('makeAdmin') }}</button>
                  <button type="button" :aria-label="isMemberMuted(managedGroup, member) ? t('unmuteNamedMember', { name: displayName(member) }) : t('muteNamedMember', { name: displayName(member) })" :disabled="managementBusy" @click="moderateGroup('mute', member)">{{ isMemberMuted(managedGroup, member) ? t('unmute') : t('mute') }}</button>
                  <button type="button" class="gim-danger" :aria-label="t('removeNamedMember', { name: displayName(member) })" :disabled="managementBusy" @click="managedMember = member; openUtility('remove-member')">{{ t('remove') }}</button>
                </div>
              </div>
              <p v-if="!groupMembers[managedGroupKey]?.length" class="gim-empty">{{ t('noMembers') }}</p>
            </template>
          </div>
          <div v-else class="gim-modal-list"><div v-for="(message, index) in activeMessages" :key="message.mid || index" class="gim-history-row" :class="{ 'gim-blocked': isBlockedMessage(message) }"><strong>{{ message.mine ? username : message.username || (active && displayName(active)) }}</strong><span v-if="isBlockedMessage(message)" class="gim-blocked-label">{{ t('blockedUser') }}</span><time>{{ timeLabel(message.timestamp) }}</time><p>{{ message.notice ? chatNoticeText(message) : message.content }}</p></div><p v-if="!activeMessages.length" class="gim-empty">{{ t('noHistory') }}</p></div>
        </section>
      </div>
  </div>
</template>

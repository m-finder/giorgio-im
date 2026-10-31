import type { ImLocaleMessages, ImLocales } from './locales'

export type ImId = string | number
export type ImChatType = 'friend' | 'group' | 'ai'

export interface ImUser {
  id: ImId
  username: string
  avatar?: string
  sign?: string
  status?: 'online' | 'hide'
}

export interface ImContact {
  id: ImId
  type?: ImChatType
  username?: string
  groupname?: string
  avatar?: string
  sign?: string
  status?: 'online' | 'offline'
  members?: number
  /** Group owner's user ID. Omit when ownership is unknown. */
  ownerId?: ImId
  /** Group administrator IDs. The owner remains a separate role. */
  adminIds?: ImId[]
  /** Whether all ordinary group members are muted. */
  muteAll?: boolean
  /** Open an AI conversation in a maximised window. */
  maximized?: boolean
}

export interface ImGroupMember extends ImContact {
  /** Whether this member is individually muted in the loaded group. */
  muted?: boolean
}

export interface ImFriendGroup {
  id: ImId
  groupname: string
  list: ImContact[]
}

export interface ImInit {
  user: ImUser
  friend?: ImFriendGroup[]
  group?: ImContact[]
  /** Users blocked by the current user. Blocking does not erase chat history. */
  blocked?: ImContact[]
  /** Historical conversations, including contacts removed from the friend list. */
  recent?: (ImContact & { type: ImChatType })[]
}

export interface ImMessage {
  id: ImId
  type: ImChatType
  content: string
  username?: string
  groupname?: string
  avatar?: string
  timestamp?: number
  mid?: ImId
  fromid?: ImId
  mine?: boolean
  /** Readers confirmed by the server, excluding the sender. */
  readBy?: ImId[]
  /** Quiet timeline entries, rendered without a message bubble or unread alerts. */
  notice?: Pick<ImChatNotice, 'event' | 'sign'>
  attachment?: ImAttachment
  /** AI replies: cumulative content replaces the pending reply; defaults to true. */
  finished?: boolean
  /** AI request failure; ends pending state and preserves any partial reply. */
  error?: string
}

export interface ImChatNotice {
  id: ImId
  event: 'online' | 'offline' | 'signature'
  sign?: string
  mid?: ImId
  timestamp?: number
}

export interface ImReadPayload {
  id: ImId
  type: 'friend' | 'group'
  mids: ImId[]
}

export interface ImReadReceipt extends ImReadPayload {
  readerId: ImId
}

export interface ImTypingPayload {
  id: ImId
  type: 'friend' | 'group'
  typing: boolean
}

export interface ImTypingState extends ImTypingPayload {
  fromid: ImId
  username?: string
  /** Absolute expiry in milliseconds. Late typing events are discarded. */
  expiresAt?: number
}

export interface ImAttachment {
  kind: 'image' | 'file' | 'audio'
  url: string
  name: string
  /** Audio clip duration in seconds. */
  duration?: number
}

export type ImCallType = 'voice' | 'video'

export interface ImCallPayload {
  type: ImCallType
  user: ImUser
  receiver: ImContact & { type: ImChatType }
}

export interface ImSendPayload {
  /** Stable client message ID for optimistic display, retries and server echoes. */
  mid?: ImId
  user: ImUser
  receiver: ImContact & { type: ImChatType }
  content: string
  timestamp: number
  attachment?: ImAttachment
}

export interface ImNotice {
  id: ImId
  type: 'friend-request' | 'system'
  title: string
  content: string
  timestamp?: number
  contact?: ImContact
  read?: boolean
  resolved?: boolean
}

export interface ImCreateGroupPayload {
  groupname: string
  /** Friends to invite, excluding the current user. */
  members: ImContact[]
}

export type ImBuiltinTool = 'emoji' | 'image' | 'file' | 'voice' | 'voice-call' | 'video-call' | 'history'

export interface ImToolbarState {
  readonly user: ImUser
  readonly receiver: ImContact & { type: ImChatType }
  readonly draft: string
  /** Empty when composing is allowed; otherwise contains the current restriction. */
  readonly restriction: string
}

export interface ImToolbarContext extends ImToolbarState {
  readonly id: string
  /** Helpers only apply while the original conversation remains active and unrestricted. */
  setDraft: (value: string) => void
  /** Append text to the current draft. */
  insertText: (value: string) => void
  /** Invoke this button's original built-in action; custom IDs have no default action. */
  runDefault: () => void
}

export interface ImToolbarItem {
  /** Built-in IDs merge with defaults; any other unique ID adds a button. */
  id: string
  label?: string
  title?: string
  /** SVG path data in a 24×24 viewBox, never raw HTML. */
  icon?: string
  /** Render text instead of an SVG icon. */
  text?: string
  visible?: boolean | ((state: ImToolbarState) => boolean)
  /** Cannot override composing restrictions, except for the history button. */
  disabled?: boolean | ((state: ImToolbarState) => boolean)
  align?: 'left' | 'right'
  /** Ascending order within each side. Built-ins: 10–60, 1000; new buttons: 100. */
  order?: number
  /** Replaces the default click action. Call context.runDefault() to retain it. */
  onClick?: (context: ImToolbarContext) => void | Promise<void>
}

export interface ImWidgetApi {
  /** Replace server contacts, preserving removed friends as read-only history. */
  setContacts: (contacts: Pick<ImInit, 'friend' | 'group' | 'blocked' | 'recent'>) => void
  /** Apply a server profile update without emitting edit callbacks. */
  setUser: (user: Partial<Omit<ImUser, 'id'>>) => void
  /** Add or update a contact in lists and any open conversation. */
  updateContact: (contact: ImContact & { type: ImChatType }, groupId?: ImId) => void
  /** Replace a group's member snapshot and mute states after a server push. */
  setGroupMembers: (id: ImId, members: ImGroupMember[]) => void
  chat: (contact: ImContact & { type: ImChatType }) => void
  getMessage: (message: ImMessage) => void
  /** Append a quiet status notice only when this friend's conversation is open. */
  getChatNotice: (notice: ImChatNotice) => void
  /** Apply confirmed readers without creating a conversation or unread messages. */
  setMessageRead: (receipt: ImReadReceipt) => void
  /** Apply temporary typing state; automatically expires and never triggers alerts. */
  setTyping: (state: ImTypingState) => void
  addContacts: (contact: ImContact & { type: ImChatType }, groupId?: ImId) => void
  /** Add or update a friend category supplied by the host application. */
  addFriendGroup: (group: ImFriendGroup) => void
  /** Move an existing friend into an existing category. */
  moveFriend: (id: ImId, groupId: ImId) => boolean
  /** Persist deletion/blocking first. Return false on rejection; failures reject the promise. */
  deleteFriend: (id: ImId) => Promise<boolean>
  blockFriend: (id: ImId) => Promise<boolean>
  unblockFriend: (id: ImId) => Promise<boolean>
  /** Apply a server block update without invoking persistence callbacks. */
  setFriendBlocked: (contact: ImContact, blocked: boolean) => void
  /** Replace the authoritative blocklist, retaining historical conversations. */
  setBlockedUsers: (contacts: ImContact[]) => void
  getBlockedUsers: () => ImContact[]
  /** Remove a friend after a server push; retain recent conversations as read-only history. */
  removeFriend: (id: ImId) => void
  /** Remove a group and its conversations after leaving or being removed. */
  removeGroup: (id: ImId) => void
  /** Apply a server mute update; omit memberId to update all-member muting. */
  setGroupMute: (id: ImId, muted: boolean, memberId?: ImId) => void
  /** Apply a server administrator update without calling management callbacks. */
  setGroupAdmin: (id: ImId, memberId: ImId, admin: boolean) => void
  getNotice: (notice: ImNotice) => void
  setFriendStatus: (id: ImId, status: 'online' | 'offline') => void
  setChatStatus: (status: string, receiver?: { id: ImId; type: ImChatType }) => void
  /** Replace toolbar overrides and extensions. Pass [] to restore built-in defaults. */
  setToolbar: (items: ImToolbarItem[]) => void
  open: () => void
  close: () => void
  /** Close all windows and reset their layout, keeping contacts and message history. */
  resetWindows: () => void
  /** Change this instance's language. Optionally register or patch its messages. */
  setLocale: (locale: string, messages?: Partial<ImLocaleMessages>) => void
}

export interface ImOptions {
  init: ImInit
  /** UI language. Built-ins: 'zh-CN' (default), 'en' and English regional variants. */
  locale?: string
  /** Custom message packs or overrides, indexed by locale. Missing keys fall back to the built-in pack. */
  locales?: ImLocales
  target?: HTMLElement
  /** Enable a single customer service chat with a minimised launcher, without a contacts panel. */
  customerService?: ImContact & { type: 'friend' | 'ai' }
  /** Back up user and conversation data in encrypted localStorage. Defaults to false. */
  enableLocalStorage?: boolean
  /** Local backup passphrase. Defaults to 'giorgio-im'; never stored in localStorage. */
  encryptionKey?: string
  /** Reports unreadable backups or failed writes; messaging remains available. */
  onStorageError?: (error: Error) => void
  loadHistory?: (receiver: ImContact & { type: ImChatType }) => Promise<ImMessage[]> | ImMessage[]
  /** Load the selected group's members when its member list is opened. */
  loadGroupMembers?: (receiver: ImContact & { type: 'group' }) => Promise<ImGroupMember[]> | ImGroupMember[]
  findContacts?: (query: string) => Promise<ImContact[]> | ImContact[]
  requestFriend?: (contact: ImContact) => Promise<boolean | void> | boolean | void
  /** Persist friend deletion/blocking before changing local state; false or throw cancels the action. */
  deleteFriend?: (contact: ImContact) => Promise<boolean | void> | boolean | void
  blockFriend?: (contact: ImContact) => Promise<boolean | void> | boolean | void
  unblockFriend?: (contact: ImContact) => Promise<boolean | void> | boolean | void
  /** Persist an accepted friend request before the local contact is added. */
  acceptFriend?: (contact: ImContact, groupId: ImId, notice: ImNotice) => Promise<boolean | void> | boolean | void
  createFriendGroup?: (groupname: string) => Promise<ImFriendGroup> | ImFriendGroup
  /** Persist a move; return false or throw to leave the local category unchanged. */
  moveFriend?: (contact: ImContact, groupId: ImId) => Promise<boolean | void> | boolean | void
  createGroup?: (payload: ImCreateGroupPayload) => Promise<ImContact> | ImContact
  leaveGroup?: (receiver: ImContact & { type: 'group' }) => Promise<boolean | void> | boolean | void
  inviteGroupMembers?: (receiver: ImContact & { type: 'group' }, members: ImContact[]) => Promise<boolean | void> | boolean | void
  /** Management actions: return false or throw to keep local state unchanged. */
  removeGroupMember?: (receiver: ImContact & { type: 'group' }, member: ImGroupMember) => Promise<boolean | void> | boolean | void
  dismissGroup?: (receiver: ImContact & { type: 'group' }) => Promise<boolean | void> | boolean | void
  muteGroupMember?: (receiver: ImContact & { type: 'group' }, member: ImGroupMember, muted: boolean) => Promise<boolean | void> | boolean | void
  muteGroup?: (receiver: ImContact & { type: 'group' }, muted: boolean) => Promise<boolean | void> | boolean | void
  /** Owner-only appointment or removal of a group administrator. */
  setGroupAdmin?: (receiver: ImContact & { type: 'group' }, member: ImGroupMember, admin: boolean) => Promise<boolean | void> | boolean | void
  /** Save a new group name; return false or throw to keep the original name. */
  renameGroup?: (receiver: ImContact & { type: 'group' }, groupname: string) => Promise<boolean | void> | boolean | void
  /** Upload a group avatar (up to 2 MiB); defaults to a local image data URL. */
  uploadGroupAvatar?: (file: File, receiver: ImContact & { type: 'group' }) => Promise<string> | string
  uploadAttachment?: (file: File, receiver: ImContact & { type: ImChatType }) => Promise<string> | string
  /** Upload a recorded clip and return a durable URL. Falls back to uploadAttachment. */
  uploadVoice?: (file: File, receiver: ImContact & { type: ImChatType }, duration: number) => Promise<string> | string
  /** Hand off a voice/video call to the host RTC service; omit to show integration guidance. */
  onCall?: (payload: ImCallPayload) => void | Promise<void>
  /** Override built-in toolbar buttons by ID or add custom buttons. */
  toolbar?: ImToolbarItem[]
  /** Upload a raster avatar (up to 2 MiB) and return its URL; defaults to a local data URL. */
  uploadAvatar?: (file: File, user: ImUser) => Promise<string> | string
  notices?: ImNotice[]
  /** Show a floating prompt for unread conversations. Defaults to true. */
  messageNotification?: boolean
  /** Incoming-message sound: true for the bundled synthesised tone, a URL for custom audio, false to mute. Defaults to true; AI replies stay silent. */
  messageSound?: boolean | string
  /** Quiet timeline notices. Both presence and signature changes default to true. */
  chatNotices?: { presence?: boolean; signature?: boolean }
  /** AI inactivity timeout in milliseconds. Defaults to 60000. */
  chatTimeout?: number
  onSendMessage?: (payload: ImSendPayload) => void
  /** Incoming messages viewed in the active, visible conversation. AI/system entries are excluded. */
  onRead?: (payload: ImReadPayload) => void
  /** Throttled composing state. Contains no draft text. */
  onTyping?: (payload: ImTypingPayload) => void
  onOnline?: (status: 'online' | 'hide') => void
  /** Called after the signature is edited and committed by blur or Enter. */
  onSign?: (sign: string) => void
  /** Called after a non-empty nickname is edited and committed. */
  onUsername?: (username: string) => void
  /** Called once after a selected avatar is successfully changed. */
  onAvatar?: (avatar: string) => void
  onChatChange?: (receiver: ImContact & { type: ImChatType }) => void
  onFriendAdded?: (contact: ImContact, groupId?: ImId) => void
  onNoticeAction?: (notice: ImNotice, action: 'accept' | 'reject' | 'read', groupId?: ImId) => void
  onFriendGroupAdded?: (group: ImFriendGroup) => void
  onFriendRemoved?: (contact: ImContact) => void
  onFriendBlocked?: (contact: ImContact) => void
  onFriendUnblocked?: (contact: ImContact) => void
  onFriendMoved?: (contact: ImContact, groupId: ImId) => void
  onGroupCreated?: (group: ImContact) => void
  onGroupLeft?: (group: ImContact) => void
  onGroupMembersInvited?: (group: ImContact, members: ImContact[]) => void
  onGroupMemberRemoved?: (group: ImContact, member: ImGroupMember) => void
  onGroupDismissed?: (group: ImContact) => void
  onGroupMemberMuted?: (group: ImContact, member: ImGroupMember, muted: boolean) => void
  onGroupMuted?: (group: ImContact, muted: boolean) => void
  /** Reports the updated group after a successful name change. */
  onGroupRenamed?: (group: ImContact) => void
  /** Reports the updated group after a successful avatar change. */
  onGroupAvatarChanged?: (group: ImContact) => void
  /** Reports an administrator appointment or removal after saving. */
  onGroupAdminChanged?: (group: ImContact, member: ImGroupMember, admin: boolean) => void
}

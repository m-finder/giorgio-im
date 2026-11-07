import { createApp } from 'vue'
import ImWidget from './ImWidget.vue'
import type { ImOptions, ImWidgetApi } from './types'

export { ImWidget }
export { createConnectedIM, ImHttpError } from './connection'
export type { ConnectedIM, ImConnectionOptions, ImConnectionState } from './connection'
export { assertImTransport } from './transport'
export type { ImTransportOptions } from './transport'
export { zhCN, en } from './locales'
export type { ImLocaleKey, ImLocaleMessages, ImLocaleParams, ImLocales } from './locales'
export type {
  ImId, ImChatType, ImUser, ImContact, ImGroupMember, ImFriendGroup, ImInit,
  ImMessage, ImMention, ImMessageReference, ImChatNotice, ImReadPayload, ImReadReceipt, ImTypingPayload, ImTypingState,
  ImAttachment, ImSendPayload, ImNotice, ImCreateGroupPayload, ImWidgetApi, ImOptions,
  ImBuiltinTool, ImToolbarState, ImToolbarContext, ImToolbarItem,
  ImCallType, ImCallPayload,
} from './types'

/** Mount a self-contained IM widget and return its public methods. */
export function createIM(options: ImOptions): ImWidgetApi & { destroy: () => void } {
  if (typeof document === 'undefined') throw new Error('createIM 只能在浏览器中调用')
  const { target = document.body, onSendMessage, onRead, onTyping, onOnline, onSign, onUsername, onAvatar, onStorageError, onChatChange, onFriendAdded, onNoticeAction,
    onFriendGroupAdded, onFriendMoved, onFriendRemoved, onFriendBlocked, onFriendUnblocked, onGroupCreated, onGroupLeft, onGroupMembersInvited,
    onGroupMemberRemoved, onGroupDismissed, onGroupMemberMuted, onGroupMuted, onGroupNotificationsMuted, onGroupRenamed, onGroupAvatarChanged, onGroupAdminChanged, ...props } = options
  const host = document.createElement('div')
  target.appendChild(host)
  const app = createApp(ImWidget, {
    ...props,
    onSendMessage,
    onRead,
    onTyping,
    onOnline,
    onSign,
    onUsername,
    onAvatar,
    onStorageError,
    onChatChange,
    onFriendAdded,
    onNoticeAction,
    onFriendGroupAdded,
    onFriendMoved,
    onFriendRemoved,
    onFriendBlocked,
    onFriendUnblocked,
    onGroupCreated,
    onGroupLeft,
    onGroupMembersInvited,
    onGroupMemberRemoved,
    onGroupDismissed,
    onGroupMemberMuted,
    onGroupMuted,
    onGroupNotificationsMuted,
    onGroupRenamed,
    onGroupAvatarChanged,
    onGroupAdminChanged,
  })
  const widget = app.mount(host) as unknown as ImWidgetApi
  return {
    setContacts: widget.setContacts,
    setUser: widget.setUser,
    updateContact: widget.updateContact,
    setGroupMembers: widget.setGroupMembers,
    chat: widget.chat,
    getMessage: widget.getMessage,
    getChatNotice: widget.getChatNotice,
    setMessageRead: widget.setMessageRead,
    setTyping: widget.setTyping,
    addContacts: widget.addContacts,
    addFriendGroup: widget.addFriendGroup,
    moveFriend: widget.moveFriend,
    removeFriend: widget.removeFriend,
    deleteFriend: widget.deleteFriend,
    blockFriend: widget.blockFriend,
    unblockFriend: widget.unblockFriend,
    setFriendBlocked: widget.setFriendBlocked,
    setBlockedUsers: widget.setBlockedUsers,
    getBlockedUsers: widget.getBlockedUsers,
    removeGroup: widget.removeGroup,
    setGroupMute: widget.setGroupMute,
    setGroupNotificationsMuted: widget.setGroupNotificationsMuted,
    setGroupAdmin: widget.setGroupAdmin,
    getNotice: widget.getNotice,
    setFriendStatus: widget.setFriendStatus,
    setChatStatus: widget.setChatStatus,
    setToolbar: widget.setToolbar,
    open: widget.open,
    close: widget.close,
    resetWindows: widget.resetWindows,
    setLocale: widget.setLocale,
    destroy: () => { app.unmount(); host.remove() },
  }
}

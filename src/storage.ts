import { gcm } from '@noble/ciphers/aes'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import type { ImChatType, ImContact, ImFriendGroup, ImId, ImMessage, ImNotice, ImUser } from './types'
import type { ImLocaleKey } from './locales'

type StoredMessage = ImMessage & { timestamp: number; mine: boolean; pending?: boolean; errorKey?: ImLocaleKey }

export interface LocalBackup {
  version: 1
  user: ImUser
  friend: ImFriendGroup[]
  group: ImContact[]
  removedGroupIds: string[]
  removedFriendIds?: string[]
  blocked?: ImContact[]
  conversations: Record<string, ImContact & { type: ImChatType }>
  messages: Record<string, StoredMessage[]>
  unread: Record<string, number>
  friendStatus: Record<string, 'online' | 'offline'>
  notices: ImNotice[]
  openKeys: string[]
  recentKeys: string[]
  activeKey: string | null
  panelOpen: boolean
  chatOpen: boolean
  draft: string
  loadedHistory: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isContact(value: unknown): value is ImContact {
  return isRecord(value) && (typeof value.id === 'string' || typeof value.id === 'number')
}

function isBackup(value: unknown, userId: ImId): value is LocalBackup {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.user)
    || String(value.user.id) !== String(userId) || typeof value.user.username !== 'string'
    || !Array.isArray(value.friend) || !value.friend.every(group => isRecord(group) && isContact(group)
      && typeof group.groupname === 'string' && Array.isArray(group.list) && group.list.every(isContact))
    || !Array.isArray(value.group) || !value.group.every(isContact)
    || !Array.isArray(value.notices) || !value.notices.every(notice => isContact(notice) && isRecord(notice) && typeof notice.content === 'string')
    || !isRecord(value.conversations) || !isRecord(value.messages) || !isRecord(value.unread) || !isRecord(value.friendStatus)
    || typeof value.panelOpen !== 'boolean' || typeof value.chatOpen !== 'boolean' || typeof value.draft !== 'string'
    || (value.activeKey !== null && typeof value.activeKey !== 'string')) return false
  for (const field of ['openKeys', 'recentKeys', 'removedGroupIds', 'loadedHistory']) {
    if (!Array.isArray(value[field]) || !value[field].every(item => typeof item === 'string')) return false
  }
  if (value.blocked !== undefined && (!Array.isArray(value.blocked) || !value.blocked.every(isContact))) return false
  const conversations = value.conversations
  if (value.removedFriendIds !== undefined && (!Array.isArray(value.removedFriendIds)
    || !value.removedFriendIds.every(item => typeof item === 'string'))) return false
  return Object.entries(conversations).every(([key, contact]) => isContact(contact)
    && ['friend', 'group', 'ai'].includes(contact.type || '') && key === `${contact.type}:${contact.id}`)
    && Object.entries(value.messages).every(([key, messages]) => Object.hasOwn(conversations, key)
      && Array.isArray(messages) && messages.every(message => isContact(message) && isRecord(message)
        && key === `${message.type}:${message.id}` && typeof message.content === 'string'
        && typeof message.timestamp === 'number' && typeof message.mine === 'boolean'))
    && Object.entries(value.unread).every(([key, count]) => Object.hasOwn(conversations, key)
      && typeof count === 'number' && Number.isInteger(count) && count >= 0)
    && Object.values(value.friendStatus).every(status => status === 'online' || status === 'offline')
}

const encode = (value: Uint8Array) => btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''))
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))

/** Synchronous authenticated backups allow pagehide to save the latest state. */
export function createLocalBackup(userId: ImId, password: string, onError: (error: Error) => void, scope?: string) {
  const storageName = `giorgio-im-backup:${encodeURIComponent(String(userId))}${scope ? `:${encodeURIComponent(scope)}` : ''}`
  const encoder = new TextEncoder()
  let salt: Uint8Array | undefined
  let key: Uint8Array | undefined
  let previous = ''
  let blocked = false
  let lastError = ''

  return {
    read(): LocalBackup | undefined {
      try {
        const stored = localStorage.getItem(storageName)
        if (stored === null) return
        const envelope: unknown = JSON.parse(stored)
        if (!isRecord(envelope) || envelope.version !== 1 || typeof envelope.salt !== 'string'
          || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new Error('Invalid backup')
        salt = decode(envelope.salt)
        const iv = decode(envelope.iv)
        if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid backup')
        key = pbkdf2(sha256, encoder.encode(password), salt, { c: 100000, dkLen: 32 })
        const plaintext = new TextDecoder().decode(gcm(key, iv, encoder.encode(storageName)).decrypt(decode(envelope.data)))
        const backup: unknown = JSON.parse(plaintext)
        if (!isBackup(backup, userId)) throw new Error('Invalid backup data')
        previous = plaintext
        return backup
      } catch {
        blocked = true
        onError(new Error('读取本地备份失败：密钥不匹配、数据损坏或存储不可用；原备份已保留'))
      }
    },
    write(backup: LocalBackup): void {
      if (blocked) return
      try {
        const plaintext = JSON.stringify(backup)
        if (plaintext === previous) return
        salt ||= crypto.getRandomValues(new Uint8Array(16))
        key ||= pbkdf2(sha256, encoder.encode(password), salt, { c: 100000, dkLen: 32 })
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const data = gcm(key, iv, encoder.encode(storageName)).encrypt(encoder.encode(plaintext))
        localStorage.setItem(storageName, JSON.stringify({ version: 1, salt: encode(salt), iv: encode(iv), data: encode(data) }))
        previous = plaintext
        lastError = ''
      } catch {
        const message = '保存本地备份失败：存储空间不足或存储不可用'
        if (lastError !== message) { lastError = message; onError(new Error(message)) }
      }
    },
  }
}

# Giorgio IM

<p align="center"><img src="https://m-finder.github.io/images/avatar.jpeg"></p><p align="center">
<img src="https://img.shields.io/badge/Author-m--finder-red" alt="Author">
<a href="https://github.com/m-finder/giorgio-im/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
<img src="https://img.shields.io/badge/Vue-3.3%2B-42B883" alt="Vue 3.3+">
<img src="https://img.shields.io/badge/TypeScript-5%2B-3178C6" alt="TypeScript 5+">
<img src="https://img.shields.io/badge/Socket-Optional-25A162" alt="Socket integration optional">
</p>

[简体中文](README.md) | [English](README.en.md)

Vue 3 + TypeScript instant messaging widget

Contacts, friends, groups, messages, AI conversations and customer service mode

<p align="center"><img src="https://repository-images.githubusercontent.com/1440670842/afcc1279-de3b-4152-99af-2892e552f1f4"></p>


## Related packages

- [Giorgio IM](https://github.com/m-finder/giorgio-im): Vue 3 + TypeScript instant messaging component
- [Giorgio IM Socket](https://packagist.org/packages/wu/giorgio-im-socket): Laravel instant messaging backend
- [Giorgio Socket](https://packagist.org/packages/wu/giorgio-socket): Laravel WebSocket infrastructure package

## Install

Requires Vue 3.3+

The package is published to GitHub Packages

For the first install, set the scoped registry in the project `.npmrc`:

```ini
@m-finder:registry=https://npm.pkg.github.com
```

Then log in once with a GitHub classic PAT that has `read:packages` permission:

```bash
npm login --scope=@m-finder --auth-type=legacy --registry=https://npm.pkg.github.com
```

After setup, install directly:

```bash
npm install @m-finder/giorgio-im
```

GitHub Packages requires authentication even for public npm packages

## Quick start

```ts
import { createIM, type ImInit } from '@m-finder/giorgio-im'

const init: ImInit = {
  user: { id: 'me', username: 'Me' },
  friend: [{
    id: 'team',
    groupname: 'Team',
    list: [{ id: 'alice', username: 'Alice', status: 'online' }],
  }],
  group: [],
}

const im = createIM({
  init,
  onSendMessage: payload => console.log(payload),
})

im.chat({ id: 'alice', type: 'friend', username: 'Alice' })
im.open()
```

`createIM()` runs in the browser

It mounts to `document.body` and injects its styles

Destroy the instance with `im.destroy()`

## Vue component

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ImWidget, type ImInit, type ImWidgetApi } from '@m-finder/giorgio-im'

const widget = ref<ImWidgetApi | null>(null)
const init: ImInit = { user: { id: 'me', username: 'Me' }, friend: [], group: [] }
</script>

<template>
  <ImWidget ref="widget" :init="init" locale="en" />
</template>
```

The component ref exposes the same operations as `createIM()`

## Laravel + Socket

Use `createConnectedIM()` with the companion backend

```ts
import { createConnectedIM } from '@m-finder/giorgio-im'

const im = await createConnectedIM({
  apiUrl: '/api/im',
  token: () => accessToken,
  widget: { locale: 'en' },
  onConnectionChange: state => console.log(state),
  onError: (error, operation) => console.error(operation, error),
})

im.open()
```

`apiUrl` must match the backend route prefix

The backend provides `/init`, `/socket-ticket`, `/events`, `/messages` and `/uploads`

`createConnectedIM()` handles tickets, WebSocket, event catch-up, reconnects, contacts and group actions

| Option | Default |
| --- | --- |
| `token` | Required token or token function |
| `apiUrl` | `/api/im` |
| `socketUrl` | URL returned by `/init` |
| `pollInterval` | `5000` ms, minimum `1000` |
| `requestTimeout` | `15000` ms |
| `transport.requireTLS` | `true` |
| `transport.allowInsecureLocalhost` | `true` |

Use HTTPS/WSS in production

Instance methods:

```ts
await im.sync()
im.reconnect()
await im.sendMessage(payload)
im.destroy()
```

## Initial data

```ts
const init: ImInit = {
  user: {
    id: 'me',
    username: 'Me',
    avatar: '/avatar.png',
    sign: 'Online',
    status: 'online',
  },
  friend: [{
    id: 'friends',
    groupname: 'Friends',
    list: [{ id: 'alice', type: 'friend', username: 'Alice' }],
  }],
  group: [{
    id: 'room',
    type: 'group',
    groupname: 'Project',
    ownerId: 'me',
    members: 3,
  }],
  blocked: [],
  recent: [],
}
```

IDs may be strings or numbers

Friends use `username`

Groups use `groupname`

AI contacts use `type: 'ai'`

## Messages

```ts
im.getMessage({
  id: 'alice',
  type: 'friend',
  content: 'Hello',
  fromid: 'alice',
  timestamp: Date.now(),
})
```

Message types: `friend`, `group`, `ai`

Attachment shape:

```ts
{
  kind: 'image' | 'file' | 'audio',
  url: string,
  name: string,
  duration?: number,
}
```

Use `mid` to deduplicate normal messages

Use the same `mid` for cumulative AI streaming updates:

```ts
im.getMessage({ id: 'assistant', type: 'ai', mid: 'reply-1', content: 'Hello', finished: false })
im.getMessage({ id: 'assistant', type: 'ai', mid: 'reply-1', content: 'Hello, world', finished: true })
```

## Callbacks

| Callback | Purpose |
| --- | --- |
| `onSendMessage` | Send text or attachments |
| `onRead` | Report read messages |
| `onTyping` | Report composing state |
| `onUsername` / `onSign` / `onAvatar` | Save profile changes |
| `onCall` | Connect an RTC or calling service |
| `onStorageError` | Handle local backup errors |
| `onChatChange` | Observe conversation changes |

Friend, category and group actions use the corresponding configuration callbacks

Returning `false` or throwing keeps local state unchanged

## Friends and groups

```ts
await im.deleteFriend('alice')
await im.blockFriend('alice')
await im.unblockFriend('alice')
```

Blocking keeps history

Unblocking does not restore friendship

Groups use `ownerId`, `adminIds` and `muteAll` for roles and muting

Apply server updates with instance methods:

```ts
im.updateContact(contact)
im.setGroupMembers(groupId, members)
im.setGroupMute(groupId, true)
im.setGroupAdmin(groupId, userId, true)
im.removeFriend(userId)
im.removeGroup(groupId)
```

## AI and customer service

AI:

```ts
im.chat({ id: 'assistant', type: 'ai', username: 'AI assistant', maximized: true })
```

The application handles model requests

Customer service mode:

```ts
const im = createIM({
  init: { user: { id: 'visitor', username: 'Visitor' } },
  customerService: { id: 'support', type: 'friend', username: 'Support' },
  onSendMessage: payload => console.log(payload),
})
```

Customer service mode shows one conversation

## Files and calls

Configure `uploadAvatar`, `uploadGroupAvatar`, `uploadAttachment` and `uploadVoice`

Upload callbacks return accessible URLs

Voice recording requires `MediaRecorder` and microphone permission

`onCall` delegates voice and video calls to the application

## Locales

Built-in locales are `zh-CN` and `en`

```ts
import { createIM, en } from '@m-finder/giorgio-im'

const im = createIM({
  init,
  locale: 'en',
  locales: { fr: { ...en, send: 'Send' } },
})

im.setLocale('fr')
```

## Local backup

Disabled by default

```ts
const im = createIM({
  init,
  enableLocalStorage: true,
  encryptionKey: 'your-key',
  onStorageError: error => console.error(error),
})
```

Backups include profiles, contacts, messages, unread counts, notices and drafts

Backups use AES-256-GCM

Browser backups do not replace server storage and do not protect against same-origin scripts

## Toolbar

Built-in IDs: `emoji`, `image`, `file`, `voice`, `voice-call`, `video-call`, `history`

```ts
const im = createIM({
  init,
  toolbar: [
    { id: 'file', visible: false },
    { id: 'quick-reply', label: 'Quick reply', text: 'Q', onClick: ({ insertText }) => insertText('Received') },
  ],
})
```

`setToolbar([])` restores the default toolbar

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Entry: `src/index.ts`

Component: `src/ImWidget.vue`

Types: `src/types.ts`

## License

[MIT License](LICENSE)

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
- [Giorgio IM React](https://github.com/m-finder/giorgio-im-react): React + TypeScript instant messaging component
- [Giorgio IM Socket](https://packagist.org/packages/wu/giorgio-im-socket): Laravel instant messaging backend
- [Giorgio Socket](https://packagist.org/packages/wu/giorgio-socket): Laravel WebSocket infrastructure package

## Quick demo package

Download the `im-test-*` standalone executable for your platform (or the `.exe` for Windows) from the [Releases page](https://github.com/m-finder/giorgio-im/releases). Run it and open the demo page shown in the terminal. No PHP, Node.js, Composer or Redis installation is needed; run it with `--help` for port options. A `.phar` version is also available and requires a compatible PHP installation.

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

## Install the local demo

The demo installer requires PHP 8.0.2+ (`pdo_sqlite` and `mbstring`). New projects use Laravel 9; existing Laravel 9/10 projects must meet their own dependency requirements. It also needs Composer, Node.js/npm and Redis. The script installs the frontend and backend, configures SQLite and builds the demo page using the native PHP Socket driver.

```bash
curl -fsSL https://raw.githubusercontent.com/m-finder/giorgio-im-socket/main/tools/setup.sh -o /tmp/giorgio-im-setup.sh
bash /tmp/giorgio-im-setup.sh
```

Follow the prompts to install into the current Laravel project or create a project in an empty directory. Each run asks for a [GitHub classic PAT](https://github.com/settings/tokens) with `read:packages` permission and access to the frontend package. Input is hidden.

After installation, open four terminals at the project root and run one command in each:

```bash
redis-server --bind 127.0.0.1 --port 16380 --save '' --appendonly no
php artisan socket:start
php artisan socket:events
php artisan serve --host=127.0.0.1 --port=8001 --no-reload
```

Open `http://127.0.0.1:8001/im` and register two accounts to try private and group chats. For custom ports, use the startup commands and address printed by the script.

<details>
<summary>Existing projects, ports and file changes</summary>

- Select an existing project: `bash /tmp/giorgio-im-setup.sh /path/to/project`. Show usage: `bash /tmp/giorgio-im-setup.sh --help`.
- HTTP, Socket and Redis ports default to `8001`, `9501` and `16380`. Set `GIORGIO_IM_HTTP_PORT`, `GIORGIO_IM_SOCKET_PORT` and `GIORGIO_IM_REDIS_PORT` before running the script to override them.
- The script writes the demo page, User model, routes and configuration, then updates `.env` to use `storage/app/im-demo/database.sqlite`. Changed existing files are backed up under `storage/app/im-demo-backups/`. Rerunning preserves database contents and valid secrets.
- The token is used only for this dependency installation and is never written to project files. `.npmrc` uses the `${GIORGIO_IM_NPM_TOKEN}` placeholder; set that environment variable before installing frontend dependencies manually later.

</details>

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

The backend provides `/init`, `/socket-ticket`, `/messages` and `/uploads`

`createConnectedIM()` handles tickets, WebSocket, event catch-up, reconnects, contacts and group actions. Events sync through Socket without HTTP polling. Reconnects replay pages from the last applied cursor and deduplicate events. The Socket backend must support `sync` packets.

| Option | Default |
| --- | --- |
| `token` | Required token or token function |
| `apiUrl` | `/api/im` |
| `socketUrl` | URL returned by `/init` |
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

Messages with multiple images and text use `attachments: ImAttachment[]`; single attachments still use `attachment`

Type `@` in a group chat to search and select members with the arrow keys and Enter. Supply members through `loadGroupMembers` or `im.setGroupMembers(id, members)`. Messages and send callbacks use `mentions: { id, username, start, end }[]`; `start` and `end` are UTF-16 indices into the content, with an exclusive end.

Private and group chats support “Quote message” beside each message, with cancellation before sending. `replyTo` contains the original message's `{ mid, fromid, username, content }`, plus `attachment` or `attachments` for images. Previews, messages and history show image thumbnails with their caption; incoming and historical messages use the same shape. `createConnectedIM()` submits only `mid` and `fromid` from the reference. The server checks the conversation and supplies the name and content snapshot. Run `php artisan migrate` after upgrading the companion backend.

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

Swipe left on a group to mute or unmute notifications; desktop users can also right-click or press Shift+F10. Muted groups keep unread dots and counts, and messages mentioning you still trigger alerts. Group, recent and open-conversation lists show a muted icon. The personal `notificationsMuted` preference is separate from group speech restrictions. Save it through `muteGroupNotifications(group, muted)`; success triggers `onGroupNotificationsMuted`. The connected backend saves it automatically; run `php artisan migrate` after upgrading. Standalone widgets can retain it with `enableLocalStorage`.

Apply server updates with instance methods:

```ts
im.updateContact(contact)
im.setGroupMembers(groupId, members)
im.setGroupMute(groupId, true)
im.setGroupNotificationsMuted(groupId, true)
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

Pasting or choosing images from the toolbar adds them to the composer. Remove individual images or add text before sending them together via `uploadAttachment`

Click a chat image or quoted thumbnail to preview it. Use the previous/next buttons or arrow keys to browse loaded images in the current conversation. Press Esc or click the backdrop to close.

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

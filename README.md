# Giorgio IM

<p align="center"><img src="https://m-finder.github.io/images/avatar.jpeg"></p><p align="center">
<img src="https://img.shields.io/badge/Author-m--finder-red" alt="Author">
<a href="https://github.com/m-finder/giorgio-im/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
<img src="https://img.shields.io/badge/Vue-3.3%2B-42B883" alt="Vue 3.3+">
<img src="https://img.shields.io/badge/TypeScript-5%2B-3178C6" alt="TypeScript 5+">
</p>

[简体中文](README.md) | [English](README.en.md)

Vue 3 + TypeScript 即时通讯组件

提供联系人、好友、群聊、消息、AI 对话和客服模式
<p align="center"><img src="https://repository-images.githubusercontent.com/1440670842/afcc1279-de3b-4152-99af-2892e552f1f4"></p>


## 相关包

- [Giorgio IM](https://github.com/m-finder/giorgio-im)：Vue 3 + TypeScript 即时通讯组件
- [Giorgio IM React](https://github.com/m-finder/giorgio-im-react)：React + TypeScript 即时通讯组件
- [Giorgio IM Socket](https://packagist.org/packages/wu/giorgio-im-socket)：Laravel 即时通讯后端
- [Giorgio Socket](https://packagist.org/packages/wu/giorgio-socket)：Laravel WebSocket 底层服务相关包

## 快速体验包

从 [Releases 页面](https://github.com/m-finder/giorgio-im/releases) 下载适合系统的 `im-test-*` 独立程序（Windows 为 `.exe`），运行后按终端提示打开演示页面。无需安装 PHP、Node.js、Composer 或 Redis；运行 `--help` 可查看端口等参数。另有需要兼容 PHP 的 `.phar` 包。

## 安装

要求 Vue 3.3+

项目发布在 GitHub Packages

首次安装先在项目 `.npmrc` 配置 registry：

```ini
@m-finder:registry=https://npm.pkg.github.com
```

再用具有 `read:packages` 权限的 GitHub classic PAT 登录一次：

```bash
npm login --scope=@m-finder --auth-type=legacy --registry=https://npm.pkg.github.com
```

完成配置后直接安装：

```bash
npm install @m-finder/giorgio-im
```

GitHub Packages 即使公开的 npm 包也要求认证

## 一键安装本地演示

演示安装脚本最低要求 PHP 8.0.2+（`pdo_sqlite`、`mbstring`），新建项目使用 Laravel 9；已有 Laravel 9/10 项目需满足自身依赖要求；另需 Composer、Node.js/npm 和 Redis。脚本自动安装前后端、配置 SQLite 并构建演示页面，使用 PHP 原生 Socket 驱动。

```bash
curl -fsSL https://raw.githubusercontent.com/m-finder/giorgio-im-socket/main/tools/setup.sh -o /tmp/giorgio-im-setup.sh
bash /tmp/giorgio-im-setup.sh
```

按提示确认安装到当前 Laravel 项目，或选择空目录创建新项目。每次运行都需输入具有 `read:packages` 权限且能访问前端包的 [GitHub classic PAT](https://github.com/settings/tokens)，输入不会显示。

安装完成后，在项目根目录打开四个终端，各运行一条命令：

```bash
redis-server --bind 127.0.0.1 --port 16380 --save '' --appendonly no
php artisan socket:start
php artisan socket:events
php artisan serve --host=127.0.0.1 --port=8001 --no-reload
```

打开 `http://127.0.0.1:8001/im`，注册两个账号即可测试私聊和群聊。自定义端口时，以脚本打印的启动命令和地址为准。

<details>
<summary>已有项目、端口与文件改动</summary>

- 指定已有项目：`bash /tmp/giorgio-im-setup.sh /项目目录`。查看用法：`bash /tmp/giorgio-im-setup.sh --help`。
- HTTP、Socket、Redis 默认端口依次为 `8001`、`9501`、`16380`；运行前可设置 `GIORGIO_IM_HTTP_PORT`、`GIORGIO_IM_SOCKET_PORT`、`GIORGIO_IM_REDIS_PORT`。
- 脚本会写入演示页面、User 模型、路由与配置，并修改 `.env` 使用 `storage/app/im-demo/database.sqlite`。改动前的已有文件备份到 `storage/app/im-demo-backups/`；再次运行保留数据库数据和有效密钥。
- token 仅用于本次依赖安装，不写入项目文件。`.npmrc` 使用 `${GIORGIO_IM_NPM_TOKEN}` 占位符，以后手动安装前端依赖需先设置该环境变量。

</details>

## 快速开始

```ts
import { createIM, type ImInit } from '@m-finder/giorgio-im'

const init: ImInit = {
  user: { id: 'me', username: '我' },
  friend: [{
    id: 'team',
    groupname: '同事',
    list: [{ id: 'alice', username: 'Alice', status: 'online' }],
  }],
  group: [],
}

const im = createIM({
  init,
  onSendMessage(payload) {
    console.log(payload)
  },
})

im.chat({ id: 'alice', type: 'friend', username: 'Alice' })
im.open()
```

`createIM()` 只能在浏览器调用

组件自动挂载到 `document.body` 并注入样式

销毁实例：

```ts
im.destroy()
```

## Vue 组件

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ImWidget, type ImInit, type ImWidgetApi } from '@m-finder/giorgio-im'

const widget = ref<ImWidgetApi | null>(null)
const init: ImInit = { user: { id: 'me', username: '我' }, friend: [], group: [] }
</script>

<template>
  <ImWidget ref="widget" :init="init" locale="zh-CN" />
</template>
```

组件 `ref` 暴露与 `createIM()` 相同的操作方法

## Laravel + Socket

配套后端使用 `createConnectedIM()`

```ts
import { createConnectedIM } from '@m-finder/giorgio-im'

const im = await createConnectedIM({
  apiUrl: '/api/im',
  token: () => accessToken,
  widget: { locale: 'zh-CN' },
  onConnectionChange: state => console.log(state),
  onError: (error, operation) => console.error(operation, error),
})

im.open()
```

`apiUrl` 对应后端路由前缀

后端提供 `/init`、`/socket-ticket`、`/messages`、`/uploads` 等接口

`createConnectedIM()` 自动处理票据、WebSocket、事件补取、重连、好友和群管理。事件同步通过 Socket 完成，无 HTTP 轮询；重连后按最后处理的游标分页补收并去重。需要配套支持 `sync` 报文的 Socket 后端。

| 配置 | 默认值 |
| --- | --- |
| `token` | 必填，Token 或返回 Token 的函数 |
| `apiUrl` | `/api/im` |
| `socketUrl` | 使用 `/init` 返回的地址 |
| `requestTimeout` | `15000` 毫秒 |
| `transport.requireTLS` | `true` |
| `transport.allowInsecureLocalhost` | `true` |

公网使用 HTTPS/WSS

实例方法：

```ts
await im.sync()
im.reconnect()
await im.sendMessage(payload)
im.destroy()
```

## 初始化数据

```ts
const init: ImInit = {
  user: {
    id: 'me',
    username: '我',
    avatar: '/avatar.png',
    sign: '在线',
    status: 'online',
  },
  friend: [{
    id: 'friends',
    groupname: '好友',
    list: [{ id: 'alice', type: 'friend', username: 'Alice' }],
  }],
  group: [{
    id: 'room',
    type: 'group',
    groupname: '项目群',
    ownerId: 'me',
    members: 3,
  }],
  blocked: [],
  recent: [],
}
```

ID 支持字符串和数字

好友使用 `username`

群使用 `groupname`

AI 联系人使用 `type: 'ai'`

## 消息

发送消息：

```ts
im.getMessage({
  id: 'alice',
  type: 'friend',
  content: '你好',
  fromid: 'alice',
  timestamp: Date.now(),
})
```

消息类型：`friend`、`group`、`ai`

附件格式：

```ts
{
  kind: 'image' | 'file' | 'audio',
  url: string,
  name: string,
  duration?: number,
}
```

普通消息使用 `mid` 去重

多张图片与文字一起发送时，消息使用 `attachments: ImAttachment[]`；单附件仍使用 `attachment`

群聊输入 `@` 可搜索并选择成员，支持方向键和 Enter；通过 `loadGroupMembers` 加载成员，或调用 `im.setGroupMembers(id, members)` 提供成员列表。消息和发送回调中的 `mentions` 为 `{ id, username, start, end }[]`，其中 `start`、`end` 是正文的 UTF-16 索引，结束位置不包含在内。

私聊和群聊均可点击消息旁的“引用消息”，发送前可取消。`replyTo` 包含原消息的 `{ mid, fromid, username, content }`，图片引用同时保留 `attachment` 或 `attachments`，在预览、消息和历史记录中显示缩略图及文字；接收消息和历史消息可携带同一结构。`createConnectedIM()` 发送时仅提交 `mid`、`fromid`，服务端校验同一会话并生成名称和正文快照。使用配套后端时，升级后先运行 `php artisan migrate`。

AI 流式消息使用同一个 `mid`，每次传入完整内容：

```ts
im.getMessage({ id: 'assistant', type: 'ai', mid: 'reply-1', content: '你好', finished: false })
im.getMessage({ id: 'assistant', type: 'ai', mid: 'reply-1', content: '你好，世界', finished: true })
```

## 回调

| 回调 | 用途 |
| --- | --- |
| `onSendMessage` | 发送文本或附件 |
| `onRead` | 上报已读消息 |
| `onTyping` | 上报输入状态 |
| `onUsername` / `onSign` / `onAvatar` | 保存用户资料 |
| `onCall` | 接入 WebRTC 或其他通话服务 |
| `onStorageError` | 处理本地备份错误 |
| `onChatChange` | 监听会话切换 |

好友、分组和群管理通过配置回调接入

回调返回 `false` 或抛出异常时，本地状态不更新

## 好友与群

好友操作：

```ts
await im.deleteFriend('alice')
await im.blockFriend('alice')
await im.unblockFriend('alice')
```

拉黑保留历史消息

解除拉黑不会恢复好友关系

群使用 `ownerId`、`adminIds`、`muteAll` 表示权限和禁言状态

群聊列表向左滑动可静音或取消静音消息，桌面端也可右键或按 Shift+F10。静音后保留未读红点和条数，收到 @ 自己的消息仍会提醒；群聊、最近会话和多会话列表显示静音图标。个人设置使用 `notificationsMuted`，与群禁言独立；通过 `muteGroupNotifications(group, muted)` 保存，成功后触发 `onGroupNotificationsMuted`。连接配套后端时自动保存，升级后先运行 `php artisan migrate`；独立使用时可开启 `enableLocalStorage` 保留设置。

服务端返回变更后，用实例方法更新界面：

```ts
im.updateContact(contact)
im.setGroupMembers(groupId, members)
im.setGroupMute(groupId, true)
im.setGroupNotificationsMuted(groupId, true)
im.setGroupAdmin(groupId, userId, true)
im.removeFriend(userId)
im.removeGroup(groupId)
```

## AI 与客服

AI：

```ts
im.chat({ id: 'assistant', type: 'ai', username: 'AI 助手', maximized: true })
```

模型请求由应用后端处理

客服模式：

```ts
const im = createIM({
  init: { user: { id: 'visitor', username: '访客' } },
  customerService: { id: 'support', type: 'friend', username: '在线客服' },
  onSendMessage: payload => console.log(payload),
})
```

客服模式只显示一个会话

## 文件和通话

配置 `uploadAvatar`、`uploadGroupAvatar`、`uploadAttachment`、`uploadVoice`

上传回调返回可访问 URL

在聊天输入框粘贴或通过工具栏选择图片会累积预览多张图片，可逐张移除并与文字一起发送；发送时通过 `uploadAttachment` 上传图片

点击聊天中的图片或引用缩略图可放大预览，使用上一张、下一张按钮或左右方向键切换当前会话已加载的图片，按 Esc 或点击遮罩关闭。

语音录制需要 `MediaRecorder` 和麦克风权限

通话通过 `onCall` 交给应用处理

## 多语言

内置 `zh-CN` 和 `en`

```ts
import { createIM, en } from '@m-finder/giorgio-im'

const im = createIM({
  init,
  locale: 'en',
  locales: { fr: { ...en, send: 'Envoyer' } },
})

im.setLocale('fr')
```

## 本地备份

默认关闭

```ts
const im = createIM({
  init,
  enableLocalStorage: true,
  encryptionKey: 'your-key',
  onStorageError: error => console.error(error),
})
```

备份包含资料、联系人、消息、未读数、通知和草稿

加密使用 AES-256-GCM

前端备份不替代服务端存储，也不能防止同源脚本读取数据

## 工具栏

内置按钮：`emoji`、`image`、`file`、`voice`、`voice-call`、`video-call`、`history`

```ts
const im = createIM({
  init,
  toolbar: [
    { id: 'file', visible: false },
    { id: 'quick-reply', label: '快捷回复', text: '快', onClick: ({ insertText }) => insertText('收到') },
  ],
})
```

`setToolbar([])` 恢复默认工具栏

## 开发

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

入口：`src/index.ts`

组件：`src/ImWidget.vue`

类型：`src/types.ts`

## 协议

[MIT License](LICENSE)

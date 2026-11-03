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
- [Giorgio IM Socket](https://packagist.org/packages/wu/giorgio-im-socket)：Laravel 即时通讯后端
- [Giorgio Socket](https://packagist.org/packages/wu/giorgio-socket)：Laravel WebSocket 底层服务相关包

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

需要 PHP 8.1+（pdo_sqlite、mbstring）、Composer、Node.js/npm、Redis。脚本安装 Laravel 10 演示，使用 PHP 原生 Socket，无需 Swoole。

下载后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/m-finder/giorgio-im-socket/main/tools/setup.sh -o /tmp/giorgio-im-setup.sh
bash /tmp/giorgio-im-setup.sh
```

1. 当前为 Laravel 根目录：询问是否在当前目录安装，默认取消。
2. 当前不是 Laravel 根目录：询问是否新建 Laravel 10，再输入空的安装目录（默认 `./laravel-im-demo`）。也可传入已有项目：`bash /tmp/giorgio-im-setup.sh /项目目录`。
3. 提示时输入具有 `read:packages` 权限且能访问前端包的 [GitHub classic PAT](https://github.com/settings/tokens)。输入不显示，无需提前执行 `npm login`。

脚本自动写入项目 `.npmrc`：

```ini
@m-finder:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GIORGIO_IM_NPM_TOKEN}
```

认证行保留环境变量占位符；输入的 token 仅传给本次 `npm install`，不写入项目文件。再次运行脚本时会重新询问；以后手动 `npm install` 需先设置 `GIORGIO_IM_NPM_TOKEN`。

脚本自带 Blade、TS、CSS、注册登录及 Sanctum 接入代码，自动安装 `wu/giorgio-im-socket`（Composer 同时安装依赖 `wu/giorgio-socket`）、Predis、Sanctum、`@m-finder/giorgio-im` 和 Vue，配置 `.env` 与缺少的密钥，执行迁移和前端构建。

会写入演示 `User` 模型、路由和配置，并将 `.env` 切换到本地 SQLite：`storage/app/im-demo/database.sqlite`。改动前的已有文件备份到 `storage/app/im-demo-backups/`；重复运行保留有效密钥和数据库数据。

完成后在项目根目录的四个终端分别启动：

```bash
redis-server --bind 127.0.0.1 --port 16380 --save '' --appendonly no
php artisan socket:start
php artisan socket:events
php artisan serve --host=127.0.0.1 --port=8001 --no-reload
```

打开 `http://127.0.0.1:8001/im`，用两个账号测试私聊和群聊。HTTP/Socket/Redis 默认端口为 `8001/9501/16380`，可在执行脚本前设置 `GIORGIO_IM_HTTP_PORT`、`GIORGIO_IM_SOCKET_PORT`、`GIORGIO_IM_REDIS_PORT`，启动命令以脚本输出为准。

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

服务端返回变更后，用实例方法更新界面：

```ts
im.updateContact(contact)
im.setGroupMembers(groupId, members)
im.setGroupMute(groupId, true)
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

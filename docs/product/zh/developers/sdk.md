---
title: SDK
description: 使用 Cohub TypeScript SDK 处理 Spaces、Chats、Works、实时更新与 Work runtime API。
---

Cohub SDK 是面向产品 API 与实时协作的 TypeScript 客户端。

包名：`@neta-art/cohub`

## 安装

```bash
npm install @neta-art/cohub
```

## 创建 client

```ts
import { createCohubClient } from "@neta-art/cohub";

const client = createCohubClient({
  getAccessToken: async () => localStorage.getItem("token"),
});
```

默认端点：

| Env | API | WebSocket |
| --- | --- | --- |
| production | `https://api.cohub.run` | `wss://gateway.cohub.run/ws` |
| development | `https://api-dev.cohub.run` | `wss://gateway-dev.cohub.run/ws` |

选择 development：

```ts
const client = createCohubClient({
  env: "dev",
  getAccessToken: async () => token,
});
```

或在 Node.js 中设置 `ENV=dev`。

自托管或代理时也支持自定义端点。

## Spaces 与 Chats

```ts
const created = await client.spaces.create({ name: "Demo" });
const space = client.space(created.space.id);

const sessionResult = await space.sessions.create({ title: "Planning" });
const session = space.session(sessionResult.session.id);

await session.messages.send({
  content: [{ type: "text", text: "Help me plan the next steps" }],
});
```

产品映射：

- Space → `client.spaces` / `client.space(id)`
- Chat → Space 下的 session API
- Save → Space 下的 checkpoint API
- Work → `client.works`

## 实时

在 Agent 工作时订阅 session 事件：

```ts
const stop = session.subscribe({
  progress(event) {
    console.log("progress", event.payload);
  },
  finalized(event) {
    console.log("done", event.payload);
  },
});

stop();
```

## Works

通过 `client.works` 创建与管理 Works，包括发布、更新、版本，以及按 slug 查找。

普通服务端 / 自动化代码使用常规用户鉴权。**已发布 Work 内部**的代码使用下面的 Work runtime API。

## Work runtime

已发布 Works 可使用 Cohub shell 提供的短时 runtime 鉴权运行。

```ts
const client = createCohubClient(); // token 来自 Work runtime

const context = await client.context();
// Work 身份、Space 身份、viewer 状态

await client.auth.request({
  scopes: ["session.prompt.readonly"],
  reason: "Continue the demo chat",
});
```

重要：

- Runtime API 在已发布 Work 内工作
- 它们不会在任意静态托管或本地直接打开文件时工作
- Work scopes 与 viewer-consent scopes 会被强制执行

启用 commerce 且 Work 已发布时，commerce helpers 在 `client.work.commerce.*`。

## 主要 client 表面

Client 按产品区域分组：

| 区域 | Client 表面 |
| --- | --- |
| Spaces / sessions / files | `client.spaces`、`client.space(id)` |
| Works | `client.works` |
| Generations | `client.generations` |
| Models | `client.models` |
| Search | `client.search` |
| Tasks / cron | `client.tasks`、`client.cronJobs` |
| Channels | `client.channels` |
| Billing / commerce | `client.billing`、`client.workCommerce` |
| Work runtime | `client.context()`、`client.auth`、`client.work` |

只使用你需要的表面。从 Spaces、sessions 和 Works 开始。

## 鉴权模型

在 Work runtime 之外：

- 提供 `getAccessToken`
- 若自行集成登录，可选用 token storage helpers

在 Work runtime 之内：

- host 可提供短时 tokens
- 仅在需要时请求额外 viewer scopes

任何在他人浏览器中运行的 Work，都优先最小权限。

## 实用建议

- 每个 app shell 复用一个 client 实例
- 优先使用 Space-scoped helpers（`client.space(id)`）提升可读性
- 流式 UX 用 realtime 订阅，而不是紧密轮询
- UI 文案保持产品术语一致：Chat / Save，而不是 session / checkpoint

## 相关

- [CLI](/docs/zh/developers/cli)
- [Works](/docs/zh/create/works)
- [核心概念](/docs/zh/learn/core-concepts)

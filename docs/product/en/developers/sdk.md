---
title: SDK
description: Use the Cohub TypeScript SDK for Spaces, Chats, Works, realtime updates, and Work runtime APIs.
---

The Cohub SDK is the TypeScript client for product APIs and realtime collaboration.

Package: `@neta-art/cohub`

## Install

```bash
npm install @neta-art/cohub
```

## Create a client

```ts
import { createCohubClient } from "@neta-art/cohub";

const client = createCohubClient({
  getAccessToken: async () => localStorage.getItem("token"),
});
```

Defaults:

| Env | API | WebSocket |
| --- | --- | --- |
| production | `https://api.cohub.run` | `wss://gateway.cohub.run/ws` |
| development | `https://api-dev.cohub.run` | `wss://gateway-dev.cohub.run/ws` |

Select development:

```ts
const client = createCohubClient({
  env: "dev",
  getAccessToken: async () => token,
});
```

Or with `ENV=dev` in Node.js.

Custom endpoints are supported when self-hosting or proxying.

## Spaces and Chats

```ts
const created = await client.spaces.create({ name: "Demo" });
const space = client.space(created.space.id);

const sessionResult = await space.sessions.create({ title: "Planning" });
const session = space.session(sessionResult.session.id);

await session.messages.send({
  content: [{ type: "text", text: "Help me plan the next steps" }],
});
```

Product mapping:

- Space → `client.spaces` / `client.space(id)`
- Chat → session APIs under a Space
- Save → checkpoint APIs under a Space
- Work → `client.works`

## Realtime

Subscribe to session events while an Agent is working:

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

Create and manage Works through `client.works`, including publish, update, versions, and lookups by slug.

For ordinary server/automation code, use normal user auth. For code **inside a published Work**, use the Work runtime APIs below.

## Work runtime

Published Works can run with short-lived runtime auth provided by the Cohub shell.

```ts
const client = createCohubClient(); // token comes from Work runtime

const context = await client.context();
// Work identity, Space identity, viewer state

await client.auth.request({
  scopes: ["session.prompt.readonly"],
  reason: "Continue the demo chat",
});
```

Important:

- Runtime APIs work inside a published Work
- They do not work from arbitrary static hosting or local file open
- Work scopes and viewer-consent scopes are enforced

Commerce helpers live under `client.work.commerce.*` when commerce is enabled and the Work is published.

## Main client surfaces

The client groups product APIs intentionally:

| Area | Client surface |
| --- | --- |
| Spaces / sessions / files | `client.spaces`, `client.space(id)` |
| Works | `client.works` |
| Generations | `client.generations` |
| Models | `client.models` |
| Search | `client.search` |
| Tasks / cron | `client.tasks`, `client.cronJobs` |
| Channels | `client.channels` |
| Billing / commerce | `client.billing`, `client.workCommerce` |
| Work runtime | `client.context()`, `client.auth`, `client.work` |

Use only the surfaces you need. Start with Spaces, sessions, and Works.

## Auth model

Outside Work runtime:

- Provide `getAccessToken`
- Optionally handle token storage helpers if you integrate login yourself

Inside Work runtime:

- The host can provide short-lived tokens
- Request additional viewer scopes only when required

Prefer least privilege for any Work that runs in other people’s browsers.

## Practical tips

- Reuse one client instance per app shell
- Prefer Space-scoped helpers (`client.space(id)`) for readable code
- Use realtime subscriptions for streaming UX, not tight polling loops
- Keep product terms aligned in UI copy: Chat/Save, not session/checkpoint

## Related

- [CLI](/docs/developers/cli)
- [Works](/docs/create/works)
- [Core concepts](/docs/learn/core-concepts)

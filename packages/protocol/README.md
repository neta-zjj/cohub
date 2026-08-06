# @cohub/protocol

Shared protocol definitions for the Cohub agent collaboration platform.

This package provides the stable type surface used across Cohub services and client SDKs — covering spaces, checkpoints, sessions, realtime events, gateway contracts, tasks, and filesystem operations.

This is a **private monorepo package**. It is not published to npm; consume it via workspace imports inside this repository.

## Subpath exports

| Subpath | Contents |
|---|---|
| `@cohub/protocol/core` | Low-level primitives — content blocks, usage, shared types |
| `@cohub/protocol/model` | Business records and input models — sessions, spaces, checkpoints |
| `@cohub/protocol/realtime` | WebSocket and streaming event protocol definitions |
| `@cohub/protocol/gateway` | Stable gateway contracts for external channels |
| `@cohub/protocol/task` | Task scheduler and worker contracts |
| `@cohub/protocol/fs` | Space filesystem DTOs |

## Usage

```ts
import { type ContentBlock } from "@cohub/protocol/core";
import { type SessionInput } from "@cohub/protocol/model";
import { type RealtimeEvent } from "@cohub/protocol/realtime";
```

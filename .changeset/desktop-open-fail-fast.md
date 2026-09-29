---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": patch
---

`cohub desktop open` fails fast when the desktop that started the chat is gone. The target tab now accepts a command before running it; one nobody accepts within 10 seconds (closed, asleep, or offline) settles as `no_active_client` instead of waiting out the timeout, and a tab that wakes up later never opens it. A plain open waits up to 30 seconds by default, an App `--call` still waits up to 10 minutes. SDK: `desktop.accept()`, `defaultDesktopCommandTimeoutMs()`, `DESKTOP_COMMAND_ACCEPT_TIMEOUT_MS`, and `DESKTOP_COMMAND_OPEN_TIMEOUT_MS`; `desktop.run()` and `desktop.wait()` pick the default from the command.

发起 Chat 的桌面不在时，`cohub desktop open` 会很快失败。目标标签页先接收命令再执行；10 秒内没有标签页接收（已关闭、睡眠或离线）就结算为 `no_active_client`，不再等满超时，之后才醒来的标签页也不会再打开它。普通打开默认最多等 30 秒，App 的 `--call` 仍最多等 10 分钟。SDK 新增 `desktop.accept()`、`defaultDesktopCommandTimeoutMs()`、`DESKTOP_COMMAND_ACCEPT_TIMEOUT_MS` 和 `DESKTOP_COMMAND_OPEN_TIMEOUT_MS`；`desktop.run()` 和 `desktop.wait()` 按命令选择默认等待时长。

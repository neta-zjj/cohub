# Workspace default layout

Declare a space's default workspace layout in `.cohub/space.json`. It applies
only as a fallback: the moment a viewer has any local layout preference for the
space (collapsing a sidebar, opening a preview, entering focus/fullscreen), that
local state wins on every later visit. An explicit `?preview=` in the URL always
takes precedence over the configured preview.

Config changes take effect on the next entry to the space, not mid-session.

## Fields

All fields are optional; unset fields fall back to Cohub built-in defaults.

| Field          | Values                              | Meaning                                           |
| -------------- | ----------------------------------- | ------------------------------------------------- |
| `leftSidebar`  | `expanded` \| `collapsed`           | App navigation rail on the left.                  |
| `filesColumn`  | `visible` \| `hidden`               | The whole Files column (preview + tree).          |
| `fileTree`     | `expanded` \| `collapsed`           | The file tree inside the Files column.            |
| `preview`      | `{ kind, path }` / `{ kind, port }` | File/board/port to open on first entry.          |
| `presentation` | `split` \| `focus` \| `fullscreen`  | Preview presentation (needs `preview` to apply).  |

`preview.kind` is one of `file`, `board`, or `port`. Use `path` for file and
board, `port` for a port preview.

- `split` — normal side-by-side preview.
- `focus` — preview expands, main panel stays at its minimum width.
- `fullscreen` — preview takes over; the chat panel is hidden by default.

Desktop only: mobile viewports open the configured preview as a full-screen
surface and ignore the sidebar/presentation geometry.

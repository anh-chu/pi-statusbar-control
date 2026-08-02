# pi-statusbar-control

[![npm](https://img.shields.io/npm/v/pi-statusbar-control)](https://www.npmjs.com/package/pi-statusbar-control)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Show or hide **every** element pi's footer can display — its own built-in segments (path, git
branch, token stats, cost, context usage, model/thinking) as well as anything an extension injects
via `ctx.ui.setStatus(key, text)` (plan mode, powerline stash indicators, custom status demos, etc.).

Pi's default footer always renders all of these with no way to filter. This extension takes over
the footer, reproduces the built-in segments exactly, discovers every extension key it observes,
and gives you one toggle list to show or hide each element — persisted across restarts.

## Install

```bash
pi install npm:pi-statusbar-control
```

Or drop `index.ts` into `~/.pi/agent/extensions/` / `.pi/extensions/`.

## Usage

| Command | Effect |
|---|---|
| `/statusbar` | Open interactive toggle list (shown/hidden per element) |
| `/statusbar list` | Print all known elements and current visibility |
| `/statusbar off` | Restore pi's untouched default footer |
| `/statusbar on` | Re-enable the filtered footer (default) |

### Toggleable elements

**Built-in** (always listed, independent of any extension):

- path — cwd (abbreviated to `~`), git branch, session name
- tokens — ↑input ↓output cache read/write, cache-hit %
- cost — `$x.xxx`, plus `(sub)` label when billed via subscription/OAuth
- context — context-window usage percentage / window size
- model — model id, thinking level, provider (when relevant)

**Extension-injected** — discovered automatically the first time the source extension calls
`ctx.ui.setStatus(key, ...)`. If a key isn't in the list yet, trigger that extension once and run
`/statusbar` again.

Visibility choices and known extension keys persist to `~/.pi/agent/settings.json` under
`statusbarControl`.

## License

MIT

# pi-statusbar-control

[![npm](https://img.shields.io/npm/v/pi-statusbar-control)](https://www.npmjs.com/package/pi-statusbar-control)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Show, hide, and reorder **every** element pi's footer can display — its own built-in segments
(path, git branch, token stats, cost, context usage, model/thinking) as well as anything an
extension injects via `ctx.ui.setStatus(key, text)` (plan mode, powerline stash indicators, custom
status demos, etc.).

Pi's default footer always renders all of these with no way to filter or reorder. This extension
takes over the footer, reproduces the built-in segments exactly, discovers every extension key it
observes, and gives you one toggle list to show/hide each element plus a reorder UI for
extension-injected ones — all persisted across restarts.

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
| `/statusbar order` | Interactively reorder extension-injected statuses |
| `/statusbar move <key> <up\|down\|top\|bottom>` | Reorder one key non-interactively |
| `/statusbar off` | Restore pi's untouched default footer |
| `/statusbar on` | Re-enable the filtered footer (default) |

All subcommands and `move` arguments (extension keys, then directions) autocomplete as you type —
press Tab / start typing after `/statusbar ` to see suggestions with descriptions.

### Toggleable elements

**Built-in** (always listed, fixed order, independent of any extension):

- path — cwd (abbreviated to `~`), git branch, session name
- tokens — ↑input ↓output cache read/write, cache-hit %
- cost — `$x.xxx`, plus `(sub)` label when billed via subscription/OAuth
- context — context-window usage percentage / window size
- model — model id, thinking level, provider (when relevant)

**Extension-injected** — discovered automatically the first time the source extension calls
`ctx.ui.setStatus(key, ...)`. If a key isn't in the list yet, trigger that extension once and run
`/statusbar` again. Their relative display order is fully customizable via `/statusbar order`
(↑/↓ to move the cursor, shift+↑/shift+↓ or `K`/`J` to move the selected item, enter/esc to close)
or `/statusbar move <key> <direction>`.

### Own-line / wrapping

A single lengthy status can crowd out everything else sharing its line. In `/statusbar`, cycle an
extension key's value to **own line** to always render it on its own footer line, independent of
the others. Any remaining inline group that still doesn't fit the terminal width wraps onto
additional lines automatically instead of getting truncated.

Visibility, known extension keys, their order, and own-line placement persist to
`~/.pi/agent/settings.json` under `statusbarControl`.

## License

MIT

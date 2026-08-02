# pi-statusbar-control

[![npm](https://img.shields.io/npm/v/pi-statusbar-control)](https://www.npmjs.com/package/pi-statusbar-control)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Show or hide status-bar elements that **any** [pi](https://github.com/badlogic/pi-mono) extension injects via `ctx.ui.setStatus(key, text)`.

Extensions (plan mode, powerline stash indicators, custom status demos, etc.) each register a badge
under a key. Pi's default footer renders all of them with no way to filter. This extension takes over
the footer, discovers every key it observes, and gives you a toggle list to show or hide each one —
persisted across restarts.

## Install

```bash
pi install npm:pi-statusbar-control
```

Or drop `index.ts` into `~/.pi/agent/extensions/` / `.pi/extensions/`.

## Usage

| Command | Effect |
|---|---|
| `/statusbar` | Open interactive toggle list (shown/hidden per key) |
| `/statusbar list` | Print all known keys and current visibility |
| `/statusbar off` | Restore pi's untouched default footer |
| `/statusbar on` | Re-enable the filtered footer (default) |

Keys only appear in the toggle list once observed at least once, i.e. after the source extension has
called `ctx.ui.setStatus`. Trigger the relevant extension, then run `/statusbar` again if its key
isn't listed yet.

Visibility choices and known keys persist to `~/.pi/agent/settings.json` under `statusbarControl`.

## Footer layout

- **Left:** joined visible status badges (in insertion order, hidden ones filtered out).
- **Right:** model id, git branch, token counts (↑in ↓out), and cost — the same info shown by pi's
  default footer.

## License

MIT

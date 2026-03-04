# Claude Token Monitor — GNOME Shell 48 Extension

## Objective

A compact GNOME Shell 48 taskbar indicator that monitors Claude Code token usage in real-time. It reads the same JSONL data files (`~/.claude/projects/**/*.jsonl`) that Claude Code writes, parses token usage from all entry types, calculates cost and burn rate, and displays it as a panel indicator with a click-to-expand dropdown for details.

## Features

- **Progress bar** showing cost or token usage against plan limits (Pro, Max 5x, Max 20x)
- **Individual toggles**: show/hide icon, bar, percentage, time, status dot independently
- **Time remaining** estimate until plan limit is reached
- **Window reset countdown** with clock time in dropdown (e.g. "2h 44m reset (13:00)")
- **Bar styles**: Unicode (blocks, dots, squares, thin, smooth) + Cairo-rendered (pill, thick-rounded, segmented, glow-edge) + vertical (vbar, vbar-dual)
- **Color schemes**: white, green-red, blue, purple, amber, rainbow, dracula, nord, catppuccin, neon, sunset, ocean, solarized, system accent, custom gradient
- **Pill backgrounds**: off, solid, subtle, border-only, status-aware (green/yellow/red), neon glow
- **Prefix options**: "Claude" text, Claude icon, or symbolic SVG icon (theme-adaptive)
- **Animations**: smooth bar fill, pulse at >80% usage, icon spin on refresh, label fade on update
- **Middle-click** to cycle bar styles
- **Dropdown styles**: classic (text rows), modern (progress bar + sparkline + colored dots), gauges (circular arc gauges)
- **Typography**: font size (small/medium/large), text effects (glow/shadow)
- **Status badge**: colored dot overlay on icon corner
- **Custom colors**: user-defined gradient via color picker in preferences
- **Configurable**: bar length, refresh interval, panel position, metric (cost/tokens)
- **Estimation scale factors**: conservative (0.8x), balanced (1.0x), generous (1.2x)
- **Performance optimized**: mtime-based file filtering, per-file caching, string pre-filter

## Architecture

- `extension.js` — Main indicator logic, data parsing, cost calculation, Cairo bar/gauge/sparkline rendering, Clutter animations
- `prefs.js` — GTK4/Adw preferences window (3 pages: General, Appearance, Advanced)
- `stylesheet.css` — Panel styling (pill variants, font sizes, status classes)
- `schemas/` — GSettings schema for user preferences
- `icons/` — Claude logo PNGs (16px, 32px, 48px) + claude-symbolic.svg
- Installed via symlink from `~/.local/share/gnome-shell/extensions/claude-monitor@miferco97/`

## Token & Cost Measurement

Aligned with [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor):

- **Token plan limits**: input + output only (cache excluded). Pro: 19k, Max5: 88k, Max20: 220k.
- **Cost calculation**: includes all 4 token types (input, output, cache_creation, cache_read) at per-model pricing.
- **Dedup strategy**: keep-first — the first JSONL entry per `message_id:request_id` is kept, subsequent streaming duplicates are skipped. Entries missing either ID are always kept (no dedup).
- **Entry type filtering**: all entry types are processed (not just `"assistant"`), with usage extracted from `message.usage`, `usage`, or the entry itself.
- **Session window detection**: data-driven, not fixed UTC blocks. Walks entry timestamps to find windows; a new window starts when an entry is >= previous start + 5h. Window start is floored to the UTC hour.
- **Lookback**: 10 hours to detect session boundaries across potential gaps.

## Known Issues

- **Cost estimation may still have minor discrepancies** vs Claude Code's `/usage` command. Possible remaining causes: pricing constants may not exactly match Anthropic's billing, server-side overhead tokens not recorded in JSONL.

## Past Bugs Fixed

- **Fixed UTC block session detection:** Previously used fixed 5-hour UTC blocks (`blockStartH = utcH - (utcH % 5)`), which didn't match Anthropic's actual session windows. Reset countdown was off by up to ~1 hour. Switched to data-driven session detection with hour-floored window start.
- **Plan token limits were 1000x too high:** Token limits were 19M/88M/220M instead of 19k/88k/220k. The reference project showed the correct scale — raw input+output tokens per session are in the thousands, not millions.
- **Estimation scale factors replaced:** Old scale factors (1.4x–2.0x) were a workaround for excluding cache from cost. Now that cost includes cache tokens, scale factors are small adjustments: 0.8/1.0/1.2.
- **Dedup key collision:** Entries with missing `message.id` or `requestId` all collapsed into the same `"_"` key, losing data. Fixed by assigning unique keys when either ID is absent.
- **Billing tier overcount:** All entries were billed at the most expensive model's rate (e.g., haiku subagent calls at opus rate). Fixed to use per-entry model pricing.

## Development Notes

- On Wayland, `disable`/`enable` via D-Bus reloads settings but **not** JS code changes — a full session restart (log out/in) is required to pick up extension.js changes.
- Compile schemas after changes: `glib-compile-schemas schemas/`

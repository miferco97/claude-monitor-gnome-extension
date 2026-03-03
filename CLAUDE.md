# Claude Token Monitor — GNOME Shell 48 Extension

## Objective

A compact GNOME Shell 48 taskbar indicator that monitors Claude Code token usage in real-time. It reads the same JSONL data files (`~/.claude/projects/**/*.jsonl`) that Claude Code writes, parses token usage from assistant messages, calculates cost and burn rate, and displays it as a panel indicator with a click-to-expand dropdown for details.

## Features

- **Progress bar** showing cost or token usage against plan limits (Pro, Max 5x, Max 20x)
- **Time remaining** estimate until plan limit is reached
- **Multiple bar styles**: blocks, dots, squares, thin
- **Color schemes**: white, green-to-red gradient, blue, purple, amber, rainbow
- **Prefix options**: "Claude" text label or Claude icon
- **Configurable**: bar length, refresh interval, panel position, metric (cost/tokens)
- **Detailed dropdown**: token breakdown, cost, burn rate, session info, settings link
- **Performance optimized**: mtime-based file filtering, per-file caching, string pre-filter

## Architecture

- `extension.js` — Main indicator logic, data parsing, cost calculation
- `prefs.js` — GTK4/Adw preferences window
- `stylesheet.css` — Panel styling
- `schemas/` — GSettings schema for user preferences
- `icons/` — Claude logo PNGs (16px, 32px, 48px)
- Installed via symlink from `~/.local/share/gnome-shell/extensions/claude-monitor@miferco97/`

## Known Issues

- **Cost estimation may still have minor discrepancies** vs Claude Code's `/usage` command. Possible remaining causes: pricing constants may not exactly match Anthropic's billing, server-side overhead tokens not recorded in JSONL, or different rolling window calculations.

## Past Bugs Fixed

- **Cache token overcount:** Cache tokens (cache_creation + cache_read) were included in both cost and billable token calculations. Analysis showed Anthropic's `/usage` only counts uncached input + output tokens toward plan limits (cache costs are absorbed). Removing cache from cost brought estimates from ~80% down to ~15%, matching `/usage`'s ~17%.
- **Dedup bug (output token undercount):** Claude Code writes 2-4 JSONL entries per assistant message — streaming partials (with low `output_tokens` like 8) followed by a final entry with the correct count. The dedup logic was keeping the *first* occurrence (partial) instead of the *last* (final). Fixed by using a Map that overwrites with later entries.
- **Billing tier overcount:** All entries were billed at the most expensive model's rate (e.g., haiku subagent calls at opus rate). Fixed to use per-entry model pricing.

## Development Notes

- On Wayland, `disable`/`enable` via D-Bus reloads settings but **not** JS code changes — a full session restart (log out/in) is required to pick up extension.js changes.
- Compile schemas after changes: `glib-compile-schemas schemas/`

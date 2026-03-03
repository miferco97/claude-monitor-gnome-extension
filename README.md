# Claude Token Monitor

A GNOME Shell 48 extension that monitors [Claude Code](https://docs.anthropic.com/en/docs/claude-code) token usage in real-time from your taskbar.

It reads the JSONL data files (`~/.claude/projects/**/*.jsonl`) that Claude Code writes, parses token usage from assistant messages, calculates cost and burn rate, and displays a progress bar indicator with a click-to-expand dropdown for details.

![GNOME Shell 48](https://img.shields.io/badge/GNOME_Shell-48-blue)

![Claude Token Monitor dropdown showing token breakdown, cost, burn rate, and plan usage](screenshots/dropdown.png)

## Features

- **Progress bar** showing cost or token usage against plan limits (Pro, Max 5x, Max 20x)
- **Time remaining** estimate until plan limit is reached
- **Multiple bar styles**: blocks, smooth, dots, squares, thin
- **Color schemes**: white, green-to-red gradient, blue, purple, amber, rainbow
- **Prefix options**: "Claude" text label or Claude icon
- **Configurable**: bar length, refresh interval, panel position, metric (cost/tokens)
- **Detailed dropdown**: token breakdown, cost, burn rate, session info, settings link
- **Estimation modes**: conservative, balanced, and generous scaling to approximate Anthropic's `/usage` numbers
- **Performance optimized**: mtime-based file filtering, per-file caching, string pre-filter

## Installation

1. Clone or download this repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/claude-monitor-gnome-extension.git
   ```

2. Create a symlink to the GNOME Shell extensions directory:

   ```bash
   ln -s /path/to/claude-token-monitor \
     ~/.local/share/gnome-shell/extensions/claude-monitor@miferco97
   ```

3. Compile the GSettings schema:

   ```bash
   glib-compile-schemas schemas/
   ```

4. Restart GNOME Shell:
   - **Wayland**: Log out and log back in.
   - **X11**: Press `Alt+F2`, type `r`, and press Enter.

5. Enable the extension:

   ```bash
   gnome-extensions enable claude-monitor@miferco97
   ```

## Configuration

![Settings window with plan, style, and general options](screenshots/settings.png)

Open the preferences window from the dropdown menu ("Settings") or via:

```bash
gnome-extensions prefs claude-monitor@miferco97
```

### Subscription Plan

| Setting | Options | Description |
|---------|---------|-------------|
| Plan Type | Pro, Max 5x, Max 20x | Sets token and cost limits for the usage bar |
| Estimation Mode | Conservative, Balanced, Generous | How aggressively to scale estimates vs `/usage` |

### Indicator Style

| Setting | Options | Description |
|---------|---------|-------------|
| Show Claude Prefix | On/Off | Display a label or icon before the bar |
| Prefix Style | Text, Icon | Show the word "Claude" or the Claude logo |
| Bar Style | Blocks, Smooth, Dots, Squares, Thin | Visual style for the progress bar |
| Bar Length | 5–30 | Number of segments in the bar |
| Bar Color | White, Green-Red, Blue, Purple, Amber, Rainbow | Color scheme |
| Bar Metric | Cost, Tokens | What the progress bar represents |
| Show Time Remaining | On/Off | Display estimated time until plan limit |

### General

| Setting | Options | Description |
|---------|---------|-------------|
| Refresh Interval | 5–120 seconds | How often to re-read data files |
| Panel Position | Left, Right | Which side of the top bar |

## How It Works

The extension reads Claude Code's JSONL conversation logs on a timer and:

1. **Finds recent files** — scans `~/.claude/projects/` for `.jsonl` files modified within the current 5-hour billing window (aligned to Anthropic's rate-limit windows).
2. **Deduplicates entries** — Claude Code writes multiple JSONL entries per assistant message (streaming partials followed by a final entry). The parser keeps the last entry per message ID to get accurate token counts.
3. **Calculates per-model costs** — each entry is priced according to its model tier (Opus, Sonnet, Haiku) rather than a flat rate.
4. **Applies estimation scaling** — a configurable multiplier approximates Anthropic's server-side `/usage` numbers, which include overhead not recorded in JSONL files.
5. **Renders the panel indicator** — a progress bar with the chosen style, color scheme, and optional time-remaining estimate.

## File Structure

```
├── extension.js      # Main indicator logic, data parsing, cost calculation
├── prefs.js          # GTK4/Adw preferences window
├── stylesheet.css    # Panel styling
├── metadata.json     # GNOME Shell extension metadata
├── schemas/          # GSettings schema
│   └── org.gnome.shell.extensions.claude-monitor.gschema.xml
└── icons/            # Claude logo PNGs (16px, 32px, 48px)
```

## Development

- On Wayland, `disable`/`enable` via D-Bus reloads settings but **not** JS code changes — a full session restart (log out/in) is required to pick up `extension.js` changes.
- After modifying the GSettings schema, recompile:

  ```bash
  glib-compile-schemas schemas/
  ```

- View extension logs:

  ```bash
  journalctl -f -o cat /usr/bin/gnome-shell
  ```

## Acknowledgements

Inspired by [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor).

## License

MIT

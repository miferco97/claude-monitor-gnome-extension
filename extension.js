imports.gi.versions.Soup = "3.0";
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Soup = imports.gi.Soup;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Rate-limit API configuration
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const API_FETCH_INTERVAL_MIN_MS = 10 * 1000; // minimum 10 seconds

/**
 * Read the OAuth access token from ~/.claude/.credentials.json
 * Returns { token, expired } or null if credentials not found.
 */
function _readOAuthToken() {
  try {
    const credPath =
      (GLib.getenv("CLAUDE_CONFIG_DIR") || GLib.get_home_dir() + "/.claude") +
      "/.credentials.json";
    const file = Gio.File.new_for_path(credPath);
    if (!file.query_exists(null)) return null;

    const [ok, contents] = file.load_contents(null);
    if (!ok) return null;

    const creds = JSON.parse(new TextDecoder().decode(contents));
    const oauth = creds.claudeAiOauth;
    if (!oauth || !oauth.accessToken) return null;

    const expired =
      oauth.expiresAt && oauth.expiresAt < Date.now();
    return { token: oauth.accessToken, expired: !!expired };
  } catch (e) {
    return null;
  }
}

/**
 * Resolve the claude binary symlink to extract the version number.
 * e.g. ~/.local/share/claude/versions/2.1.90 → "2.1.90"
 * Falls back to "2.0.0" if unresolvable.
 */
function _getClaudeCodeVersion() {
  try {
    const claudePath = GLib.find_program_in_path("claude");
    if (!claudePath) return "2.0.0";
    const file = Gio.File.new_for_path(claudePath);
    const info = file.query_info("standard::symlink-target", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    const target = info.get_symlink_target();
    if (!target) return "2.0.0";
    const match = target.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : "2.0.0";
  } catch (_) {
    return "2.0.0";
  }
}

// Pricing per million tokens
const PRICING = {
  opus: {
    input: 15.0,
    output: 75.0,
    cache_create: 18.75,
    cache_read: 1.5,
  },
  sonnet: {
    input: 3.0,
    output: 15.0,
    cache_create: 3.75,
    cache_read: 0.3,
  },
  haiku: {
    input: 0.25,
    output: 1.25,
    cache_create: 0.3,
    cache_read: 0.03,
  },
};

const PLAN_LIMITS = {
  pro: { tokens: 19000, cost: 18.0, label: "Pro ($20/mo)" },
  max5: { tokens: 88000, cost: 35.0, label: "Max 5x ($100/mo)" },
  max20: { tokens: 220000, cost: 140.0, label: "Max 20x ($200/mo)" },
};

const ESTIMATION_MODES = {
  conservative: 0.8,
  balanced: 1.0,
  generous: 1.2,
};

// Bar style character pairs: [filled, empty]
const BAR_STYLES = {
  blocks: ["\u2588", "\u2591"], // █ ░
  dots: ["\u25CF", "\u25CB"], // ● ○
  squares: ["\u25A0", "\u25A1"], // ■ □
  thin: ["\u25B0", "\u25B1"], // ▰ ▱
};

// Fractional block characters for smooth bar (0/8 through 8/8)
const SMOOTH_BLOCKS = [
  " ",
  "\u258F",
  "\u258E",
  "\u258D",
  "\u258C",
  "\u258B",
  "\u258A",
  "\u2589",
  "\u2588",
];

// Cairo-rendered bar styles (use St.DrawingArea instead of Pango markup)
const CAIRO_BAR_STYLES = new Set([
  "pill",
  "thick-rounded",
  "segmented",
  "glow-edge",
]);

// Color schemes: [filled_color, empty_color]
const BAR_COLORS = {
  white: { filled: "#e0e0e0", empty: "#555555" },
  "green-red": { gradient: true, empty: "#555555" },
  blue: { filled: "#5b9bf5", empty: "#2a3a5c" },
  purple: { filled: "#c4a0ff", empty: "#3d2a5c" },
  amber: { filled: "#ffb74d", empty: "#5c4a2a" },
  rainbow: { gradient: true, empty: "#555555" },
  dracula: { gradient: true, empty: "#44475a" },
  nord: { gradient: true, empty: "#3b4252" },
  catppuccin: { gradient: true, empty: "#45475a" },
  neon: { gradient: true, empty: "#1a1a2e" },
  sunset: { gradient: true, empty: "#2d1b3d" },
  ocean: { gradient: true, empty: "#0d253f" },
  solarized: { gradient: true, empty: "#073642" },
  accent: { filled: null, empty: "#555555" },
  custom: { gradient: true, empty: "#555555" },
};

// Module-level vars for custom color (set in _updateDisplay)
let _customColorStart = "#5b9bf5";
let _customColorEnd = "#c4a0ff";

// All bar styles for middle-click cycling
const ALL_BAR_STYLES = [
  "blocks",
  "smooth",
  "dots",
  "squares",
  "thin",
  "pill",
  "thick-rounded",
  "segmented",
  "glow-edge",
  "vbar",
  "vbar-dual",
];

function _getAccentColor() {
  try {
    const ifaceSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });
    const accent = ifaceSettings.get_string("accent-color");
    const accentMap = {
      blue: "#3584e4",
      teal: "#2190a4",
      green: "#3a944a",
      yellow: "#c88800",
      orange: "#ed5b00",
      red: "#e62d42",
      pink: "#d56199",
      purple: "#9141ac",
      slate: "#6f8396",
    };
    return accentMap[accent] || "#3584e4";
  } catch (e) {
    return "#3584e4";
  }
}

function _getGradientColor(fraction, scheme) {
  if (scheme === "custom") {
    const [r1, g1, b1] = _hexToRGBA(_customColorStart).map((v) =>
      Math.round(v * 255),
    );
    const [r2, g2, b2] = _hexToRGBA(_customColorEnd).map((v) =>
      Math.round(v * 255),
    );
    return _lerpColor(r1, g1, b1, r2, g2, b2, fraction);
  }
  if (scheme === "green-red") {
    if (fraction <= 0.5) {
      const t = fraction * 2;
      const r = Math.round(100 + 155 * t);
      const g = Math.round(220 - 40 * t);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}30`;
    } else {
      const t = (fraction - 0.5) * 2;
      const r = Math.round(255);
      const g = Math.round(180 - 160 * t);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}30`;
    }
  }
  if (scheme === "rainbow") {
    const hue = fraction * 300;
    return _hslToHex(hue, 80, 65);
  }
  if (scheme === "dracula") {
    return _lerpColor(0xbd, 0x93, 0xf9, 0xff, 0x79, 0xc6, fraction);
  }
  if (scheme === "nord") {
    return _lerpColor(0x5e, 0x81, 0xac, 0x88, 0xc0, 0xd0, fraction);
  }
  if (scheme === "catppuccin") {
    if (fraction <= 0.5) {
      const t = fraction * 2;
      return _lerpColor(0xcb, 0xa6, 0xf7, 0xfa, 0xb3, 0x87, t);
    } else {
      const t = (fraction - 0.5) * 2;
      return _lerpColor(0xfa, 0xb3, 0x87, 0xa6, 0xe3, 0xa1, t);
    }
  }
  if (scheme === "neon") {
    if (fraction <= 0.5) {
      const t = fraction * 2;
      return _lerpColor(0x00, 0xff, 0xff, 0xff, 0x00, 0xff, t);
    } else {
      const t = (fraction - 0.5) * 2;
      return _lerpColor(0xff, 0x00, 0xff, 0x00, 0xff, 0x00, t);
    }
  }
  if (scheme === "sunset") {
    if (fraction <= 0.5) {
      const t = fraction * 2;
      return _lerpColor(0xff, 0x8c, 0x42, 0xd6, 0x32, 0x30, t);
    } else {
      const t = (fraction - 0.5) * 2;
      return _lerpColor(0xd6, 0x32, 0x30, 0x7b, 0x2d, 0x8e, t);
    }
  }
  if (scheme === "ocean") {
    if (fraction <= 0.5) {
      const t = fraction * 2;
      return _lerpColor(0x1a, 0x52, 0x76, 0x2e, 0x86, 0xab, t);
    } else {
      const t = (fraction - 0.5) * 2;
      return _lerpColor(0x2e, 0x86, 0xab, 0x48, 0xc9, 0xb0, t);
    }
  }
  if (scheme === "solarized") {
    if (fraction <= 0.5) {
      const t = fraction * 2;
      return _lerpColor(0xb5, 0x89, 0x00, 0xcb, 0x4b, 0x16, t);
    } else {
      const t = (fraction - 0.5) * 2;
      return _lerpColor(0xcb, 0x4b, 0x16, 0xdc, 0x32, 0x2f, t);
    }
  }
  return "#e0e0e0";
}

function _hexToRGBA(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

function _lerpColor(r1, g1, b1, r2, g2, b2, t) {
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function _hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  const toHex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Cairo rounded rectangle utility
function _roundedRect(cr, x, y, w, h, r) {
  const deg = Math.PI / 180;
  cr.newSubPath();
  cr.arc(x + w - r, y + r, r, -90 * deg, 0 * deg);
  cr.arc(x + w - r, y + h - r, r, 0 * deg, 90 * deg);
  cr.arc(x + r, y + h - r, r, 90 * deg, 180 * deg);
  cr.arc(x + r, y + r, r, 180 * deg, 270 * deg);
  cr.closePath();
}

// Get fill color for a bar (resolves accent color dynamically)
function _getFilledColor(colorScheme) {
  const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];
  if (colorScheme === "accent") return _getAccentColor();
  return scheme.filled || "#e0e0e0";
}

const SESSION_HOURS = 5;
const LOOKBACK_HOURS = 10;

function _formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function _formatCost(c) {
  if (c >= 10) return `$${c.toFixed(1)}`;
  return `$${c.toFixed(2)}`;
}

function _formatTimeRemaining(minutes) {
  if (minutes <= 0) return "exhausted";
  if (minutes === Infinity) return "--";
  if (minutes < 60) return `${Math.round(minutes)}m est.`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h est.`;
  return `${h}h ${m}m est.`;
}

function _formatResetTime(minutes) {
  if (minutes === null || minutes === undefined) return "--";
  if (minutes <= 0) return "resetting now";
  if (minutes < 60) return `${Math.round(minutes)}m reset`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m reset`;
}

function _floorToHourUTC(ms) {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

function _detectSessionStart(entries, nowMs) {
  if (entries.length === 0) return null;

  const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
  const windowDuration = SESSION_HOURS * 3600000;

  let windowStart = _floorToHourUTC(sorted[0].timestamp);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp >= windowStart + windowDuration) {
      windowStart = _floorToHourUTC(sorted[i].timestamp);
    }
  }

  if (windowStart + windowDuration <= nowMs) return null;

  return windowStart;
}

function _makeBar(fraction, segments, style, colorScheme) {
  const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];

  if (style === "smooth")
    return _makeSmoothBar(fraction, segments, scheme, colorScheme);

  const chars = BAR_STYLES[style] || BAR_STYLES["blocks"];
  const filled = Math.round(Math.min(fraction, 1.0) * segments);
  const empty = segments - filled;

  if (scheme.gradient) {
    let markup = "";
    for (let i = 0; i < segments; i++) {
      if (i < filled) {
        const segFraction = segments <= 1 ? 0.5 : i / (segments - 1);
        const color = _getGradientColor(segFraction, colorScheme);
        markup += `<span foreground="${color}">${chars[0]}</span>`;
      } else {
        markup += `<span foreground="${scheme.empty}">${chars[1]}</span>`;
      }
    }
    return markup;
  }

  const filledColor =
    colorScheme === "accent" ? _getAccentColor() : scheme.filled;
  let markup = "";
  if (filled > 0)
    markup += `<span foreground="${filledColor}">${chars[0].repeat(filled)}</span>`;
  if (empty > 0)
    markup += `<span foreground="${filledColor}">${chars[1].repeat(empty)}</span>`;
  return markup;
}

function _makeSmoothBar(fraction, segments, scheme, colorScheme) {
  const clamped = Math.min(Math.max(fraction, 0), 1.0);
  const fillExact = clamped * segments;
  const fullCount = Math.floor(fillExact);
  const partialIndex = Math.round((fillExact - fullCount) * 8);
  const hasPartial = partialIndex > 0 && fullCount < segments;
  const emptyCount = segments - fullCount - (hasPartial ? 1 : 0);

  let markup = "";

  if (scheme.gradient) {
    for (let i = 0; i < fullCount; i++) {
      const segFraction = segments <= 1 ? 0.5 : i / (segments - 1);
      const color = _getGradientColor(segFraction, colorScheme);
      markup += `<span foreground="${color}">\u2588</span>`;
    }
    if (hasPartial) {
      const segFraction = segments <= 1 ? 0.5 : fullCount / (segments - 1);
      const color = _getGradientColor(segFraction, colorScheme);
      markup += `<span foreground="${color}">${SMOOTH_BLOCKS[partialIndex]}</span>`;
    }
    for (let i = 0; i < emptyCount; i++) {
      markup += `<span foreground="${scheme.empty}">\u2591</span>`;
    }
    return markup;
  }

  const filledColor =
    colorScheme === "accent" ? _getAccentColor() : scheme.filled;
  if (fullCount > 0)
    markup += `<span foreground="${filledColor}">${"\u2588".repeat(fullCount)}</span>`;
  if (hasPartial)
    markup += `<span foreground="${filledColor}">${SMOOTH_BLOCKS[partialIndex]}</span>`;
  if (emptyCount > 0)
    markup += `<span foreground="${filledColor}">${"\u2591".repeat(emptyCount)}</span>`;
  return markup;
}

function _getModelTier(modelName) {
  if (!modelName) return "sonnet";
  const m = modelName.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  return "sonnet";
}

// Per-file cache: path -> { mtime, entries }
const _fileCache = new Map();

function _findRecentJsonlFiles(basePath, cutoffSecs) {
  const files = [];
  const baseDir = Gio.File.new_for_path(basePath);
  if (!baseDir.query_exists(null)) return files;

  _recurseDir(baseDir, files, cutoffSecs);
  return files;
}

function _recurseDir(dir, results, cutoffSecs) {
  let enumerator;
  try {
    enumerator = dir.enumerate_children(
      "standard::name,standard::type,time::modified",
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
  } catch (e) {
    return;
  }

  let info;
  while ((info = enumerator.next_file(null)) !== null) {
    const child = dir.get_child(info.get_name());
    const fileType = info.get_file_type();

    if (fileType === Gio.FileType.DIRECTORY) {
      _recurseDir(child, results, cutoffSecs);
    } else if (info.get_name().endsWith(".jsonl")) {
      const mtime = info.get_modification_date_time();
      if (mtime && mtime.to_unix() < cutoffSecs) continue;
      results.push({
        path: child.get_path(),
        mtime: mtime ? mtime.to_unix() : 0,
      });
    }
  }
  enumerator.close(null);
}

let _dedupCounter = 0;

function _extractUsage(entry) {
  const isAssistant = entry.type === "assistant";
  const sources = isAssistant
    ? [entry.message?.usage, entry.usage, entry]
    : [entry.usage, entry.message?.usage, entry];

  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const inp = src.input_tokens || src.inputTokens || 0;
    const out = src.output_tokens || src.outputTokens || 0;
    if (inp > 0 || out > 0) {
      return {
        input_tokens: inp,
        output_tokens: out,
        cache_creation_input_tokens:
          src.cache_creation_input_tokens || src.cache_creation_tokens || 0,
        cache_read_input_tokens:
          src.cache_read_input_tokens || src.cache_read_tokens || 0,
      };
    }
  }
  return null;
}

function _extractModel(entry) {
  return entry.message?.model || entry.model || entry.usage?.model || "";
}

function _readAndParseJsonl(fileInfos, cutoffTime) {
  const decoder = new TextDecoder("utf-8");
  const seenKeys = new Set();
  const results = [];
  const usedPaths = new Set();

  for (const fi of fileInfos) {
    usedPaths.add(fi.path);

    const cached = _fileCache.get(fi.path);
    if (cached && cached.mtime === fi.mtime) {
      for (const e of cached.entries) {
        if (e.timestamp < cutoffTime) continue;
        if (e.dedupKey && seenKeys.has(e.dedupKey)) continue;
        if (e.dedupKey) seenKeys.add(e.dedupKey);
        results.push(e);
      }
      continue;
    }

    let contents;
    try {
      const file = Gio.File.new_for_path(fi.path);
      const [ok, data] = file.load_contents(null);
      if (!ok) continue;
      contents = decoder.decode(data);
    } catch (e) {
      continue;
    }

    const fileEntries = [];
    const lines = contents.split("\n");
    for (const line of lines) {
      if (!line.includes("tokens")) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (e) {
        continue;
      }

      const usage = _extractUsage(entry);
      if (!usage) continue;

      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

      const msgId = entry.message?.id || entry.message_id || "";
      const reqId = entry.requestId || entry.request_id || "";
      const dedupKey = msgId && reqId ? `${msgId}_${reqId}` : null;

      const parsed = {
        timestamp: ts,
        model: _extractModel(entry),
        usage,
        dedupKey,
      };
      fileEntries.push(parsed);

      if (ts < cutoffTime) continue;
      if (dedupKey && seenKeys.has(dedupKey)) continue;
      if (dedupKey) seenKeys.add(dedupKey);
      results.push(parsed);
    }

    _fileCache.set(fi.path, { mtime: fi.mtime, entries: fileEntries });
  }

  for (const key of _fileCache.keys()) {
    if (!usedPaths.has(key)) _fileCache.delete(key);
  }

  return results;
}

function _calculateStats(entries) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let earliestTs = Infinity;
  let latestTs = 0;
  let activeModel = "";

  let totalCost = 0;
  for (const entry of entries) {
    const u = entry.usage;
    const inp = u.input_tokens || 0;
    const out = u.output_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;

    totalInput += inp;
    totalOutput += out;
    totalCacheCreate += cc;
    totalCacheRead += cr;

    const p = PRICING[_getModelTier(entry.model)];
    totalCost +=
      (inp * p.input +
        out * p.output +
        cc * p.cache_create +
        cr * p.cache_read) /
      1000000;

    if (entry.timestamp < earliestTs) earliestTs = entry.timestamp;
    if (entry.timestamp > latestTs) {
      latestTs = entry.timestamp;
      activeModel = entry.model;
    }
  }

  const totalTokens =
    totalInput + totalOutput + totalCacheCreate + totalCacheRead;
  const billableTokens = totalInput + totalOutput;
  const durationMinutes =
    entries.length > 0 ? Math.max((latestTs - earliestTs) / 60000, 1) : 0;
  const burnRateTokensH =
    durationMinutes > 0 ? (billableTokens / durationMinutes) * 60 : 0;
  const burnRateCostH =
    durationMinutes > 0 ? (totalCost / durationMinutes) * 60 : 0;

  return {
    totalInput,
    totalOutput,
    totalCacheCreate,
    totalCacheRead,
    totalTokens,
    billableTokens,
    totalCost,
    burnRateTokensH,
    burnRateCostH,
    durationMinutes,
    activeModel,
    entryCount: entries.length,
  };
}

const ClaudeMonitorIndicator = GObject.registerClass(
  class ClaudeMonitorIndicator extends PanelMenu.Button {
    _init(extension) {
      super._init(0.0, "Claude Token Monitor", false);
      this._extension = extension;
      this._settings = extension.getSettings();
      this._extensionPath = extension.path;
      this._isPulsing = false;
      this._burnHistory = [];
      this._apiUtilization = null; // Last successful API response
      this._apiError = null; // Error message if API call failed
      this._apiFetching = false; // Prevent concurrent API calls
      this._soupSession = null; // Lazy-init HTTP session
      this._lastApiFetchMs = 0; // Timestamp of last API fetch attempt
      this._apiLastUpdatedMs = null; // Timestamp of last successful API response
      this._apiDataFresh = false; // True only during the _refreshDisplay() call right after fetch
      this._apiAnchorFraction = null; // API utilization fraction at last anchor
      this._heuristicAnchorFraction = null; // Heuristic fraction at same anchor moment

      // Panel box
      this._box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
      this.add_child(this._box);

      // Icon container (for badge overlay)
      this._iconContainer = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        y_align: Clutter.ActorAlign.CENTER,
        style: "width: 18px; height: 18px;",
      });
      this._iconContainer.set_clip_to_allocation(false);
      this._iconContainer.visible = false;

      // Icon
      this._icon = new St.Icon({
        style_class: "claude-monitor-icon",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._icon.set_pivot_point(0.5, 0.5);
      this._iconContainer.add_child(this._icon);

      // Status badge on icon — positioned at top-right corner
      this._iconBadge = new St.Label({
        text: "\u25CF",
        style_class: "claude-monitor-badge",
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
      });
      this._iconBadge.visible = false;
      this._iconContainer.add_child(this._iconBadge);

      // Label
      this._label = new St.Label({
        text: "Claude: --",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "claude-monitor-label",
      });

      // Horizontal Cairo bar
      this._hbar = new St.DrawingArea({
        style_class: "claude-monitor-hbar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._hbar.set_size(80, 10);
      this._hbar.visible = false;
      this._hbar._fraction = 0;
      this._hbar._style = "pill";
      this._hbar._colorScheme = "white";
      this._hbar._barLength = 10;
      this._hbar.connect("repaint", (area) => this._drawHBar(area));

      // Status dot
      this._statusDot = new St.Label({
        text: "\u25CF",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "claude-monitor-dot",
      });
      this._statusDot.visible = false;

      // Vertical bar widgets
      this._vbar = new St.DrawingArea({
        style_class: "claude-monitor-vbar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._vbar.set_size(6, 16);
      this._vbar.visible = false;
      this._vbar._fraction = 0;
      this._vbar._color1 = "#64dc8e";
      this._vbar._color2 = "#ffb400";
      this._vbar.connect("repaint", (area) => this._drawVBar(area));

      this._vbar2 = new St.DrawingArea({
        style_class: "claude-monitor-vbar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._vbar2.set_size(5, 16);
      this._vbar2.visible = false;
      this._vbar2._fraction = 0;
      this._vbar2._color1 = "#5b9bf5";
      this._vbar2._color2 = "#5b9bf5";
      this._vbar2.connect("repaint", (area) => this._drawVBar(area));

      // Store element widgets for reordering
      this._elementWidgets = {
        icon: this._iconContainer,
        label: this._label,
        bar: this._hbar,
        dot: this._statusDot,
        vbar: this._vbar,
        vbar2: this._vbar2,
      };

      // Apply initial element order
      this._reorderElements();

      // Middle-click to cycle bar styles
      this.connect("event", (actor, event) => {
        if (
          event.type() === Clutter.EventType.BUTTON_PRESS &&
          event.get_button() === 2
        ) {
          this._cycleBarStyle();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });

      this._buildMenu();
      this._updatePillBackground();
      this._updateFontSize();
      this._refresh();
      this._startTimer();

      this._settingsChangedId = this._settings.connect("changed", (s, key) => {
        if (key === "pill-background") this._updatePillBackground();
        if (key === "dropdown-style") this._rebuildMenu();
        if (key === "font-size") this._updateFontSize();
        if (key === "element-order") this._reorderElements();
        this._refresh();
      });
    }

    // ── Middle-click cycling ─────────────────────────────────

    _cycleBarStyle() {
      const current = this._settings.get_string("bar-style");
      const idx = ALL_BAR_STYLES.indexOf(current);
      const next = ALL_BAR_STYLES[(idx + 1) % ALL_BAR_STYLES.length];
      this._settings.set_string("bar-style", next);
    }

    // ── Font size ────────────────────────────────────────────

    _updateFontSize() {
      this._box.remove_style_class_name("claude-text-small");
      this._box.remove_style_class_name("claude-text-large");
      const fontSize = this._settings.get_string("font-size");
      if (fontSize === "small") this._box.add_style_class_name("claude-text-small");
      else if (fontSize === "large")
        this._box.add_style_class_name("claude-text-large");
    }

    // ── Cairo horizontal bar drawing ─────────────────────────

    _drawHBar(area) {
      const [w, h] = area.get_surface_size();
      const cr = area.get_context();
      const frac = Math.min(Math.max(area._fraction || 0, 0), 1.0);
      const style = area._style || "pill";
      const colorScheme = area._colorScheme || "white";

      if (style === "pill") {
        this._drawPillBar(cr, w, h, frac, colorScheme);
      } else if (style === "thick-rounded") {
        this._drawThickRoundedBar(cr, w, h, frac, colorScheme);
      } else if (style === "segmented") {
        this._drawSegmentedBar(cr, w, h, frac, colorScheme, area._barLength);
      } else if (style === "glow-edge") {
        this._drawGlowEdgeBar(cr, w, h, frac, colorScheme);
      }

      cr.$dispose();
    }

    _drawPillBar(cr, w, h, frac, colorScheme) {
      const radius = h / 2;
      const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];
      const fillW = Math.round(frac * w);

      // Track
      _roundedRect(cr, 0, 0, w, h, radius);
      cr.setSourceRGBA(0.15, 0.15, 0.2, 0.8);
      cr.fill();

      if (fillW > 0) {
        cr.save();
        cr.rectangle(0, 0, fillW, h);
        cr.clip();
        _roundedRect(cr, 0, 0, w, h, radius);
        if (scheme.gradient || colorScheme === "custom") {
          const pat = new imports.cairo.LinearGradient(0, 0, w, 0);
          const c1 = _hexToRGBA(_getGradientColor(0, colorScheme));
          const c2 = _hexToRGBA(_getGradientColor(1, colorScheme));
          pat.addColorStopRGBA(0, c1[0], c1[1], c1[2], 1);
          pat.addColorStopRGBA(1, c2[0], c2[1], c2[2], 1);
          cr.setSource(pat);
        } else {
          const c = _hexToRGBA(_getFilledColor(colorScheme));
          cr.setSourceRGBA(c[0], c[1], c[2], 1);
        }
        cr.fill();
        cr.restore();
      }
    }

    _drawThickRoundedBar(cr, w, h, frac, colorScheme) {
      const radius = h / 2;
      const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];
      const fillW = Math.round(frac * w);

      // Track
      _roundedRect(cr, 0, 0, w, h, radius);
      cr.setSourceRGBA(0.15, 0.15, 0.2, 0.8);
      cr.fill();

      if (fillW > 0) {
        // Glow layer
        const glowColor =
          scheme.gradient || colorScheme === "custom"
            ? _hexToRGBA(_getGradientColor(frac, colorScheme))
            : _hexToRGBA(_getFilledColor(colorScheme));
        _roundedRect(cr, -1, -1, fillW + 2, h + 2, radius + 1);
        cr.setSourceRGBA(glowColor[0], glowColor[1], glowColor[2], 0.3);
        cr.fill();

        // Fill
        cr.save();
        cr.rectangle(0, 0, fillW, h);
        cr.clip();
        _roundedRect(cr, 0, 0, w, h, radius);
        if (scheme.gradient || colorScheme === "custom") {
          const pat = new imports.cairo.LinearGradient(0, 0, w, 0);
          const c1 = _hexToRGBA(_getGradientColor(0, colorScheme));
          const c2 = _hexToRGBA(_getGradientColor(1, colorScheme));
          pat.addColorStopRGBA(0, c1[0], c1[1], c1[2], 1);
          pat.addColorStopRGBA(1, c2[0], c2[1], c2[2], 1);
          cr.setSource(pat);
        } else {
          const c = _hexToRGBA(_getFilledColor(colorScheme));
          cr.setSourceRGBA(c[0], c[1], c[2], 1);
        }
        cr.fill();
        cr.restore();
      }
    }

    _drawSegmentedBar(cr, w, h, frac, colorScheme, segCount) {
      const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];
      segCount = segCount || 10;
      const gap = 2;
      const segW = (w - gap * (segCount - 1)) / segCount;
      const filledCount = Math.round(frac * segCount);
      const radius = 2;

      for (let i = 0; i < segCount; i++) {
        const x = i * (segW + gap);
        _roundedRect(cr, x, 0, segW, h, radius);

        if (i < filledCount) {
          if (scheme.gradient || colorScheme === "custom") {
            const segFrac = segCount <= 1 ? 0.5 : i / (segCount - 1);
            const c = _hexToRGBA(_getGradientColor(segFrac, colorScheme));
            cr.setSourceRGBA(c[0], c[1], c[2], 1);
          } else {
            const c = _hexToRGBA(_getFilledColor(colorScheme));
            cr.setSourceRGBA(c[0], c[1], c[2], 1);
          }
        } else {
          cr.setSourceRGBA(0.1, 0.1, 0.15, 0.8);
        }
        cr.fill();
      }
    }

    _drawGlowEdgeBar(cr, w, h, frac, colorScheme) {
      const radius = h / 2;
      const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];
      const fillW = Math.round(frac * w);

      // Track
      _roundedRect(cr, 0, 0, w, h, radius);
      cr.setSourceRGBA(0.15, 0.15, 0.2, 0.8);
      cr.fill();

      if (fillW > 0) {
        // Main fill
        cr.save();
        cr.rectangle(0, 0, fillW, h);
        cr.clip();
        _roundedRect(cr, 0, 0, w, h, radius);
        if (scheme.gradient || colorScheme === "custom") {
          const pat = new imports.cairo.LinearGradient(0, 0, w, 0);
          const c1 = _hexToRGBA(_getGradientColor(0, colorScheme));
          const c2 = _hexToRGBA(_getGradientColor(1, colorScheme));
          pat.addColorStopRGBA(0, c1[0], c1[1], c1[2], 1);
          pat.addColorStopRGBA(1, c2[0], c2[1], c2[2], 1);
          cr.setSource(pat);
        } else {
          const c = _hexToRGBA(_getFilledColor(colorScheme));
          cr.setSourceRGBA(c[0], c[1], c[2], 1);
        }
        cr.fill();
        cr.restore();

        // Glowing leading edge
        const edgeColor =
          scheme.gradient || colorScheme === "custom"
            ? _hexToRGBA(_getGradientColor(frac, colorScheme))
            : _hexToRGBA(_getFilledColor(colorScheme));
        const glowR = h * 1.5;
        const pat = new imports.cairo.RadialGradient(
          fillW,
          h / 2,
          0,
          fillW,
          h / 2,
          glowR,
        );
        pat.addColorStopRGBA(0, edgeColor[0], edgeColor[1], edgeColor[2], 0.6);
        pat.addColorStopRGBA(1, edgeColor[0], edgeColor[1], edgeColor[2], 0.0);
        cr.setSource(pat);
        cr.rectangle(Math.max(0, fillW - glowR), 0, glowR * 2, h);
        cr.fill();
      }
    }

    // ── Vertical bar drawing ─────────────────────────────────

    _drawVBar(area) {
      const [w, h] = area.get_surface_size();
      const cr = area.get_context();
      const frac = Math.min(Math.max(area._fraction || 0, 0), 1.0);
      const fillH = Math.round(frac * h);

      // Background track
      cr.setSourceRGBA(0.3, 0.3, 0.3, 0.6);
      cr.rectangle(0, 0, w, h);
      cr.fill();

      // Filled portion (bottom-up gradient)
      if (fillH > 0) {
        const pat = new imports.cairo.LinearGradient(0, h, 0, h - fillH);
        const c1 = _hexToRGBA(area._color1 || "#64dc8e");
        const c2 = _hexToRGBA(area._color2 || "#ffb400");
        pat.addColorStopRGBA(0, c1[0], c1[1], c1[2], 1);
        pat.addColorStopRGBA(1, c2[0], c2[1], c2[2], 1);
        cr.setSource(pat);
        cr.rectangle(0, h - fillH, w, fillH);
        cr.fill();
      }

      cr.$dispose();
    }

    _updateVBar(fraction, stats, plan, barMetric) {
      const barStyle = this._settings.get_string("bar-style");

      this._vbar._fraction = fraction;
      this._vbar._color1 = "#64dc8e";
      this._vbar._color2 = "#ffb400";
      this._vbar.visible = true;
      this._vbar.queue_repaint();

      if (barStyle === "vbar-dual" && plan) {
        const frac2 =
          barMetric === "tokens"
            ? stats.totalCost / plan.cost
            : stats.billableTokens / plan.tokens;
        this._vbar2._fraction = frac2;
        this._vbar2._color1 = "#5b9bf5";
        this._vbar2._color2 = "#5b9bf5";
        this._vbar2.visible = true;
        this._vbar2.queue_repaint();
      }
    }

    // ── Animations ───────────────────────────────────────────

    _animateHBar(targetFraction) {
      const startFrac = this._hbar._fraction;
      const endFrac = targetFraction;

      if (this._hbarTimeline) {
        this._hbarTimeline.stop();
        this._hbarTimeline = null;
      }

      // Skip animation if change is tiny
      if (Math.abs(endFrac - startFrac) < 0.005) {
        this._hbar._fraction = endFrac;
        this._hbar.queue_repaint();
        return;
      }

      this._hbarTimeline = new Clutter.Timeline({
        duration: 400,
        actor: this._hbar,
      });

      this._hbarTimeline.connect("new-frame", (_timeline) => {
        const progress = _timeline.get_progress();
        this._hbar._fraction = startFrac + (endFrac - startFrac) * progress;
        this._hbar.queue_repaint();
      });

      this._hbarTimeline.connect("completed", () => {
        this._hbar._fraction = endFrac;
        this._hbar.queue_repaint();
        this._hbarTimeline = null;
      });

      this._hbarTimeline.start();
    }

    _updatePulseAnimation(fraction) {
      const enablePulse = this._settings.get_boolean("enable-pulse");
      const threshold = this._settings.get_int("pulse-threshold") / 100;
      if (enablePulse && fraction > threshold) {
        if (!this._isPulsing) {
          this._isPulsing = true;
          this._pulseLoop();
        }
      } else {
        if (this._isPulsing) {
          this._isPulsing = false;
          if (this._pulseTimerId) {
            GLib.source_remove(this._pulseTimerId);
            this._pulseTimerId = null;
          }
          this._box.remove_all_transitions();
          this._box.set_opacity(255);
        }
      }
    }

    _pulseLoop() {
      if (!this._isPulsing) return;

      // Use a GLib timer to alternate opacity, avoiding recursion from
      // synchronous onComplete callbacks when the actor isn't mapped.
      if (this._pulseTimerId) return; // already running

      let dim = true;
      this._pulseTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
        if (!this._isPulsing) {
          this._pulseTimerId = null;
          this._box.set_opacity(255);
          return GLib.SOURCE_REMOVE;
        }
        this._box.ease({
          opacity: dim ? 140 : 255,
          duration: 600,
          mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
        });
        dim = !dim;
        return GLib.SOURCE_CONTINUE;
      });
    }

    _reorderElements() {
      const orderStr = this._settings.get_string("element-order");
      const order = orderStr.split(",").map((s) => s.trim()).filter(Boolean);

      // Remove all children from box
      this._box.remove_all_children();

      // Re-add in specified order
      for (const key of order) {
        const widget = this._elementWidgets[key];
        if (widget) {
          this._box.add_child(widget);
        }
      }

      // Add any widgets not in the order string (safety net)
      for (const [key, widget] of Object.entries(this._elementWidgets)) {
        if (!order.includes(key) && widget.get_parent() !== this._box) {
          this._box.add_child(widget);
        }
      }
    }

    _spinIcon() {
      if (this._iconContainer.visible) {
        this._icon.ease({
          rotation_angle_z: 360,
          duration: 500,
          mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
          onComplete: () => {
            this._icon.rotation_angle_z = 0;
          },
        });
      }
    }

    _fadeUpdateLabel(markup) {
      this._label.ease({
        opacity: 80,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          this._label.clutter_text.set_markup(markup);
          this._label.ease({
            opacity: 255,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
          });
        },
      });
    }

    // ── Pill background ──────────────────────────────────────

    _updatePillBackground() {
      const pill = this._settings.get_string("pill-background");
      // Remove all pill classes
      this.remove_style_class_name("claude-pill-solid");
      this.remove_style_class_name("claude-pill-subtle");
      this.remove_style_class_name("claude-pill-border");
      this.remove_style_class_name("claude-pill-glow");
      this.remove_style_class_name("claude-pill-status-ok");
      this.remove_style_class_name("claude-pill-status-warn");
      this.remove_style_class_name("claude-pill-status-danger");

      if (pill === "solid") this.add_style_class_name("claude-pill-solid");
      else if (pill === "subtle")
        this.add_style_class_name("claude-pill-subtle");
      else if (pill === "border-only")
        this.add_style_class_name("claude-pill-border");
      else if (pill === "glow") this.add_style_class_name("claude-pill-glow");
      // "status" is handled dynamically in _updateDisplay
    }

    _updateStatusPill(fraction) {
      this.remove_style_class_name("claude-pill-status-ok");
      this.remove_style_class_name("claude-pill-status-warn");
      this.remove_style_class_name("claude-pill-status-danger");

      if (fraction < 0.5) this.add_style_class_name("claude-pill-status-ok");
      else if (fraction < 0.8)
        this.add_style_class_name("claude-pill-status-warn");
      else this.add_style_class_name("claude-pill-status-danger");
    }

    // ── Menu building ────────────────────────────────────────

    _buildMenu() {
      this._dropdownStyle = this._settings.get_string("dropdown-style");

      if (this._dropdownStyle === "modern") {
        this._buildModernMenu();
      } else if (this._dropdownStyle === "gauges") {
        this._buildGaugeMenu();
      } else {
        this._buildClassicMenu();
      }
    }

    _rebuildMenu() {
      this.menu.removeAll();
      this._buildMenu();
      this._refresh();
    }

    _buildClassicMenu() {
      this._headerItem = new PopupMenu.PopupMenuItem("Claude Token Monitor", {
        reactive: false,
      });
      this._headerItem.add_style_class_name("claude-monitor-header");
      this.menu.addMenuItem(this._headerItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._modelItem = this._addInfoItem("Model", "--");
      this._sessionItem = this._addInfoItem("Session", "--");

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._inputItem = this._addInfoItem("Input tokens", "--");
      this._outputItem = this._addInfoItem("Output tokens", "--");
      this._cacheCreateItem = this._addInfoItem("Cache create", "--");
      this._cacheReadItem = this._addInfoItem("Cache read", "--");
      this._totalItem = this._addInfoItem("Total tokens", "--");

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._costItem = this._addInfoItem("Total cost", "--");
      this._burnTokensItem = this._addInfoItem("Burn rate", "--");
      this._burnCostItem = this._addInfoItem("Cost rate", "--");
      this._timeRemainingItem = this._addInfoItem("Time remaining", "--");
      this._windowResetItem = this._addInfoItem("Window resets", "--");

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._planItem = this._addInfoItem("Plan usage", "--");
      this._dataSourceItem = this._addInfoItem("Data source", "--");

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const refreshItem = new PopupMenu.PopupMenuItem("Refresh Now");
      refreshItem.connect("activate", () => { this._lastApiFetchMs = 0; this._refresh(); });
      this.menu.addMenuItem(refreshItem);

      const settingsItem = new PopupMenu.PopupMenuItem("Settings");
      settingsItem.connect("activate", () => {
        try { this._extension.openPreferences(); } catch (_) {}
      });
      this.menu.addMenuItem(settingsItem);
    }

    _buildModernMenu() {
      // Apply frosted glass
      this.menu.box.add_style_class_name("claude-dropdown-frosted");

      this._headerItem = new PopupMenu.PopupMenuItem("", {
        reactive: false,
      });
      this._headerItem.add_style_class_name("claude-monitor-header");
      this._headerItem.label.clutter_text.set_markup(
        `<b>Claude Token Monitor</b>`,
      );
      this.menu.addMenuItem(this._headerItem);

      // Progress bar row
      this._progressItem = new PopupMenu.PopupMenuItem("", {
        reactive: false,
      });
      this._progressItem.add_style_class_name("claude-monitor-progress");
      this.menu.addMenuItem(this._progressItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Token breakdown with colored dots
      this._inputItem = this._addModernItem("\u25CF", "#5b9bf5", "Input", "--");
      this._outputItem = this._addModernItem(
        "\u25CF",
        "#64dc8e",
        "Output",
        "--",
      );
      this._cacheCreateItem = this._addModernItem(
        "\u25CF",
        "#c4a0ff",
        "Cache create",
        "--",
      );
      this._cacheReadItem = this._addModernItem(
        "\u25CF",
        "#666666",
        "Cache read",
        "--",
      );

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Burn rate & timing
      this._burnCostItem = this._addModernItem(
        "\u26A1",
        null,
        "Burn rate",
        "--",
      );

      // Sparkline
      this._sparklineItem = new PopupMenu.PopupMenuItem("", {
        reactive: false,
      });
      this._sparklineArea = new St.DrawingArea();
      this._sparklineArea.set_size(200, 30);
      this._sparklineArea.connect("repaint", (area) =>
        this._drawSparkline(area),
      );
      this._sparklineItem.add_child(this._sparklineArea);
      this.menu.addMenuItem(this._sparklineItem);

      this._timeRemainingItem = this._addModernItem(
        "\u23F1",
        null,
        "Time remaining",
        "--",
      );
      this._windowResetItem = this._addModernItem(
        "\u21BB",
        null,
        "Window resets",
        "--",
      );
      this._sessionItem = this._addModernItem(
        "\uD83D\uDCAC",
        null,
        "Session",
        "--",
      );
      this._dataSourceItem = this._addModernItem(
        "\uD83D\uDCE1",
        null,
        "Data source",
        "--",
      );

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const refreshItem = new PopupMenu.PopupMenuItem("\u21BB Refresh");
      refreshItem.connect("activate", () => { this._lastApiFetchMs = 0; this._refresh(); });
      this.menu.addMenuItem(refreshItem);

      const settingsItem = new PopupMenu.PopupMenuItem("\u2699 Settings");
      settingsItem.connect("activate", () => {
        try { this._extension.openPreferences(); } catch (_) {}
      });
      this.menu.addMenuItem(settingsItem);
    }

    _buildGaugeMenu() {
      // Apply frosted glass
      this.menu.box.add_style_class_name("claude-dropdown-frosted");

      this._headerItem = new PopupMenu.PopupMenuItem("", {
        reactive: false,
      });
      this._headerItem.add_style_class_name("claude-monitor-header");
      this._headerItem.label.clutter_text.set_markup(
        `<b>Claude Token Monitor</b>`,
      );
      this.menu.addMenuItem(this._headerItem);

      // Gauge area
      this._gaugeItem = new PopupMenu.PopupMenuItem("", { reactive: false });
      this._gaugeArea = new St.DrawingArea();
      this._gaugeArea.set_size(200, 100);
      this._gaugeArea._fraction = 0;
      this._gaugeArea._fraction2 = 0;
      this._gaugeArea._colorScheme = "white";
      this._gaugeArea.connect("repaint", (area) => this._drawGauge(area));
      this._gaugeItem.add_child(this._gaugeArea);
      this.menu.addMenuItem(this._gaugeItem);

      // Usage text below gauge
      this._gaugeLabel = new PopupMenu.PopupMenuItem("", { reactive: false });
      this.menu.addMenuItem(this._gaugeLabel);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Token breakdown
      this._inputItem = this._addModernItem("\u25CF", "#5b9bf5", "Input", "--");
      this._outputItem = this._addModernItem(
        "\u25CF",
        "#64dc8e",
        "Output",
        "--",
      );
      this._cacheCreateItem = this._addModernItem(
        "\u25CF",
        "#c4a0ff",
        "Cache create",
        "--",
      );
      this._cacheReadItem = this._addModernItem(
        "\u25CF",
        "#666666",
        "Cache read",
        "--",
      );

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._burnCostItem = this._addModernItem(
        "\u26A1",
        null,
        "Burn rate",
        "--",
      );
      this._timeRemainingItem = this._addModernItem(
        "\u23F1",
        null,
        "Time remaining",
        "--",
      );
      this._windowResetItem = this._addModernItem(
        "\u21BB",
        null,
        "Window resets",
        "--",
      );
      this._sessionItem = this._addModernItem(
        "\uD83D\uDCAC",
        null,
        "Session",
        "--",
      );
      this._dataSourceItem = this._addModernItem(
        "\uD83D\uDCE1",
        null,
        "Data source",
        "--",
      );

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const refreshItem = new PopupMenu.PopupMenuItem("\u21BB Refresh");
      refreshItem.connect("activate", () => { this._lastApiFetchMs = 0; this._refresh(); });
      this.menu.addMenuItem(refreshItem);

      const settingsItem = new PopupMenu.PopupMenuItem("\u2699 Settings");
      settingsItem.connect("activate", () => {
        try { this._extension.openPreferences(); } catch (_) {}
      });
      this.menu.addMenuItem(settingsItem);
    }

    // ── Sparkline drawing ────────────────────────────────────

    _drawSparkline(area) {
      const [w, h] = area.get_surface_size();
      const cr = area.get_context();
      const data = this._burnHistory;

      if (data.length < 2) {
        cr.setSourceRGBA(0.4, 0.4, 0.4, 0.3);
        cr.setFontSize(10);
        cr.moveTo(w / 2 - 30, h / 2 + 3);
        cr.showText("Collecting data...");
        cr.$dispose();
        return;
      }

      const max = Math.max(...data, 0.01);
      const barW = Math.max(Math.floor(w / data.length) - 1, 2);
      const gap = 1;

      for (let i = 0; i < data.length; i++) {
        const barH = Math.max((data[i] / max) * h, 1);
        const frac = data[i] / max;
        // Green to yellow to red gradient
        const r = frac < 0.5 ? frac * 2 : 1;
        const g = frac < 0.5 ? 0.86 : 1 - (frac - 0.5) * 2;
        cr.setSourceRGBA(r, g, 0.3, 0.7 + 0.3 * frac);
        _roundedRect(cr, i * (barW + gap), h - barH, barW, barH, 1);
        cr.fill();
      }

      cr.$dispose();
    }

    // ── Gauge drawing ────────────────────────────────────────

    _drawGauge(area) {
      const [w, h] = area.get_surface_size();
      const cr = area.get_context();
      const frac1 = Math.min(Math.max(area._fraction || 0, 0), 1.0);
      const frac2 = Math.min(Math.max(area._fraction2 || 0, 0), 1.0);
      const colorScheme = area._colorScheme || "white";
      const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];

      const cx = w / 2;
      const cy = h / 2;
      const outerR = Math.min(w, h) / 2 - 8;
      const innerR = outerR - 12;
      const lineW = 6;

      // Outer ring track
      cr.setLineWidth(lineW);
      cr.setLineCap(1); // ROUND
      cr.setSourceRGBA(0.15, 0.15, 0.2, 0.6);
      cr.arc(cx, cy, outerR, -Math.PI * 0.75, Math.PI * 0.75);
      cr.stroke();

      // Outer ring fill (cost)
      if (frac1 > 0) {
        const endAngle =
          -Math.PI * 0.75 + frac1 * Math.PI * 1.5;
        if (scheme.gradient || colorScheme === "custom") {
          const c = _hexToRGBA(_getGradientColor(frac1, colorScheme));
          cr.setSourceRGBA(c[0], c[1], c[2], 1);
        } else {
          const c = _hexToRGBA(_getFilledColor(colorScheme));
          cr.setSourceRGBA(c[0], c[1], c[2], 1);
        }
        cr.arc(cx, cy, outerR, -Math.PI * 0.75, endAngle);
        cr.stroke();
      }

      // Inner ring track
      cr.setLineWidth(lineW - 1);
      cr.setSourceRGBA(0.15, 0.15, 0.2, 0.4);
      cr.arc(cx, cy, innerR, -Math.PI * 0.75, Math.PI * 0.75);
      cr.stroke();

      // Inner ring fill (tokens)
      if (frac2 > 0) {
        const endAngle =
          -Math.PI * 0.75 + frac2 * Math.PI * 1.5;
        cr.setSourceRGBA(0.36, 0.61, 0.96, 1); // blue
        cr.arc(cx, cy, innerR, -Math.PI * 0.75, endAngle);
        cr.stroke();
      }

      // Center text
      cr.setSourceRGBA(0.9, 0.9, 0.9, 1);
      cr.setFontSize(16);
      const pctText = `${Math.round(frac1 * 100)}%`;
      const extents = cr.textExtents(pctText);
      cr.moveTo(cx - extents.width / 2, cy + extents.height / 4);
      cr.showText(pctText);

      cr.$dispose();
    }

    // ── Menu helpers ─────────────────────────────────────────

    _addInfoItem(label, value) {
      const item = new PopupMenu.PopupMenuItem("", { reactive: false });
      item.label.clutter_text.set_markup(`<b>${label}</b>`);
      item.label.x_expand = true;

      const valueLabel = new St.Label({
        text: value,
        x_align: Clutter.ActorAlign.END,
        x_expand: true,
        style_class: "claude-monitor-value",
      });
      item.add_child(valueLabel);
      item._valueLabel = valueLabel;
      item._labelPrefix = label;
      this.menu.addMenuItem(item);
      return item;
    }

    _addModernItem(icon, iconColor, label, value) {
      const item = new PopupMenu.PopupMenuItem("", { reactive: false });
      const iconMarkup = iconColor
        ? `<span foreground="${iconColor}">${icon}</span>`
        : icon;
      item.label.clutter_text.set_markup(`${iconMarkup}  ${label}`);
      item.label.x_expand = true;

      const valueLabel = new St.Label({
        x_align: Clutter.ActorAlign.END,
        x_expand: true,
        style_class: "claude-monitor-value",
      });
      valueLabel.clutter_text.set_markup(value);
      item.add_child(valueLabel);
      item._valueLabel = valueLabel;
      item._labelPrefix = label;
      item._icon = icon;
      item._iconColor = iconColor;
      this.menu.addMenuItem(item);
      return item;
    }

    _updateInfoItem(item, value) {
      if (item && item._valueLabel) {
        item._valueLabel.clutter_text.set_markup(value);
      }
    }

    // ── Timer ────────────────────────────────────────────────

    _startTimer() {
      const interval = this._settings.get_int("refresh-interval");
      this._timerId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        interval,
        () => {
          this._refresh();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _stopTimer() {
      if (this._timerId) {
        GLib.source_remove(this._timerId);
        this._timerId = null;
      }
    }

    // ── Rate-limit API ──────────────────────────────────────

    _fetchUtilizationAsync() {
      if (this._apiFetching) return;

      const creds = _readOAuthToken();
      if (!creds) {
        this._apiError = "No OAuth credentials";
        return;
      }
      if (creds.expired) {
        this._apiError = "OAuth token expired — run Claude Code to refresh";
        return;
      }

      if (!this._soupSession) {
        this._soupSession = new Soup.Session({
          timeout: 10,
          user_agent: `claude-code/${_getClaudeCodeVersion()}`,
        });
      }

      const message = Soup.Message.new("GET", USAGE_API_URL);
      message.request_headers.append(
        "Authorization",
        `Bearer ${creds.token}`,
      );
      message.request_headers.append("anthropic-beta", OAUTH_BETA_HEADER);
      message.request_headers.append("Content-Type", "application/json");

      this._apiFetching = true;
      this._soupSession.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
        (session, result) => {
          this._apiFetching = false;
          try {
            const bytes = session.send_and_read_finish(result);
            const statusCode = message.status_code;
            if (statusCode !== 200) {
              this._apiError = `API HTTP ${statusCode}`;
              Main.notify("Claude Monitor", `Rate limit API failed: ${this._apiError}`);
              return;
            }
            const body = new TextDecoder().decode(bytes.get_data());
            this._apiUtilization = JSON.parse(body);
            this._apiLastUpdatedMs = Date.now();
            this._apiDataFresh = true;
            this._apiError = null;
          } catch (e) {
            this._apiError = `API error: ${e.message}`;
            Main.notify("Claude Monitor", `Rate limit API failed: ${this._apiError}`);
          }
          // Re-render with fresh API data
          this._refreshDisplay();
        },
      );
    }

    // ── Training data logger ─────────────────────────────────

    _logTrainingRow(stats, windowStart, nowMs, resetMinutes) {
      if (!this._apiUtilization || this._apiUtilization.five_hour == null)
        return;

      const apiPct = this._apiUtilization.five_hour.utilization;
      if (apiPct == null) return;

      const planType = this._settings.get_string("plan-type");
      const plan = PLAN_LIMITS[planType];
      const costFraction = plan ? stats.totalCost / plan.cost : 0;
      const tokenFraction = plan ? stats.billableTokens / plan.tokens : 0;
      const sessionAgeMin = windowStart != null
        ? (nowMs - windowStart) / 60000
        : 0;

      const row = [
        new Date(nowMs).toISOString(),
        apiPct.toFixed(2),
        costFraction.toFixed(6),
        tokenFraction.toFixed(6),
        stats.totalCost.toFixed(6),
        stats.billableTokens,
        stats.burnRateCostH.toFixed(6),
        stats.burnRateTokensH.toFixed(0),
        stats.entryCount,
        planType,
        sessionAgeMin.toFixed(1),
        resetMinutes != null ? resetMinutes.toFixed(1) : "",
      ].join(",") + "\n";

      const csvPath = GLib.get_home_dir() + "/.claude/monitor_training.csv";
      const file = Gio.File.new_for_path(csvPath);

      // Write header if file doesn't exist yet
      if (!file.query_exists(null)) {
        const header =
          "timestamp,api_utilization_pct,heuristic_cost_fraction," +
          "heuristic_token_fraction,total_cost,billable_tokens," +
          "burn_rate_cost_h,burn_rate_tokens_h,entry_count,plan_type," +
          "session_age_min,reset_min\n";
        file.replace_contents(
          new TextEncoder().encode(header + row),
          null, false,
          Gio.FileCreateFlags.NONE,
          null,
        );
        return;
      }

      // Append row
      const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
      stream.write_all(new TextEncoder().encode(row), null);
      stream.close(null);
    }

    /**
     * Re-run the local stats calculation and update display.
     * Called after an async API response arrives.
     */
    _refreshDisplay() {
      const basePath = GLib.get_home_dir() + "/.claude/projects";
      const now = new Date();
      const nowMs = now.getTime();
      const lookbackMs = nowMs - LOOKBACK_HOURS * 3600000;
      const lookbackSecs = Math.floor(lookbackMs / 1000);

      const files = _findRecentJsonlFiles(basePath, lookbackSecs);
      const allEntries = _readAndParseJsonl(files, lookbackMs);
      const windowStart = _detectSessionStart(allEntries, nowMs);

      if (windowStart === null) {
        this._updateDisplay(_calculateStats([]), null);
        return;
      }

      const windowEnd = windowStart + SESSION_HOURS * 3600000;
      const windowEntries = allEntries.filter(
        (e) => e.timestamp >= windowStart && e.timestamp < windowEnd,
      );
      const stats = _calculateStats(windowEntries);
      const resetMs = windowEnd - nowMs;
      const resetMinutes = Math.max(0, resetMs / 60000);

      // Log ground-truth row whenever API data and heuristic stats align
      this._logTrainingRow(stats, windowStart, nowMs, resetMinutes);

      // Save anchor: API utilization + matching heuristic fraction at this moment
      if (this._apiUtilization && this._apiUtilization.five_hour != null &&
          this._apiUtilization.five_hour.utilization != null) {
        const planType = this._settings.get_string("plan-type");
        const plan = PLAN_LIMITS[planType];
        this._apiAnchorFraction = this._apiUtilization.five_hour.utilization / 100;
        this._heuristicAnchorFraction = plan && plan.cost > 0
          ? stats.totalCost / plan.cost
          : 0;
      }

      this._updateDisplay(stats, resetMinutes);
    }

    // ── Refresh ──────────────────────────────────────────────

    _refresh() {
      // Brief spin animation on refresh
      this._spinIcon();
      this._apiDataFresh = false; // Mark API data as stale until next fetch completes

      const basePath = GLib.get_home_dir() + "/.claude/projects";
      const now = new Date();
      const nowMs = now.getTime();

      // Trigger async API fetch (non-blocking, low-frequency)
      const apiFetchIntervalMs = Math.max(
        API_FETCH_INTERVAL_MIN_MS,
        this._settings.get_int("api-fetch-interval") * 1000,
      );
      if (nowMs - this._lastApiFetchMs >= apiFetchIntervalMs) {
        this._lastApiFetchMs = nowMs;
        this._fetchUtilizationAsync();
      }

      const lookbackMs = nowMs - LOOKBACK_HOURS * 3600000;
      const lookbackSecs = Math.floor(lookbackMs / 1000);

      const files = _findRecentJsonlFiles(basePath, lookbackSecs);
      const allEntries = _readAndParseJsonl(files, lookbackMs);

      const windowStart = _detectSessionStart(allEntries, nowMs);

      if (windowStart === null) {
        const stats = _calculateStats([]);
        this._updateDisplay(stats, null);
        return;
      }

      const windowEnd = windowStart + SESSION_HOURS * 3600000;
      const windowEntries = allEntries.filter(
        (e) => e.timestamp >= windowStart && e.timestamp < windowEnd,
      );
      const stats = _calculateStats(windowEntries);

      const resetMs = windowEnd - nowMs;
      const resetMinutes = Math.max(0, resetMs / 60000);

      // Track burn history for sparkline
      this._burnHistory.push(stats.burnRateCostH);
      if (this._burnHistory.length > 20)
        this._burnHistory = this._burnHistory.slice(-20);

      this._updateDisplay(stats, resetMinutes);
    }

    // ── Main display update ──────────────────────────────────

    _updateDisplay(stats, resetMinutes) {
      const planType = this._settings.get_string("plan-type");
      const plan = PLAN_LIMITS[planType];
      const barMetric = this._settings.get_string("bar-metric");

      // ── Rate-limit source ──────────────────────────────────────────────
      // Three modes:
      //   "api"      — fresh API data just arrived (useApi = true)
      //   "hybrid"   — API anchor + heuristic delta since then
      //   "heuristic" — no API data ever received, pure local estimation
      const apiData = this._apiUtilization;
      const useApi = this._apiDataFresh && apiData && apiData.five_hour != null &&
        apiData.five_hour.utilization != null;
      const hasAnchor = this._apiAnchorFraction !== null &&
        this._heuristicAnchorFraction !== null;
      this._usingHeuristic = !useApi && !hasAnchor;

      let apiResetMinutes = null;
      if (apiData && apiData.five_hour && apiData.five_hour.resets_at) {
        const resetAt = new Date(apiData.five_hour.resets_at).getTime();
        apiResetMinutes = Math.max(0, (resetAt - Date.now()) / 60000);
      }

      if (!useApi && !hasAnchor) {
        // Pure heuristic: apply estimation scale factor
        const estMode = this._settings.get_string("estimation-mode");
        const scaleFactor =
          ESTIMATION_MODES[estMode] || ESTIMATION_MODES["balanced"];
        stats.totalCost *= scaleFactor;
        stats.billableTokens = Math.round(stats.billableTokens * scaleFactor);
        stats.burnRateCostH *= scaleFactor;
        stats.burnRateTokensH *= scaleFactor;
      }

      // Calculate time remaining (from burn rate, only meaningful for heuristic)
      let timeRemainingMin = Infinity;
      if (plan) {
        if (barMetric === "tokens" && stats.burnRateTokensH > 0) {
          const remaining = plan.tokens - stats.billableTokens;
          timeRemainingMin =
            remaining > 0 ? (remaining / stats.burnRateTokensH) * 60 : 0;
        } else if (stats.burnRateCostH > 0) {
          const remaining = plan.cost - stats.totalCost;
          timeRemainingMin =
            remaining > 0 ? (remaining / stats.burnRateCostH) * 60 : 0;
        }
      }

      // Read toggle settings
      const showIcon = this._settings.get_boolean("show-icon");
      const showBar = this._settings.get_boolean("show-bar");
      const showPct = this._settings.get_boolean("show-percentage");
      const showTime = this._settings.get_boolean("show-time");
      const showDot = this._settings.get_boolean("show-status-dot");
      const showBadge = this._settings.get_boolean("show-status-badge");
      const showPrefix = this._settings.get_boolean("show-prefix");
      const prefixStyle = this._settings.get_string("prefix-style");
      const barLength = this._settings.get_int("bar-length");
      const barStyle = this._settings.get_string("bar-style");
      const barColor = this._settings.get_string("bar-color");
      const timeDisplay = this._settings.get_string("time-display");
      const pillBg = this._settings.get_string("pill-background");
      const textEffect = this._settings.get_string("text-effect");

      // Update custom color module vars
      _customColorStart =
        this._settings.get_string("custom-color-start") || "#5b9bf5";
      _customColorEnd =
        this._settings.get_string("custom-color-end") || "#c4a0ff";

      // Compute fraction ────────────────────────────────────────────────────
      // "api"     → direct from API (fresh anchor just set)
      // "hybrid"  → api_anchor + heuristic delta since anchor
      // "heuristic" → local cost/token ratio only
      const dsMode = this._settings.get_string("data-source-mode");
      const apiOnlyMode = dsMode === "api-only";

      let fraction = 0;
      if (useApi) {
        fraction = this._apiAnchorFraction ?? (apiData.five_hour.utilization / 100);
      } else if (!apiOnlyMode && hasAnchor && plan && plan.cost > 0) {
        const currentHeuristicFraction = stats.totalCost / plan.cost;
        const delta = currentHeuristicFraction - this._heuristicAnchorFraction;
        fraction = Math.max(0, Math.min(1, this._apiAnchorFraction + delta));
      } else if (hasAnchor) {
        // api-only mode: hold the last known API value until next fetch
        fraction = this._apiAnchorFraction;
      } else if (plan && stats.entryCount > 0) {
        fraction =
          barMetric === "tokens"
            ? stats.billableTokens / plan.tokens
            : stats.totalCost / plan.cost;
      }
      const pct = Math.min(fraction * 100, 999).toFixed(0);

      // Override reset time with API data when available
      if (apiResetMinutes !== null) {
        resetMinutes = apiResetMinutes;
      }

      // Status color
      const dotColor =
        fraction < 0.5
          ? "#8ff0a4"
          : fraction < 0.8
            ? "#f9f06b"
            : "#ff7b63";

      // ── Icon ──
      const isCairoBar = CAIRO_BAR_STYLES.has(barStyle);
      const isVBar = barStyle === "vbar" || barStyle === "vbar-dual";

      if (showIcon && prefixStyle !== "text") {
        let iconPath;
        if (prefixStyle === "symbolic") {
          iconPath = this._extensionPath + "/icons/claude-symbolic.svg";
        } else {
          iconPath = this._extensionPath + "/icons/claude.png";
        }
        const gicon = Gio.icon_new_for_string(iconPath);
        this._icon.set_gicon(gicon);
        this._iconContainer.visible = true;
      } else {
        this._iconContainer.visible = false;
      }

      // ── Status badge on icon ──
      if (showBadge && this._iconContainer.visible) {
        this._iconBadge.visible = true;
        this._iconBadge.style = `color: ${dotColor}; font-size: 7px;`;
      } else {
        this._iconBadge.visible = false;
      }

      // ── Status dot ──
      this._statusDot.visible = showDot;
      if (showDot) {
        this._statusDot.style = `color: ${dotColor};`;
      }

      // ── Status pill background ──
      if (pillBg === "status") {
        this._updateStatusPill(fraction);
      }

      // ── Bars: hide all first ──
      this._hbar.visible = false;
      this._vbar.visible = false;
      this._vbar2.visible = false;

      // ── Build label parts ──
      let labelParts = [];

      // Text prefix
      if (showPrefix && prefixStyle === "text") {
        labelParts.push("Claude");
      }

      if (stats.entryCount === 0) {
        labelParts.push("idle");
      } else {
        // Bar
        if (showBar && plan) {
          if (isVBar) {
            this._updateVBar(fraction, stats, plan, barMetric);
          } else if (isCairoBar) {
            const barW = barLength * 8;
            const barH = barStyle === "thick-rounded" ? 14 : 10;
            this._hbar.set_size(barW, barH);
            this._hbar._style = barStyle;
            this._hbar._colorScheme = barColor;
            this._hbar._barLength = barLength;
            this._hbar.visible = true;
            this._animateHBar(fraction);
          } else {
            // Unicode bar in label
            const bar = _makeBar(fraction, barLength, barStyle, barColor);
            labelParts.push(`\u200B${bar}`);
          }
        }

        // Percentage
        if (showPct && plan) {
          labelParts.push(`${pct}%`);
        }

        // Time
        if (showTime) {
          let timeSuffix = "";
          if (timeDisplay === "remaining") {
            timeSuffix = _formatTimeRemaining(timeRemainingMin);
          } else if (timeDisplay === "reset" && resetMinutes !== null) {
            timeSuffix = _formatResetTime(resetMinutes);
          }
          if (timeSuffix) labelParts.push(timeSuffix);
        }

        // Text-only mode (no bar but show value)
        if (!showBar && !showPct && !showDot && plan) {
          const val =
            barMetric === "tokens"
              ? `${_formatTokens(stats.billableTokens)} / ${_formatTokens(plan.tokens)}`
              : `${_formatCost(stats.totalCost)} / ${_formatCost(plan.cost)}`;
          labelParts.push(val);
        }
      }

      let panelMarkup = labelParts.join(" ");

      // Text effect
      if (textEffect === "glow" && stats.entryCount > 0) {
        const glowColor =
          barColor === "purple" || barColor === "dracula"
            ? "#d0a0ff"
            : barColor === "neon"
              ? "#00ffff"
              : barColor === "blue" || barColor === "nord"
                ? "#88c0ff"
                : "#ffffff";
        panelMarkup = `<span foreground="${glowColor}">${panelMarkup}</span>`;
      } else if (textEffect === "shadow" && stats.entryCount > 0) {
        panelMarkup = `<span foreground="#999999">${panelMarkup}</span>`;
      }

      // Hide label if empty (avoids extra padding when only icon+bar shown)
      this._label.visible = labelParts.length > 0;

      // Apply label with fade animation
      this._fadeUpdateLabel(panelMarkup);

      // Pulse animation at high usage
      this._updatePulseAnimation(fraction);

      // ── Update dropdown menu ──────────────────────────────
      const durH = Math.floor(stats.durationMinutes / 60);
      const durM = Math.round(stats.durationMinutes % 60);
      const sessionStr =
        stats.entryCount > 0
          ? `${durH}h ${durM}m (${stats.entryCount} messages)`
          : "No activity";

      let resetStr = _formatResetTime(resetMinutes);
      if (resetMinutes !== null && resetMinutes > 0) {
        const resetDate = new Date(Date.now() + resetMinutes * 60000);
        const hh = resetDate.getHours().toString().padStart(2, "0");
        const mm = resetDate.getMinutes().toString().padStart(2, "0");
        resetStr += ` (${hh}:${mm})`;
      }

      if (this._dropdownStyle === "gauges") {
        // Gauge dropdown
        if (this._gaugeArea) {
          this._gaugeArea._fraction = plan
            ? stats.totalCost / plan.cost
            : 0;
          this._gaugeArea._fraction2 = plan
            ? stats.billableTokens / plan.tokens
            : 0;
          this._gaugeArea._colorScheme = barColor;
          this._gaugeArea.queue_repaint();
        }

        if (this._gaugeLabel && plan) {
          const pctCost = ((stats.totalCost / plan.cost) * 100).toFixed(0);
          const pctTokens = (
            (stats.billableTokens / plan.tokens) *
            100
          ).toFixed(0);
          this._gaugeLabel.label.clutter_text.set_markup(
            `<span foreground="#ffb74d">\u25CF</span> Cost: ${_formatCost(stats.totalCost)} (${pctCost}%)  ` +
              `<span foreground="#5b9bf5">\u25CF</span> Tokens: ${_formatTokens(stats.billableTokens)} (${pctTokens}%)`,
          );
        }

        // Shared items
        this._updateInfoItem(
          this._inputItem,
          _formatTokens(stats.totalInput),
        );
        this._updateInfoItem(
          this._outputItem,
          _formatTokens(stats.totalOutput),
        );
        this._updateInfoItem(
          this._cacheCreateItem,
          _formatTokens(stats.totalCacheCreate),
        );
        this._updateInfoItem(
          this._cacheReadItem,
          _formatTokens(stats.totalCacheRead),
        );
        this._updateInfoItem(
          this._burnCostItem,
          `${_formatCost(stats.burnRateCostH)}/h`,
        );
        this._updateInfoItem(
          this._timeRemainingItem,
          _formatTimeRemaining(timeRemainingMin),
        );
        this._updateInfoItem(this._windowResetItem, resetStr);
        this._updateInfoItem(this._sessionItem, sessionStr);
      } else if (this._dropdownStyle === "modern") {
        // Modern dropdown
        if (this._progressItem) {
          if (plan) {
            const pctNum = Math.min(fraction * 100, 100).toFixed(0);
            const barColor2 =
              fraction < 0.5
                ? "#64dc8e"
                : fraction < 0.8
                  ? "#ffb400"
                  : "#ff4444";
            const usedStr =
              barMetric === "tokens"
                ? `${_formatTokens(stats.billableTokens)} used`
                : `${_formatCost(stats.totalCost)} used`;
            const limitStr =
              barMetric === "tokens"
                ? `${_formatTokens(plan.tokens)} limit`
                : `${_formatCost(plan.cost)} limit`;
            const barWidth = Math.min(Math.round(fraction * 20), 20);
            const barEmpty = 20 - barWidth;
            const progressBar =
              `<span foreground="${barColor2}">${"\u2588".repeat(barWidth)}</span>` +
              `<span foreground="#333333">${"\u2588".repeat(barEmpty)}</span>`;
            this._progressItem.label.clutter_text.set_markup(
              `${progressBar}  <b>${pctNum}%</b>\n` +
                `<span size="small" foreground="#888888">${usedStr}  \u2022  ${limitStr}</span>`,
            );
            this._headerItem.label.clutter_text.set_markup(
              `<b>Claude Token Monitor</b>    <span size="small" foreground="#c4a0ff">${plan.label}</span>`,
            );
          } else {
            this._progressItem.label.clutter_text.set_markup(
              "No plan configured",
            );
            this._headerItem.label.clutter_text.set_markup(
              `<b>Claude Token Monitor</b>`,
            );
          }
        }

        this._updateInfoItem(
          this._inputItem,
          _formatTokens(stats.totalInput),
        );
        this._updateInfoItem(
          this._outputItem,
          _formatTokens(stats.totalOutput),
        );
        this._updateInfoItem(
          this._cacheCreateItem,
          _formatTokens(stats.totalCacheCreate),
        );
        this._updateInfoItem(
          this._cacheReadItem,
          _formatTokens(stats.totalCacheRead),
        );
        this._updateInfoItem(
          this._burnCostItem,
          `${_formatCost(stats.burnRateCostH)}/h`,
        );
        this._updateInfoItem(
          this._timeRemainingItem,
          _formatTimeRemaining(timeRemainingMin),
        );
        this._updateInfoItem(this._windowResetItem, resetStr);
        this._updateInfoItem(this._sessionItem, sessionStr);

        // Sparkline repaint
        if (this._sparklineArea) this._sparklineArea.queue_repaint();
      } else {
        // Classic dropdown
        this._updateInfoItem(this._modelItem, stats.activeModel || "none");
        this._updateInfoItem(this._sessionItem, sessionStr);

        const tLim = plan ? ` / ${_formatTokens(plan.tokens)}` : "";
        this._updateInfoItem(
          this._inputItem,
          _formatTokens(stats.totalInput),
        );
        this._updateInfoItem(
          this._outputItem,
          _formatTokens(stats.totalOutput),
        );
        this._updateInfoItem(
          this._cacheCreateItem,
          _formatTokens(stats.totalCacheCreate),
        );
        this._updateInfoItem(
          this._cacheReadItem,
          _formatTokens(stats.totalCacheRead),
        );
        this._updateInfoItem(
          this._totalItem,
          `${_formatTokens(stats.billableTokens)}${tLim}`,
        );

        const cLim = plan ? ` / ${_formatCost(plan.cost)}` : "";
        this._updateInfoItem(
          this._costItem,
          `${_formatCost(stats.totalCost)}${cLim}`,
        );
        this._updateInfoItem(
          this._burnTokensItem,
          `${_formatTokens(Math.round(stats.burnRateTokensH))}/h`,
        );
        this._updateInfoItem(
          this._burnCostItem,
          `${_formatCost(stats.burnRateCostH)}/h`,
        );
        this._updateInfoItem(
          this._timeRemainingItem,
          _formatTimeRemaining(timeRemainingMin),
        );
        this._updateInfoItem(this._windowResetItem, resetStr);

        if (plan) {
          const pctTokens = (
            (stats.billableTokens / plan.tokens) *
            100
          ).toFixed(1);
          const pctCost = ((stats.totalCost / plan.cost) * 100).toFixed(1);
          this._updateInfoItem(
            this._planItem,
            `${pctTokens}% tokens, ${pctCost}% cost (${plan.label})`,
          );
        } else {
          this._updateInfoItem(this._planItem, "No plan configured");
        }
      }

      // ── Data source indicator (shared across all dropdown styles) ──
      if (this._dataSourceItem) {
        const showApiTime = this._settings.get_boolean("show-api-update-time");
        const apiAgeStr = () => {
          if (!showApiTime || !this._apiLastUpdatedMs) return "";
          const ageS = Math.round((Date.now() - this._apiLastUpdatedMs) / 1000);
          if (ageS < 60) return ` · ${ageS}s ago`;
          return ` · ${Math.round(ageS / 60)}m ago`;
        };

        if (useApi) {
          this._updateInfoItem(this._dataSourceItem, `Anthropic API${apiAgeStr()}`);
        } else if (hasAnchor) {
          const label = apiOnlyMode ? "API only (cached)" : "Hybrid (API anchor + heuristic delta)";
          this._updateInfoItem(this._dataSourceItem, `${label}${apiAgeStr()}`);
        } else {
          const reason = this._apiError || "No API data yet";
          const safe = reason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          this._updateInfoItem(this._dataSourceItem, `Heuristic (${safe})`);
        }
      }
    }

    destroy() {
      this._stopTimer();
      this._isPulsing = false;
      if (this._pulseTimerId) {
        GLib.source_remove(this._pulseTimerId);
        this._pulseTimerId = null;
      }
      this._box.remove_all_transitions();
      if (this._hbarTimeline) {
        this._hbarTimeline.stop();
        this._hbarTimeline = null;
      }
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      if (this._soupSession) {
        this._soupSession.abort();
        this._soupSession = null;
      }
      super.destroy();
    }
  },
);

let _indicator = null;

function init() {}

function enable() {
  const settings = ExtensionUtils.getSettings();
  const extensionCompat = {
    getSettings: () => settings,
    path: Me.path,
    openPreferences: () => {
      try {
        ExtensionUtils.openExtensionPrefs(Me.uuid, "", {});
      } catch (e) {}
    },
  };
  _indicator = new ClaudeMonitorIndicator(extensionCompat);
  const position = settings.get_string("panel-position");
  const box = position === "left" ? "left" : "right";
  Main.panel.addToStatusArea("claude-monitor", _indicator, 0, box);
}

function disable() {
  if (_indicator) {
    _indicator.destroy();
    _indicator = null;
  }
}

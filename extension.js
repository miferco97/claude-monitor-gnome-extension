import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

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
  pro: { tokens: 19000000, cost: 18.0, label: "Pro ($20/mo)" },
  max5: { tokens: 88000000, cost: 35.0, label: "Max 5x ($100/mo)" },
  max20: { tokens: 220000000, cost: 140.0, label: "Max 20x ($200/mo)" },
};

// Estimation scale factors to approximate Anthropic's /usage tracking.
// JSONL-based calculation misses server-side overhead, so we apply a multiplier.
const ESTIMATION_MODES = {
  conservative: 1.4, // Raw calculation (underestimates ~15-20%)
  balanced: 1.6, // Approximate /usage match
  generous: 2.0, // Safety margin (overestimates slightly)
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
  "\u258C", // 0/8 ▏ ▎ ▍ ▌
  "\u258B",
  "\u258A",
  "\u2589",
  "\u2588", // ▋ ▊ ▉ █
];

// Color schemes: [filled_color, empty_color]
// 'gradient' schemes use per-segment coloring
const BAR_COLORS = {
  white: { filled: "#e0e0e0", empty: "#555555" },
  "green-red": { gradient: true, empty: "#555555" },
  blue: { filled: "#5b9bf5", empty: "#2a3a5c" },
  purple: { filled: "#c4a0ff", empty: "#3d2a5c" },
  amber: { filled: "#ffb74d", empty: "#5c4a2a" },
  rainbow: { gradient: true, empty: "#555555" },
};

function _getGradientColor(fraction, scheme) {
  if (scheme === "green-red") {
    // Green at 0% → yellow at 50% → red at 100%
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
    // HSL hue sweep: red → yellow → green → cyan → blue → purple
    const hue = fraction * 300;
    return _hslToHex(hue, 80, 65);
  }
  return "#e0e0e0";
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

const SESSION_HOURS = 5;

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
  if (minutes <= 0) return "resetting now";
  if (minutes < 60) return `${Math.round(minutes)}m reset`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m reset`;
}

function _makeBar(fraction, segments, style, colorScheme) {
  const scheme = BAR_COLORS[colorScheme] || BAR_COLORS["white"];

  if (style === "smooth")
    return _makeSmoothBar(fraction, segments, scheme, colorScheme);

  const chars = BAR_STYLES[style] || BAR_STYLES["blocks"];
  const filled = Math.round(Math.min(fraction, 1.0) * segments);
  const empty = segments - filled;

  if (scheme.gradient) {
    // Gradient on filled segments, neutral color on empty segments
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

  // Solid color: filled chars with color, outline chars for remaining
  let markup = "";
  if (filled > 0)
    markup += `<span foreground="${scheme.filled}">${chars[0].repeat(filled)}</span>`;
  if (empty > 0)
    markup += `<span foreground="${scheme.filled}">${chars[1].repeat(empty)}</span>`;
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
    // Full filled segments with gradient
    for (let i = 0; i < fullCount; i++) {
      const segFraction = segments <= 1 ? 0.5 : i / (segments - 1);
      const color = _getGradientColor(segFraction, colorScheme);
      markup += `<span foreground="${color}">\u2588</span>`;
    }
    // Partial segment
    if (hasPartial) {
      const segFraction = segments <= 1 ? 0.5 : fullCount / (segments - 1);
      const color = _getGradientColor(segFraction, colorScheme);
      markup += `<span foreground="${color}">${SMOOTH_BLOCKS[partialIndex]}</span>`;
    }
    // Empty segments
    for (let i = 0; i < emptyCount; i++) {
      markup += `<span foreground="${scheme.empty}">\u2591</span>`;
    }
    return markup;
  }

  // Solid color smooth bar
  if (fullCount > 0)
    markup += `<span foreground="${scheme.filled}">${"\u2588".repeat(fullCount)}</span>`;
  if (hasPartial)
    markup += `<span foreground="${scheme.filled}">${SMOOTH_BLOCKS[partialIndex]}</span>`;
  if (emptyCount > 0)
    markup += `<span foreground="${scheme.filled}">${"\u2591".repeat(emptyCount)}</span>`;
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

function _readAndParseJsonl(fileInfos, cutoffTime) {
  const decoder = new TextDecoder("utf-8");
  // Use a Map so later entries (with final output token counts) overwrite
  // earlier streaming partials that share the same dedupKey
  const entryMap = new Map();
  const usedPaths = new Set();

  for (const fi of fileInfos) {
    usedPaths.add(fi.path);

    const cached = _fileCache.get(fi.path);
    if (cached && cached.mtime === fi.mtime) {
      for (const e of cached.entries) {
        if (e.timestamp < cutoffTime) continue;
        entryMap.set(e.dedupKey, e);
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
      if (!line.includes('"assistant"')) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (e) {
        continue;
      }

      if (entry.type !== "assistant") continue;
      if (!entry.message || !entry.message.usage) continue;

      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      const dedupKey = `${entry.message.id || ""}_${entry.requestId || ""}`;

      const parsed = {
        timestamp: ts,
        model: entry.message.model || "",
        usage: entry.message.usage,
        dedupKey,
      };
      fileEntries.push(parsed);

      if (ts < cutoffTime) continue;
      entryMap.set(dedupKey, parsed);
    }

    _fileCache.set(fi.path, { mtime: fi.mtime, entries: fileEntries });
  }

  for (const key of _fileCache.keys()) {
    if (!usedPaths.has(key)) _fileCache.delete(key);
  }

  return [...entryMap.values()];
}

function _calculateStats(entries) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let earliestTs = Infinity;
  let latestTs = 0;
  let activeModel = "";

  // Calculate cost per-entry using each entry's actual model pricing
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
    // Only input + output count toward plan cost (cache is absorbed by Anthropic)
    totalCost += (inp * p.input + out * p.output) / 1000000;

    if (entry.timestamp < earliestTs) earliestTs = entry.timestamp;
    if (entry.timestamp > latestTs) {
      latestTs = entry.timestamp;
      activeModel = entry.model;
    }
  }

  // totalTokens: all tokens for display
  // billableTokens: input + output only (cache tokens don't count toward plan limit)
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

      // Panel box: icon + label
      this._box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
      this.add_child(this._box);

      // Icon (hidden by default, shown when prefix-style is 'icon')
      this._icon = new St.Icon({
        style_class: "claude-monitor-icon",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._icon.visible = false;
      this._box.add_child(this._icon);

      // Label
      this._label = new St.Label({
        text: "Claude: --",
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "claude-monitor-label",
      });
      this._box.add_child(this._label);

      this._buildMenu();
      this._refresh();
      this._startTimer();

      this._settingsChangedId = this._settings.connect("changed", () => {
        this._refresh();
      });
    }

    _buildMenu() {
      // Header
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
      this._windowResetItem = this._addInfoItem("Window resets in", "--");

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._planItem = this._addInfoItem("Plan usage", "--");

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const refreshItem = new PopupMenu.PopupMenuItem("Refresh Now");
      refreshItem.connect("activate", () => this._refresh());
      this.menu.addMenuItem(refreshItem);

      const settingsItem = new PopupMenu.PopupMenuItem("Settings");
      settingsItem.connect("activate", () => {
        this._extension.openPreferences();
      });
      this.menu.addMenuItem(settingsItem);
    }

    _addInfoItem(label, value) {
      const item = new PopupMenu.PopupMenuItem("", { reactive: false });
      item.label.clutter_text.set_markup(`<b>${label}:</b>  ${value}`);
      item._labelPrefix = label;
      this.menu.addMenuItem(item);
      return item;
    }

    _updateInfoItem(item, value) {
      item.label.clutter_text.set_markup(
        `<b>${item._labelPrefix}:</b>  ${value}`,
      );
    }

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

    _refresh() {
      const basePath = GLib.get_home_dir() + "/.claude/projects";
      // Align to fixed 5-hour blocks (matching Anthropic's rate-limit windows)
      const now = new Date();
      const utcH = now.getUTCHours();
      const blockStartH = utcH - (utcH % SESSION_HOURS);
      const blockStart = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        blockStartH,
        0,
        0,
        0,
      );
      const cutoffMs = blockStart;
      const cutoffSecs = Math.floor(cutoffMs / 1000);

      const files = _findRecentJsonlFiles(basePath, cutoffSecs);
      const entries = _readAndParseJsonl(files, cutoffMs);
      const stats = _calculateStats(entries);

      const resetMs = blockStart + SESSION_HOURS * 3600000 - now.getTime();
      const resetMinutes = Math.max(0, resetMs / 60000);

      this._updateDisplay(stats, resetMinutes);
    }

    _updateDisplay(stats, resetMinutes) {
      const planType = this._settings.get_string("plan-type");
      const plan = PLAN_LIMITS[planType];
      const barMetric = this._settings.get_string("bar-metric");

      // Apply estimation scale factor to approximate Anthropic's /usage numbers
      const estMode = this._settings.get_string("estimation-mode");
      const scaleFactor =
        ESTIMATION_MODES[estMode] || ESTIMATION_MODES["balanced"];
      stats.totalCost *= scaleFactor;
      stats.billableTokens = Math.round(stats.billableTokens * scaleFactor);
      stats.burnRateCostH *= scaleFactor;
      stats.burnRateTokensH *= scaleFactor;

      // Calculate time remaining based on the chosen metric's burn rate
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

      // Read display settings
      const showPrefix = this._settings.get_boolean("show-prefix");
      const prefixStyle = this._settings.get_string("prefix-style");
      const barLength = this._settings.get_int("bar-length");
      const barStyle = this._settings.get_string("bar-style");
      const barColor = this._settings.get_string("bar-color");
      const timeDisplay = this._settings.get_string("time-display");

      // Icon vs text prefix
      if (showPrefix && prefixStyle === "icon") {
        const iconPath = this._extensionPath + "/icons/claude.png";
        const gicon = Gio.icon_new_for_string(iconPath);
        this._icon.set_gicon(gicon);
        this._icon.visible = true;
      } else {
        this._icon.visible = false;
      }

      const textPrefix = showPrefix && prefixStyle === "text" ? "Claude " : "";
      let timeSuffix = "";
      if (timeDisplay === "remaining") {
        timeSuffix = ` ${_formatTimeRemaining(timeRemainingMin)}`;
      } else if (timeDisplay === "reset") {
        timeSuffix = ` ${_formatResetTime(resetMinutes)}`;
      }

      // Bar fraction based on metric — _makeBar returns Pango markup
      let panelMarkup;
      if (stats.entryCount === 0) {
        panelMarkup = `${textPrefix}idle`;
      } else if (plan) {
        const fraction =
          barMetric === "tokens"
            ? stats.billableTokens / plan.tokens
            : stats.totalCost / plan.cost;
        const bar = _makeBar(fraction, barLength, barStyle, barColor);
        panelMarkup = `${textPrefix}\u200B${bar} ${timeSuffix}`;
      } else {
        panelMarkup = `${textPrefix}${_formatTokens(stats.billableTokens)} \u2191${timeSuffix}`;
      }
      this._label.clutter_text.set_markup(panelMarkup);

      // Dropdown menu items — show used / limit
      this._updateInfoItem(this._modelItem, stats.activeModel || "none");

      const durH = Math.floor(stats.durationMinutes / 60);
      const durM = Math.round(stats.durationMinutes % 60);
      const sessionStr =
        stats.entryCount > 0
          ? `${durH}h ${durM}m (${stats.entryCount} messages)`
          : "No activity";
      this._updateInfoItem(this._sessionItem, sessionStr);

      // Token breakdown: billable = in + out + cache_create (cache_read is free toward limit)
      const tLim = plan ? ` / ${_formatTokens(plan.tokens)}` : "";
      this._updateInfoItem(this._inputItem, _formatTokens(stats.totalInput));
      this._updateInfoItem(this._outputItem, _formatTokens(stats.totalOutput));
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

      // Cost with plan limit
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
      this._updateInfoItem(
        this._windowResetItem,
        _formatResetTime(resetMinutes),
      );

      if (plan) {
        const pctTokens = ((stats.billableTokens / plan.tokens) * 100).toFixed(
          1,
        );
        const pctCost = ((stats.totalCost / plan.cost) * 100).toFixed(1);
        this._updateInfoItem(
          this._planItem,
          `${pctTokens}% tokens, ${pctCost}% cost (${plan.label})`,
        );
      } else {
        this._updateInfoItem(this._planItem, "No plan configured");
      }
    }

    destroy() {
      this._stopTimer();
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      super.destroy();
    }
  },
);

export default class ClaudeMonitorExtension extends Extension {
  enable() {
    this._indicator = new ClaudeMonitorIndicator(this);

    const position = this.getSettings().get_string("panel-position");
    const box = position === "left" ? "left" : "right";
    Main.panel.addToStatusArea("claude-monitor", this._indicator, 0, box);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}

#!/usr/bin/env node
/**
 * Browser-half smoke test without a browser.
 *
 * Loads `client.js` through a fake `window.__ModuleLoader__`, applies the
 * plugin to a fake slots/locale context, then renders the page component with
 * a tiny hand-rolled React stand-in (createElement + hook stubs) and asserts
 * the exact copy, numbers, and formatting the panel shows for the reference
 * screenshot values. It also checks that the sidebar icon and both slot
 * registrations exist, that every dictionary key resolves, and that the
 * removed K-line terminal leaves no trace in the source, the stylesheet or the
 * rendered output.
 *
 * Run: node tools/selfcheck-client.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const results = [];
let failures = 0;

/** Assert one condition and record a printable line. */
function check(name, run, actual) {
  try {
    run();
    results.push({ ok: true, name, actual });
  } catch (error) {
    failures += 1;
    results.push({ ok: false, name, error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------
// Fake browser globals + React stand-in
// ---------------------------------------------------------------------------
let stateQueue = [];
/** When set, every registered effect callback is collected instead of dropped. */
let effectLog = null;
const fakeReact = {
  createElement(type, props, ...children) {
    const flat = [];
    for (const child of children) {
      if (Array.isArray(child)) flat.push(...child.flat(Infinity));
      else flat.push(child);
    }
    const childrenFlat = flat.filter((child) => child !== null && child !== undefined && child !== false && child !== true);
    if (typeof type === "function") {
      return type({ ...(props ?? {}), children: childrenFlat });
    }
    return {
      $$element: true,
      type,
      props: { ...(props ?? {}), children: childrenFlat },
    };
  },
  useState(initial) {
    if (stateQueue.length > 0) return [stateQueue.shift(), () => {}];
    return [typeof initial === "function" ? initial() : initial, () => {}];
  },
  useEffect(callback) {
    if (effectLog !== null) effectLog.push(callback);
  },
  useMemo(factory) {
    return factory();
  },
  useRef(value) {
    return { current: value };
  },
  useCallback(fn) {
    return fn;
  },
};

const styleTags = [];
globalThis.document = {
  querySelector() {
    return null;
  },
  createElement(tag) {
    return { tag, dataset: {}, textContent: "" };
  },
  head: {
    appendChild(node) {
      styleTags.push(node);
    },
  },
};

let registration = null;
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      registration = value;
    },
  },
};

const sourcePath = fileURLToPath(new URL("../client.js", import.meta.url));
const source = readFileSync(sourcePath, "utf8");
vm.runInThisContext(source, { filename: "client.js" });

check("client.js registers one module factory", () => assert.ok(registration !== null), "loaded");

const moduleExports = registration.factory((specifier) => {
  if (specifier === "react") return fakeReact;
  throw new Error(`unexpected require(${specifier})`);
});

check(
  "module exports apply + inject",
  () => {
    assert.equal(typeof moduleExports.apply, "function");
    assert.deepEqual([...moduleExports.inject], ["slots", "locale"]);
  },
  `inject=${JSON.stringify([...moduleExports.inject])}`,
);

const cssText = styleTags.length > 0 ? styleTags[0].textContent : "";

check(
  "panel stylesheet is injected once",
  () => {
    assert.equal(styleTags.length, 1);
    assert.equal(styleTags[0].dataset.plugin, "dsh-session-stats-panel");
    assert.ok(cssText.includes(".ssp-root"));
    assert.ok(cssText.includes("--dsw-alias-bg-base"));
  },
  `${cssText.length} bytes of CSS`,
);

// ---------------------------------------------------------------------------
// Fake client context: capture locale dictionaries and slot registrations
// ---------------------------------------------------------------------------
const dictionaries = {};
const registrations = [];
const injectedSlots = [];
/** Non-null while rendering in a non-default language (see `renderPage({ lang })`). */
let activeDictionary = null;

function translate(key, params) {
  const dict = activeDictionary ?? dictionaries.zh ?? {};
  let template = dict[key];
  if (template === undefined) template = key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const fakeCtx = {
  effect(callback) {
    const disposer = callback();
    return typeof disposer === "function" ? disposer : () => {};
  },
  locale: {
    register(namespace, dicts) {
      dictionaries.namespace = namespace;
      dictionaries.zh = dicts.zh;
      dictionaries.en = dicts.en;
      return () => {};
    },
    bind() {
      return translate;
    },
  },
  slots: {
    inject(slotName, callback) {
      injectedSlots.push(slotName);
      return callback();
    },
    register(definition, component) {
      registrations.push({ definition, component });
      return () => {};
    },
  },
};

check(
  "apply() registers dictionaries and two slots",
  () => {
    moduleExports.apply(fakeCtx);
    assert.equal(dictionaries.namespace, "session-stats");
    assert.deepEqual(injectedSlots, ["main", "sidebar.panellist"]);
    assert.equal(registrations.length, 2);
  },
  `slots=${injectedSlots.join(",")}`,
);

const mainRegistration = registrations.find((entry) => entry.definition.name === "main");
const sidebarRegistration = registrations.find((entry) => entry.definition.name === "sidebar.panellist");

check(
  "main slot registration targets the session-stats panel key",
  () => {
    assert.equal(mainRegistration.definition.key, "session-stats-panel");
    assert.equal(mainRegistration.definition.locale, "session-stats");
    assert.equal(typeof mainRegistration.component, "function");
  },
  "main/key=session-stats",
);

check(
  "sidebar registration has id, order, and localized label",
  () => {
    assert.equal(sidebarRegistration.definition.id, "session-stats-panel");
    assert.equal(sidebarRegistration.definition.order, -10);
    assert.equal(sidebarRegistration.definition.label(), "肥鱼用量分析");
  },
  `order=${sidebarRegistration.definition.order} label=肥鱼用量分析`,
);

check(
  "sidebar icon is the pixel whale sprite",
  () => {
    const icon = sidebarRegistration.component({ size: 16 });
    assert.equal(icon.$$element, true);
    assert.equal(icon.type, "svg");
    assert.equal(icon.props.viewBox, "0 0 16 16");
    assert.equal(icon.props.shapeRendering, "crispEdges");
    assert.equal(icon.props["aria-hidden"], "true");
    assert.equal(icon.props.focusable, "false");
    assert.equal(icon.props.width, 16);
    assert.equal(icon.props.height, 16);
    const cells = (icon.props.children ?? []).filter(Boolean);
    assert.ok(cells.length >= 60, `pixel count ${cells.length}`);
    for (const cell of cells) {
      assert.equal(cell.type, "rect", "every sprite node is a rect");
      assert.equal(cell.props.width, 1);
      assert.equal(cell.props.height, 1);
      assert.ok(Number.isFinite(cell.props.x) && Number.isFinite(cell.props.y), "numeric grid position");
    }
    // A sprite cell may not be painted twice, or the colours would stack.
    const spots = new Set(cells.map((cell) => `${cell.props.x},${cell.props.y}`));
    assert.equal(spots.size, cells.length, "no duplicated pixel");
    const fills = new Set(cells.map((cell) => cell.props.fill));
    for (const fill of ["#74c0fc", "#1c7ed6", "#1971c2", "#ffffff", "#0b2447", "#a5d8ff"]) assert.ok(fills.has(fill), fill);
  },
  "90 sprite pixels",
);

check(
  "the sprite carries the B2 landmarks (eye, side fin, connected tail)",
  () => {
    const icon = sidebarRegistration.component({ size: 16 });
    const cells = (icon.props.children ?? []).filter(Boolean);
    const at = (x, y) => cells.find((cell) => cell.props.x === x && cell.props.y === y) ?? null;
    // B2 moved the pupil one row up and closed the tail into one solid shape.
    assert.equal(at(2, 8)?.props.fill, "#0b2447", "pupil at 2,8");
    assert.equal(at(3, 8)?.props.fill, "#ffffff", "eye white at 3,8");
    assert.equal(at(2, 9)?.props.fill, "#ffffff", "eye white at 2,9");
    assert.equal(at(13, 12)?.props.fill, "#1971c2", "connected tail fin");
    assert.equal(at(10, 11)?.props.fill, "#a5d8ff", "side fin reaches 10,11");
    assert.equal(at(10, 8)?.props.fill, "#1c7ed6", "body edge at 10,8");
    assert.ok(cells.every((cell) => cell.props.y >= 3), "the B1 spout row (y<3) is gone");
  },
  "B2 pixels",
);

check(
  "sidebar icon clamps tiny sizes so no sprite pixel lands on a fraction",
  () => {
    // 14px over a 16-unit grid squeezes a cell to 0.875px; 16 keeps it on grid.
    assert.equal(sidebarRegistration.component({ size: 14 }).props.width, 16);
    assert.equal(sidebarRegistration.component({ size: 14 }).props.height, 16);
    assert.equal(sidebarRegistration.component({}).props.width, 16);
    assert.equal(sidebarRegistration.component({ size: 18 }).props.width, 16, "18px slot snaps down to the 16 grid");
    assert.equal(sidebarRegistration.component({ size: 40 }).props.width, 32);
    assert.equal(sidebarRegistration.component({ size: 32 }).props.width, 32);
  },
  "14 -> 16, 18 -> 18",
);

check(
  "the old bar-chart glyph left no trace in the sprite",
  () => {
    assert.ok(!source.includes('d: "M3 13.2V9.3M6.33 13.2V5.4M9.66 13.2V7.5M13 13.2V3.4"'), "old bars path");
    assert.ok(!source.includes('d="M9 22.5v-6"'), "no bar path fragment");
    const cells = (sidebarRegistration.component({ size: 16 }).props.children ?? []).filter(Boolean);
    assert.ok(!cells.some((cell) => cell.type === "title"), "no <title> inside the sprite");
    assert.ok(!cells.some((cell) => cell.type === "path"), "no stroked path inside the sprite");
  },
  "pixel rects only",
);

check(
  "zh/en dictionaries have identical key sets",
  () => {
    const zhKeys = Object.keys(dictionaries.zh).sort();
    const enKeys = Object.keys(dictionaries.en).sort();
    assert.deepEqual(zhKeys, enKeys);
  },
  `${Object.keys(dictionaries.zh).length} keys`,
);

check(
  'every static t("...") key resolves in both dictionaries',
  () => {
    const staticKeys = new Set();
    for (const match of source.matchAll(/\bt\("([^"$]+)"\)/g)) staticKeys.add(match[1]);
    for (const key of ["window.24h", "window.7d", "window.14d", "window.30d", "composition.cacheRead", "composition.input", "composition.output", "composition.cacheWrite"]) {
      staticKeys.add(key);
    }
    assert.ok(staticKeys.size > 0, "some keys were found");
    const missingZh = [...staticKeys].filter((key) => dictionaries.zh[key] === undefined);
    const missingEn = [...staticKeys].filter((key) => dictionaries.en[key] === undefined);
    assert.deepEqual(missingZh, []);
    assert.deepEqual(missingEn, []);
  },
  "all keys present",
);

// ---------------------------------------------------------------------------
// Terminal removal: the stylesheet and the source must not carry K-line code
// ---------------------------------------------------------------------------
check(
  "stylesheet keeps the shared entrance animation and drops K-line rules",
  () => {
    assert.ok(cssText.includes("@keyframes ssp-mode-in"), "entrance keyframes kept");
    assert.ok(cssText.includes(".ssp-root{animation:ssp-mode-in"), ".ssp-root still animates");
    assert.ok(cssText.includes("prefers-reduced-motion"), "reduced-motion honoured");
    for (const selector of [".ssp-term", ".ssp-tape", ".ssp-ticker", ".ssp-index", ".ssp-watch", ".ssp-positions", ".ssp-pos-row", ".ssp-mini-", ".ssp-instrument", ".ssp-candle", ".ssp-view-btn", ".ssp-view-toggle"]) {
      assert.ok(!cssText.includes(selector), "terminal selector leaked into the stylesheet: " + selector);
    }
    for (const keyframes of ["ssp-marquee", "ssp-sweep", "ssp-flash-up", "ssp-flash-down", "ssp-pulse"]) {
      assert.ok(!cssText.includes(keyframes), "terminal keyframes leaked: " + keyframes);
    }
  },
  "ssp-mode-in only",
);

check(
  "source defines no K-line component, helper or selector",
  () => {
    const banned = [
      /\bTerminalView\b/,
      /\bTerminalChart\b/,
      /\bModeToggle\b/,
      /\bmergeCandles\b/,
      /\bmergeBars\b/,
      /\bformatClock\b/,
      /\bformatRange\b/,
      /\bChangeBadge\b/,
      /\bMiniK\b/,
      /\bInstrumentHeader\b/,
      /\bIndexIcon\b/,
      /\bIndexCell\b/,
      /function Ticker\b/,
      /function Watchlist\b/,
      /function Tape\b/,
      /function Positions\b/,
    ];
    for (const pattern of banned) assert.ok(!pattern.test(source), "terminal symbol still defined: " + pattern);
    for (const className of ["ssp-term", "ssp-tape", "ssp-ticker", "ssp-index", "ssp-watch", "ssp-pos-", "ssp-mini-", "ssp-instrument", "ssp-candle", "ssp-view-toggle", "ssp-view-btn"]) {
      assert.ok(!source.includes(className), "terminal class still referenced: " + className);
    }
  },
  "no terminal symbols",
);

check(
  "view-mode persistence was removed with the switch",
  () => {
    assert.ok(!source.includes("dsh-session-stats:mode"), "mode storage key");
    assert.ok(!source.includes("dsh-session-stats:chart"), "chart storage key");
    assert.ok(!source.includes("localStorage"), "no localStorage usage remains");
  },
  "no storage keys",
);

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
/** Depth-first element finder that expands function components. */
function findNodes(node, predicate, output = []) {
  if (node === null || node === undefined || typeof node !== "object") return output;
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, output);
    return output;
  }
  if (node.$$element) {
    if (predicate(node)) output.push(node);
    findNodes(node.props.children, predicate, output);
  }
  return output;
}

// ---------------------------------------------------------------------------
// Sample payloads
// ---------------------------------------------------------------------------
const PALETTE = ["#12b886", "#4dabf7", "#9775fa", "#ff922b", "#22b8cf", "#f06595", "#fcc419", "#5c7cfa", "#b08968", "#adb5bd"];
const OTHER_COLOR = "#868e96";

const SAMPLE_OVERVIEW = {
  ok: true,
  generatedAt: 1793714400000,
  window: { key: "7d", granularity: "day", bucketCount: 7, from: 1793109600000, to: 1793714400000, label: "近 7 天", points: ["10/28", "11/3"] },
  currency: { code: "CNY", symbol: "¥", usdRate: 7.1, usdSymbol: "$" },
  totals: { tokens: 764900000, costCNY: 47.48, costUSD: 6.687324, costCNYTotal: 47.5, sessions: 22, cacheHitRate: 0.99556, searches: 4, searchCostCNY: 0.02, unpricedModels: 1, unpricedTokens: 44900000 },
  models: [
    { provider: "deepseek", model: "deepseek-v4.1-flash", route: "deepseek/deepseek-v4.1-flash", label: "deepseek-v4.1-flash", color: PALETTE[0], tokens: 520000000, costCNY: 30, costUSD: 4.2, share: 0.68, vendor: "deepseek", priceLevel: "official" },
    { provider: "opencode-go", model: "kimi-k3", route: "opencode-go/kimi-k3", label: "kimi-k3", color: PALETTE[1], tokens: 50000000, costCNY: 10, costUSD: 1.4, share: 0.065, vendor: "moonshot", priceLevel: "official" },
    { provider: "opencode-go", model: "claude-opus-4.1", route: "opencode-go/claude-opus-4.1", label: "claude-opus-4.1", color: PALETTE[2], tokens: 44900000, costCNY: 0, costUSD: 0, share: 0.059, vendor: "anthropic", priceLevel: "unpriced" },
  ],
  otherModelColor: OTHER_COLOR,
  pricing: { tableVersion: "vendor-official-2026-11" },
  daily: ["10/28", "10/29", "10/30", "10/31", "11/1", "11/2", "11/3"].map((label, index) => ({
    key: `d${index}`,
    label,
    start: 1793100000000 + index * 86400000,
    end: 1793100000000 + (index + 1) * 86400000,
    tokens: 80000000 + index * 10000000,
    costCNY: 4 + index * 0.5,
    costUSD: (4 + index * 0.5) / 7.1,
    searches: 0,
    searchCostCNY: 0,
    events: 10,
    models: [{ route: "deepseek/deepseek-v4.1-flash", tokens: 80000000 + index * 10000000, costCNY: 4 + index * 0.5, costUSD: (4 + index * 0.5) / 7.1 }],
  })),
};
const SAMPLE_LIVE = { ok: true, sampledAt: 1793714400000, intervalMs: 5000, points: 60, windowSec: 300, cpu: { single: 0, machine: 0, cores: 11 }, memory: { rssMB: 619, heapUsedMB: 190, heapTotalMB: 240, externalMB: 6, arrayBuffersMB: 2 }, eventLoop: { p99ms: 121.2, meanMs: 25.5, resolutionMs: 10 }, uptimeSec: 1740, uptimeText: "29m", pid: 2866, node: "v24.21.0", platform: "win32", history: { values: [0, 0.1, 0.05, 0.08], peak: 0.1, windowSec: 300, intervalMs: 5000 } };

// ---------------------------------------------------------------------------
// Heavy chunk fixtures: heatmap, leaderboards, session list
// ---------------------------------------------------------------------------
const HEAVY_NOW = 1793718000000;
const DAY_MS = 86_400_000;

/** 56 consecutive days oldest-first; the first ten carry no activity on purpose. */
function heatmapFixture() {
  const days = [];
  for (let index = 0; index < 56; index += 1) {
    days.push({
      date: new Date(HEAVY_NOW - (55 - index) * DAY_MS).toISOString().slice(0, 10),
      tokens: index < 10 ? 0 : (index + 1) * 1_000_000,
      turns: index,
      sessions: index < 10 ? 0 : (index % 4) + 1,
    });
  }
  return days;
}

/** Twelve tool rows so the Top-10 slice and the bar scaling are observable. */
function toolBoardFixture() {
  const rows = [{ name: "read", count: 240, lastCalledAt: HEAVY_NOW - 60_000 }];
  for (let index = 1; index < 12; index += 1) {
    rows.push({ name: `tool-${index}`, count: 240 - index * 10, lastCalledAt: HEAVY_NOW - index * 60_000 });
  }
  rows[1] = { name: "win_bash", count: 120, lastCalledAt: HEAVY_NOW - 120_000 };
  return rows;
}

/**
 * Six sessions chosen so the three sorts differ:
 * recent -> s1, tokens -> s2, cost -> s6. s4 is a subagent, s3 is archived,
 * s5 has neither title nor prompt.
 */
const SAMPLE_SESSIONS = [
  { id: "s1", title: "会话统计 3.0 改造", turns: 41, steps: 96, tokens: 84_100_000, costCNY: 5.21, cacheHitRate: 0.994, lastPrompt: "把 README 重做成有图的形态", lastActiveAt: HEAVY_NOW - 30_000, createdAt: HEAVY_NOW - 3 * DAY_MS, workspace: "E:\\repo", isArchived: false, isSubagent: false },
  { id: "s2", title: "热力日历调试", turns: 12, steps: 30, tokens: 120_000_000, costCNY: 1.4, cacheHitRate: 0.9, lastPrompt: "热力格子数对不上", lastActiveAt: HEAVY_NOW - 3 * 3_600_000, createdAt: HEAVY_NOW - DAY_MS, workspace: "E:\\repo", isArchived: false, isSubagent: false },
  { id: "s3", title: "归档的旧会话", turns: 2, steps: 4, tokens: 800_000, costCNY: 0.12, cacheHitRate: 0.5, lastPrompt: "旧任务", lastActiveAt: HEAVY_NOW - 5 * DAY_MS, createdAt: HEAVY_NOW - 9 * DAY_MS, workspace: "E:\\other", isArchived: true, isSubagent: false },
  { id: "s4", title: "子会话 A", turns: 3, steps: 5, tokens: 400_000, costCNY: 0.05, cacheHitRate: 0.4, lastPrompt: "并行开发子任务", lastActiveAt: HEAVY_NOW - 10_000, createdAt: HEAVY_NOW - 3_600_000, workspace: "E:\\repo", isArchived: false, isSubagent: true },
  { id: "s5", title: "", turns: 1, steps: 1, tokens: 1_000, costCNY: 0.001, cacheHitRate: 0, lastPrompt: "", lastActiveAt: HEAVY_NOW - 2 * DAY_MS, createdAt: HEAVY_NOW - 2 * DAY_MS, workspace: "", isArchived: false, isSubagent: false },
  { id: "s6", title: "成本排查", turns: 7, steps: 19, tokens: 2_000_000, costCNY: 9.9, cacheHitRate: 0.7, lastPrompt: "为什么成本这么高", lastActiveAt: HEAVY_NOW - DAY_MS, createdAt: HEAVY_NOW - 4 * DAY_MS, workspace: "E:\\repo", isArchived: false, isSubagent: false },
];

const SAMPLE_HEAVY = {
  ok: true,
  generatedAt: HEAVY_NOW,
  heatmap: heatmapFixture(),
  toolLeaderboard: toolBoardFixture(),
  commandLeaderboard: [
    { program: "cd", count: 118, lastCalledAt: HEAVY_NOW - 60_000 },
    { program: "echo", count: 59, lastCalledAt: HEAVY_NOW - 120_000 },
    { program: "node", count: 12, lastCalledAt: HEAVY_NOW - 180_000 },
  ],
  skillLeaderboard: [
    { name: "code-review", count: 4, lastCalledAt: HEAVY_NOW - 60_000 },
    { name: "grilling", count: 2, lastCalledAt: HEAVY_NOW - 900_000 },
  ],
  sessions: SAMPLE_SESSIONS,
};

/**
 * Render the panel with a fixed hook-state sequence.
 *
 * StatsView hooks, in order: windowKey, currency, reloadKey, overview chunk,
 * heavy chunk, live snapshot; then HeatmapCard's mode and SessionListCard's
 * query / sort / subagent toggle, which are created in that tree order.
 */
function renderPage({
  windowKey = null,
  currency = "CNY",
  overview = null,
  live = null,
  error = null,
  heavy = null,
  heavyError = null,
  overviewStatus = null,
  heavyStatus = null,
  heatmapMode = "tokens",
  query = "",
  sort = "recent",
  withSubagents = false,
  lang = "zh",
} = {}) {
  const overviewSlot = {
    status: overviewStatus ?? (error !== null ? "error" : overview === null ? "loading" : "ready"),
    data: overview,
    error,
  };
  const heavySlot = {
    status: heavyStatus ?? (heavyError !== null ? "error" : heavy === null ? "loading" : "ready"),
    data: heavy,
    error: heavyError,
  };
  stateQueue = [windowKey, currency, 0, overviewSlot, heavySlot, live, heatmapMode, query, sort, withSubagents];
  activeDictionary = lang === "en" ? dictionaries.en ?? null : null;
  const tree = Page({ t: translate });
  const text = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== "object") {
      if (typeof node === "string" || typeof node === "number") text.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node.$$element) {
      if (typeof node.props.title === "string") text.push(node.props.title);
      if (typeof node.props["aria-label"] === "string") text.push(node.props["aria-label"]);
      walk(node.props.children);
    }
  };
  walk(tree);
  return { tree, text };
}

const Page = mainRegistration.component;
const ready = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
const readyText = ready.text;

/** Root element of a rendered tree (the page is a single .ssp-root div). */
function rootOf(tree) {
  return findNodes(tree, (node) => node.type === "div" && String(node.props.className ?? "").split(" ").includes("ssp-root"))[0];
}

// ---------------------------------------------------------------------------
// Default view: the stats layout, and only that
// ---------------------------------------------------------------------------
check(
  "default render is the stats layout with every original card",
  () => {
    assert.equal(rootOf(ready.tree).props["data-testid"], "session-stats-page");
    for (const label of ["总 Token 消耗", "预估成本", "会话数", "缓存命中率"]) assert.ok(readyText.includes(label), label);
    assert.ok(readyText.some((value) => value.includes("DSH 运行状态")), "live card");
    for (const label of ["每日消耗", "Token 构成", "成本构成", "分模型明细"]) assert.ok(readyText.includes(label), label);
  },
  "4 cards + live + 3 charts + detail",
);

check(
  "rendered output carries no K-line terminal copy",
  () => {
    const banned = /行情|蜡烛|终端|K线|K 线|今开|振幅|成交流水|持仓明细|自选|SESSION TERMINAL|堆叠柱|成交量/;
    const leaked = readyText.filter((value) => banned.test(value));
    assert.deepEqual(leaked, []);
  },
  "no market copy",
);

check(
  "no 统计 / K线 view-mode switch is rendered",
  () => {
    const toggles = findNodes(ready.tree, (node) => node.type === "button" && String(node.props.className ?? "").includes("ssp-view-btn"));
    assert.equal(toggles.length, 0);
    const buttons = findNodes(ready.tree, (node) => node.type === "button");
    const labels = buttons.map((node) => (node.props.children ?? []).flat(Infinity).filter((value) => typeof value === "string").join(""));
    assert.deepEqual(labels.filter((label) => label === "统计" || label === "K线"), []);
    for (const label of ["近 24 小时", "近 7 天", "近 14 天", "近 30 天", "CNY", "USD"]) assert.ok(labels.includes(label), label);
  },
  "window + currency only",
);

check(
  "four metric cards show the payload values",
  () => {
    assert.ok(readyText.includes("764.9M"), "compact token total");
    assert.ok(readyText.includes("¥47.50"), "cost total incl. search");
    assert.ok(readyText.includes("99.6%"), "cache hit rate");
    assert.ok(readyText.includes("22"), "session count");
    const cards = findNodes(ready.tree, (node) => String(node.props.className ?? "").includes("ssp-cards"));
    assert.equal(cards.length, 1);
  },
  "764.9M / ¥47.50 / 99.6% / 22",
);

check(
  "window tab and currency radio reflect the active state",
  () => {
    const tabs = findNodes(ready.tree, (node) => node.props.role === "tab");
    assert.equal(tabs.length, 4);
    const selected = tabs.filter((node) => node.props["aria-selected"] === true);
    assert.equal(selected.length, 1);
    assert.equal([...selected[0].props.children].join(""), "近 7 天");
    const radios = findNodes(ready.tree, (node) => node.props.role === "radio");
    assert.equal(radios.length, 2);
    assert.equal(radios.filter((node) => node.props["aria-checked"] === true).length, 1);
  },
  "7d + CNY active",
);

const usd = renderPage({ currency: "USD", overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
check(
  "USD currency flows into cost labels",
  () => {
    assert.ok(usd.text.some((value) => value.startsWith("$")));
    assert.ok(!usd.text.includes("¥47.50"));
  },
  "$ labels",
);

const otherWindow = renderPage({ windowKey: "24h", overview: { ...SAMPLE_OVERVIEW, window: { ...SAMPLE_OVERVIEW.window, key: "24h" } }, live: SAMPLE_LIVE });
check(
  "switching the window re-renders the charts for the new range",
  () => {
    // After the new payload lands, the caption must describe the bucket the bars
    // come from, and the tab must follow the selection.
    assert.ok(otherWindow.text.includes("按 token 堆叠 · 近 24 小时"), "24h range copy");
    const active = findNodes(otherWindow.tree, (node) => node.props.role === "tab" && node.props["aria-selected"] === true);
    assert.equal(active.length, 1);
    assert.equal([...active[0].props.children].join(""), "近 24 小时");
  },
  "24h flows into DailyCard",
);

check(
  "a window switch never relabels the bars with the window still loading",
  () => {
    // S1 regression: the tab already says 24h, but `data` is still the 7d payload,
    // so the caption has to keep describing 7 days.
    const stale = renderPage({ windowKey: "24h", overview: SAMPLE_OVERVIEW, overviewStatus: "refreshing", live: SAMPLE_LIVE });
    assert.ok(stale.text.includes("按 token 堆叠 · 近 7 天"), "caption follows the loaded payload");
    assert.ok(!stale.text.includes("按 token 堆叠 · 近 24 小时"), "no premature relabelling");
    const active = findNodes(stale.tree, (node) => node.props.role === "tab" && node.props["aria-selected"] === true);
    assert.equal([...active[0].props.children].join(""), "近 24 小时", "the tab still reflects the click");
  },
  "caption = payload window",
);

check(
  "model detail lists every model and tags the unpriced one",
  () => {
    for (const label of ["deepseek-v4.1-flash", "kimi-k3", "claude-opus-4.1"]) assert.ok(readyText.includes(label), label);
    assert.ok(readyText.includes("未计价"), "unpriced tag");
    const rows = findNodes(ready.tree, (node) => String(node.props.className ?? "") === "ssp-model-row");
    assert.ok(rows.length >= SAMPLE_OVERVIEW.models.length, `model rows: ${rows.length}`);
  },
  "3 models + 未计价",
);

const empty = renderPage({ overview: null });
check(
  "loading state renders placeholders without NaN",
  () => {
    assert.equal(rootOf(empty.tree).props["data-loading"], "true");
    assert.ok(empty.text.includes("肥鱼用量分析"), "title still renders");
    assert.ok(empty.text.includes("—"), "placeholder copy");
    assert.ok(!empty.text.some((value) => /NaN|undefined/.test(value)));
  },
  "placeholders / no NaN",
);

const failed = renderPage({ overview: null, error: "HTTP 500" });
check(
  "error banner shows message and retry",
  () => {
    assert.ok(failed.text.some((value) => value.includes("统计数据加载失败")));
    assert.ok(failed.text.includes("重试"));
    assert.equal(rootOf(failed.tree).props["data-loading"], "false");
  },
  "HTTP 500 / 重试",
);

check(
  "ready render clears the loading attribute",
  () => {
    assert.equal(rootOf(ready.tree).props["data-loading"], "false");
  },
  "data-loading=false",
);

check(
  "no unresolved locale keys in rendered output",
  () => {
    const bad = readyText.filter(
      (value) => /^(card|daily|donut|costDonut|models|priceLevel|price|vendor|window|currency|state|unit|live|composition|chart|cards|panel|heatmap|rank|sessions|time)\.[a-zA-Z]/.test(value) || /NaN|undefined|\{\w+\}/.test(value),
    );
    assert.deepEqual(bad, []);
  },
  "clean",
);

check("live card shows core count only, never a load-average number", () => {
  assert.ok(readyText.some((value) => value.includes("11 核")), "core count");
  assert.ok(!readyText.some((value) => /负载|load\/core|loadavg/i.test(value)), "no load-average copy");
});

// ---------------------------------------------------------------------------
// Chunked loading: overview first, then the heavy cards
// ---------------------------------------------------------------------------
/** Titles of the rendered session rows, in document order. */
function sessionTitles(tree) {
  return findNodes(tree, (node) => node.props.className === "ssp-sess-row").map((row) => {
    const cell = findNodes(row, (node) => node.props.className === "ssp-sess-title")[0];
    return cell ? [...(cell.props.children ?? [])].join("") : "";
  });
}

/** Leaderboard cards in document order: tools, commands, skills. */
function rankCards(tree) {
  return findNodes(tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-rank"));
}

const firstPaint = renderPage({});
check(
  "heavy cards wait with an analyzing placeholder while their chunk is in flight",
  () => {
    assert.equal(findNodes(ready.tree, (node) => String(node.props.className ?? "") === "ssp-analyzing").length, 5, "heatmap + 3 leaderboards + sessions");
    assert.equal(findNodes(ready.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-rank-row")).length, 0);
    assert.equal(findNodes(ready.tree, (node) => typeof node.props["data-date"] === "string").length, 0);
    assert.ok(readyText.includes("分析中"), "analyzing copy");
  },
  "5 analyzing bodies",
);

check(
  "first paint shows placeholders and no progress bar",
  () => {
    assert.equal(rootOf(firstPaint.tree).props["data-loading"], "true");
    assert.equal(rootOf(firstPaint.tree).props["data-busy"], "false");
    assert.equal(findNodes(firstPaint.tree, (node) => node.props["data-testid"] === "ssp-progress").length, 0, "no progress bar on first paint");
    assert.equal(findNodes(firstPaint.tree, (node) => String(node.props.className ?? "") === "ssp-analyzing").length, 5);
    assert.ok(firstPaint.text.includes("肥鱼用量分析"), "title renders while loading");
  },
  "placeholders + analyzing",
);

const full = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY });

check(
  "heavy chunk fills the heatmap with 8 columns of 7 days",
  () => {
    const columns = findNodes(full.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-heat-col"));
    assert.equal(columns.length, 8);
    for (const column of columns) {
      assert.equal(findNodes(column, (node) => typeof node.props["data-date"] === "string").length, 7, "seven rows per column");
    }
    const cells = findNodes(full.tree, (node) => typeof node.props["data-date"] === "string");
    assert.equal(cells.length, 56);
    // Oldest first, newest last: the newest day owns the bottom-right cell.
    assert.equal(cells[0].props["data-date"], SAMPLE_HEAVY.heatmap[0].date);
    assert.equal(cells[55].props["data-date"], SAMPLE_HEAVY.heatmap[55].date);
    assert.ok(String(cells[55].props.title).includes(SAMPLE_HEAVY.heatmap[55].date), "hover tooltip");
    assert.ok(String(cells[55].props.className).includes("ssp-heat-l4"), "busiest day at full tint");
  },
  "8 x 7 = 56",
);

check(
  "days without activity keep the faintest shade",
  () => {
    const cells = findNodes(full.tree, (node) => typeof node.props["data-date"] === "string");
    const idle = cells.filter((cell) => cell.props["data-value"] === "0");
    assert.equal(idle.length, 10);
    for (const cell of idle) assert.ok(String(cell.props.className).includes("ssp-heat-l0"), "level 0");
    assert.ok(cssText.includes("opacity:.06"), "0.06 opacity rule");
  },
  "10 idle days at .06",
);

const heatSessions = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, heatmapMode: "sessions" });
check(
  "heatmap switches between token and session intensity",
  () => {
    const tokens = findNodes(full.tree, (node) => typeof node.props["data-date"] === "string");
    const sessions = findNodes(heatSessions.tree, (node) => typeof node.props["data-date"] === "string");
    assert.equal(tokens.length, sessions.length);
    assert.equal(tokens[55].props["data-value"], String(SAMPLE_HEAVY.heatmap[55].tokens));
    assert.equal(sessions[55].props["data-value"], String(SAMPLE_HEAVY.heatmap[55].sessions));
    assert.notEqual(tokens[55].props["data-value"], sessions[55].props["data-value"]);
    const active = findNodes(heatSessions.tree, (node) => String(node.props.className ?? "").includes("ssp-seg-active")).map((node) => [...(node.props.children ?? [])].join(""));
    assert.ok(active.includes("会话"), "sessions segment active");
  },
  "tokens vs sessions",
);

check(
  "leaderboards draw Top 10 of the payload scaled to the busiest row",
  () => {
    const cards = rankCards(full.tree);
    assert.equal(cards.length, 3);
    const rows = findNodes(cards[0], (node) => String(node.props.className ?? "").split(" ").includes("ssp-rank-row"));
    assert.equal(rows.length, 10, "Top 10 out of 12 rows");
    const widths = rows.map((row) => Number.parseFloat(String(findNodes(row, (node) => String(node.props.className ?? "") === "ssp-rank-fill")[0].props.style.width)));
    assert.equal(widths[0], 100);
    assert.equal(widths[1], 50);
    assert.ok(widths[0] > widths[9], "descending");
  },
  "10 rows / 100% / 50%",
);

check(
  "leaderboards read name for tools and skills, program for commands",
  () => {
    const cards = rankCards(full.tree);
    const namesOf = (card) => findNodes(card, (node) => String(node.props.className ?? "") === "ssp-rank-name").map((node) => [...(node.props.children ?? [])].join(""));
    assert.equal(namesOf(cards[0])[0], "read");
    assert.equal(namesOf(cards[1])[0], "cd");
    assert.equal(namesOf(cards[2])[0], "code-review");
    assert.ok(full.text.includes("命令排行"), "command card title");
    assert.ok(full.text.includes("cd"), "command name rendered");
  },
  "read / cd / code-review",
);

check(
  "session list hides subagent sessions until the toggle is on",
  () => {
    assert.equal(sessionTitles(full.tree).length, 5, "one subagent hidden");
    assert.ok(!sessionTitles(full.tree).includes("子会话 A"));
    const withSubs = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, withSubagents: true });
    assert.equal(sessionTitles(withSubs.tree).length, 6);
    assert.ok(sessionTitles(withSubs.tree).includes("子会话 A"));
    assert.ok(withSubs.text.includes("子会话"), "subagent tag");
  },
  "5 -> 6 rows",
);

check(
  "session sort switches between recent, tokens and cost",
  () => {
    assert.deepEqual(sessionTitles(full.tree), ["会话统计 3.0 改造", "热力日历调试", "成本排查", "未命名会话", "归档的旧会话"]);
    const byTokens = sessionTitles(renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, sort: "tokens" }).tree);
    assert.equal(byTokens[0], "热力日历调试");
    const byCost = sessionTitles(renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, sort: "cost" }).tree);
    assert.equal(byCost[0], "成本排查");
  },
  "recent / tokens / cost",
);

check(
  "session search matches the title and the last prompt",
  () => {
    assert.deepEqual(sessionTitles(renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, query: "热力" }).tree), ["热力日历调试"]);
    assert.deepEqual(sessionTitles(renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, query: "readme" }).tree), ["会话统计 3.0 改造"]);
    const none = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, query: "zzz" });
    assert.equal(sessionTitles(none.tree).length, 0);
    assert.ok(none.text.includes("没有匹配的会话"));
  },
  "title / prompt / empty",
);

check(
  "session list caps at 50 rows and scrolls inside the card",
  () => {
    const many = {
      ...SAMPLE_HEAVY,
      sessions: Array.from({ length: 60 }, (_, index) => ({ ...SAMPLE_SESSIONS[0], id: `m${index}`, title: `会话 ${index}`, lastActiveAt: HEAVY_NOW - index * 1000 })),
    };
    const page = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: many });
    assert.equal(sessionTitles(page.tree).length, 50);
    assert.ok(page.text.some((value) => value.includes("显示 50 / 60")), "count label");
    assert.ok(cssText.includes("max-height:420px"), "internal scroll");
    assert.ok(cssText.includes("overflow-y:auto"));
  },
  "50 of 60",
);

check(
  "archived sessions are dimmed",
  () => {
    const rows = findNodes(full.tree, (node) => node.props.className === "ssp-sess-row");
    assert.equal(rows.filter((row) => row.props["data-archived"] === "true").length, 1);
    assert.ok(cssText.includes(".ssp-sess-row[data-archived=true]{opacity:.55}"));
  },
  "1 archived row",
);

const switching = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, overviewStatus: "refreshing", heavyStatus: "refreshing" });
check(
  "a window switch keeps the old payload and raises the progress bar",
  () => {
    assert.equal(rootOf(switching.tree).props["data-busy"], "true");
    assert.equal(findNodes(switching.tree, (node) => node.props["data-testid"] === "ssp-progress").length, 1);
    assert.ok(switching.text.includes("764.9M"), "old overview values stay visible");
    assert.equal(sessionTitles(switching.tree).length, 5, "old heavy rows stay visible");
    assert.equal(findNodes(switching.tree, (node) => String(node.props.className ?? "") === "ssp-analyzing").length, 0, "no skeleton while stale data is shown");
  },
  "progress + stale data",
);

check(
  "the progress bar disappears once both chunks are ready",
  () => {
    assert.equal(rootOf(full.tree).props["data-busy"], "false");
    assert.equal(findNodes(full.tree, (node) => node.props["data-testid"] === "ssp-progress").length, 0);
  },
  "no bar when ready",
);

check(
  "a missing heavy endpoint degrades to empty cards instead of crashing",
  () => {
    const failedHeavy = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavyError: "HTTP 404" });
    assert.equal(findNodes(failedHeavy.tree, (node) => String(node.props.className ?? "") === "ssp-analyzing").length, 0, "no analyzing dots after a failure");
    assert.equal(findNodes(failedHeavy.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-rank-row")).length, 0);
    assert.equal(findNodes(failedHeavy.tree, (node) => typeof node.props["data-date"] === "string").length, 0);
    assert.equal(failedHeavy.text.filter((value) => value === "数据暂不可用").length, 5, "heatmap + 3 leaderboards + sessions");
    assert.equal(rootOf(failedHeavy.tree).props["data-loading"], "false", "overview still renders");
    assert.ok(failedHeavy.text.includes("764.9M"), "overview values unaffected");
  },
  "degrades, overview intact",
);

check(
  "an empty heavy payload shows the empty copy, not the spinner",
  () => {
    const emptyHeavy = renderPage({
      overview: SAMPLE_OVERVIEW,
      live: SAMPLE_LIVE,
      heavy: { ok: true, generatedAt: HEAVY_NOW, heatmap: [], toolLeaderboard: [], commandLeaderboard: [], skillLeaderboard: [], sessions: [] },
    });
    assert.equal(findNodes(emptyHeavy.tree, (node) => String(node.props.className ?? "") === "ssp-analyzing").length, 0);
    for (const copy of ["暂无活动数据", "暂无数据", "没有匹配的会话"]) assert.ok(emptyHeavy.text.includes(copy), copy);
  },
  "empty copy",
);

/**
 * Render once with effects captured, then run them to see which URLs the mount
 * actually requests. `fetch` is stubbed to a never-settling promise so the live
 * poller cannot leave a timer (or an unhandled rejection) behind.
 */
function collectMountRequests(options = {}) {
  const callbacks = [];
  const urls = [];
  const realFetch = globalThis.fetch;
  effectLog = callbacks;
  globalThis.fetch = (url) => {
    urls.push(String(url));
    return new Promise(() => {});
  };
  try {
    renderPage(options);
    effectLog = null;
    for (const callback of callbacks) {
      const dispose = callback();
      if (typeof dispose === "function") dispose();
    }
  } finally {
    effectLog = null;
    globalThis.fetch = realFetch;
  }
  return urls;
}

check(
  "overview and heavy are requested in the same mount pass",
  () => {
    const urls = collectMountRequests();
    assert.ok(urls.includes("/session-stats/api/overview"), "overview request");
    assert.ok(urls.includes("/session-stats/api/heavy"), "heavy request");
    assert.ok(urls.includes("/session-stats/api/live"), "live request");
    const withWindow = collectMountRequests({ windowKey: "24h" });
    assert.ok(withWindow.includes("/session-stats/api/overview?window=24h"), "window on the overview request");
    assert.ok(withWindow.includes("/session-stats/api/heavy?window=24h"), "window on the heavy request");
    assert.ok(/function useFetch\(url, reloadKey\)/.test(source), "shared fetch hook");
    assert.ok(source.includes("controller.abort()"), "requests are cancellable");
    assert.ok(!/useHeavy\([^)]*overview\.data/.test(source), "heavy must not wait for the overview payload");
  },
  "3 requests on mount",
);

// ---------------------------------------------------------------------------
// Today stripe + cost forecast (IDEA-04 / IDEA-01)
// ---------------------------------------------------------------------------
const SAMPLE_TODAY = { tokens: 12_000_000, costCNY: 30, sessions: 3, cacheHitRate: 0.812 };
const SAMPLE_YESTERDAY = { tokens: 10_000_000, costCNY: 24, sessions: 4, cacheHitRate: 0.9 };
const SAMPLE_FORECAST = { slope: 0.12, intercept: 1.4, monthEndEstimate: 5.2, sigma: 0.35, dataPoints: 12, daysLeft: 21 };

/** Clone the overview with the calendar-day fields the host ships alongside it. */
function withToday(today, yesterday, forecast = null, granularity = "day") {
  return { ...SAMPLE_OVERVIEW, today, yesterday, forecast, window: { ...SAMPLE_OVERVIEW.window, granularity } };
}

/** Rendered delta chips in document order. */
function deltaChips(tree) {
  return findNodes(tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-today-delta")).map((node) => ({
    className: String(node.props.className),
    text: [...(node.props.children ?? [])].join(""),
  }));
}

/** CSS inside every `@media (max-width: <width>px)` block (there are several). */
function mediaBlocks(width) {
  const marker = `(max-width:${width}px){`;
  return cssText
    .split("@media")
    .filter((chunk) => chunk.trimStart().startsWith(marker))
    .join("");
}

const todayUp = renderPage({ overview: withToday(SAMPLE_TODAY, SAMPLE_YESTERDAY), live: SAMPLE_LIVE });
check(
  "today stripe compares four numbers against yesterday",
  () => {
    const cells = findNodes(todayUp.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-today-cell"));
    assert.equal(cells.length, 4);
    for (const label of ["总 Token 消耗", "预估成本", "会话数", "缓存命中率"]) assert.ok(todayUp.text.includes(label), label);
    assert.ok(todayUp.text.includes("12M"), "today's token total");
    assert.ok(todayUp.text.includes("¥30.00"), "today's cost");
    assert.ok(todayUp.text.includes("81.2%"), "today's cache hit rate");
    const chips = deltaChips(todayUp.tree);
    assert.equal(chips.length, 4);
    // tokens and cost grew (red), sessions and cache shrank (green).
    assert.ok(chips[0].className.includes("ssp-today-up"), "tokens ▲ red");
    assert.ok(chips[0].text.startsWith("▲"), chips[0].text);
    assert.ok(chips[1].className.includes("ssp-today-up"), "cost ▲ red");
    assert.ok(chips[2].className.includes("ssp-today-down"), "sessions ▼ green");
    assert.ok(chips[2].text.startsWith("▼"), chips[2].text);
    assert.ok(chips[3].className.includes("ssp-today-down"), "cache ▼ green");
  },
  "4 cells / ▲ red / ▼ green",
);

const todayNoBaseline = renderPage({ overview: withToday(SAMPLE_TODAY, null), live: SAMPLE_LIVE });
check(
  "a missing yesterday baseline renders -- instead of a fake delta",
  () => {
    const chips = deltaChips(todayNoBaseline.tree);
    assert.equal(chips.length, 4);
    for (const chip of chips) {
      assert.ok(chip.className.includes("ssp-today-flat"), chip.className);
      assert.equal(chip.text, "--");
    }
  },
  "-- without baseline",
);

check(
  "an idle today keeps the four-cell layout and shows dashes",
  () => {
    const idle = renderPage({ overview: withToday(null, SAMPLE_YESTERDAY), live: SAMPLE_LIVE });
    const cells = findNodes(idle.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-today-cell"));
    assert.equal(cells.length, 4, "layout stays stable on an idle day");
    const values = cells.map((cell) => findNodes(cell, (node) => String(node.props.className ?? "") === "ssp-today-value")[0]);
    for (const value of values) assert.ok([...(value.props.children ?? [])].flat(Infinity).includes("—"), "dash instead of a number");
    const chips = deltaChips(idle.tree);
    assert.equal(chips.length, 4);
    for (const chip of chips) {
      assert.equal(chip.text, "--");
      assert.ok(chip.className.includes("ssp-today-flat"));
    }
    assert.ok(!idle.text.some((value) => /NaN|undefined/.test(value)));
    // A host that does not ship the field omits the stripe entirely.
    const legacy = renderPage({ overview: { ...SAMPLE_OVERVIEW }, live: SAMPLE_LIVE });
    assert.equal(findNodes(legacy.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-today")).length, 0);
  },
  "4 dashes / field absent",
);

check(
  "today cost follows the currency switch",
  () => {
    const usdToday = renderPage({ overview: withToday(SAMPLE_TODAY, SAMPLE_YESTERDAY), live: SAMPLE_LIVE, currency: "USD" });
    assert.ok(usdToday.text.includes("$4.23"), "30 CNY / 7.1");
    assert.ok(!usdToday.text.includes("¥30.00"));
  },
  "$4.23",
);

const forecastPage = renderPage({ overview: withToday(SAMPLE_TODAY, SAMPLE_YESTERDAY, SAMPLE_FORECAST, "day"), live: SAMPLE_LIVE });
check(
  "cost forecast draws a dashed tail and labels the month-end value",
  () => {
    const strips = findNodes(forecastPage.tree, (node) => node.props["data-testid"] === "ssp-forecast");
    assert.equal(strips.length, 1);
    const line = findNodes(strips[0], (node) => node.props.className === "ssp-forecast-line")[0];
    assert.equal(line.type, "line");
    assert.ok(Number.isFinite(Number(line.props.y1)) && Number.isFinite(Number(line.props.y2)), "numeric endpoints");
    assert.ok(Number(line.props.y2) <= 100 && Number(line.props.y2) >= 0, "clamped inside the viewBox");
    const text = findNodes(strips[0], (node) => String(node.props.className ?? "") === "ssp-forecast-text")[0];
    const label = [...(text.props.children ?? [])].join("");
    assert.ok(label.includes("月末"), label);
    assert.ok(label.includes("¥5.20"), label);
    assert.ok(label.includes("±¥0.35"), label);
    assert.ok(cssText.includes("stroke-dasharray:4 4"), "dashed stroke");
    assert.ok(forecastPage.text.includes("虚线为成本走势预测"), "caption");
  },
  "¥5.20 ±¥0.35",
);

check(
  "forecast converts to USD and hides when the host has too little history",
  () => {
    const usdForecast = renderPage({ overview: withToday(SAMPLE_TODAY, SAMPLE_YESTERDAY, SAMPLE_FORECAST, "day"), live: SAMPLE_LIVE, currency: "USD" });
    const strip = findNodes(usdForecast.tree, (node) => node.props["data-testid"] === "ssp-forecast")[0];
    const text = [...(findNodes(strip, (node) => String(node.props.className ?? "") === "ssp-forecast-text")[0].props.children ?? [])].join("");
    assert.ok(text.includes("$0.73"), text);
    assert.ok(!text.includes("¥"), "no CNY symbol in USD mode");
    // null forecast (fewer than 7 data points) and an hourly window both hide it.
    assert.equal(findNodes(renderPage({ overview: withToday(SAMPLE_TODAY, SAMPLE_YESTERDAY, null), live: SAMPLE_LIVE }).tree, (node) => node.props["data-testid"] === "ssp-forecast").length, 0);
    assert.equal(findNodes(renderPage({ overview: withToday(SAMPLE_TODAY, SAMPLE_YESTERDAY, SAMPLE_FORECAST, "hour"), live: SAMPLE_LIVE }).tree, (node) => node.props["data-testid"] === "ssp-forecast").length, 0);
  },
  "USD + hidden",
);

check(
  "the new cards collapse below 1100px without horizontal overflow",
  () => {
    const narrow = mediaBlocks(1100);
    assert.ok(narrow.includes(".ssp-today{grid-template-columns:repeat(2"), "today stripes 2-up");
    assert.ok(narrow.includes(".ssp-rank-row{"), "leaderboard rows narrow");
    assert.ok(narrow.includes(".ssp-forecast{flex-basis"), "forecast tail narrows");
    const phone = mediaBlocks(720);
    assert.ok(phone.includes(".ssp-chart-wrap{flex-direction:column"), "forecast drops below the bars");
    assert.ok(phone.includes(".ssp-list-tools{flex-direction:column"), "session tools stack");
    assert.ok(phone.includes(".ssp-today{grid-template-columns:minmax(0,1fr)"), "today stripes single column");
  },
  "1100 / 720 blocks",
);

// ---------------------------------------------------------------------------
// Tool leaderboard metrics (IDEA-05): success badge + average duration
// ---------------------------------------------------------------------------
const TOOL_BOARD_METRICS = [
  { name: "read", count: 240, lastCalledAt: HEAVY_NOW, errorCount: 1, successRate: 0.99, avgMs: 236 },
  { name: "win_bash", count: 120, lastCalledAt: HEAVY_NOW, errorCount: 5, successRate: 0.88, avgMs: 1200 },
  { name: "grep", count: 60, lastCalledAt: HEAVY_NOW, errorCount: 12, successRate: 0.42, avgMs: 45 },
  { name: "write", count: 30, lastCalledAt: HEAVY_NOW, errorCount: 0, successRate: null, avgMs: null },
];
const metricsPage = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: { ...SAMPLE_HEAVY, toolLeaderboard: TOOL_BOARD_METRICS } });

/** Split one leaderboard row into its measurable cells. */
function rankRowsOf(card) {
  return findNodes(card, (node) => String(node.props.className ?? "").split(" ").includes("ssp-rank-row")).map((row) => ({
    rich: String(row.props.className).includes("ssp-rank-row-rich"),
    rate: findNodes(row, (node) => String(node.props.className ?? "").split(" ").includes("ssp-rate"))[0] ?? null,
    ms: findNodes(row, (node) => String(node.props.className ?? "") === "ssp-rank-ms")[0] ?? null,
  }));
}

check(
  "tool leaderboard badges the success rate in three tiers plus unknown",
  () => {
    const rows = rankRowsOf(rankCards(metricsPage.tree)[0]);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.rich), "tools use the five-column layout");
    assert.equal(rows[0].rate.props.className, "ssp-rate ssp-rate-ok");
    assert.equal(rows[1].rate.props.className, "ssp-rate ssp-rate-warn");
    assert.equal(rows[2].rate.props.className, "ssp-rate ssp-rate-bad");
    assert.equal(rows[3].rate.props.className, "ssp-rate ssp-rate-unknown");
    assert.equal([...rows[0].rate.props.children].join(""), "99.0%");
    assert.equal([...rows[1].rate.props.children].join(""), "88.0%");
    assert.equal([...rows[2].rate.props.children].join(""), "42.0%");
    assert.equal([...rows[3].rate.props.children].join(""), "—", "null rate shows a dash");
  },
  "ok / warn / bad / unknown",
);

check(
  "average duration switches between ms and seconds",
  () => {
    const rows = rankRowsOf(rankCards(metricsPage.tree)[0]);
    assert.equal([...rows[0].ms.props.children].join(""), "236ms");
    assert.equal([...rows[1].ms.props.children].join(""), "1.2s");
    assert.equal([...rows[2].ms.props.children].join(""), "45ms");
    assert.equal([...rows[3].ms.props.children].join(""), "—", "null duration shows a dash");
  },
  "236ms / 1.2s / —",
);

check(
  "the hover text lists success, duration and errors, omitting unknowns",
  () => {
    const rows = rankRowsOf(rankCards(metricsPage.tree)[0]);
    assert.equal(rows[0].rate.props.title, "成功率 99.0% · 平均 236ms · 失败 1 次");
    assert.equal(rows[1].rate.props.title, "成功率 88.0% · 平均 1.2s · 失败 5 次");
    assert.equal(rows[3].rate.props.title, "—", "nothing fabricated when every metric is null");
  },
  "成功 · 平均 · 失败",
);

check(
  "command and skill leaderboards stay three-column without badges",
  () => {
    const cards = rankCards(metricsPage.tree);
    for (const card of [cards[1], cards[2]]) {
      const rows = rankRowsOf(card);
      assert.ok(rows.length > 0);
      for (const row of rows) {
        assert.ok(!row.rich, "no rich layout");
        assert.equal(row.rate, null, "no success badge");
        assert.equal(row.ms, null, "no duration column");
      }
    }
  },
  "three columns only",
);

check(
  "the duration column disappears below 720px",
  () => {
    assert.ok(cssText.includes(".ssp-rank-row-rich{grid-template-columns:minmax(96px,140px)"), "five columns on desktop");
    const phone = mediaBlocks(720);
    assert.ok(phone.includes(".ssp-rank-ms{display:none}"), "duration hidden on phones");
    assert.ok(phone.includes(".ssp-rank-row-rich{grid-template-columns:minmax(0,1fr) 52px 40px}"), "name + badge + count");
    for (const tier of ["ssp-rate-ok", "ssp-rate-warn", "ssp-rate-bad", "ssp-rate-unknown"]) assert.ok(cssText.includes("." + tier + "{"), tier);
    assert.ok(cssText.includes("body[data-ds-dark-theme] .ssp-rate-warn"), "amber stays readable in dark mode");
  },
  "5 cols -> 3 cols",
);

check(
  "the 560px block tightens the new cards instead of overflowing",
  () => {
    const narrow = mediaBlocks(560);
    assert.ok(narrow.includes(".ssp-sess-row{grid-template-columns:minmax(0,1fr)}"), "session rows stack");
    assert.ok(narrow.includes(".ssp-today{padding:12px 14px}"), "today stripe padding");
    assert.ok(narrow.includes(".ssp-rate{padding:0 4px}"), "rate badge tightens");
    assert.ok(narrow.includes(".ssp-heat-cell{width:14px;height:14px}"), "heat cells shrink");
    assert.ok(!/(^|[;{])\s*width:\s*(5[6-9]\d|[6-9]\d\d)px/.test(narrow), "no fixed element width wider than the breakpoint");
  },
  "560 block",
);

// ---------------------------------------------------------------------------
// Localized fallbacks
// ---------------------------------------------------------------------------
const EN_HEAVY = {
  ...SAMPLE_HEAVY,
  sessions: [
    { id: "e1", title: "Dashboard work", turns: 3, steps: 4, tokens: 1000, costCNY: 0.1, cacheHitRate: 0.5, lastPrompt: "make it pop", lastActiveAt: HEAVY_NOW - 60_000, createdAt: HEAVY_NOW - 1, workspace: "", isArchived: false, isSubagent: false },
    { id: "e2", title: "", turns: 1, steps: 1, tokens: 10, costCNY: 0.01, cacheHitRate: 0, lastPrompt: "", lastActiveAt: HEAVY_NOW - 120_000, createdAt: HEAVY_NOW - 2, workspace: "", isArchived: false, isSubagent: false },
  ],
};

check(
  "an empty session title uses the locale's own fallback, never hard-coded Chinese",
  () => {
    const english = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: EN_HEAVY, lang: "en" });
    const titles = sessionTitles(english.tree);
    assert.ok(titles.includes("Untitled session"), titles.join(" | "));
    assert.ok(!titles.some((title) => /未命名/.test(title)), "no Chinese fallback in English");
    assert.ok(english.text.includes("Fat Fish Usage"), "panel title translated");
    assert.ok(english.text.includes("Tool leaderboard"), "chrome translated");
    assert.ok(!english.text.some((value) => /[\u4e00-\u9fa5]/.test(value)), "no CJK anywhere in the English render");
    // The Chinese render keeps the Chinese fallback.
    const chinese = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY });
    assert.ok(sessionTitles(chinese.tree).includes("未命名会话"));
  },
  "en: Untitled session",
);

check(
  "a failed heavy refresh is surfaced without replacing the cards",
  () => {
    // Stale data + error is the state `useFetch` produces when a refetch fails
    // after a successful one: cards keep the old payload, and a light hint says so.
    const stale = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, heavy: SAMPLE_HEAVY, heavyStatus: "ready", heavyError: "HTTP 500" });
    assert.equal(sessionTitles(stale.tree).length, 5, "cards keep the previous payload");
    const hints = findNodes(stale.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-hint"));
    assert.equal(hints.length, 1, "one quiet hint");
    assert.ok(stale.text.some((value) => value.includes("慢数据刷新失败")), "hint copy");
    assert.ok(stale.text.some((value) => value.includes("HTTP 500")), "hint names the failure");
    assert.equal(findNodes(stale.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-error")).length, 0, "no full-screen error bar");
    // A healthy refresh keeps the hint off screen.
    assert.equal(findNodes(full.tree, (node) => String(node.props.className ?? "").split(" ").includes("ssp-hint")).length, 0);
  },
  "hint only",
);

// Report
// ---------------------------------------------------------------------------
console.log("");
for (const result of results) {
  if (result.ok) {
    console.log(`  ok  ${result.name}${result.actual === undefined ? "" : `  →  ${result.actual}`}`);
  } else {
    console.error(`  FAIL  ${result.name}\n        ${result.error}`);
  }
}
console.log("");
if (failures > 0) {
  console.error(`selfcheck-client: ${failures} failure(s) out of ${results.length} checks`);
  process.exit(1);
}
console.log(`selfcheck-client: all ${results.length} checks passed`);

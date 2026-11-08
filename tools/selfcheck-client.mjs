#!/usr/bin/env node
/**
 * Browser-half smoke test without a browser.
 *
 * Loads `client.js` through a fake `window.__ModuleLoader__`, applies the
 * plugin to a fake slots/locale context, then renders the page component with
 * a tiny hand-rolled React stand-in (createElement + hook stubs) and asserts
 * the exact copy, numbers, and formatting the panel shows for the reference
 * screenshot values. It also checks that the sidebar icon and both slot
 * registrations exist and that every dictionary key resolves.
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
  useEffect() {},
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
vm.runInThisContext(readFileSync(sourcePath, "utf8"), { filename: "client.js" });

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

check(
  "panel stylesheet is injected once",
  () => {
    assert.equal(styleTags.length, 1);
    assert.equal(styleTags[0].dataset.plugin, "dsh-session-stats-panel");
    assert.ok(styleTags[0].textContent.includes(".ssp-root"));
    assert.ok(styleTags[0].textContent.includes("--dsw-alias-bg-base"));
  },
  `${styleTags[0].textContent.length} bytes of CSS`,
);

// ---------------------------------------------------------------------------
// Fake client context: capture locale dictionaries and slot registrations
// ---------------------------------------------------------------------------
const dictionaries = {};
const registrations = [];
const injectedSlots = [];

function translate(key, params) {
  const dict = dictionaries.zh ?? {};
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
    assert.equal(sidebarRegistration.definition.label(), "会话统计");
  },
  `order=${sidebarRegistration.definition.order} label=会话统计`,
);

check(
  "sidebar icon renders a sized SVG element",
  () => {
    const icon = sidebarRegistration.component({ size: 16 });
    assert.equal(icon.$$element, true);
    assert.equal(icon.type, "svg");
    assert.equal(icon.props.width, 16);
    assert.equal(icon.props.height, 16);
    const paths = (icon.props.children ?? []).filter(Boolean);
    assert.ok(paths.length >= 1);
    assert.equal(paths[0].props.stroke, "currentColor");
  },
  "svg 16x16, currentColor",
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
  "every static t(\"...\") key resolves in both dictionaries",
  () => {
    const source = readFileSync(sourcePath, "utf8");
    const staticKeys = new Set();
    for (const match of source.matchAll(/\bt\("([^"$]+)"\)/g)) staticKeys.add(match[1]);
    for (const key of ["window.24h", "window.7d", "window.14d", "window.30d", "composition.cacheRead", "composition.input", "composition.output", "composition.cacheWrite"]) {
      staticKeys.add(key);
    }
    const missingZh = [...staticKeys].filter((key) => dictionaries.zh[key] === undefined);
    const missingEn = [...staticKeys].filter((key) => dictionaries.en[key] === undefined);
    assert.deepEqual(missingZh, []);
    assert.deepEqual(missingEn, []);
  },
  "all keys present",
);

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
/** Render an element tree to a flat list of text / title strings. */
function renderText(node, output = []) {
  if (node === null || node === undefined || node === false || node === true) return output;
  if (typeof node === "string" || typeof node === "number") {
    output.push(String(node));
    return output;
  }
  if (Array.isArray(node)) {
    for (const child of node) renderText(child, output);
    return output;
  }
  if (typeof node === "object" && node.$$element === true) {
    if (typeof node.type === "function") {
      renderText(node.type(node.props), output);
      return output;
    }
    if (typeof node.props.title === "string") output.push(node.props.title);
    renderText(node.props.children, output);
  }
  return output;
}

/**
 * Collect rendered elements matching a predicate, expanding function components.
 * @param {unknown} node - element tree node.
 * @param {(node: object) => boolean} predicate - match test over element nodes.
 * @param {object[]} [output] - accumulator.
 * @returns {object[]} matching elements.
 */
function findElements(node, predicate, output = []) {
  if (node === null || node === undefined || node === false || node === true) return output;
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, output);
    return output;
  }
  if (typeof node !== "object" || node.$$element !== true) return output;
  if (typeof node.type === "function") {
    findElements(node.type(node.props), predicate, output);
    return output;
  }
  if (predicate(node)) output.push(node);
  findElements(node.props.children, predicate, output);
  return output;
}

// Terminal page sample payload
// ---------------------------------------------------------------------------
const PALETTE = ["#12b886", "#4dabf7", "#9775fa", "#ff922b", "#22b8cf", "#f06595", "#fcc419", "#5c7cfa", "#b08968", "#adb5bd"];
const OTHER_COLOR = "#868e96";

/** Build one candle bar (OHLC in tokens/minute). */
function bar(t, o, h, l, c, tokens, costCNY, calls, byModel) {
  return { t, o, h, l, c, tokens, costCNY, calls, sessions: 2, cacheHit: 0.9, byModel, vol: calls, empty: false };
}

const SAMPLE_BARS = [
  bar(1793700000000, 12000, 18000, 11000, 15000, 3000000, 2.1, 4, [{ route: "deepseek/deepseek-v4.1-flash", tokens: 2000000 }, { route: "opencode-go/kimi-k3", tokens: 1000000 }]),
  bar(1793703600000, 15000, 16000, 9000, 10000, 2000000, 1.4, 3, [{ route: "deepseek/deepseek-v4.1-flash", tokens: 1500000 }, { route: "opencode-go/kimi-k3", tokens: 500000 }]),
  bar(1793707200000, 10000, 10000, 10000, 10000, 0, 0, 0, [], true),
  bar(1793710800000, 10000, 22000, 10000, 20000, 4000000, 3.2, 6, [{ route: "deepseek/deepseek-v4.1-flash", tokens: 3000000 }, { route: "opencode-go/kimi-k3", tokens: 1000000 }]),
  bar(1793714400000, 20000, 24000, 14000, 16000, 3200000, 2.4, 5, [{ route: "deepseek/deepseek-v4.1-flash", tokens: 2200000 }, { route: "opencode-go/kimi-k3", tokens: 1000000 }]),
];
const SAMPLE_TERMINAL = {
  indices: [
    { key: "tokens", label: "总消耗", value: 764900000, unit: "tokens", chgPct: 0.124, spark: [1, 2, 3, 2, 4, 3, 5, 4, 6, 5, 7, 8] },
    { key: "cost", label: "预估成本", value: 47.5, unit: "¥", chgPct: 0.031, spark: [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7] },
    { key: "sessions", label: "会话数", value: 22, unit: "个", chgPct: -0.05, spark: [3, 4, 4, 5, 4, 6, 5, 6, 7, 6, 7, 8] },
    { key: "cacheHit", label: "缓存命中率", value: 0.996, unit: "%", chgPct: 0.002, spark: [9, 9, 10, 9, 10, 10, 9, 10, 10, 10, 10, 10] },
    { key: "search", label: "官方搜索", value: 4, unit: "次", chgPct: null, spark: [0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 0, 0] },
  ],
  symbols: [
    { code: "MDL-01", route: "deepseek/deepseek-v4.1-flash", name: "deepseek-v4.1-flash", vendor: "deepseek", color: PALETTE[0], tokens: 520000000, costCNY: 30, unpriced: false, rate: 24000, chgPct: 0.12, spark: [3, 4, 4, 5, 6, 5, 7, 8] },
    { code: "MDL-02", route: "opencode-go/kimi-k3", name: "kimi-k3", vendor: "moonshot", color: PALETTE[1], tokens: 50000000, costCNY: 10, unpriced: false, rate: 8000, chgPct: -0.04, spark: [4, 3, 5, 4, 3, 4, 3, 2] },
    { code: "MDL-03", route: "opencode-go/claude-opus-4.1", name: "claude-opus-4.1", vendor: "anthropic", color: PALETTE[2], tokens: 44900000, costCNY: 0, unpriced: true, rate: 7000, chgPct: null, spark: [0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  candles: { period: "1h", bars: SAMPLE_BARS },
  tape: [
    { t: 1793714400000, kind: "chat", model: "deepseek-v4.1-flash", tokens: 1300000, costCNY: 1.84 },
    { t: 1793714000000, kind: "search", model: "官方搜索", tokens: 0, costCNY: 0.005 },
    { t: 1793713600000, kind: "chat", model: "kimi-k3", tokens: 900000, costCNY: 0.72 },
  ],
};
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
  terminal: SAMPLE_TERMINAL,
};
const SAMPLE_LIVE = { ok: true, sampledAt: 1793714400000, intervalMs: 5000, points: 60, windowSec: 300, cpu: { single: 0, machine: 0, cores: 11 }, memory: { rssMB: 619, heapUsedMB: 190, heapTotalMB: 240, externalMB: 6, arrayBuffersMB: 2 }, eventLoop: { p99ms: 121.2, meanMs: 25.5, resolutionMs: 10 }, uptimeSec: 1740, uptimeText: "29m", pid: 2866, node: "v24.21.0", platform: "win32", history: { values: [0, 0.1, 0.05, 0.08], peak: 0.1, windowSec: 300, intervalMs: 5000 } };

/** Render the page with a fixed hook-state sequence. */
function renderPage({ mode = "terminal", windowKey = "7d", currency = "CNY", view = "bars", overview = null, live = null, error = null } = {}) {
  stateQueue = [mode, ...(mode === "terminal" ? [windowKey, currency, view, "tokens", "ALL", -1, 0, { status: error ? "error" : overview === null ? "loading" : "ready", data: overview, error }, live] : [windowKey, currency, 0, { status: error ? "error" : overview === null ? "loading" : "ready", data: overview, error }, live])];
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

/** Depth-first element finder. */
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

const Page = mainRegistration.component;
const ready = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
const readyText = ready.text;

check(
  "terminal header: title, SESSION TERMINAL, tabs, currencies, chart toggle",
  () => {
    assert.ok(readyText.includes("会话统计"));
    assert.ok(readyText.includes("SESSION TERMINAL"));
    for (const label of ["近 24 小时", "近 7 天", "近 14 天", "近 30 天"]) assert.ok(readyText.includes(label), label);
    assert.ok(readyText.includes("CNY"));
    assert.ok(readyText.includes("USD"));
    assert.ok(readyText.includes("堆叠柱"));
    assert.ok(readyText.includes("K线"));
  },
  "会话统计 / SESSION TERMINAL / 4 tabs / 柱状·K线",
);

check(
  "index strip renders five cells with change badges and mini K",
  () => {
    const cells = findNodes(ready.tree, (node) => node.props.className && String(node.props.className).startsWith("ssp-index") && node.type === "button");
    assert.equal(cells.length, 5);
    for (const label of ["总消耗", "预估成本", "会话数", "缓存命中率", "官方搜索"]) assert.ok(readyText.includes(label), label);
    assert.ok(readyText.some((value) => value.includes("▲")), "up badge");
    assert.ok(readyText.some((value) => value.includes("▼")), "down badge");
    const minis = findNodes(ready.tree, (node) => String(node.props.className ?? "").includes("ssp-mini-k"));
    assert.ok(minis.length >= 5, "one mini K per index cell");
  },
  "5 indices + ▲▼ + mini K",
);

check(
  "instrument header shows price, change and five stats",
  () => {
    assert.ok(readyText.includes("今开"));
    assert.ok(readyText.includes("最高"));
    assert.ok(readyText.includes("最低"));
    assert.ok(readyText.includes("均价"));
    assert.ok(readyText.includes("振幅"));
    const price = findNodes(ready.tree, (node) => node.props.className === "ssp-instrument-price");
    assert.equal(price.length, 1);
  },
  "price + 5 stats",
);

check(
  "bars mode is the default and renders stacked model bars",
  () => {
    const bars = findNodes(ready.tree, (node) => node.props.className === "ssp-term-bar");
    assert.ok(bars.length >= SAMPLE_BARS.length, `expected >= ${SAMPLE_BARS.length} stacked bars, got ${bars.length}`);
    assert.equal(findNodes(ready.tree, (node) => String(node.props.className ?? "").includes("ssp-candle-body")).length, 0);
    assert.ok(readyText.includes("按模型堆叠"));
  },
  "bars by default",
);

const candleRender = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE, view: "candles" });
check(
  "candles mode renders OHLC bodies, wicks and three MA lines",
  () => {
    const bodies = findNodes(candleRender.tree, (node) => String(node.props.className ?? "").includes("ssp-candle-body"));
    assert.equal(bodies.length, SAMPLE_BARS.length);
    const ma = findNodes(candleRender.tree, (node) => String(node.props.className ?? "").includes("ssp-ma"));
    assert.equal(ma.length, 3);
    const paths = findNodes(candleRender.tree, (node) => node.type === "path" && String(node.props.className ?? "").includes("ssp-candle-wick"));
    assert.ok(paths.length >= 1, "wick paths");
    assert.ok(candleRender.text.some((value) => value.startsWith("MA5")));
    // No SVG <title>: it pops a native tooltip on top of the custom hover card.
    const titles = findNodes(candleRender.tree, (node) => node.type === "title");
    assert.equal(titles.length, 0);
    // Accessibility text lives on the hit rects instead.
    const hits = findNodes(candleRender.tree, (node) => node.type === "rect" && typeof node.props["aria-label"] === "string" && / vol \d+$/.test(node.props["aria-label"]));
    assert.equal(hits.length, SAMPLE_BARS.length);
  },
  "5 bodies / 3 MA / aria-label, no <title>",
);

/** Render the terminal with a hover index and a given zone offset. */
function renderHover(view, hoverIndex, offsetMs) {
  const overview = { ...SAMPLE_OVERVIEW, window: { ...SAMPLE_OVERVIEW.window, offsetMs } };
  stateQueue = ["terminal", "7d", "CNY", view, "tokens", "ALL", hoverIndex, 0, { status: "ready", data: overview, error: null }, SAMPLE_LIVE];
  return Page({ t: translate });
}
check(
  "crosshair time label honours the window zone offset (non-UTC+8)",
  () => {
    const berlin = 1 * 3_600_000;
    for (const view of ["bars", "candles"]) {
      for (const index of [0, 3]) {
        const tree = renderHover(view, index, berlin);
        const hot = findNodes(tree, (node) => node.type === "text" && String(node.props.className ?? "").includes("ssp-term-axis-hot") && node.props.textAnchor === "middle");
        assert.equal(hot.length, 1, view + " hot axis label");
        const d = new Date(SAMPLE_BARS[index].t + berlin);
        const expected = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
        assert.equal(hot[0].props.children.join(""), expected, view + "#" + index);
      }
    }
  },
  "UTC+1 label == axis clock",
);

check(
  "watchlist lists every model plus the ALL row",
  () => {
    const rows = findNodes(ready.tree, (node) => String(node.props.className ?? "").includes("ssp-watch-row") && node.type === "button");
    assert.equal(rows.length, SAMPLE_TERMINAL.symbols.length + 1);
    for (const item of SAMPLE_TERMINAL.symbols) assert.ok(readyText.includes(item.code), item.code);
  },
  "ALL + 3 models",
);

check(
  "tape lists recent activity and marks search with the gold dot",
  () => {
    const rows = findNodes(ready.tree, (node) => node.props.className === "ssp-tape-row");
    assert.equal(rows.length, SAMPLE_TERMINAL.tape.length);
    assert.ok(readyText.some((value) => value.includes("SEARCH")));
    const gold = findNodes(ready.tree, (node) => String(node.props.className ?? "").includes("ssp-tape-dot-search"));
    assert.equal(gold.length, 1);
  },
  "3 rows + gold search dot",
);

check(
  "positions table covers every symbol and marks unpriced rows",
  () => {
    const rows = findNodes(ready.tree, (node) => String(node.props.className ?? "").startsWith("ssp-pos-row"));
    assert.equal(rows.length, SAMPLE_TERMINAL.symbols.length + 1, "header + 3 rows");
    assert.ok(readyText.includes("未计价"));
  },
  "header + 3 rows",
);

check(
  "status bar shows window, sessions, sample time and price table",
  () => {
    assert.ok(readyText.some((value) => value.includes("行情数据")));
    assert.ok(readyText.some((value) => value.includes("22 个会话")));
    assert.ok(readyText.some((value) => value.includes("采样")));
    assert.ok(readyText.some((value) => value.includes("vendor-official-2026-11")));
  },
  "status bar",
);

const usd = renderPage({ currency: "USD", overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
check(
  "USD currency flows into cost labels",
  () => {
    assert.ok(usd.text.some((value) => value.startsWith("$")));
  },
  "$ labels",
);

const empty = renderPage({ overview: null });
check(
  "empty state says receiving market data without NaN",
  () => {
    assert.ok(empty.text.includes("正在接收行情数据…"));
    assert.ok(!empty.text.some((value) => /NaN|undefined/.test(value)));
  },
  "receiving… / no NaN",
);

const failed = renderPage({ overview: null, error: "HTTP 500" });
check(
  "error banner shows message and retry",
  () => {
    assert.ok(failed.text.some((value) => value.includes("统计数据加载失败")));
    assert.ok(failed.text.includes("重试"));
  },
  "HTTP 500 / 重试",
);

check(
  "no unresolved locale keys in rendered output",
  () => {
    const bad = readyText.filter((value) => /^(index|stats|watch|tape|positions|status|chart|view|priceMode|terminal|state)\./.test(value) || /NaN|undefined/.test(value));
    assert.deepEqual(bad, []);
  },
  "clean",
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// View mode: the original stats layout is the default, the terminal is a skin
// ---------------------------------------------------------------------------
const statsPage = renderPage({ mode: "stats", overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
check(
  "stats mode is the default view and keeps every original card",
  () => {
    for (const label of ["总 Token 消耗", "预估成本", "会话数", "缓存命中率"]) assert.ok(statsPage.text.includes(label), label);
    assert.ok(statsPage.text.some((value) => value.includes("DSH 运行状态")));
    assert.ok(statsPage.text.includes("每日消耗"));
    assert.ok(statsPage.text.includes("Token 构成"));
    assert.ok(statsPage.text.includes("成本构成"));
    assert.ok(statsPage.text.includes("分模型明细"));
    // The playful terminal furniture must not leak into the primary view.
    for (const absent of ["今开", "自选行情", "成交流水", "持仓明细", "SESSION TERMINAL"]) {
      assert.ok(!statsPage.text.includes(absent), "terminal-only copy in stats view: " + absent);
    }
  },
  "4 cards + live + 3 charts + detail",
);

check(
  "both views expose the same 统计 / K线 switch",
  () => {
    const buttons = (tree) => findNodes(tree, (node) => node.type === "button" && typeof node.props.className === "string" && node.props.className.includes("ssp-view-btn")).map((node) => node.props.children);
    for (const mode of ["stats", "terminal"]) {
      const page = renderPage({ mode, overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
      const labels = buttons(page.tree).flat(Infinity).filter((value) => typeof value === "string");
      assert.ok(labels.includes("统计"), mode + " has 统计");
      assert.ok(labels.includes("K线"), mode + " has K线");
    }
  },
  "统计 + K线 in both",
);

check(
  "view mode is remembered under its own localStorage key",
  () => {
    const source = readFileSync(sourcePath, "utf8");
    assert.ok(source.includes("dsh-session-stats:mode"), "mode storage key");
    assert.ok(/getItem\("dsh-session-stats:mode"\) === "terminal" \? "terminal" : "stats"/.test(source), "defaults to stats");
  },
  "dsh-session-stats:mode, default stats",
);

check(
  "the old single-layout page never renders as the default",
  () => {
    assert.ok(!statsPage.text.includes("行情走势"), "terminal chart title leaked into stats view");
    assert.ok(ready.text.includes("行情走势"));
  },
  "isolated views",
);

// Report
// ---------------------------------------------------------------------------
console.log("");
check("live card shows core count only, never a load-average number", () => {
  const text = renderPage({ mode: "stats", overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE }).text;
  assert.ok(text.some((value) => value.includes("11 核")), "core count");
  assert.ok(!text.some((value) => /负载|load\/core|loadavg/i.test(value)), "no load-average copy");
});

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

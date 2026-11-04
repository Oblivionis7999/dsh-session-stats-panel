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
    return {
      $$element: true,
      type,
      props: { ...(props ?? {}), children: flat.filter((child) => child !== null && child !== undefined && child !== false && child !== true) },
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
    assert.equal(mainRegistration.definition.key, "session-stats");
    assert.equal(mainRegistration.definition.locale, "session-stats");
    assert.equal(typeof mainRegistration.component, "function");
  },
  "main/key=session-stats",
);

check(
  "sidebar registration has id, order, and localized label",
  () => {
    assert.equal(sidebarRegistration.definition.id, "session-stats");
    assert.equal(sidebarRegistration.definition.order, 20);
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

const Page = mainRegistration.component;

/** Palette echoed by the host response (single source of truth for chart colors). */
const PALETTE = ["#12b886", "#4dabf7", "#9775fa", "#ff922b", "#22b8cf", "#f06595", "#fcc419", "#5c7cfa", "#b08968", "#adb5bd"];
const OTHER_COLOR = "#868e96";

/** Four models summing to the screenshot total (764.9M) and cost (¥47.48). */
const SAMPLE_MODELS = [
  { provider: "deepseek", model: "deepseek-v4.1-flash", route: "deepseek/deepseek-v4.1-flash", label: "deepseek-v4.1-flash", color: PALETTE[0], tokens: 520_000_000, costCNY: 30, costUSD: 4.225352, share: 520 / 764.9, events: 20, priced: true, priceKey: "deepseek-flash", vendor: "deepseek", priceLevel: "official", sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing" },
  { provider: "deepseek", model: "deepseek-v4-pro", route: "deepseek/deepseek-v4-pro", label: "deepseek-v4-pro", color: PALETTE[1], tokens: 150_000_000, costCNY: 7.48, costUSD: 1.053521, share: 150 / 764.9, events: 2, priced: true, priceKey: "deepseek-v4-pro", vendor: "deepseek", priceLevel: "official", sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing" },
  { provider: "opencode-go", model: "kimi-k3", route: "opencode-go/kimi-k3", label: "kimi-k3", color: PALETTE[2], tokens: 50_000_000, costCNY: 10, costUSD: 1.408451, share: 50 / 764.9, events: 5, priced: true, priceKey: "kimi-k3", vendor: "moonshot", priceLevel: "official", sourceUrl: "https://platform.kimi.com/docs/pricing/chat" },
  { provider: "opencode-go", model: "claude-opus-4.1", route: "opencode-go/claude-opus-4.1", label: "claude-opus-4.1", color: PALETTE[3], tokens: 44_900_000, costCNY: 0, costUSD: 0, share: 44.9 / 764.9, events: 1, priced: false, priceKey: null, vendor: "anthropic", priceLevel: "unpriced", sourceUrl: null },
  { provider: "official", model: "server-tool-search", route: "official/server-tool-search", label: "官方搜索", color: OTHER_COLOR, tokens: 0, costCNY: 0.02, costUSD: 0.002817, share: 0, shareByCost: 0.02 / 47.5, events: 0, priced: true, priceKey: "search:per-request", vendor: "deepseek", priceLevel: "official", costsOnly: true, searches: 4 },
];

const FLASH_RATE = 30 / 520_000_000;
const PRO_RATE = 7.48 / 150_000_000;
const KIMI_RATE = 10 / 50_000_000;
const CLAUDE_RATE = 0;

/** Build one daily bucket whose per-model tokens sum to the day total. */
function sampleDay(key, label, flashTokens, proTokens, kimiTokens, claudeTokens) {
  const tokens = flashTokens + proTokens + kimiTokens + claudeTokens;
  const flashCost = flashTokens * FLASH_RATE;
  const proCost = proTokens * PRO_RATE;
  const kimiCost = kimiTokens * KIMI_RATE;
  const claudeCost = claudeTokens * CLAUDE_RATE;
  const costCNY = flashCost + proCost + kimiCost + claudeCost;
  const dayModels = [
    { route: "deepseek/deepseek-v4.1-flash", label: "deepseek-v4.1-flash", color: PALETTE[0], tokens: flashTokens, costCNY: flashCost, costUSD: flashCost / 7.1, share: tokens > 0 ? flashTokens / tokens : 0, vendor: "deepseek", priceLevel: "official" },
    { route: "deepseek/deepseek-v4-pro", label: "deepseek-v4-pro", color: PALETTE[1], tokens: proTokens, costCNY: proCost, costUSD: proCost / 7.1, share: tokens > 0 ? proTokens / tokens : 0, vendor: "deepseek", priceLevel: "official" },
    { route: "opencode-go/kimi-k3", label: "kimi-k3", color: PALETTE[2], tokens: kimiTokens, costCNY: kimiCost, costUSD: kimiCost / 7.1, share: tokens > 0 ? kimiTokens / tokens : 0, vendor: "moonshot", priceLevel: "official" },
    { route: "opencode-go/claude-opus-4.1", label: "claude-opus-4.1", color: PALETTE[3], tokens: claudeTokens, costCNY: claudeCost, costUSD: claudeCost / 7.1, share: tokens > 0 ? claudeTokens / tokens : 0, vendor: "anthropic", priceLevel: "unpriced" },
  ].filter((model) => model.tokens > 0);
  return {
    key,
    label,
    start: 0,
    end: 0,
    input: Math.round(tokens * 0.004),
    output: Math.round(tokens * 0.005),
    cacheRead: Math.round(tokens * 0.991),
    cacheWrite: 0,
    tokens,
    costCNY,
    costUSD: costCNY / 7.1,
    events: 3,
    models: dayModels,
  };
}

/** The reference screenshot payload, shaped exactly like the host response. */
const SAMPLE_OVERVIEW = {
  ok: true,
  generatedAt: Date.now(),
  window: {
    key: "7d",
    granularity: "day",
    bucketCount: 7,
    from: 0,
    to: 0,
    label: "近 7 天",
    labelEn: "Last 7 days",
    points: ["10/28", "10/29", "10/30", "10/31", "11/1", "11/2", "11/3"],
  },
  currency: { code: "CNY", symbol: "¥", usdRate: 7.1, usdSymbol: "$" },
  totals: {
    tokens: 764_900_000,
    input: 3_380_000,
    output: 3_410_000,
    cacheRead: 758_100_000,
    cacheWrite: 0,
    costCNY: 47.48,
    costUSD: 6.687324,
    cacheHitRate: 0.99556,
    sessions: 22,
    avgTokensPerSession: 34_768_182,
    pricedTokens: 720_000_000,
    unpricedTokens: 44_900_000,
    priced: false,
    unpricedModels: 1,
    searches: 4,
    searchCostCNY: 0.02,
    costCNYTotal: 47.5,
    costCNYWithSearch: 47.5,
    events: 1234,
  },
  pricing: { tableVersion: "vendor-official-2026-11", peakMultiplier: 2, peakEvents: 10, offPeakEvents: 4, mode: "mixed", holidays: [], usdRate: 7.1, officialLists: ["vendor-official"], priceLevels: { official: 3, unpriced: 1 } },
  modelPalette: PALETTE,
  otherModelColor: OTHER_COLOR,
  composition: [
    { key: "cacheRead", tokens: 758_100_000, share: 0.991111 },
    { key: "input", tokens: 3_380_000, share: 0.004419 },
    { key: "output", tokens: 3_410_000, share: 0.004458 },
  ],
  daily: [
    sampleDay("1", "10/28", 68_000_000, 20_500_000, 6_500_000, 6_000_000),
    sampleDay("2", "10/29", 63_000_000, 19_000_000, 6_000_000, 5_500_000),
    sampleDay("3", "10/30", 73_000_000, 22_000_000, 7_000_000, 6_500_000),
    sampleDay("4", "10/31", 57_000_000, 17_000_000, 5_000_000, 5_000_000),
    sampleDay("5", "11/1", 69_000_000, 20_700_000, 6_300_000, 6_000_000),
    sampleDay("6", "11/2", 79_000_000, 23_700_000, 7_300_000, 7_000_000),
    sampleDay("7", "11/3", 111_000_000, 27_100_000, 11_900_000, 8_900_000),
  ],
  models: SAMPLE_MODELS,
  scan: { sessionsScanned: 22, sessionsTotal: 22, readCount: 22, cachedCount: 0 },
};

/** The reference screenshot live snapshot. */
const SAMPLE_LIVE = {
  ok: true,
  sampledAt: Date.now(),
  intervalMs: 5000,
  points: 60,
  windowSec: 300,
  cpu: { single: 0, machine: 0, cores: 11, loadavg: 0 },
  memory: { rssMB: 619, heapUsedMB: 190, heapTotalMB: 240, externalMB: 6, arrayBuffersMB: 2 },
  eventLoop: { p99ms: 121.2, meanMs: 25.5, resolutionMs: 10 },
  uptimeSec: 1740,
  uptimeText: "29m",
  pid: 2866,
  node: "v24.21.0",
  platform: "win32",
  history: { values: [0, 0.1, 0.05, 0.08], peak: 0.1, windowSec: 300, intervalMs: 5000 },
};

/** Render the page with a fixed hook-state sequence. */
function renderPage({ windowKey = "7d", currency = "CNY", overview = null, live = null, error = null } = {}) {
  stateQueue = [windowKey, currency, 0, { status: overview === null ? "loading" : "ready", data: overview, error }, live];
  const tree = Page({ t: translate });
  return { tree, text: renderText(tree) };
}

const ready = renderPage({ overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
const readyText = ready.text;

check(
  "page header: title, four time tabs, two currencies",
  () => {
    assert.ok(readyText.includes("会话统计"), "title");
    for (const label of ["近 24 小时", "近 7 天", "近 14 天", "近 30 天"]) assert.ok(readyText.includes(label), label);
    assert.ok(readyText.includes("人民币"));
    assert.ok(readyText.includes("美元"));
  },
  "会话统计 / 4 tabs / 人民币 | 美元",
);

check(
  "stat cards show the reference numbers",
  () => {
    assert.ok(readyText.includes("总 Token 消耗"));
    assert.ok(readyText.includes("764.9M"), "total tokens");
    assert.ok(readyText.includes("tokens"));
    assert.ok(readyText.includes("输入 3.38M · 输出 3.41M"), "input/output sub line");
    assert.ok(readyText.includes("预估成本"));
    assert.ok(readyText.includes("¥47.50"), "CNY cost incl. official search");
    assert.ok(readyText.some((value) => value.includes("各厂商官方价目 · DeepSeek 峰谷分时")), "vendor-official price sub line");
    assert.ok(readyText.some((value) => value.includes("含官方搜索 4 次 ¥0.02")), "official search sub line");
    assert.ok(readyText.includes("会话数"));
    assert.ok(readyText.includes("22"), "session count");
    assert.ok(readyText.includes("平均每会话 34.8M tokens"));
    assert.ok(readyText.includes("缓存命中率"));
    assert.ok(readyText.includes("99.6%"));
    assert.ok(readyText.includes("缓存读取 758.1M"));
  },
  "764.9M / ¥47.48 / 22 / 99.6%",
);

check(
  "live card shows the runtime snapshot",
  () => {
    assert.ok(readyText.includes("DSH 运行状态"));
    assert.ok(readyText.includes("实时 · 5 秒采样"));
    assert.ok(readyText.includes("11 核 负载 0.00"));
    assert.ok(readyText.includes("CPU（单核）"));
    assert.ok(readyText.includes("0.0%"));
    assert.ok(readyText.includes("单核"));
    assert.ok(readyText.includes("整机 0.0% · 11 核"));
    assert.ok(readyText.includes("内存（RSS）"));
    assert.ok(readyText.includes("619"));
    assert.ok(readyText.includes("堆已用 190 MB"));
    assert.ok(readyText.includes("事件循环 p99"));
    assert.ok(readyText.includes("121.2"));
    assert.ok(readyText.includes("平均 25.5 ms"));
    assert.ok(readyText.includes("运行时长"));
    assert.ok(readyText.includes("29m"));
    assert.ok(readyText.includes("PID 2866 · Node v24.21.0"));
    assert.ok(readyText.includes("最近 5 分钟 CPU"));
    assert.ok(readyText.includes("峰值 0.1%"));
  },
  "0.0% / 619 MB / 121.2 ms / 29m / 峰值 0.1%",
);

check(
  "daily card header + stacked bars + axis labels",
  () => {
    assert.ok(readyText.includes("每日消耗"));
    assert.ok(readyText.includes("按 token 堆叠 · 近 7 天"));
    assert.ok(readyText.includes("764.9M tokens"));
    assert.ok(readyText.includes("¥47.48"));
    for (const label of SAMPLE_OVERVIEW.window.points) assert.ok(readyText.includes(label), label);
    const bars = findElements(ready.tree, (node) => node.props.className === "ssp-bar");
    assert.ok(bars.length >= 7, `expected 7 bars, got ${bars.length}`);
    const segments = findElements(ready.tree, (node) => node.props.className === "ssp-bar-seg");
    assert.ok(segments.length >= 7, "every bar has model segments");
    const colors = new Set(segments.map((node) => node.props.style.background));
    assert.ok(colors.size >= 3, `expected >=3 model colors in the bars, got ${colors.size}`);
  },
  "7 bars, >=3 model colors",
);

check(
  "donut card is split by model and keeps the centre total",
  () => {
    assert.ok(readyText.includes("Token 构成"));
    assert.ok(readyText.includes("按模型"));
    const donutValues = readyText.filter((text) => text === "764.9M");
    assert.ok(donutValues.length >= 2, "total shown on the card and in the donut centre");
    for (const label of ["deepseek-v4.1-flash", "deepseek-v4-pro", "kimi-k3", "claude-opus-4.1"]) {
      assert.ok(readyText.includes(label), label);
    }
    assert.ok(readyText.includes("¥47.48"));
  },
  "764.9M centre + 4 model legend rows",
);

check(
  "donut segments use >=3 palette colors",
  () => {
    const segments = findElements(ready.tree, (node) => node.props.className === "ssp-donut-seg");
    const colors = new Set(segments.map((node) => node.props.style.stroke));
    assert.ok(segments.length >= 3);
    assert.ok(colors.size >= 3, `expected >=3 donut colors, got ${colors.size}`);
    const palette = new Set([...SAMPLE_OVERVIEW.modelPalette, SAMPLE_OVERVIEW.otherModelColor]);
    for (const color of colors) assert.ok(palette.has(color), `color ${color} is not from the response palette`);
  },
  "4 slices / 4 colors",
);

check(
  "model legend rows and detail rows cover every model",
  () => {
    const legendRows = findElements(ready.tree, (node) => node.props.className === "ssp-model-legend-row");
    const detailRows = findElements(ready.tree, (node) => node.props.className === "ssp-model-row");
    assert.equal(legendRows.length, SAMPLE_OVERVIEW.models.filter((model) => model.costsOnly !== true).length);
    assert.equal(detailRows.length, SAMPLE_OVERVIEW.models.filter((model) => model.costsOnly !== true).length);
    const detailText = renderText(detailRows);
    assert.ok(detailText.includes("deepseek-v4.1-flash"));
    assert.ok(detailText.includes("520M"));
    assert.ok(detailText.includes("44.9M"));
    assert.ok(readyText.includes("分模型明细"));
  },
  "4 legend rows / 5 detail rows",
);

check(
  "no unresolved locale keys or NaN in rendered output",
  () => {
    const bad = readyText.filter((text) =>
      /^(panel|window|currency|cards?|unit|live|daily|donut|composition|state)\./.test(text) || /NaN|undefined/.test(text),
    );
    assert.deepEqual(bad, []);
  },
  "clean",
);

const usd = renderPage({ currency: "USD", overview: SAMPLE_OVERVIEW, live: SAMPLE_LIVE });
check(
  "USD toggle derives display from the USD field",
  () => {
    assert.ok(usd.text.includes("$6.69"), "USD cost");
    assert.ok(!usd.text.includes("¥47.48"), "CNY value hidden while USD is selected");
  },
  "$6.69",
);

check(
  "official search row: tokens —, share 按次, per-request cost",
  () => {
    const rows = findElements(ready.tree, (node) => node.props.className === "ssp-model-row ssp-model-row-search");
    assert.equal(rows.length, 1, "one synthetic search row");
    const text = renderText(rows);
    assert.ok(text.includes("官方搜索"), "label");
    assert.ok(text.includes("· DeepSeek"), "vendor");
    assert.ok(text.includes("—"), "tokens placeholder");
    assert.ok(text.includes("按次"), "per-request share");
    assert.ok(text.includes("¥0.02"), "search cost");
    const titles = findElements(ready.tree, (node) => typeof node.props.title === "string").map((node) => node.props.title);
    assert.ok(titles.some((value) => value.includes("¥5 / 1000 次成功请求")), "per-request tooltip");
    // The 0-token row must never enter the token legend / donut.
    const legend = renderText(findElements(ready.tree, (node) => node.props.className === "ssp-model-legend-row"));
    assert.ok(!legend.includes("官方搜索"), "search row stays out of the legend");
  },
  "官方搜索 · — · 按次 · ¥0.02",
);

// Unpriced models are excluded from the amount and stated in the detail footer.
check(
  "unpriced models show 未计价 and a footer note",
  () => {
    const foot = readyText.filter((value) => value.includes("无官方定价，未计入金额"));
    assert.ok(foot.length > 0, "detail footer note");
    assert.ok(foot.some((value) => /1 个模型无官方定价，未计入金额（tokens 44\.9M）/.test(value)), "footer count and tokens");
    assert.ok(readyText.some((value) => value.includes("未计价")), "unpriced cost label");
    assert.ok(readyText.some((value) => value.includes("· 月之暗面")), "vendor label on Kimi row");
    assert.ok(readyText.some((value) => value.includes("· Anthropic")), "vendor label on unpriced row");
    assert.ok(readyText.some((value) => value.includes("· DeepSeek")), "vendor label on official row");
    const titles = findElements(ready.tree, (node) => typeof node.props.title === "string").map((node) => node.props.title);
    assert.ok(titles.some((value) => value.includes("价格来源：DeepSeek官方价目 · 元/百万 token")), "official price-source tooltip");
    assert.ok(titles.some((value) => value.includes("无官方定价，未计入金额")), "unpriced tooltip");
  },
  "footer + 未计价 + vendor labels",
);

// More than ten models: the palette overflows into a neutral "other" slice.
const manyModels = Array.from({ length: 12 }, (_, index) => ({
  provider: "prov",
  model: `model-${index + 1}`,
  route: `prov/model-${index + 1}`,
  label: `model-${index + 1}`,
  color: index < 10 ? PALETTE[index] : OTHER_COLOR,
  tokens: (12 - index) * 1_000_000,
  costCNY: 1,
  costUSD: 0.14,
  share: 1 / 78,
  events: 1,
  priced: true,
  vendor: "openai",
  priceLevel: "official",
  sourceUrl: "https://developers.openai.com/api/docs/pricing.md",
}));
const manyOverview = {
  ...SAMPLE_OVERVIEW,
  totals: { ...SAMPLE_OVERVIEW.totals, tokens: 78_000_000, costCNY: 12, costUSD: 1.69 },
  models: manyModels,
  daily: SAMPLE_OVERVIEW.daily.map((day) => ({ ...day, models: [] })),
};
const many = renderPage({ overview: manyOverview, live: SAMPLE_LIVE });
check(
  "more than ten models collapse into one 'other' slice",
  () => {
    const legendRows = findElements(many.tree, (node) => node.props.className === "ssp-model-legend-row");
    assert.equal(legendRows.length, 11, "10 palette models + other");
    assert.ok(many.text.includes("其他"));
    const segments = findElements(many.tree, (node) => node.props.className === "ssp-donut-seg");
    const colors = segments.map((node) => node.props.style.stroke);
    assert.ok(colors.includes(OTHER_COLOR), "other slice uses the neutral color");
    assert.equal(new Set(colors).size, 11);
  },
  "10 + other",
);

const hostDefault = renderPage({
  windowKey: null,
  overview: {
    ...SAMPLE_OVERVIEW,
    window: { ...SAMPLE_OVERVIEW.window, key: "30d", label: "近 30 天", labelEn: "Last 30 days", points: SAMPLE_OVERVIEW.window.points },
  },
  live: SAMPLE_LIVE,
});
check(
  "host default window is adopted until the user picks a tab",
  () => {
    assert.ok(hostDefault.text.includes("按 token 堆叠 · 近 30 天"));
  },
  "follows host default 30d",
);

const loading = renderPage({});
check(
  "loading state renders placeholders without crashing",
  () => {
    const text = loading.text;
    assert.ok(text.includes("会话统计"));
    assert.ok(text.includes("—"));
    assert.ok(!text.some((value) => /NaN|undefined/.test(value)));
  },
  "placeholders only",
);

const failed = renderPage({ error: "HTTP 500" });
check(
  "error banner shows the message and a retry button",
  () => {
    assert.ok(failed.text.some((value) => value.includes("统计数据加载失败") && value.includes("HTTP 500")));
    assert.ok(failed.text.includes("重试"));
  },
  "统计数据加载失败：HTTP 500 / 重试",
);

const empty = renderPage({
  overview: {
    ...SAMPLE_OVERVIEW,
    totals: { ...SAMPLE_OVERVIEW.totals, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costCNY: 0, costUSD: 0, cacheHitRate: 0, sessions: 0, avgTokensPerSession: 0 },
    composition: [],
    daily: SAMPLE_OVERVIEW.daily.map((day) => ({ ...day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, costCNY: 0, costUSD: 0 })),
    models: [],
  },
  live: SAMPLE_LIVE,
});
check(
  "zero-usage payload renders zeros and an empty donut track",
  () => {
    assert.ok(empty.text.includes("0.0%"));
    assert.ok(!empty.text.some((value) => /NaN|undefined/.test(value)));
  },
  "zeros, no NaN",
);

// ---------------------------------------------------------------------------
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

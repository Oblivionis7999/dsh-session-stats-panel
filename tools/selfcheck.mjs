#!/usr/bin/env node
/**
 * Smoke test for the pure pricing + aggregation core.
 *
 * Feeds hand-built `assistant/message` events (the exact `dsh-session` shape)
 * through `lib/pricing.js` and `lib/aggregate.js` and asserts the token sums,
 * CNY cost, cache-hit rate, peak/off-peak routing, daily buckets, model shares,
 * composition, and window filtering.
 *
 * Run: node tools/selfcheck.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CN_HOLIDAYS_2026,
  CN_MAKEUP_WORKDAYS_2026,
  PRICE_TABLE_VERSION,
  SEARCH_REQUEST_PRICE_CNY,
  costOfUsage,
  createPricing,
  effectivePrice,
  isPeakTime,
  priceForRoute,
  searchCost,
} from "../lib/pricing.js";
import {
  CANDLE_SPECS,
  DEFAULT_USD_RATE,
  MODEL_PALETTE,
  OTHER_MODEL_COLOR,
  buildOverview,
  dayIndexOf,
  resolveWindow,
  zoneOffsetMs,
  summarizeSessionEvents,
} from "../lib/aggregate.js";
import { formatUptime, normalizeConfig } from "../lib/index.js";

const results = [];
let failures = 0;

/**
 * Assert one condition and record a printable line.
 * @param {string} name - check name.
 * @param {() => void} run - assertion body.
 * @param {unknown} [actual] - value to print on success.
 */
function check(name, run, actual) {
  try {
    run();
    results.push({ ok: true, name, actual });
  } catch (error) {
    failures += 1;
    results.push({ ok: false, name, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Approximate number equality within a tolerance. */
function closeTo(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `expected ${expected}, got ${actual}`);
}

/** Build one `assistant/message` event. */
function messageEvent({ seq, time, provider, model, input, output, cacheRead = 0, cacheWrite = 0 }) {
  return {
    type: "assistant/message",
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: {
        role: "assistant",
        source: { kind: "model", provider, model },
        content: [{ type: "text", text: "ok" }],
      },
      stream: [],
      usage: {
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture: 2026-11-03 22:00 Beijing (= 2026-11-03T14:00:00Z, Tuesday, off-peak)
// ---------------------------------------------------------------------------
const NOW = Date.UTC(2026, 10, 3, 14, 0, 0);
const HOUR = 3_600_000;
const M = 1_000_000;

const events = [
  // Peak: Beijing Tue 10:00 (2026-11-03T02:00Z) — DeepSeek Flash.
  messageEvent({ seq: 1, time: Date.UTC(2026, 10, 3, 2, 0, 0), provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 1 * M, cacheRead: 10 * M }),
  // Off-peak: Beijing Mon 20:00 (2026-11-02T12:00Z) — DeepSeek Flash, with a cache write.
  messageEvent({ seq: 2, time: Date.UTC(2026, 10, 2, 12, 0, 0), provider: "opencode-go", model: "deepseek-v4.1-flash", input: 2 * M, output: 0.5 * M, cacheRead: 5 * M, cacheWrite: 1 * M }),
  // Peak: Beijing Tue 11:00 (2026-11-03T03:00Z) — DeepSeek V4 Pro.
  messageEvent({ seq: 3, time: Date.UTC(2026, 10, 3, 3, 0, 0), provider: "deepseek", model: "deepseek-v4-pro", input: 1 * M, output: 1 * M, cacheRead: 1 * M }),
  // Off-peak: Beijing Mon 04:00 (2026-11-01T20:00Z) — unpriced model.
  messageEvent({ seq: 4, time: Date.UTC(2026, 10, 1, 20, 0, 0), provider: "anthropic", model: "claude-opus-4.1", input: 1 * M, output: 0.1 * M }),
  // Official web-search requests: billed per request (¥0.005 each), no usage field.
  { type: "web/deepseek-search-llm-request", seq: 9, time: NOW - 30 * 60_000, data: {} },
  { type: "web/deepseek-search-llm-request", seq: 10, time: NOW - 20 * 60_000, data: {} },
  { type: "web/deepseek-search-llm-request", seq: 11, time: NOW - 10 * 60_000, data: {} },
  // Too old for the 31-day cache horizon: must be pruned.
  messageEvent({ seq: 5, time: Date.UTC(2026, 8, 1, 2, 0, 0), provider: "opencode-go", model: "deepseek-v4.1-flash", input: 99 * M, output: 99 * M }),
  // Not a usage event: must be skipped without throwing.
  { type: "user/message", seq: 6, time: NOW - HOUR, data: { turn: 1, message: { role: "user", content: [] } } },
  // Malformed / partial events must be skipped, never thrown on.
  { type: "assistant/message", seq: 7, time: NOW - HOUR, data: {} },
  { type: "assistant/message", seq: 8, time: NOW - HOUR, data: { usage: { inputTokens: 0, outputTokens: 0 } } },
];

const pricing = createPricing({ holidays: [] });
const aggregate = summarizeSessionEvents("session-demo", events, { createdAt: NOW - 7 * 24 * HOUR, pricing, now: NOW });
const overview = buildOverview([aggregate], { windowKey: "7d", now: NOW, pricing, usdRate: DEFAULT_USD_RATE });

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------
check("price table version", () => assert.equal(PRICE_TABLE_VERSION, "vendor-official-2026-11"), PRICE_TABLE_VERSION);

check(
  "route matching: vendor-official lists only, unknown → unpriced",
  () => {
    const flash = priceForRoute("opencode-go/deepseek-v4.1-flash");
    assert.equal(flash.key, "deepseek-flash");
    assert.equal(flash.vendor, "deepseek");
    assert.equal(flash.currency, "CNY");
    assert.equal(priceForRoute("deepseek/deepseek-v4-pro").key, "deepseek-v4-pro");
    // Regression: a third-party `*-flash` id must be priced by Zhipu, not DeepSeek.
    const glm = priceForRoute("opencode-go/glm-5.3-flash");
    assert.equal(glm.key, "glm-5.3-flash");
    assert.equal(glm.vendor, "zhipu");
    assert.equal(glm.currency, "CNY");
    assert.equal(priceForRoute("opencode-go/glm-5.3-flashx").key, "glm-5.3-flashx");
    assert.equal(priceForRoute("opencode-go/glm-5.2").key, "glm-5.2");
    // Official USD vendor rows.
    assert.equal(priceForRoute("naapi-ds/grok-4.7").vendor, "xai");
    assert.equal(priceForRoute("opencode-go/qwen3.8-flash").vendor, "alibaba");
    assert.equal(priceForRoute("opencode-go/gpt-6-luna").vendor, "openai");
    assert.equal(priceForRoute("opencode-go/claude-haiku-5-5").vendor, "anthropic");
    // Moonshot Kimi (CNY) and its aliases.
    const kimi = priceForRoute("opencode-go/kimi-k3");
    assert.equal(kimi.key, "kimi-k3");
    assert.equal(kimi.vendor, "moonshot");
    assert.equal(kimi.currency, "CNY");
    assert.equal(kimi.priceLevel, "official");
    assert.equal(priceForRoute("opencode-go/k3-256k").key, "kimi-k3");
    assert.equal(priceForRoute("opencode-go/k3").key, "kimi-k3");
    assert.equal(priceForRoute("kimi-coding/kimi-for-coding").key, "kimi-k2.7-code");
    assert.equal(priceForRoute("kimi-coding/kimi-for-coding-highspeed").key, "kimi-k2.7-code-highspeed");
    // Tencent Hunyuan TokenHub list.
    assert.equal(priceForRoute("opencode-go/hy3").vendor, "tencent");
    assert.equal(priceForRoute("opencode-go/hy3").currency, "CNY");
    assert.equal(priceForRoute("opencode-go/hy4-preview").key, "hy4-preview");
    // Google Gemini and Meta Muse (USD).
    assert.equal(priceForRoute("opencode-go/gemini-4-argon").vendor, "google");
    assert.equal(priceForRoute("opencode-go/gemini-4-argon-contributor").key, "gemini-4-argon");
    assert.equal(priceForRoute("opencode-go/muse-spark-1.3-contributor").vendor, "meta");
    assert.equal(priceForRoute("opencode-go/muse-wonder").key, "muse-wonder");
    // No verified vendor list → null (unpriced), never a reseller or fallback price.
    assert.equal(priceForRoute("opencode-go/mimo-v2.5"), null);
    assert.equal(priceForRoute("opencode-go/longcat-2.5-preview-free"), null);
    assert.equal(priceForRoute("opencode-go/muse-spark-1.2-contributor"), null);
    assert.equal(priceForRoute("opencode-go/kimi-k2.7-codex"), null);
    assert.equal(priceForRoute("anthropic/claude-opus-4.1"), null);
    assert.equal(priceForRoute("deepseek/deepseek-chat"), null);
  },
  "deepseek/zhipu/kimi/hy/gemini/muse official; mimo-v2.5/muse-1.2/claude-opus-4.1 unpriced",
);

check(
  "peak windows (Beijing weekday 9-12 / 14-18)",
  () => {
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 1, 0, 0), pricing), true, "09:00 peak");
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 3, 59, 0), pricing), true, "11:59 peak");
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 4, 0, 0), pricing), false, "12:00 off-peak");
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 6, 0, 0), pricing), true, "14:00 peak");
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 9, 59, 0), pricing), true, "17:59 peak");
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 10, 0, 0), pricing), false, "18:00 off-peak");
    assert.equal(isPeakTime(Date.UTC(2026, 10, 7, 2, 0, 0), pricing), false, "Saturday off-peak");
  },
  "09:00/11:59 peak, 12:00/18:00 off-peak, weekend off-peak",
);

check(
  "holidays billed off-peak",
  () => {
    const holidayPricing = createPricing({ holidays: ["2026-11-03"] });
    assert.equal(isPeakTime(Date.UTC(2026, 10, 3, 2, 0, 0), holidayPricing), false);
  },
  "2026-11-03 holiday → off-peak",
);

check(
  "DeepSeek official CNY list with peak / off-peak",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const offPeak = costOfUsage(usage, "opencode-go/deepseek-v4.1-flash", Date.UTC(2026, 10, 3, 14, 0, 0), pricing);
    const peak = costOfUsage(usage, "opencode-go/deepseek-v4.1-flash", Date.UTC(2026, 10, 3, 2, 0, 0), pricing);
    closeTo(offPeak.costCNY, 5.02);
    closeTo(peak.costCNY, 10.04);
    assert.equal(peak.price.multiplier, 2);
    assert.equal(peak.vendor, "deepseek");
    closeTo(costOfUsage(usage, "deepseek/deepseek-v4-pro", Date.UTC(2026, 10, 3, 14, 0, 0), pricing).costCNY, 18.15);
  },
  "flash off-peak ¥5.02 / peak ¥10.04 · v4-pro ¥18.15",
);

check(
  "Zhipu official CNY list (no FX, no peak)",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const cost = costOfUsage(usage, "opencode-go/glm-5.3-flash", Date.UTC(2026, 10, 3, 2, 0, 0), pricing);
    closeTo(cost.costCNY, 3.83, 1e-9);
    assert.equal(cost.priceLevel, "official");
    assert.equal(cost.vendor, "zhipu");
    assert.equal(cost.peak, false, "only DeepSeek has peak pricing");
    assert.equal(cost.price.currency, "CNY");
    assert.ok(cost.sourceUrl.includes("docs.bigmodel.cn"));
    // CNY rows ignore the USD rate entirely.
    const cheapUsd = createPricing({ usdRate: 3 });
    closeTo(costOfUsage(usage, "opencode-go/glm-5.3-flash", Date.UTC(2026, 10, 3, 2, 0, 0), cheapUsd).costCNY, 3.83, 1e-9);
  },
  "GLM-5.3-Flash ¥3.83 (0.23 + 0.8 + 2.8)",
);

check(
  "overseas vendor official USD lists converted at usdRate",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const offPeak = Date.UTC(2026, 10, 3, 14, 0, 0);
    const grok = costOfUsage(usage, "naapi-ds/grok-4.7", offPeak, pricing);
    const qwen = costOfUsage(usage, "opencode-go/qwen3.8-flash", offPeak, pricing);
    const gpt = costOfUsage(usage, "opencode-go/gpt-6-luna", offPeak, pricing);
    const claude = costOfUsage(usage, "opencode-go/claude-haiku-5-5", offPeak, pricing);
    closeTo(grok.costCNY, 60.35, 1e-6);
    closeTo(qwen.costCNY, 3.59473, 1e-6);
    closeTo(gpt.costCNY, 4.331, 1e-6);
    closeTo(claude.costCNY, 4.331, 1e-6);
    assert.equal(grok.price.currency, "USD");
    // USD rows do scale with the configured rate.
    const cheapUsd = createPricing({ usdRate: 5 });
    closeTo(costOfUsage(usage, "naapi-ds/grok-4.7", offPeak, cheapUsd).costCNY, 42.5, 1e-6);
  },
  "grok ¥60.35 / qwen ¥3.59473 / gpt+claude ¥4.331",
);

check(
  "Moonshot Kimi official CNY list + aliases",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const time = Date.UTC(2026, 10, 3, 14, 0, 0);
    closeTo(costOfUsage(usage, "opencode-go/kimi-k3", time, pricing).costCNY, 122, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/k3-256k", time, pricing).costCNY, 122, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/k3", time, pricing).costCNY, 122, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/kimi-k3.1-pro", time, pricing).costCNY, 82.3, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/kimi-k3.1-pro-highspeed", time, pricing).costCNY, 163.3, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/kimi-k2.7-code", time, pricing).costCNY, 34.8, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/kimi-k2.7-code-highspeed", time, pricing).costCNY, 69.6, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/kimi-k2.6", time, pricing).costCNY, 34.6, 1e-9);
    // kimi-for-coding aliases map to the same-generation pay-as-you-go list.
    closeTo(costOfUsage(usage, "kimi-coding/kimi-for-coding", time, pricing).costCNY, 34.8, 1e-9);
    closeTo(costOfUsage(usage, "kimi-coding/kimi-for-coding-highspeed", time, pricing).costCNY, 69.6, 1e-9);
    assert.equal(costOfUsage(usage, "opencode-go/kimi-k3", time, pricing).vendor, "moonshot");
    assert.ok(costOfUsage(usage, "opencode-go/kimi-k3", time, pricing).sourceUrl.includes("platform.kimi.com"));
  },
  "k3 ¥122 / k3.1-pro ¥82.3 / k2.7-code ¥34.8 / aliases",
);

check(
  "Tencent Hunyuan TokenHub CNY list",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const time = Date.UTC(2026, 10, 3, 14, 0, 0);
    closeTo(costOfUsage(usage, "opencode-go/hy3", time, pricing).costCNY, 5.25, 1e-9);
    closeTo(costOfUsage(usage, "opencode-go/hy4-preview", time, pricing).costCNY, 24.3, 1e-9);
    assert.equal(costOfUsage(usage, "opencode-go/hy3", time, pricing).vendor, "tencent");
    assert.ok(costOfUsage(usage, "opencode-go/hy3", time, pricing).sourceUrl.includes("cloud.tencent.com"));
  },
  "hy3 ¥5.25 / hy4-preview ¥24.3",
);

check(
  "Gemini 4 Argon price switch on 2026-12-01 (Beijing)",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const intro = Date.UTC(2026, 10, 30, 15, 59, 0); // 2026-11-30 23:59 Beijing
    const standard = Date.UTC(2026, 10, 30, 16, 0, 0); // 2026-12-01 00:00 Beijing
    closeTo(costOfUsage(usage, "opencode-go/gemini-4-argon", intro, pricing).costCNY, 85.91, 1e-6);
    closeTo(costOfUsage(usage, "opencode-go/gemini-4-argon", standard, pricing).costCNY, 171.82, 1e-6);
    closeTo(costOfUsage(usage, "opencode-go/gemini-4-argon-contributor", standard, pricing).costCNY, 171.82, 1e-6);
    assert.equal(costOfUsage(usage, "opencode-go/gemini-4-argon", intro, pricing).vendor, "google");
    // USD row: the configured rate still moves the amount.
    closeTo(costOfUsage(usage, "opencode-go/gemini-4-argon", intro, createPricing({ usdRate: 5 })).costCNY, 60.5, 1e-6);
  },
  "intro ¥85.91 → standard ¥171.82",
);

check(
  "Meta Muse official USD list",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const time = Date.UTC(2026, 10, 3, 14, 0, 0);
    closeTo(costOfUsage(usage, "opencode-go/muse-spark-1.3-contributor", time, pricing).costCNY, 40.115, 1e-6);
    closeTo(costOfUsage(usage, "opencode-go/muse-wonder", time, pricing).costCNY, 171.82, 1e-6);
    assert.equal(costOfUsage(usage, "opencode-go/muse-spark-1.3-contributor", time, pricing).vendor, "meta");
  },
  "muse-spark-1.3 ¥40.115 / muse-wonder ¥171.82",
);

check(
  "unverified vendor list → unpriced: 0 元, no guess",
  () => {
    const usage = { inputTokens: M, outputTokens: M, cacheReadTokens: M };
    const offPeak = Date.UTC(2026, 10, 3, 14, 0, 0);
    for (const route of [
      "opencode-go/mimo-v2.5",
      "opencode-go/longcat-2.5-preview-free",
      "opencode-go/muse-spark-1.2-contributor",
      "opencode-go/kimi-k2.7-codex",
      "anthropic/claude-opus-4.1",
      "unknown/whatever",
    ]) {
      const cost = costOfUsage(usage, route, offPeak, pricing);
      assert.equal(cost.costCNY, 0, route);
      assert.equal(cost.priced, false, route);
      assert.equal(cost.priceLevel, "unpriced", route);
      assert.equal(cost.priceKey, null, route);
      assert.equal(cost.sourceUrl, null, route);
      assert.equal(effectivePrice(route, offPeak, pricing).priced, false, route);
      assert.equal(effectivePrice(route, offPeak, pricing).input, 0, route);
    }
    // The vendor hint is display-only and still names the vendor.
    assert.equal(effectivePrice("opencode-go/mimo-v2.5", offPeak, pricing).vendor, "xiaomi");
    assert.equal(effectivePrice("opencode-go/kimi-k2.7-codex", offPeak, pricing).vendor, "moonshot");
  },
  "6 unpriced routes → ¥0 / priced:false / priceLevel:unpriced",
);

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
check(
  "token buckets: 24.6M total, disjoint sum",
  () => {
    assert.equal(overview.totals.tokens, 24.6 * M);
    assert.equal(overview.totals.input, 5 * M);
    assert.equal(overview.totals.output, 2.6 * M);
    assert.equal(overview.totals.cacheRead, 16 * M);
    assert.equal(overview.totals.cacheWrite, 1 * M);
    assert.equal(
      overview.totals.tokens,
      overview.totals.input + overview.totals.output + overview.totals.cacheRead + overview.totals.cacheWrite,
    );
  },
  `tokens=${overview.totals.tokens} input=${overview.totals.input} output=${overview.totals.output} cacheRead=${overview.totals.cacheRead}`,
);

check(
  "cost: ¥51.80 total (unpriced model excluded from the amount)",
  () => closeTo(overview.totals.costCNY, 51.8),
  `¥${overview.totals.costCNY}`,
);

check(
  "searchCost(): flat ¥0.005 per official search request",
  () => {
    assert.equal(SEARCH_REQUEST_PRICE_CNY, 0.005);
    assert.equal(searchCost(0), 0);
    assert.equal(searchCost(1), 0.005);
    assert.equal(searchCost(3), 0.015);
    assert.equal(searchCost(1000), 5);
    assert.equal(searchCost(-4), 0);
    assert.equal(searchCost(Number.NaN), 0);
  },
  "¥0.005 / request · ¥5 / 1000",
);

check(
  "official search: counted per event, flat cost, separate from token cost",
  () => {
    assert.equal(overview.totals.searches, 3);
    assert.equal(overview.totals.searchCostCNY, 0.015);
    closeTo(overview.totals.costCNY, 51.8);
    closeTo(overview.totals.costCNYTotal, 51.815);
    closeTo(overview.totals.costCNYWithSearch, 51.815);
    assert.equal(overview.daily.reduce((sum, day) => sum + day.searches, 0), 3);
    closeTo(overview.daily.reduce((sum, day) => sum + day.searchCostCNY, 0), 0.015);
    assert.deepEqual(overview.pricing.search, {
      unit: "per-request",
      priceCNY: 0.005,
      note: "¥5 / 1000 次成功请求",
    });
    // A tool/call web_search is NOT a billed unit and must not be counted.
    assert.equal(overview.totals.events, 4);
  },
  "searches=3 · ¥0.015 · total ¥51.815",
);

check(
  "official search row: tokens 0, costsOnly, cost share",
  () => {
    const row = overview.models.find((model) => model.route === "official/server-tool-search");
    assert.ok(row !== undefined, "synthetic search row must exist");
    assert.equal(row.label, "官方搜索");
    assert.equal(row.vendor, "deepseek");
    assert.equal(row.priceLevel, "official");
    assert.equal(row.tokens, 0);
    assert.equal(row.costsOnly, true);
    assert.equal(row.searches, 3);
    closeTo(row.costCNY, 0.015);
    closeTo(row.shareByCost, 0.015 / 51.815, 1e-6);
    // The synthetic row is not a priced model in the price-level counters.
    assert.deepEqual(overview.pricing.priceLevels, { official: 2, unpriced: 1 });
  },
  "official/server-tool-search · tokens=0 · ¥0.015",
);

check(
  "costComposition: cost shares over costCNYTotal, search slice grey",
  () => {
    const slices = overview.costComposition;
    assert.ok(Array.isArray(slices) && slices.length >= 2, "expected at least two cost slices");
    const sum = slices.reduce((total, slice) => total + slice.costCNY, 0);
    closeTo(sum, overview.totals.costCNYTotal, 1e-9);
    const shareSum = slices.reduce((total, slice) => total + slice.share, 0);
    closeTo(shareSum, 1, 1e-4);
    const searchSlice = slices.find((slice) => slice.route === "official/server-tool-search");
    assert.ok(searchSlice !== undefined, "search cost slice must exist");
    assert.equal(searchSlice.color, OTHER_MODEL_COLOR);
    closeTo(searchSlice.costCNY, 0.015);
    // Same model → same colour as the token donut.
    for (const slice of slices) {
      const model = overview.models.find((entry) => entry.route === slice.route);
      assert.ok(model !== undefined, `slice ${slice.route} must come from models[]`);
      assert.equal(slice.color, model.color, `${slice.route} colour must match models[].color`);
      assert.equal(slice.label, model.label);
      assert.equal(slice.vendor, model.vendor);
    }
    // Unpriced models cost 0 and are excluded from the cost donut.
    assert.equal(slices.some((slice) => slice.route === "anthropic/claude-opus-4.1"), false);
    // Sorted by cost, descending.
    for (let index = 1; index < slices.length; index += 1) {
      assert.ok(slices[index - 1].costCNY >= slices[index].costCNY, "slices sorted by cost");
    }
  },
  "slices sum to costCNYTotal · search grey · colours match models",
);

check(
  "costComposition handles a single model",
  () => {
    const single = summarizeSessionEvents("session-single", [events[0]], { pricing, now: NOW });
    const one = buildOverview([single], { windowKey: "7d", now: NOW, pricing, usdRate: DEFAULT_USD_RATE });
    assert.equal(one.costComposition.length, 1);
    assert.equal(one.costComposition[0].share, 1);
    closeTo(one.costComposition[0].costCNY, one.totals.costCNYTotal);
    // Empty corpus → empty array, never NaN.
    const empty = buildOverview([], { windowKey: "7d", now: NOW, pricing, usdRate: DEFAULT_USD_RATE });
    assert.deepEqual(empty.costComposition, []);
  },
  "1 slice / empty array",
);

check(
  "terminal: candles OHLC, empty-bar carry, symbols/indices/tape",
  () => {
    const terminal = overview.terminal;
    assert.ok(terminal !== null && typeof terminal === "object");
    const candles = terminal.candles;
    const spec = CANDLE_SPECS[overview.window.key];
    assert.equal(candles.period, spec.period);
    assert.equal(candles.bars.length, spec.bars);
    for (const bar of candles.bars) {
      assert.ok(bar.h >= Math.max(bar.o, bar.c) - 1e-9, "high >= max(open, close)");
      assert.ok(bar.l <= Math.min(bar.o, bar.c) + 1e-9, "low <= min(open, close)");
      if (bar.empty) {
        assert.equal(bar.vol, 0);
        assert.equal(bar.tokens, 0);
      }
    }
    // An empty bar carries the previous close forward.
    for (let index = 1; index < candles.bars.length; index += 1) {
      const bar = candles.bars[index];
      if (!bar.empty) continue;
      assert.equal(bar.o, candles.bars[index - 1].c);
      assert.equal(bar.c, candles.bars[index - 1].c);
    }
    // Symbols mirror models numbers and never invent prices.
    for (const symbol of terminal.symbols) {
      const model = overview.models.find((entry) => entry.route === symbol.route);
      assert.ok(model !== undefined, `symbol ${symbol.route} must come from models[]`);
      assert.equal(symbol.tokens, model.tokens);
      assert.equal(symbol.costCNY, model.costCNY);
      assert.equal(symbol.unpriced, model.priceLevel === "unpriced");
      assert.ok(symbol.code.startsWith("MDL-"));
    }
    // Five indices, change compared with the previous equal-length window.
    assert.deepEqual(terminal.indices.map((item) => item.key), ["tokens", "cost", "sessions", "cacheHit", "search"]);
    for (const item of terminal.indices) {
      assert.equal(item.spark.length, 12);
      assert.ok(item.chgPct === null || Number.isFinite(item.chgPct));
    }
    // Tape: newest first, at most 20, search entries marked.
    assert.ok(terminal.tape.length <= 20);
    for (let index = 1; index < terminal.tape.length; index += 1) {
      assert.ok(terminal.tape[index - 1].t >= terminal.tape[index].t, "tape is descending");
    }
    assert.ok(terminal.tape.some((entry) => entry.kind === "search"));
  },
  "288/168/30 bars · carry · 5 indices · tape desc",
);

check(
  "no search events → no synthetic row, zero search cost",
  () => {
    const usageOnly = events.filter((event) => !String(event.type).includes("search"));
    const plainAggregate = summarizeSessionEvents("session-no-search", usageOnly, { pricing, now: NOW });
    const plain = buildOverview([plainAggregate], { windowKey: "7d", now: NOW, pricing, usdRate: DEFAULT_USD_RATE });
    assert.equal(plain.totals.searches, 0);
    assert.equal(plain.totals.searchCostCNY, 0);
    assert.equal(plain.totals.costCNYTotal, plain.totals.costCNY);
    assert.equal(plain.models.some((model) => model.costsOnly === true), false);
  },
  "no row · ¥0",
);

check(
  "cache hit rate: 16M / 22M = 72.7%",
  () => {
    closeTo(overview.totals.cacheHitRate, 16 / 22);
    assert.equal(overview.totals.cacheHitRate, 0.727273);
  },
  `${(overview.totals.cacheHitRate * 100).toFixed(1)}%`,
);

check(
  "unpriced models are excluded from the amount and reported",
  () => {
    assert.equal(overview.totals.priced, false);
    assert.equal(overview.totals.unpricedTokens, 1.1 * M);
    assert.equal(overview.totals.unpricedModels, 1);
    closeTo(overview.totals.unpricedTokens / overview.totals.tokens, 1.1 / 24.6);
    assert.deepEqual(overview.pricing.priceLevels, { official: 2, unpriced: 1 });
  },
  `unpriced=${overview.totals.unpricedModels} tokens=${overview.totals.unpricedTokens}`,
);

check(
  "session count and per-session average",
  () => {
    assert.equal(overview.totals.sessions, 1);
    assert.equal(overview.totals.avgTokensPerSession, Math.round(24.6 * M));
  },
  `sessions=1 avg=${overview.totals.avgTokensPerSession}`,
);

check(
  "7 daily buckets, last bucket is today (11/3)",
  () => {
    assert.equal(overview.daily.length, 7);
    assert.equal(overview.daily[6].label, "11/3");
    assert.equal(overview.daily[6].tokens, 15 * M);
    assert.equal(overview.daily[5].label, "11/2");
    assert.equal(overview.daily[5].tokens, 9.6 * M);
  },
  overview.daily.map((day) => `${day.label}:${Math.round(day.tokens / M * 10) / 10}M`).join(" "),
);

check(
  "daily buckets sum to the window totals",
  () => {
    const sum = overview.daily.reduce((total, day) => total + day.tokens, 0);
    assert.equal(sum, overview.totals.tokens);
    const cost = overview.daily.reduce((total, day) => total + day.costCNY, 0);
    closeTo(cost, overview.totals.costCNY, 1e-5);
  },
  "sum(daily) == totals",
);

check(
  "model shares: flash 20.5M, pro 3M, unpriced 1.1M",
  () => {
    const byRoute = new Map(overview.models.map((model) => [model.route, model]));
    assert.equal(byRoute.get("opencode-go/deepseek-v4.1-flash").tokens, 20.5 * M);
    assert.equal(byRoute.get("deepseek/deepseek-v4-pro").tokens, 3 * M);
    const unpriced = byRoute.get("anthropic/claude-opus-4.1");
    assert.equal(unpriced.tokens, 1.1 * M);
    assert.equal(unpriced.priced, false);
    assert.equal(unpriced.priceLevel, "unpriced");
    assert.equal(unpriced.vendor, "anthropic", "vendor hint survives unpriced");
    assert.equal(unpriced.costCNY, 0);
    assert.equal(unpriced.sourceUrl, null);
    assert.equal(overview.models[0].route, "opencode-go/deepseek-v4.1-flash");
    closeTo(overview.models[0].share, 20.5 / 24.6);
  },
  overview.models.map((model) => `${model.label}:${Math.round((model.share ?? 0) * 1000) / 10}%`).join(" "),
);

check(
  "models carry labels and unique palette colors in first-seen order",
  () => {
    assert.equal(overview.modelPalette.length, 10);
    assert.equal(overview.modelPalette[0], "#12b886");
    assert.equal(overview.otherModelColor, OTHER_MODEL_COLOR);
    assert.deepEqual(overview.modelPalette, [...MODEL_PALETTE]);
    // The synthetic search row is cost-only and uses the neutral colour.
    const tokenModels = overview.models.filter((model) => model.costsOnly !== true);
    const colors = tokenModels.map((model) => model.color);
    assert.equal(new Set(colors).size, colors.length, "colors are unique per model");
    for (const model of tokenModels) {
      assert.ok(overview.modelPalette.includes(model.color), `${model.route} color is from the palette`);
      assert.ok(typeof model.label === "string" && model.label.length > 0);
      assert.ok(!model.label.includes("/"), "label is the model name, not the route");
    }
    // First appearance inside the window decides the palette slot.
    const byRoute = new Map(overview.models.map((model) => [model.route, model]));
    assert.equal(byRoute.get("anthropic/claude-opus-4.1").color, "#12b886");
    assert.equal(byRoute.get("opencode-go/deepseek-v4.1-flash").color, "#4dabf7");
    assert.equal(byRoute.get("deepseek/deepseek-v4-pro").color, "#9775fa");
  },
  overview.models.map((model) => `${model.label}=${model.color}`).join(" "),
);

check(
  "colors are stable across rebuilds",
  () => {
    const rebuilt = buildOverview([aggregate], { windowKey: "7d", now: NOW, pricing, usdRate: DEFAULT_USD_RATE });
    const first = new Map(overview.models.map((model) => [model.route, model.color]));
    const second = new Map(rebuilt.models.map((model) => [model.route, model.color]));
    assert.deepEqual([...first.entries()].sort(), [...second.entries()].sort());
  },
  "same route → same color",
);

check(
  "daily buckets expose per-model segments that sum to the day total",
  () => {
    for (const day of overview.daily) {
      assert.ok(Array.isArray(day.models), `${day.label} has models`);
      const sum = day.models.reduce((total, model) => total + model.tokens, 0);
      assert.equal(sum, day.tokens, `${day.label} model tokens must sum to the day total`);
      for (const model of day.models) {
        assert.ok(typeof model.route === "string" && model.route.length > 0);
        assert.ok(typeof model.label === "string" && model.label.length > 0);
        assert.ok(typeof model.color === "string");
        assert.ok(typeof model.costCNY === "number");
        assert.ok(typeof model.share === "number");
      }
      for (let index = 1; index < day.models.length; index += 1) {
        assert.ok(day.models[index - 1].tokens >= day.models[index].tokens, "daily models are tokens-desc");
      }
    }
    assert.equal(overview.daily[6].models.length, 2);
    assert.equal(overview.daily[6].models[0].route, "opencode-go/deepseek-v4.1-flash");
    assert.equal(overview.daily[6].models[0].tokens, 12 * M);
    assert.equal(overview.daily[5].models.length, 2);
    assert.equal(overview.daily[0].models.length, 0, "empty days carry an empty segment list");
  },
  overview.daily.map((day) => `${day.label}:${day.models.length} models`).join(" "),
);

check(
  "composition covers cacheRead/input/output/cacheWrite",
  () => {
    const byKey = new Map(overview.composition.map((part) => [part.key, part.tokens]));
    assert.equal(byKey.get("cacheRead"), 16 * M);
    assert.equal(byKey.get("input"), 5 * M);
    assert.equal(byKey.get("output"), 2.6 * M);
    assert.equal(byKey.get("cacheWrite"), 1 * M);
  },
  overview.composition.map((part) => `${part.key}:${Math.round(part.tokens / M * 10) / 10}M`).join(" "),
);

check(
  "peak/off-peak event split is mixed",
  () => {
    assert.equal(overview.pricing.peakEvents, 2);
    assert.equal(overview.pricing.offPeakEvents, 2);
    assert.equal(overview.pricing.mode, "mixed");
  },
  `peak=2 offPeak=2 mode=mixed`,
);

check(
  "USD is derived from authoritative CNY at the configured rate",
  () => {
    closeTo(overview.totals.costUSD, overview.totals.costCNY / DEFAULT_USD_RATE, 1e-5);
    assert.equal(overview.currency.code, "CNY");
    assert.equal(overview.currency.usdRate, DEFAULT_USD_RATE);
  },
  `¥${overview.totals.costCNY} → $${overview.totals.costUSD}`,
);

check(
  "24h window only keeps the last 24 Beijing hours",
  () => {
    const short = buildOverview([aggregate], { windowKey: "24h", now: NOW, pricing, usdRate: DEFAULT_USD_RATE });
    assert.equal(short.window.granularity, "hour");
    assert.equal(short.window.bucketCount, 24);
    assert.equal(short.daily[short.daily.length - 1].label, "22:00");
    assert.equal(short.totals.tokens, 15 * M);
    closeTo(short.totals.costCNY, 46.7);
  },
  `24h tokens=${15 * M} cost=¥46.7`,
);

check(
  "unknown window falls back to 7d",
  () => {
    const fallback = buildOverview([aggregate], { windowKey: "nonsense", now: NOW, pricing });
    assert.equal(fallback.window.key, "7d");
  },
  "fallback=7d",
);

check(
  "day index is Beijing-aligned",
  () => {
    assert.equal(dayIndexOf(Date.UTC(2026, 10, 2, 16, 0, 0)), dayIndexOf(Date.UTC(2026, 10, 3, 2, 0, 0)));
    assert.equal(resolveWindow("7d", NOW).buckets.length, 7);
  },
  "Beijing 00:00 and 10:00 share one day bucket",
);

check(
  "uptime text",
  () => {
    assert.equal(formatUptime(29 * 60), "29m");
    assert.equal(formatUptime(42), "42s");
    assert.equal(formatUptime(3 * 3600 + 5 * 60), "3h 05m");
  },
  "29m / 42s / 3h 05m",
);

check(
  "config normalization clamps and defaults",
  () => {
    const config = normalizeConfig({ usdRate: 0, ttlMs: -5, window: "bogus", livePoints: 2 });
    assert.equal(config.usdRate, 0.01);
    assert.equal(config.ttlMs, 0);
    assert.equal(config.window, "7d");
    assert.equal(config.livePoints, 6);
    assert.equal(normalizeConfig(undefined).usdRate, 7.1);
  },
  "clamped",
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Loader id must not collide with an official bundle entry
// ---------------------------------------------------------------------------
// The loader keys bundle entries by `id`, and a later patch overwrites an
// earlier one. The official @deepseek-ai/dsh-session-stats already claims
// `id: session-stats`; reusing it silently unmounts the official
// `sessionStats` projection. Guard the id so a future edit cannot regress.
check("cordis.patch.yml keeps a non-colliding loader id", () => {
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  const ids = [...patch.matchAll(/^\s*-?\s*id:\s*([A-Za-z0-9_.-]+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["session-stats-panel"]);
});

// ---------------------------------------------------------------------------
// Cross-machine behaviour: time zone and platform, not just this laptop
// ---------------------------------------------------------------------------
check("zoneOffsetMs follows real IANA zones (not a hard-coded +8)", () => {
  const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
  const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
  assert.equal(zoneOffsetMs("Asia/Shanghai", winter), 8 * 3600_000);
  assert.equal(zoneOffsetMs("Asia/Kolkata", winter), 5.5 * 3600_000);
  assert.equal(zoneOffsetMs("UTC", winter), 0);
  assert.equal(zoneOffsetMs("Europe/Berlin", winter), 1 * 3600_000);
  assert.equal(zoneOffsetMs("Europe/Berlin", summer), 2 * 3600_000, "DST");
  assert.equal(zoneOffsetMs("America/New_York", winter), -5 * 3600_000);
  assert.equal(zoneOffsetMs("Not/AZone", winter), 8 * 3600_000, "falls back to Asia/Shanghai");
});

check("resolveWindow shifts day boundaries with the viewer's zone", () => {
  const now = Date.UTC(2026, 10, 5, 4, 0, 0); // 12:00 Beijing
  const sh = resolveWindow("7d", now, zoneOffsetMs("Asia/Shanghai", now));
  const ny = resolveWindow("7d", now, zoneOffsetMs("America/New_York", now));
  assert.equal(sh.buckets.length, 7);
  assert.equal(ny.buckets.length, 7);
  assert.notEqual(sh.from, ny.from, "different zones must not share a window start");
  // Every bucket must be exactly one day wide regardless of the offset.
  for (const w of [sh, ny]) {
    for (const bucket of w.buckets) assert.equal(bucket.end - bucket.start, 86400_000);
  }
});

check("dayIndexOf honours an explicit offset", () => {
  const t = Date.UTC(2026, 10, 5, 20, 0, 0); // 04:00 next day in Beijing, 20:00 same day UTC
  assert.equal(dayIndexOf(t, 8 * 3600_000) - dayIndexOf(t, 0), 1);
});

// ---------------------------------------------------------------------------
// Chinese statutory holidays (国办发明电〔2025〕7号) drive peak/off-peak
// ---------------------------------------------------------------------------
const at2026 = (month, day, hour, minute = 0) =>
  Date.parse(`2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);

check("2026 holiday calendar matches the State Council notice", () => {
  assert.equal(CN_HOLIDAYS_2026.length, 33, "1+9+3+5+3+3+7 days");
  assert.ok(CN_HOLIDAYS_2026.includes("2026-02-16"));
  assert.ok(CN_HOLIDAYS_2026.includes("2026-10-05"));
  assert.ok(!CN_HOLIDAYS_2026.includes("2026-02-14"), "a make-up workday is not a holiday");
  assert.equal(CN_MAKEUP_WORKDAYS_2026.length, 6);
});

check("peak pricing uses the built-in calendar by default", () => {
  const pricing = createPricing({ usdRate: 7.1 });
  assert.equal(pricing.holidays.size, 33);
  assert.equal(pricing.makeupWorkdays.size, 6);
  // A weekday inside Spring Festival is billed off-peak.
  assert.equal(isPeakTime(at2026(2, 16, 10), pricing), false, "春节周一");
  // A make-up Saturday is billed peak again.
  assert.equal(isPeakTime(at2026(2, 14, 10), pricing), true, "春节调休周六");
  assert.equal(isPeakTime(at2026(10, 10, 10), pricing), true, "国庆调休周六");
  // An ordinary working weekday still peaks; lunch break does not.
  assert.equal(isPeakTime(at2026(3, 2, 10), pricing), true);
  assert.equal(isPeakTime(at2026(3, 2, 13), pricing), false);
  assert.equal(isPeakTime(at2026(3, 7, 10), pricing), false, "ordinary Saturday");
});

check("an explicit holidays list overrides the built-in calendar", () => {
  const empty = createPricing({ holidays: [], makeupWorkdays: [] });
  assert.equal(empty.holidays.size, 0);
  // With no holidays the Spring Festival weekday peaks again.
  assert.equal(isPeakTime(at2026(2, 16, 10), empty), true);
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
  console.error(`selfcheck: ${failures} failure(s) out of ${results.length} checks`);
  process.exit(1);
}
console.log(`selfcheck: all ${results.length} checks passed`);

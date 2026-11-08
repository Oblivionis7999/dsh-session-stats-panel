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
  DAY_MS,
  DEFAULT_USD_RATE,
  HEATMAP_DAYS,
  LEADERBOARD_LIMIT,
  MAX_BUCKET_AGE_MS,
  MAX_DAILY_AGE_MS,
  MAX_TOOL_DURATION_MS,
  MODEL_PALETTE,
  OTHER_MODEL_COLOR,
  PROMPT_PREVIEW_CHARS,
  SESSION_TITLE_FROM_PROMPT_CHARS,
  UNTITLED_TITLE,
  buildCommandLeaderboard,
  buildHeatmap,
  buildOverview,
  buildSessionList,
  buildSkillLeaderboard,
  buildToolLeaderboard,
  commandProgramOf,
  computeForecast,
  dayIndexOf,
  hourIndexOf,
  pruneSessionAggregate,
  resolveWindow,
  summarizeSessionEvents,
  windowBucketIndexOf,
  zoneOffsetMs,
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
  "K-line removed: overview carries no terminal/candles/indices/symbols/tape",
  () => {
    assert.equal(Object.hasOwn(overview, "terminal"), false, "overview.terminal must be gone");
    assert.equal(overview.terminal, undefined);
    // Reverse guard: the deleted sub-payloads must not reappear under another name.
    const serialized = JSON.stringify(overview);
    for (const key of ["candles", "indices", "symbols", "tape"]) {
      assert.equal(serialized.includes(`"${key}"`), false, `${key} must not appear in the payload`);
    }
  },
  "no terminal · no candle/tape keys",
);

check(
  "K-line removed: session aggregate keeps hourly buckets only",
  () => {
    const shape = summarizeSessionEvents("session-shape", events, { pricing, now: NOW });
    // Exact key set: re-adding minutes/quarters/tape (or another K-line bucket) fails.
    assert.deepEqual(Object.keys(shape).sort(), [
      "cacheRead",
      "cacheWrite",
      "commandDaily",
      "costCNY",
      "createdAt",
      "dailyActivity",
      "events",
      "firstTime",
      "hours",
      "input",
      "isSubagent",
      "lastEventTime",
      "lastPrompt",
      "lastTime",
      "searches",
      "sessionId",
      "skillDaily",
      "steps",
      "title",
      "tokens",
      "toolDaily",
      "turns",
      "workspace",
    ]);
    assert.ok(shape.hours instanceof Map);
    for (const key of ["minutes", "quarters", "tape"]) {
      assert.equal(Object.hasOwn(shape, key), false, `aggregate.${key} must be gone`);
    }
  },
  "hours only · no minutes/quarters/tape",
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
// Heavy data layer: metadata, shell programs, heatmap, leaderboards, sessions
// ---------------------------------------------------------------------------
const RICH_NOW = Date.UTC(2026, 10, 8, 4, 0, 0); // Beijing 2026-11-08 12:00
const ZONE = 8 * HOUR;

/** Build one user message event with an explicit source kind. */
function userMessageEvent({ seq, time, kind, text }) {
  return { type: "user/message", seq, time, data: { source: { kind }, content: [{ type: "text", text }] } };
}

/** Build one tool call event; the host always serializes arguments as a string. */
function toolCallEvent({ seq, time, name, args, callId }) {
  const data = { name, arguments: JSON.stringify(args) };
  if (typeof callId === "string") data.callId = callId;
  return { type: "tool/call", seq, time, data };
}

check(
  "commandProgramOf strips cd/VAR/export prologues and assignment noise",
  () => {
    assert.equal(commandProgramOf('cd "E:/Program Files/x" && python a.py'), "python");
    assert.equal(commandProgramOf("FOO=1 BAR=2 node app.js"), "node");
    assert.equal(commandProgramOf('export PATH="/e/bin" && grep -r x'), "grep");
    assert.equal(commandProgramOf("cd /e/foo; ls -la"), "ls");
    assert.equal(commandProgramOf("cd /e/foo"), "cd");
    assert.equal(commandProgramOf("$ErrorActionPreference='SilentlyContinue'"), "");
    assert.equal(commandProgramOf("P=\"E:/Program Files\""), "");
    assert.equal(commandProgramOf(""), "");
    assert.equal(commandProgramOf(undefined), "");
  },
  "python/node/grep/ls · assignments skipped",
);

const richEvents = [
  { type: "session/title", seq: 1, time: RICH_NOW - 10 * HOUR, data: { title: "旧标题" } },
  { type: "session/title", seq: 2, time: RICH_NOW - 9 * HOUR, data: { title: "新标题" } },
  userMessageEvent({ seq: 3, time: RICH_NOW - 8 * HOUR, kind: "time-context", text: "注入的时间上下文" }),
  userMessageEvent({ seq: 4, time: RICH_NOW - 7 * HOUR, kind: "user", text: "第一个问题" }),
  userMessageEvent({ seq: 5, time: RICH_NOW - 6 * HOUR, kind: "progress-updates-nudge", text: "注入的进度提醒" }),
  userMessageEvent({ seq: 6, time: RICH_NOW - 5 * HOUR, kind: "agent-message", text: "第二个问题" }),
  { type: "turn/start", seq: 7, time: RICH_NOW - 4.8 * HOUR, data: { turn: 1 } },
  { type: "turn/start", seq: 8, time: RICH_NOW - 4.6 * HOUR, data: { turn: 2 } },
  { type: "turn/start", seq: 9, time: RICH_NOW - 4.4 * HOUR, data: { turn: 3 } },
  { type: "step/start", seq: 10, time: RICH_NOW - 4.3 * HOUR, data: {} },
  { type: "step/start", seq: 11, time: RICH_NOW - 4.25 * HOUR, data: {} },
  toolCallEvent({ seq: 12, time: RICH_NOW - 4 * HOUR, name: "win_bash", args: { command: 'cd "E:/Program Files/x" && python a.py' }, callId: "rich-wb-1" }),
  toolCallEvent({ seq: 13, time: RICH_NOW - 3.9 * HOUR, name: "win_bash", args: { command: "FOO=1 node app.js" } }),
  toolCallEvent({ seq: 14, time: RICH_NOW - 3.8 * HOUR, name: "pwsh", args: { command: 'powershell -Command "Get-Item x"' }, callId: "rich-pwsh-1" }),
  toolCallEvent({ seq: 15, time: RICH_NOW - 3.7 * HOUR, name: "win_bash", args: { command: '$env:PYTHONIOENCODING="utf-8"' } }),
  { type: "tool/call", seq: 16, time: RICH_NOW - 3.6 * HOUR, data: { name: "win_bash", arguments: "{broken json" } },
  toolCallEvent({ seq: 17, time: RICH_NOW - 3.5 * HOUR, name: "skill", args: { name: "grilling" } }),
  messageEvent({ seq: 18, time: RICH_NOW - 3 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0, cacheRead: 1 * M }),
  { type: "tool/result", seq: 19, time: RICH_NOW - 4 * HOUR + 100, data: { message: { toolCallId: "rich-wb-1" } } },
  { type: "tool/result", seq: 20, time: RICH_NOW - 3.8 * HOUR + 250, data: { message: { toolCallId: "rich-pwsh-1", isError: true } } },
];

const rich = summarizeSessionEvents("session-rich", richEvents, {
  createdAt: RICH_NOW - 30 * 24 * HOUR,
  pricing,
  now: RICH_NOW,
  zoneOffset: ZONE,
  workspace: "E:/FILES FOR DSH/dsh-session-stats-panel",
  isSubagent: true,
});

check(
  "rich aggregate: last title, filtered prompt, turns/steps, per-day activity",
  () => {
    assert.equal(rich.title, "新标题");
    assert.equal(rich.lastPrompt, "第二个问题", "runtime injections must be ignored");
    assert.equal(rich.turns, 3);
    assert.equal(rich.steps, 2);
    assert.equal(rich.workspace, "E:/FILES FOR DSH/dsh-session-stats-panel");
    assert.equal(rich.isSubagent, true);
    assert.equal(rich.tokens, 2 * M);
    assert.equal(rich.input, 1 * M);
    assert.equal(rich.cacheRead, 1 * M);
    const day = rich.dailyActivity.get(dayIndexOf(RICH_NOW, ZONE));
    assert.equal(day.tokens, 2 * M);
    assert.equal(day.turns, 3);
  },
  `title=${rich.title} turns=${rich.turns} steps=${rich.steps} prompt=${rich.lastPrompt}`,
);

check(
  "rich aggregate: tool / shell program / skill buckets",
  () => {
    assert.deepEqual(buildToolLeaderboard([rich]).map((row) => [row.name, row.count, row.lastCalledAt]), [
      ["win_bash", 4, RICH_NOW - 3.6 * HOUR],
      ["pwsh", 1, RICH_NOW - 3.8 * HOUR],
      ["skill", 1, RICH_NOW - 3.5 * HOUR],
    ]);
    assert.deepEqual(buildCommandLeaderboard([rich]).map((row) => [row.program, row.count]), [
      ["node", 1],
      ["powershell", 1],
      ["python", 1],
    ]);
    assert.deepEqual(buildSkillLeaderboard([rich]), [{ name: "grilling", count: 1, lastCalledAt: RICH_NOW - 3.5 * HOUR }]);
    // Malformed arguments and `$`-assignment commands are skipped, not ranked.
    assert.equal(buildCommandLeaderboard([rich]).some((row) => row.program.startsWith("$")), false);
    // IDEA-05: only calls with a paired result contribute to success/avg.
    const toolRows = new Map(buildToolLeaderboard([rich]).map((row) => [row.name, row]));
    assert.equal(toolRows.get("win_bash").errorCount, 0);
    assert.equal(toolRows.get("win_bash").successRate, 1);
    assert.equal(toolRows.get("win_bash").avgMs, 100);
    assert.equal(toolRows.get("pwsh").errorCount, 1);
    assert.equal(toolRows.get("pwsh").successRate, 0);
    assert.equal(toolRows.get("pwsh").avgMs, 250);
    // Calls without a result are unknown, never failures.
    assert.equal(toolRows.get("skill").successRate, null);
    assert.equal(toolRows.get("skill").avgMs, null);
  },
  `tools=${buildToolLeaderboard([rich]).length} programs=${buildCommandLeaderboard([rich]).length}`,
);

check(
  "tool success metrics: pairing, fallback callId, error count, 1h clamp, unmatched ignored",
  () => {
    const base = RICH_NOW - 6 * HOUR;
    const paired = summarizeSessionEvents(
      "session-paired",
      [
        toolCallEvent({ seq: 1, time: base, name: "read", args: {}, callId: "pair-1" }),
        toolCallEvent({ seq: 2, time: base + HOUR, name: "read", args: {}, callId: "pair-2" }),
        toolCallEvent({ seq: 3, time: base + 2 * HOUR, name: "edit", args: {}, callId: "pair-3" }),
        toolCallEvent({ seq: 4, time: base + 3 * HOUR, name: "write", args: {}, callId: "pair-4" }),
        toolCallEvent({ seq: 5, time: base + 4 * HOUR, name: "grep", args: {}, callId: "pair-5" }),
        // Successful result: absence of isError means success.
        { type: "tool/result", seq: 6, time: base + 100, data: { message: { toolCallId: "pair-1" } } },
        // Failure paired through the `message.source.callId` fallback key.
        { type: "tool/result", seq: 7, time: base + HOUR + 300, data: { message: { source: { callId: "pair-2" }, isError: true } } },
        // 334 s-style outlier clamps to one hour.
        { type: "tool/result", seq: 8, time: base + 2 * HOUR + 334_192_149, data: { message: { toolCallId: "pair-3" } } },
        // Result before the call clamps to zero, never negative.
        { type: "tool/result", seq: 9, time: base + 4 * HOUR - 5_000, data: { message: { toolCallId: "pair-5" } } },
        // Dangling result is ignored entirely.
        { type: "tool/result", seq: 10, time: base + 5 * HOUR, data: { message: { toolCallId: "missing", isError: true } } },
      ],
      { now: RICH_NOW, zoneOffset: ZONE },
    );
    const rows = new Map(buildToolLeaderboard([paired]).map((row) => [row.name, row]));
    assert.deepEqual(Object.keys(rows.get("read")).sort(), ["avgMs", "count", "errorCount", "lastCalledAt", "name", "successRate"]);
    assert.equal(rows.get("read").count, 2);
    assert.equal(rows.get("read").errorCount, 1);
    assert.equal(rows.get("read").successRate, 0.5);
    assert.equal(rows.get("read").avgMs, 200, "(100 + 300) / 2");
    assert.equal(rows.get("read").lastCalledAt, base + HOUR);
    assert.equal(rows.get("edit").errorCount, 0);
    assert.equal(rows.get("edit").avgMs, MAX_TOOL_DURATION_MS, "outlier clamps to one hour");
    assert.equal(rows.get("edit").successRate, 1);
    assert.equal(rows.get("write").successRate, null, "no paired result means unknown");
    assert.equal(rows.get("write").avgMs, null);
    assert.equal(rows.get("grep").avgMs, 0, "negative duration clamps to zero");
    assert.equal(rows.get("grep").successRate, 1);
  },
  "pairing · fallback key · clamp · unmatched ignored",
);

check(
  "buildHeatmap: 56 dense days, oldest→newest, sessions counted per session",
  () => {
    const other = summarizeSessionEvents(
      "session-other",
      [
        messageEvent({ seq: 1, time: RICH_NOW - 24 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 1 * M, output: 0 }),
        { type: "turn/start", seq: 2, time: RICH_NOW - 24 * HOUR, data: {} },
      ],
      { now: RICH_NOW, zoneOffset: ZONE },
    );
    const series = buildHeatmap([rich, other], "Asia/Shanghai", RICH_NOW);
    assert.equal(series.length, HEATMAP_DAYS);
    assert.equal(series[HEATMAP_DAYS - 1].date, "2026-11-08");
    assert.equal(series[0].date, "2026-09-14");
    assert.deepEqual(series[HEATMAP_DAYS - 1], { date: "2026-11-08", tokens: 2 * M, turns: 3, sessions: 1 });
    assert.deepEqual(series[HEATMAP_DAYS - 2], { date: "2026-11-07", tokens: 1 * M, turns: 1, sessions: 1 });
    assert.equal(series[0].tokens, 0, "empty days are present with zeroes");
    assert.equal(series[0].sessions, 0);
  },
  seriesText(buildHeatmap([rich], "Asia/Shanghai", RICH_NOW)),
);

/** Compact heatmap summary for the printable result line. */
function seriesText(series) {
  return `${series.length} days, last=${series[series.length - 1].date}:${series[series.length - 1].tokens}`;
}

check(
  "leaderboards: Top 20 cap, count-desc, day-range filter is real",
  () => {
    const crowd = [];
    for (let index = 0; index < 25; index += 1) {
      const count = index + 1;
      for (let n = 0; n < count; n += 1) {
        crowd.push(toolCallEvent({ seq: index * 100 + n, time: RICH_NOW - HOUR, name: `tool-${String(index).padStart(2, "0")}`, args: {} }));
      }
    }
    const wide = summarizeSessionEvents("session-wide", crowd, { now: RICH_NOW, zoneOffset: ZONE });
    const today = dayIndexOf(RICH_NOW, ZONE);
    const rows = buildToolLeaderboard([wide], { startDay: today - 7, endDay: today });
    assert.equal(rows.length, LEADERBOARD_LIMIT);
    assert.equal(rows[0].name, "tool-24");
    assert.equal(rows[0].count, 25);
    assert.equal(rows[LEADERBOARD_LIMIT - 1].count, 6);
    for (let index = 1; index < rows.length; index += 1) {
      assert.ok(rows[index - 1].count >= rows[index].count, "leaderboard is count-desc");
    }
    // A window that does not cover the call day must return nothing.
    assert.deepEqual(buildToolLeaderboard([wide], { startDay: today + 1, endDay: today + 5 }), []);
  },
  "25 tools → Top 20, day filter",
);

check(
  "buildSessionList: newest first, frozen fields, prompt cap, untitled fallback",
  () => {
    const chatty = summarizeSessionEvents(
      "session-chatty",
      [
        userMessageEvent({ seq: 1, time: RICH_NOW - 2 * HOUR, kind: "user", text: "x".repeat(200) }),
        messageEvent({ seq: 2, time: RICH_NOW - 2 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 1 * M, output: 0 }),
      ],
      { now: RICH_NOW, zoneOffset: ZONE, workspace: "C:/tmp" },
    );
    const list = buildSessionList([rich, chatty]);
    assert.equal(list.length, 2);
    const newest = list[0];
    const older = list[1];
    assert.equal(newest.id, "session-chatty");
    assert.equal(newest.title, "x".repeat(SESSION_TITLE_FROM_PROMPT_CHARS), "prompt fallback title (24 chars)");
    assert.equal(newest.lastPrompt.length, PROMPT_PREVIEW_CHARS);
    assert.equal(newest.isSubagent, false);
    assert.equal(newest.isArchived, false);
    assert.equal(newest.workspace, "C:/tmp");
    assert.equal(older.id, "session-rich");
    assert.equal(older.title, "新标题");
    assert.equal(older.lastPrompt, "第二个问题");
    assert.equal(older.turns, 3);
    assert.equal(older.steps, 2);
    assert.equal(older.isSubagent, true);
    assert.equal(older.cacheHitRate, 0.5);
    assert.deepEqual(Object.keys(older).sort(), [
      "cacheHitRate",
      "costCNY",
      "createdAt",
      "id",
      "isArchived",
      "isSubagent",
      "lastActiveAt",
      "lastPrompt",
      "steps",
      "title",
      "tokens",
      "turns",
      "workspace",
    ]);
    // F2: any event keeps a session listed — usage is not required.
    const silent = summarizeSessionEvents("session-silent", [{ type: "step/start", seq: 1, time: RICH_NOW, data: {} }], { now: RICH_NOW });
    const quietRows = buildSessionList([silent]);
    assert.equal(quietRows.length, 1, "a step-only session must still be listed");
    assert.equal(quietRows[0].tokens, 0);
    assert.equal(quietRows[0].lastActiveAt, RICH_NOW);
  },
  "2 sessions · untitled · 80 char prompt",
);

check(
  "pruneSessionAggregate keeps 60 days of activity and 31 days of tool days",
  () => {
    const pruned = summarizeSessionEvents(
      "session-prune",
      [toolCallEvent({ seq: 1, time: RICH_NOW - HOUR, name: "win_bash", args: { command: "node x.js" } })],
      { now: RICH_NOW, zoneOffset: ZONE },
    );
    const activityCutoff = dayIndexOf(RICH_NOW - MAX_DAILY_AGE_MS, ZONE);
    const leaderboardCutoff = dayIndexOf(RICH_NOW - MAX_BUCKET_AGE_MS, ZONE);
    pruned.dailyActivity.set(activityCutoff - 1, { tokens: 5, turns: 1 });
    pruned.dailyActivity.set(activityCutoff + 1, { tokens: 4, turns: 1 });
    pruned.toolDaily.set(leaderboardCutoff - 1, new Map([["old", { count: 1, lastCalledAt: 1 }]]));
    pruneSessionAggregate(pruned, RICH_NOW, ZONE);
    assert.equal(pruned.dailyActivity.has(activityCutoff - 1), false, "activity older than 60 days is dropped");
    assert.equal(pruned.dailyActivity.has(activityCutoff + 1), true, "recent activity survives");
    assert.equal(pruned.toolDaily.has(leaderboardCutoff - 1), false, "tool days older than 31 days are dropped");
    assert.equal(pruned.toolDaily.has(dayIndexOf(RICH_NOW, ZONE)), true);
  },
  "60d activity / 31d tool days",
);

// ---------------------------------------------------------------------------
// IDEA-04 today / yesterday snapshots
// ---------------------------------------------------------------------------
const SNAP_NOW = Date.UTC(2026, 10, 8, 4, 0, 0); // Beijing 2026-11-08 12:00
const SNAP_ZONE = 8 * HOUR;
const snapTodayAgg = summarizeSessionEvents(
  "snap-today",
  [messageEvent({ seq: 1, time: SNAP_NOW - 2 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0, cacheRead: 1 * M })],
  { now: SNAP_NOW, zoneOffset: SNAP_ZONE },
);
const snapYesterdayAgg = summarizeSessionEvents(
  "snap-yesterday",
  [messageEvent({ seq: 1, time: SNAP_NOW - 24 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 2 * M, output: 0 })],
  { now: SNAP_NOW, zoneOffset: SNAP_ZONE },
);
const snapOverview = buildOverview([snapTodayAgg, snapYesterdayAgg], {
  windowKey: "7d",
  now: SNAP_NOW,
  pricing,
  timeZone: "Asia/Shanghai",
  usdRate: DEFAULT_USD_RATE,
});

check(
  "overview: today/yesterday snapshots mirror the daily buckets",
  () => {
    assert.deepEqual(Object.keys(snapOverview.today).sort(), ["cacheHitRate", "costCNY", "sessions", "tokens"]);
    assert.equal(snapOverview.today.tokens, 2 * M);
    assert.equal(snapOverview.today.sessions, 1);
    assert.equal(snapOverview.today.cacheHitRate, 0.5);
    assert.equal(snapOverview.yesterday.tokens, 2 * M);
    assert.equal(snapOverview.yesterday.sessions, 1);
    assert.equal(snapOverview.yesterday.cacheHitRate, 0);
    closeTo(snapOverview.today.costCNY, snapOverview.daily[6].costCNY, 1e-9);
    closeTo(snapOverview.yesterday.costCNY, snapOverview.daily[5].costCNY, 1e-9);
    // Snapshot cost is the model-cost field, not the search-inclusive total.
    assert.ok(snapOverview.today.costCNY <= snapOverview.totals.costCNYTotal + 1e-9);
  },
  `today=${snapOverview.today.tokens} yesterday=${snapOverview.yesterday.tokens}`,
);

check(
  "overview: today null when today is idle even with yesterday activity",
  () => {
    const onlyYesterday = buildOverview([snapYesterdayAgg], { windowKey: "7d", now: SNAP_NOW, pricing, timeZone: "Asia/Shanghai", usdRate: DEFAULT_USD_RATE });
    assert.equal(onlyYesterday.today, null);
    assert.ok(onlyYesterday.yesterday !== null);
    assert.equal(onlyYesterday.yesterday.tokens, 2 * M);
  },
  "today=null yesterday=present",
);

check(
  "overview: yesterday null when only today has activity",
  () => {
    const onlyToday = buildOverview([snapTodayAgg], { windowKey: "7d", now: SNAP_NOW, pricing, timeZone: "Asia/Shanghai", usdRate: DEFAULT_USD_RATE });
    assert.ok(onlyToday.today !== null);
    assert.equal(onlyToday.yesterday, null);
  },
  "today=present yesterday=null",
);

check(
  "overview: both snapshots and the forecast are null on an empty corpus",
  () => {
    const empty = buildOverview([], { windowKey: "7d", now: SNAP_NOW, pricing, timeZone: "Asia/Shanghai", usdRate: DEFAULT_USD_RATE });
    assert.equal(empty.today, null);
    assert.equal(empty.yesterday, null);
    assert.equal(empty.forecast, null);
  },
  "null / null / null",
);

// ---------------------------------------------------------------------------
// IDEA-01 cost forecast
// ---------------------------------------------------------------------------
const FORECAST_NOW = Date.UTC(2026, 10, 8, 4, 0, 0); // Beijing 2026-11-08; November has 30 days → 22 left
const forecastTodayDay = dayIndexOf(FORECAST_NOW, SNAP_ZONE);

/** `YYYY-MM-DD` of one day index (same convention as the module). */
function dayDate(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

check(
  "computeForecast: exact linear fit, month-end extrapolation, 22 days left",
  () => {
    const dailyByDate = new Map();
    for (let index = 0; index < 10; index += 1) {
      dailyByDate.set(dayDate(forecastTodayDay - index), 2 + 0.5 * (29 - index));
    }
    const forecast = computeForecast(dailyByDate, FORECAST_NOW, "Asia/Shanghai");
    assert.ok(forecast !== null);
    closeTo(forecast.slope, 0.5, 1e-9);
    closeTo(forecast.intercept, 2, 1e-9);
    closeTo(forecast.monthEndEstimate, 2 + 0.5 * (29 + 22), 1e-9);
    closeTo(forecast.sigma, 0, 1e-9);
    assert.equal(forecast.dataPoints, 10);
    assert.equal(forecast.daysLeft, 22);
    assert.deepEqual(Object.keys(forecast).sort(), ["dataPoints", "daysLeft", "intercept", "monthEndEstimate", "sigma", "slope"]);
  },
  "slope=0.5 intercept=2 end=27.5",
);

check(
  "computeForecast: fewer than 7 positive days returns null",
  () => {
    const dailyByDate = new Map();
    for (let index = 0; index < 6; index += 1) dailyByDate.set(dayDate(forecastTodayDay - index), 5);
    assert.equal(computeForecast(dailyByDate, FORECAST_NOW, "Asia/Shanghai"), null);
    // Zero-cost and missing days never become data points.
    assert.equal(computeForecast(new Map([[dayDate(forecastTodayDay), 0]]), FORECAST_NOW, "Asia/Shanghai"), null);
    assert.equal(computeForecast(new Map(), FORECAST_NOW, "Asia/Shanghai"), null);
  },
  "6 points → null",
);

check(
  "computeForecast: declining trend never yields a negative estimate",
  () => {
    const dailyByDate = new Map();
    for (let x = 0; x < 10; x += 1) dailyByDate.set(dayDate(forecastTodayDay - (29 - x)), 10 - x);
    const forecast = computeForecast(dailyByDate, FORECAST_NOW, "Asia/Shanghai");
    assert.ok(forecast !== null);
    closeTo(forecast.slope, -1, 1e-9);
    assert.equal(forecast.monthEndEstimate, 0, "negative extrapolation is clamped to zero");
    assert.ok(forecast.sigma >= 0);
    for (const key of ["slope", "intercept", "monthEndEstimate", "sigma"]) {
      assert.ok(Number.isFinite(forecast[key]), `${key} must be finite`);
    }
  },
  "slope=-1 → end=0",
);

check(
  "overview: forecast is wired from the 30-day daily history",
  () => {
    const tenDayAggregates = [];
    for (let index = 0; index < 10; index += 1) {
      tenDayAggregates.push(
        summarizeSessionEvents(
          `session-fc-${index}`,
          [
            messageEvent({
              seq: 1,
              time: FORECAST_NOW - index * DAY_MS - 2 * HOUR,
              provider: "opencode-go",
              model: "deepseek-v4.1-flash",
              input: 1 * M,
              output: 0,
            }),
          ],
          { now: FORECAST_NOW, zoneOffset: SNAP_ZONE },
        ),
      );
    }
    const forecastOverview = buildOverview(tenDayAggregates, {
      windowKey: "30d",
      now: FORECAST_NOW,
      pricing,
      timeZone: "Asia/Shanghai",
      usdRate: DEFAULT_USD_RATE,
    });
    assert.ok(forecastOverview.forecast !== null);
    assert.equal(forecastOverview.forecast.dataPoints, 10);
    assert.ok(forecastOverview.forecast.monthEndEstimate >= 0);
    assert.ok(Number.isFinite(forecastOverview.forecast.monthEndEstimate));
    assert.equal(forecastOverview.forecast.daysLeft, 22);
    // The main fixture has fewer than 7 active-cost days → null, never NaN.
    assert.equal(overview.forecast, null);
    assert.equal(typeof overview.today, "object");
    closeTo(overview.today.tokens, 15 * M, 1e-9);
    closeTo(overview.yesterday.tokens, 9.6 * M, 1e-9);
  },
  "10 points · daysLeft=22 · default fixture null",
);

// ---------------------------------------------------------------------------
// F1 / F2 regression: 60-day heatmap + lifetime session-list totals
// ---------------------------------------------------------------------------
const REG_NOW = Date.UTC(2026, 10, 9, 4, 0, 0); // Beijing 2026-11-09 12:00
const REG_ZONE = 8 * HOUR;

check(
  "F1: 40-day-old usage still lands in the 60-day daily activity",
  () => {
    const old = summarizeSessionEvents(
      "session-old-usage",
      [messageEvent({ seq: 1, time: REG_NOW - 40 * DAY_MS, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 })],
      { now: REG_NOW, zoneOffset: REG_ZONE },
    );
    const oldDay = dayIndexOf(REG_NOW - 40 * DAY_MS, REG_ZONE);
    assert.equal(old.dailyActivity.get(oldDay)?.tokens, 1 * M, "32-56-day tokens must reach dailyActivity");
    // Window statistics keep the 31-day horizon: no hourly bucket here.
    assert.equal(old.hours.size, 0);
    const weekly = buildOverview([old], { windowKey: "7d", now: REG_NOW, pricing, timeZone: "Asia/Shanghai", usdRate: DEFAULT_USD_RATE });
    assert.equal(weekly.totals.tokens, 0);
    // The 56-day heatmap still shows the day with real tokens.
    const series = buildHeatmap([old], "Asia/Shanghai", REG_NOW);
    const entry = series.find((row) => row.date === new Date(oldDay * DAY_MS).toISOString().slice(0, 10));
    assert.ok(entry !== undefined);
    assert.equal(entry.tokens, 1 * M);
    // Beyond 60 days the activity map drops the day entirely.
    const tooOld = summarizeSessionEvents(
      "session-too-old",
      [messageEvent({ seq: 1, time: REG_NOW - 70 * DAY_MS, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 })],
      { now: REG_NOW, zoneOffset: REG_ZONE },
    );
    assert.equal(tooOld.dailyActivity.size, 0);
  },
  "40-day tokens in heatmap · 70-day dropped",
);

check(
  "F2: session list uses lifetime tokens and lastEventTime from every event kind",
  () => {
    const recentUsage = messageEvent({ seq: 1, time: REG_NOW - 2 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 });
    const oldUsage = messageEvent({ seq: 2, time: REG_NOW - 40 * DAY_MS, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 3 * M, output: 0 });
    const lateTool = { type: "tool/call", seq: 3, time: REG_NOW - 30 * 60_000, data: { name: "read", arguments: "{}" } };
    const aggregate = summarizeSessionEvents("session-lifetime", [recentUsage, oldUsage, lateTool], { now: REG_NOW, zoneOffset: REG_ZONE });
    // Lifetime totals: a 31-day window would only see 1M.
    assert.equal(aggregate.tokens, 4 * M);
    assert.equal(aggregate.hours.size, 1, "only the recent hour is in the window bucket");
    assert.equal(aggregate.lastTime, REG_NOW - 2 * HOUR, "lastTime keeps the last usage");
    const rows = buildSessionList([aggregate]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tokens, 4 * M);
    assert.equal(rows[0].lastActiveAt, REG_NOW - 30 * 60_000, "a later tool call is the last activity");
    // A metadata-only session is listed too, with an exact last event time.
    const metaOnly = summarizeSessionEvents(
      "session-meta",
      [
        { type: "session/title", seq: 1, time: REG_NOW - 5 * HOUR, data: { title: "只有标题" } },
        { type: "turn/start", seq: 2, time: REG_NOW - 4 * HOUR, data: { turn: 1 } },
      ],
      { now: REG_NOW, zoneOffset: REG_ZONE },
    );
    const metaRows = buildSessionList([metaOnly]);
    assert.equal(metaRows.length, 1);
    assert.equal(metaRows[0].lastActiveAt, REG_NOW - 4 * HOUR);
    assert.equal(metaRows[0].title, "只有标题");
  },
  "lifetime 4M · lastActiveAt from tool call · meta-only listed",
);

check(
  "prompt filter: a tail runtime injection never becomes the last prompt",
  () => {
    const aggregate = summarizeSessionEvents(
      "session-tail",
      [
        { type: "user/message", seq: 1, time: REG_NOW - 3 * HOUR, data: { source: { kind: "user" }, content: [{ type: "text", text: "真实问题" }] } },
        { type: "user/message", seq: 2, time: REG_NOW - 2 * HOUR, data: { source: { kind: "time-context" }, content: [{ type: "text", text: "Time sampled while preparing turn 1" }] } },
        { type: "user/message", seq: 3, time: REG_NOW - 1 * HOUR, data: { source: { kind: "progress-updates-nudge" }, content: [{ type: "text", text: "进度提醒注入" }] } },
      ],
      { now: REG_NOW, zoneOffset: REG_ZONE },
    );
    // Broadening the source-kind filter would make these assertions fail.
    assert.equal(aggregate.lastPrompt, "真实问题");
    assert.equal(buildSessionList([aggregate])[0].lastPrompt, "真实问题");
  },
  "tail injections ignored",
);

check(
  "events-sample.json: derived contract (title / prompt / turns / fork owned tokens)",
  () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/events-sample.json", import.meta.url), "utf8"));
    // Fixture events are from 2026-10-05: stay near them for window rankings,
    // then jump 35 days ahead to prove the 60-day daily layer survives pruning.
    const nearNow = Date.UTC(2026, 9, 10, 4, 0, 0);
    const farNow = Date.UTC(2026, 10, 9, 4, 0, 0);
    const [top, fork] = fixture.sessions;
    const derived = fixture.derived;
    const topAggregate = summarizeSessionEvents(
      top.id,
      top.events.slice(Number(top.inheritedEventCount) || 0),
      { now: nearNow, zoneOffset: REG_ZONE, workspace: top.header?.cwd ?? "" },
    );
    assert.equal(topAggregate.title, derived.title);
    assert.equal(topAggregate.lastPrompt, derived.lastPrompt, "tail runtime injections must be ignored");
    assert.equal(topAggregate.turns, derived.turns);
    assert.equal(topAggregate.steps, derived.steps);
    assert.equal(topAggregate.tokens, derived.tokensTotal);
    const sortRows = (rows) => rows.map((row) => [row.name ?? row.program, row.count]).sort((left, right) => left[0].localeCompare(right[0]));
    assert.deepEqual(
      sortRows(buildToolLeaderboard([topAggregate])),
      Object.entries(derived.toolCallCounts).sort((left, right) => left[0].localeCompare(right[0])),
    );
    assert.deepEqual(
      sortRows(buildCommandLeaderboard([topAggregate])),
      Object.entries(derived.shellPrograms).sort((left, right) => left[0].localeCompare(right[0])),
    );
    assert.deepEqual(
      sortRows(buildSkillLeaderboard([topAggregate])),
      Object.entries(derived.skillNames).sort((left, right) => left[0].localeCompare(right[0])),
    );
    // 35 days later the hourly window is pruned but the 60-day daily layer survives.
    const aged = summarizeSessionEvents(top.id, top.events, { now: farNow, zoneOffset: REG_ZONE });
    assert.equal(aged.hours.size, 0, "hourly buckets stop at 31 days");
    assert.ok(aged.dailyActivity.size > 0, "daily activity keeps 60 days");
    assert.equal(
      [...aged.dailyActivity.values()].reduce((sum, day) => sum + day.tokens, 0),
      derived.tokensTotal,
      "F1: the whole fixture token total must reach daily activity",
    );

    // Fork: only the tail after inheritedEventCount is owned activity.
    const forkAggregate = summarizeSessionEvents(fork.id, fork.events.slice(Number(fork.inheritedEventCount) || 0), { now: nearNow, zoneOffset: REG_ZONE });
    const naive = summarizeSessionEvents(fork.id, fork.events, { now: nearNow, zoneOffset: REG_ZONE });
    assert.equal(forkAggregate.tokens, derived.fork.ownedTokens);
    assert.equal(naive.tokens, derived.fork.naiveAllEventsTokens, "unsliced fork double-counts the parent prefix");
    assert.equal(forkAggregate.turns, derived.fork.ownedTurns);
    assert.equal(forkAggregate.toolDaily.size, 0, "no owned tool calls after the fork point");
    assert.ok(naive.toolDaily.size > 0, "the inherited prefix does contain tool calls");
    assert.equal(forkAggregate.title, derived.fork.title);
    assert.equal(forkAggregate.lastPrompt, derived.fork.lastPrompt);
  },
  "fixture: 12757 tokens · fork 200 vs 1300",
);

// ---------------------------------------------------------------------------
// M1: day windows must resolve days with the window's own zone offset
// ---------------------------------------------------------------------------
const M1_EVENT_TIME = Date.UTC(2026, 10, 8, 23, 30, 0); // 23:30 UTC — next day in +08:00
const M1_ZONES = ["Asia/Shanghai", "UTC", "America/New_York", "Europe/Berlin"];
const M1_NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

check(
  "M1: a 23:30 UTC event lands on its own day for every viewer zone",
  () => {
    const event = [messageEvent({ seq: 1, time: M1_EVENT_TIME, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 })];
    for (const timeZone of M1_ZONES) {
      const zoneOffset = zoneOffsetMs(timeZone, M1_NOW);
      const window = resolveWindow("7d", M1_NOW, zoneOffset);
      assert.equal(window.offsetMs, zoneOffset, `${timeZone}: resolveWindow must expose its offset`);
      const day = dayIndexOf(M1_EVENT_TIME, zoneOffset);
      assert.equal(windowBucketIndexOf(window, hourIndexOf(M1_EVENT_TIME)), day - window.startDay, `${timeZone}: bucket index`);
      const aggregate = summarizeSessionEvents("session-m1", event, { now: M1_NOW, zoneOffset });
      const overview = buildOverview([aggregate], { windowKey: "7d", now: M1_NOW, timeZone, pricing, usdRate: DEFAULT_USD_RATE });
      assert.equal(overview.totals.tokens, 1 * M, `${timeZone}: the event must be counted`);
      assert.equal(overview.daily[day - window.startDay].tokens, 1 * M, `${timeZone}: event must stay on its own day`);
    }
  },
  "4 zones · 23:30 UTC",
);

check(
  "M1: uniform 7x24 corpus totals 168M in every viewer zone",
  () => {
    for (const timeZone of M1_ZONES) {
      const zoneOffset = zoneOffsetMs(timeZone, M1_NOW);
      const endDay = dayIndexOf(M1_NOW, zoneOffset);
      const events = [];
      let seq = 1;
      for (let day = endDay - 6; day <= endDay; day += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
          events.push(
            messageEvent({
              seq,
              time: day * DAY_MS - zoneOffset + hour * HOUR,
              provider: "opencode-go",
              model: "deepseek-v4.1-flash",
              input: 1 * M,
              output: 0,
            }),
          );
          seq += 1;
        }
      }
      // Reference instant: 23:59:59.999 of the last local day, so every bucket is inside the window.
      const scanNow = (endDay + 1) * DAY_MS - zoneOffset - 1;
      const aggregate = summarizeSessionEvents("session-uniform", events, { now: scanNow, zoneOffset });
      const overview = buildOverview([aggregate], { windowKey: "7d", now: scanNow, timeZone, pricing, usdRate: DEFAULT_USD_RATE });
      assert.equal(overview.daily.length, 7);
      assert.equal(overview.totals.tokens, 168 * M, `${timeZone}: late-evening hours must not be dropped`);
      assert.equal(overview.daily.reduce((sum, row) => sum + row.tokens, 0), 168 * M, `${timeZone}: daily must sum to totals`);
    }
  },
  "168M · 4 zones",
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

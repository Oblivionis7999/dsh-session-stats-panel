/**
 * Local vendor-official price estimation (pure functions, zero dependencies).
 *
 * ONLY each model vendor's own published price list is used — DeepSeek models
 * with DeepSeek's CNY list, GLM models with Zhipu's CNY list, Grok with xAI's
 * USD list, GPT with OpenAI's USD list, Claude with Anthropic's USD list, and
 * so on. Reseller/aggregator platform prices and cross-vendor fallbacks are
 * deliberately NOT used.
 *
 * When a model's vendor list cannot be verified, the model is NOT guessed:
 * `priceForRoute` returns null, `effectivePrice` reports
 * `priced: false` / `priceLevel: "unpriced"` with all prices 0, and
 * `costOfUsage` returns `costCNY: 0`. The UI shows "未计价" for those models and
 * states how many tokens were left out of the amount.
 *
 * Currency: Chinese vendors publish CNY and are used verbatim (no FX). Overseas
 * vendors publish USD and are converted to CNY at `usdRate`; CNY stays the
 * authoritative figure and USD is only a derived display value.
 *
 * Peak / off-peak applies to DeepSeek's official list only: Beijing time
 * (UTC+8), Monday–Friday 09:00–12:00 and 14:00–18:00 are peak, everything else
 * (nights, weekends, configured holidays) is off-peak, peak = 2x off-peak.
 * Every other vendor list is flat.
 *
 * Cache accounting: `inputTokens` is UNCACHED input only (the disjoint-bucket
 * contract of `TokenUsage`). Cache writes are billed at the row's `cacheWrite`
 * price when the vendor publishes one, otherwise at the cache-miss (input)
 * price.
 *
 * Every priced row carries `sourceUrl` + `verifiedAt`; the README price-source
 * table mirrors them.
 *
 * @module dsh-session-stats-panel/pricing
 */

/** Version tag of the embedded price tables (surfaced in API responses). */
export const PRICE_TABLE_VERSION = "vendor-official-2026-11";

/** Display fallback for USD→CNY when none is configured. */
export const DEFAULT_USD_RATE = 7.1;

/**
 * Official DeepSeek Search price: ¥5 per 1,000 successful requests, i.e.
 * ¥0.005 per request, flat (no peak/off-peak, no FX). DSH's server-side
 * web_search is billed per request; web_fetch is a local direct connection and
 * is NOT billed by DeepSeek Fetch.
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing (fetched 2026-11-05)
 */
export const SEARCH_REQUEST_PRICE_CNY = 0.005;

/**
 * Cost of N official search requests at the flat per-request price.
 * @param {number} count - number of search requests.
 * @returns {number} CNY cost, rounded to 6 decimals.
 */
export function searchCost(count) {
  const requests = Number(count);
  if (!Number.isFinite(requests) || requests <= 0) return 0;
  return roundMoney(Math.floor(requests) * SEARCH_REQUEST_PRICE_CNY);
}

/** Beijing is UTC+8 with no DST. */
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Peak windows as `[startHour, endHour)` pairs in Beijing wall-clock hours. */
export const PEAK_HOURS = Object.freeze([
  Object.freeze([9, 12]),
  Object.freeze([14, 18]),
]);

/** Peak price multiplier over the off-peak base price (DeepSeek only). */
export const PEAK_MULTIPLIER = 2;

/**
 * Gemini 4 Argon switches from its introductory list to the standard list at
 * 2026-12-01 00:00 Beijing time (2026-11-30T16:00:00Z). Rows may carry a
 * `tiers` array; the effective tier is the last one whose `from` is ≤ event time.
 */
export const GEMINI_PRICE_SWITCH_MS = Date.parse("2026-11-30T16:00:00Z");

/** Fetch date recorded for every price below. */
const VERIFIED_AT = "2026-11-04";

/** Vendor display identity (the client localizes the label). */
export const VENDOR_INFO = Object.freeze({
  deepseek: Object.freeze({ label: "DeepSeek", currency: "CNY" }),
  zhipu: Object.freeze({ label: "Zhipu AI", currency: "CNY" }),
  moonshot: Object.freeze({ label: "Moonshot AI", currency: "CNY" }),
  alibaba: Object.freeze({ label: "Alibaba Cloud", currency: "USD" }),
  minimax: Object.freeze({ label: "MiniMax", currency: "CNY" }),
  tencent: Object.freeze({ label: "Tencent", currency: "CNY" }),
  stepfun: Object.freeze({ label: "StepFun", currency: "CNY" }),
  xiaomi: Object.freeze({ label: "Xiaomi", currency: "CNY" }),
  meituan: Object.freeze({ label: "Meituan", currency: "CNY" }),
  xai: Object.freeze({ label: "xAI", currency: "USD" }),
  openai: Object.freeze({ label: "OpenAI", currency: "USD" }),
  anthropic: Object.freeze({ label: "Anthropic", currency: "USD" }),
  google: Object.freeze({ label: "Google", currency: "USD" }),
  meta: Object.freeze({ label: "Meta", currency: "USD" }),
  reflection: Object.freeze({ label: "Reflection", currency: "USD" }),
  iceman: Object.freeze({ label: "Iceman", currency: "USD" }),
});

/**
 * Vendor-official price lists. Money is per 1,000,000 tokens in the row's own
 * `currency`; `cacheWrite` defaults to the cache-miss input price.
 * `peakApplies` is true only for DeepSeek's CNY list.
 */
const OFFICIAL_PRICE_TABLE = Object.freeze({
  // ---- DeepSeek · CNY · 元/百万 tokens · 2026-11-04 -----------------------
  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  "deepseek-flash": Object.freeze({
    label: "DeepSeek Flash",
    vendor: "deepseek",
    currency: "CNY",
    peakApplies: true,
    cacheRead: 0.02,
    cacheWrite: 1,
    input: 1,
    output: 4,
    sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    verifiedAt: VERIFIED_AT,
    note: "peak ×2; legacy deepseek-v4-flash bills at Flash price",
  }),
  "deepseek-v4-pro": Object.freeze({
    label: "DeepSeek V4 Pro",
    vendor: "deepseek",
    currency: "CNY",
    peakApplies: true,
    cacheRead: 0.15,
    cacheWrite: 4.5,
    input: 4.5,
    output: 13.5,
    sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    verifiedAt: VERIFIED_AT,
    note: "peak ×2",
  }),

  // ---- Zhipu AI · CNY · 元/百万 tokens · 2026-11-04 ----------------------
  // https://docs.bigmodel.cn/cn/guide/start/pricing.md
  "glm-5.3": Object.freeze({
    label: "GLM-5.3",
    vendor: "zhipu",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 2,
    cacheWrite: 8,
    input: 8,
    output: 28,
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    verifiedAt: VERIFIED_AT,
    note: "cache storage currently free; write billed as miss input",
  }),
  "glm-5.3-flash": Object.freeze({
    label: "GLM-5.3-Flash",
    vendor: "zhipu",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.23,
    cacheWrite: 0.8,
    input: 0.8,
    output: 2.8,
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    verifiedAt: VERIFIED_AT,
    note: "cache storage currently free; write billed as miss input",
  }),
  "glm-5.3-flashx": Object.freeze({
    label: "GLM-5.3-FlashX",
    vendor: "zhipu",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.57,
    cacheWrite: 2,
    input: 2,
    output: 7,
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    verifiedAt: VERIFIED_AT,
    note: "cache storage currently free; write billed as miss input",
  }),
  "glm-5.2": Object.freeze({
    label: "GLM-5.2",
    vendor: "zhipu",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 2,
    cacheWrite: 8,
    input: 8,
    output: 28,
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    verifiedAt: VERIFIED_AT,
    note: "cache storage currently free; write billed as miss input",
  }),
  "glm-5.1": Object.freeze({
    label: "GLM-5.1",
    vendor: "zhipu",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 1.3,
    cacheWrite: 6,
    input: 6,
    output: 24,
    sourceUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    verifiedAt: VERIFIED_AT,
    note: "input <32K tier; ≥32K is 8/28/2",
  }),

  // ---- Alibaba Cloud Model Studio · USD · $/1M tokens · 2026-11-04 -------
  // https://www.alibabacloud.com/help/zh/model-studio/model-pricing
  // Context cache rule on the same page: hits billed at 10% of input, explicit
  // cache creation at 125% of input. The China-site CNY list is JS-rendered and
  // could not be verified, so the vendor's official international USD list is
  // used (converted to CNY at usdRate for display).
  "qwen3.8-max": Object.freeze({
    label: "Qwen3.8 Max",
    vendor: "alibaba",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.165,
    cacheWrite: 2.0625,
    input: 1.65,
    output: 4.951,
    sourceUrl: "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
    verifiedAt: VERIFIED_AT,
    note: "Beijing region; cache hit 10% / cache write 125% of input",
  }),
  "qwen3.8-flash": Object.freeze({
    label: "Qwen3.8 Flash",
    vendor: "alibaba",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.0113,
    cacheWrite: 0.14125,
    input: 0.113,
    output: 0.382,
    sourceUrl: "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
    verifiedAt: VERIFIED_AT,
    note: "Beijing region; cache hit 10% / cache write 125% of input",
  }),
  "qwen3.7-plus": Object.freeze({
    label: "Qwen3.7 Plus",
    vendor: "alibaba",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.04,
    cacheWrite: 0.5,
    input: 0.4,
    output: 1.6,
    sourceUrl: "https://www.alibabacloud.com/help/zh/model-studio/model-pricing",
    verifiedAt: VERIFIED_AT,
    note: "≤256K tier; cache hit 10% / cache write 125% of input",
  }),

  // ---- MiniMax (China site) · CNY · 元/百万 tokens · 2026-11-04 ----------
  // https://platform.minimax.cn/docs/pricing/overview.md
  "minimax-m3": Object.freeze({
    label: "MiniMax-M3",
    vendor: "minimax",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.42,
    cacheWrite: 2.1,
    input: 2.1,
    output: 8.4,
    sourceUrl: "https://platform.minimax.cn/docs/pricing/overview.md",
    verifiedAt: VERIFIED_AT,
    note: "≤512k standard tier, permanent 50% off applied",
  }),
  "minimax-m3.1-flash": Object.freeze({
    label: "MiniMax-M3.1-Flash",
    vendor: "minimax",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.1,
    cacheWrite: 1,
    input: 1,
    output: 4,
    sourceUrl: "https://platform.minimax.cn/docs/pricing/overview.md",
    verifiedAt: VERIFIED_AT,
    note: null,
  }),

  // ---- StepFun · CNY · 元/百万 tokens · 2026-11-04 -----------------------
  // https://platform.stepfun.com/docs/zh/guides/pricing/details.md
  "step-5-preview": Object.freeze({
    label: "Step 5 Preview",
    vendor: "stepfun",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.7,
    cacheWrite: 7,
    input: 7,
    output: 20,
    sourceUrl: "https://platform.stepfun.com/docs/zh/guides/pricing/details.md",
    verifiedAt: VERIFIED_AT,
    note: "cache-hit price raised to 0.70 on 2026-10-14",
  }),

  // ---- Xiaomi MiMo · CNY · 元/百万 tokens · 2026-11-04 -------------------
  // https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go
  "mimo-v2.6-pro": Object.freeze({
    label: "MiMo-V2.6-Pro",
    vendor: "xiaomi",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.025,
    cacheWrite: 3,
    input: 3,
    output: 6,
    sourceUrl: "https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go",
    verifiedAt: VERIFIED_AT,
    note: "domestic list; cache write currently free → billed as miss input",
  }),
  "mimo-v2.6-flash": Object.freeze({
    label: "MiMo-V2.6-Flash",
    vendor: "xiaomi",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.02,
    cacheWrite: 1,
    input: 1,
    output: 2,
    sourceUrl: "https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go",
    verifiedAt: VERIFIED_AT,
    note: "domestic list; cache write currently free → billed as miss input",
  }),
  "mimo-v2.6-pro-ultraspeed": Object.freeze({
    label: "MiMo-V2.6-Pro-Ultraspeed",
    vendor: "xiaomi",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.25,
    cacheWrite: 30,
    input: 30,
    output: 60,
    sourceUrl: "https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go",
    verifiedAt: VERIFIED_AT,
    note: "domestic list",
  }),

  // ---- Meituan LongCat · CNY · 元/百万 tokens · 2026-11-04 ---------------
  // https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0
  "longcat-2.0": Object.freeze({
    label: "LongCat-2.0",
    vendor: "meituan",
    currency: "CNY",
    peakApplies: false,
    cacheRead: 0.1,
    cacheWrite: 5,
    input: 5,
    output: 20,
    sourceUrl: "https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0",
    verifiedAt: VERIFIED_AT,
    note: "list price; limited-time discount 2/0.04/8 not applied",
  }),

  // ---- xAI · USD · $/1M tokens · 2026-11-04 ------------------------------
  // https://docs.x.ai/developers/pricing
  "grok-4.7": Object.freeze({
    label: "Grok 4.7",
    vendor: "xai",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.5,
    cacheWrite: 2,
    input: 2,
    output: 6,
    sourceUrl: "https://docs.x.ai/developers/pricing",
    verifiedAt: VERIFIED_AT,
    note: "<200k prompt tier; ≥200k is 4/1/12; no separate cache-write price",
  }),
  "grok-4.6": Object.freeze({
    label: "Grok 4.6",
    vendor: "xai",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.5,
    cacheWrite: 2,
    input: 2,
    output: 6,
    sourceUrl: "https://docs.x.ai/developers/pricing",
    verifiedAt: VERIFIED_AT,
    note: "<200k prompt tier",
  }),
  "grok-4.5": Object.freeze({
    label: "Grok 4.5",
    vendor: "xai",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.3,
    cacheWrite: 2,
    input: 2,
    output: 6,
    sourceUrl: "https://docs.x.ai/developers/pricing",
    verifiedAt: VERIFIED_AT,
    note: "<200k prompt tier",
  }),
  "grok-4.3": Object.freeze({
    label: "Grok 4.3",
    vendor: "xai",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.2,
    cacheWrite: 1.25,
    input: 1.25,
    output: 2.5,
    sourceUrl: "https://docs.x.ai/developers/pricing",
    verifiedAt: VERIFIED_AT,
    note: "<200k prompt tier",
  }),
  "grok-build-0.1": Object.freeze({
    label: "Grok Build 0.1",
    vendor: "xai",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.2,
    cacheWrite: 1,
    input: 1,
    output: 2,
    sourceUrl: "https://docs.x.ai/developers/pricing",
    verifiedAt: VERIFIED_AT,
    note: "<200k prompt tier",
  }),

  // ---- OpenAI · USD · $/1M tokens · 2026-11-04 ---------------------------
  // https://developers.openai.com/api/docs/pricing.md (Standard, short context)
  "gpt-6-luna": Object.freeze({ label: "GPT-6 Luna", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.01, cacheWrite: 0.125, input: 0.1, output: 0.5, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-5.6-luna": Object.freeze({ label: "GPT-5.6 Luna", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.02, cacheWrite: 0.25, input: 0.2, output: 1.2, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-6.1-sol": Object.freeze({ label: "GPT-6.1 Sol", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-6.1-terra": Object.freeze({ label: "GPT-6.1 Terra", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.05, cacheWrite: 1.25, input: 1, output: 5, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-6-sol": Object.freeze({ label: "GPT-6 Sol", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-5.6-sol": Object.freeze({ label: "GPT-5.6 Sol", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.4, cacheWrite: 5, input: 4, output: 20, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-5.6-terra": Object.freeze({ label: "GPT-5.6 Terra", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 12, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; 30m cache write" }),
  "gpt-5.1": Object.freeze({ label: "GPT-5.1", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.125, cacheWrite: 1.25, input: 1.25, output: 10, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; no published cache-write price" }),
  "gpt-5": Object.freeze({ label: "GPT-5", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.125, cacheWrite: 1.25, input: 1.25, output: 10, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; no published cache-write price" }),
  "gpt-5-mini": Object.freeze({ label: "GPT-5 mini", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.025, cacheWrite: 0.25, input: 0.25, output: 2, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context; no published cache-write price" }),
  "gpt-5.4-mini": Object.freeze({ label: "GPT-5.4 mini", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.075, cacheWrite: 0.75, input: 0.75, output: 4.5, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context" }),
  "gpt-5.4-nano": Object.freeze({ label: "GPT-5.4 nano", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.02, cacheWrite: 0.2, input: 0.2, output: 1.25, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context" }),
  "gpt-4.1": Object.freeze({ label: "GPT-4.1", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.5, cacheWrite: 2, input: 2, output: 8, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context" }),
  "gpt-4o-mini": Object.freeze({ label: "GPT-4o mini", vendor: "openai", currency: "USD", peakApplies: false, cacheRead: 0.075, cacheWrite: 0.15, input: 0.15, output: 0.6, sourceUrl: "https://developers.openai.com/api/docs/pricing.md", verifiedAt: VERIFIED_AT, note: "short context" }),

  // ---- Anthropic · USD · $/1M tokens · 2026-11-04 ------------------------
  // https://platform.claude.com/docs/en/about-claude/pricing (5m cache writes)
  "claude-fable-5-1": Object.freeze({ label: "Claude Fable 5.1", vendor: "anthropic", currency: "USD", peakApplies: false, cacheRead: 0.25, cacheWrite: 12.5, input: 10, output: 50, sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing", verifiedAt: VERIFIED_AT, note: "5m cache write tier" }),
  "claude-opus-5-5": Object.freeze({ label: "Claude Opus 5.5", vendor: "anthropic", currency: "USD", peakApplies: false, cacheRead: 0.2, cacheWrite: 5, input: 4, output: 20, sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing", verifiedAt: VERIFIED_AT, note: "5m cache write tier" }),
  "claude-sonnet-5-5": Object.freeze({ label: "Claude Sonnet 5.5", vendor: "anthropic", currency: "USD", peakApplies: false, cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10, sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing", verifiedAt: VERIFIED_AT, note: "5m cache write tier" }),
  "claude-haiku-5-5": Object.freeze({ label: "Claude Haiku 5.5", vendor: "anthropic", currency: "USD", peakApplies: false, cacheRead: 0.01, cacheWrite: 0.125, input: 0.1, output: 0.5, sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing", verifiedAt: VERIFIED_AT, note: "prompts ≤100k tier; 5m cache write tier" }),

  // ---- Moonshot Kimi · CNY · 元/百万 tokens · 2026-11-04 -----------------
  // https://platform.kimi.com/docs/pricing/chat
  // Cache writes are billed at the 5-minute TTL tier; usage records do not
  // distinguish cache TTLs, so the 1-hour tier is not modelled.
  "kimi-k3.1-pro": Object.freeze({ label: "Kimi K3.1 Pro", vendor: "moonshot", currency: "CNY", peakApplies: false, cacheRead: 1.3, cacheWrite: 13, input: 13, output: 68, sourceUrl: "https://platform.kimi.com/docs/pricing/chat", verifiedAt: VERIFIED_AT, note: "cache write = 5min TTL tier (1h tier 26 not modelled)" }),
  "kimi-k3.1-pro-highspeed": Object.freeze({ label: "Kimi K3.1 Pro Highspeed", vendor: "moonshot", currency: "CNY", peakApplies: false, cacheRead: 1.3, cacheWrite: 26, input: 26, output: 136, sourceUrl: "https://platform.kimi.com/docs/pricing/chat", verifiedAt: VERIFIED_AT, note: "cache write = 5min TTL tier (1h tier 52 not modelled)" }),
  "kimi-k3": Object.freeze({ label: "Kimi K3", vendor: "moonshot", currency: "CNY", peakApplies: false, cacheRead: 2, cacheWrite: 20, input: 20, output: 100, sourceUrl: "https://platform.kimi.com/docs/pricing/chat", verifiedAt: VERIFIED_AT, note: "cache write = 5min TTL tier (1h tier 40 not modelled); alias k3 / k3-256k" }),
  "kimi-k2.7-code": Object.freeze({ label: "Kimi K2.7 Code", vendor: "moonshot", currency: "CNY", peakApplies: false, cacheRead: 1.3, cacheWrite: 6.5, input: 6.5, output: 27, sourceUrl: "https://platform.kimi.com/docs/pricing/chat", verifiedAt: VERIFIED_AT, note: "no published cache-write price; write billed as miss input; alias kimi-for-coding" }),
  "kimi-k2.7-code-highspeed": Object.freeze({ label: "Kimi K2.7 Code Highspeed", vendor: "moonshot", currency: "CNY", peakApplies: false, cacheRead: 2.6, cacheWrite: 13, input: 13, output: 54, sourceUrl: "https://platform.kimi.com/docs/pricing/chat", verifiedAt: VERIFIED_AT, note: "no published cache-write price; write billed as miss input; alias kimi-for-coding-highspeed" }),
  "kimi-k2.6": Object.freeze({ label: "Kimi K2.6", vendor: "moonshot", currency: "CNY", peakApplies: false, cacheRead: 1.1, cacheWrite: 6.5, input: 6.5, output: 27, sourceUrl: "https://platform.kimi.com/docs/pricing/chat", verifiedAt: VERIFIED_AT, note: "no published cache-write price; write billed as miss input" }),

  // ---- Tencent Hunyuan · CNY · 元/百万 tokens · 2026-11-04 ---------------
  // https://cloud.tencent.com/document/product/1759/127342
  // TokenHub list prices; batch-inference 50% discount and self-hosted open
  // weights are not used.
  "hy3": Object.freeze({ label: "Hy3", vendor: "tencent", currency: "CNY", peakApplies: false, cacheRead: 0.25, cacheWrite: 1, input: 1, output: 4, sourceUrl: "https://cloud.tencent.com/document/product/1759/127342", verifiedAt: VERIFIED_AT, note: "TokenHub list price" }),
  "hy4-preview": Object.freeze({ label: "Hy4 preview", vendor: "tencent", currency: "CNY", peakApplies: false, cacheRead: 0.3, cacheWrite: 6, input: 6, output: 18, sourceUrl: "https://cloud.tencent.com/document/product/1759/127342", verifiedAt: VERIFIED_AT, note: "TokenHub list price; batch discount and self-hosted price not used" }),

  // ---- Google Gemini · USD · $/1M tokens · 2026-11-04 --------------------
  // https://ai.google.dev/gemini-api/docs/latest-model
  // Introductory list until 2026-11-30, standard list from 2026-12-01 (Beijing).
  "gemini-4-argon": Object.freeze({
    label: "Gemini 4 Argon",
    vendor: "google",
    currency: "USD",
    peakApplies: false,
    cacheRead: 0.1,
    cacheWrite: 2,
    input: 2,
    output: 10,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/latest-model",
    verifiedAt: VERIFIED_AT,
    note: "introductory list until 2026-11-30; standard list from 2026-12-01 (Beijing)",
    tiers: Object.freeze([
      Object.freeze({ from: 0, cacheRead: 0.1, cacheWrite: 2, input: 2, output: 10 }),
      Object.freeze({ from: GEMINI_PRICE_SWITCH_MS, cacheRead: 0.2, cacheWrite: 4, input: 4, output: 20 }),
    ]),
  }),

  // ---- Meta Muse · USD · $/1M tokens · 2026-11-04 ------------------------
  // List prices supplied by the operator from the official Muse pricing page.
  "muse-spark-1.3-contributor": Object.freeze({ label: "Muse Spark 1.3 Contributor", vendor: "meta", currency: "USD", peakApplies: false, cacheRead: 0.15, cacheWrite: 1.25, input: 1.25, output: 4.25, sourceUrl: "https://www.meta.ai/pricing", verifiedAt: VERIFIED_AT, note: "operator-supplied official list" }),
  "muse-wonder": Object.freeze({ label: "Muse Wonder", vendor: "meta", currency: "USD", peakApplies: false, cacheRead: 0.2, cacheWrite: 4, input: 4, output: 20, sourceUrl: "https://www.meta.ai/pricing", verifiedAt: VERIFIED_AT, note: "operator-supplied official list" }),
});

/**
 * Vendor hints for models WITHOUT a verified price list, used only to show the
 * vendor name in the UI. Hints never produce a price.
 */
const VENDOR_HINT_MATCHERS = Object.freeze([
  Object.freeze({ vendor: "deepseek", pattern: /deepseek/ }),
  Object.freeze({ vendor: "zhipu", pattern: /glm/ }),
  Object.freeze({ vendor: "moonshot", pattern: /kimi/ }),
  Object.freeze({ vendor: "alibaba", pattern: /qwen/ }),
  Object.freeze({ vendor: "minimax", pattern: /minimax/ }),
  Object.freeze({ vendor: "tencent", pattern: /(?:^|[^a-z0-9])hy\d/ }),
  Object.freeze({ vendor: "stepfun", pattern: /(?:^|[^a-z0-9])step/ }),
  Object.freeze({ vendor: "xiaomi", pattern: /mimo/ }),
  Object.freeze({ vendor: "meituan", pattern: /longcat/ }),
  Object.freeze({ vendor: "xai", pattern: /grok/ }),
  Object.freeze({ vendor: "openai", pattern: /gpt|(?:^|[^a-z0-9])o\d/ }),
  Object.freeze({ vendor: "anthropic", pattern: /claude/ }),
  Object.freeze({ vendor: "google", pattern: /gemini/ }),
  Object.freeze({ vendor: "meta", pattern: /muse/ }),
  Object.freeze({ vendor: "reflection", pattern: /beam/ }),
  Object.freeze({ vendor: "iceman", pattern: /iceman/ }),
]);

/**
 * Vendor-official model matchers, tested against the model segment (the part
 * after the first `/`) of the lower-cased route. First match wins, so more
 * specific ids precede family rules.
 */
const OFFICIAL_MODEL_MATCHERS = Object.freeze([
  // DeepSeek: only model ids that actually contain "deepseek".
  Object.freeze({ key: "deepseek-v4-pro", pattern: /deepseek.*v4[._-]?pro/ }),
  Object.freeze({ key: "deepseek-flash", pattern: /deepseek.*flash/ }),
  // Zhipu
  Object.freeze({ key: "glm-5.3-flashx", pattern: /glm[._-]?5[._-]?3[._-]?flashx/ }),
  Object.freeze({ key: "glm-5.3-flash", pattern: /glm[._-]?5[._-]?3[._-]?flash(?:[^a-z0-9]|$)/ }),
  Object.freeze({ key: "glm-5.3", pattern: /glm[._-]?5[._-]?3(?:[^a-z0-9]|$)/ }),
  Object.freeze({ key: "glm-5.2", pattern: /glm[._-]?5[._-]?2(?:[^a-z0-9]|$)/ }),
  Object.freeze({ key: "glm-5.1", pattern: /glm[._-]?5[._-]?1(?:[^a-z0-9]|$)/ }),
  // Alibaba
  Object.freeze({ key: "qwen3.8-max", pattern: /qwen3[._-]?8[._-]?max/ }),
  Object.freeze({ key: "qwen3.8-flash", pattern: /qwen3[._-]?8[._-]?flash/ }),
  Object.freeze({ key: "qwen3.7-plus", pattern: /qwen3[._-]?7[._-]?plus/ }),
  // MiniMax
  Object.freeze({ key: "minimax-m3.1-flash", pattern: /minimax[._-]?m3[._-]?1[._-]?flash/ }),
  Object.freeze({ key: "minimax-m3", pattern: /minimax[._-]?m3(?:[^a-z0-9]|$)/ }),
  // StepFun
  Object.freeze({ key: "step-5-preview", pattern: /step[._-]?5/ }),
  // Xiaomi
  Object.freeze({ key: "mimo-v2.6-pro-ultraspeed", pattern: /mimo[._-]?v?2[._-]?6[._-]?pro[._-]?ultraspeed/ }),
  Object.freeze({ key: "mimo-v2.6-pro", pattern: /mimo[._-]?v?2[._-]?6[._-]?pro/ }),
  Object.freeze({ key: "mimo-v2.6-flash", pattern: /mimo[._-]?v?2[._-]?6[._-]?flash/ }),
  // Meituan
  Object.freeze({ key: "longcat-2.0", pattern: /longcat[._-]?2(?:[._-]?0)?(?:[^a-z0-9.]|$)/ }),
  // xAI
  Object.freeze({ key: "grok-4.7", pattern: /grok[._-]?4[._-]?7/ }),
  Object.freeze({ key: "grok-4.6", pattern: /grok[._-]?4[._-]?6/ }),
  Object.freeze({ key: "grok-4.5", pattern: /grok[._-]?4[._-]?5/ }),
  Object.freeze({ key: "grok-4.3", pattern: /grok[._-]?4[._-]?3/ }),
  Object.freeze({ key: "grok-build-0.1", pattern: /grok[._-]?build/ }),
  // OpenAI
  Object.freeze({ key: "gpt-6.1-sol", pattern: /gpt[._-]?6[._-]?1[._-]?sol/ }),
  Object.freeze({ key: "gpt-6.1-terra", pattern: /gpt[._-]?6[._-]?1[._-]?terra/ }),
  Object.freeze({ key: "gpt-6-luna", pattern: /gpt[._-]?6[._-]?luna/ }),
  Object.freeze({ key: "gpt-6-sol", pattern: /gpt[._-]?6[._-]?sol/ }),
  Object.freeze({ key: "gpt-5.6-luna", pattern: /gpt[._-]?5[._-]?6[._-]?luna/ }),
  Object.freeze({ key: "gpt-5.6-sol", pattern: /gpt[._-]?5[._-]?6[._-]?sol/ }),
  Object.freeze({ key: "gpt-5.6-terra", pattern: /gpt[._-]?5[._-]?6[._-]?terra/ }),
  Object.freeze({ key: "gpt-5.4-mini", pattern: /gpt[._-]?5[._-]?4[._-]?mini/ }),
  Object.freeze({ key: "gpt-5.4-nano", pattern: /gpt[._-]?5[._-]?4[._-]?nano/ }),
  Object.freeze({ key: "gpt-5-mini", pattern: /gpt[._-]?5[._-]?mini/ }),
  Object.freeze({ key: "gpt-5.1", pattern: /gpt[._-]?5[._-]?1/ }),
  Object.freeze({ key: "gpt-5", pattern: /gpt[._-]?5(?:[^0-9]|$)/ }),
  Object.freeze({ key: "gpt-4.1", pattern: /gpt[._-]?4[._-]?1/ }),
  Object.freeze({ key: "gpt-4o-mini", pattern: /gpt[._-]?4o[._-]?mini/ }),
  // Anthropic
  Object.freeze({ key: "claude-fable-5-1", pattern: /claude[._-]?fable/ }),
  Object.freeze({ key: "claude-opus-5-5", pattern: /claude[._-]?opus[._-]?5/ }),
  Object.freeze({ key: "claude-sonnet-5-5", pattern: /claude[._-]?sonnet[._-]?5/ }),
  Object.freeze({ key: "claude-haiku-5-5", pattern: /claude[._-]?haiku/ }),
  // Moonshot Kimi (aliases last so specific ids win)
  Object.freeze({ key: "kimi-k3.1-pro-highspeed", pattern: /kimi[._-]?k3[._-]?1[._-]?pro[._-]?highspeed/ }),
  Object.freeze({ key: "kimi-k3.1-pro", pattern: /kimi[._-]?k3[._-]?1[._-]?pro/ }),
  Object.freeze({ key: "kimi-k3", pattern: /kimi[._-]?k3/ }),
  Object.freeze({ key: "kimi-k2.7-code-highspeed", pattern: /kimi[._-]?k2[._-]?7[._-]?code[._-]?highspeed/ }),
  Object.freeze({ key: "kimi-k2.7-code-highspeed", pattern: /kimi[._-]?for[._-]?coding[._-]?highspeed/ }),
  Object.freeze({ key: "kimi-k2.7-code", pattern: /kimi[._-]?k2[._-]?7[._-]?code(?:[^a-z0-9]|$)/ }),
  Object.freeze({ key: "kimi-k2.7-code", pattern: /kimi[._-]?for[._-]?coding(?:[^a-z0-9]|$)/ }),
  Object.freeze({ key: "kimi-k2.6", pattern: /kimi[._-]?k2[._-]?6/ }),
  Object.freeze({ key: "kimi-k3", pattern: /(?:^|[^a-z0-9])k3(?:[^0-9]|$)/ }),
  // Tencent Hunyuan (TokenHub list)
  Object.freeze({ key: "hy4-preview", pattern: /hy4/ }),
  Object.freeze({ key: "hy3", pattern: /(?:^|[^a-z0-9])hy3(?:[^a-z0-9]|$)/ }),
  // Google Gemini
  Object.freeze({ key: "gemini-4-argon", pattern: /gemini[._-]?4/ }),
  // Meta Muse
  Object.freeze({ key: "muse-spark-1.3-contributor", pattern: /muse.*1[._-]?3/ }),
  Object.freeze({ key: "muse-wonder", pattern: /muse[._-]?wonder/ }),
]);

/**
 * Backward-compatible export: the DeepSeek CNY list. Prefer
 * {@link priceForRoute} / {@link effectivePrice}.
 */
export const PRICE_TABLE = Object.freeze({
  "deepseek-flash": OFFICIAL_PRICE_TABLE["deepseek-flash"],
  "deepseek-v4-pro": OFFICIAL_PRICE_TABLE["deepseek-v4-pro"],
});

const EMPTY_HOLIDAYS = Object.freeze(new Set());

/**
 * Lower-case `provider/model` route key. Missing halves become `unknown`.
 * @param {unknown} provider - provider route id from `message.source`.
 * @param {unknown} model - model id from `message.source`.
 * @returns {string} lower-cased `provider/model`.
 */
export function normalizeRoute(provider, model) {
  const p = String(provider ?? "").trim().toLowerCase() || "unknown";
  const m = String(model ?? "").trim().toLowerCase() || "unknown";
  return `${p}/${m}`;
}

/**
 * Model segment of a lower-cased route (the part after the first `/`).
 * @param {string} route - `provider/model`.
 * @returns {string} lower-cased model id.
 */
export function modelSegmentOf(route) {
  const text = String(route ?? "").toLowerCase();
  const slash = text.indexOf("/");
  return slash >= 0 ? text.slice(slash + 1) : text;
}

/**
 * Vendor hint for one lower-cased route, used for display even when the model
 * has no verified price list. Never produces a price.
 * @param {string} route - `provider/model`.
 * @returns {string | null} vendor id or null.
 */
export function vendorHintOf(route) {
  const model = modelSegmentOf(route);
  for (const matcher of VENDOR_HINT_MATCHERS) {
    if (matcher.pattern.test(model)) return matcher.vendor;
  }
  return null;
}

/**
 * Normalize one holiday entry to a Beijing calendar date `YYYY-MM-DD`.
 * Accepts `YYYY-MM-DD` (and `YYYY/MM/DD`, `YYYYMMDD`).
 * @param {unknown} value - raw holiday entry.
 * @returns {string | null} normalized date, or null when unusable.
 */
export function normalizeHoliday(value) {
  const text = String(value ?? "").trim();
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/**
 * Build the immutable pricing context reused across one aggregation pass.
 * @param {object} [options] - pricing options.
 * @param {Iterable<string>} [options.holidays] - Beijing dates billed off-peak.
 * @param {number} [options.usdRate] - CNY per 1 USD used for USD vendor lists.
 * @returns {{holidays: Set<string>, version: string, peakMultiplier: number, usdRate: number}} pricing context.
 */
export function createPricing(options = {}) {
  const source = options.holidays ?? [];
  const holidays = new Set();
  for (const value of source) {
    const normalized = normalizeHoliday(value);
    if (normalized !== null) holidays.add(normalized);
  }
  const rate = Number(options.usdRate);
  return Object.freeze({
    holidays: holidays.size === 0 ? EMPTY_HOLIDAYS : Object.freeze(holidays),
    version: PRICE_TABLE_VERSION,
    peakMultiplier: PEAK_MULTIPLIER,
    usdRate: Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_RATE,
  });
}

/**
 * Resolve the vendor-official price row for one lower-cased route.
 * @param {string} route - `provider/model`, already lower-cased.
 * @returns {object | null} row with key/vendor/currency/sourceUrl, or null when the vendor list is not verified.
 */
export function priceForRoute(route) {
  const text = String(route ?? "").toLowerCase();
  if (text === "") return null;
  const model = modelSegmentOf(text);
  const exact = OFFICIAL_PRICE_TABLE[model];
  if (exact !== undefined) return Object.freeze({ ...exact, key: model, priceLevel: "official" });
  for (const matcher of OFFICIAL_MODEL_MATCHERS) {
    if (matcher.pattern.test(model)) {
      const row = OFFICIAL_PRICE_TABLE[matcher.key];
      if (row !== undefined) return Object.freeze({ ...row, key: matcher.key, priceLevel: "official" });
    }
  }
  return null;
}

/**
 * Beijing calendar date of one epoch-millisecond instant.
 * @param {number} timeMs - Unix epoch milliseconds.
 * @returns {string} `YYYY-MM-DD` in Beijing time.
 */
export function beijingDateOf(timeMs) {
  const date = new Date(Number(timeMs) + BEIJING_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether one instant falls in a DeepSeek peak window (Beijing wall clock).
 * @param {number} timeMs - Unix epoch milliseconds.
 * @param {{holidays?: Set<string>}} [pricing] - pricing context (holiday set).
 * @returns {boolean} true for peak pricing.
 */
export function isPeakTime(timeMs, pricing) {
  const time = Number(timeMs);
  if (!Number.isFinite(time)) return false;
  const date = new Date(time + BEIJING_OFFSET_MS);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const holidays = pricing?.holidays ?? EMPTY_HOLIDAYS;
  if (holidays.has(beijingDateOf(time))) return false;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  for (const [startHour, endHour] of PEAK_HOURS) {
    if (minutes >= startHour * 60 && minutes < endHour * 60) return true;
  }
  return false;
}

/**
 * Pick the price tier in effect at one instant. Rows without `tiers` are flat.
 * @param {object} row - price row (may carry `tiers`).
 * @param {number} timeMs - event time in epoch milliseconds.
 * @returns {{cacheRead: number, cacheWrite: number, input: number, output: number}} tier prices.
 */
function pickTier(row, timeMs) {
  const tiers = Array.isArray(row.tiers) ? row.tiers : null;
  if (tiers === null) return row;
  const time = Number(timeMs);
  let chosen = tiers[0];
  for (const tier of tiers) {
    if (Number(tier.from) <= time) chosen = tier;
  }
  return chosen;
}

/**
 * Effective CNY per-million prices for one route at one instant.
 *
 * Only vendor-official rows are priced. CNY rows are used verbatim; USD rows
 * are converted with the pricing context's `usdRate`. Only DeepSeek rows can be
 * peak-scaled. A model with no verified vendor list is `unpriced`: `priced`
 * false, `priceLevel: "unpriced"`, every price 0 — it is never guessed.
 * @param {string} route - lower-cased `provider/model`.
 * @param {number} timeMs - instant used to choose peak or off-peak.
 * @param {{holidays?: Set<string>, usdRate?: number}} [pricing] - pricing context.
 * @returns {object} effective price with vendor/priceLevel/sourceUrl.
 */
export function effectivePrice(route, timeMs, pricing) {
  const context = pricing ?? createPricing();
  const usdRate = Number(context.usdRate) > 0 ? Number(context.usdRate) : DEFAULT_USD_RATE;
  const row = priceForRoute(route);
  if (row === null) {
    return {
      priced: false,
      key: null,
      label: null,
      vendor: vendorHintOf(route),
      currency: null,
      priceLevel: "unpriced",
      sourceUrl: null,
      verifiedAt: null,
      note: null,
      peak: false,
      multiplier: 1,
      usdRate: 1,
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
    };
  }
  const peak = row.peakApplies === true ? isPeakTime(timeMs, context) : false;
  const multiplier = peak ? PEAK_MULTIPLIER : 1;
  const rate = row.currency === "USD" ? usdRate : 1;
  const tier = pickTier(row, timeMs);
  const scale = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.round(number * multiplier * rate * 1_000_000) / 1_000_000;
  };
  return {
    priced: true,
    key: row.key,
    label: row.label,
    vendor: row.vendor,
    currency: row.currency,
    priceLevel: "official",
    sourceUrl: row.sourceUrl ?? null,
    verifiedAt: row.verifiedAt ?? null,
    note: row.note ?? null,
    peak,
    multiplier,
    usdRate: rate,
    cacheRead: scale(tier.cacheRead),
    cacheWrite: scale(tier.cacheWrite ?? tier.input),
    input: scale(tier.input),
    output: scale(tier.output),
  };
}

/**
 * Estimate the CNY cost of one disjoint token usage under one route at one
 * instant. Models without a verified vendor list cost 0 and report
 * `priced: false` / `priceLevel: "unpriced"`.
 * @param {{inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number}} usage - disjoint token counts.
 * @param {string} route - lower-cased `provider/model`.
 * @param {number} timeMs - event time (epoch ms) choosing peak or off-peak.
 * @param {{holidays?: Set<string>, usdRate?: number}} [pricing] - pricing context.
 * @returns {{costCNY: number, priced: boolean, priceKey: string|null, priceLevel: string, vendor: string|null, sourceUrl: string|null, peak: boolean, price: object}} cost estimate.
 */
export function costOfUsage(usage, route, timeMs, pricing) {
  const price = effectivePrice(route, timeMs, pricing);
  if (!price.priced) {
    return {
      costCNY: 0,
      priced: false,
      priceKey: null,
      priceLevel: "unpriced",
      vendor: price.vendor,
      sourceUrl: null,
      peak: false,
      price,
    };
  }
  const input = numberOrZero(usage?.inputTokens);
  const output = numberOrZero(usage?.outputTokens);
  const cacheRead = numberOrZero(usage?.cacheReadTokens);
  const cacheWrite = numberOrZero(usage?.cacheWriteTokens);
  const costCNY =
    (cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + input * price.input + output * price.output) /
    1_000_000;
  return {
    costCNY: roundMoney(costCNY),
    priced: true,
    priceKey: price.key,
    priceLevel: "official",
    vendor: price.vendor,
    sourceUrl: price.sourceUrl,
    peak: price.peak,
    price,
  };
}

/**
 * Convert an authoritative CNY amount to USD at a display rate.
 * @param {number} cny - amount in CNY.
 * @param {number} usdRate - CNY per 1 USD (> 0).
 * @returns {number} amount in USD (0 when the rate is unusable).
 */
export function cnyToUsd(cny, usdRate) {
  const rate = Number(usdRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return roundMoney(numberOrZero(cny) / rate);
}

/**
 * Normalize one usage record into disjoint, non-negative counts.
 * @param {unknown} usage - raw `TokenUsage`-shaped value.
 * @returns {{inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, totalTokens: number}} normalized usage.
 */
export function normalizeUsage(usage) {
  const inputTokens = numberOrZero(usage?.inputTokens);
  const outputTokens = numberOrZero(usage?.outputTokens);
  const cacheReadTokens = numberOrZero(usage?.cacheReadTokens);
  const cacheWriteTokens = numberOrZero(usage?.cacheWriteTokens);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

/** @param {unknown} value - candidate number. @returns {number} finite non-negative number or 0. */
function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** @param {number} value - money amount. @returns {number} rounded to 6 decimals. */
function roundMoney(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

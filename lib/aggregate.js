/**
 * Pure session-log aggregation: `assistant/message` usage events → per-session
 * hourly buckets → window overview (totals, daily series, model shares,
 * composition). No I/O, no globals, no dependencies outside `./pricing.js`.
 *
 * Contract (verified against `dsh-session` / `dsh-llm` types):
 * - only `type === "assistant/message"` events carry `data.usage`; every other
 *   event type is skipped without throwing (`assistant/attempt` never counts);
 * - `usage.inputTokens` is UNCACHED input, so total tokens are the sum of the
 *   four disjoint buckets and the cache-hit denominator is
 *   `inputTokens + cacheReadTokens + cacheWriteTokens`;
 * - the producing route is `data.message.source = { kind: "model", provider,
 *   model }`, missing routes fall back to `unknown/unknown` (unpriced);
 * - `event.time` is Unix epoch milliseconds.
 *
 * @module dsh-session-stats-panel/aggregate
 */

import {
  BEIJING_OFFSET_MS,
  SEARCH_REQUEST_PRICE_CNY,
  cnyToUsd,
  costOfUsage,
  createPricing,
  normalizeRoute,
  normalizeUsage,
  searchCost,
} from "./pricing.js";

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;
/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** Buckets older than this are pruned from the in-memory cache (largest window is 30 days). */
export const MAX_BUCKET_AGE_MS = 31 * DAY_MS;

/** Supported time windows: `hours` for hourly buckets, `days` for daily buckets. */
export const WINDOWS = Object.freeze({
  "24h": Object.freeze({ key: "24h", hours: 24, granularity: "hour", zh: "近 24 小时", en: "Last 24 hours" }),
  "7d": Object.freeze({ key: "7d", days: 7, granularity: "day", zh: "近 7 天", en: "Last 7 days" }),
  "14d": Object.freeze({ key: "14d", days: 14, granularity: "day", zh: "近 14 天", en: "Last 14 days" }),
  "30d": Object.freeze({ key: "30d", days: 30, granularity: "day", zh: "近 30 天", en: "Last 30 days" }),
});

/** Default window key used when a request names an unknown window. */
export const DEFAULT_WINDOW = "7d";

/** Default USD display rate (CNY per 1 USD); CNY stays authoritative. */
export const DEFAULT_USD_RATE = 7.1;

/**
 * Stable chart palette for per-model series (10 colors, Open-Color-derived).
 * Green occupies only the first slot; the rest are blue / purple / orange /
 * cyan / pink / yellow / indigo / brown / gray. The order is fixed so a model
 * keeps its color across re-renders; the client only ever reads these values
 * from the response.
 */
export const MODEL_PALETTE = Object.freeze([
  "#12b886",
  "#4dabf7",
  "#9775fa",
  "#ff922b",
  "#22b8cf",
  "#f06595",
  "#fcc419",
  "#5c7cfa",
  "#b08968",
  "#adb5bd",
]);

/** Neutral series color for models beyond the palette (and for "other"). */
export const OTHER_MODEL_COLOR = "#868e96";

/**
 * Extract the disjoint token usage of one event.
 * @param {unknown} event - raw `SessionEvent`.
 * @returns {{inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, totalTokens: number} | null} usage, or null when the event carries none.
 */
export function usageOfEvent(event) {
  if (event === null || typeof event !== "object") return null;
  if (event.type !== "assistant/message") return null;
  const data = event.data;
  if (data === null || typeof data !== "object" || data.usage === undefined) return null;
  const usage = normalizeUsage(data.usage);
  return usage.totalTokens > 0 ? usage : null;
}

/**
 * Extract the producing route of one event.
 * @param {unknown} event - raw `SessionEvent`.
 * @returns {{provider: string, model: string, route: string}} provider, model, and lower-cased route.
 */
export function routeOfEvent(event) {
  const source = event?.data?.message?.source;
  if (source !== null && typeof source === "object" && source.kind === "model") {
    const provider = String(source.provider ?? "unknown") || "unknown";
    const model = String(source.model ?? "unknown") || "unknown";
    return { provider, model, route: normalizeRoute(provider, model) };
  }
  return { provider: "unknown", model: "unknown", route: normalizeRoute("unknown", "unknown") };
}

/**
 * Beijing hour index of one instant (UTC hour index shifted by the fixed +8h
 * offset, so the same integer maps back to the same Beijing wall-clock hour).
 * @param {number} timeMs - Unix epoch milliseconds.
 * @returns {number} floor(time / 1h).
 */
export function hourIndexOf(timeMs) {
  return Math.floor(Number(timeMs) / HOUR_MS);
}

/**
 * Beijing day index of one instant (days since 1970-01-01 in Beijing).
 * @param {number} timeMs - Unix epoch milliseconds.
 * @returns {number} floor((time + 8h) / 24h).
 */
export function dayIndexOf(timeMs) {
  return Math.floor((Number(timeMs) + BEIJING_OFFSET_MS) / DAY_MS);
}

/** @returns {object} one empty aggregation bucket. */
function createBucket() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    costCNY: 0,
    searchCostCNY: 0,
    searches: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    events: 0,
    peakEvents: 0,
    offPeakEvents: 0,
    models: new Map(),
  };
}

/**
 * Merge one priced usage event into a bucket.
 * @param {object} bucket - mutable bucket.
 * @param {object} usage - normalized disjoint usage.
 * @param {{costCNY: number, priced: boolean, priceKey: string|null, priceLevel: string, peak: boolean}} cost - priced event cost.
 * @param {{provider: string, model: string, route: string}} routeInfo - producing route.
 * @param {number} time - event time (epoch ms), tracked per model for stable color order.
 * @returns {void}
 */
function addToBucket(bucket, usage, cost, routeInfo, time) {
  bucket.input += usage.inputTokens;
  bucket.output += usage.outputTokens;
  bucket.cacheRead += usage.cacheReadTokens;
  bucket.cacheWrite += usage.cacheWriteTokens;
  bucket.tokens += usage.totalTokens;
  bucket.costCNY += cost.costCNY;
  bucket.events += 1;
  if (cost.peak) bucket.peakEvents += 1;
  else bucket.offPeakEvents += 1;
  if (cost.priced) bucket.pricedTokens += usage.totalTokens;
  else bucket.unpricedTokens += usage.totalTokens;
  let model = bucket.models.get(routeInfo.route);
  if (model === undefined) {
    model = {
      provider: routeInfo.provider,
      model: routeInfo.model,
      route: routeInfo.route,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 0,
      costCNY: 0,
      pricedTokens: 0,
      unpricedTokens: 0,
      events: 0,
      priced: cost.priced,
      priceKey: cost.priceKey ?? null,
      vendor: cost.vendor ?? null,
      priceLevel: cost.priceLevel ?? null,
      sourceUrl: cost.sourceUrl ?? null,
      firstTime: time,
      lastTime: time,
    };
    bucket.models.set(routeInfo.route, model);
  }
  model.input += usage.inputTokens;
  model.output += usage.outputTokens;
  model.cacheRead += usage.cacheReadTokens;
  model.cacheWrite += usage.cacheWriteTokens;
  model.tokens += usage.totalTokens;
  model.costCNY += cost.costCNY;
  model.events += 1;
  if (model.firstTime === null || time < model.firstTime) model.firstTime = time;
  if (model.lastTime === null || time > model.lastTime) model.lastTime = time;
  if (model.priceKey === null && cost.priceKey !== undefined) model.priceKey = cost.priceKey;
  if (model.vendor === null && cost.vendor !== undefined) model.vendor = cost.vendor;
  if (model.priceLevel === null && cost.priceLevel !== undefined) model.priceLevel = cost.priceLevel;
  if (model.sourceUrl === null && cost.sourceUrl !== undefined) model.sourceUrl = cost.sourceUrl;
  if (cost.priced) model.pricedTokens += usage.totalTokens;
  else {
    model.unpricedTokens += usage.totalTokens;
    model.priced = false;
  }
}

/**
 * Whether one log event is a billable official web-search request. DSH bills
 * each `web/deepseek-search-llm-request` event once, even when the same query
 * also produces a `tool/call` event — counting tool calls would undercount.
 * @param {unknown} event - raw session event.
 * @returns {boolean} true for one billable search request.
 */
function isSearchEvent(event) {
  const type = typeof event?.type === "string" ? event.type : "";
  return type === "web/deepseek-search-llm-request" || type.includes("search-llm-request");
}

/**
 * Aggregate one complete session log into hourly usage buckets.
 * @param {string} sessionId - logical session id.
 * @param {readonly unknown[]} events - complete raw event log of the session.
 * @param {object} [options] - aggregation options.
 * @param {number} [options.createdAt] - session creation time (epoch ms).
 * @param {ReturnType<typeof createPricing>} [options.pricing] - pricing context.
 * @param {number} [options.now] - reference instant used to prune old buckets.
 * @returns {{sessionId: string, createdAt: number, hours: Map<number, object>, events: number, firstTime: number|null, lastTime: number|null}} session aggregate.
 */
export function summarizeSessionEvents(sessionId, events, options = {}) {
  const pricing = options.pricing ?? createPricing();
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const cutoffHour = hourIndexOf(now - MAX_BUCKET_AGE_MS);
  const aggregate = {
    sessionId: String(sessionId ?? ""),
    createdAt: Number.isFinite(options.createdAt) ? Number(options.createdAt) : 0,
    hours: new Map(),
    events: 0,
    searches: 0,
    firstTime: null,
    lastTime: null,
  };
  if (!Array.isArray(events)) return aggregate;
  for (const event of events) {
    const time = Number(event.time);
    if (!Number.isFinite(time)) continue;
    const hour = hourIndexOf(time);
    if (hour < cutoffHour) continue;
    const search = isSearchEvent(event);
    const usage = search ? null : usageOfEvent(event);
    if (!search && usage === null) continue;
    let bucket = aggregate.hours.get(hour);
    if (bucket === undefined) {
      bucket = createBucket();
      aggregate.hours.set(hour, bucket);
    }
    if (search) {
      bucket.searches += 1;
      bucket.searchCostCNY += SEARCH_REQUEST_PRICE_CNY;
      aggregate.searches += 1;
    } else {
      const routeInfo = routeOfEvent(event);
      const cost = costOfUsage(usage, routeInfo.route, time, pricing);
      addToBucket(bucket, usage, cost, routeInfo, time);
      aggregate.events += 1;
    }
    if (aggregate.firstTime === null || time < aggregate.firstTime) aggregate.firstTime = time;
    if (aggregate.lastTime === null || time > aggregate.lastTime) aggregate.lastTime = time;
  }
  return aggregate;
}

/**
 * Drop buckets that fell out of the largest supported window.
 * @param {object} aggregate - mutable session aggregate.
 * @param {number} now - reference instant (epoch ms).
 * @returns {object} the same aggregate.
 */
export function pruneSessionAggregate(aggregate, now) {
  const cutoffHour = hourIndexOf(now - MAX_BUCKET_AGE_MS);
  for (const hour of aggregate.hours.keys()) {
    if (hour < cutoffHour) aggregate.hours.delete(hour);
  }
  return aggregate;
}

/**
 * Resolve one window into its aligned bucket list.
 * @param {string} windowKey - one of {@link WINDOWS}; unknown keys fall back to `7d`.
 * @param {number} nowMs - reference instant (epoch ms).
 * @returns {{key: string, granularity: "hour"|"day", buckets: Array<{key: number, label: string, start: number, end: number}>, startHour: number|null, endHour: number|null, startDay: number|null, endDay: number|null, from: number, to: number, labelZh: string, labelEn: string}} window descriptor.
 */
export function resolveWindow(windowKey, nowMs) {
  const key = WINDOWS[windowKey] !== undefined ? windowKey : DEFAULT_WINDOW;
  const spec = WINDOWS[key];
  const now = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
  if (spec.granularity === "hour") {
    const endHour = hourIndexOf(now);
    const startHour = endHour - (spec.hours - 1);
    const buckets = [];
    for (let index = 0; index < spec.hours; index += 1) {
      const hour = startHour + index;
      const beijingHour = (((hour + 8) % 24) + 24) % 24;
      buckets.push({
        key: hour,
        label: `${String(beijingHour).padStart(2, "0")}:00`,
        start: hour * HOUR_MS,
        end: (hour + 1) * HOUR_MS,
      });
    }
    return {
      key,
      granularity: "hour",
      buckets,
      startHour,
      endHour,
      startDay: null,
      endDay: null,
      from: startHour * HOUR_MS,
      to: (endHour + 1) * HOUR_MS,
      labelZh: spec.zh,
      labelEn: spec.en,
    };
  }
  const endDay = dayIndexOf(now);
  const startDay = endDay - (spec.days - 1);
  const buckets = [];
  for (let index = 0; index < spec.days; index += 1) {
    const day = startDay + index;
    // day * DAY_MS read through UTC getters yields the Beijing calendar date.
    const date = new Date(day * DAY_MS);
    buckets.push({
      key: day,
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      start: day * DAY_MS - BEIJING_OFFSET_MS,
      end: (day + 1) * DAY_MS - BEIJING_OFFSET_MS,
    });
  }
  return {
    key,
    granularity: "day",
    buckets,
    startHour: null,
    endHour: null,
    startDay,
    endDay,
    from: startDay * DAY_MS - BEIJING_OFFSET_MS,
    to: (endDay + 1) * DAY_MS - BEIJING_OFFSET_MS,
    labelZh: spec.zh,
    labelEn: spec.en,
  };
}

/**
 * Map one Beijing hour index onto the window bucket array index.
 * @param {ReturnType<typeof resolveWindow>} window - resolved window.
 * @param {number} hour - Beijing hour index.
 * @returns {number} bucket index, or -1 when the hour falls outside the window.
 */
export function windowBucketIndexOf(window, hour) {
  if (window.granularity === "hour") {
    const index = hour - window.startHour;
    return index >= 0 && index < window.buckets.length ? index : -1;
  }
  const day = dayIndexOf(hour * HOUR_MS);
  const index = day - window.startDay;
  return index >= 0 && index < window.buckets.length ? index : -1;
}

/**
 * Merge one bucket into another (models included).
 * @param {object} target - mutable target bucket.
 * @param {object} source - bucket to fold in.
 * @returns {void}
 */
function mergeBucket(target, source) {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.tokens += source.tokens;
  target.costCNY += source.costCNY;
  target.searchCostCNY += source.searchCostCNY ?? 0;
  target.searches += source.searches ?? 0;
  target.pricedTokens += source.pricedTokens;
  target.unpricedTokens += source.unpricedTokens;
  target.events += source.events;
  target.peakEvents += source.peakEvents;
  target.offPeakEvents += source.offPeakEvents;
  for (const [route, model] of source.models) {
    let targetModel = target.models.get(route);
    if (targetModel === undefined) {
      target.models.set(route, { ...model });
      continue;
    }
    targetModel.input += model.input;
    targetModel.output += model.output;
    targetModel.cacheRead += model.cacheRead;
    targetModel.cacheWrite += model.cacheWrite;
    targetModel.tokens += model.tokens;
    targetModel.costCNY += model.costCNY;
    targetModel.pricedTokens += model.pricedTokens;
    targetModel.unpricedTokens += model.unpricedTokens;
    targetModel.events += model.events;
    if (model.firstTime !== null && (targetModel.firstTime === null || model.firstTime < targetModel.firstTime)) {
      targetModel.firstTime = model.firstTime;
    }
    if (model.lastTime !== null && (targetModel.lastTime === null || model.lastTime > targetModel.lastTime)) {
      targetModel.lastTime = model.lastTime;
    }
    if (targetModel.priceKey === null && model.priceKey !== null) targetModel.priceKey = model.priceKey;
    if (targetModel.vendor === null && model.vendor !== null) targetModel.vendor = model.vendor;
    if (targetModel.priceLevel === null && model.priceLevel !== null) targetModel.priceLevel = model.priceLevel;
    if (targetModel.sourceUrl === null && model.sourceUrl !== null) targetModel.sourceUrl = model.sourceUrl;
    if (!model.priced) targetModel.priced = false;
  }
}

/**
 * Round a money amount to 6 decimals (stable JSON, no float tails).
 * @param {number} value - amount.
 * @returns {number} rounded amount.
 */
function roundMoney(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Round one ratio to 6 decimals.
 * @param {number} value - ratio in [0, 1].
 * @returns {number} rounded ratio.
 */
function roundRatio(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Build the public overview payload for one window.
 * @param {readonly object[]} sessionAggregates - per-session aggregates.
 * @param {object} [options] - overview options.
 * @param {string} [options.windowKey] - requested window.
 * @param {number} [options.now] - reference instant (epoch ms).
 * @param {ReturnType<typeof createPricing>} [options.pricing] - pricing context.
 * @param {number} [options.usdRate] - CNY per 1 USD.
 * @param {number} [options.sessionsScanned] - number of session aggregates supplied.
 * @param {number} [options.sessionsTotal] - number of sessions the corpus listed.
 * @param {number} [options.readCount] - sessions re-read during this scan.
 * @param {number} [options.cachedCount] - sessions served from cache during this scan.
 * @returns {object} JSON-safe overview payload.
 */
export function buildOverview(sessionAggregates, options = {}) {
  const pricing = options.pricing ?? createPricing();
  const usdRate = Number.isFinite(options.usdRate) && options.usdRate > 0 ? Number(options.usdRate) : DEFAULT_USD_RATE;
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const window = resolveWindow(options.windowKey ?? DEFAULT_WINDOW, now);
  const windowBuckets = window.buckets.map(() => createBucket());
  const totals = createBucket();
  let sessions = 0;
  const aggregates = Array.isArray(sessionAggregates) ? sessionAggregates : [];
  for (const aggregate of aggregates) {
    if (aggregate === null || typeof aggregate !== "object") continue;
    const hours = aggregate.hours;
    if (!(hours instanceof Map)) continue;
    let inWindow = false;
    for (const [hour, bucket] of hours) {
      const index = windowBucketIndexOf(window, hour);
      if (index < 0) continue;
      mergeBucket(windowBuckets[index], bucket);
      mergeBucket(totals, bucket);
      inWindow = true;
    }
    if (inWindow) sessions += 1;
  }
  const cacheHitRate =
    totals.input + totals.cacheRead + totals.cacheWrite > 0
      ? roundRatio(totals.cacheRead / (totals.input + totals.cacheRead + totals.cacheWrite))
      : 0;

  // Stable per-model identity: label (model id, provider-qualified when two
  // routes share a model id) and color (palette slot by first appearance in the
  // window; later models share the neutral "other" color).
  const modelEntries = [...totals.models.values()];
  const firstSeenOrder = [...modelEntries].sort(
    (left, right) =>
      (left.firstTime ?? Number.POSITIVE_INFINITY) - (right.firstTime ?? Number.POSITIVE_INFINITY) ||
      left.route.localeCompare(right.route),
  );
  const colorByRoute = new Map();
  firstSeenOrder.forEach((model, index) => {
    colorByRoute.set(model.route, index < MODEL_PALETTE.length ? MODEL_PALETTE[index] : OTHER_MODEL_COLOR);
  });
  const nameCounts = new Map();
  for (const model of modelEntries) nameCounts.set(model.model, (nameCounts.get(model.model) ?? 0) + 1);
  const labelByRoute = new Map();
  for (const model of modelEntries) {
    const duplicated = (nameCounts.get(model.model) ?? 0) > 1;
    labelByRoute.set(model.route, duplicated ? `${model.provider}/${model.model}` : model.model);
  }

  const daily = window.buckets.map((bucket, index) => {
    const value = windowBuckets[index];
    const dayModels = [...value.models.values()]
      .map((model) => ({
        route: model.route,
        label: labelByRoute.get(model.route) ?? model.model,
        color: colorByRoute.get(model.route) ?? OTHER_MODEL_COLOR,
        vendor: model.vendor ?? null,
        priceLevel: model.priceLevel ?? null,
        tokens: model.tokens,
        costCNY: roundMoney(model.costCNY),
        costUSD: cnyToUsd(model.costCNY, usdRate),
        share: value.tokens > 0 ? roundRatio(model.tokens / value.tokens) : 0,
      }))
      .sort((left, right) => right.tokens - left.tokens || left.route.localeCompare(right.route));
    return {
      key: String(bucket.key),
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      input: value.input,
      output: value.output,
      cacheRead: value.cacheRead,
      cacheWrite: value.cacheWrite,
      tokens: value.tokens,
      costCNY: roundMoney(value.costCNY),
      costUSD: cnyToUsd(value.costCNY, usdRate),
      searches: value.searches,
      searchCostCNY: roundMoney(value.searchCostCNY),
      events: value.events,
      models: dayModels,
    };
  });
  const models = modelEntries
    .map((model) => ({
      provider: model.provider,
      model: model.model,
      route: model.route,
      label: labelByRoute.get(model.route) ?? model.model,
      color: colorByRoute.get(model.route) ?? OTHER_MODEL_COLOR,
      input: model.input,
      output: model.output,
      cacheRead: model.cacheRead,
      cacheWrite: model.cacheWrite,
      tokens: model.tokens,
      costCNY: roundMoney(model.costCNY),
      costUSD: cnyToUsd(model.costCNY, usdRate),
      share: totals.tokens > 0 ? roundRatio(model.tokens / totals.tokens) : 0,
      events: model.events,
      priced: model.priced !== false && model.unpricedTokens === 0,
      priceKey: model.priceKey ?? null,
      vendor: model.vendor ?? null,
      priceLevel: model.priceLevel ?? null,
      sourceUrl: model.sourceUrl ?? null,
    }))
    .sort((left, right) => right.tokens - left.tokens || left.route.localeCompare(right.route));
  const searchCostCNY = searchCost(totals.searches);
  const costCNYTotal = roundMoney(totals.costCNY + searchCostCNY);
  if (totals.searches > 0) {
    models.push({
      provider: "official",
      model: "server-tool-search",
      route: "official/server-tool-search",
      label: "官方搜索",
      color: OTHER_MODEL_COLOR,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 0,
      costCNY: searchCostCNY,
      costUSD: cnyToUsd(searchCostCNY, usdRate),
      share: 0,
      shareByCost: costCNYTotal > 0 ? roundRatio(searchCostCNY / costCNYTotal) : 0,
      events: 0,
      priced: true,
      priceKey: "search:per-request",
      vendor: "deepseek",
      priceLevel: "official",
      sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
      costsOnly: true,
      searches: totals.searches,
    });
  }
  const unpricedModels = models.filter((model) => model.priceLevel === "unpriced");
  const unpricedTokens = unpricedModels.reduce((sum, model) => sum + model.tokens, 0);
  const composition = [
    { key: "cacheRead", tokens: totals.cacheRead },
    { key: "input", tokens: totals.input },
    { key: "output", tokens: totals.output },
  ];
  if (totals.cacheWrite > 0) composition.push({ key: "cacheWrite", tokens: totals.cacheWrite });
  for (const part of composition) {
    part.share = totals.tokens > 0 ? roundRatio(part.tokens / totals.tokens) : 0;
  }
  const peakEvents = totals.peakEvents;
  const offPeakEvents = totals.offPeakEvents;
  const pricingMode =
    peakEvents > 0 && offPeakEvents > 0
      ? "mixed"
      : peakEvents > 0
        ? "peak"
        : offPeakEvents > 0
          ? "offpeak"
          : "none";
  return {
    ok: true,
    generatedAt: now,
    window: {
      key: window.key,
      granularity: window.granularity,
      bucketCount: daily.length,
      from: window.from,
      to: window.to,
      label: window.labelZh,
      labelEn: window.labelEn,
      points: daily.map((point) => point.label),
    },
    currency: {
      code: "CNY",
      symbol: "¥",
      usdRate,
      usdSymbol: "$",
    },
    totals: {
      tokens: totals.tokens,
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      costCNY: roundMoney(totals.costCNY),
      costUSD: cnyToUsd(totals.costCNY, usdRate),
      searches: totals.searches,
      searchCostCNY,
      costCNYTotal,
      costCNYWithSearch: costCNYTotal,
      cacheHitRate,
      sessions,
      avgTokensPerSession: sessions > 0 ? Math.round(totals.tokens / sessions) : 0,
      pricedTokens: totals.pricedTokens,
      unpricedTokens,
      priced: unpricedTokens === 0,
      unpricedModels: unpricedModels.length,
      events: totals.events,
    },
    pricing: {
      tableVersion: pricing.version ?? "unknown",
      peakMultiplier: pricing.peakMultiplier ?? 2,
      peakEvents,
      offPeakEvents,
      mode: pricingMode,
      holidays: pricing.holidays instanceof Set ? [...pricing.holidays].sort() : [],
      usdRate: pricing.usdRate ?? null,
      fallbackTier: "deepseek-flash",
      officialLists: ["vendor-official"],
      search: {
        unit: "per-request",
        priceCNY: SEARCH_REQUEST_PRICE_CNY,
        note: "¥5 / 1000 次成功请求",
      },
      priceLevels: {
        official: models.filter((model) => !model.costsOnly && model.priceLevel === "official").length,
        unpriced: models.filter((model) => !model.costsOnly && model.priceLevel === "unpriced").length,
      },
    },
    modelPalette: [...MODEL_PALETTE],
    otherModelColor: OTHER_MODEL_COLOR,
    composition,
    daily,
    models,
    scan: {
      sessionsScanned: Number.isFinite(options.sessionsScanned) ? Number(options.sessionsScanned) : aggregates.length,
      sessionsTotal: Number.isFinite(options.sessionsTotal) ? Number(options.sessionsTotal) : aggregates.length,
      readCount: Number.isFinite(options.readCount) ? Number(options.readCount) : 0,
      cachedCount: Number.isFinite(options.cachedCount) ? Number(options.cachedCount) : 0,
    },
  };
}

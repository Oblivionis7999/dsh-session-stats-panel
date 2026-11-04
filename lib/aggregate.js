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
/** One minute in milliseconds (finest candle sampling bucket). */
export const MINUTE_MS = 60_000;
/** 15-minute sampling bucket used by the 7d / 14d candle windows. */
export const QUARTER_MS = 15 * MINUTE_MS;
/** Candles kept for the previous 24h only. */
const FINE_MINUTE_AGE_MS = 25 * 3_600_000;
/** 15-minute buckets kept for the previous 14 days. */
const FINE_QUARTER_AGE_MS = 15 * DAY_MS;

/** Candle resolution per window: bars, period, and the sampling bucket used for OHLC. */
export const CANDLE_SPECS = Object.freeze({
  "24h": Object.freeze({ period: "5m", periodMs: 5 * MINUTE_MS, sampleMs: MINUTE_MS, bars: 288, minutes: 5 }),
  "7d": Object.freeze({ period: "1h", periodMs: 60 * MINUTE_MS, sampleMs: QUARTER_MS, bars: 168, minutes: 15 }),
  "14d": Object.freeze({ period: "2h", periodMs: 120 * MINUTE_MS, sampleMs: QUARTER_MS, bars: 168, minutes: 15 }),
  "30d": Object.freeze({ period: "1d", periodMs: DAY_MS, sampleMs: 60 * MINUTE_MS, bars: 30, minutes: 60 }),
});

/** How many tape entries are kept per session aggregate. */
const TAPE_LIMIT = 20;

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
export function dayIndexOf(timeMs, offsetMs = BEIJING_OFFSET_MS) {
  return Math.floor((Number(timeMs) + Number(offsetMs)) / DAY_MS);
}

/**
 * UTC offset in milliseconds that a named IANA zone has at one instant.
 *
 * Displayed calendar days must follow the *viewer's* zone, not a hard-coded
 * +08:00: a user in Berlin opening "last 7 days" expects Berlin midnight
 * boundaries. Zones the runtime cannot resolve fall back to Asia/Shanghai so
 * the panel still renders (with the documented default).
 * @param {string} timeZone - IANA zone name.
 * @param {number} timeMs - epoch milliseconds.
 * @returns {number} offset in ms (east positive).
 */
export function zoneOffsetMs(timeZone, timeMs) {
  const zone = typeof timeZone === "string" && timeZone !== "" ? timeZone : "Asia/Shanghai";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(Number(timeMs)));
    const pick = (type) => Number((parts.find((part) => part.type === type) ?? {}).value);
    const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
    return asUtc - Math.floor(Number(timeMs) / 1000) * 1000;
  } catch {
    return BEIJING_OFFSET_MS;
  }
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
    calls: 0,
    sessionIds: new Set(),
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
  bucket.calls += 1;
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
    minutes: new Map(),
    quarters: new Map(),
    tape: [],
    events: 0,
    searches: 0,
    firstTime: null,
    lastTime: null,
  };
  if (!Array.isArray(events)) return aggregate;
  const minuteCutoff = now - FINE_MINUTE_AGE_MS;
  const quarterCutoff = now - FINE_QUARTER_AGE_MS;
  for (const event of events) {
    const time = Number(event.time);
    if (!Number.isFinite(time)) continue;
    const hour = hourIndexOf(time);
    if (hour < cutoffHour) continue;
    const search = isSearchEvent(event);
    const usage = search ? null : usageOfEvent(event);
    if (!search && usage === null) continue;
    const routeInfo = search ? null : routeOfEvent(event);
    const cost = search ? null : costOfUsage(usage, routeInfo.route, time, pricing);
    const recordInto = (bucket) => {
      if (search) {
        bucket.calls += 1;
        bucket.searches += 1;
        bucket.searchCostCNY += SEARCH_REQUEST_PRICE_CNY;
      } else {
        addToBucket(bucket, usage, cost, routeInfo, time);
      }
    };
    let bucket = aggregate.hours.get(hour);
    if (bucket === undefined) {
      bucket = createBucket();
      bucket.sessionIds.add(aggregate.sessionId);
      aggregate.hours.set(hour, bucket);
    }
    recordInto(bucket);
    // Fine-grained buckets feed the candlestick chart (24h / 7d / 14d).
    if (time >= minuteCutoff) {
      const key = Math.floor(time / MINUTE_MS);
      let fine = aggregate.minutes.get(key);
      if (fine === undefined) {
        fine = createBucket();
        fine.sessionIds.add(aggregate.sessionId);
        aggregate.minutes.set(key, fine);
      }
      recordInto(fine);
    }
    if (time >= quarterCutoff) {
      const key = Math.floor(time / QUARTER_MS);
      let fine = aggregate.quarters.get(key);
      if (fine === undefined) {
        fine = createBucket();
        fine.sessionIds.add(aggregate.sessionId);
        aggregate.quarters.set(key, fine);
      }
      recordInto(fine);
    }
    if (search) {
      aggregate.searches += 1;
    } else {
      aggregate.events += 1;
    }
    aggregate.tape.push(
      search
        ? { t: time, kind: "search", model: "官方搜索", tokens: 0, costCNY: SEARCH_REQUEST_PRICE_CNY }
        : { t: time, kind: "chat", model: routeInfo.model, tokens: usage.totalTokens, costCNY: cost.costCNY },
    );
    if (aggregate.tape.length > TAPE_LIMIT) aggregate.tape.shift();
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
  const minuteCutoff = Math.floor((now - FINE_MINUTE_AGE_MS) / MINUTE_MS);
  if (aggregate.minutes instanceof Map) {
    for (const key of aggregate.minutes.keys()) {
      if (key < minuteCutoff) aggregate.minutes.delete(key);
    }
  }
  const quarterCutoff = Math.floor((now - FINE_QUARTER_AGE_MS) / QUARTER_MS);
  if (aggregate.quarters instanceof Map) {
    for (const key of aggregate.quarters.keys()) {
      if (key < quarterCutoff) aggregate.quarters.delete(key);
    }
  }
  return aggregate;
}

/**
 * Resolve one window into its aligned bucket list.
 * @param {string} windowKey - one of {@link WINDOWS}; unknown keys fall back to `7d`.
 * @param {number} nowMs - reference instant (epoch ms).
 * @returns {{key: string, granularity: "hour"|"day", buckets: Array<{key: number, label: string, start: number, end: number}>, startHour: number|null, endHour: number|null, startDay: number|null, endDay: number|null, from: number, to: number, labelZh: string, labelEn: string}} window descriptor.
 */
export function resolveWindow(windowKey, nowMs, offsetMs = BEIJING_OFFSET_MS) {
  const key = WINDOWS[windowKey] !== undefined ? windowKey : DEFAULT_WINDOW;
  const spec = WINDOWS[key];
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const zoneOffset = Number.isFinite(offsetMs) ? Number(offsetMs) : BEIJING_OFFSET_MS;
  if (spec.granularity === "hour") {
    const endHour = hourIndexOf(now);
    const startHour = endHour - (spec.hours - 1);
    const buckets = [];
    for (let index = 0; index < spec.hours; index += 1) {
      const hour = startHour + index;
      const zoneHours = Math.round(zoneOffset / HOUR_MS);
      const beijingHour = (((hour + zoneHours) % 24) + 24) % 24;
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
  const endDay = dayIndexOf(now, zoneOffset);
  const startDay = endDay - (spec.days - 1);
  const buckets = [];
  for (let index = 0; index < spec.days; index += 1) {
    const day = startDay + index;
    // day * DAY_MS read through UTC getters yields the Beijing calendar date.
    const date = new Date(day * DAY_MS);
    buckets.push({
      key: day,
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      start: day * DAY_MS - zoneOffset,
      end: (day + 1) * DAY_MS - zoneOffset,
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
    from: startDay * DAY_MS - zoneOffset,
    to: (endDay + 1) * DAY_MS - zoneOffset,
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
  target.calls += source.calls ?? 0;
  for (const id of source.sessionIds ?? []) target.sessionIds.add(id);
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

/** Rate of one sampling bucket: tokens per minute over the bucket width. */
function sampleRate(bucket, sampleMs) {
  const minutes = Math.max(1, sampleMs / MINUTE_MS);
  return bucket.tokens / minutes;
}

/** Cache-hit ratio of one bucket (0 when it has no prompt tokens). */
function bucketHitRate(bucket) {
  const denominator = bucket.input + bucket.cacheRead + bucket.cacheWrite;
  return denominator > 0 ? bucket.cacheRead / denominator : 0;
}

/** Resample an array of values into `count` evenly-sized sums. */
function resample(values, count) {
  const list = Array.isArray(values) ? values : [];
  const output = new Array(count).fill(0);
  if (list.length === 0) return output;
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor((index * list.length) / count);
    const to = Math.max(from + 1, Math.floor(((index + 1) * list.length) / count));
    let sum = 0;
    for (let cursor = from; cursor < to && cursor < list.length; cursor += 1) sum += list[cursor];
    output[index] = sum;
  }
  return output;
}

/** Percentage change between two totals (null when the base is 0). */
function changePct(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return roundRatio((current - previous) / previous);
}

/**
 * Build the candlestick series for one window. OHLC is expressed as the
 * sampling-bucket token rate (tokens/minute); an empty bucket carries the
 * previous close forward (o=h=l=c=previous close, vol=0, empty=true).
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {object} window - resolved window descriptor.
 * @param {number} now - reference instant.
 * @returns {{period: string, bars: object[]}} candle series.
 */
export function buildCandles(aggregates, window, now) {
  const spec = CANDLE_SPECS[window.key] ?? CANDLE_SPECS["7d"];
  const source = window.key === "24h" ? "minutes" : window.key === "30d" ? "hours" : "quarters";
  const sampleMs = spec.sampleMs;
  const periodMs = spec.periodMs;
  const endIndex = Math.floor(now / periodMs) + 1;
  const startIndex = endIndex - spec.bars;
  const start = startIndex * periodMs;
  const end = endIndex * periodMs;
  // Merge sample buckets across sessions first so each sample has the full rate.
  const samples = new Map();
  for (const aggregate of aggregates) {
    const map = aggregate?.[source];
    if (!(map instanceof Map)) continue;
    for (const [key, bucket] of map) {
      const time = key * sampleMs;
      if (time < start || time >= end) continue;
      let merged = samples.get(key);
      if (merged === undefined) {
        merged = createBucket();
        samples.set(key, merged);
      }
      mergeBucket(merged, bucket);
    }
  }
  const periods = new Map();
  for (const [key, bucket] of samples) {
    const time = key * sampleMs;
    const index = Math.floor(time / periodMs);
    let entry = periods.get(index);
    if (entry === undefined) {
      entry = { bucket: createBucket(), samples: [] };
      periods.set(index, entry);
    }
    mergeBucket(entry.bucket, bucket);
    entry.samples.push({ time, rate: sampleRate(bucket, sampleMs) });
  }
  const bars = [];
  let previousClose = null;
  for (let index = startIndex; index < endIndex; index += 1) {
    const entry = periods.get(index);
    const t = index * periodMs;
    if (entry === undefined || entry.samples.length === 0) {
      const close = previousClose === null ? 0 : previousClose;
      bars.push({ t, o: close, h: close, l: close, c: close, vol: 0, tokens: 0, costCNY: 0, calls: 0, sessions: 0, cacheHit: 0, byModel: [], empty: true });
      previousClose = close;
      continue;
    }
    entry.samples.sort((left, right) => left.time - right.time);
    const rates = entry.samples.map((sample) => sample.rate);
    const bucket = entry.bucket;
    const open = rates[0];
    const close = rates[rates.length - 1];
    const high = Math.max(...rates);
    const low = Math.min(...rates);
    const byModel = [...bucket.models.values()]
      .map((model) => ({ route: model.route, tokens: model.tokens }))
      .filter((model) => model.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens);
    bars.push({
      t,
      o: open,
      h: high,
      l: low,
      c: close,
      vol: bucket.calls,
      tokens: bucket.tokens,
      costCNY: roundMoney(bucket.costCNY + bucket.searchCostCNY),
      calls: bucket.calls,
      sessions: bucket.sessionIds.size,
      cacheHit: roundRatio(bucketHitRate(bucket)),
      byModel,
      empty: false,
    });
    previousClose = close;
  }
  return { period: spec.period, bars };
}

/**
 * Previous equal-length window totals, scanned from the hourly buckets.
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {object} window - resolved window descriptor.
 * @returns {{tokens: number, costCNY: number, sessions: number, cacheHit: number, searches: number}} previous totals.
 */
function previousWindowTotals(aggregates, window) {
  const spanHours = Math.max(1, Math.round((window.to - window.from) / HOUR_MS));
  const startHour = Math.floor(window.from / HOUR_MS) - spanHours;
  const endHour = Math.floor(window.from / HOUR_MS);
  const totals = createBucket();
  const sessionIds = new Set();
  for (const aggregate of aggregates) {
    if (!(aggregate?.hours instanceof Map)) continue;
    for (const [hour, bucket] of aggregate.hours) {
      if (hour < startHour || hour >= endHour) continue;
      mergeBucket(totals, bucket);
      for (const id of bucket.sessionIds) sessionIds.add(id);
    }
  }
  return {
    tokens: totals.tokens,
    costCNY: totals.costCNY + totals.searchCostCNY,
    sessions: sessionIds.size,
    cacheHit: bucketHitRate(totals),
    searches: totals.searches,
  };
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
  const timeZone = typeof options.timeZone === "string" && options.timeZone !== "" ? options.timeZone : "Asia/Shanghai";
  const zoneOffset = zoneOffsetMs(timeZone, now);
  const window = resolveWindow(options.windowKey ?? DEFAULT_WINDOW, now, zoneOffset);
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
  // Cost composition mirrors the token donut colours; only models with a
  // positive cost appear (unpriced models cost 0 and would add empty slices).
  const costComposition = models
    .filter((model) => model.costCNY > 0)
    .map((model) => ({
      key: model.route,
      route: model.route,
      label: model.label,
      vendor: model.vendor ?? null,
      color: model.color,
      costCNY: roundMoney(model.costCNY),
      share: costCNYTotal > 0 ? roundRatio(model.costCNY / costCNYTotal) : 0,
    }))
    .sort((left, right) => right.costCNY - left.costCNY || left.route.localeCompare(right.route));
  // ---- market data (candles / symbols / indices / tape) --------------------
  const windowMinutes = Math.max(1, (window.to - window.from) / MINUTE_MS);
  const previous = previousWindowTotals(aggregates, window);
  const sparkOf = (pick) => resample(windowBuckets.map(pick), 12);
  const symbols = modelEntries.map((model, index) => {
    const values = windowBuckets.map((bucket) => bucket.models.get(model.route)?.tokens ?? 0);
    const spark = resample(values, 12);
    const base = spark.find((value) => value > 0) ?? 0;
    return {
      code: `MDL-${String(index + 1).padStart(2, "0")}`,
      route: model.route,
      name: labelByRoute.get(model.route) ?? model.model,
      vendor: model.vendor ?? null,
      color: colorByRoute.get(model.route) ?? OTHER_MODEL_COLOR,
      tokens: model.tokens,
      costCNY: roundMoney(model.costCNY),
      unpriced: model.priceLevel === "unpriced",
      rate: Math.round((model.tokens / windowMinutes) * 100) / 100,
      chgPct: changePct(spark[spark.length - 1], base),
      spark,
    };
  });
  const indices = [
    { key: "tokens", label: "总消耗", value: totals.tokens, unit: "tokens", chgPct: changePct(totals.tokens, previous.tokens), spark: sparkOf((bucket) => bucket.tokens) },
    { key: "cost", label: "预估成本", value: costCNYTotal, unit: "¥", chgPct: changePct(costCNYTotal, previous.costCNY), spark: sparkOf((bucket) => roundMoney(bucket.costCNY + bucket.searchCostCNY)) },
    { key: "sessions", label: "会话数", value: sessions, unit: "个", chgPct: changePct(sessions, previous.sessions), spark: sparkOf((bucket) => bucket.sessionIds.size) },
    { key: "cacheHit", label: "缓存命中率", value: cacheHitRate, unit: "%", chgPct: changePct(cacheHitRate, previous.cacheHit), spark: sparkOf(bucketHitRate) },
    { key: "search", label: "官方搜索", value: totals.searches, unit: "次", chgPct: changePct(totals.searches, previous.searches), spark: sparkOf((bucket) => bucket.searches) },
  ];
  const candles = buildCandles(aggregates, window, now);
  const tape = aggregates
    .flatMap((aggregate) => (Array.isArray(aggregate?.tape) ? aggregate.tape : []))
    .sort((left, right) => right.t - left.t)
    .slice(0, 20)
    .map((entry) => ({ t: entry.t, kind: entry.kind, model: entry.model, tokens: entry.tokens, costCNY: roundMoney(entry.costCNY) }));
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
      timeZone,
      offsetMs: zoneOffset,
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
      holidaySource: "国办发明电〔2025〕7号",
      makeupWorkdays: pricing.makeupWorkdays instanceof Set ? [...pricing.makeupWorkdays].sort() : [],
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
    costComposition,
    terminal: { indices, symbols, candles, tape },
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

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

/** Daily activity is kept this long: the heatmap covers 8 weeks plus margin. */
export const MAX_DAILY_AGE_MS = 60 * DAY_MS;

/** Tool durations are clamped to one hour: the corpus has a 334 s-style outlier from resumed background jobs. */
export const MAX_TOOL_DURATION_MS = 3_600_000;

/** Heatmap length in days (8 columns of 7 days). */
export const HEATMAP_DAYS = 56;

/** Leaderboard size (heavy payload contract). */
export const LEADERBOARD_LIMIT = 20;

/** Session-list size (heavy payload contract). */
export const SESSION_LIST_LIMIT = 100;

/** Prompt preview length in characters (heavy payload contract). */
export const PROMPT_PREVIEW_CHARS = 80;

/** When a session has no title, this many leading prompt characters become its display title. */
export const SESSION_TITLE_FROM_PROMPT_CHARS = 24;

/** Empty title means "untitled": the host never hard-codes a locale, the client applies its own i18n fallback. */
export const UNTITLED_TITLE = "";

/** Shell tools whose `arguments.command` feeds the command leaderboard. */
export const SHELL_TOOLS = Object.freeze(["win_bash", "pwsh"]);

/** `user/message` source kinds that carry a real prompt (runtime injections excluded). */
export const PROMPT_SOURCE_KINDS = Object.freeze(["user", "agent-message", "skill-invocation", "user-approval"]);

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

/**
 * Parse one `tool/call` argument blob. The host serializes arguments as a JSON
 * string (15330/15330 in the 2026-11-09 corpus) and one row is malformed, so a
 * parse failure must degrade to null instead of throwing away the session.
 * @param {unknown} value - raw `data.arguments`.
 * @returns {object|null} parsed object, or null when absent/invalid.
 */
function parseJsonObject(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Join the `text` parts of one message content array.
 * @param {unknown} parts - message content parts.
 * @returns {string} trimmed joined text (empty when there is no text part).
 */
function textOfParts(parts) {
  if (!Array.isArray(parts)) return "";
  const chunks = [];
  for (const part of parts) {
    if (part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

/**
 * First program token of one shell command, per the frozen ranking contract:
 * strip a leading `cd <dir> &&` / `cd <dir> ||` / `cd <dir>;` prologue and any
 * `VAR=value` (including `export VAR=value`) assignments, then take the first
 * whitespace-separated token. Fragments that start with `$` or `=` are
 * assignment noise and are skipped (return "").
 * @param {unknown} command - raw `arguments.command` string.
 * @returns {string} program token, or "" when nothing rankable remains.
 */
export function commandProgramOf(command) {
  if (typeof command !== "string") return "";
  let text = command.trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const stripped = text
      .replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^&;|]+?)\s*(?:&&|\|\||;)\s*/, "")
      .replace(/^export\s+(?=[A-Za-z_][A-Za-z0-9_]*=)/, "")
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*/, "")
      .replace(/^(?:&&|\|\||;)\s*/, "");
    if (stripped === text) break;
    text = stripped;
  }
  const token = (text.split(/\s+/)[0] ?? "").trim();
  if (token === "" || token.startsWith("$") || token.startsWith("=")) return "";
  return token;
}

/**
 * Fold one named observation into a per-day leaderboard bucket.
 * @param {Map<number, Map<string, {count: number, lastCalledAt: number}>>} daily - mutable per-day map.
 * @param {number} day - day index of the event.
 * @param {string} name - tool / program / skill name.
 * @param {number} time - event time (epoch ms).
 * @param {number} cutoffDay - days older than this are ignored.
 * @returns {void}
 */
function addDailyStat(daily, day, name, time, cutoffDay) {
  if (name === "" || day < cutoffDay) return;
  let names = daily.get(day);
  if (names === undefined) {
    names = new Map();
    daily.set(day, names);
  }
  let stat = names.get(name);
  if (stat === undefined) {
    stat = { count: 0, lastCalledAt: 0, resultCount: 0, errorCount: 0, totalMs: 0 };
    names.set(name, stat);
  }
  stat.count += 1;
  if (time > stat.lastCalledAt) stat.lastCalledAt = time;
}

/**
 * Fold one paired `tool/result` into the day bucket of its call. The call day is
 * used (not the result day) so the window filter stays "by call time", and an
 * unpaired result simply has no bucket to land in. Success metrics are only
 * defined for calls that produced a result: an unpaired call is unknown, not a
 * failure.
 * @param {Map<number, Map<string, {count: number, resultCount: number, errorCount: number, totalMs: number}>>} daily - mutable per-day map.
 * @param {number} day - day index of the call.
 * @param {string} name - tool name.
 * @param {number} durationMs - raw `result.time - call.time`.
 * @param {boolean} isError - `data.message.isError === true`.
 * @param {number} cutoffDay - days older than this are ignored.
 * @returns {void}
 */
function addToolResultStat(daily, day, name, durationMs, isError, cutoffDay) {
  if (name === "" || day < cutoffDay) return;
  const names = daily.get(day);
  if (names === undefined) return;
  const stat = names.get(name);
  if (stat === undefined) return;
  stat.resultCount += 1;
  stat.totalMs += Math.min(MAX_TOOL_DURATION_MS, Math.max(0, durationMs));
  if (isError) stat.errorCount += 1;
}

/**
 * Fold tokens / turns into one day of the activity map.
 * @param {Map<number, {tokens: number, turns: number}>} activity - mutable per-day map.
 * @param {number} day - day index.
 * @param {number} tokens - tokens to add.
 * @param {number} turns - turns to add.
 * @param {number} cutoffDay - days older than this are ignored.
 * @returns {void}
 */
function addDailyActivity(activity, day, tokens, turns, cutoffDay) {
  if (day < cutoffDay) return;
  let entry = activity.get(day);
  if (entry === undefined) {
    entry = { tokens: 0, turns: 0 };
    activity.set(day, entry);
  }
  entry.tokens += tokens;
  entry.turns += turns;
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
 * Aggregate one complete session log into hourly usage buckets plus the heavy
 * data layer (title, last prompt, turns/steps, per-day activity, tool / shell
 * program / skill counters).
 *
 * Metadata events (`session/title`, `user/message`, `turn/start`, `step/start`,
 * `tool/call`, `tool/result`) are read regardless of the 31-day usage horizon so
 * an old session still reports its title and lifetime counters; their day
 * buckets are pruned by {@link pruneSessionAggregate}. `turn/start` and
 * `step/start` are the authoritative counters (`turn/end` / `step/end` may be
 * missing on interrupted sessions); `tool/call.arguments` is a JSON *string* and
 * a parse failure is skipped instead of failing the session. A `tool/result` is
 * paired to its call by `message.toolCallId` (fallback `message.source.callId`)
 * and folded into the call's day bucket (success rate / average duration).
 *
 * @param {string} sessionId - logical session id.
 * @param {readonly unknown[]} events - complete raw event log of the session (fork prefix already sliced off).
 * @param {object} [options] - aggregation options.
 * @param {number} [options.createdAt] - session creation time (epoch ms).
 * @param {ReturnType<typeof createPricing>} [options.pricing] - pricing context.
 * @param {number} [options.now] - reference instant used to prune old buckets.
 * @param {number} [options.zoneOffset] - viewer zone offset in ms used for day buckets (default +08:00).
 * @param {string} [options.workspace] - session working directory (`header.cwd`), shown in the session list.
 * @param {boolean} [options.isSubagent] - whether the session was spawned by a subagent (`header.origin`).
 * @returns {{sessionId: string, createdAt: number, hours: Map<number, object>, title: string, lastPrompt: string, workspace: string, isSubagent: boolean, turns: number, steps: number, tokens: number, costCNY: number, input: number, cacheRead: number, cacheWrite: number, dailyActivity: Map<number, {tokens: number, turns: number}>, toolDaily: Map<number, Map<string, {count: number, lastCalledAt: number}>>, commandDaily: Map<number, Map<string, {count: number, lastCalledAt: number}>>, skillDaily: Map<number, Map<string, {count: number, lastCalledAt: number}>>, events: number, searches: number, firstTime: number|null, lastTime: number|null, lastEventTime: number|null}} session aggregate (`tokens`/`costCNY`/`input`/`cacheRead`/`cacheWrite` are lifetime totals, not windowed).
 */
export function summarizeSessionEvents(sessionId, events, options = {}) {
  const pricing = options.pricing ?? createPricing();
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const zoneOffset = Number.isFinite(options.zoneOffset) ? Number(options.zoneOffset) : BEIJING_OFFSET_MS;
  const cutoffHour = hourIndexOf(now - MAX_BUCKET_AGE_MS);
  const activityCutoffDay = dayIndexOf(now - MAX_DAILY_AGE_MS, zoneOffset);
  const leaderboardCutoffDay = dayIndexOf(now - MAX_BUCKET_AGE_MS, zoneOffset);
  const aggregate = {
    sessionId: String(sessionId ?? ""),
    createdAt: Number.isFinite(options.createdAt) ? Number(options.createdAt) : 0,
    hours: new Map(),
    title: "",
    lastPrompt: "",
    workspace: typeof options.workspace === "string" ? options.workspace : "",
    isSubagent: options.isSubagent === true,
    turns: 0,
    steps: 0,
    tokens: 0,
    costCNY: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    dailyActivity: new Map(),
    toolDaily: new Map(),
    commandDaily: new Map(),
    skillDaily: new Map(),
    events: 0,
    searches: 0,
    firstTime: null,
    lastTime: null,
    lastEventTime: null,
  };
  if (!Array.isArray(events)) return aggregate;
  // Pairing table for IDEA-05: callId → the call's name / day / time. Results
  // are matched within this function scope (calls precede their results in seq
  // order) and folded into the call's day bucket.
  const pendingToolCalls = new Map();
  for (const event of events) {
    const time = Number(event.time);
    if (!Number.isFinite(time)) continue;
    // Session-list activity must follow EVERY event, not just usage: title,
    // prompts, turns, steps, and tool traffic all count as "last active" (F2).
    if (aggregate.lastEventTime === null || time > aggregate.lastEventTime) aggregate.lastEventTime = time;
    const type = typeof event.type === "string" ? event.type : "";

    // ---- metadata events (not subject to the usage horizon) ------------------
    if (type === "session/title") {
      const title = typeof event.data?.title === "string" ? event.data.title.trim() : "";
      if (title !== "") aggregate.title = title;
      continue;
    }
    if (type === "user/message") {
      // Runtime injections (time-context, progress-updates-nudge, …) share the
      // event type but must never become the "last prompt".
      if (PROMPT_SOURCE_KINDS.includes(event.data?.source?.kind)) {
        const text = textOfParts(event.data?.content ?? event.data?.message?.content);
        if (text !== "") aggregate.lastPrompt = text;
      }
      continue;
    }
    if (type === "turn/start") {
      aggregate.turns += 1;
      addDailyActivity(aggregate.dailyActivity, dayIndexOf(time, zoneOffset), 0, 1, activityCutoffDay);
      continue;
    }
    if (type === "step/start") {
      aggregate.steps += 1;
      continue;
    }
    if (type === "tool/call") {
      const name = typeof event.data?.name === "string" ? event.data.name.trim() : "";
      if (name === "") continue;
      const day = dayIndexOf(time, zoneOffset);
      addDailyStat(aggregate.toolDaily, day, name, time, leaderboardCutoffDay);
      const callId = typeof event.data?.callId === "string" ? event.data.callId : "";
      if (callId !== "" && day >= leaderboardCutoffDay) pendingToolCalls.set(callId, { name, day, time });
      const args = parseJsonObject(event.data?.arguments);
      if (args !== null) {
        if (SHELL_TOOLS.includes(name)) {
          const program = commandProgramOf(args.command);
          if (program !== "") addDailyStat(aggregate.commandDaily, day, program, time, leaderboardCutoffDay);
        } else if (name === "skill") {
          const skill = typeof args.name === "string" ? args.name.trim() : "";
          if (skill !== "") addDailyStat(aggregate.skillDaily, day, skill, time, leaderboardCutoffDay);
        }
      }
      continue;
    }
    if (type === "tool/result") {
      const message = event.data?.message;
      const rawCallId = message?.toolCallId ?? message?.source?.callId;
      const callId = typeof rawCallId === "string" ? rawCallId : "";
      if (callId === "") continue;
      const call = pendingToolCalls.get(callId);
      // A result without a call (or for a pruned call) carries no ranking data.
      if (call === undefined) continue;
      pendingToolCalls.delete(callId);
      addToolResultStat(aggregate.toolDaily, call.day, call.name, time - call.time, message?.isError === true, leaderboardCutoffDay);
      continue;
    }

    // ---- usage events --------------------------------------------------------
    // Two horizons run off the same event: lifetime totals + 60-day daily
    // activity feed the session list and the heatmap, while 31-day hourly
    // buckets feed every window statistic. The hourly cutoff must therefore run
    // AFTER the lifetime/daily accumulation; doing it first dropped 32–60-day
    // tokens from the heatmap (F1) and windowed the session-list totals (F2).
    const search = isSearchEvent(event);
    const usage = search ? null : usageOfEvent(event);
    if (!search && usage === null) continue;
    const routeInfo = search ? null : routeOfEvent(event);
    const cost = search ? null : costOfUsage(usage, routeInfo.route, time, pricing);
    if (search) {
      aggregate.searches += 1;
      aggregate.costCNY += SEARCH_REQUEST_PRICE_CNY;
    } else {
      aggregate.events += 1;
      // Raw `data.usage.totalTokens` is absent on ~30% of assistant messages;
      // sum the four disjoint buckets instead (same rule as `addToBucket`).
      const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      aggregate.tokens += totalTokens;
      aggregate.input += usage.inputTokens;
      aggregate.cacheRead += usage.cacheReadTokens;
      aggregate.cacheWrite += usage.cacheWriteTokens;
      aggregate.costCNY += cost.costCNY;
      addDailyActivity(aggregate.dailyActivity, dayIndexOf(time, zoneOffset), totalTokens, 0, activityCutoffDay);
    }
    if (aggregate.firstTime === null || time < aggregate.firstTime) aggregate.firstTime = time;
    if (aggregate.lastTime === null || time > aggregate.lastTime) aggregate.lastTime = time;
    const hour = hourIndexOf(time);
    if (hour < cutoffHour) continue;
    // Hourly buckets only look back 31 days (the largest window).
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
  }
  return aggregate;
}

/**
 * Drop buckets that fell out of the largest supported window: hourly usage
 * buckets and tool/command/skill days use the 31-day horizon, while daily
 * activity keeps 60 days for the 8-week heatmap.
 *
 * `offsetMs` must be the same viewer-zone offset used when the day keys were
 * written, otherwise a non-+08:00 zone can prune a boundary day early or late.
 * @param {object} aggregate - mutable session aggregate.
 * @param {number} now - reference instant (epoch ms).
 * @param {number} [offsetMs] - viewer zone offset in ms (default +08:00).
 * @returns {object} the same aggregate.
 */
export function pruneSessionAggregate(aggregate, now, offsetMs = BEIJING_OFFSET_MS) {
  const zoneOffset = Number.isFinite(offsetMs) ? Number(offsetMs) : BEIJING_OFFSET_MS;
  const cutoffHour = hourIndexOf(now - MAX_BUCKET_AGE_MS);
  for (const hour of aggregate.hours.keys()) {
    if (hour < cutoffHour) aggregate.hours.delete(hour);
  }
  const cutoffDay = dayIndexOf(now - MAX_BUCKET_AGE_MS, zoneOffset);
  for (const field of ["toolDaily", "commandDaily", "skillDaily"]) {
    const daily = aggregate[field];
    if (!(daily instanceof Map)) continue;
    for (const day of daily.keys()) {
      if (day < cutoffDay) daily.delete(day);
    }
  }
  const activityCutoffDay = dayIndexOf(now - MAX_DAILY_AGE_MS, zoneOffset);
  if (aggregate.dailyActivity instanceof Map) {
    for (const day of aggregate.dailyActivity.keys()) {
      if (day < activityCutoffDay) aggregate.dailyActivity.delete(day);
    }
  }
  return aggregate;
}

/**
 * Resolve one window into its aligned bucket list.
 * @param {string} windowKey - one of {@link WINDOWS}; unknown keys fall back to `7d`.
 * @param {number} nowMs - reference instant (epoch ms).
 * @returns {{key: string, granularity: "hour"|"day", buckets: Array<{key: number, label: string, start: number, end: number}>, startHour: number|null, endHour: number|null, startDay: number|null, endDay: number|null, offsetMs: number, from: number, to: number, labelZh: string, labelEn: string}} window descriptor.
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
      offsetMs: zoneOffset,
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
    offsetMs: zoneOffset,
    from: startDay * DAY_MS - zoneOffset,
    to: (endDay + 1) * DAY_MS - zoneOffset,
    labelZh: spec.zh,
    labelEn: spec.en,
  };
}

/**
 * Map one hour index onto the window bucket array index.
 *
 * Day windows MUST resolve the day with the same zone offset the window was
 * built with (`window.offsetMs`); falling back to +08:00 shifted late-evening
 * events into the next day, so negative-offset viewers silently lost part of
 * their totals (M1). Hour windows are pure arithmetic and zone-free.
 * @param {ReturnType<typeof resolveWindow>} window - resolved window.
 * @param {number} hour - hour index (see {@link hourIndexOf}).
 * @returns {number} bucket index, or -1 when the hour falls outside the window.
 */
export function windowBucketIndexOf(window, hour) {
  if (window.granularity === "hour") {
    const index = hour - window.startHour;
    return index >= 0 && index < window.buckets.length ? index : -1;
  }
  const offsetMs = Number.isFinite(window.offsetMs) ? Number(window.offsetMs) : BEIJING_OFFSET_MS;
  const day = dayIndexOf(hour * HOUR_MS, offsetMs);
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

  // ---- calendar-day snapshots + cost forecast (IDEA-04 / IDEA-01) ----------
  // Both are independent of the requested window: today/yesterday always mean
  // viewer-zone calendar days, and the forecast always fits the last 30 days.
  // Costs mirror `daily[].costCNY` (model cost only); the separate official
  // search fee is `daily[].searchCostCNY` and is NOT included here.
  const todayDay = dayIndexOf(now, zoneOffset);
  const dayWindowStart = todayDay - 30;
  const daySums = new Map();
  for (const aggregate of aggregates) {
    if (aggregate === null || typeof aggregate !== "object") continue;
    const hours = aggregate.hours;
    if (!(hours instanceof Map)) continue;
    for (const [hour, bucket] of hours) {
      const day = dayIndexOf(hour * HOUR_MS, zoneOffset);
      if (day < dayWindowStart) continue;
      let sum = daySums.get(day);
      if (sum === undefined) {
        sum = { tokens: 0, costCNY: 0, input: 0, cacheRead: 0, cacheWrite: 0, sessionIds: new Set() };
        daySums.set(day, sum);
      }
      sum.tokens += bucket.tokens;
      sum.costCNY += bucket.costCNY;
      sum.input += bucket.input;
      sum.cacheRead += bucket.cacheRead;
      sum.cacheWrite += bucket.cacheWrite;
      sum.sessionIds.add(aggregate.sessionId);
    }
  }
  const snapshotOf = (day) => {
    const sum = daySums.get(day);
    if (sum === undefined) return null;
    const promptTokens = sum.input + sum.cacheRead + sum.cacheWrite;
    return {
      tokens: sum.tokens,
      costCNY: roundMoney(sum.costCNY),
      sessions: sum.sessionIds.size,
      cacheHitRate: promptTokens > 0 ? roundRatio(sum.cacheRead / promptTokens) : 0,
    };
  };
  const dailyByDate = new Map();
  for (const [day, sum] of daySums) dailyByDate.set(dateOfDayIndex(day), sum.costCNY);
  const today = snapshotOf(todayDay);
  const yesterday = snapshotOf(todayDay - 1);
  const forecast = computeForecast(dailyByDate, now, timeZone);

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
    today,
    yesterday,
    forecast,
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

/**
 * Calendar date (`YYYY-MM-DD`) of one day index. Day indices already carry the
 * viewer's zone offset, so reading them back as UTC yields the local date.
 * @param {number} day - day index (see {@link dayIndexOf}).
 * @returns {string} `YYYY-MM-DD`.
 */
function dateOfDayIndex(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Least-squares cost forecast over the last 30 viewer-zone days (IDEA-01).
 * Only days with a positive model cost become regression points, so a mostly
 * idle history still fits; fewer than 7 such days returns null. The estimate is
 * clamped to >= 0 because a negative cost has no meaning.
 * @param {Map<string, number>} dailyByDate - `YYYY-MM-DD` → day model cost (CNY).
 * @param {number} now - reference instant (epoch ms).
 * @param {string} [timeZone] - IANA zone used for the day keys.
 * @returns {{slope: number, intercept: number, monthEndEstimate: number, sigma: number, dataPoints: number, daysLeft: number}|null} forecast, or null when data is insufficient.
 */
export function computeForecast(dailyByDate, now, timeZone = "Asia/Shanghai") {
  const source = dailyByDate instanceof Map ? dailyByDate : new Map();
  const reference = Number.isFinite(now) ? Number(now) : Date.now();
  const zone = typeof timeZone === "string" && timeZone !== "" ? timeZone : "Asia/Shanghai";
  const zoneOffset = zoneOffsetMs(zone, reference);
  const todayDay = dayIndexOf(reference, zoneOffset);
  const points = [];
  for (let index = 29; index >= 0; index -= 1) {
    const value = Number(source.get(dateOfDayIndex(todayDay - index)));
    if (Number.isFinite(value) && value > 0) points.push({ x: 29 - index, y: value });
  }
  if (points.length < 7) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
  }
  const denominator = n * sumX2 - sumX * sumX;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  const [year, month, dayOfMonth] = dateOfDayIndex(todayDay).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const monthEndRaw = intercept + slope * (29 + daysLeft);
  let residualSum = 0;
  for (const point of points) {
    const residual = point.y - (intercept + slope * point.x);
    residualSum += residual * residual;
  }
  const sigmaRaw = Math.sqrt(residualSum / n);
  return {
    slope: roundMoney(slope),
    intercept: roundMoney(intercept),
    monthEndEstimate: roundMoney(Number.isFinite(monthEndRaw) ? Math.max(0, monthEndRaw) : 0),
    sigma: roundMoney(Number.isFinite(sigmaRaw) ? Math.max(0, sigmaRaw) : 0),
    dataPoints: n,
    daysLeft,
  };
}

/**
 * Recent daily activity as a dense 56-day series, oldest first. Days without
 * activity are present with zero values, so the heatmap always renders exactly
 * 8 weeks. `sessions` counts distinct sessions active that day (subagent
 * sessions included), per LEAD-DECISIONS §4.
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {string} [timeZone] - IANA zone used to cut days.
 * @param {number} [now] - reference instant (epoch ms).
 * @returns {Array<{date: string, tokens: number, turns: number, sessions: number}>} heatmap series.
 */
export function buildHeatmap(aggregates, timeZone = "Asia/Shanghai", now = Date.now()) {
  const reference = Number.isFinite(now) ? Number(now) : Date.now();
  const zoneOffset = zoneOffsetMs(timeZone, reference);
  const endDay = dayIndexOf(reference, zoneOffset);
  const startDay = endDay - (HEATMAP_DAYS - 1);
  const totals = new Map();
  for (const aggregate of Array.isArray(aggregates) ? aggregates : []) {
    const activity = aggregate?.dailyActivity;
    if (!(activity instanceof Map)) continue;
    for (const [day, entry] of activity) {
      if (day < startDay || day > endDay) continue;
      let total = totals.get(day);
      if (total === undefined) {
        total = { tokens: 0, turns: 0, sessions: 0 };
        totals.set(day, total);
      }
      total.tokens += Number(entry.tokens) || 0;
      total.turns += Number(entry.turns) || 0;
      // One aggregate is one session: a day with any activity counts it once.
      total.sessions += 1;
    }
  }
  const series = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const total = totals.get(day) ?? { tokens: 0, turns: 0, sessions: 0 };
    series.push({
      date: dateOfDayIndex(day),
      tokens: total.tokens,
      turns: total.turns,
      sessions: total.sessions,
    });
  }
  return series;
}

/**
 * Merge per-day named counters into one descending leaderboard.
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {"toolDaily"|"commandDaily"|"skillDaily"} field - aggregate field to read.
 * @param {string} nameKey - payload key holding the name (`name` / `program`).
 * @param {{startDay: number, endDay: number}|undefined} dayRange - inclusive day-index range.
 * @param {string[]} [sumKeys] - extra numeric stat keys accumulated onto each row.
 * @returns {Array<object>} at most {@link LEADERBOARD_LIMIT} rows, count-desc then name asc.
 */
function leaderboardOf(aggregates, field, nameKey, dayRange, sumKeys = []) {
  const startDay = Number.isFinite(dayRange?.startDay) ? dayRange.startDay : Number.NEGATIVE_INFINITY;
  const endDay = Number.isFinite(dayRange?.endDay) ? dayRange.endDay : Number.POSITIVE_INFINITY;
  const totals = new Map();
  for (const aggregate of Array.isArray(aggregates) ? aggregates : []) {
    const daily = aggregate?.[field];
    if (!(daily instanceof Map)) continue;
    for (const [day, names] of daily) {
      if (day < startDay || day > endDay) continue;
      for (const [name, stat] of names) {
        let entry = totals.get(name);
        if (entry === undefined) {
          entry = { [nameKey]: name, count: 0, lastCalledAt: 0 };
          for (const key of sumKeys) entry[key] = 0;
          totals.set(name, entry);
        }
        entry.count += stat.count;
        if (stat.lastCalledAt > entry.lastCalledAt) entry.lastCalledAt = stat.lastCalledAt;
        for (const key of sumKeys) entry[key] += Number(stat[key]) || 0;
      }
    }
  }
  return [...totals.values()]
    .sort((left, right) => right.count - left.count || String(left[nameKey]).localeCompare(String(right[nameKey])))
    .slice(0, LEADERBOARD_LIMIT);
}

/**
 * Tool-call leaderboard over the window (`tool/call.data.name`), Top 20, plus
 * IDEA-05 success metrics. `successRate` / `avgMs` are null for a tool whose
 * window has calls but no paired result; an unpaired call is unknown, never a
 * failure. Each duration is clamped to {@link MAX_TOOL_DURATION_MS} before the
 * mean, so one resumed 334 s call cannot inflate the average.
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {{startDay: number, endDay: number}|undefined} dayRange - inclusive day-index range.
 * @returns {Array<{name: string, count: number, lastCalledAt: number, errorCount: number, successRate: number|null, avgMs: number|null}>} top tools, count-desc.
 */
export function buildToolLeaderboard(aggregates, dayRange) {
  const rows = leaderboardOf(aggregates, "toolDaily", "name", dayRange, ["resultCount", "errorCount", "totalMs"]);
  return rows.map((row) => {
    const resultCount = row.resultCount;
    return {
      name: row.name,
      count: row.count,
      lastCalledAt: row.lastCalledAt,
      errorCount: row.errorCount,
      successRate: resultCount > 0 ? roundRatio((resultCount - row.errorCount) / resultCount) : null,
      avgMs: resultCount > 0 ? Math.round(Math.min(MAX_TOOL_DURATION_MS, Math.max(0, row.totalMs / resultCount))) : null,
    };
  });
}

/**
 * Shell-program leaderboard over the window. `command/run` only carries slash
 * commands (`permission` / `goal`: 4 rows across 168 sessions), so the frozen
 * contract (LEAD-DECISIONS §4) ranks the first token of `win_bash` / `pwsh`
 * `arguments.command` instead — NOT `command/run.data.program`.
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {{startDay: number, endDay: number}|undefined} dayRange - inclusive day-index range.
 * @returns {Array<{program: string, count: number, lastCalledAt: number}>} top programs, count-desc.
 */
export function buildCommandLeaderboard(aggregates, dayRange) {
  return leaderboardOf(aggregates, "commandDaily", "program", dayRange);
}

/**
 * Skill-invocation leaderboard over the window (`skill` tool calls, `arguments.name`), Top 20.
 * @param {readonly object[]} aggregates - session aggregates.
 * @param {{startDay: number, endDay: number}|undefined} dayRange - inclusive day-index range.
 * @returns {Array<{name: string, count: number, lastCalledAt: number}>} top skills, count-desc.
 */
export function buildSkillLeaderboard(aggregates, dayRange) {
  return leaderboardOf(aggregates, "skillDaily", "name", dayRange);
}

/**
 * Session-list display title: last `session/title`, then the first
 * {@link SESSION_TITLE_FROM_PROMPT_CHARS} characters of the last prompt, then
 * the empty string (the client applies its own "untitled" i18n string).
 * @param {object} aggregate - session aggregate.
 * @returns {string} display title.
 */
function listTitleOf(aggregate) {
  if (typeof aggregate?.title === "string" && aggregate.title !== "") return aggregate.title;
  const prompt = typeof aggregate?.lastPrompt === "string" ? aggregate.lastPrompt.trim() : "";
  return prompt === "" ? UNTITLED_TITLE : prompt.slice(0, SESSION_TITLE_FROM_PROMPT_CHARS);
}

/**
 * Per-session cards for the heavy payload, newest activity first, at most
 * {@link SESSION_LIST_LIMIT} rows. A session is listed when it has any event at
 * all (`lastEventTime`), not only usage: title / prompt / turn / tool traffic all
 * keep a session visible (F2), and `lastActiveAt` is that last event time.
 * `tokens` / `costCNY` / `cacheHitRate` are lifetime totals.
 * `isArchived` is fixed to false: neither `listSessions` nor `readSession`
 * exposes an archive flag (LEAD-DECISIONS §5.1).
 * @param {readonly object[]} aggregates - session aggregates.
 * @returns {Array<{id: string, title: string, turns: number, steps: number, tokens: number, costCNY: number, cacheHitRate: number, lastPrompt: string, lastActiveAt: number, createdAt: number, workspace: string, isArchived: boolean, isSubagent: boolean}>} session list.
 */
export function buildSessionList(aggregates) {
  return (Array.isArray(aggregates) ? aggregates : [])
    .filter((aggregate) => aggregate !== null && typeof aggregate === "object" && Number.isFinite(aggregate.lastEventTime))
    .sort((left, right) => right.lastEventTime - left.lastEventTime)
    .slice(0, SESSION_LIST_LIMIT)
    .map((aggregate) => {
      const promptTokens = aggregate.input + aggregate.cacheRead + aggregate.cacheWrite;
      return {
        id: String(aggregate.sessionId ?? ""),
        title: listTitleOf(aggregate),
        turns: aggregate.turns ?? 0,
        steps: aggregate.steps ?? 0,
        tokens: aggregate.tokens ?? 0,
        costCNY: roundMoney(aggregate.costCNY ?? 0),
        cacheHitRate: promptTokens > 0 ? roundRatio(aggregate.cacheRead / promptTokens) : 0,
        lastPrompt: String(aggregate.lastPrompt ?? "").slice(0, PROMPT_PREVIEW_CHARS),
        lastActiveAt: aggregate.lastEventTime,
        createdAt: aggregate.createdAt ?? 0,
        workspace: String(aggregate.workspace ?? ""),
        // No archive flag is exposed by any session API; contract fixes it to false.
        isArchived: false,
        isSubagent: aggregate.isSubagent === true,
      };
    });
}

#!/usr/bin/env node
/**
 * qa-data-reconcile.mjs — independent QA reconciliation of the plugin payload
 * against the raw DSH session logs.
 *
 * Method:
 *   1. Read every `session.v4.jsonl.zstd` from the real DSH home (read-only).
 *   2. Build a fake cordis context whose `sessionQuery` serves those logs, call
 *      the real `apply()` and drive the registered HTTP handlers to export
 *      `/overview` and `/heavy` payloads to JSON (DSH itself is not restarted).
 *   3. Recompute every number with an INDEPENDENT implementation in this file
 *      (own window math, own token summation, own day bucketing, own leaderboard
 *      cleaning) and compare it with the payload.
 *
 * Only files under `_notes/verify/` are written. No business source is touched.
 *
 * Usage:
 *   node tools/verify/qa-data-reconcile.mjs             # human summary + JSON
 *   node tools/verify/qa-data-reconcile.mjs --quick     # skip the M1 NY pass
 *   node tools/verify/qa-data-reconcile.mjs --root <dir>
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { apply, OVERVIEW_PATH, HEAVY_PATH } from "../../lib/index.js";
import {
  SEARCH_REQUEST_PRICE_CNY,
  costOfUsage,
  createPricing,
  normalizeRoute,
  searchCost,
} from "../../lib/pricing.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(REPO_ROOT, "_notes", "verify", "fixtures", "qa");
const DEFAULT_ROOT = "E:\\Program Files\\deepseekharness-webui\\home\\sessions";
const ZONE = "Asia/Shanghai";
const ZONE_NY = "America/New_York";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const HOST = "127.0.0.1:2820";

const argv = process.argv.slice(2);
const QUICK = argv.includes("--quick");
const ROOT = argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : DEFAULT_ROOT;
const SESSION_ID_FROM_PROMPT = 24;

/* ========================================================================== */
/* Independent helpers (deliberately NOT imported from lib/aggregate.js)       */
/* ========================================================================== */

const round6 = (value) => Math.round(Number(value) * 1_000_000) / 1_000_000;

/** Positive finite number or 0 — mirrors the host's normalization intent. */
function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Four disjoint usage buckets of one assistant/message event, or null. */
function usageOf(event) {
  if (event?.type !== "assistant/message") return null;
  const usage = event.data?.usage;
  if (usage === null || typeof usage !== "object") return null;
  const normalized = {
    inputTokens: positive(usage.inputTokens),
    outputTokens: positive(usage.outputTokens),
    cacheReadTokens: positive(usage.cacheReadTokens),
    cacheWriteTokens: positive(usage.cacheWriteTokens),
  };
  normalized.totalTokens =
    normalized.inputTokens + normalized.outputTokens + normalized.cacheReadTokens + normalized.cacheWriteTokens;
  return normalized.totalTokens > 0 ? normalized : null;
}

/** Producing route of one event (unknown/unknown when the source is absent). */
function routeOf(event) {
  const source = event?.data?.message?.source;
  if (source !== null && typeof source === "object" && source.kind === "model") {
    return {
      provider: String(source.provider ?? "unknown") || "unknown",
      model: String(source.model ?? "unknown") || "unknown",
    };
  }
  return { provider: "unknown", model: "unknown" };
}

/** Search-request events (same predicate as the host, independently written). */
function isSearchEvent(event) {
  const type = typeof event?.type === "string" ? event.type : "";
  return type === "web/deepseek-search-llm-request" || type.includes("search-llm-request");
}

/** UTC offset (ms, east positive) of an IANA zone at one instant. */
const offsetFormatters = new Map();
function zoneOffsetMs(timeZone, timeMs) {
  const zone = typeof timeZone === "string" && timeZone !== "" ? timeZone : ZONE;
  let formatter = offsetFormatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(Number(timeMs)));
  const pick = (type) => Number((parts.find((part) => part.type === type) ?? {}).value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
  return asUtc - Math.floor(Number(timeMs) / 1000) * 1000;
}

/** Local day index (days since epoch in the zone). */
function dayIndexOf(timeMs, offsetMs) {
  return Math.floor((Number(timeMs) + Number(offsetMs)) / DAY);
}

/** `YYYY-MM-DD` of one local day index. */
function dateOfDay(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** Local-hour index (absolute hour buckets, zone only used for labels). */
function hourIndexOf(timeMs) {
  return Math.floor(Number(timeMs) / HOUR);
}

/** Independent expected window for one key. */
function expectedWindow(windowKey, now, offsetMs) {
  if (windowKey === "24h") {
    const endHour = hourIndexOf(now);
    const startHour = endHour - 23;
    return { granularity: "hour", from: startHour * HOUR, to: (endHour + 1) * HOUR, startHour, endHour, startDay: null, endDay: null };
  }
  const days = { "7d": 7, "14d": 14, "30d": 30 }[windowKey];
  const endDay = dayIndexOf(now, offsetMs);
  const startDay = endDay - (days - 1);
  return { granularity: "day", from: startDay * DAY - offsetMs, to: (endDay + 1) * DAY - offsetMs, startDay, endDay, days };
}

/** First token of a shell command after stripping cd/VAR/export prologues (contract logic). */
function programOf(command) {
  let text = String(command ?? "").trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const before = text;
    text = text
      .replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^&;|]+?)\s*(?:&&|\|\||;)\s*/, "")
      .replace(/^export\s+(?=[A-Za-z_][A-Za-z0-9_]*=)/, "")
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*/, "")
      .replace(/^(?:&&|\|\||;)\s*/, "");
    if (text === before) break;
  }
  const token = (text.split(/\s+/)[0] ?? "").trim();
  return token === "" || token.startsWith("$") || token.startsWith("=") ? "" : token;
}

/** Content text parts of one user message. */
function textOfParts(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

const PROMPT_KINDS = new Set(["user", "agent-message", "skill-invocation", "user-approval"]);

/* ========================================================================== */
/* Log discovery + loading                                                     */
/* ========================================================================== */

function discoverLogs(root) {
  const files = [];
  if (!fs.existsSync(root)) throw new Error(`sessions root not found: ${root}`);
  for (const workspace of fs.readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(root, workspace.name);
    for (const sessionDir of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue;
      const file = path.join(workspaceDir, sessionDir.name, "session.v4.jsonl.zstd");
      if (fs.existsSync(file)) files.push({ file, id: sessionDir.name });
    }
  }
  return files;
}

/** Exact inherited prefix length: final `session/end-seed {inherited:true}` marker + 1. */
function inheritedCutOf(events) {
  let cut = 0;
  for (const event of events) {
    if (event?.type === "session/end-seed" && event.data?.inherited === true && Number.isFinite(Number(event.seq))) {
      cut = Number(event.seq) + 1;
    }
  }
  return cut;
}

function loadSessions(files) {
  const sessions = [];
  let totalEvents = 0;
  let totalBytes = 0;
  for (const { file, id } of files) {
    let lines;
    try {
      const decompressed = zlib.zstdDecompressSync(fs.readFileSync(file)).toString("utf8");
      totalBytes += decompressed.length;
      lines = decompressed.split("\n").filter((line) => line.trim() !== "");
    } catch (error) {
      sessions.push({ id, error: String(error), allEvents: [], inheritedEventCount: 0, events: [] });
      continue;
    }
    if (lines.length === 0) continue;
    let header;
    try {
      header = JSON.parse(lines[0]);
    } catch {
      continue;
    }
    if (header?.type !== "session") continue;
    const allEvents = [];
    for (let index = 1; index < lines.length; index += 1) {
      try {
        allEvents.push(JSON.parse(lines[index]));
      } catch {
        /* torn tail */
      }
    }
    totalEvents += allEvents.length;
    const inheritedEventCount = inheritedCutOf(allEvents);
    sessions.push({
      id,
      header,
      allEvents,
      inheritedEventCount,
      events: inheritedEventCount > 0 ? allEvents.slice(inheritedEventCount) : allEvents,
    });
  }
  return { sessions, totalEvents, totalBytes };
}

/* ========================================================================== */
/* Fake cordis context + HTTP driver                                           */
/* ========================================================================== */

function createFakeContext(sessions, { forceNoInherit = false } = {}) {
  const routes = [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const list = sessions.map((session) => ({
    header: {
      id: session.id,
      createdAt: Number(session.header?.createdAt) || 0,
      cwd: String(session.header?.cwd ?? ""),
      origin: session.header?.origin,
      isSeeded: session.header?.isSeeded === true,
    },
    live: false,
    persisted: true,
  }));
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => {
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
    sessionQuery: {
      async listSessions() {
        return list;
      },
      async readSession(id) {
        const session = byId.get(id);
        if (session === undefined) throw new Error(`unknown session ${id}`);
        return {
          session: {
            id: session.id,
            createdAt: Number(session.header?.createdAt) || 0,
            cwd: String(session.header?.cwd ?? ""),
            origin: session.header?.origin,
          },
          inheritedEventCount: forceNoInherit ? 0 : session.inheritedEventCount,
          events: session.allEvents,
        };
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    effect(callback) {
      return callback();
    },
    on() {
      return () => {};
    },
    get() {
      return undefined;
    },
  };
  return { ctx, routes };
}

function callRoute(route, url, { method = "GET", host = HOST } = {}) {
  const headers = new Map();
  let body = "";
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    writeHead(statusCode, extra) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(extra ?? {})) this.setHeader(name, value);
      return this;
    },
    end(chunk) {
      if (chunk !== undefined) body += String(chunk);
    },
  };
  const req = { method, url, headers: { host } };
  return Promise.resolve(route.handler(req, res)).then(() => ({
    statusCode: res.statusCode,
    headers,
    body,
    json: () => JSON.parse(body),
  }));
}

async function exportPayloads(sessions, { timeZone = ZONE, forceNoInherit = false } = {}) {
  const { ctx, routes } = createFakeContext(sessions, { forceNoInherit });
  apply(ctx, { ttlMs: 60_000, timeZone, usdRate: 7.1, liveIntervalMs: 1000, debug: false });
  const overviewRoute = routes.find((route) => route.path === OVERVIEW_PATH);
  const heavyRoute = routes.find((route) => route.path === HEAVY_PATH);
  if (overviewRoute === undefined) throw new Error("overview route not registered");
  if (heavyRoute === undefined) throw new Error("heavy route not registered");
  const out = { overview: {}, heavy: {} };
  for (const windowKey of ["24h", "7d"]) {
    const overviewResponse = await callRoute(overviewRoute, `${OVERVIEW_PATH}?window=${windowKey}`);
    const heavyResponse = await callRoute(heavyRoute, `${HEAVY_PATH}?window=${windowKey}`);
    if (overviewResponse.statusCode !== 200) throw new Error(`overview ${windowKey} HTTP ${overviewResponse.statusCode}`);
    if (heavyResponse.statusCode !== 200) throw new Error(`heavy ${windowKey} HTTP ${heavyResponse.statusCode}`);
    out.overview[windowKey] = overviewResponse.json();
    out.heavy[windowKey] = heavyResponse.json();
  }
  return out;
}

/* ========================================================================== */
/* Independent aggregations over owned events                                  */
/* ========================================================================== */

function iterateOwned(sessions) {
  const rows = [];
  for (const session of sessions) {
    for (const event of session.events) rows.push({ session, event });
  }
  return rows;
}

/** Sum tokens / cost / searches for events inside [from, to). */
function sumWindow(sessions, from, to, pricing, offsetMs, granularity) {
  const result = {
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costCNY: 0,
    events: 0,
    searches: 0,
    searchCostCNY: 0,
    sessions: new Set(),
    buckets: new Map(),
    models: new Map(),
  };
  for (const session of sessions) {
    for (const event of session.events) {
      const time = Number(event.time);
      if (!Number.isFinite(time) || time < from || time >= to) continue;
      const bucketKey = granularity === "hour" ? hourIndexOf(time) : dayIndexOf(time, offsetMs);
      if (isSearchEvent(event)) {
        result.searches += 1;
        result.searchCostCNY += SEARCH_REQUEST_PRICE_CNY;
        result.sessions.add(session.id);
        bumpBucket(result.buckets, bucketKey, (bucket) => {
          bucket.searches += 1;
          bucket.searchCostCNY += SEARCH_REQUEST_PRICE_CNY;
        });
        continue;
      }
      const usage = usageOf(event);
      if (usage === null) continue;
      const route = routeOf(event);
      const cost = costOfUsage(usage, normalizeRoute(route.provider, route.model), time, pricing);
      result.events += 1;
      result.tokens += usage.totalTokens;
      result.input += usage.inputTokens;
      result.output += usage.outputTokens;
      result.cacheRead += usage.cacheReadTokens;
      result.cacheWrite += usage.cacheWriteTokens;
      result.costCNY += cost.costCNY;
      result.sessions.add(session.id);
      bumpBucket(result.buckets, bucketKey, (bucket) => {
        bucket.events += 1;
        bucket.tokens += usage.totalTokens;
        bucket.input += usage.inputTokens;
        bucket.output += usage.outputTokens;
        bucket.cacheRead += usage.cacheReadTokens;
        bucket.cacheWrite += usage.cacheWriteTokens;
        bucket.costCNY += cost.costCNY;
      });
      const modelKey = `${route.provider}/\u0000/${route.model}`;
      let model = result.models.get(modelKey);
      if (model === undefined) {
        model = { provider: route.provider, model: route.model, tokens: 0, costCNY: 0, events: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        result.models.set(modelKey, model);
      }
      model.tokens += usage.totalTokens;
      model.costCNY += cost.costCNY;
      model.events += 1;
      model.input += usage.inputTokens;
      model.output += usage.outputTokens;
      model.cacheRead += usage.cacheReadTokens;
      model.cacheWrite += usage.cacheWriteTokens;
    }
  }
  return result;
}

function bumpBucket(map, key, mutate) {
  let bucket = map.get(key);
  if (bucket === undefined) {
    bucket = { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costCNY: 0, events: 0, searches: 0, searchCostCNY: 0 };
    map.set(key, bucket);
  }
  mutate(bucket);
}

/** One local-day snapshot: tokens/cost/sessions/cacheHitRate (model cost only). */
function daySnapshot(sessions, day, offsetMs, pricing) {
  const from = day * DAY - offsetMs;
  const to = from + DAY;
  let tokens = 0;
  let costCNY = 0;
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let sessionsCount = 0;
  const active = new Set();
  for (const session of sessions) {
    for (const event of session.events) {
      const time = Number(event.time);
      if (!Number.isFinite(time) || time < from || time >= to) continue;
      if (isSearchEvent(event)) {
        active.add(session.id);
        continue;
      }
      const usage = usageOf(event);
      if (usage === null) continue;
      const route = routeOf(event);
      tokens += usage.totalTokens;
      input += usage.inputTokens;
      cacheRead += usage.cacheReadTokens;
      cacheWrite += usage.cacheWriteTokens;
      costCNY += costOfUsage(usage, normalizeRoute(route.provider, route.model), time, pricing).costCNY;
      active.add(session.id);
    }
  }
  sessionsCount = active.size;
  if (sessionsCount === 0) return null;
  const promptTokens = input + cacheRead + cacheWrite;
  return {
    tokens,
    costCNY: round6(costCNY),
    sessions: sessionsCount,
    cacheHitRate: promptTokens > 0 ? round6(cacheRead / promptTokens) : 0,
  };
}

/** Daily model cost for the last 30 local days (date → cost). */
function dailyCostMap(sessions, now, offsetMs, pricing) {
  const today = dayIndexOf(now, offsetMs);
  const map = new Map();
  for (let index = 0; index < 30; index += 1) {
    const day = today - 29 + index;
    const snapshot = sumWindowForCost(sessions, day * DAY - offsetMs, (day + 1) * DAY - offsetMs, pricing);
    map.set(dateOfDay(day), snapshot);
  }
  return map;
}

function sumWindowForCost(sessions, from, to, pricing) {
  let cost = 0;
  for (const session of sessions) {
    for (const event of session.events) {
      const time = Number(event.time);
      if (!Number.isFinite(time) || time < from || time >= to) continue;
      if (isSearchEvent(event)) continue;
      const usage = usageOf(event);
      if (usage === null) continue;
      const route = routeOf(event);
      cost += costOfUsage(usage, normalizeRoute(route.provider, route.model), time, pricing).costCNY;
    }
  }
  return cost;
}

/** Independent least-squares forecast (mirrors the documented formula, own code). */
function forecastOf(dailyByDate, now, offsetMs) {
  const today = dayIndexOf(now, offsetMs);
  const points = [];
  for (let index = 29; index >= 0; index -= 1) {
    const value = Number(dailyByDate.get(dateOfDay(today - index)));
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
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const [year, month, dayOfMonth] = dateOfDay(today).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const monthEnd = Math.max(0, intercept + slope * (29 + daysLeft));
  let residualSum = 0;
  for (const point of points) {
    const residual = point.y - (intercept + slope * point.x);
    residualSum += residual * residual;
  }
  return {
    slope: round6(slope),
    intercept: round6(intercept),
    monthEndEstimate: round6(monthEnd),
    sigma: round6(Math.sqrt(residualSum / n)),
    dataPoints: n,
    daysLeft,
  };
}

/** Independent 56-day heatmap. */
function heatmapOf(sessions, now, offsetMs) {
  const endDay = dayIndexOf(now, offsetMs);
  const startDay = endDay - 55;
  const tokens = new Map();
  const turns = new Map();
  const sessionDays = new Set();
  for (const session of sessions) {
    for (const event of session.events) {
      const time = Number(event.time);
      if (!Number.isFinite(time)) continue;
      const day = dayIndexOf(time, offsetMs);
      if (day < startDay || day > endDay) continue;
      if (event.type === "turn/start") {
        turns.set(day, (turns.get(day) ?? 0) + 1);
        sessionDays.add(`${session.id}\u0000${day}`);
        continue;
      }
      const usage = usageOf(event);
      if (usage === null) continue;
      tokens.set(day, (tokens.get(day) ?? 0) + usage.totalTokens);
      sessionDays.add(`${session.id}\u0000${day}`);
    }
  }
  const sessionsPerDay = new Map();
  for (const key of sessionDays) {
    const day = Number(key.split("\u0000")[1]);
    sessionsPerDay.set(day, (sessionsPerDay.get(day) ?? 0) + 1);
  }
  const series = [];
  for (let day = startDay; day <= endDay; day += 1) {
    series.push({
      date: dateOfDay(day),
      tokens: tokens.get(day) ?? 0,
      turns: turns.get(day) ?? 0,
      sessions: sessionsPerDay.get(day) ?? 0,
    });
  }
  return series;
}

/** Independent leaderboard counts inside an inclusive day range. */
function leaderboardsOf(sessions, startDay, endDay, offsetMs) {
  const tools = new Map();
  const commands = new Map();
  const skills = new Map();
  const bump = (map, key, time) => {
    let row = map.get(key);
    if (row === undefined) {
      row = { count: 0, lastCalledAt: 0 };
      map.set(key, row);
    }
    row.count += 1;
    if (time > row.lastCalledAt) row.lastCalledAt = time;
  };
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.type !== "tool/call") continue;
      const time = Number(event.time);
      if (!Number.isFinite(time)) continue;
      const day = dayIndexOf(time, offsetMs);
      if (day < startDay || day > endDay) continue;
      const name = typeof event.data?.name === "string" ? event.data.name.trim() : "";
      if (name === "") continue;
      bump(tools, name, time);
      let args = null;
      try {
        args = JSON.parse(String(event.data?.arguments ?? ""));
      } catch {
        args = null;
      }
      if (args === null || typeof args !== "object" || Array.isArray(args)) continue;
      const lower = name.toLowerCase();
      if (lower === "win_bash" || lower === "pwsh") {
        const program = programOf(args.command);
        if (program !== "") bump(commands, program, time);
      } else if (name === "skill") {
        const skill = typeof args.name === "string" ? args.name.trim() : "";
        if (skill !== "") bump(skills, skill, time);
      }
    }
  }
  const toRows = (map, key) =>
    [...map.entries()]
      .map(([name, row]) => ({ [key]: name, count: row.count, lastCalledAt: row.lastCalledAt }))
      .sort((left, right) => right.count - left.count || String(left[key]).localeCompare(String(right[key])));
  return { tools: toRows(tools, "name"), commands: toRows(commands, "program"), skills: toRows(skills, "name") };
}

/** Independent per-session summary for session-list samples. */
function sessionSummaryOf(session, pricing) {
  let title = "";
  let lastPrompt = "";
  let turns = 0;
  let steps = 0;
  let tokens = 0;
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let costCNY = 0;
  let lastEventTime = 0;
  for (const event of session.events) {
    const time = Number(event.time);
    if (Number.isFinite(time) && time > lastEventTime) lastEventTime = time;
    if (event.type === "session/title") {
      const value = typeof event.data?.title === "string" ? event.data.title.trim() : "";
      if (value !== "") title = value;
    } else if (event.type === "user/message") {
      if (!PROMPT_KINDS.has(String(event.data?.source?.kind ?? ""))) continue;
      const text = textOfParts(event.data?.content ?? event.data?.message?.content);
      if (text !== "") lastPrompt = text;
    } else if (event.type === "turn/start") {
      turns += 1;
    } else if (event.type === "step/start") {
      steps += 1;
    } else if (isSearchEvent(event)) {
      costCNY += SEARCH_REQUEST_PRICE_CNY;
    } else {
      const usage = usageOf(event);
      if (usage === null) continue;
      const route = routeOf(event);
      tokens += usage.totalTokens;
      input += usage.inputTokens;
      cacheRead += usage.cacheReadTokens;
      cacheWrite += usage.cacheWriteTokens;
      costCNY += costOfUsage(usage, normalizeRoute(route.provider, route.model), time, pricing).costCNY;
    }
  }
  const promptTokens = input + cacheRead + cacheWrite;
  return {
    id: session.id,
    title: title !== "" ? title : lastPrompt === "" ? "" : lastPrompt.slice(0, SESSION_ID_FROM_PROMPT),
    turns,
    steps,
    tokens,
    costCNY: round6(costCNY),
    cacheHitRate: promptTokens > 0 ? round6(cacheRead / promptTokens) : 0,
    lastPrompt: lastPrompt.slice(0, 80),
    lastActiveAt: lastEventTime > 0 ? lastEventTime : null,
    createdAt: Number(session.header?.createdAt) || 0,
    workspace: String(session.header?.cwd ?? ""),
    isSubagent: session.header?.origin === "subagent",
    hasEvents: session.events.length > 0,
  };
}

/* ========================================================================== */
/* Comparison helpers                                                          */
/* ========================================================================== */

const checks = [];
function check(id, area, expected, actual, { tolerance = 0, note = "" } = {}) {
  const expectedNumber = Number(expected);
  const actualNumber = Number(actual);
  const bothNumbers = Number.isFinite(expectedNumber) && Number.isFinite(actualNumber);
  let deviation = 0;
  if (bothNumbers) {
    deviation = expectedNumber === 0 ? (actualNumber === 0 ? 0 : 1) : Math.abs(actualNumber - expectedNumber) / Math.abs(expectedNumber);
  }
  const equal = bothNumbers ? Math.abs(actualNumber - expectedNumber) <= tolerance : JSON.stringify(expected) === JSON.stringify(actual);
  checks.push({ id, area, expected, actual, deviation: bothNumbers ? deviation : equal ? 0 : 1, tolerance, status: equal ? "PASS" : "FAIL", note });
  return equal;
}

function checkDeep(id, area, expected, actual, { tolerance = 0, note = "" } = {}) {
  if (typeof expected === "number") return check(id, area, expected, actual, { tolerance, note });
  return check(id, area, expected, actual, { note });
}

/* ========================================================================== */
/* Main                                                                        */
/* ========================================================================== */

const files = discoverLogs(ROOT);
const { sessions, totalEvents, totalBytes } = loadSessions(files);
const now = Date.now();
const pricing = createPricing({ usdRate: 7.1 });
const offsetMs = zoneOffsetMs(ZONE, now);
const offsetNy = zoneOffsetMs(ZONE_NY, now);
const summary = {
  generatedAt: now,
  sessionsRoot: ROOT,
  sessions: sessions.length,
  events: totalEvents,
  decompressedBytes: totalBytes,
  zone: ZONE,
  checks: [],
  info: {},
  samples: {},
};

const payloads = await exportPayloads(sessions);
fs.mkdirSync(FIXTURES, { recursive: true });
for (const windowKey of ["24h", "7d"]) {
  fs.writeFileSync(path.join(FIXTURES, `overview-${windowKey}.json`), JSON.stringify(payloads.overview[windowKey]), "utf8");
  fs.writeFileSync(path.join(FIXTURES, `heavy-${windowKey}.json`), JSON.stringify(payloads.heavy[windowKey]), "utf8");
}
summary.info.payloadBytes = {
  overview7d: Buffer.byteLength(JSON.stringify(payloads.overview["7d"])),
  heavy7d: Buffer.byteLength(JSON.stringify(payloads.heavy["7d"])),
};

/* ---- 1. window bounds + totals + models + daily -------------------------- */

for (const windowKey of ["24h", "7d"]) {
  const overview = payloads.overview[windowKey];
  const expected = expectedWindow(windowKey, now, offsetMs);
  check(`window.${windowKey}.from`, "window", expected.from, overview.window.from);
  check(`window.${windowKey}.to`, "window", expected.to, overview.window.to);
  check(`window.${windowKey}.timeZone`, "window", ZONE, overview.window.timeZone);
  check(`window.${windowKey}.bucketCount`, "window", expected.granularity === "hour" ? 24 : 7, overview.daily.length);
  check(`window.${windowKey}.offsetMs`, "window", offsetMs, overview.window.offsetMs);

  const sum = sumWindow(sessions, expected.from, expected.to, pricing, offsetMs, expected.granularity);
  const totals = overview.totals;
  for (const field of ["tokens", "input", "output", "cacheRead", "cacheWrite", "events", "searches", "sessions"]) {
    const expectedValue = field === "sessions" ? sum.sessions.size : sum[field];
    check(`totals.${windowKey}.${field}`, "overview.totals", expectedValue, totals[field], { note: `independent sum over ${new Date(expected.from).toISOString()}..${new Date(expected.to).toISOString()}` });
  }
  check(`totals.${windowKey}.costCNY`, "overview.totals", round6(sum.costCNY), totals.costCNY, { tolerance: 1e-6 });
  check(`totals.${windowKey}.searchCostCNY`, "overview.totals", round6(searchCost(sum.searches)), totals.searchCostCNY, { tolerance: 1e-6 });
  check(`totals.${windowKey}.costCNYTotal`, "overview.totals", round6(sum.costCNY + searchCost(sum.searches)), totals.costCNYTotal, { tolerance: 1e-6 });
  const totalPrompt = sum.input + sum.cacheRead + sum.cacheWrite;
  check(`totals.${windowKey}.cacheHitRate`, "overview.totals", totalPrompt > 0 ? round6(sum.cacheRead / totalPrompt) : 0, totals.cacheHitRate, { tolerance: 1e-6 });

  // daily buckets
  for (const point of overview.daily) {
    const key = Number(point.key);
    const bucket = sum.buckets.get(key) ?? { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costCNY: 0, events: 0, searches: 0 };
    for (const field of ["tokens", "input", "output", "cacheRead", "cacheWrite", "events", "searches"]) {
      check(`daily.${windowKey}.${point.key}.${field}`, "overview.daily", bucket[field], point[field]);
    }
    check(`daily.${windowKey}.${point.key}.costCNY`, "overview.daily", round6(bucket.costCNY), point.costCNY, { tolerance: 1e-6 });
  }

  // model totals
  const payloadModels = overview.models.filter((row) => row.costsOnly !== true);
  check(`models.${windowKey}.count`, "overview.models", sum.models.size, payloadModels.length);
  for (const model of payloadModels) {
    const key = `${model.provider}/\u0000/${model.model}`;
    const expectedModel = sum.models.get(key);
    if (expectedModel === undefined) {
      check(`models.${windowKey}.${model.route}.present`, "overview.models", "present", "missing");
      continue;
    }
    check(`models.${windowKey}.${model.route}.tokens`, "overview.models", expectedModel.tokens, model.tokens);
    check(`models.${windowKey}.${model.route}.costCNY`, "overview.models", round6(expectedModel.costCNY), model.costCNY, { tolerance: 1e-6 });
    check(`models.${windowKey}.${model.route}.events`, "overview.models", expectedModel.events, model.events);
  }
  summary.info[`window.${windowKey}`] = { from: expected.from, to: expected.to, totalsTokens: totals.tokens, sessions: totals.sessions };
}

/* ---- 2. today / yesterday / forecast (window-independent) ---------------- */

const overview7d = payloads.overview["7d"];
const overview24h = payloads.overview["24h"];
const todayDay = dayIndexOf(now, offsetMs);
for (const [label, expectedDay] of [["today", todayDay], ["yesterday", todayDay - 1]]) {
  const expected = daySnapshot(sessions, expectedDay, offsetMs, pricing);
  for (const [payloadLabel, payload] of [["7d", overview7d], ["24h", overview24h]]) {
    const actual = payload[label];
    if (expected === null) {
      check(`${label}.${payloadLabel}.null`, "overview.snapshot", null, actual);
      continue;
    }
    for (const field of ["tokens", "sessions", "cacheHitRate"]) {
      check(`${label}.${payloadLabel}.${field}`, "overview.snapshot", expected[field], actual?.[field], { tolerance: field === "cacheHitRate" ? 1e-6 : 0 });
    }
    check(`${label}.${payloadLabel}.costCNY`, "overview.snapshot", expected.costCNY, actual?.costCNY, { tolerance: 1e-6 });
  }
}

const dailyCost = dailyCostMap(sessions, now, offsetMs, pricing);
const expectedForecast = forecastOf(dailyCost, now, offsetMs);
const actualForecast = overview7d.forecast;
if (expectedForecast === null || actualForecast === null) {
  check("forecast.null", "overview.forecast", expectedForecast, actualForecast);
} else {
  for (const field of ["slope", "intercept", "monthEndEstimate", "sigma"]) {
    check(`forecast.${field}`, "overview.forecast", expectedForecast[field], actualForecast[field], { tolerance: 1e-6 });
  }
  for (const field of ["dataPoints", "daysLeft"]) check(`forecast.${field}`, "overview.forecast", expectedForecast[field], actualForecast[field]);
}

/* ---- 3. heatmap 56 days -------------------------------------------------- */

const expectedHeatmap = heatmapOf(sessions, now, offsetMs);
const actualHeatmap = payloads.heavy["7d"].heatmap;
check("heatmap.length", "heavy.heatmap", 56, actualHeatmap.length);
check("heatmap.lastDay", "heavy.heatmap", dateOfDay(todayDay), actualHeatmap[actualHeatmap.length - 1]?.date);
for (const day of expectedHeatmap) {
  const actual = actualHeatmap.find((row) => row.date === day.date);
  if (actual === undefined) {
    check(`heatmap.${day.date}.present`, "heavy.heatmap", "present", "missing");
    continue;
  }
  for (const field of ["tokens", "turns", "sessions"]) {
    check(`heatmap.${day.date}.${field}`, "heavy.heatmap", day[field], actual[field]);
  }
}
// A session-day is counted once; independent map already de-duplicates by set.

/* ---- 4. leaderboards (7d / 24h) ------------------------------------------ */

for (const windowKey of ["24h", "7d"]) {
  const window = expectedWindow(windowKey, now, offsetMs);
  const startDay = dayIndexOf(window.from, offsetMs);
  const endDay = dayIndexOf(window.to - 1, offsetMs);
  const expected = leaderboardsOf(sessions, startDay, endDay, offsetMs);
  const heavy = payloads.heavy[windowKey];
  const pairs = [
    ["tools", "toolLeaderboard", "name"],
    ["commands", "commandLeaderboard", "program"],
    ["skills", "skillLeaderboard", "name"],
  ];
  for (const [expectedKey, payloadKey, nameKey] of pairs) {
    const expectedRows = expected[expectedKey];
    const actualRows = heavy[payloadKey];
    check(`leaderboard.${windowKey}.${expectedKey}.rows`, "heavy.leaderboard", Math.min(20, expectedRows.length), actualRows.length);
    const top = Math.min(5, Math.min(expectedRows.length, actualRows.length));
    for (let index = 0; index < top; index += 1) {
      check(`leaderboard.${windowKey}.${expectedKey}[${index}].${nameKey}`, "heavy.leaderboard", expectedRows[index][nameKey], actualRows[index][nameKey]);
      check(`leaderboard.${windowKey}.${expectedKey}[${index}].count`, "heavy.leaderboard", expectedRows[index].count, actualRows[index].count);
      check(`leaderboard.${windowKey}.${expectedKey}[${index}].lastCalledAt`, "heavy.leaderboard", expectedRows[index].lastCalledAt, actualRows[index].lastCalledAt);
    }
  }
  summary.info[`leaderboard.${windowKey}`] = {
    dayRange: [startDay, endDay],
    toolTop: heavy.toolLeaderboard.slice(0, 5).map((row) => [row.name, row.count]),
    commandTop: heavy.commandLeaderboard.slice(0, 5).map((row) => [row.program, row.count]),
    skillTop: heavy.skillLeaderboard.slice(0, 5).map((row) => [row.name, row.count]),
  };
}

/* ---- 5. session list: ordering + 10 samples ------------------------------ */

const expectedSessions = sessions.map((session) => sessionSummaryOf(session, pricing));
const eligible = expectedSessions.filter((row) => row.lastActiveAt !== null).sort((left, right) => right.lastActiveAt - left.lastActiveAt);
const expectedTop100 = eligible.slice(0, 100);
const actualSessions = payloads.heavy["7d"].sessions;
check("sessions.length", "heavy.sessions", Math.min(100, eligible.length), actualSessions.length);
check("sessions.orderMatchesIndependentTop100", "heavy.sessions", expectedTop100.map((row) => row.id), actualSessions.map((row) => row.id));

const sessionById = new Map(sessions.map((session) => [session.id, session]));
const sampleRows = [];
const sampleIds = new Set();
const addSample = (row) => {
  if (row !== undefined && !sampleIds.has(row.id)) {
    sampleIds.add(row.id);
    sampleRows.push(row);
  }
};
const findSample = (predicate) => actualSessions.find((row) => !sampleIds.has(row.id) && predicate(row));
const todayStart = todayDay * DAY - offsetMs;
addSample(findSample((row) => (sessionById.get(row.id)?.inheritedEventCount ?? 0) > 0)); // fork
addSample(findSample((row) => row.isSubagent === true)); // subagent
addSample(findSample((row) => row.lastActiveAt >= todayStart)); // active today
addSample(findSample((row) => row.title === "")); // untitled
addSample([...actualSessions].sort((left, right) => right.tokens - left.tokens)[0]); // most tokens
addSample([...actualSessions].sort((left, right) => right.turns - left.turns)[0]); // most turns
addSample(actualSessions[0]);
for (const index of [10, 50, 99]) addSample(actualSessions[index]);
for (let index = 0; sampleRows.length < 10 && index < actualSessions.length; index += 1) addSample(actualSessions[index]);
const samples = [];
for (const actual of sampleRows) {
  const expected = expectedSessions.find((row) => row.id === actual.id);
  if (expected === undefined) {
    check(`session.${actual.id}.present`, "heavy.sessions", "present", "missing");
    continue;
  }
  const fields = ["title", "turns", "steps", "tokens", "cacheHitRate", "lastPrompt", "lastActiveAt", "workspace", "isSubagent", "createdAt"];
  for (const field of fields) {
    check(`session.${actual.id}.${field}`, "heavy.session.sample", expected[field], actual[field], { tolerance: field === "cacheHitRate" ? 1e-6 : 0 });
  }
  check(`session.${actual.id}.costCNY`, "heavy.session.sample", expected.costCNY, actual.costCNY, { tolerance: 1e-6 });
  samples.push({
    id: actual.id,
    title: actual.title,
    tokens: actual.tokens,
    turns: actual.turns,
    lastActiveAt: actual.lastActiveAt,
    isSubagent: actual.isSubagent,
    inheritedEvents: sessions.find((session) => session.id === actual.id)?.inheritedEventCount ?? 0,
    allMatch: ["title", "turns", "steps", "tokens", "cacheHitRate", "lastPrompt", "lastActiveAt", "workspace", "isSubagent", "createdAt"].every(
      (field) => (expected[field] ?? null) === (actual[field] ?? null) || (field === "cacheHitRate" && Math.abs(expected[field] - actual[field]) <= 1e-6),
    ) && Math.abs(expected.costCNY - actual.costCNY) <= 1e-6,
  });
}
summary.samples.sessions = samples;

/* ---- 6. fork A/B dedupe -------------------------------------------------- */

const noInherit = await exportPayloads(sessions, { forceNoInherit: true });
const window7d = expectedWindow("7d", now, offsetMs);
let inheritedTokensInWindow = 0;
let inheritedEventsInWindow = 0;
for (const session of sessions) {
  if (session.inheritedEventCount === 0) continue;
  for (const event of session.allEvents.slice(0, session.inheritedEventCount)) {
    const time = Number(event.time);
    if (!Number.isFinite(time) || time < window7d.from || time >= window7d.to) continue;
    inheritedEventsInWindow += 1;
    const usage = usageOf(event);
    if (usage !== null) inheritedTokensInWindow += usage.totalTokens;
  }
}
const withInheritTokens = payloads.overview["7d"].totals.tokens;
const noInheritTokens = noInherit.overview["7d"].totals.tokens;
const abDiff = noInheritTokens - withInheritTokens;
check("fork.abDiff", "fork", inheritedTokensInWindow, abDiff, { tolerance: Math.max(1, inheritedTokensInWindow * 0.001) });
summary.info.fork = {
  sessionsWithInheritedPrefix: sessions.filter((session) => session.inheritedEventCount > 0).length,
  inheritedEventsInWindow,
  inheritedTokensInWindow,
  withInheritTokens,
  noInheritTokens,
  abDiff,
  diffPct: inheritedTokensInWindow > 0 ? round6((abDiff / inheritedTokensInWindow) * 100) : 0,
};

/* ---- 7. M1 spot check: non-+08 viewer zone ------------------------------- */

if (!QUICK) {
  const nyPayloads = await exportPayloads(sessions, { timeZone: ZONE_NY });
  fs.writeFileSync(path.join(FIXTURES, "overview-7d-ny.json"), JSON.stringify(nyPayloads.overview["7d"]), "utf8");
  fs.writeFileSync(path.join(FIXTURES, "heavy-7d-ny.json"), JSON.stringify(nyPayloads.heavy["7d"]), "utf8");
  const nyOverview = nyPayloads.overview["7d"];
  const nyWindow = expectedWindow("7d", now, offsetNy);
  check("m1.window.from", "m1", nyWindow.from, nyOverview.window.from);
  check("m1.window.to", "m1", nyWindow.to, nyOverview.window.to);
  check("m1.window.offsetMs", "m1", offsetNy, nyOverview.window.offsetMs);
  const nySum = sumWindow(sessions, nyWindow.from, nyWindow.to, pricing, offsetNy, "day");
  check("m1.totals.tokens", "m1", nySum.tokens, nyOverview.totals.tokens);
  check("m1.totals.input", "m1", nySum.input, nyOverview.totals.input);
  for (const point of nyOverview.daily) {
    const bucket = nySum.buckets.get(Number(point.key)) ?? { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    check(`m1.daily.${point.key}.tokens`, "m1", bucket.tokens, point.tokens);
    check(`m1.daily.${point.key}.input`, "m1", bucket.input, point.input);
  }
  const nyToday = daySnapshot(sessions, dayIndexOf(now, offsetNy), offsetNy, pricing);
  check("m1.today.tokens", "m1", nyToday?.tokens ?? null, nyOverview.today?.tokens ?? null);
  check("m1.today.sessions", "m1", nyToday?.sessions ?? null, nyOverview.today?.sessions ?? null);
  const nyHeatmap = heatmapOf(sessions, now, offsetNy);
  const nyHeavyMap = nyPayloads.heavy["7d"].heatmap;
  check("m1.heatmap.lastDay", "m1", nyHeatmap[nyHeatmap.length - 1].date, nyHeavyMap[nyHeavyMap.length - 1].date);
  let nyHeatmapMismatch = 0;
  for (const day of nyHeatmap) {
    const actual = nyHeavyMap.find((row) => row.date === day.date);
    if (actual === undefined || actual.tokens !== day.tokens) nyHeatmapMismatch += 1;
  }
  check("m1.heatmap.mismatchedDays", "m1", 0, nyHeatmapMismatch);
  summary.info.m1 = { zone: ZONE_NY, offsetMs: offsetNy, totalsTokens: nyOverview.totals.tokens, independentTokens: nySum.tokens, heatmapMismatch: nyHeatmapMismatch };
}

/* ---- 8. F1/F2 closure spot checks --------------------------------------- */

const previouslyZeroDates = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-06"];
summary.info.f1Closure = previouslyZeroDates.map((date) => {
  const actual = payloads.heavy["7d"].heatmap.find((row) => row.date === date);
  const expected = expectedHeatmap.find((row) => row.date === date);
  return { date, payloadTokens: actual?.tokens ?? null, independentTokens: expected?.tokens ?? null, nonZero: (actual?.tokens ?? 0) > 0 };
});
const oldLifetimeSessions = [];
for (const session of sessions) {
  let tokens = 0;
  let hasRecentUsage = false;
  for (const event of session.events) {
    const usage = usageOf(event);
    if (usage !== null) {
      tokens += usage.totalTokens;
      if (Number(event.time) >= now - 31 * DAY) hasRecentUsage = true;
    }
  }
  if (tokens > 0 && !hasRecentUsage) oldLifetimeSessions.push({ id: session.id, lifetimeTokens: tokens });
}
const oldIds = new Set(oldLifetimeSessions.map((row) => row.id));
const oldSubsetPayload = await exportPayloads(sessions.filter((session) => oldIds.has(session.id)));
const oldSubsetRows = oldSubsetPayload.heavy["7d"].sessions;
const oldSubsetChecks = [];
for (const item of oldLifetimeSessions) {
  const expected = expectedSessions.find((row) => row.id === item.id);
  const actual = oldSubsetRows.find((row) => row.id === item.id);
  if (actual === undefined) {
    check(`f2.old.${item.id}.listed`, "f2", true, false, { note: "session with only >31d-old usage must still be listed" });
    continue;
  }
  check(`f2.old.${item.id}.tokens`, "f2", expected.tokens, actual.tokens);
  check(`f2.old.${item.id}.costCNY`, "f2", expected.costCNY, actual.costCNY, { tolerance: 1e-6 });
  check(`f2.old.${item.id}.lastActiveAt`, "f2", expected.lastActiveAt, actual.lastActiveAt);
  check(`f2.old.${item.id}.title`, "f2", expected.title, actual.title);
  oldSubsetChecks.push({ id: item.id, tokens: actual.tokens, costCNY: actual.costCNY, lastActiveAt: actual.lastActiveAt, listed: true });
}
summary.info.f2Closure = {
  oldUsageOnlySessions: oldLifetimeSessions.length,
  listedInFullTop100: oldLifetimeSessions.filter((row) => actualSessions.some((actual) => actual.id === row.id)).length,
  oldSubsetChecks,
  sample: oldLifetimeSessions.slice(0, 5),
  noUsageButActiveSessionsListed: actualSessions.filter((row) => {
    const session = sessions.find((item) => item.id === row.id);
    if (session === undefined) return false;
    return !session.events.some((event) => usageOf(event) !== null);
  }).length,
};
summary.info.models7dTop = payloads.overview["7d"].models.slice(0, 3).map((row) => ({ label: row.label, tokens: row.tokens, costCNY: row.costCNY }));
summary.info.forecast = payloads.overview["7d"].forecast;
summary.info.today = payloads.overview["7d"].today;
summary.info.yesterday = payloads.overview["7d"].yesterday;
summary.info.heatmapTotals = {
  tokens: payloads.heavy["7d"].heatmap.reduce((sum, day) => sum + day.tokens, 0),
  turns: payloads.heavy["7d"].heatmap.reduce((sum, day) => sum + day.turns, 0),
  activeDays: payloads.heavy["7d"].heatmap.filter((day) => day.tokens > 0).length,
};

/* ---- Report -------------------------------------------------------------- */

summary.checks = checks;
const failed = checks.filter((item) => item.status === "FAIL");
const largeDeviations = failed.filter((item) => item.deviation > 0.005);
summary.totals = { checks: checks.length, passed: checks.length - failed.length, failed: failed.length, largeDeviations: largeDeviations.length };
fs.writeFileSync(path.join(FIXTURES, "qa-summary.json"), JSON.stringify(summary, null, 2), "utf8");

console.log(`sessions=${sessions.length} events=${totalEvents} decompressed=${(totalBytes / 1048576).toFixed(1)}MB`);
console.log(`checks=${checks.length} passed=${checks.length - failed.length} failed=${failed.length} (large deviations >0.5%: ${largeDeviations.length})`);
for (const item of failed.slice(0, 40)) {
  console.log(`FAIL ${item.id} expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)} dev=${(item.deviation * 100).toFixed(3)}% ${item.note}`);
}
console.log(`payload dumps + summary: ${FIXTURES}`);
if (failed.length > 0) process.exitCode = 1;

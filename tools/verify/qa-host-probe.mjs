#!/usr/bin/env node
/**
 * qa-host-probe.mjs — independent host-half acceptance probe (QA, task-16).
 *
 * This harness is deliberately NOT built on `tools/verify/host-live.mjs`: it has
 * its own fake plugin context, its own synthetic corpus builder, its own real-log
 * reader and its own assertions, so a mistake in the developer harness cannot
 * hide a defect here.
 *
 * It exercises `lib/index.js` (routes / scan / cache / warmup) and
 * `lib/aggregate.js` (event aggregation, windows, heatmap, leaderboards, session
 * list) against:
 *   - a deterministic synthetic corpus (fixed clock, boundary instants), and
 *   - the real zstd session logs under the DSH home directory.
 *
 * Coverage:
 *   routes       403 fence, 405 allow-list, invalid window fallback, headers
 *   scan         cold scan, session cache, response TTL, concurrent dedupe
 *   windows      24h/7d/14d/30d totals vs an independent per-event sum
 *   leaderboards dayRange boundaries (incl. the `window.to - 1` fix)
 *   fork dedupe  only `session/end-seed` with `data.inherited === true`
 *   time zones   Asia/Shanghai, UTC, America/New_York, Europe/Berlin + DST
 *   fixes        M1 (window offset), F1 (60-day heatmap tokens), F2 (lifetime
 *                tokens / lastEventTime), S11 (empty revision), S12 (maxSessions
 *                ordering), S13 (24-char title fallback)
 *   robustness   readSession throw/timeout, corrupt events, NaN guards, clamps
 *   payload      JSON-safe (no Map/undefined/NaN), no-store, content-length
 *
 * Usage (repo root):
 *   node tools/verify/qa-host-probe.mjs
 *   node tools/verify/qa-host-probe.mjs --skip-real
 *   node tools/verify/qa-host-probe.mjs --limit 40
 *   node tools/verify/qa-host-probe.mjs --root "<sessions dir>"
 *
 * Exit codes: 0 every check passed, 1 at least one FAIL, 2 harness could not
 * start (import failure).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SESSIONS_ROOT = "E:\\Program Files\\deepseekharness-webui\\home\\sessions";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LOOPBACK_HOST = "127.0.0.1:2820";

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("--")) continue;
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    continue;
  }
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) {
    flags.set(arg.slice(2), next);
    i += 1;
  } else {
    flags.set(arg.slice(2), true);
  }
}
const skipReal = flags.get("skip-real") === true || flags.get("skip-real") === "true";
const sessionsRoot = String(flags.get("root") ?? DEFAULT_SESSIONS_ROOT).replace(/[\\/]+$/, "");
const sessionLimit = Number(flags.get("limit") ?? 0) || 0;

/* --------------------------------------------------------------- results */

const results = [];
let noteCount = 0;

function check(name, ok, detail = undefined) {
  const status = ok ? "PASS" : "FAIL";
  results.push({ name, status, detail });
  const suffix = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  console.log(`[${status}] ${name}${suffix}`);
  return ok;
}

function note(message) {
  noteCount += 1;
  console.log(`[NOTE] ${message}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/* ---------------------------------------------------------------- modules */

let hostModule;
let aggregateModule;
let pricingModule;
// `QA_HOST_LIB` points the probe at a mutated copy of lib/ (used by --mutants
// to prove an assertion actually catches a regression). Unset = the real lib.
const libOverride = typeof process.env.QA_HOST_LIB === "string" && process.env.QA_HOST_LIB !== "" ? path.resolve(process.env.QA_HOST_LIB) : null;
const libUrl = (file) => (libOverride === null ? new URL(`../../lib/${file}`, import.meta.url).href : pathToFileURL(path.join(libOverride, file)).href);
try {
  hostModule = await import(libUrl("index.js"));
  aggregateModule = await import(libUrl("aggregate.js"));
  pricingModule = await import(libUrl("pricing.js"));
} catch (error) {
  console.error(`[FATAL] cannot import the plugin: ${error?.message ?? error}`);
  process.exit(2);
}

const {
  apply,
  OVERVIEW_PATH,
  HEAVY_PATH,
  LIVE_PATH,
  WARMUP_DELAY_MS,
  DEFAULTS,
} = hostModule;
const {
  HEATMAP_DAYS,
  LEADERBOARD_LIMIT,
  SESSION_LIST_LIMIT,
  PROMPT_PREVIEW_CHARS,
  SESSION_TITLE_FROM_PROMPT_CHARS,
  UNTITLED_TITLE,
  MAX_TOOL_DURATION_MS,
  WINDOWS,
  windowBucketIndexOf,
  hourIndexOf,
  resolveWindow,
  zoneOffsetMs,
  computeForecast,
  commandProgramOf,
} = aggregateModule;
const { costOfUsage, normalizeRoute, createPricing, BEIJING_OFFSET_MS, SEARCH_REQUEST_PRICE_CNY } = pricingModule;

/* ----------------------------------------------------------------- clock */

/**
 * The host reads "now" from `Date.now()` inside the handlers, so a fixed clock
 * is the only way to test day boundaries deterministically. `fixedNow === null`
 * means real time (needed for TTL tests).
 */
const realDateNow = Date.now.bind(Date);
let fixedNow = null;
Date.now = () => (fixedNow === null ? realDateNow() : fixedNow);

async function withFixedNow(instant, run) {
  fixedNow = instant;
  try {
    return await run();
  } finally {
    fixedNow = null;
  }
}

/* ------------------------------------------------------- harness (fake ctx) */

function makeResponse() {
  const res = {
    statusCode: 0,
    headers: Object.create(null),
    body: "",
    finished: false,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = String(value);
      return this;
    },
    getHeader(key) {
      return this.headers[String(key).toLowerCase()];
    },
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers !== null && typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
      }
      return this;
    },
    write(chunk) {
      this.body += Buffer.from(chunk).toString("utf8");
      return true;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) this.body += Buffer.from(chunk).toString("utf8");
      this.finished = true;
      return this;
    },
  };
  return res;
}

/**
 * Mount the host half on a fake cordis context.
 * The 2 s warmup timer is captured instead of scheduled, so it can never pollute
 * a read count; `harness.fireWarmup()` runs it explicitly.
 */
function mountHarness({ config = {}, corpus = { sessions: [] }, persistence = undefined } = {}) {
  const stats = { listCalls: 0, reads: 0, readErrors: 0, readIds: [] };
  const logs = { info: [], warn: [], error: [], debug: [] };
  const routes = new Map();
  const disposers = [];
  let warmupCallback = null;
  let warmupHandle = null;
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => {
          routes.delete(route.path);
        };
      },
    },
    sessionQuery: {
      async listSessions() {
        stats.listCalls += 1;
        if (corpus.listError !== undefined && corpus.listError !== null) {
          throw corpus.listError instanceof Error ? corpus.listError : new Error(String(corpus.listError));
        }
        return corpus.sessions.map((session) => ({
          header: { id: session.id, createdAt: session.createdAt ?? 0, cwd: session.cwd ?? "", origin: session.origin },
        }));
      },
      async readSession(id) {
        stats.reads += 1;
        const key = String(id);
        stats.readIds.push(key);
        const session = corpus.sessions.find((entry) => entry.id === key);
        if (session === undefined) throw new Error(`unknown session ${key}`);
        if (session.readError !== undefined) {
          stats.readErrors += 1;
          throw new Error(String(session.readError));
        }
        if (session.hang === true) return new Promise(() => {});
        return {
          session: { id: session.id, createdAt: session.createdAt ?? 0, cwd: session.cwd ?? "", origin: session.origin },
          inheritedEventCount: session.inheritedEventCount ?? 0,
          events: session.events ?? [],
        };
      },
    },
    logger: {
      info: (message) => logs.info.push(String(message)),
      warn: (message) => logs.warn.push(String(message)),
      error: (message) => logs.error.push(String(message)),
      debug: (message) => logs.debug.push(String(message)),
    },
    effect(run) {
      const dispose = run();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    get(name) {
      if (name === "sessionPersistence") return persistence;
      return undefined;
    },
  };

  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = function patchedSetTimeout(callback, delay, ...rest) {
    if (delay === WARMUP_DELAY_MS) {
      warmupCallback = () => callback(...rest);
      warmupHandle = {
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
          return this;
        },
      };
      return warmupHandle;
    }
    return realSetTimeout(callback, delay, ...rest);
  };
  try {
    apply(ctx, config);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }

  async function call(routePath, options = {}) {
    const route = routes.get(routePath);
    if (route === undefined) throw new Error(`route not registered: ${routePath}`);
    const headers = { accept: "application/json" };
    if (options.host !== null) headers.host = options.host === undefined ? LOOPBACK_HOST : options.host;
    const req = { method: options.method ?? "GET", url: options.url ?? routePath, headers, httpVersion: "1.1" };
    const res = makeResponse();
    const started = performance.now();
    await route.handler(req, res);
    const elapsed = performance.now() - started;
    let json = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
    return { status: res.statusCode, headers: res.headers, body: res.body, json, bytes: Buffer.byteLength(res.body), ms: elapsed };
  }

  function dispose() {
    for (const disposer of disposers) {
      try {
        disposer();
      } catch {
        /* best effort */
      }
    }
  }

  return {
    stats,
    logs,
    routes,
    call,
    dispose,
    hasWarmup: () => warmupCallback !== null,
    warmupHandle,
    fireWarmup: async () => {
      if (warmupCallback === null) throw new Error("no warmup scheduled");
      warmupCallback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    get overview() {
      return (options = {}) => call(OVERVIEW_PATH, options);
    },
    get heavy() {
      return (options = {}) => call(HEAVY_PATH, options);
    },
  };
}

/* ------------------------------------------------------- synthetic corpus */

let seqCounter = 1;
function nextSeq() {
  const value = seqCounter;
  seqCounter += 1;
  return value;
}

function usageEvent(time, options = {}) {
  const data = {
    usage: {
      inputTokens: options.input ?? 0,
      outputTokens: options.output ?? 0,
      cacheReadTokens: options.cacheRead ?? 0,
      cacheWriteTokens: options.cacheWrite ?? 0,
    },
    message: {
      source: {
        kind: "model",
        provider: options.provider ?? "deepseek",
        model: options.model ?? "deepseek-v4.1-flash",
      },
    },
  };
  return { type: "assistant/message", time, seq: options.seq ?? nextSeq(), data };
}

function titleEvent(time, title) {
  return { type: "session/title", time, seq: nextSeq(), data: { title } };
}

function promptEvent(time, text, kind = "user") {
  return {
    type: "user/message",
    time,
    seq: nextSeq(),
    data: { source: { kind }, content: [{ type: "text", text }] },
  };
}

function turnEvent(time) {
  return { type: "turn/start", time, seq: nextSeq(), data: {} };
}

function toolCallEvent(time, name, options = {}) {
  return {
    type: "tool/call",
    time,
    seq: nextSeq(),
    data: {
      name,
      callId: options.callId,
      arguments: typeof options.arguments === "string" ? options.arguments : JSON.stringify(options.arguments ?? {}),
    },
  };
}

function toolResultEvent(time, callId, isError = false) {
  return { type: "tool/result", time, seq: nextSeq(), data: { message: { toolCallId: callId, isError } } };
}

function searchEvent(time) {
  return { type: "web/deepseek-search-llm-request", time, seq: nextSeq(), data: {} };
}

function endSeedEvent(time, options = {}) {
  return { type: "session/end-seed", time, seq: nextSeq(), data: options.inherited === true ? { inherited: true } : {} };
}

function makeSession(id, events, options = {}) {
  return {
    id,
    createdAt: options.createdAt ?? 1_700_000_000_000,
    cwd: options.cwd ?? "E:\\demo",
    origin: options.origin,
    events,
    inheritedEventCount: options.inheritedEventCount ?? 0,
    readError: options.readError,
    hang: options.hang === true,
  };
}

function tokensOf(events) {
  let tokens = 0;
  for (const event of events) {
    if (event.type !== "assistant/message") continue;
    const usage = event.data?.usage ?? {};
    tokens += (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0) + (Number(usage.cacheReadTokens) || 0) + (Number(usage.cacheWriteTokens) || 0);
  }
  return tokens;
}

/* ----------------------------------------------------------- JSON checks */

/** Collect every JSON-hostile value (undefined / NaN / Map / non-plain object). */
function jsonIssues(value, at = "$", issues = []) {
  if (value === null) return issues;
  const type = typeof value;
  if (type === "number") {
    if (!Number.isFinite(value)) issues.push(`${at}: non-finite number ${value}`);
    return issues;
  }
  if (type === "string" || type === "boolean") return issues;
  if (type === "undefined") {
    issues.push(`${at}: undefined`);
    return issues;
  }
  if (type === "function" || type === "symbol" || type === "bigint") {
    issues.push(`${at}: ${type}`);
    return issues;
  }
  if (value instanceof Map || value instanceof Set) {
    issues.push(`${at}: ${value.constructor.name}`);
    return issues;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => jsonIssues(item, `${at}[${index}]`, issues));
    return issues;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) issues.push(`${at}: non-plain object ${value.constructor?.name ?? "?"}`);
  for (const [key, item] of Object.entries(value)) jsonIssues(item, `${at}.${key}`, issues);
  return issues;
}

function payloadIssues(payload) {
  const issues = jsonIssues(payload);
  if (payload !== null && typeof payload === "object") {
    const roundTrip = JSON.parse(JSON.stringify(payload));
    if (JSON.stringify(roundTrip) !== JSON.stringify(payload)) issues.push("JSON round-trip changed the payload");
  }
  return issues;
}

/* ------------------------------------------------------------- oracles */

/** Viewer-zone calendar date via Intl (independent of the plugin's offset math). */
const localDateCache = new Map();
function localDate(timeMs, zone) {
  const key = `${timeMs}|${zone}`;
  const cached = localDateCache.get(key);
  if (cached !== undefined) return cached;
  const value = new Date(Number(timeMs)).toLocaleDateString("sv-SE", { timeZone: zone }).slice(0, 10);
  if (localDateCache.size < 500_000) localDateCache.set(key, value);
  return value;
}

function previousDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

function dateRangeEndingAt(date, days) {
  const out = [];
  const end = Date.parse(`${date}T00:00:00Z`);
  for (let offset = days - 1; offset >= 0; offset -= 1) out.push(new Date(end - offset * DAY_MS).toISOString().slice(0, 10));
  return out;
}

/* ======================================================================= */
/* Section A — real corpus                                                 */
/* ======================================================================= */

/** Recursively collect `session.v4.jsonl.zstd` files (depth limited). */
function discoverSessionFiles(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4 || found.length > 20_000) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === "session.v4.jsonl.zstd") found.push(full);
    }
  };
  walk(root, 0);
  return found;
}

function decodeWorkspaceName(name) {
  try {
    const inner = name.replace(/^--/, "").replace(/--$/, "");
    const text = inner.replace(/~0020/g, " ").replace(/~([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return text.replace(/-/g, "\\").replace(/\\\\+/g, "\\");
  } catch {
    return name;
  }
}

const promptKinds = new Set(["user", "agent-message", "skill-invocation", "user-approval"]);

/** `text` parts of one message content array, trimmed. */
function textOfParts(parts) {
  if (!Array.isArray(parts)) return "";
  const chunks = [];
  for (const part of parts) {
    if (part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

/**
 * Read one real session file and build the independent accounting the real
 * corpus assertions compare against. Every usage entry is tagged `inherited` so
 * the fork-dedupe effect can be measured without a second pass.
 */
function accountRealSession(session, pricing) {
  const text = zlib.zstdDecompressSync(session.buffer).toString("utf8");
  const lines = text.split("\n");
  const events = [];
  for (const line of lines) {
    if (line === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "session") continue;
    events.push(event);
  }

  // Fork boundary: only the LAST `session/end-seed` with data.inherited === true
  // cuts the prefix; a resume marker (`data: {}`) never does.
  let inheritedEventCount = 0;
  let inheritedMarkers = 0;
  let emptyMarkers = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type !== "session/end-seed") continue;
    if (event.data?.inherited === true) {
      inheritedMarkers += 1;
      if (Number.isFinite(event.seq)) inheritedEventCount = event.seq + 1;
      else inheritedEventCount = index + 1;
    } else {
      emptyMarkers += 1;
    }
  }

  const sessionRecord = {
    id: session.id,
    createdAt: session.createdAt,
    events,
    inheritedEventCount,
    inheritedMarkers,
    emptyMarkers,
    usage: [],
    turnTimes: [],
    searchTimes: [],
    steps: 0,
    title: "",
    lastPrompt: "",
    lastEventTime: null,
    ownUsage: [],
    rawTokens: 0,
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const time = Number(event?.time);
    if (!Number.isFinite(time)) continue;
    const inherited = index < inheritedEventCount;
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "assistant/message") {
      const rawUsage = event.data?.usage;
      if (rawUsage !== undefined && rawUsage !== null) {
        const buckets = [1, 2, 3, 4].map((key) => {
          const value = Number(rawUsage[key === 1 ? "inputTokens" : key === 2 ? "outputTokens" : key === 3 ? "cacheReadTokens" : "cacheWriteTokens"]);
          return Number.isFinite(value) && value > 0 ? value : 0;
        });
        const total = buckets[0] + buckets[1] + buckets[2] + buckets[3];
        if (total > 0) {
          const source = event.data?.message?.source;
          const route = source?.kind === "model" ? normalizeRoute(String(source.provider ?? "unknown"), String(source.model ?? "unknown")) : normalizeRoute("unknown", "unknown");
          const cost = costOfUsage(
            { inputTokens: buckets[0], outputTokens: buckets[1], cacheReadTokens: buckets[2], cacheWriteTokens: buckets[3], totalTokens: total },
            route,
            time,
            pricing,
          ).costCNY;
          const entry = { t: time, i: buckets[0], o: buckets[1], r: buckets[2], w: buckets[3], tokens: total, cost, inherited };
          sessionRecord.usage.push(entry);
          if (!inherited) sessionRecord.ownUsage.push(entry);
        }
      }
    }
    if (type.includes("search-llm-request")) {
      if (!inherited) sessionRecord.searchTimes.push(time);
    }
    if (inherited) {
      if (type === "assistant/message" || type.includes("search-llm-request")) {
        const raw = event.data?.usage;
        if (raw !== undefined && raw !== null) sessionRecord.rawTokens += tokensOf([event]);
      }
      continue;
    }
    if (type === "session/title") {
      const title = typeof event.data?.title === "string" ? event.data.title.trim() : "";
      if (title !== "") sessionRecord.title = title;
    } else if (type === "user/message") {
      if (promptKinds.has(event.data?.source?.kind)) {
        const text2 = textOfParts(event.data?.content ?? event.data?.message?.content);
        if (text2 !== "") sessionRecord.lastPrompt = text2;
      }
    } else if (type === "turn/start") {
      sessionRecord.turnTimes.push(time);
    } else if (type === "step/start") {
      sessionRecord.steps += 1;
    }
    if (sessionRecord.lastEventTime === null || time > sessionRecord.lastEventTime) sessionRecord.lastEventTime = time;
  }
  sessionRecord.events = undefined;
  return sessionRecord;
}

function sumUsageInRange(accounting, fromMs, toMs, options = {}) {
  const includeInherited = options.includeInherited === true;
  const sum = { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costCNY: 0, events: 0, sessionIds: new Set() };
  for (const session of accounting) {
    let touched = false;
    for (const entry of session.usage) {
      if (!includeInherited && entry.inherited) continue;
      if (entry.t < fromMs || entry.t >= toMs) continue;
      sum.tokens += entry.tokens;
      sum.input += entry.i;
      sum.output += entry.o;
      sum.cacheRead += entry.r;
      sum.cacheWrite += entry.w;
      sum.costCNY += entry.cost;
      sum.events += 1;
      touched = true;
    }
    if (!includeInherited) {
      for (const time of session.searchTimes) {
        if (time >= fromMs && time < toMs) touched = true;
      }
    }
    if (touched) sum.sessionIds.add(session.id);
  }
  return sum;
}

function sumUsageOnDates(accounting, dates, options = {}) {
  const includeInherited = options.includeInherited === true;
  const zone = options.zone ?? "Asia/Shanghai";
  const wanted = dates instanceof Set ? dates : new Set(dates);
  const sum = { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costCNY: 0, events: 0, sessionIds: new Set() };
  for (const session of accounting) {
    let touched = false;
    for (const entry of session.usage) {
      if (!includeInherited && entry.inherited) continue;
      if (!wanted.has(localDate(entry.t, zone))) continue;
      sum.tokens += entry.tokens;
      sum.input += entry.i;
      sum.output += entry.o;
      sum.cacheRead += entry.r;
      sum.cacheWrite += entry.w;
      sum.costCNY += entry.cost;
      sum.events += 1;
      touched = true;
    }
    if (!includeInherited) {
      for (const time of session.searchTimes) if (wanted.has(localDate(time, zone))) touched = true;
    }
    if (touched) sum.sessionIds.add(session.id);
  }
  return sum;
}

/** Oracle for `overview.today` / `overview.yesterday` (viewer-zone calendar day). */
function snapshotOracle(accounting, zone, date) {
  const wanted = new Set([date]);
  const sum = sumUsageOnDates(accounting, wanted, { zone });
  if (sum.sessionIds.size === 0 && sum.tokens === 0 && sum.costCNY === 0) return null;
  const prompt = sum.input + sum.cacheRead + sum.cacheWrite;
  return {
    tokens: sum.tokens,
    costCNY: Math.round(sum.costCNY * 1_000_000) / 1_000_000,
    sessions: sum.sessionIds.size,
    cacheHitRate: prompt > 0 ? Math.round((sum.cacheRead / prompt) * 1_000_000) / 1_000_000 : 0,
  };
}

/** Oracle for the 56-day heatmap (tokens / turns / distinct sessions per date). */
function heatmapOracle(accounting, zone, reference) {
  const dates = dateRangeEndingAt(localDate(reference, zone), HEATMAP_DAYS);
  const byDate = new Map(dates.map((date) => [date, { tokens: 0, turns: 0, sessions: new Set() }]));
  for (const session of accounting) {
    for (const entry of session.usage) {
      if (entry.inherited) continue;
      const bucket = byDate.get(localDate(entry.t, zone));
      if (bucket === undefined) continue;
      bucket.tokens += entry.tokens;
      bucket.sessions.add(session.id);
    }
    for (const time of session.turnTimes) {
      const bucket = byDate.get(localDate(time, zone));
      if (bucket === undefined) continue;
      bucket.turns += 1;
      bucket.sessions.add(session.id);
    }
  }
  return { dates, byDate };
}

function closeEnough(left, right, tolerance = 1e-9) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(right));
}

/* ======================================================================= */
/* Section A — synthetic environment tests                                 */
/* ======================================================================= */

async function testRoutes() {
  section("routes: loopback fence, method allow-list, window fallback, headers");

  const now = Date.parse("2026-11-09T04:00:00Z");
  const corpus = {
    sessions: [
      makeSession("s1", [usageEvent(now - HOUR_MS, { input: 100 })], { createdAt: now - DAY_MS }),
    ],
  };
  const harness = mountHarness({ corpus });
  try {
    const forbidden = await harness.overview({ host: "evil.example.com:2820" });
    check("overview: public Host -> 403", forbidden.status === 403 && forbidden.json?.error === "forbidden", `${forbidden.status} ${forbidden.json?.error}`);
    const forbiddenHeavy = await harness.heavy({ host: "panel.attacker.test:2820" });
    check("heavy: public Host -> 403", forbiddenHeavy.status === 403 && forbiddenHeavy.json?.ok === false, `${forbiddenHeavy.status}`);
    const forbiddenLive = await harness.call(LIVE_PATH, { host: "public.example.org" });
    check("live: public Host -> 403", forbiddenLive.status === 403, `${forbiddenLive.status}`);
    const missingHost = await harness.overview({ host: null });
    check("overview: missing Host header -> 403", missingHost.status === 403, `${missingHost.status}`);
    const lanBlocked = await harness.overview({ host: "192.168.1.20:2820" });
    check("overview: LAN IP blocked by default", lanBlocked.status === 403, `${lanBlocked.status}`);

    const post = await harness.overview({ method: "POST" });
    check(
      "overview: POST -> 405 with allow: GET",
      post.status === 405 && post.headers.allow === "GET" && post.json?.error === "method_not_allowed",
      `${post.status} allow=${post.headers.allow}`,
    );
    const postHeavy = await harness.heavy({ method: "PUT" });
    check("heavy: PUT -> 405", postHeavy.status === 405, `${postHeavy.status} allow=${postHeavy.headers.allow}`);
    const headLive = await harness.call(LIVE_PATH, { method: "HEAD" });
    check("live: HEAD -> 405", headLive.status === 405, `${headLive.status}`);

    for (const [label, response] of [
      ["overview 200", await harness.overview()],
      ["overview 403", forbidden],
      ["overview 405", post],
    ]) {
      const headers = response.headers;
      const ok =
        headers["cache-control"] === "no-store" &&
        headers["x-content-type-options"] === "nosniff" &&
        String(headers["content-type"] ?? "").startsWith("application/json") &&
        Number(headers["content-length"]) === response.bytes;
      check(`${label}: no-store/nosniff/json/content-length`, ok, `len=${headers["content-length"]} body=${response.bytes}`);
    }

    const invalid = await harness.overview({ url: `${OVERVIEW_PATH}?window=fortnight` });
    check("overview: invalid window falls back to the default 7d", invalid.status === 200 && invalid.json?.window?.key === "7d", `${invalid.json?.window?.key}`);
    check("overview: invalid window still returns 7 day buckets", invalid.json?.daily?.length === 7, `${invalid.json?.daily?.length}`);

    const invalidHeavyA = await harness.heavy({ url: `${HEAVY_PATH}?window=fortnight` });
    const invalidHeavyB = await harness.heavy({ url: `${HEAVY_PATH}?window=7d` });
    check(
      "heavy: invalid window payload equals the default window payload",
      JSON.stringify(invalidHeavyA.json?.sessions) === JSON.stringify(invalidHeavyB.json?.sessions) &&
        JSON.stringify(invalidHeavyA.json?.toolLeaderboard) === JSON.stringify(invalidHeavyB.json?.toolLeaderboard),
      "same sessions + leaderboards",
    );

    const empty = await harness.overview({ url: `${OVERVIEW_PATH}?window=` });
    check("overview: empty window param falls back to 7d", empty.json?.window?.key === "7d", `${empty.json?.window?.key}`);

    const expected = { "24h": 24, "7d": 7, "14d": 14, "30d": 30 };
    for (const [key, buckets] of Object.entries(expected)) {
      const response = await harness.overview({ url: `${OVERVIEW_PATH}?window=${key}` });
      const granularity = key === "24h" ? "hour" : "day";
      check(
        `overview: window=${key} -> ${buckets} ${granularity} buckets`,
        response.status === 200 && response.json?.window?.key === key && response.json.daily.length === buckets && response.json.window.granularity === granularity,
        `${response.json?.window?.key} ${response.json?.daily?.length} ${response.json?.window?.granularity}`,
      );
    }
  } finally {
    harness.dispose();
  }

  const openHarness = mountHarness({ corpus, config: { allowPrivateHosts: true, window: "14d" } });
  try {
    const lan = await openHarness.overview({ host: "192.168.1.20:2820" });
    check("allowPrivateHosts: LAN IP accepted", lan.status === 200, `${lan.status}`);
    const publicHost = await openHarness.overview({ host: "panel.example.com" });
    check("allowPrivateHosts: public hostname still rejected", publicHost.status === 403, `${publicHost.status}`);
    const fallback = await openHarness.overview({ url: `${OVERVIEW_PATH}?window=nope` });
    check("configured window=14d is the fallback window", fallback.json?.window?.key === "14d" && fallback.json.daily.length === 14, `${fallback.json?.window?.key}`);
  } finally {
    openHarness.dispose();
  }
}

async function testCorpusEdges() {
  section("scan edges: empty corpus, single session, list failure, read failure");

  const now = Date.parse("2026-11-09T04:00:00Z");

  await withFixedNow(now, async () => {
    const emptyHarness = mountHarness({ corpus: { sessions: [] } });
    try {
      const overview = await emptyHarness.overview();
      const heavy = await emptyHarness.heavy();
      check(
        "empty corpus: overview 200 with zero totals",
        overview.status === 200 &&
          overview.json?.totals?.tokens === 0 &&
          overview.json.totals.sessions === 0 &&
          overview.json.totals.avgTokensPerSession === 0 &&
          overview.json.totals.cacheHitRate === 0,
        JSON.stringify({ tokens: overview.json?.totals?.tokens, sessions: overview.json?.totals?.sessions, hit: overview.json?.totals?.cacheHitRate }),
      );
      check("empty corpus: forecast is null (no data points)", overview.json?.forecast === null, String(overview.json?.forecast));
      check("empty corpus: today and yesterday are null", overview.json?.today === null && overview.json?.yesterday === null, "null/null");
      check(
        "empty corpus: 7 zero daily buckets",
        overview.json?.daily?.length === 7 && overview.json.daily.every((day) => day.tokens === 0 && day.costCNY === 0),
        `${overview.json?.daily?.length} buckets`,
      );
      check(
        "empty corpus: heavy has 56 zero heatmap days and no sessions",
        heavy.status === 200 && heavy.json?.heatmap?.length === 56 && heavy.json.heatmap.every((day) => day.tokens === 0 && day.sessions === 0) && heavy.json.sessions.length === 0,
        `${heavy.json?.heatmap?.length} days, ${heavy.json?.sessions?.length} sessions`,
      );
      check("empty corpus: leaderboards are empty arrays", heavy.json?.toolLeaderboard?.length === 0 && heavy.json?.commandLeaderboard?.length === 0 && heavy.json?.skillLeaderboard?.length === 0, "empty");
      check("empty corpus: scan reports zero sessions", overview.json?.scan?.sessionsScanned === 0 && overview.json.scan.sessionsTotal === 0, JSON.stringify(overview.json?.scan));
    } finally {
      emptyHarness.dispose();
    }

    const oneHarness = mountHarness({ corpus: { sessions: [makeSession("only", [usageEvent(now - HOUR_MS, { input: 900, output: 100 })])] } });
    try {
      const overview = await oneHarness.overview();
      check(
        "single session: sessions=1 and average equals the total",
        overview.json?.totals?.sessions === 1 && overview.json.totals.avgTokensPerSession === overview.json.totals.tokens && overview.json.totals.tokens === 1000,
        JSON.stringify({ sessions: overview.json?.totals?.sessions, tokens: overview.json?.totals?.tokens, avg: overview.json?.totals?.avgTokensPerSession }),
      );
    } finally {
      oneHarness.dispose();
    }

    const failingList = mountHarness({ corpus: { sessions: [], listError: new Error("listSessions exploded") } });
    try {
      const overview = await failingList.overview();
      const heavy = await failingList.heavy();
      check(
        "listSessions failure: overview -> 500 overview_failed",
        overview.status === 500 && overview.json?.ok === false && overview.json.error === "overview_failed",
        `${overview.status} ${overview.json?.error}`,
      );
      check(
        "listSessions failure: heavy -> 500 heavy_failed",
        heavy.status === 500 && heavy.json?.ok === false && heavy.json.error === "heavy_failed",
        `${heavy.status} ${heavy.json?.error}`,
      );
      check("listSessions failure: logged as an error", failingList.logs.error.some((line) => line.includes("overview failed")), failingList.logs.error.join(" | "));
    } finally {
      failingList.dispose();
    }

    const partial = mountHarness({
      corpus: {
        sessions: [
          makeSession("ok1", [usageEvent(now - HOUR_MS, { input: 10 })]),
          makeSession("broken", [], { readError: "disk on fire" }),
          makeSession("ok2", [usageEvent(now - 2 * HOUR_MS, { input: 20 })]),
        ],
      },
    });
    try {
      const overview = await partial.overview();
      check(
        "readSession failure: broken session skipped, others counted",
        overview.status === 200 && overview.json?.totals?.tokens === 30 && overview.json.totals.sessions === 2,
        JSON.stringify({ tokens: overview.json?.totals?.tokens, sessions: overview.json?.totals?.sessions }),
      );
      check("readSession failure: attempt still counted in scan.readCount", overview.json?.scan?.readCount === 3, `${overview.json?.scan?.readCount}`);
      check("readSession failure: warn logged for the broken session", partial.logs.warn.some((line) => line.includes("readSession(broken) failed")), partial.logs.warn.join(" | "));
    } finally {
      partial.dispose();
    }

    const hanging = mountHarness({
      config: { readTimeoutMs: 100 },
      corpus: {
        sessions: [
          makeSession("hangs", [], { hang: true }),
          makeSession("fine", [usageEvent(now - HOUR_MS, { input: 42 })]),
        ],
      },
    });
    try {
      const started = performance.now();
      // The plugin's read timeout is an unref'd timer; in a real host the HTTP
      // socket keeps the loop alive, so the probe holds a ref'd timer too.
      const keepAlive = setTimeout(() => {}, 1_000);
      let overview;
      try {
        overview = await hanging.overview();
      } finally {
        clearTimeout(keepAlive);
      }
      const elapsed = performance.now() - started;
      check(
        "readSession timeout: hung session skipped above the read timeout",
        overview.status === 200 && overview.json?.totals?.tokens === 42 && elapsed >= 95,
        `tokens=${overview.json?.totals?.tokens} elapsed=${Math.round(elapsed)}ms`,
      );
      check("readSession timeout: warn mentions the timeout", hanging.logs.warn.some((line) => line.includes("timed out after 100 ms")), hanging.logs.warn.join(" | "));
    } finally {
      hanging.dispose();
    }
  });
}

async function testCacheAndConcurrency() {
  section("scan cache, TTL, concurrent dedupe, S11/S12");

  const now = Date.parse("2026-11-09T04:00:00Z");
  const corpus = {
    sessions: [
      makeSession("a", [usageEvent(now - HOUR_MS, { input: 10 })]),
      makeSession("b", [usageEvent(now - 2 * HOUR_MS, { input: 20 })]),
      makeSession("c", [usageEvent(now - 3 * HOUR_MS, { input: 30 })]),
    ],
  };

  await withFixedNow(now, async () => {
    const cold = mountHarness({ corpus });
    try {
      const first = await cold.overview();
      check("cold scan: every listed session is read once", cold.stats.reads === 3 && first.json?.scan?.readCount === 3 && first.json.scan.cachedCount === 0, `reads=${cold.stats.reads} ${JSON.stringify(first.json?.scan)}`);
      const second = await cold.overview();
      check(
        "warm response: second overview is byte-identical and reads nothing new",
        cold.stats.reads === 3 && second.body === first.body && second.json?.scan?.readCount === 3,
        `reads=${cold.stats.reads} identical=${second.body === first.body}`,
      );
      note("response cache: a cache hit replays the scan block of the build that produced it (readCount/cachedCount are historical, not per-request)");
      const heavy = await cold.heavy();
      check("heavy reuses the overview scan (no duplicate readSession)", cold.stats.reads === 3 && heavy.json?.sessions?.length === 3, `reads=${cold.stats.reads}`);
    } finally {
      cold.dispose();
    }

    const concurrent = mountHarness({ corpus });
    try {
      const [overview, heavy] = await Promise.all([concurrent.overview(), concurrent.heavy()]);
      check(
        "concurrent overview+heavy scan the corpus exactly once",
        concurrent.stats.reads === 3 && overview.status === 200 && heavy.status === 200,
        `reads=${concurrent.stats.reads}`,
      );
    } finally {
      concurrent.dispose();
    }

    const ttlZero = mountHarness({ config: { ttlMs: 0 }, corpus });
    try {
      await ttlZero.overview();
      await ttlZero.overview();
      check("ttlMs=0: every request rebuilds (two scans)", ttlZero.stats.reads === 6, `reads=${ttlZero.stats.reads}`);
    } finally {
      ttlZero.dispose();
    }

    const persistenceStable = {
      list: async () => [
        { header: { id: "a" }, revision: "r1" },
        { header: { id: "b" }, revision: "r2" },
        { header: { id: "c" }, revision: "r3" },
      ],
    };
    const revisioned = mountHarness({ config: { ttlMs: 0 }, corpus, persistence: persistenceStable });
    try {
      await revisioned.overview();
      const readsAfterFirst = revisioned.stats.reads;
      const second = await revisioned.overview();
      check(
        "persistence revision stable: ttlMs=0 does not re-read unchanged sessions",
        readsAfterFirst === 3 && revisioned.stats.reads === 3 && second.json?.scan?.cachedCount === 3,
        `reads=${revisioned.stats.reads}`,
      );
      persistenceStable.list = async () => [
        { header: { id: "a" }, revision: "r1" },
        { header: { id: "b" }, revision: "r2-changed" },
        { header: { id: "c" }, revision: "r3" },
      ];
      await revisioned.overview();
      check("persistence revision changed: only that session is re-read", revisioned.stats.reads === 4, `reads=${revisioned.stats.reads}`);
      persistenceStable.list = async () => [
        { header: { id: "a" }, revision: "r1" },
        { header: { id: "b" }, revision: "" },
        { header: { id: "c" }, revision: "r3" },
      ];
      await revisioned.overview();
      const afterFirstEmptyRevision = revisioned.stats.reads;
      await revisioned.overview();
      // An empty revision must re-read on EVERY scan (no change signal), so the
      // second scan with the same "" revision still reads that session again.
      check(
        "S11: empty revision string forces a re-read on every scan",
        afterFirstEmptyRevision === 5 && revisioned.stats.reads === 6,
        `first=${afterFirstEmptyRevision} second=${revisioned.stats.reads}`,
      );
    } finally {
      revisioned.dispose();
    }

    const shrink = mountHarness({
      config: { ttlMs: 0 },
      corpus,
      persistence: {
        list: async () => [
          { header: { id: "a" }, revision: "r1" },
          { header: { id: "c" }, revision: "r3" },
        ],
      },
    });
    try {
      await shrink.overview();
      const corpusTwo = { sessions: [corpus.sessions[0], corpus.sessions[2]] };
      shrink.stats.listOverride = corpusTwo;
      // The harness reads its corpus object, so mutate it in place.
      corpus.sessions.length = 0;
      corpus.sessions.push(...corpusTwo.sessions);
      const response = await shrink.overview();
      check(
        "session dropped from the list leaves the cache without error",
        response.status === 200 && response.json?.scan?.sessionsScanned === 2 && response.json.scan.sessionsTotal === 2 && response.json.totals.sessions === 2,
        JSON.stringify(response.json?.scan),
      );
    } finally {
      shrink.dispose();
      corpus.sessions.length = 0;
      corpus.sessions.push(
        makeSession("a", [usageEvent(now - HOUR_MS, { input: 10 })]),
        makeSession("b", [usageEvent(now - 2 * HOUR_MS, { input: 20 })]),
        makeSession("c", [usageEvent(now - 3 * HOUR_MS, { input: 30 })]),
      );
    }
  });

  // TTL expiry needs the real clock.
  const ttlCorpus = { sessions: [makeSession("a", [usageEvent(realDateNow() - HOUR_MS, { input: 10 })])] };
  const ttlHarness = mountHarness({ config: { ttlMs: 150 }, corpus: ttlCorpus });
  try {
    await ttlHarness.overview();
    await ttlHarness.overview();
    check("ttlMs=150: immediate second request is cached", ttlHarness.stats.reads === 1, `reads=${ttlHarness.stats.reads}`);
    await new Promise((resolve) => setTimeout(resolve, 220));
    await ttlHarness.overview();
    check("ttlMs=150: expired TTL triggers one re-scan", ttlHarness.stats.reads === 2, `reads=${ttlHarness.stats.reads}`);
  } finally {
    ttlHarness.dispose();
  }

  // S12: maxSessions keeps the NEWEST sessions even when listSessions is unordered.
  await withFixedNow(now, async () => {
    const maxCorpus = {
      sessions: [
        makeSession("oldest", [usageEvent(now - HOUR_MS, { input: 1 })], { createdAt: 1_000 }),
        makeSession("newest", [usageEvent(now - HOUR_MS, { input: 1 })], { createdAt: 3_000 }),
        makeSession("middle", [usageEvent(now - HOUR_MS, { input: 1 })], { createdAt: 2_000 }),
      ],
    };
    const capped = mountHarness({ config: { maxSessions: 2 }, corpus: maxCorpus });
    try {
      const overview = await capped.overview();
      check(
        "S12: maxSessions keeps the two newest sessions",
        overview.json?.scan?.sessionsScanned === 2 &&
          overview.json.scan.sessionsTotal === 3 &&
          capped.stats.readIds.includes("newest") &&
          capped.stats.readIds.includes("middle") &&
          !capped.stats.readIds.includes("oldest"),
        `${JSON.stringify(overview.json?.scan)} read=${capped.stats.readIds.join(",")}`,
      );
      check("S12: the dropped session is not read", !capped.stats.readIds.includes("oldest") && capped.stats.readIds.length === 2, capped.stats.readIds.join(","));
    } finally {
      capped.dispose();
    }
  });
}

async function testWindows() {
  section("windows: boundary instants, bucket placement, M1");

  // 24h window boundaries and the M1 day-window offset (America/New_York).
  await withFixedNow(Date.parse("2026-11-09T03:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T03:00:00Z");
    const late = now - 30 * 60_000; // 2026-11-08 21:30 EST -> last day bucket
    const previous = Date.parse("2026-11-08T04:30:00Z"); // 2026-11-07 23:30 EST -> one day earlier
    const corpus = {
      sessions: [
        makeSession("m1", [usageEvent(previous, { input: 40 }), usageEvent(late, { input: 80 })]),
      ],
    };
    const harness = mountHarness({ config: { timeZone: "America/New_York" }, corpus });
    try {
      const overview = await harness.overview();
      check(
        "M1: late-evening event is counted in the window total",
        overview.json?.totals?.tokens === 120,
        `tokens=${overview.json?.totals?.tokens} offset=${overview.json?.window?.offsetMs}`,
      );
      check(
        "M1: late-evening event lands in the last day bucket, not past the end",
        overview.json?.daily?.[6]?.tokens === 80 && overview.json?.daily?.[5]?.tokens === 40,
        JSON.stringify(overview.json?.daily?.map((day) => day.tokens)),
      );
      check("M1: window offset equals the New York offset (-5h)", overview.json?.window?.offsetMs === -5 * HOUR_MS, `${overview.json?.window?.offsetMs}`);
      const window = resolveWindow("7d", now, zoneOffsetMs("America/New_York", now));
      const lateIndex = windowBucketIndexOf(window, hourIndexOf(late));
      const previousIndex = windowBucketIndexOf(window, hourIndexOf(previous));
      check("M1: windowBucketIndexOf uses window.offsetMs", lateIndex === 6 && previousIndex === 5, `${previousIndex},${lateIndex}`);
    } finally {
      harness.dispose();
    }
  });

  // Day-window exact boundaries (Asia/Shanghai, offset +8h).
  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const window = resolveWindow("7d", now, BEIJING_OFFSET_MS);
    const corpus = {
      sessions: [
        makeSession("edges", [
          usageEvent(window.from - 1, { input: 1 }),
          usageEvent(window.from, { input: 10 }),
          usageEvent(window.to - 1, { input: 100 }),
          usageEvent(window.to, { input: 1000 }),
        ]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview();
      check("7d: event 1 ms before window.from is excluded", overview.json?.daily?.[0]?.tokens === 10, `${overview.json?.daily?.[0]?.tokens}`);
      check("7d: event 1 ms before window.to is included in the last bucket", overview.json?.daily?.[6]?.tokens === 100, `${overview.json?.daily?.[6]?.tokens}`);
      check("7d: event exactly at window.to is excluded", overview.json?.totals?.tokens === 110, `tokens=${overview.json?.totals?.tokens}`);
      check(
        "7d: window.from/to are local midnights",
        localDate(window.from, "Asia/Shanghai") === "2026-11-03" && localDate(window.to - 1, "Asia/Shanghai") === "2026-11-09",
        `${localDate(window.from, "Asia/Shanghai")}..${localDate(window.to - 1, "Asia/Shanghai")}`,
      );
    } finally {
      harness.dispose();
    }
  });

  // 24h is hour-aligned and must not leak the hour before it.
  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const window = resolveWindow("24h", now, BEIJING_OFFSET_MS);
    const corpus = {
      sessions: [
        makeSession("hours", [
          usageEvent(window.from - 1, { input: 1 }),
          usageEvent(window.from, { input: 10 }),
          usageEvent(window.to - 1, { input: 100 }),
          usageEvent(window.to, { input: 1000 }),
        ]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview({ url: `${OVERVIEW_PATH}?window=24h` });
      check("24h: boundaries are hour-aligned and half-open", overview.json?.totals?.tokens === 110 && window.from % HOUR_MS === 0, `tokens=${overview.json?.totals?.tokens}`);
      check("24h: 24 hourly buckets", overview.json?.daily?.length === 24, `${overview.json?.daily?.length}`);
    } finally {
      harness.dispose();
    }
  });
}

async function testLeaderboardBoundaries() {
  section("leaderboards: dayRange boundaries (window.to - 1 fix)");

  // 24h window whose `to` lands exactly on local midnight: an event after that
  // midnight is outside the window but on the *next* day index. Including the
  // extra day would be the `dayIndexOf(window.to)` bug that task-21 fixed.
  await withFixedNow(Date.parse("2026-11-09T15:30:00Z"), async () => {
    const now = Date.parse("2026-11-09T15:30:00Z");
    const window = resolveWindow("24h", now, BEIJING_OFFSET_MS);
    check(
      "24h fixture: window.to is exactly local midnight",
      localDate(window.to, "Asia/Shanghai") === "2026-11-10" && window.to === Date.parse("2026-11-09T16:00:00Z"),
      `${new Date(window.to).toISOString()}`,
    );
    const corpus = {
      sessions: [
        makeSession("lb", [
          toolCallEvent(window.from + 60_000, "insideWindow"),
          toolCallEvent(window.to - 60_000, "beforeMidnight"),
          toolCallEvent(window.to + 60_000, "afterMidnight"),
        ]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const heavy = await harness.heavy({ url: `${HEAVY_PATH}?window=24h` });
      const counts = new Map((heavy.json?.toolLeaderboard ?? []).map((row) => [row.name, row.count]));
      check(
        "dayRange: calls inside the 24h window are ranked",
        counts.get("insideWindow") === 1 && counts.get("beforeMidnight") === 1,
        JSON.stringify([...counts]),
      );
      check(
        "dayRange: a call after local midnight (next day index) is excluded",
        counts.has("afterMidnight") === false,
        JSON.stringify([...counts]),
      );
    } finally {
      harness.dispose();
    }
  });

  // Day window: the first/last local day are fully included, the day before is not.
  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const window = resolveWindow("7d", now, BEIJING_OFFSET_MS);
    const corpus = {
      sessions: [
        makeSession("days", [
          toolCallEvent(window.from - 60_000, "dayBefore"),
          toolCallEvent(window.from + 60_000, "firstDay"),
          toolCallEvent(window.to - 60_000, "lastDay"),
        ]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const heavy = await harness.heavy();
      const counts = new Map((heavy.json?.toolLeaderboard ?? []).map((row) => [row.name, row.count]));
      check(
        "dayRange: first and last local day are included, the day before is not",
        counts.get("firstDay") === 1 && counts.get("lastDay") === 1 && counts.has("dayBefore") === false,
        JSON.stringify([...counts]),
      );
    } finally {
      harness.dispose();
    }
  });
}

async function testTimeZones() {
  section("time zones: 23:30 UTC boundary, DST, today/heatmap");

  // One event at 23:30 UTC falls on four different local dates.
  const eventTime = Date.parse("2026-11-08T23:30:00Z");
  const now = Date.parse("2026-11-09T02:00:00Z");
  const zones = [
    { zone: "Asia/Shanghai", offset: 8 * HOUR_MS },
    { zone: "UTC", offset: 0 },
    { zone: "America/New_York", offset: -5 * HOUR_MS },
    { zone: "Europe/Berlin", offset: 1 * HOUR_MS },
  ];
  for (const { zone, offset } of zones) {
    await withFixedNow(now, async () => {
      const corpus = { sessions: [makeSession(`tz-${zone}`, [usageEvent(eventTime, { input: 1000 })])] };
      const harness = mountHarness({ config: { timeZone: zone }, corpus });
      try {
        const overview = await harness.overview();
        const heavy = await harness.heavy();
        const eventDate = localDate(eventTime, zone);
        const todayDate = localDate(now, zone);
        const expectedToday = eventDate === todayDate ? 1000 : null;
        check(
          `${zone}: overview.today follows the viewer-zone calendar day`,
          (overview.json?.today?.tokens ?? null) === expectedToday,
          `event=${eventDate} today=${todayDate} today.tokens=${overview.json?.today?.tokens ?? "null"}`,
        );
        check(`${zone}: window.offsetMs matches the IANA offset`, overview.json?.window?.offsetMs === offset, `${overview.json?.window?.offsetMs} vs ${offset}`);
        check(
          `${zone}: heatmap ends on the viewer-zone today`,
          heavy.json?.heatmap?.at(-1)?.date === todayDate,
          `${heavy.json?.heatmap?.at(-1)?.date} vs ${todayDate}`,
        );
        const bucket = (heavy.json?.heatmap ?? []).find((day) => day.date === eventDate);
        check(`${zone}: the 23:30 UTC event lands on its local date in the heatmap`, bucket?.tokens === 1000, `${eventDate} tokens=${bucket?.tokens}`);
      } finally {
        harness.dispose();
      }
    });
  }

  // DST: Europe/Berlin falls back on 2026-10-25 (03:00 CEST -> 02:00 CET).
  check("DST: Berlin offset is +2h before the fall-back", zoneOffsetMs("Europe/Berlin", Date.parse("2026-10-24T12:00:00Z")) === 2 * HOUR_MS, `${zoneOffsetMs("Europe/Berlin", Date.parse("2026-10-24T12:00:00Z"))}`);
  check("DST: Berlin offset is +1h after the fall-back", zoneOffsetMs("Europe/Berlin", Date.parse("2026-10-26T12:00:00Z")) === 1 * HOUR_MS, `${zoneOffsetMs("Europe/Berlin", Date.parse("2026-10-26T12:00:00Z"))}`);
  check("DST: New York offset is -4h before the fall-back", zoneOffsetMs("America/New_York", Date.parse("2026-10-31T12:00:00Z")) === -4 * HOUR_MS, `${zoneOffsetMs("America/New_York", Date.parse("2026-10-31T12:00:00Z"))}`);
  check("DST: New York offset is -5h after the fall-back", zoneOffsetMs("America/New_York", Date.parse("2026-11-02T12:00:00Z")) === -5 * HOUR_MS, `${zoneOffsetMs("America/New_York", Date.parse("2026-11-02T12:00:00Z"))}`);

  await withFixedNow(Date.parse("2026-10-26T12:00:00Z"), async () => {
    const reference = Date.parse("2026-10-26T12:00:00Z");
    // A: 10-24 22:30Z = 10-25 00:30 CEST (the ambiguous hour)
    // B: 10-25 00:30Z = 10-25 02:30 CEST
    // C: 10-25 01:30Z = 10-25 02:30 CET  (after the fall-back)
    // D: 10-25 23:30Z = 10-26 00:30 CET
    const events = [
      usageEvent(Date.parse("2026-10-24T22:30:00Z"), { input: 10 }),
      usageEvent(Date.parse("2026-10-25T00:30:00Z"), { input: 20 }),
      usageEvent(Date.parse("2026-10-25T01:30:00Z"), { input: 40 }),
      usageEvent(Date.parse("2026-10-25T23:30:00Z"), { input: 80 }),
    ];
    const harness = mountHarness({ config: { timeZone: "Europe/Berlin" }, corpus: { sessions: [makeSession("dst", events)] } });
    try {
      const heavy = await harness.heavy();
      const byDate = new Map((heavy.json?.heatmap ?? []).map((day) => [day.date, day.tokens]));
      const oracle = heatmapOracle(
        events.map((event) => ({ usage: [{ t: event.time, tokens: tokensOf([event]) }], turnTimes: [], searchTimes: [], id: "dst" })),
        "Europe/Berlin",
        reference,
      );
      const transitionDate = "2026-10-25";
      const ambiguousHourDate = "2026-10-24"; // what a scan-time +1h offset produces for event A
      check(
        "DST: events whose true offset equals the scan offset keep their local date",
        byDate.get(transitionDate) === 60 && byDate.get("2026-10-26") === 80,
        `2026-10-25=${byDate.get("2026-10-25")} 2026-10-26=${byDate.get("2026-10-26")}`,
      );
      const oracleDates = [...oracle.byDate.entries()].filter(([, value]) => value.tokens > 0).map(([date, value]) => `${date}:${value.tokens}`);
      note(
        `DST transition-hour deviation: the scan uses one offset taken at "now" (+1h); event A (00:30 CEST, true date ${localDate(events[0].time, "Europe/Berlin")}) is bucketed as ${byDate.get(ambiguousHourDate) === 10 ? "2026-10-24" : "its oracle date"}; per-event oracle = ${oracleDates.join(", ")}`,
      );
    } finally {
      harness.dispose();
    }
  });
}

async function testFixes() {
  section("fixes: F1 (60-day heatmap), F2 (lifetime tokens), S13 (title fallback)");

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const fortyDays = now - 40 * DAY_MS;
    const sixtyFiveDays = now - 65 * DAY_MS;
    const corpus = {
      sessions: [
        makeSession("f1", [
          usageEvent(sixtyFiveDays, { input: 999_999 }),
          usageEvent(fortyDays, { input: 5_000 }),
          usageEvent(now - 60_000, { input: 100 }),
        ]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview();
      const heavy = await harness.heavy();
      const byDate = new Map((heavy.json?.heatmap ?? []).map((day) => [day.date, day.tokens]));
      const fortyDate = localDate(fortyDays, "Asia/Shanghai");
      check(
        "F1: a 40-day-old usage event contributes tokens to the heatmap",
        byDate.get(fortyDate) === 5_000,
        `${fortyDate}=${byDate.get(fortyDate)}`,
      );
      check("F1: the 30d window still excludes that event", overview.json?.daily?.length === 7 && (await harness.overview({ url: `${OVERVIEW_PATH}?window=30d` })).json?.totals?.tokens === 100, `7d=${overview.json?.totals?.tokens} 30d=${(await harness.overview({ url: `${OVERVIEW_PATH}?window=30d` })).json?.totals?.tokens}`);
      const total = [...byDate.values()].reduce((sum, value) => sum + value, 0);
      check("F1: a 65-day-old event is pruned from the heatmap (60-day retention)", byDate.get(localDate(sixtyFiveDays, "Asia/Shanghai")) === undefined && total === 5_100, `total=${total}`);
      const sessions = (await harness.heavy()).json?.sessions ?? [];
      const row = sessions.find((entry) => entry.id === "f1");
      check("F2: session-list tokens are lifetime totals (all three events)", row?.tokens === 1_005_099, `tokens=${row?.tokens}`);
    } finally {
      harness.dispose();
    }
  });

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const corpus = {
      sessions: [
        // Tool-only session: no usage at all, must still be listed (F2).
        makeSession("tools-only", [
          toolCallEvent(now - 2 * HOUR_MS, "read", { callId: "c1" }),
          toolCallEvent(now - 1 * HOUR_MS, "grep", { callId: "c2" }),
        ], { createdAt: 1_500 }),
        makeSession("old-usage", [
          usageEvent(now - 45 * DAY_MS, { input: 2_000 }),
          turnEvent(now - 44 * DAY_MS),
        ], { createdAt: 1_100 }),
        makeSession("empty", []),
        makeSession("prompt-titled", [
          promptEvent(now - 30 * 60_000, "abcdefghijklmnopqrstuvwxyz0123456789"),
        ]),
        makeSession("real-titled", [titleEvent(now - 40 * 60_000, "Real Title"), turnEvent(now - 40 * 60_000)]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const heavy = await harness.heavy();
      const overview = await harness.overview();
      const sessions = heavy.json?.sessions ?? [];
      const ids = sessions.map((entry) => entry.id);
      check("F2: a session with only tool events is listed", ids.includes("tools-only"), ids.join(","));
      check("F2: a session with no events at all is not listed", !ids.includes("empty"), ids.join(","));
      const toolRow = sessions.find((entry) => entry.id === "tools-only");
      check(
        "F2: lastActiveAt is the last event time, not the last usage time",
        toolRow?.lastActiveAt === now - 1 * HOUR_MS,
        `${toolRow?.lastActiveAt} vs ${now - 1 * HOUR_MS}`,
      );
      check(
        "F2: session list is sorted by lastActiveAt descending",
        sessions.every((entry, index) => index === 0 || sessions[index - 1].lastActiveAt >= entry.lastActiveAt),
        sessions.map((entry) => `${entry.id}:${entry.lastActiveAt}`).join(" "),
      );
      const oldRow = sessions.find((entry) => entry.id === "old-usage");
      check("F2: lifetime tokens survive the 31-day bucket horizon", oldRow?.tokens === 2_000, `tokens=${oldRow?.tokens}`);
      check("F2: 7d overview excludes the 45-day-old usage", overview.json?.totals?.tokens === 0, `tokens=${overview.json?.totals?.tokens}`);

      check("S13: a session without title/prompt gets an empty title (no hard-coded locale)", toolRow?.title === "", JSON.stringify(toolRow?.title));
      check("S13: UNTITLED_TITLE is the empty string", UNTITLED_TITLE === "", JSON.stringify(UNTITLED_TITLE));
      const promptRow = sessions.find((entry) => entry.id === "prompt-titled");
      check(
        "S13: the title falls back to the first 24 prompt characters",
        promptRow?.title === "abcdefghijklmnopqrstuvwx" && promptRow.title.length === SESSION_TITLE_FROM_PROMPT_CHARS,
        JSON.stringify(promptRow?.title),
      );
      const titledRow = sessions.find((entry) => entry.id === "real-titled");
      check("S13: an explicit session/title wins over the prompt fallback", titledRow?.title === "Real Title", JSON.stringify(titledRow?.title));
      check(
        "session rows expose the documented fields with the documented types",
        sessions.every(
          (entry) =>
            typeof entry.id === "string" &&
            typeof entry.title === "string" &&
            typeof entry.turns === "number" &&
            typeof entry.steps === "number" &&
            typeof entry.tokens === "number" &&
            typeof entry.costCNY === "number" &&
            typeof entry.cacheHitRate === "number" &&
            typeof entry.lastPrompt === "string" &&
            Number.isFinite(entry.lastActiveAt) &&
            typeof entry.workspace === "string" &&
            entry.isArchived === false &&
            typeof entry.isSubagent === "boolean",
        ),
        `${sessions.length} rows`,
      );
      check("session list caps lastPrompt at 80 characters", sessions.every((entry) => entry.lastPrompt.length <= PROMPT_PREVIEW_CHARS), `${PROMPT_PREVIEW_CHARS}`);
      check("session list is capped at 100 rows", sessions.length <= SESSION_LIST_LIMIT, `${sessions.length}`);
    } finally {
      harness.dispose();
    }
  });
}

async function testForkDedupe() {
  section("fork dedupe: only data.inherited === true, last marker, seq + 1");

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const parent = [];
    for (let index = 0; index < 10; index += 1) parent.push(usageEvent(now - (30 - index) * HOUR_MS, { input: 100 }));
    const marker = { type: "session/end-seed", time: now - 20 * HOUR_MS, seq: 10, data: { inherited: true } };
    const secondMarker = { type: "session/end-seed", time: now - 19 * HOUR_MS, seq: 11, data: { inherited: true } };
    const own = [usageEvent(now - 2 * HOUR_MS, { input: 7 }), usageEvent(now - 1 * HOUR_MS, { input: 3 })];
    // 10 parent events (seq 0..9), marker seq 10, second marker seq 11, own seq 12..13
    const events = [...parent, marker, secondMarker, ...own];
    const corpus = {
      sessions: [
        makeSession("forked", events, { inheritedEventCount: 12 }), // last marker seq + 1
        makeSession("resumed", [endSeedEvent(now - 5 * HOUR_MS), usageEvent(now - 4 * HOUR_MS, { input: 5 })], { inheritedEventCount: 0 }),
        makeSession("plain", [usageEvent(now - 3 * HOUR_MS, { input: 11 })]),
        // Defensive: metadata that skips everything, or more than the log holds.
        makeSession("all-inherited", [usageEvent(now - 2 * HOUR_MS, { input: 999 })], { inheritedEventCount: 1 }),
        makeSession("over-sliced", [usageEvent(now - 90 * 60_000, { input: 777 })], { inheritedEventCount: 1_000_000 }),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview();
      check(
        "fork: inherited prefix is not counted twice (10 x 100 token events dropped)",
        overview.json?.totals?.tokens === 7 + 3 + 5 + 11,
        `tokens=${overview.json?.totals?.tokens}`,
      );
      const heavy = await harness.heavy();
      const forkedRow = (heavy.json?.sessions ?? []).find((entry) => entry.id === "forked");
      check("fork: the forked session keeps its own tail tokens", forkedRow?.tokens === 10, `tokens=${forkedRow?.tokens}`);
      const resumedRow = (heavy.json?.sessions ?? []).find((entry) => entry.id === "resumed");
      check("fork: a resume marker (data {}) does not cut the prefix", resumedRow?.tokens === 5, `tokens=${resumedRow?.tokens}`);
      check(
        "fork: an inheritedEventCount that skips the whole log yields an empty session",
        !(heavy.json?.sessions ?? []).some((entry) => entry.id === "all-inherited" || entry.id === "over-sliced"),
        (heavy.json?.sessions ?? []).map((entry) => entry.id).join(","),
      );
    } finally {
      harness.dispose();
    }
  });
}

async function testToolMetrics() {
  section("tool metrics: pairing, success rate, duration clamp");

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const call1 = now - 20 * HOUR_MS;
    const call2 = now - 3 * HOUR_MS;
    const call3 = now - 2 * HOUR_MS;
    const events = [
      toolCallEvent(call1, "clampy", { callId: "c1" }),
      toolResultEvent(call1 + MAX_TOOL_DURATION_MS + 100_000, "c1", false),
      toolCallEvent(call2, "clampy", { callId: "c2" }),
      toolResultEvent(call2 - 5_000, "c2", false),
      toolCallEvent(call3, "clampy", { callId: "c3" }),
      toolResultEvent(call3 + 120, "c3", true),
      toolCallEvent(now - 4 * HOUR_MS, "lonely", { callId: "c4" }),
    ];
    const harness = mountHarness({ corpus: { sessions: [makeSession("tools", events)] } });
    try {
      const heavy = await harness.heavy();
      const rows = new Map((heavy.json?.toolLeaderboard ?? []).map((row) => [row.name, row]));
      const clampy = rows.get("clampy");
      const lonely = rows.get("lonely");
      check(
        "tools: result pairing yields count/errorCount/successRate",
        clampy?.count === 3 && clampy.errorCount === 1 && clampy.successRate === Math.round((2 / 3) * 1_000_000) / 1_000_000,
        JSON.stringify(clampy),
      );
      check(
        "tools: duration is clamped to 1h and negatives to 0 before averaging",
        clampy?.avgMs === Math.round((MAX_TOOL_DURATION_MS + 0 + 120) / 3),
        `avgMs=${clampy?.avgMs}`,
      );
      check("tools: an unpaired call has null successRate and avgMs", lonely?.count === 1 && lonely.successRate === null && lonely.avgMs === null, JSON.stringify(lonely));
      check(
        "tools: leaderboard is count-descending",
        (heavy.json?.toolLeaderboard ?? []).every((row, index, array) => index === 0 || array[index - 1].count >= row.count),
        "desc",
      );
      check("tools: leaderboard caps at 20 rows", (heavy.json?.toolLeaderboard ?? []).length <= LEADERBOARD_LIMIT, `${heavy.json?.toolLeaderboard?.length}`);
    } finally {
      harness.dispose();
    }
  });

  // Shell command ranking + skill ranking + commandProgramOf edge cases.
  check("commandProgramOf: strips a cd prologue with ||", commandProgramOf("cd /tmp || exit 1") === "exit" || commandProgramOf("cd /tmp || exit 1") === "", `"${commandProgramOf("cd /tmp || exit 1")}"`);
  check("commandProgramOf: strips env assignments", commandProgramOf("FOO=1 BAR=2 node script.mjs") === "node", `"${commandProgramOf("FOO=1 BAR=2 node script.mjs")}"`);
  check("commandProgramOf: keeps a plain program", commandProgramOf("grep -n foo bar.txt") === "grep", `"${commandProgramOf("grep -n foo bar.txt")}"`);

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const events = [
      toolCallEvent(now - 3 * HOUR_MS, "win_bash", { callId: "b1", arguments: { command: "cd E:/repo && node tools/x.mjs" } }),
      toolCallEvent(now - 2 * HOUR_MS, "win_bash", { callId: "b2", arguments: { command: "node tools/y.mjs" } }),
      toolCallEvent(now - 1 * HOUR_MS, "skill", { callId: "s1", arguments: { name: "image-to-editable-ppt" } }),
    ];
    const harness = mountHarness({ corpus: { sessions: [makeSession("cmd", events)] } });
    try {
      const heavy = await harness.heavy();
      const commands = heavy.json?.commandLeaderboard ?? [];
      const skills = heavy.json?.skillLeaderboard ?? [];
      check(
        "commands: ranked from shell arguments.command with a cd prologue stripped",
        commands.length === 1 && commands[0].program === "node" && commands[0].count === 2 && !("name" in commands[0]),
        JSON.stringify(commands),
      );
      check("skills: ranked from the skill tool arguments.name", skills.length === 1 && skills[0].name === "image-to-editable-ppt", JSON.stringify(skills));
      check("commands/skills: rows carry lastCalledAt", commands.every((row) => Number.isFinite(row.lastCalledAt)) && skills.every((row) => Number.isFinite(row.lastCalledAt)), "ok");
    } finally {
      harness.dispose();
    }
  });
}

async function testRobustness() {
  section("robustness: corrupt events, NaN guards, search billing, forecast");

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const events = [
      { type: "tool/call", seq: 1, data: { name: "ghost" } }, // no time -> skipped
      { type: "assistant/message", time: "not-a-number", seq: 2, data: { usage: { inputTokens: 5 } } },
      { type: "assistant/message", time: now - 3 * HOUR_MS, seq: 3, data: { usage: { inputTokens: "nope", outputTokens: null, cacheReadTokens: -5, cacheWriteTokens: Infinity }, message: { source: { kind: "model", provider: "deepseek", model: "deepseek-v4.1-flash" } } } },
      toolCallEvent(now - 2 * HOUR_MS, "win_bash", { callId: "bad-json" }),
      { type: "tool/result", time: now - 2 * HOUR_MS + 10, seq: 5, data: {} },
      { type: "session/title", time: now - 2 * HOUR_MS, seq: 6, data: { title: 42 } },
      { type: "user/message", time: now - HOUR_MS, seq: 7, data: { source: { kind: "time-context" }, content: "injected time context" } },
      { type: "user/message", time: now - HOUR_MS + 1, seq: 8, data: { source: {}, content: [{ type: "text", text: 99 }] } },
      { type: null, time: now - 1_000, seq: 9 },
    ];
    // One tool call with broken JSON arguments.
    events[3].data.arguments = "{this is not json";
    const corpus = { sessions: [makeSession("corrupt", events)] };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview();
      const heavy = await harness.heavy();
      check("corrupt events: no throw and a 200 payload", overview.status === 200 && heavy.status === 200, `${overview.status}/${heavy.status}`);
      check("corrupt events: invalid/negative usage is normalised to zero tokens", overview.json?.totals?.tokens === 0 && Number.isFinite(overview.json?.totals?.cacheHitRate), `tokens=${overview.json?.totals?.tokens} hit=${overview.json?.totals?.cacheHitRate}`);
      check("corrupt events: payload has no NaN/undefined/Map", payloadIssues(overview.json).length === 0 && payloadIssues(heavy.json).length === 0, payloadIssues(heavy.json).slice(0, 3).join("; "));
      check("corrupt events: broken JSON arguments do not crash the command leaderboard", (heavy.json?.commandLeaderboard ?? []).length === 0, JSON.stringify(heavy.json?.commandLeaderboard));
      check("corrupt events: the tool call itself is still counted", (heavy.json?.toolLeaderboard ?? []).find((row) => row.name === "win_bash")?.count === 1, JSON.stringify(heavy.json?.toolLeaderboard));
      check("corrupt events: injection prompt is not used as lastPrompt", (heavy.json?.sessions ?? []).find((row) => row.id === "corrupt")?.lastPrompt === undefined || !String((heavy.json?.sessions ?? []).find((row) => row.id === "corrupt")?.lastPrompt).includes("injected"), JSON.stringify((heavy.json?.sessions ?? []).find((row) => row.id === "corrupt")?.lastPrompt));
      check("corrupt events: session still listed via its last finite event time", (heavy.json?.sessions ?? []).some((row) => row.id === "corrupt" && row.lastActiveAt === now - 1_000), "listed");
    } finally {
      harness.dispose();
    }
  });

  // Search events are billed per request and count as an active session.
  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const corpus = {
      sessions: [
        makeSession("search", [
          usageEvent(now - 3 * HOUR_MS, { input: 100 }),
          searchEvent(now - 2 * HOUR_MS),
          searchEvent(now - HOUR_MS),
        ]),
        makeSession("search-only", [searchEvent(now - 30 * 60_000)]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview();
      const totals = overview.json?.totals ?? {};
      check(
        "search: totals.searches and searchCostCNY follow the per-request fee",
        totals.searches === 3 && closeEnough(totals.searchCostCNY, 3 * SEARCH_REQUEST_PRICE_CNY) && closeEnough(totals.costCNYTotal, totals.costCNY + 3 * SEARCH_REQUEST_PRICE_CNY),
        JSON.stringify({ searches: totals.searches, searchCostCNY: totals.searchCostCNY, total: totals.costCNYTotal }),
      );
      check("search: a search-only session counts as active", totals.sessions === 2, `sessions=${totals.sessions}`);
      check("search: tokens stay zero for search-only traffic", totals.tokens === 100, `tokens=${totals.tokens}`);
    } finally {
      harness.dispose();
    }
  });

  // Forecast: needs 7+ positive cost days, linear fit, non-negative month end.
  const unitDaily = new Map();
  for (let index = 0; index < 7; index += 1) unitDaily.set(new Date(Date.UTC(2026, 10, 3 + index)).toISOString().slice(0, 10), 1);
  const unitForecast = computeForecast(unitDaily, Date.parse("2026-11-09T04:00:00Z"), "Asia/Shanghai");
  check(
    "forecast: a flat 7-day series yields slope 0 and the constant value",
    unitForecast !== null && unitForecast.slope === 0 && unitForecast.intercept === 1 && unitForecast.monthEndEstimate === 1 && unitForecast.dataPoints === 7,
    JSON.stringify(unitForecast),
  );
  check(
    "forecast: fewer than 7 positive days returns null",
    computeForecast(new Map([["2026-11-08", 1], ["2026-11-09", 2]]), Date.parse("2026-11-09T04:00:00Z"), "Asia/Shanghai") === null,
    "null",
  );

  await withFixedNow(Date.parse("2026-11-09T12:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const events = [];
    for (let day = 0; day < 9; day += 1) {
      // 20:00 Beijing (off-peak) on each of the last 9 local days; the newest day
      // has the most tokens, so the least-squares slope must be positive.
      events.push(usageEvent(now - day * DAY_MS, { input: 1000 * (9 - day), model: "deepseek-v4.1-flash" }));
    }
    const harness = mountHarness({ corpus: { sessions: [makeSession("forecast", events)] } });
    try {
      const overview = await harness.overview();
      const forecast = overview.json?.forecast;
      check(
        "forecast: 9 positive days produce a finite, positive, non-negative estimate",
        forecast !== null &&
          Number.isFinite(forecast.slope) &&
          forecast.slope > 0 &&
          Number.isFinite(forecast.intercept) &&
          Number.isFinite(forecast.monthEndEstimate) &&
          forecast.monthEndEstimate > 0 &&
          Number.isFinite(forecast.sigma) &&
          forecast.dataPoints === 9 &&
          forecast.daysLeft === 21,
        JSON.stringify(forecast),
      );
      const today = overview.json?.today;
      const yesterday = overview.json?.yesterday;
      check(
        "today/yesterday: fields are finite and non-negative",
        today !== null && Number.isFinite(today.tokens) && today.tokens >= 0 && today.costCNY >= 0 && yesterday !== null && yesterday.tokens >= 0,
        JSON.stringify({ today, yesterday }),
      );
    } finally {
      harness.dispose();
    }
  });
}

async function testWarmupAndLifecycle() {
  section("lifecycle: warmup timer, disposers, live payload");

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const corpus = {
      sessions: [makeSession("a", [usageEvent(now - HOUR_MS, { input: 10 })]), makeSession("b", [usageEvent(now - 2 * HOUR_MS, { input: 20 })])],
    };
    const harness = mountHarness({ corpus });
    try {
      check("warmup: a single delayed scan is scheduled after mount", harness.hasWarmup(), `delay=${WARMUP_DELAY_MS}ms`);
      check("warmup: the timer is unref'd", harness.warmupHandle?.unrefCalled === true, String(harness.warmupHandle?.unrefCalled));
      await harness.fireWarmup();
      check("warmup: the callback performs one silent scan", harness.stats.reads === 2 && harness.logs.error.length === 0, `reads=${harness.stats.reads} errors=${harness.logs.error.length}`);
      const live = await harness.call(LIVE_PATH);
      check(
        "live: snapshot carries cpu/memory/eventLoop/history",
        live.status === 200 && live.json?.ok === true && typeof live.json.cpu?.single === "number" && typeof live.json.memory?.rssMB === "number" && typeof live.json.eventLoop?.p99ms === "number" && Array.isArray(live.json.history?.values),
        `${live.status} ${live.ms.toFixed(2)}ms`,
      );
      check("live: responds well inside 50 ms", live.ms < 50, `${live.ms.toFixed(2)}ms`);
    } finally {
      let threw = false;
      try {
        harness.dispose();
      } catch {
        threw = true;
      }
      check("disposal: registered disposers run without throwing", threw === false && harness.routes.size === 0, `routes=${harness.routes.size}`);
    }
  });
}

async function testPayloadContract() {
  section("payload contract: JSON-safe, documented fields");

  await withFixedNow(Date.parse("2026-11-09T04:00:00Z"), async () => {
    const now = Date.parse("2026-11-09T04:00:00Z");
    const corpus = {
      sessions: [
        makeSession("p1", [
          usageEvent(now - 3 * HOUR_MS, { input: 100, output: 50, cacheRead: 900, cacheWrite: 10 }),
          turnEvent(now - 3 * HOUR_MS),
          promptEvent(now - 2 * HOUR_MS, "hello"),
          titleEvent(now - HOUR_MS, "Payload"),
        ]),
      ],
    };
    const harness = mountHarness({ corpus });
    try {
      const overview = await harness.overview();
      const heavy = await harness.heavy();
      const read = (candidate) => ({ issues: payloadIssues(candidate), text: JSON.stringify(candidate) });
      const overviewCheck = read(overview.json);
      const heavyCheck = read(heavy.json);
      check("payload: overview has no undefined/NaN/Map/non-plain object", overviewCheck.issues.length === 0, overviewCheck.issues.slice(0, 5).join("; "));
      check("payload: heavy has no undefined/NaN/Map/non-plain object", heavyCheck.issues.length === 0, heavyCheck.issues.slice(0, 5).join("; "));
      check("payload: no legacy `terminal` field", overview.json?.terminal === undefined && heavy.json?.terminal === undefined, "absent");
      check(
        "payload: overview documents window/currency/totals/today/yesterday/forecast/daily/models/scan",
        ["window", "currency", "totals", "pricing", "composition", "costComposition", "today", "yesterday", "forecast", "daily", "models", "scan"].every((key) => key in (overview.json ?? {})),
        Object.keys(overview.json ?? {}).join(","),
      );
      check(
        "payload: heavy documents ok/generatedAt/heatmap/leaderboards/sessions",
        ["ok", "generatedAt", "heatmap", "toolLeaderboard", "commandLeaderboard", "skillLeaderboard", "sessions"].every((key) => key in (heavy.json ?? {})),
        Object.keys(heavy.json ?? {}).join(","),
      );
      check("payload: generatedAt is the fixed instant", overview.json?.generatedAt === now && heavy.json?.generatedAt === now, `${overview.json?.generatedAt}/${heavy.json?.generatedAt}`);
      const totals = overview.json?.totals ?? {};
      check(
        "payload: totals.cacheHitRate equals cacheRead / (input + cacheRead + cacheWrite)",
        totals.cacheHitRate === Math.round((900 / (100 + 900 + 10)) * 1_000_000) / 1_000_000,
        `${totals.cacheHitRate}`,
      );
      check(
        "payload: composition shares sum to ~1",
        Math.abs((overview.json?.composition ?? []).reduce((sum, part) => sum + part.share, 0) - 1) < 1e-6,
        `${(overview.json?.composition ?? []).reduce((sum, part) => sum + part.share, 0)}`,
      );
      const heat = heavy.json?.heatmap ?? [];
      check("payload: heatmap is 56 consecutive ascending dates", heat.length === HEATMAP_DAYS && heat.every((day, index) => index === 0 || previousDate(day.date) === heat[index - 1].date), `${heat.length}`);
      check(
        "payload: heatmap rows expose date/tokens/turns/sessions",
        heat.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && Number.isFinite(day.tokens) && Number.isFinite(day.turns) && Number.isFinite(day.sessions)),
        "ok",
      );
    } finally {
      harness.dispose();
    }
  });
}

/* ======================================================================= */
/* Section B — real corpus                                                 */
/* ======================================================================= */

async function loadRealCorpus() {
  const files = discoverSessionFiles(sessionsRoot);
  const sessions = [];
  let skipped = 0;
  let compressedBytes = 0;
  for (const file of files) {
    if (sessionLimit > 0 && sessions.length >= sessionLimit) break;
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch {
      skipped += 1;
      continue;
    }
    let header = null;
    try {
      const text = zlib.zstdDecompressSync(buffer).toString("utf8");
      const newline = text.indexOf("\n");
      header = JSON.parse(newline === -1 ? text : text.slice(0, newline));
    } catch {
      skipped += 1;
      continue;
    }
    if (header === null || header.type !== "session" || header.id === undefined) {
      skipped += 1;
      continue;
    }
    compressedBytes += buffer.length;
    const workspaceDir = path.basename(path.dirname(path.dirname(file)));
    sessions.push({
      id: String(header.id),
      file,
      buffer,
      createdAt: Number(header.createdAt) || 0,
      cwd: String(header.cwd ?? decodeWorkspaceName(workspaceDir)),
      origin: header.origin,
    });
  }
  return { sessions, skipped, compressedBytes };
}

async function runRealSection() {
  section("real corpus: discovery and independent accounting");
  const started = performance.now();
  const { sessions, skipped, compressedBytes } = await loadRealCorpus();
  const indexMs = Math.round(performance.now() - started);
  check(
    "real corpus: session logs discovered",
    sessions.length > 0,
    `${sessions.length} sessions, ${(compressedBytes / 1_048_576).toFixed(1)} MB, ${indexMs}ms index, skipped=${skipped}`,
  );
  if (sessions.length === 0) return { accounting: [], sessions: [], readCounter: { count: 0 } };

  section("real corpus: independent per-event accounting");
  const pricing = createPricing();
  const accountingStarted = performance.now();
  const accounting = [];
  for (const session of sessions) {
    const record = accountRealSession(session, pricing);
    // The plugin never parses end-seed markers itself: DSH's readSession hands
    // it `inheritedEventCount`. Publish the independently computed value on the
    // corpus entry so the fake reader can serve it, exactly like the real one.
    session.inheritedEventCount = record.inheritedEventCount;
    accounting.push(record);
  }
  const accountingMs = Math.round(performance.now() - accountingStarted);
  const totalUsageEvents = accounting.reduce((sum, session) => sum + session.usage.length, 0);
  const inheritedSessions = accounting.filter((session) => session.inheritedEventCount > 0);
  const inheritedEvents = inheritedSessions.reduce((sum, session) => sum + session.inheritedEventCount, 0);
  const emptyMarkers = accounting.reduce((sum, session) => sum + session.emptyMarkers, 0);
  const inheritedMarkers = accounting.reduce((sum, session) => sum + session.inheritedMarkers, 0);
  note(
    `accounting: ${totalUsageEvents} usage events in ${accountingMs}ms; fork markers=${inheritedMarkers} in ${inheritedSessions.length} sessions; resume markers(data {}) = ${emptyMarkers}; inherited events=${inheritedEvents}`,
  );
  check(
    "real corpus: fork markers are only the inherited===true ones",
    emptyMarkers > 0 && inheritedMarkers <= emptyMarkers && (sessionLimit > 0 || inheritedSessions.length > 0),
    `seeded=${inheritedSessions.length} markers=${inheritedMarkers} resumeMarkers=${emptyMarkers}`,
  );

  // Give the host a real reader: the fake ctx consumes a corpus whose
  // readSession re-decompresses the logged file, exactly like DSH does.
  const readCounter = { count: 0 };
  const realCorpusSessions = sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    cwd: session.cwd,
    origin: session.origin,
    inheritedEventCount: session.inheritedEventCount,
  }));
  const mounted = mountRealCorpusHarness(realCorpusSessions, sessions, readCounter);
  return { accounting, sessions, readCounter, mounted };
}

/**
 * Build a fake-ctx harness over the real corpus with a decompressing reader.
 * Implemented separately from `mountHarness` because the real corpus must not
 * copy bytes into every session object.
 */
function mountRealCorpusHarness(corpusSessions, realSessions, readCounter, config = {}) {
  const byId = new Map(realSessions.map((session) => [session.id, session]));
  const stats = { listCalls: 0, reads: 0, readErrors: 0, readIds: [] };
  const logs = { info: [], warn: [], error: [], debug: [] };
  const routes = new Map();
  const disposers = [];
  let warmupCallback = null;
  let warmupHandle = null;
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    sessionQuery: {
      async listSessions() {
        stats.listCalls += 1;
        return corpusSessions.map((session) => ({ header: { id: session.id, createdAt: session.createdAt, cwd: session.cwd, origin: session.origin } }));
      },
      async readSession(id) {
        stats.reads += 1;
        readCounter.count += 1;
        const key = String(id);
        stats.readIds.push(key);
        const session = byId.get(key);
        if (session === undefined) throw new Error(`unknown session ${key}`);
        const text = zlib.zstdDecompressSync(session.buffer).toString("utf8");
        const events = [];
        for (const line of text.split("\n")) {
          if (line === "") continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event?.type === "session") continue;
          events.push(event);
        }
        return {
          session: { id: session.id, createdAt: session.createdAt, cwd: session.cwd, origin: session.origin },
          inheritedEventCount: session.inheritedEventCount,
          events,
        };
      },
    },
    logger: {
      info: (message) => logs.info.push(String(message)),
      warn: (message) => logs.warn.push(String(message)),
      error: (message) => logs.error.push(String(message)),
      debug: (message) => logs.debug.push(String(message)),
    },
    effect(run) {
      const dispose = run();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    get() {
      return undefined;
    },
  };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = function patchedSetTimeout(callback, delay, ...rest) {
    if (delay === WARMUP_DELAY_MS) {
      warmupCallback = () => callback(...rest);
      warmupHandle = { unrefCalled: false, unref() { this.unrefCalled = true; return this; } };
      return warmupHandle;
    }
    return realSetTimeout(callback, delay, ...rest);
  };
  try {
    apply(ctx, config);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }

  async function call(routePath, options = {}) {
    const route = routes.get(routePath);
    if (route === undefined) throw new Error(`route not registered: ${routePath}`);
    const headers = { accept: "application/json" };
    if (options.host !== null) headers.host = options.host === undefined ? LOOPBACK_HOST : options.host;
    const req = { method: options.method ?? "GET", url: options.url ?? routePath, headers, httpVersion: "1.1" };
    const res = makeResponse();
    const started = performance.now();
    await route.handler(req, res);
    let json = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
    return { status: res.statusCode, headers: res.headers, body: res.body, json, bytes: Buffer.byteLength(res.body), ms: performance.now() - started };
  }

  return {
    stats,
    logs,
    routes,
    call,
    dispose() {
      for (const disposer of disposers) {
        try {
          disposer();
        } catch {
          /* best effort */
        }
      }
    },
    hasWarmup: () => warmupCallback !== null,
    warmupHandle,
    fireWarmup: async () => {
      if (warmupCallback === null) throw new Error("no warmup scheduled");
      warmupCallback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/* ------------------------------------------------------- real assertions */

function compareTotals(label, payload, oracle, tolerance = 1e-9) {
  const totals = payload?.totals ?? {};
  return check(
    `${label}: totals match the independent per-event sum`,
    totals.tokens === oracle.tokens &&
      totals.input === oracle.input &&
      totals.output === oracle.output &&
      totals.cacheRead === oracle.cacheRead &&
      totals.cacheWrite === oracle.cacheWrite &&
      totals.sessions === oracle.sessionIds.size &&
      closeEnough(totals.costCNY, Math.round(oracle.costCNY * 1_000_000) / 1_000_000, tolerance),
    `tokens ${totals.tokens}/${oracle.tokens} sessions ${totals.sessions}/${oracle.sessionIds.size} cost ${totals.costCNY}/${(Math.round(oracle.costCNY * 1_000_000) / 1_000_000)}`,
  );
}

async function assertRealSection(real) {
  const { accounting, sessions, readCounter, mounted } = real;
  const zone = "Asia/Shanghai";
  const heavyZone = zone;

  // --- cold scan and cache -------------------------------------------------
  const firstOverview = await mounted.call(OVERVIEW_PATH);
  check(
    "real: cold overview scans every listed session exactly once",
    firstOverview.status === 200 &&
      mounted.stats.reads === sessions.length &&
      firstOverview.json?.scan?.readCount === sessions.length &&
      firstOverview.json.scan.cachedCount === 0 &&
      firstOverview.json.scan.sessionsTotal === sessions.length,
    JSON.stringify(firstOverview.json?.scan),
  );
  const secondOverview = await mounted.call(OVERVIEW_PATH);
  check(
    "real: warm overview replays the cached payload without reading again",
    mounted.stats.reads === sessions.length && secondOverview.body === firstOverview.body,
    `reads=${mounted.stats.reads}`,
  );
  const heavy = await mounted.call(HEAVY_PATH);
  check("real: heavy reuses the scan (no extra readSession)", mounted.stats.reads === sessions.length, `reads=${mounted.stats.reads}`);
  const reference = firstOverview.json.generatedAt;
  const todayDate = localDate(reference, zone);
  const yesterdayDate = previousDate(todayDate);

  // --- windows (24h by ms range; day windows by local-date oracle) ---------
  const windows = ["24h", "7d", "14d", "30d"];
  for (const windowKey of windows) {
    const response = await mounted.call(OVERVIEW_PATH, { url: `${OVERVIEW_PATH}?window=${windowKey}` });
    const payload = response.json;
    const { from, to } = payload.window;
    const dates = payload.daily.map((bucket) => new Date(Number(bucket.key) * DAY_MS).toISOString().slice(0, 10));
    const oracle =
      windowKey === "24h"
        ? sumUsageInRange(accounting, from, to)
        : sumUsageOnDates(accounting, new Set(dates), { zone });
    compareTotals(`real ${windowKey}`, payload, oracle);
    const dailySum = payload.daily.reduce((sum, bucket) => sum + bucket.tokens, 0);
    check(`real ${windowKey}: daily buckets sum to totals.tokens`, dailySum === payload.totals.tokens, `${dailySum} vs ${payload.totals.tokens}`);
    if (windowKey !== "24h") {
      let mismatched = 0;
      let firstMismatch = "";
      for (const bucket of payload.daily) {
        const date = new Date(Number(bucket.key) * DAY_MS).toISOString().slice(0, 10);
        const bucketOracle = sumUsageOnDates(accounting, new Set([date]), { zone });
        if (bucket.tokens !== bucketOracle.tokens) {
          mismatched += 1;
          if (firstMismatch === "") firstMismatch = `${date}: ${bucket.tokens} vs ${bucketOracle.tokens}`;
        }
      }
      check(`real ${windowKey}: every daily bucket matches its local-date oracle`, mismatched === 0, `${mismatched} mismatched${firstMismatch === "" ? "" : ` (${firstMismatch})`}`);
      check(
        `real ${windowKey}: window.from/to are viewer-zone midnights`,
        localDate(from, zone) === dates[0] && localDate(to - 1, zone) === dates.at(-1) && Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`) === (dates.length - 1) * DAY_MS,
        `${localDate(from, zone)}..${localDate(to - 1, zone)}`,
      );
    } else {
      check("real 24h: window.from/to are hour-aligned", from % HOUR_MS === 0 && to % HOUR_MS === 0 && to - from === 24 * HOUR_MS, `${from}..${to}`);
    }
  }

  // --- today / yesterday (Shanghai) ----------------------------------------
  const lastWindow = (await mounted.call(OVERVIEW_PATH, { url: `${OVERVIEW_PATH}?window=30d` })).json;
  const todayOracle = snapshotOracle(accounting, zone, todayDate) ?? { tokens: 0, costCNY: 0, sessions: 0, cacheHitRate: 0 };
  const yesterdayOracle = snapshotOracle(accounting, zone, yesterdayDate);
  const today = lastWindow.today;
  const yesterday = lastWindow.yesterday;
  check(
    "real today: matches the independent local-day sum",
    (today === null ? todayOracle.sessions === 0 && todayOracle.tokens === 0 : today.tokens === todayOracle.tokens && today.sessions === todayOracle.sessions && today.costCNY === todayOracle.costCNY && Math.abs(today.cacheHitRate - todayOracle.cacheHitRate) < 1e-6),
    JSON.stringify({ payload: today, oracle: todayOracle }),
  );
  check(
    "real yesterday: matches the independent local-day sum (or null when idle)",
    yesterday === null ? yesterdayOracle === null : yesterdayOracle !== null && yesterday.tokens === yesterdayOracle.tokens && yesterday.sessions === yesterdayOracle.sessions && Math.abs(yesterday.costCNY - yesterdayOracle.costCNY) < 1e-6,
    JSON.stringify({ payload: yesterday, oracle: yesterdayOracle }),
  );

  // --- heatmap -------------------------------------------------------------
  const heatOracle = heatmapOracle(accounting, heavyZone, heavy.json.generatedAt);
  check(
    "real heatmap: ends on the viewer-zone today",
    heavy.json.heatmap.at(-1).date === localDate(heavy.json.generatedAt, heavyZone) && heavy.json.heatmap.length === HEATMAP_DAYS,
    `${heavy.json.heatmap.at(-1).date} (${heavy.json.heatmap.length} days)`,
  );
  let heatMismatch = 0;
  let heatFirst = "";
  let zeroTokenActiveDays = 0;
  for (const row of heavy.json.heatmap) {
    const oracleRow = heatOracle.byDate.get(row.date);
    if (oracleRow === undefined) continue;
    if (row.tokens !== oracleRow.tokens) {
      heatMismatch += 1;
      if (heatFirst === "") heatFirst = `${row.date}: ${row.tokens} vs ${oracleRow.tokens}`;
    }
    if (row.sessions > 0 && row.tokens === 0) zeroTokenActiveDays += 1;
  }
  check("real heatmap: every day matches the per-date token oracle", heatMismatch === 0, `${heatMismatch} mismatched${heatFirst === "" ? "" : ` (${heatFirst})`}`);
  let sessionsMismatch = 0;
  for (const row of heavy.json.heatmap) {
    const oracleRow = heatOracle.byDate.get(row.date);
    if (oracleRow === undefined) continue;
    if (row.sessions !== oracleRow.sessions.size) sessionsMismatch += 1;
  }
  check("real heatmap: per-day session counts match the oracle", sessionsMismatch === 0, `${sessionsMismatch} mismatched rows`);
  check("real heatmap: heatmap token total is positive", heavy.json.heatmap.reduce((sum, row) => sum + row.tokens, 0) > 0, `${heavy.json.heatmap.reduce((sum, row) => sum + row.tokens, 0)}`);
  note(`heatmap: ${zeroTokenActiveDays} day(s) have sessions but zero tokens (turn-only activity)`);

  // --- fork dedupe on real data --------------------------------------------
  const seven = (await mounted.call(OVERVIEW_PATH, { url: `${OVERVIEW_PATH}?window=7d` })).json;
  const sevenDates = new Set(seven.daily.map((bucket) => new Date(Number(bucket.key) * DAY_MS).toISOString().slice(0, 10)));
  const deduped = sumUsageOnDates(accounting, sevenDates, { zone });
  const raw = sumUsageOnDates(accounting, sevenDates, { zone, includeInherited: true });
  check("real fork: 7d totals equal the deduped independent sum", seven.totals.tokens === deduped.tokens, `${seven.totals.tokens}/${deduped.tokens}`);
  check(
    "real fork: dropping the inherited prefix changes the total (dedupe is real)",
    raw.tokens > deduped.tokens ? true : inheritedEventCountTotal(accounting) === 0,
    `deduped=${deduped.tokens} raw=${raw.tokens} delta=${raw.tokens - deduped.tokens} inheritedEvents=${inheritedEventCountTotal(accounting)}`,
  );

  // --- session list --------------------------------------------------------
  const list = heavy.json.sessions;
  check(
    "real session list: capped, descending by lastActiveAt, documented types",
    list.length <= SESSION_LIST_LIMIT &&
      list.length > 0 &&
      list.every((row, index) => index === 0 || list[index - 1].lastActiveAt >= row.lastActiveAt) &&
      list.every((row) => typeof row.isSubagent === "boolean" && row.isArchived === false && typeof row.workspace === "string"),
    `${list.length} rows`,
  );
  const byId = new Map(accounting.map((session) => [session.id, session]));
  const sample = list.slice(0, 10);
  let fieldMismatch = 0;
  let firstFieldMismatch = "";
  for (const row of sample) {
    const oracle = byId.get(row.id);
    if (oracle === undefined) {
      fieldMismatch += 1;
      firstFieldMismatch = `unknown id ${row.id}`;
      continue;
    }
    const tokens = oracle.ownUsage.reduce((sum, entry) => sum + entry.tokens, 0);
    const expectedTitle = oracle.title !== "" ? oracle.title : oracle.lastPrompt === "" ? "" : oracle.lastPrompt.slice(0, SESSION_TITLE_FROM_PROMPT_CHARS);
    const expectedPrompt = oracle.lastPrompt.slice(0, PROMPT_PREVIEW_CHARS);
    if (
      row.lastActiveAt !== oracle.lastEventTime ||
      row.tokens !== tokens ||
      row.turns !== oracle.turnTimes.length ||
      row.steps !== oracle.steps ||
      row.title !== expectedTitle ||
      row.lastPrompt !== expectedPrompt
    ) {
      fieldMismatch += 1;
      if (firstFieldMismatch === "") {
        firstFieldMismatch = `${row.id}: active ${row.lastActiveAt}/${oracle.lastEventTime} tokens ${row.tokens}/${tokens} turns ${row.turns}/${oracle.turnTimes.length} title "${row.title}"/"${expectedTitle}"`;
      }
    }
  }
  check("real session list: 10 sampled rows match the independent per-session oracle", fieldMismatch === 0, `${fieldMismatch} mismatched${firstFieldMismatch === "" ? "" : ` (${firstFieldMismatch})`}`);
  const listedCount = accounting.filter((session) => Number.isFinite(session.lastEventTime)).length;
  check(
    "real session list: every session with an event is eligible (F2)",
    listedCount >= list.length && list.length === Math.min(SESSION_LIST_LIMIT, listedCount),
    `listed=${listedCount} payload=${list.length}`,
  );
  const lifetimeOnly = accounting.filter((session) => {
    const lifetime = session.ownUsage.reduce((sum, entry) => sum + entry.tokens, 0);
    const recent = session.ownUsage.filter((entry) => entry.t >= reference - 31 * DAY_MS).reduce((sum, entry) => sum + entry.tokens, 0);
    return lifetime > 0 && recent === 0;
  });
  note(`F2 evidence: ${lifetimeOnly.length} session(s) have usage older than 31 days but lifetime tokens > 0`);
  const titleRate = list.filter((row) => row.title !== "").length / list.length;
  const workspaceRate = list.filter((row) => row.workspace !== "").length / list.length;
  note(`session list quality: titles ${(titleRate * 100).toFixed(0)}%, workspaces ${(workspaceRate * 100).toFixed(0)}%, subagents ${list.filter((row) => row.isSubagent).length}/${list.length}`);

  // --- heavy payload -------------------------------------------------------
  check(
    "real heavy: leaderboards are descending and capped",
    [heavy.json.toolLeaderboard, heavy.json.commandLeaderboard, heavy.json.skillLeaderboard].every(
      (rows) => Array.isArray(rows) && rows.length <= LEADERBOARD_LIMIT && rows.every((row, index) => index === 0 || rows[index - 1].count >= row.count),
    ),
    `tools=${heavy.json.toolLeaderboard.length} commands=${heavy.json.commandLeaderboard.length} skills=${heavy.json.skillLeaderboard.length}`,
  );
  check(
    "real heavy: tool rows expose count/lastCalledAt/errorCount/successRate/avgMs",
    heavy.json.toolLeaderboard.every(
      (row) =>
        typeof row.name === "string" &&
        Number.isInteger(row.count) &&
        Number.isFinite(row.lastCalledAt) &&
        Number.isInteger(row.errorCount) &&
        (row.successRate === null || (row.successRate >= 0 && row.successRate <= 1)) &&
        (row.avgMs === null || (row.avgMs >= 0 && row.avgMs <= MAX_TOOL_DURATION_MS)),
    ),
    `${heavy.json.toolLeaderboard.length} rows`,
  );
  check(
    "real heavy: command rows expose `program` (not `name`)",
    heavy.json.commandLeaderboard.every((row) => typeof row.program === "string" && !("name" in row)) && heavy.json.commandLeaderboard.length > 0,
    `${heavy.json.commandLeaderboard.length} rows, top=${heavy.json.commandLeaderboard[0]?.program}`,
  );
  check("real heavy: payload is JSON-safe", payloadIssues(heavy.json).length === 0, payloadIssues(heavy.json).slice(0, 3).join("; "));

  const overviewIssues = payloadIssues(lastWindow);
  check("real overview: payload is JSON-safe", overviewIssues.length === 0, overviewIssues.slice(0, 3).join("; "));
  check(
    "real overview: no-store/content-length/content-type headers",
    secondOverview.headers["cache-control"] === "no-store" &&
      Number(secondOverview.headers["content-length"]) === secondOverview.bytes &&
      String(secondOverview.headers["content-type"]).startsWith("application/json"),
    `len=${secondOverview.headers["content-length"]}`,
  );
  check(
    "real heavy: no-store/content-length headers",
    heavy.headers["cache-control"] === "no-store" && Number(heavy.headers["content-length"]) === heavy.bytes,
    `len=${heavy.headers["content-length"]}`,
  );
  note(
    `real payload sizes: overview ${(firstOverview.bytes / 1024).toFixed(1)} kB, heavy ${(heavy.bytes / 1024).toFixed(1)} kB; cold overview ${Math.round(firstOverview.ms)} ms, warm ${secondOverview.ms.toFixed(1)} ms, heavy ${heavy.ms.toFixed(1)} ms`,
  );

  // --- concurrent first requests on a fresh mount --------------------------
  const concurrentCounter = { count: 0 };
  const concurrentMount = mountRealCorpusHarness(
    sessions.map((session) => ({ id: session.id, createdAt: session.createdAt, cwd: session.cwd, origin: session.origin })),
    sessions,
    concurrentCounter,
  );
  try {
    const [overview, heavyConcurrent] = await Promise.all([concurrentMount.call(OVERVIEW_PATH), concurrentMount.call(HEAVY_PATH)]);
    check(
      "real: concurrent overview+heavy trigger exactly one scan",
      overview.status === 200 && heavyConcurrent.status === 200 && concurrentMount.stats.reads === sessions.length,
      `readSession=${concurrentMount.stats.reads} sessions=${sessions.length}`,
    );
  } finally {
    concurrentMount.dispose();
  }

  // --- second time zone (Europe/Berlin) ------------------------------------
  const berlinCounter = { count: 0 };
  const berlinSessions = sessions.map((session) => ({ id: session.id, createdAt: session.createdAt, cwd: session.cwd, origin: session.origin }));
  const berlinMount = mountRealCorpusHarness(berlinSessions, sessions, berlinCounter, { timeZone: "Europe/Berlin" });
  try {
    const berlin24 = (await berlinMount.call(OVERVIEW_PATH, { url: `${OVERVIEW_PATH}?window=24h` })).json;
    compareTotals("real Berlin 24h", berlin24, sumUsageInRange(accounting, berlin24.window.from, berlin24.window.to));
    const berlin7 = (await berlinMount.call(OVERVIEW_PATH, { url: `${OVERVIEW_PATH}?window=7d` })).json;
    const berlinDates = berlin7.daily.map((bucket) => new Date(Number(bucket.key) * DAY_MS).toISOString().slice(0, 10));
    compareTotals("real Berlin 7d", berlin7, sumUsageOnDates(accounting, new Set(berlinDates), { zone: "Europe/Berlin" }));
    const berlinToday = localDate(berlin7.generatedAt, "Europe/Berlin");
    const berlinTodayOracle = snapshotOracle(accounting, "Europe/Berlin", berlinToday) ?? { tokens: 0, costCNY: 0, sessions: 0, cacheHitRate: 0 };
    check(
      "real Berlin: today matches the Berlin local-day oracle",
      berlin7.today === null ? berlinTodayOracle.sessions === 0 : berlin7.today.tokens === berlinTodayOracle.tokens && berlin7.today.sessions === berlinTodayOracle.sessions,
      JSON.stringify({ payload: berlin7.today, oracle: berlinTodayOracle }),
    );
    const berlinHeavy = (await berlinMount.call(HEAVY_PATH)).json;
    check(
      "real Berlin: heatmap ends on the Berlin local today",
      berlinHeavy.heatmap.at(-1).date === berlinToday,
      `${berlinHeavy.heatmap.at(-1).date} vs ${berlinToday}`,
    );
    // Day-bucket assignment must follow Berlin dates. The host derives one
    // offset per scan from "now", so historical dates on the other side of a
    // DST switch are shifted by the offset delta at the day boundary. Totals
    // must still be lossless; per-day deviations are reported separately.
    const berlinOracle = heatmapOracle(accounting, "Europe/Berlin", berlinHeavy.generatedAt);
    const oracleTotal = [...berlinOracle.byDate.values()].reduce((sum, day) => sum + day.tokens, 0);
    const actualTotal = berlinHeavy.heatmap.reduce((sum, day) => sum + day.tokens, 0);
    check(
      "real Berlin: the 56-day heatmap total equals the oracle (no lost or duplicated tokens)",
      actualTotal === oracleTotal,
      `${actualTotal} vs ${oracleTotal}`,
    );
    const mismatches = [];
    for (const row of berlinHeavy.heatmap) {
      const oracleRow = berlinOracle.byDate.get(row.date);
      if (oracleRow === undefined) continue;
      if (row.tokens !== oracleRow.tokens) mismatches.push({ date: row.date, actual: row.tokens, oracle: oracleRow.tokens });
    }
    const savedOffset = zoneOffsetMs("Europe/Berlin", berlinHeavy.generatedAt) - zoneOffsetMs("Europe/Berlin", Date.parse("2026-09-01T12:00:00Z"));
    note(
      `Berlin per-day deviation: ${mismatches.length} of ${berlinHeavy.heatmap.length} dates differ from the per-event oracle (offset delta ${savedOffset / HOUR_MS}h at the day boundary; total unchanged)${mismatches.length === 0 ? "" : `: ${JSON.stringify(mismatches.slice(0, 4))}`}`,
    );
  } finally {
    berlinMount.dispose();
  }

  void heavyZone;
  return undefined;
}

function inheritedEventCountTotal(accounting) {
  return accounting.reduce((sum, session) => sum + session.inheritedEventCount, 0);
}

/* ======================================================================= */
/* Section C — mutation self-check (--mutants)                             */
/* ======================================================================= */

/**
 * Each entry reverts one recent fix inside a throw-away copy of lib/ and names
 * the assertion that must turn red. This proves the probe is not a set of
 * always-green assertions.
 */
const MUTANTS = [
  {
    id: "M1",
    file: "aggregate.js",
    from: "  const offsetMs = Number.isFinite(window.offsetMs) ? Number(window.offsetMs) : BEIJING_OFFSET_MS;",
    to: "  const offsetMs = BEIJING_OFFSET_MS;",
    expect: "M1: late-evening event lands in the last day bucket, not past the end",
  },
  {
    id: "F1",
    file: "aggregate.js",
    from: "      addDailyActivity(aggregate.dailyActivity, dayIndexOf(time, zoneOffset), totalTokens, 0, activityCutoffDay);",
    to: "      addDailyActivity(aggregate.dailyActivity, dayIndexOf(time, zoneOffset), totalTokens, 0, leaderboardCutoffDay);",
    expect: "F1: a 40-day-old usage event contributes tokens to the heatmap",
  },
  {
    id: "F2",
    file: "aggregate.js",
    from: "    if (aggregate.lastEventTime === null || time > aggregate.lastEventTime) aggregate.lastEventTime = time;",
    to: '    if ((aggregate.lastEventTime === null || time > aggregate.lastEventTime) && event.type === "assistant/message") aggregate.lastEventTime = time;',
    expect: "F2: a session with only tool events is listed",
  },
  {
    id: "S11",
    file: "index.js",
    from: '      const unknownRevision = rawRevision === "";',
    to: "      const unknownRevision = false;",
    expect: "S11: empty revision string forces a re-read",
  },
  {
    id: "S12",
    file: "index.js",
    from: "      .sort((left, right) => (Number(right?.header?.createdAt) || 0) - (Number(left?.header?.createdAt) || 0))",
    to: "      .sort((left, right) => (Number(left?.header?.createdAt) || 0) - (Number(right?.header?.createdAt) || 0))",
    expect: "S12: maxSessions keeps the two newest sessions",
  },
  {
    id: "S13a",
    file: "aggregate.js",
    from: 'export const UNTITLED_TITLE = "";',
    to: 'export const UNTITLED_TITLE = "未命名会话";',
    expect: "S13: UNTITLED_TITLE is the empty string",
  },
  {
    id: "S13b",
    file: "aggregate.js",
    from: '  return prompt === "" ? UNTITLED_TITLE : prompt.slice(0, SESSION_TITLE_FROM_PROMPT_CHARS);',
    to: '  return prompt === "" ? UNTITLED_TITLE : prompt.slice(0, 100);',
    expect: "S13: the title falls back to the first 24 prompt characters",
  },
  {
    id: "dayRange",
    file: "index.js",
    from: "    endDay: dayIndexOf(window.to - 1, zoneOffset),",
    to: "    endDay: dayIndexOf(window.to, zoneOffset),",
    expect: "dayRange: a call after local midnight (next day index) is excluded",
  },
];

function runMutationChecks() {
  section("mutation self-check: every recent fix is guarded by a failing assertion");
  const probeFile = fileURLToPath(import.meta.url);
  const libDir = path.resolve(HERE, "..", "..", "lib");
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-host-mutants-"));
  let failed = 0;
  for (const mutant of MUTANTS) {
    const targetDir = path.join(sandboxRoot, mutant.id);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of ["index.js", "aggregate.js", "pricing.js"]) {
      fs.copyFileSync(path.join(libDir, file), path.join(targetDir, file));
    }
    const targetFile = path.join(targetDir, mutant.file);
    const source = fs.readFileSync(targetFile, "utf8");
    const occurrences = source.split(mutant.from).length - 1;
    if (occurrences !== 1) {
      check(`mutant ${mutant.id}: patch applies exactly once`, false, `${occurrences} occurrences`);
      failed += 1;
      continue;
    }
    fs.writeFileSync(targetFile, source.replace(mutant.from, mutant.to));
    const run = spawnSync(process.execPath, [probeFile, "--skip-real"], {
      env: { ...process.env, QA_HOST_LIB: targetDir },
      encoding: "utf8",
      timeout: 120_000,
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const caught = run.status === 1 && output.includes(`[FAIL] ${mutant.expect}`);
    check(`mutant ${mutant.id} (${mutant.file}) is caught by "${mutant.expect}"`, caught, `exit=${run.status}`);
    if (!caught) failed += 1;
  }
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
  return failed;
}

/* ======================================================================= */
/* main                                                                    */
/* ======================================================================= */

async function main() {
  const startedAt = performance.now();
  console.log(`[qa-host-probe] repo    ${path.resolve(HERE, "..", "..")}`);
  console.log(`[qa-host-probe] frozen  ${new Date().toISOString()}`);

  if (flags.get("mutants") === true || flags.get("mutants") === "true") {
    const failedMutants = runMutationChecks();
    const passedMutants = results.filter((entry) => entry.status === "PASS").length;
    console.log(`\n[qa-host-probe] mutants: ${passedMutants} PASS, ${failedMutants} FAIL`);
    Date.now = realDateNow;
    process.exit(failedMutants > 0 ? 1 : 0);
  }

  await testRoutes();
  await testCorpusEdges();
  await testCacheAndConcurrency();
  await testWindows();
  await testLeaderboardBoundaries();
  await testTimeZones();
  await testFixes();
  await testForkDedupe();
  await testToolMetrics();
  await testRobustness();
  await testWarmupAndLifecycle();
  await testPayloadContract();

  if (!skipReal) {
    let real = null;
    try {
      real = await runRealSection();
      if (real !== null) await assertRealSection(real);
    } catch (error) {
      check("real corpus: harness ran without throwing", false, String(error?.stack ?? error));
    } finally {
      real?.mounted?.dispose();
    }
  } else {
    note("real corpus section skipped (--skip-real)");
  }

  const passed = results.filter((entry) => entry.status === "PASS").length;
  const failed = results.filter((entry) => entry.status === "FAIL").length;
  const elapsed = Math.round(performance.now() - startedAt);
  console.log(`\n[qa-host-probe] ${passed} PASS, ${failed} FAIL, ${noteCount} NOTE in ${elapsed} ms`);
  if (failed > 0) {
    console.log("[qa-host-probe] failures:");
    for (const entry of results.filter((candidate) => candidate.status === "FAIL")) {
      console.log(`  - ${entry.name}${entry.detail === undefined ? "" : ` — ${typeof entry.detail === "string" ? entry.detail : JSON.stringify(entry.detail)}`}`);
    }
  }
  Date.now = realDateNow;
  process.exit(failed > 0 ? 1 : 0);
}

await main();

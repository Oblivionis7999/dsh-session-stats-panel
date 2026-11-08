/**
 * Session-stats panel — host half.
 *
 * Serves two loopback-only JSON endpoints for the browser half:
 * - `GET /session-stats/api/overview?window=24h|7d|14d|30d` — token/cost/
 *   cache-hit aggregates over the session log corpus (incremental, cached);
 * - `GET /session-stats/api/live` — process CPU, memory, event-loop delay,
 *   uptime, and a 5-minute CPU ring buffer (no I/O, well under 50 ms).
 *
 * Aggregation strategy: `sessionQuery.listSessions()` names the corpus and
 * `sessionPersistence.list()` supplies each stored session's opaque revision
 * token, so only sessions whose revision changed are re-read. Unchanged
 * sessions are served from an in-memory aggregate cache; a full response is
 * additionally cached for `ttlMs`. When no persistence backend is available
 * the cache falls back to a per-session TTL.
 *
 * All routes reject requests whose `Host` header is not a loopback authority
 * (127.0.0.1 / localhost / [::1]) with 403, and every response is
 * `Cache-Control: no-store`.
 *
 * @module dsh-session-stats-panel/host
 */

import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

import {
  DEFAULT_USD_RATE,
  DEFAULT_WINDOW,
  WINDOWS,
  buildCommandLeaderboard,
  buildHeatmap,
  buildOverview,
  buildSessionList,
  buildSkillLeaderboard,
  buildToolLeaderboard,
  dayIndexOf,
  pruneSessionAggregate,
  resolveWindow,
  summarizeSessionEvents,
  zoneOffsetMs,
} from "./aggregate.js";
import { createPricing } from "./pricing.js";

/** Exact route path of the aggregation endpoint. */
export const OVERVIEW_PATH = "/session-stats/api/overview";
/** Exact route path of the live process snapshot endpoint. */
export const LIVE_PATH = "/session-stats/api/live";
/** Exact route path of the chunked heavy payload (leaderboards, session list, heatmap). */
export const HEAVY_PATH = "/session-stats/api/heavy";
/** Delay before the background warmup scan (PERF-03); the first panel open must hit a warm cache. */
export const WARMUP_DELAY_MS = 2_000;

/** Required host services: HTTP routes plus the session corpus reader. */
export const inject = ["webServer", "sessionQuery"];

/** Built-in defaults for every configurable option. */
export const DEFAULTS = Object.freeze({
  /** CNY per 1 USD used for the derived USD display. */
  usdRate: DEFAULT_USD_RATE,
  /** Full overview response cache TTL in milliseconds. */
  ttlMs: 60_000,
  /** Window served when a request names none (or an unknown one). */
  window: DEFAULT_WINDOW,
  /** Live CPU sampling interval in milliseconds. */
  liveIntervalMs: 5_000,
  /** Number of samples kept for the 5-minute CPU sparkline. */
  livePoints: 60,
  /** Parallel `readSession` calls during one scan. */
  sessionConcurrency: 3,
  /** Per-session read timeout in milliseconds. */
  readTimeoutMs: 10_000,
  /** Hard cap on sessions folded into one response. */
  maxSessions: 5_000,
  /** Extra loopback host names allowed besides 127.0.0.1/localhost/[::1]. */
  allowedHosts: [],
  /** Trust private-network Host names (192.168/10/172.16, *.local). Off by default. */
  allowPrivateHosts: false,
  /** IANA time zone used for day buckets and peak/off-peak pricing. */
  timeZone: "Asia/Shanghai",
  /**
   * Beijing dates (`YYYY-MM-DD`) billed at off-peak prices.
   * `null` means "use the built-in 2026 calendar"; an explicit array (even an
   * empty one) is the host's authoritative list.
   */
  holidays: null,
  /** Weekend dates that are make-up working days (billed at peak prices). */
  makeupWorkdays: null,
  /** Verbose host logging. */
  debug: false,
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

/**
 * Whether a hostname is a private / link-local address or a LAN name.
 *
 * A developer running this plugin on a laptop still opens the WebUI from a
 * phone or another machine on the same network, where `Host` is a private IP
 * such as 192.168.1.20:2820. Those are not loopback, but they are not public
 * either. Public hostnames stay rejected, which is what keeps a DNS-rebinding
 * page from reading the local session log.
 * @param {string} hostname - lower-cased Host name without port.
 * @returns {boolean} true for private IPv4/IPv6 literals, *.local and bare names.
 */
function isPrivateHost(hostname) {
  if (hostname.endsWith(".local")) return true;
  if (hostname === "" || !hostname.includes(".")) return true; // single-label LAN name (e.g. "mybox")
  // Private / link-local IPv4 ranges: 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe8") || hostname.startsWith("fe9") || hostname.startsWith("fea") || hostname.startsWith("feb")) return true;
  return false;
}

/**
 * Normalize the plugin config from `cordis.patch.yml`.
 * @param {unknown} config - raw loader config.
 * @returns {typeof DEFAULTS} validated, frozen config.
 */
export function normalizeConfig(config) {
  const raw = config !== null && typeof config === "object" ? config : {};
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  return Object.freeze({
    usdRate: number(raw.usdRate, DEFAULTS.usdRate, 0.01, 1_000),
    ttlMs: Math.round(number(raw.ttlMs, DEFAULTS.ttlMs, 0, 3_600_000)),
    window: typeof raw.window === "string" && WINDOWS[raw.window] !== undefined ? raw.window : DEFAULTS.window,
    liveIntervalMs: Math.round(number(raw.liveIntervalMs, DEFAULTS.liveIntervalMs, 1_000, 60_000)),
    livePoints: Math.round(number(raw.livePoints, DEFAULTS.livePoints, 6, 600)),
    sessionConcurrency: Math.round(number(raw.sessionConcurrency, DEFAULTS.sessionConcurrency, 1, 16)),
    readTimeoutMs: Math.round(number(raw.readTimeoutMs, DEFAULTS.readTimeoutMs, 100, 120_000)),
    maxSessions: Math.round(number(raw.maxSessions, DEFAULTS.maxSessions, 1, 100_000)),
    allowedHosts: Array.isArray(raw.allowedHosts) ? raw.allowedHosts.map((value) => String(value).trim()).filter(Boolean) : [],
    allowPrivateHosts: raw.allowPrivateHosts === true,
    timeZone: typeof raw.timeZone === "string" && raw.timeZone.trim() !== "" ? raw.timeZone.trim() : DEFAULTS.timeZone,
    holidays: Array.isArray(raw.holidays) ? raw.holidays.map((value) => String(value).trim()).filter(Boolean) : null,
    makeupWorkdays: Array.isArray(raw.makeupWorkdays)
      ? raw.makeupWorkdays.map((value) => String(value).trim()).filter(Boolean)
      : null,
    debug: raw.debug === true,
  });
}

/** @param {unknown} error - thrown value. @returns {string} one-line description. */function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Named, failure-isolated logger over the cordis logger service.
 * @param {object} ctx - host context.
 * @param {typeof DEFAULTS} options - normalized config.
 * @returns {{info: Function, warn: Function, error: Function, debug: Function}} logger facade.
 */
function createLogger(ctx, options) {
  const service = ctx?.logger;
  const write = (level, message) => {
    try {
      if (service !== undefined && service !== null && typeof service[level] === "function") service[level](message);
    } catch {
      /* logging must never break a request */
    }
  };
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
    debug: (message) => {
      if (options.debug) write("debug", message);
    },
  };
}

/**
 * Whether a request's `Host` header names a loopback authority.
 * @param {object} req - `IncomingMessage`-shaped request.
 * @param {typeof DEFAULTS} options - normalized config.
 * @returns {boolean} true when the host is local (or explicitly allowed).
 */
export function isLoopbackRequest(req, options) {
  const raw = req?.headers?.host;
  if (typeof raw !== "string" || raw.trim() === "") return false;
  let hostname;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    hostname = end > 1 ? raw.slice(1, end) : raw;
  } else {
    const colon = raw.lastIndexOf(":");
    hostname = colon > 0 && /^\d+$/.test(raw.slice(colon + 1)) ? raw.slice(0, colon) : raw;
  }
  const normalized = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  // Opt-in only: this endpoint exposes local conversation logs, so a LAN peer
  // is not trusted by default. See `allowPrivateHosts` in the docs.
  if (options.allowPrivateHosts === true && isPrivateHost(normalized)) return true;
  for (const allowed of options.allowedHosts) {
    if (allowed.toLowerCase() === normalized) return true;
  }
  return false;
}

/**
 * Write one JSON response with the mandatory no-store and sniffing headers.
 * @param {object} res - `ServerResponse`-shaped response.
 * @param {number} status - HTTP status code.
 * @param {unknown} body - JSON-serializable payload.
 * @returns {void}
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
}

/**
 * Apply the loopback fence and the method allow-list.
 * @param {object} req - request.
 * @param {object} res - response.
 * @param {string} method - the only accepted HTTP method.
 * @param {typeof DEFAULTS} options - normalized config (fence allow-list).
 * @returns {boolean} true when the handler may continue.
 */
function guard(req, res, method, options) {
  if (!isLoopbackRequest(req, options)) {
    sendJson(res, 403, {
      ok: false,
      error: "forbidden",
      message:
        "this endpoint only answers loopback requests; to view the panel over a LAN address or reverse proxy, set \"allowPrivateHosts: true\" (private ranges only) or add the host to \"allowedHosts\" in cordis.patch.yml",
      host: (req?.headers?.host ?? null),
    });
    return false;
  }
  if (req?.method !== method) {
    res.setHeader("allow", method);
    sendJson(res, 405, {
      ok: false,
      error: "method_not_allowed",
      message: `only ${method} is supported`,
    });
    return false;
  }
  return true;
}

/**
 * Process-local live sampler: 5-second CPU ticks into a fixed ring buffer plus
 * on-demand memory / event-loop / uptime readings. Every read is synchronous
 * and allocation-light so `/live` answers well inside 50 ms.
 * @param {typeof DEFAULTS} options - normalized config.
 * @returns {{snapshot: () => object, dispose: () => void}} sampler.
 */
export function createLiveSampler(options) {
  const intervalMs = options.liveIntervalMs;
  const points = options.livePoints;
  const cores = Math.max(1, os.cpus().length);
  const history = new Float64Array(points);
  let cursor = 0;
  let filled = 0;
  let latest = 0;
  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const tick = () => {
    const nowAt = process.hrtime.bigint();
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const elapsedUs = Number(nowAt - lastAt) / 1_000;
    lastAt = nowAt;
    const percent = elapsedUs > 0 ? ((cpu.user + cpu.system) / elapsedUs) * 100 : 0;
    latest = Number.isFinite(percent) && percent > 0 ? percent : 0;
    history[cursor] = latest;
    cursor = (cursor + 1) % points;
    if (filled < points) filled += 1;
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  const readHistory = () => {
    const values = [];
    for (let offset = 0; offset < filled; offset += 1) {
      const index = (cursor - filled + offset + points) % points;
      values.push(Math.round(history[index] * 10) / 10);
    }
    return values;
  };
  return {
    snapshot() {
      const memory = process.memoryUsage();
      const p99Ns = histogram.percentile(99);
      const meanNs = histogram.mean;
      histogram.reset();
      const values = readHistory();
      let peak = 0;
      for (const value of values) if (value > peak) peak = value;
      const uptimeSec = Math.floor(process.uptime());
      // A freshly enabled histogram has no samples yet: mean/percentile are NaN.
      const milliseconds = (nanoseconds) => {
        const value = Number(nanoseconds) / 1_000_000;
        return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
      };
      return {
        ok: true,
        sampledAt: Date.now(),
        intervalMs,
        points,
        windowSec: Math.round((points * intervalMs) / 1_000),
        cpu: {
          single: Math.round(latest * 10) / 10,
          machine: Math.round((latest / cores) * 10) / 10,
          cores,
        },
        memory: {
          rssMB: Math.round(memory.rss / 1_048_576),
          heapUsedMB: Math.round(memory.heapUsed / 1_048_576),
          heapTotalMB: Math.round(memory.heapTotal / 1_048_576),
          externalMB: Math.round(memory.external / 1_048_576),
          arrayBuffersMB: Math.round((memory.arrayBuffers ?? 0) / 1_048_576),
        },
        eventLoop: {
          p99ms: milliseconds(p99Ns),
          meanMs: milliseconds(meanNs),
          resolutionMs: 10,
        },
        uptimeSec,
        uptimeText: formatUptime(uptimeSec),
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        history: {
          values,
          peak: Math.round(peak * 10) / 10,
          windowSec: Math.round((points * intervalMs) / 1_000),
          intervalMs,
        },
      };
    },
    dispose() {
      clearInterval(timer);
      histogram.disable();
    },
  };
}

/**
 * Compact uptime text: `42s`, `29m`, `3h 05m`, `2d 4h`.
 * @param {number} seconds - uptime in whole seconds.
 * @returns {string} compact text.
 */
export function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Reject after `timeoutMs` when `promise` has not settled.
 * @template T
 * @param {Promise<T>} promise - operation to bound.
 * @param {number} timeoutMs - timeout in milliseconds.
 * @returns {Promise<T>} bounded promise.
 */
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run `worker` over `items` with a bounded number of in-flight calls.
 * @template T
 * @param {readonly T[]} items - work items.
 * @param {number} concurrency - maximum in-flight calls.
 * @param {(item: T, index: number) => Promise<void>} worker - async worker; must not throw.
 * @returns {Promise<void>} resolves when every item settled.
 */
async function runPool(items, concurrency, worker) {
  let index = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  const run = async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  };
  await Promise.all(Array.from({ length: lanes }, run));
}

/**
 * Assemble the chunked heavy payload: leaderboards, session list, and the
 * 56-day heatmap, all from the aggregates of one shared scan.
 * @param {readonly object[]} aggregates - per-session aggregates from the scan.
 * @param {{now: number, windowKey: string, timeZone: string}} meta - reference instant, requested window, viewer zone.
 * @returns {{ok: boolean, generatedAt: number, heatmap: object[], toolLeaderboard: object[], commandLeaderboard: object[], skillLeaderboard: object[], sessions: object[]}} JSON-safe heavy payload.
 */
function buildHeavy(aggregates, { now, windowKey, timeZone }) {
  const reference = Number.isFinite(now) ? Number(now) : Date.now();
  const zone = typeof timeZone === "string" && timeZone !== "" ? timeZone : "Asia/Shanghai";
  const zoneOffset = zoneOffsetMs(zone, reference);
  const window = resolveWindow(windowKey, reference, zoneOffset);
  // Leaderboards are day-granular, so both window shapes are mapped onto the
  // calendar days they touch (a 24h window is usually two days). `window.to` is
  // exclusive, so subtracting 1 ms keeps the range inside the requested window
  // instead of pulling in the whole next day.
  const dayRange = {
    startDay: dayIndexOf(window.from, zoneOffset),
    endDay: dayIndexOf(window.to - 1, zoneOffset),
  };
  return {
    ok: true,
    generatedAt: reference,
    heatmap: buildHeatmap(aggregates, zone, reference),
    toolLeaderboard: buildToolLeaderboard(aggregates, dayRange),
    commandLeaderboard: buildCommandLeaderboard(aggregates, dayRange),
    skillLeaderboard: buildSkillLeaderboard(aggregates, dayRange),
    sessions: buildSessionList(aggregates),
  };
}

/**
 * Register the host half: three exact routes plus the live sampler lifecycle.
 * @param {object} ctx - host cordis context (needs `webServer`, `sessionQuery`).
 * @param {unknown} [config] - loader config.
 * @returns {void}
 */
export function apply(ctx, config) {
  const options = normalizeConfig(config);
  // Peak/off-peak is DeepSeek's own rule and is defined in Beijing wall-clock
  // time; it must NOT follow the viewer's zone. Only the day/hour buckets do.
  const pricing = createPricing({
    // null/undefined both mean "not configured" -> built-in 2026 calendar.
    holidays: options.holidays === null ? undefined : options.holidays,
    makeupWorkdays: options.makeupWorkdays === null ? undefined : options.makeupWorkdays,
    usdRate: options.usdRate,
  });
  const logger = createLogger(ctx, options);
  /** @type {Map<string, {revision: string|null, at: number, aggregate: object}>} */
  const sessionCache = new Map();
  /** @type {Map<string, {at: number, payload: object}>} */
  const responseCache = new Map();
  /** @type {Map<string, {at: number, payload: object}>} */
  const heavyCache = new Map();
  /** @type {Promise<object>|null} */
  let scanInFlight = null;
  const live = createLiveSampler(options);
  const disposers = [];

  /** Resolve the optional persistence backend without requiring injection. */
  const resolvePersistence = () => {
    try {
      if (typeof ctx?.get === "function") {
        const service = ctx.get("sessionPersistence");
        if (service !== undefined && service !== null) return service;
      }
    } catch {
      /* fall through to the property read */
    }
    try {
      return ctx?.sessionPersistence;
    } catch {
      return undefined;
    }
  };

  /** Per-session opaque revision tokens, or null when the backend cannot list. */
  const readRevisions = async () => {
    const persistence = resolvePersistence();
    if (persistence === undefined || persistence === null || typeof persistence.list !== "function") return null;
    try {
      const snapshots = await persistence.list();
      if (!Array.isArray(snapshots)) return null;
      const revisions = new Map();
      for (const snapshot of snapshots) {
        const id = snapshot?.header?.id;
        if (id === undefined || id === null) continue;
        revisions.set(String(id), String(snapshot.revision ?? ""));
      }
      return revisions;
    } catch (error) {
      logger.debug(`[session-stats] persistence.list failed: ${describeError(error)}`);
      return null;
    }
  };

  /** Full incremental scan: reuse unchanged session aggregates, re-read the rest. */
  const runScan = async (now) => {
    const sessionQuery = ctx?.sessionQuery;
    if (sessionQuery === undefined || sessionQuery === null || typeof sessionQuery.listSessions !== "function") {
      throw new Error("sessionQuery service is unavailable");
    }
    const records = await sessionQuery.listSessions();
    const listed = Array.isArray(records) ? records : [];
    // `listSessions` does not promise an order: newest sessions must win the cap.
    const limited = [...listed]
      .sort((left, right) => (Number(right?.header?.createdAt) || 0) - (Number(left?.header?.createdAt) || 0))
      .slice(0, options.maxSessions);
    // One viewer-zone offset per scan, so day buckets and pruning agree.
    const zoneOffset = zoneOffsetMs(options.timeZone, now);
    const revisions = await readRevisions();
    const aggregates = [];
    const pending = [];
    const seen = new Set();
    let cachedCount = 0;
    for (const record of limited) {
      const header = record?.header ?? {};
      const id = String(header.id ?? "");
      if (id === "") continue;
      seen.add(id);
      const cached = sessionCache.get(id);
      const rawRevision = revisions === null ? undefined : revisions.get(id);
      // An empty revision string carries no change signal (some backends report
      // ""): treat it as unknown and force a re-read instead of freezing the
      // cache entry forever (S11).
      const unknownRevision = rawRevision === "";
      const revision = rawRevision === undefined || unknownRevision ? undefined : rawRevision;
      const unchanged =
        cached !== undefined &&
        (unknownRevision
          ? false
          : revision !== undefined
            ? cached.revision === revision
            : now - cached.at < options.ttlMs);
      if (unchanged) {
        cached.at = now;
        aggregates.push(cached.aggregate);
        cachedCount += 1;
        continue;
      }
      pending.push({
        id,
        revision: revision ?? null,
        createdAt: Number(header.createdAt) || 0,
        cwd: String(header.cwd ?? ""),
        isSubagent: header.origin === "subagent",
      });
    }
    for (const id of sessionCache.keys()) {
      if (!seen.has(id)) sessionCache.delete(id);
    }
    let readCount = 0;
    await runPool(pending, options.sessionConcurrency, async (item) => {
      readCount += 1;
      try {
        const snapshot = await withTimeout(sessionQuery.readSession(item.id), options.readTimeoutMs);
        const allEvents = Array.isArray(snapshot?.events) ? snapshot.events : [];
        // Forked / seeded sessions replay the parent's prefix verbatim; only the
        // tail after `inheritedEventCount` is this session's own activity, so a
        // forked copy must not be billed (or counted) twice.
        const inherited = Number(snapshot?.inheritedEventCount) || 0;
        const events = inherited > 0 ? allEvents.slice(inherited) : allEvents;
        const session = snapshot?.session ?? {};
        const createdAt = Number(session.createdAt ?? item.createdAt) || 0;
        // `readSession().session` is authoritative; the list header is the
        // fallback because it also carries cwd/origin.
        const workspace = String(session.cwd ?? item.cwd ?? "");
        const isSubagent = session.origin === "subagent" || item.isSubagent === true;
        const aggregate = summarizeSessionEvents(item.id, events, { createdAt, pricing, now, zoneOffset, workspace, isSubagent });
        pruneSessionAggregate(aggregate, now, zoneOffset);
        sessionCache.set(item.id, { revision: item.revision, at: now, aggregate });
        aggregates.push(aggregate);
      } catch (error) {
        logger.warn(`[session-stats] readSession(${item.id}) failed: ${describeError(error)}`);
        const cached = sessionCache.get(item.id);
        if (cached !== undefined) {
          // The list header still refreshes metadata the cached aggregate lacks.
          if (cached.aggregate.workspace === "" && item.cwd !== "") cached.aggregate.workspace = item.cwd;
          if (item.isSubagent === true) cached.aggregate.isSubagent = true;
          aggregates.push(cached.aggregate);
        }
      }
    });
    logger.debug(
      `[session-stats] scan: listed=${listed.length} cached=${cachedCount} read=${readCount} kept=${aggregates.length}`,
    );
    return { aggregates, listed: listed.length, readCount, cachedCount };
  };

  /** Deduplicated scan shared by concurrent overview requests. */
  const scanSessions = async (now) => {
    if (scanInFlight !== null) return scanInFlight;
    const promise = runScan(now);
    scanInFlight = promise;
    try {
      return await promise;
    } finally {
      if (scanInFlight === promise) scanInFlight = null;
    }
  };

  /** Cached overview payload for one window. */
  const buildOverviewPayload = async (requestedWindow) => {
    const windowKey = WINDOWS[requestedWindow] !== undefined ? requestedWindow : options.window;
    const cacheKey = `${windowKey}@${options.timeZone}`;
    const cached = responseCache.get(cacheKey);
    if (cached !== undefined && options.ttlMs > 0 && Date.now() - cached.at < options.ttlMs) return cached.payload;
    const scan = await scanSessions(Date.now());
    const payload = buildOverview(scan.aggregates, {
      windowKey,
      now: Date.now(),
      pricing,
      usdRate: options.usdRate,
      timeZone: options.timeZone,
      sessionsScanned: scan.aggregates.length,
      sessionsTotal: scan.listed,
      readCount: scan.readCount,
      cachedCount: scan.cachedCount,
    });
    responseCache.set(cacheKey, { at: Date.now(), payload });
    return payload;
  };

  /**
   * Cached heavy payload for one window. Its cache is independent from the
   * overview cache (different keys, same TTL) so the two requests can load in
   * parallel without invalidating each other; it reuses `scanSessions`, so a
   * heavy request never triggers a second full read.
   */
  const buildHeavyPayload = async (requestedWindow) => {
    const windowKey = WINDOWS[requestedWindow] !== undefined ? requestedWindow : options.window;
    const cacheKey = `${windowKey}@${options.timeZone}`;
    const cached = heavyCache.get(cacheKey);
    if (cached !== undefined && options.ttlMs > 0 && Date.now() - cached.at < options.ttlMs) return cached.payload;
    const scan = await scanSessions(Date.now());
    const payload = buildHeavy(scan.aggregates, { now: Date.now(), windowKey, timeZone: options.timeZone });
    heavyCache.set(cacheKey, { at: Date.now(), payload });
    return payload;
  };

  /** `GET /session-stats/api/overview` handler. */
  const handleOverview = async (req, res) => {
    if (!guard(req, res, "GET", options)) return;
    let requestedWindow = "";
    try {
      const url = new URL(String(req?.url ?? "/"), "http://127.0.0.1");
      requestedWindow = url.searchParams.get("window") ?? "";
    } catch {
      requestedWindow = "";
    }
    try {
      const payload = await buildOverviewPayload(requestedWindow);
      sendJson(res, 200, payload);
    } catch (error) {
      logger.error(`[session-stats] overview failed: ${describeError(error)}`);
      sendJson(res, 500, { ok: false, error: "overview_failed", message: describeError(error) });
    }
  };

  /** `GET /session-stats/api/heavy` handler: leaderboards, session list, heatmap. */
  const handleHeavy = async (req, res) => {
    if (!guard(req, res, "GET", options)) return;
    let requestedWindow = "";
    try {
      const url = new URL(String(req?.url ?? "/"), "http://127.0.0.1");
      requestedWindow = url.searchParams.get("window") ?? "";
    } catch {
      requestedWindow = "";
    }
    try {
      const payload = await buildHeavyPayload(requestedWindow);
      sendJson(res, 200, payload);
    } catch (error) {
      logger.error(`[session-stats] heavy failed: ${describeError(error)}`);
      sendJson(res, 500, { ok: false, error: "heavy_failed", message: describeError(error) });
    }
  };

  /** `GET /session-stats/api/live` handler: synchronous, no I/O. */
  const handleLive = (req, res) => {
    if (!guard(req, res, "GET", options)) return;
    try {
      sendJson(res, 200, live.snapshot());
    } catch (error) {
      logger.error(`[session-stats] live failed: ${describeError(error)}`);
      sendJson(res, 500, { ok: false, error: "live_failed", message: describeError(error) });
    }
  };

  disposers.push(ctx.webServer.register({ kind: "exact", path: OVERVIEW_PATH, handler: handleOverview }));
  disposers.push(ctx.webServer.register({ kind: "exact", path: HEAVY_PATH, handler: handleHeavy }));
  disposers.push(ctx.webServer.register({ kind: "exact", path: LIVE_PATH, handler: handleLive }));
  // PERF-03: warm the scan two seconds after mount so the first panel open hits
  // a warm cache. A failure is invisible: every route re-scans on demand. The
  // timer is unref'd so it never keeps the host (or a test process) alive.
  const warmupTimer = setTimeout(() => {
    scanSessions(Date.now()).catch((error) => {
      logger.debug(`[session-stats] warmup scan failed: ${describeError(error)}`);
    });
  }, WARMUP_DELAY_MS);
  if (typeof warmupTimer.unref === "function") warmupTimer.unref();
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      clearTimeout(warmupTimer);
      live.dispose();
      for (const dispose of disposers) {
        try {
          if (typeof dispose === "function") dispose();
        } catch {
          /* disposal is best effort */
        }
      }
    }, "session-stats: routes and sampler");
  }
  logger.info(`[session-stats] routes ready: ${OVERVIEW_PATH}, ${HEAVY_PATH}, ${LIVE_PATH}`);
}

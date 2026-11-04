#!/usr/bin/env node
/**
 * Host-half smoke test with a fake cordis context.
 *
 * Boots `apply()` against a hand-written context (no port is ever listened
 * on), then calls both registered route handlers directly and asserts the
 * JSON shape, the loopback fence, the method allow-list, incremental session
 * caching, and the /live latency budget.
 *
 * Run: node tools/selfcheck-host.mjs
 */

import assert from "node:assert/strict";

import { apply, isLoopbackRequest, normalizeConfig, OVERVIEW_PATH, LIVE_PATH } from "../lib/index.js";

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

const M = 1_000_000;
const HOUR = 3_600_000;
const NOW = Date.now();

/** Build one `assistant/message` event with disjoint token usage. */
function messageEvent({ seq, time, provider, model, input, output, cacheRead = 0, cacheWrite = 0 }) {
  return {
    type: "assistant/message",
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: { role: "assistant", source: { kind: "model", provider, model }, content: [] },
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
// Fake corpus: two sessions, one revision each
// ---------------------------------------------------------------------------
const sessionA = {
  id: "session-a",
  createdAt: NOW - 48 * HOUR,
  events: [
    messageEvent({ seq: 1, time: NOW - 3 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 1 * M, cacheRead: 10 * M }),
    messageEvent({ seq: 2, time: NOW - 2 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 2 * M, output: 1 * M, cacheRead: 5 * M }),
    messageEvent({ seq: 3, time: NOW - 1 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 1 * M, output: 1 * M, cacheRead: 1 * M }),
    { type: "user/message", seq: 4, time: NOW, data: { turn: 1, message: { role: "user", content: [] } } },
    { type: "web/deepseek-search-llm-request", seq: 5, time: NOW - 90 * 60_000, data: {} },
    { type: "web/deepseek-search-llm-request", seq: 6, time: NOW - 60 * 60_000, data: {} },
  ],
};
const sessionB = {
  id: "session-b",
  createdAt: NOW - 30 * HOUR,
  events: [
    messageEvent({ seq: 1, time: NOW - 4 * HOUR, provider: "anthropic", model: "claude-opus-4.1", input: 1 * M, output: 0.5 * M }),
    messageEvent({ seq: 2, time: NOW - 3.5 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 2 * M, output: 2 * M, cacheRead: 2 * M }),
    { type: "web/deepseek-search-llm-request", seq: 3, time: NOW - 30 * 60_000, data: {} },
  ],
};
const sessions = new Map([
  ["session-a", sessionA],
  ["session-b", sessionB],
]);
const revisions = new Map([
  ["session-a", "rev-1"],
  ["session-b", "rev-1"],
]);
let readSessionCalls = 0;

const routes = [];
const disposers = [];
const fakePersistence = {
  async list() {
    return [...sessions.keys()].map((id) => ({
      header: { id, createdAt: sessions.get(id).createdAt },
      revision: revisions.get(id),
      eventCount: sessions.get(id).events.length,
      sizeBytes: 1024,
    }));
  },
};

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
      return [...sessions.values()].map((session) => ({
        header: { id: session.id, createdAt: session.createdAt, isSeeded: false },
        live: false,
        persisted: true,
      }));
    },
    async readSession(id) {
      readSessionCalls += 1;
      const session = sessions.get(id);
      if (session === undefined) throw new Error(`unknown session ${id}`);
      return { session: { id: session.id, createdAt: session.createdAt }, inheritedEventCount: 0, events: session.events };
    },
  },
  logger: console,
  effect(callback) {
    const disposer = callback();
    if (typeof disposer === "function") disposers.push(disposer);
    return disposer;
  },
  on() {
    return () => {};
  },
  get(name) {
    return name === "sessionPersistence" ? fakePersistence : undefined;
  },
};

/** Minimal `ServerResponse` stand-in capturing status, headers, and body. */
function createResponse() {
  return {
    statusCode: 200,
    headers: Object.create(null),
    body: "",
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk);
      this.ended = true;
    },
  };
}

/** Invoke one registered route handler with a synthetic request. */
async function callRoute(route, { method = "GET", url, host = "127.0.0.1:2820" } = {}) {
  const res = createResponse();
  await route.handler({ method, url, headers: { host } }, res);
  return res;
}

/** Parse a captured JSON response. */
function bodyOf(res) {
  assert.equal(res.ended, true, "handler must end the response");
  assert.ok(res.body.length > 0, "response body must not be empty");
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let bootError = null;
try {
  apply(ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
} catch (error) {
  bootError = error;
}

check("apply() boots without throwing", () => assert.equal(bootError, null), bootError === null ? "ok" : String(bootError));
check(
  "registers exactly two exact routes",
  () => {
    assert.equal(routes.length, 2);
    for (const route of routes) assert.equal(route.kind, "exact");
    const paths = routes.map((route) => route.path).sort();
    assert.deepEqual(paths, [LIVE_PATH, OVERVIEW_PATH].sort());
  },
  routes.map((route) => `${route.kind} ${route.path}`).join(" | "),
);
check("config normalization keeps explicit values", () => {
  const config = normalizeConfig({ usdRate: 7.1, liveIntervalMs: 1000 });
  assert.equal(config.usdRate, 7.1);
  assert.equal(config.liveIntervalMs, 1000);
});

const overviewRoute = routes.find((route) => route.path === OVERVIEW_PATH);
const liveRoute = routes.find((route) => route.path === LIVE_PATH);

// ---------------------------------------------------------------------------
// Overview handler
// ---------------------------------------------------------------------------
const overviewResponse = await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` });
const overview = bodyOf(overviewResponse);

check(
  "overview: HTTP 200, JSON, no-store",
  () => {
    assert.equal(overviewResponse.statusCode, 200);
    assert.equal(overviewResponse.getHeader("content-type"), "application/json; charset=utf-8");
    assert.equal(overviewResponse.getHeader("cache-control"), "no-store");
    assert.equal(overviewResponse.getHeader("x-content-type-options"), "nosniff");
  },
  "200 / application/json / no-store",
);

check(
  "overview: top-level payload structure",
  () => {
    assert.equal(overview.ok, true);
    assert.equal(typeof overview.generatedAt, "number");
    assert.equal(typeof overview.window, "object");
    assert.equal(overview.window.key, "7d");
    assert.equal(overview.window.granularity, "day");
    assert.equal(overview.window.bucketCount, 7);
    assert.equal(overview.daily.length, 7);
    assert.deepEqual(overview.window.points, overview.daily.map((day) => day.label));
    assert.equal(typeof overview.currency, "object");
    assert.equal(overview.currency.code, "CNY");
    assert.equal(overview.currency.usdRate, 7.1);
    assert.equal(typeof overview.pricing, "object");
    assert.equal(typeof overview.pricing.mode, "string");
    assert.equal(typeof overview.scan, "object");
  },
  `window=${overview.window.key}/${overview.window.granularity}/${overview.window.bucketCount}`,
);

check(
  "overview: totals structure and values",
  () => {
    const totals = overview.totals;
    for (const key of [
      "tokens",
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "costCNY",
      "costUSD",
      "cacheHitRate",
      "sessions",
      "avgTokensPerSession",
      "pricedTokens",
      "unpricedTokens",
      "priced",
      "unpricedModels",
      "searches",
      "searchCostCNY",
      "costCNYTotal",
      "costCNYWithSearch",
      "events",
    ]) {
      assert.ok(key in totals, `totals.${key} is missing`);
    }
    assert.equal(totals.sessions, 2);
    assert.equal(totals.tokens, 30.5 * M);
    assert.equal(totals.input, 7 * M);
    assert.equal(totals.output, 5.5 * M);
    assert.equal(totals.cacheRead, 18 * M);
    assert.equal(totals.cacheWrite, 0);
    assert.equal(totals.priced, false, "one model has no verified vendor price list");
    assert.equal(totals.unpricedTokens, 1.5 * M);
    assert.equal(totals.unpricedModels, 1);
    assert.equal(totals.searches, 3);
    assert.equal(totals.searchCostCNY, 0.015);
    assert.equal(totals.costCNYTotal, totals.costCNY + 0.015);
    assert.equal(totals.costCNYWithSearch, totals.costCNYTotal);
    assert.ok(totals.costCNY > 0);
    assert.ok(totals.cacheHitRate > 0 && totals.cacheHitRate < 1);
  },
  `tokens=${overview.totals.tokens} cost=¥${overview.totals.costCNY} hit=${(overview.totals.cacheHitRate * 100).toFixed(1)}% sessions=${overview.totals.sessions}`,
);

check(
  "overview: daily / models / composition arrays",
  () => {
    for (const day of overview.daily) {
      for (const key of ["key", "label", "start", "end", "input", "output", "cacheRead", "cacheWrite", "tokens", "costCNY", "costUSD", "events", "models"]) {
        assert.ok(key in day, `daily.${key} is missing`);
      }
      assert.equal(
        day.models.reduce((sum, model) => sum + model.tokens, 0),
        day.tokens,
        `${day.label} model segments must sum to the day total`,
      );
      for (const model of day.models) {
        for (const key of ["route", "label", "color", "tokens", "costCNY", "share", "vendor", "priceLevel"]) {
          assert.ok(key in model, `daily.models.${key} is missing`);
        }
      }
    }
    assert.equal(overview.daily.reduce((sum, day) => sum + day.tokens, 0), overview.totals.tokens);
    assert.ok(Array.isArray(overview.models) && overview.models.length >= 3);
    for (const model of overview.models) {
      for (const key of ["provider", "model", "route", "label", "color", "tokens", "costCNY", "costUSD", "share", "events", "priced", "priceKey", "vendor", "priceLevel", "sourceUrl"]) {
        assert.ok(key in model, `models.${key} is missing`);
      }
      if (model.costsOnly === true) continue;
      assert.ok(overview.modelPalette.includes(model.color), `${model.route} color must come from modelPalette`);
      assert.ok(!model.label.includes("/"), "model label is the model name");
    }
    assert.equal(overview.modelPalette.length, 10);
    const tokenModels = overview.models.filter((model) => model.costsOnly !== true);
    assert.equal(new Set(tokenModels.map((model) => model.color)).size, tokenModels.length);
    const searchRow = overview.models.find((model) => model.route === "official/server-tool-search");
    assert.ok(searchRow !== undefined, "synthetic search row must exist");
    assert.equal(searchRow.tokens, 0);
    assert.equal(searchRow.costsOnly, true);
    assert.equal(searchRow.searches, 3);
    assert.equal(searchRow.costCNY, 0.015);
    assert.equal(tokenModels.length, 3);
    assert.equal(overview.daily.reduce((sum, day) => sum + day.searches, 0), 3);
    assert.equal(overview.daily.reduce((sum, day) => sum + day.searchCostCNY, 0), 0.015);
    const flash = overview.models.find((model) => model.route === "opencode-go/deepseek-v4.1-flash");
    assert.equal(flash.priced, true);
    assert.ok(flash.costCNY > 0);
    const unpriced = overview.models.find((model) => model.route === "anthropic/claude-opus-4.1");
    assert.equal(unpriced.priced, false);
    assert.equal(unpriced.priceLevel, "unpriced");
    assert.equal(unpriced.vendor, "anthropic");
    assert.equal(unpriced.sourceUrl, null);
    assert.equal(unpriced.costCNY, 0);
    assert.deepEqual(overview.pricing.priceLevels, { official: 2, unpriced: 1 });
    const costSlices = overview.costComposition;
    assert.ok(Array.isArray(costSlices) && costSlices.length >= 2);
    const costSum = costSlices.reduce((sum, slice) => sum + slice.costCNY, 0);
    assert.ok(Math.abs(costSum - overview.totals.costCNYTotal) < 1e-9, "cost slices sum to costCNYTotal");
    assert.ok(Math.abs(costSlices.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-4, "shares sum to 1");
    const costSearch = costSlices.find((slice) => slice.route === "official/server-tool-search");
    assert.ok(costSearch !== undefined, "search cost slice present");
    assert.equal(costSearch.color, overview.otherModelColor);
    for (const slice of costSlices) {
      const model = overview.models.find((entry) => entry.route === slice.route);
      assert.ok(model !== undefined);
      assert.equal(slice.color, model.color);
      assert.equal(slice.label, model.label);
    }
    const terminal = overview.terminal;
    assert.ok(terminal !== null && typeof terminal === "object");
    assert.equal(terminal.indices.length, 5);
    assert.ok(terminal.candles.bars.length > 0);
    assert.ok(terminal.tape.length <= 20);
    for (let index = 1; index < terminal.tape.length; index += 1) {
      assert.ok(terminal.tape[index - 1].t >= terminal.tape[index].t);
    }
    for (const symbol of terminal.symbols) {
      const model = overview.models.find((entry) => entry.route === symbol.route);
      assert.ok(model !== undefined);
      assert.equal(symbol.tokens, model.tokens);
      assert.equal(symbol.costCNY, model.costCNY);
    }
    assert.ok(Array.isArray(overview.composition) && overview.composition.length >= 3);
    assert.equal(overview.composition.reduce((sum, part) => sum + part.tokens, 0), overview.totals.tokens);
  },
  `daily=${overview.daily.length} models=${overview.models.length} composition=${overview.composition.length}`,
);

check(
  "overview: first scan read both sessions",
  () => {
    assert.equal(overview.scan.sessionsTotal, 2);
    assert.equal(overview.scan.readCount, 2);
    assert.equal(overview.scan.cachedCount, 0);
    assert.equal(readSessionCalls, 2);
  },
  `read=${overview.scan.readCount} cached=${overview.scan.cachedCount}`,
);

// ---------------------------------------------------------------------------
// Incremental cache: unchanged revisions are not re-read
// ---------------------------------------------------------------------------
const secondResponse = await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` });
const second = bodyOf(secondResponse);
check(
  "overview: unchanged revisions are served from cache",
  () => {
    assert.equal(readSessionCalls, 2, "no extra readSession call expected");
    assert.equal(second.scan.readCount, 0);
    assert.equal(second.scan.cachedCount, 2);
    assert.equal(second.totals.tokens, 30.5 * M);
  },
  `read=${second.scan.readCount} cached=${second.scan.cachedCount}`,
);

// Append one event to session A and bump only its revision.
sessionA.events.push(
  messageEvent({ seq: 5, time: NOW - 0.5 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 1 * M, output: 0 }),
);
revisions.set("session-a", "rev-2");
const thirdResponse = await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` });
const third = bodyOf(thirdResponse);
check(
  "overview: only the changed session is re-read",
  () => {
    assert.equal(readSessionCalls, 3, "exactly one extra readSession call expected");
    assert.equal(third.scan.readCount, 1);
    assert.equal(third.scan.cachedCount, 1);
    assert.equal(third.totals.tokens, 31.5 * M);
  },
  `read=${third.scan.readCount} cached=${third.scan.cachedCount} tokens=${third.totals.tokens}`,
);

// ---------------------------------------------------------------------------
// Fence, method allow-list, window fallback
// ---------------------------------------------------------------------------
const forbidden = await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d`, host: "evil.example:2820" });
check(
  "overview: non-loopback Host is rejected with 403",
  () => {
    assert.equal(forbidden.statusCode, 403);
    assert.equal(bodyOf(forbidden).error, "forbidden");
    assert.equal(forbidden.getHeader("cache-control"), "no-store");
  },
  "403 forbidden",
);

const wrongMethod = await callRoute(overviewRoute, { url: OVERVIEW_PATH, method: "POST" });
check(
  "overview: non-GET is rejected with 405",
  () => {
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.getHeader("allow"), "GET");
    assert.equal(bodyOf(wrongMethod).error, "method_not_allowed");
  },
  "405 allow=GET",
);

const fallbackResponse = await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=bogus` });
check(
  "overview: unknown window falls back to the configured default",
  () => {
    assert.equal(fallbackResponse.statusCode, 200);
    assert.equal(bodyOf(fallbackResponse).window.key, "7d");
  },
  "fallback=7d",
);

// ---------------------------------------------------------------------------
// Live handler
// ---------------------------------------------------------------------------
const liveResponse = await callRoute(liveRoute, { url: LIVE_PATH });
const live = bodyOf(liveResponse);
check(
  "live: HTTP 200, JSON, no-store",
  () => {
    assert.equal(liveResponse.statusCode, 200);
    assert.equal(liveResponse.getHeader("content-type"), "application/json; charset=utf-8");
    assert.equal(liveResponse.getHeader("cache-control"), "no-store");
  },
  "200 / application/json / no-store",
);

check(
  "live: process snapshot structure",
  () => {
    assert.equal(live.ok, true);
    assert.equal(typeof live.sampledAt, "number");
    assert.equal(live.intervalMs, 1000);
    assert.equal(typeof live.cpu, "object");
    assert.equal(typeof live.cpu.single, "number");
    assert.equal(typeof live.cpu.machine, "number");
    assert.ok(Number.isInteger(live.cpu.cores) && live.cpu.cores >= 1);
    // Load average is a Unix-only metric and is meaningless (always 0) on
    // Windows, so the snapshot does not carry it at all.
    assert.equal("loadavg" in live.cpu, false, "loadavg must not be exposed");
    assert.equal("loadavgSupported" in live.cpu, false);
    assert.equal("loadavgPerCore" in live.cpu, false);
    assert.equal(typeof live.memory.rssMB, "number");
    assert.equal(typeof live.memory.heapUsedMB, "number");
    assert.equal(typeof live.eventLoop.p99ms, "number");
    assert.equal(typeof live.eventLoop.meanMs, "number");
    assert.equal(typeof live.uptimeSec, "number");
    assert.equal(typeof live.uptimeText, "string");
    assert.equal(live.pid, process.pid);
    assert.equal(live.node, process.version);
    assert.ok(Array.isArray(live.history.values));
    assert.ok(live.history.values.length <= live.points);
    assert.equal(typeof live.history.peak, "number");
    assert.equal(live.history.windowSec, Math.round((live.points * live.intervalMs) / 1000));
  },
  `cores=${live.cpu.cores} rss=${live.memory.rssMB}MB p99=${live.eventLoop.p99ms}ms uptime=${live.uptimeText} points=${live.points}`,
);

const liveStarted = process.hrtime.bigint();
const timedLive = await callRoute(liveRoute, { url: LIVE_PATH });
const liveElapsedMs = Number(process.hrtime.bigint() - liveStarted) / 1e6;
check(
  "live: answers within the 50 ms budget",
  () => {
    assert.equal(timedLive.statusCode, 200);
    assert.ok(liveElapsedMs < 50, `took ${liveElapsedMs.toFixed(2)} ms`);
  },
  `${liveElapsedMs.toFixed(2)} ms`,
);

const liveForbidden = await callRoute(liveRoute, { url: LIVE_PATH, host: "192.168.1.9:2820" });
check(
  "live: non-loopback Host is rejected with 403",
  () => {
    assert.equal(liveForbidden.statusCode, 403);
    assert.equal(bodyOf(liveForbidden).error, "forbidden");
  },
  "403 forbidden",
);

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
check(
  "disposal runs without throwing",
  () => {
    assert.ok(disposers.length >= 1, "apply must register an effect disposer");
    for (const disposer of disposers) disposer();
    assert.equal(routes.length, 0);
  },
  `disposers=${disposers.length}`,
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log("");
// ---------------------------------------------------------------------------
// Host fence across machine setups (LAN / reverse proxy / public host)
// ---------------------------------------------------------------------------
check("host fence: LAN peer stays blocked by default, opens with allowPrivateHosts", () => {
  const lan = { headers: { host: "192.168.1.20:2820" } };
  assert.equal(isLoopbackRequest(lan, normalizeConfig({ allowedHosts: [], allowPrivateHosts: false })), false);
  assert.equal(isLoopbackRequest(lan, normalizeConfig({ allowedHosts: [], allowPrivateHosts: true })), true);
});

check("host fence: public hostname is still rejected even with allowPrivateHosts", () => {
  const evil = { headers: { host: "evil.example.com:2820" } };
  assert.equal(isLoopbackRequest(evil, normalizeConfig({ allowedHosts: [], allowPrivateHosts: true })), false);
  assert.equal(isLoopbackRequest(evil, normalizeConfig({ allowedHosts: ["evil.example.com"], allowPrivateHosts: true })), true);
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
  console.error(`selfcheck-host: ${failures} failure(s) out of ${results.length} checks`);
  process.exit(1);
}
console.log(`selfcheck-host: all ${results.length} checks passed`);

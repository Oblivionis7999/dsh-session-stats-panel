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

import { apply, isLoopbackRequest, normalizeConfig, HEAVY_PATH, OVERVIEW_PATH, LIVE_PATH, WARMUP_DELAY_MS } from "../lib/index.js";

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
  cwd: "E:/work/a",
  origin: "top-level",
  events: [
    messageEvent({ seq: 1, time: NOW - 3 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 1 * M, cacheRead: 10 * M }),
    messageEvent({ seq: 2, time: NOW - 2 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 2 * M, output: 1 * M, cacheRead: 5 * M }),
    messageEvent({ seq: 3, time: NOW - 1 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 1 * M, output: 1 * M, cacheRead: 1 * M }),
    { type: "user/message", seq: 4, time: NOW, data: { turn: 1, message: { role: "user", content: [] } } },
    { type: "web/deepseek-search-llm-request", seq: 5, time: NOW - 90 * 60_000, data: {} },
    { type: "web/deepseek-search-llm-request", seq: 6, time: NOW - 60 * 60_000, data: {} },
    // Heavy-layer metadata: title, prompt, turns/steps, shell program, skill.
    { type: "session/title", seq: 7, time: NOW - 4 * HOUR, data: { title: "聚合会话 A" } },
    { type: "user/message", seq: 8, time: NOW - 3.5 * HOUR, data: { source: { kind: "user" }, content: [{ type: "text", text: "A 的问题" }] } },
    { type: "turn/start", seq: 9, time: NOW - 3.5 * HOUR, data: { turn: 1 } },
    { type: "step/start", seq: 10, time: NOW - 3.5 * HOUR, data: {} },
    { type: "tool/call", seq: 11, time: NOW - 2.5 * HOUR, data: { name: "win_bash", arguments: JSON.stringify({ command: 'cd "E:/x" && python a.py' }), callId: "call-a-1" } },
    { type: "tool/call", seq: 12, time: NOW - 2.4 * HOUR, data: { name: "skill", arguments: JSON.stringify({ name: "grilling" }) } },
    { type: "tool/call", seq: 13, time: NOW - 2.3 * HOUR, data: { name: "read", arguments: "{}", callId: "call-a-2" } },
    { type: "tool/result", seq: 14, time: NOW - 2.5 * HOUR + 120_000, data: { message: { toolCallId: "call-a-1" } } },
    { type: "tool/result", seq: 15, time: NOW - 2.3 * HOUR + 50_000, data: { message: { toolCallId: "call-a-2", isError: true } } },
  ],
};
const sessionB = {
  id: "session-b",
  createdAt: NOW - 30 * HOUR,
  cwd: "E:/work/b",
  origin: "subagent",
  events: [
    messageEvent({ seq: 1, time: NOW - 4 * HOUR, provider: "anthropic", model: "claude-opus-4.1", input: 1 * M, output: 0.5 * M }),
    messageEvent({ seq: 2, time: NOW - 3.5 * HOUR, provider: "deepseek", model: "deepseek-v4-pro", input: 2 * M, output: 2 * M, cacheRead: 2 * M }),
    { type: "web/deepseek-search-llm-request", seq: 3, time: NOW - 30 * 60_000, data: {} },
  ],
};
/**
 * Build one fake corpus (sessions + revision map) from session definitions.
 * `inheritedEventCount` / `cwd` / `origin` are optional per session.
 * @param {object[]} defs - session definitions.
 * @returns {{sessions: Map<string, object>, revisions: Map<string, string>}} corpus.
 */
function createCorpus(defs) {
  const sessions = new Map();
  const revisions = new Map();
  for (const def of defs) {
    sessions.set(def.id, def);
    revisions.set(def.id, def.revision ?? "rev-1");
  }
  return { sessions, revisions };
}

const defaultCorpus = createCorpus([
  { ...sessionA, revision: "rev-1" },
  { ...sessionB, revision: "rev-1" },
]);

/**
 * Create one fake cordis context over a corpus plus its observable counters.
 * @param {{sessions: Map<string, object>, revisions: Map<string, string>}} [corpus] - corpus to serve.
 * @returns {{ctx: object, routes: object[], disposers: Function[], counters: {readSessionCalls: number, listSessionsCalls: number}}} boot fixtures.
 */
function createFakeContext(corpus = defaultCorpus) {
  const routes = [];
  const disposers = [];
  const counters = { readSessionCalls: 0, listSessionsCalls: 0 };
  const persistence = {
    async list() {
      return [...corpus.sessions.keys()].map((id) => ({
        header: { id, createdAt: corpus.sessions.get(id).createdAt },
        revision: corpus.revisions.get(id),
        eventCount: corpus.sessions.get(id).events.length,
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
        counters.listSessionsCalls += 1;
        return [...corpus.sessions.values()].map((session) => ({
          header: {
            id: session.id,
            createdAt: session.createdAt,
            cwd: session.cwd ?? "",
            origin: session.origin ?? "top-level",
            isSeeded: session.isSeeded === true,
          },
          live: false,
          persisted: true,
        }));
      },
      async readSession(id) {
        counters.readSessionCalls += 1;
        const session = corpus.sessions.get(id);
        if (session === undefined) throw new Error(`unknown session ${id}`);
        return {
          session: { id: session.id, createdAt: session.createdAt, cwd: session.cwd ?? "", origin: session.origin ?? "top-level" },
          inheritedEventCount: session.inheritedEventCount ?? 0,
          events: session.events,
        };
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
      return name === "sessionPersistence" ? persistence : undefined;
    },
  };
  return { ctx, routes, disposers, counters };
}

const main = createFakeContext();
const routes = main.routes;
const disposers = main.disposers;

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
  apply(main.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
} catch (error) {
  bootError = error;
}

check("apply() boots without throwing", () => assert.equal(bootError, null), bootError === null ? "ok" : String(bootError));
check(
  "registers exactly three exact routes",
  () => {
    assert.equal(routes.length, 3);
    for (const route of routes) assert.equal(route.kind, "exact");
    const paths = routes.map((route) => route.path).sort();
    assert.deepEqual(paths, [HEAVY_PATH, LIVE_PATH, OVERVIEW_PATH].sort());
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
    // P0-A: the K-line data layer is gone; the route must not carry it.
    assert.equal(Object.hasOwn(overview, "terminal"), false, "overview.terminal must be removed");
    assert.equal(overview.terminal, undefined);
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
    assert.equal(main.counters.readSessionCalls, 2);
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
    assert.equal(main.counters.readSessionCalls, 2, "no extra readSession call expected");
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
defaultCorpus.revisions.set("session-a", "rev-2");
const thirdResponse = await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` });
const third = bodyOf(thirdResponse);
check(
  "overview: only the changed session is re-read",
  () => {
    assert.equal(main.counters.readSessionCalls, 3, "exactly one extra readSession call expected");
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
// Heavy handler: chunked leaderboards / session list / heatmap
// ---------------------------------------------------------------------------
const heavyRoute = routes.find((route) => route.path === HEAVY_PATH);
const heavyStarted = process.hrtime.bigint();
const heavyResponse = await callRoute(heavyRoute, { url: `${HEAVY_PATH}?window=7d` });
const heavyElapsedMs = Number(process.hrtime.bigint() - heavyStarted) / 1e6;
const heavy = bodyOf(heavyResponse);

check(
  "heavy: HTTP 200, JSON, no-store",
  () => {
    assert.equal(heavyResponse.statusCode, 200);
    assert.equal(heavyResponse.getHeader("content-type"), "application/json; charset=utf-8");
    assert.equal(heavyResponse.getHeader("cache-control"), "no-store");
    assert.equal(heavyResponse.getHeader("x-content-type-options"), "nosniff");
  },
  "200 / application/json / no-store",
);

check(
  "heavy: frozen payload shape and leaderboard rows",
  () => {
    assert.deepEqual(Object.keys(heavy).sort(), [
      "commandLeaderboard",
      "generatedAt",
      "heatmap",
      "ok",
      "sessions",
      "skillLeaderboard",
      "toolLeaderboard",
    ]);
    assert.equal(heavy.ok, true);
    assert.equal(typeof heavy.generatedAt, "number");
    assert.equal(heavy.heatmap.length, 56);
    for (const key of ["toolLeaderboard", "commandLeaderboard", "skillLeaderboard", "sessions"]) {
      assert.ok(Array.isArray(heavy[key]), `${key} must be an array`);
    }
    for (const row of heavy.toolLeaderboard) assert.deepEqual(Object.keys(row).sort(), ["avgMs", "count", "errorCount", "lastCalledAt", "name", "successRate"]);
    for (const row of heavy.commandLeaderboard) assert.deepEqual(Object.keys(row).sort(), ["count", "lastCalledAt", "program"]);
    assert.deepEqual(heavy.toolLeaderboard.map((row) => [row.name, row.count]), [["read", 1], ["skill", 1], ["win_bash", 1]]);
    // IDEA-05: paired results drive success rate / average duration.
    const toolRows = new Map(heavy.toolLeaderboard.map((row) => [row.name, row]));
    assert.equal(toolRows.get("win_bash").errorCount, 0);
    assert.equal(toolRows.get("win_bash").successRate, 1);
    assert.equal(toolRows.get("win_bash").avgMs, 120_000);
    assert.equal(toolRows.get("read").errorCount, 1);
    assert.equal(toolRows.get("read").successRate, 0);
    assert.equal(toolRows.get("read").avgMs, 50_000);
    assert.equal(toolRows.get("skill").successRate, null, "no paired result means unknown");
    assert.equal(toolRows.get("skill").avgMs, null);
    assert.deepEqual(heavy.commandLeaderboard.map((row) => [row.program, row.count]), [["python", 1]]);
    assert.deepEqual(heavy.skillLeaderboard.map((row) => [row.name, row.count]), [["grilling", 1]]);
    assert.ok(heavyElapsedMs < 500, `heavy took ${heavyElapsedMs.toFixed(2)} ms`);
  },
  `heatmap=${heavy.heatmap.length} tools=${heavy.toolLeaderboard.length} commands=${heavy.commandLeaderboard.length} sessions=${heavy.sessions.length}`,
);

check(
  "heavy: sessions carry the frozen fields",
  () => {
    assert.equal(heavy.sessions.length, 2);
    const byId = new Map(heavy.sessions.map((row) => [row.id, row]));
    const a = byId.get("session-a");
    const b = byId.get("session-b");
    assert.deepEqual(Object.keys(a).sort(), [
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
    assert.equal(a.title, "聚合会话 A");
    assert.equal(a.lastPrompt, "A 的问题");
    assert.equal(a.turns, 1);
    assert.equal(a.steps, 1);
    assert.equal(a.workspace, "E:/work/a");
    assert.equal(a.isSubagent, false);
    assert.equal(a.isArchived, false);
    assert.equal(a.tokens, 24 * M);
    assert.equal(b.isSubagent, true);
    assert.equal(b.title, "", "untitled sessions return an empty string; the client owns i18n");
    assert.equal(b.workspace, "E:/work/b");
    // Newest activity first (the earlier step appended one more message to A).
    assert.ok(heavy.sessions[0].lastActiveAt >= heavy.sessions[1].lastActiveAt, "sessions are lastActiveAt-desc");
  },
  heavy.sessions.map((row) => `${row.id}:${row.turns}/${row.tokens}`).join(" "),
);

check(
  "heavy: heatmap is dense 56 days and sums to the overview totals",
  () => {
    assert.equal(heavy.heatmap.length, 56);
    for (const day of heavy.heatmap) assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(heavy.heatmap.some((day) => day.sessions > 0), "some day must carry activity");
    assert.ok(heavy.heatmap.every((day) => day.sessions <= 2), "sessions are counted once per session");
    assert.equal(heavy.heatmap.reduce((sum, day) => sum + day.tokens, 0), 31.5 * M);
    assert.equal(heavy.heatmap.reduce((sum, day) => sum + day.turns, 0), 1);
  },
  `days=${heavy.heatmap.length} totalTokens=${heavy.heatmap.reduce((sum, day) => sum + day.tokens, 0)}`,
);

const heavy24 = bodyOf(await callRoute(heavyRoute, { url: `${HEAVY_PATH}?window=24h` }));
const heavyBogus = bodyOf(await callRoute(heavyRoute, { url: `${HEAVY_PATH}?window=bogus` }));
check(
  "heavy: window parameter is validated, heatmap is window-independent",
  () => {
    assert.equal(heavy24.ok, true);
    assert.equal(heavy24.heatmap.length, 56);
    // The shell call is 2.5 h old, so it must survive the 24h window.
    assert.ok(heavy24.toolLeaderboard.some((row) => row.name === "win_bash"));
    assert.equal(heavyBogus.ok, true);
    assert.equal(heavyBogus.heatmap.length, 56);
  },
  "24h + bogus fallback",
);

const heavyForbidden = await callRoute(heavyRoute, { url: `${HEAVY_PATH}?window=7d`, host: "evil.example:2820" });
check(
  "heavy: non-loopback Host is rejected with 403",
  () => {
    assert.equal(heavyForbidden.statusCode, 403);
    assert.equal(bodyOf(heavyForbidden).error, "forbidden");
    assert.equal(heavyForbidden.getHeader("cache-control"), "no-store");
  },
  "403 forbidden",
);

const heavyWrongMethod = await callRoute(heavyRoute, { url: HEAVY_PATH, method: "POST" });
check(
  "heavy: non-GET is rejected with 405",
  () => {
    assert.equal(heavyWrongMethod.statusCode, 405);
    assert.equal(heavyWrongMethod.getHeader("allow"), "GET");
    assert.equal(bodyOf(heavyWrongMethod).error, "method_not_allowed");
  },
  "405 allow=GET",
);

const overviewAfterHeavyStarted = process.hrtime.bigint();
const overviewAfterHeavy = bodyOf(await callRoute(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` }));
const overviewAfterHeavyMs = Number(process.hrtime.bigint() - overviewAfterHeavyStarted) / 1e6;
check(
  "overview: unchanged by the heavy route (fields, values, budget)",
  () => {
    assert.deepEqual(Object.keys(overviewAfterHeavy).sort(), Object.keys(third).sort());
    assert.equal(JSON.stringify(overviewAfterHeavy.totals), JSON.stringify(third.totals));
    for (const key of ["heatmap", "toolLeaderboard", "commandLeaderboard", "skillLeaderboard", "sessions", "terminal"]) {
      assert.equal(Object.hasOwn(overviewAfterHeavy, key), false, `overview must not carry ${key}`);
    }
    assert.ok(overviewAfterHeavyMs < 200, `overview took ${overviewAfterHeavyMs.toFixed(2)} ms`);
  },
  `${overviewAfterHeavyMs.toFixed(2)} ms · ${Object.keys(overviewAfterHeavy).length} keys`,
);

// ---------------------------------------------------------------------------
// Heavy TTL cache: a repeat request must not trigger another scan
// ---------------------------------------------------------------------------
const cacheBoot = createFakeContext();
apply(cacheBoot.ctx, { ttlMs: 60_000, usdRate: 7.1, liveIntervalMs: 1000 });
const cachedHeavyRoute = cacheBoot.routes.find((route) => route.path === HEAVY_PATH);
const firstHeavy = bodyOf(await callRoute(cachedHeavyRoute, { url: `${HEAVY_PATH}?window=7d` }));
const firstListCalls = cacheBoot.counters.listSessionsCalls;
const secondHeavy = bodyOf(await callRoute(cachedHeavyRoute, { url: `${HEAVY_PATH}?window=7d` }));
check(
  "heavy: TTL cache serves repeats without another scan",
  () => {
    assert.equal(firstListCalls, 1);
    assert.equal(cacheBoot.counters.listSessionsCalls, 1, "second heavy request must hit the TTL cache");
    assert.equal(secondHeavy.generatedAt, firstHeavy.generatedAt, "cached payload is returned as-is");
    assert.equal(cacheBoot.counters.readSessionCalls, 2);
  },
  `listCalls=${cacheBoot.counters.listSessionsCalls} read=${cacheBoot.counters.readSessionCalls}`,
);
const windowHeavy = bodyOf(await callRoute(cachedHeavyRoute, { url: `${HEAVY_PATH}?window=24h` }));
check(
  "heavy: cache key is per window",
  () => {
    assert.equal(cacheBoot.counters.listSessionsCalls, 2, "a new window must scan again");
    assert.equal(cacheBoot.counters.readSessionCalls, 2, "the revision cache avoids re-reading events");
    assert.ok(windowHeavy.generatedAt >= firstHeavy.generatedAt);
  },
  `listCalls=${cacheBoot.counters.listSessionsCalls}`,
);
for (const dispose of cacheBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// Heavy failure path
// ---------------------------------------------------------------------------
const failureBoot = createFakeContext();
failureBoot.ctx.sessionQuery.listSessions = async () => {
  throw new Error("corpus exploded");
};
apply(failureBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const failureResponse = await callRoute(failureBoot.routes.find((route) => route.path === HEAVY_PATH), { url: HEAVY_PATH });
check(
  "heavy: scan failure returns 500 heavy_failed",
  () => {
    assert.equal(failureResponse.statusCode, 500);
    const body = bodyOf(failureResponse);
    assert.equal(body.ok, false);
    assert.equal(body.error, "heavy_failed");
  },
  "500 heavy_failed",
);
for (const dispose of failureBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// Fork dedupe: `inheritedEventCount` prefixes must not be counted again
// ---------------------------------------------------------------------------
const forkCorpus = createCorpus([
  {
    id: "session-forked",
    createdAt: NOW - 10 * HOUR,
    cwd: "E:/work/fork",
    inheritedEventCount: 1,
    events: [
      // Inherited prefix copied verbatim from the parent session.
      messageEvent({ seq: 1, time: NOW - 9 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 99 * M, output: 0 }),
      // Own activity after the fork point.
      messageEvent({ seq: 2, time: NOW - 2 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 }),
    ],
  },
]);
const forkBoot = createFakeContext(forkCorpus);
apply(forkBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const forkOverview = bodyOf(await callRoute(forkBoot.routes.find((route) => route.path === OVERVIEW_PATH), { url: `${OVERVIEW_PATH}?window=7d` }));
check(
  "fork dedupe: inherited prefix is not billed",
  () => {
    assert.equal(forkOverview.totals.tokens, 1 * M, "only the post-fork tail counts");
    assert.equal(forkOverview.totals.events, 1);
  },
  `tokens=${forkOverview.totals.tokens} events=${forkOverview.totals.events}`,
);
for (const dispose of forkBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// Heavy day range: window.to is exclusive (no extra calendar day)
// ---------------------------------------------------------------------------
const boundaryNow = Date.UTC(2026, 10, 9, 4, 0, 0); // Beijing 2026-11-09 12:00
const boundaryBoot = createFakeContext(
  createCorpus([
    {
      id: "session-boundary",
      createdAt: boundaryNow - 24 * HOUR,
      events: [
        { type: "tool/call", seq: 1, time: boundaryNow - HOUR, data: { name: "today-tool", arguments: "{}" } },
        // Beijing 2026-11-10 01:00: inside the next calendar day, after window.to.
        { type: "tool/call", seq: 2, time: boundaryNow + 13 * HOUR, data: { name: "tomorrow-tool", arguments: "{}" } },
      ],
    },
  ]),
);
apply(boundaryBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const realDateNow = Date.now;
let boundaryHeavy;
try {
  Date.now = () => boundaryNow;
  boundaryHeavy = bodyOf(await callRoute(boundaryBoot.routes.find((route) => route.path === HEAVY_PATH), { url: `${HEAVY_PATH}?window=7d` }));
} finally {
  Date.now = realDateNow;
}
check(
  "heavy: day range stops at window.to (no extra calendar day)",
  () => {
    const names = boundaryHeavy.toolLeaderboard.map((row) => row.name);
    assert.ok(names.includes("today-tool"), "today's call is inside the 7d window");
    assert.equal(names.includes("tomorrow-tool"), false, "the day after window.to must not leak in");
  },
  `tools=${boundaryHeavy.toolLeaderboard.map((row) => row.name).join(",")}`,
);
for (const dispose of boundaryBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// Overview P1: today / yesterday snapshots and the cost forecast
// ---------------------------------------------------------------------------
check(
  "overview: P1 fields are present (today / yesterday / forecast)",
  () => {
    assert.ok("today" in overview);
    assert.ok("yesterday" in overview);
    assert.ok("forecast" in overview);
    assert.equal(overview.forecast, null, "the fixture spans fewer than 7 cost days");
  },
  `today=${overview.today === null ? "null" : "present"} forecast=${overview.forecast === null ? "null" : "present"}`,
);

const p1Now = Date.now();
const p1Corpus = createCorpus([
  {
    id: "session-today",
    createdAt: p1Now - 2 * HOUR,
    cwd: "E:/work/today",
    events: [
      messageEvent({ seq: 1, time: p1Now - 60_000, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0, cacheRead: 1 * M }),
    ],
  },
  {
    id: "session-yesterday",
    createdAt: p1Now - 30 * HOUR,
    cwd: "E:/work/yesterday",
    events: [
      messageEvent({ seq: 1, time: p1Now - 86_400_000, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 2 * M, output: 0 }),
    ],
  },
]);
const p1Boot = createFakeContext(p1Corpus);
apply(p1Boot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const p1Overview = bodyOf(await callRoute(p1Boot.routes.find((route) => route.path === OVERVIEW_PATH), { url: `${OVERVIEW_PATH}?window=7d` }));
check(
  "overview: today/yesterday snapshots match the daily buckets",
  () => {
    assert.deepEqual(Object.keys(p1Overview.today).sort(), ["cacheHitRate", "costCNY", "sessions", "tokens"]);
    assert.equal(p1Overview.today.tokens, 2 * M);
    assert.equal(p1Overview.today.sessions, 1);
    assert.equal(p1Overview.today.cacheHitRate, 0.5);
    assert.equal(p1Overview.yesterday.tokens, 2 * M);
    assert.equal(p1Overview.yesterday.sessions, 1);
    const daily = p1Overview.daily;
    assert.ok(Math.abs(p1Overview.today.costCNY - daily[daily.length - 1].costCNY) < 1e-9, "today cost mirrors daily[].costCNY");
    assert.ok(Math.abs(p1Overview.yesterday.costCNY - daily[daily.length - 2].costCNY) < 1e-9, "yesterday cost mirrors daily[].costCNY");
    assert.equal(p1Overview.forecast, null, "one cost day is not enough for a forecast");
  },
  `today=${p1Overview.today.tokens} yesterday=${p1Overview.yesterday.tokens}`,
);
for (const dispose of p1Boot.disposers) dispose();

const forecastNow = Date.now();
const forecastEvents = [];
for (let index = 0; index < 10; index += 1) {
  forecastEvents.push(
    messageEvent({
      seq: index + 1,
      time: forecastNow - index * 86_400_000 - 2 * HOUR,
      provider: "opencode-go",
      model: "deepseek-v4.1-flash",
      input: 1 * M,
      output: 0,
    }),
  );
}
const forecastBoot = createFakeContext(
  createCorpus([{ id: "session-forecast", createdAt: forecastNow - 12 * 24 * HOUR, cwd: "E:/work/fc", events: forecastEvents }]),
);
apply(forecastBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const forecastOverview = bodyOf(await callRoute(forecastBoot.routes.find((route) => route.path === OVERVIEW_PATH), { url: `${OVERVIEW_PATH}?window=30d` }));
check(
  "overview: forecast appears with >=7 cost days and stays finite/non-negative",
  () => {
    assert.ok(forecastOverview.forecast !== null);
    assert.deepEqual(Object.keys(forecastOverview.forecast).sort(), ["dataPoints", "daysLeft", "intercept", "monthEndEstimate", "sigma", "slope"]);
    assert.equal(forecastOverview.forecast.dataPoints, 10);
    assert.ok(Number.isFinite(forecastOverview.forecast.monthEndEstimate));
    assert.ok(forecastOverview.forecast.monthEndEstimate >= 0);
    assert.ok(forecastOverview.forecast.sigma >= 0);
    assert.ok(forecastOverview.forecast.daysLeft >= 0 && forecastOverview.forecast.daysLeft <= 31);
  },
  `points=${forecastOverview.forecast.dataPoints} end=¥${forecastOverview.forecast.monthEndEstimate}`,
);
for (const dispose of forecastBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// S11: an empty revision string must force a re-read (never freeze the cache)
// ---------------------------------------------------------------------------
const emptyRevCorpus = createCorpus([
  {
    id: "session-empty-rev",
    createdAt: NOW - 3 * HOUR,
    events: [messageEvent({ seq: 1, time: NOW - HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 })],
  },
]);
emptyRevCorpus.revisions.set("session-empty-rev", "");
const emptyRevBoot = createFakeContext(emptyRevCorpus);
apply(emptyRevBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const emptyRevOverviewRoute = emptyRevBoot.routes.find((route) => route.path === OVERVIEW_PATH);
const emptyRevFirst = bodyOf(await callRoute(emptyRevOverviewRoute, { url: `${OVERVIEW_PATH}?window=7d` }));
const readsAfterFirst = emptyRevBoot.counters.readSessionCalls;
emptyRevCorpus.sessions.get("session-empty-rev").events.push(
  messageEvent({ seq: 2, time: NOW - 30 * 60_000, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 }),
);
const emptyRevSecond = bodyOf(await callRoute(emptyRevOverviewRoute, { url: `${OVERVIEW_PATH}?window=7d` }));
check(
  "S11: empty revision forces a re-read instead of a stale cache hit",
  () => {
    assert.equal(readsAfterFirst, 1);
    assert.equal(emptyRevBoot.counters.readSessionCalls, 2, "an empty revision must not count as unchanged");
    assert.equal(emptyRevSecond.totals.tokens, 2 * M, "the appended event must be visible");
    assert.equal(emptyRevFirst.totals.tokens, 1 * M);
  },
  `reads=${emptyRevBoot.counters.readSessionCalls}`,
);
for (const dispose of emptyRevBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// S12: maxSessions keeps the newest sessions (listSessions order is unspecified)
// ---------------------------------------------------------------------------
const capBoot = createFakeContext(
  createCorpus([
    {
      id: "session-older",
      createdAt: NOW - 100 * HOUR,
      events: [messageEvent({ seq: 1, time: NOW - 90 * HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 })],
    },
    {
      id: "session-newer",
      createdAt: NOW - 1 * HOUR,
      events: [messageEvent({ seq: 1, time: NOW - 30 * 60_000, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 2 * M, output: 0 })],
    },
  ]),
);
apply(capBoot.ctx, { ttlMs: 0, maxSessions: 1, usdRate: 7.1, liveIntervalMs: 1000 });
const capOverview = bodyOf(await callRoute(capBoot.routes.find((route) => route.path === OVERVIEW_PATH), { url: `${OVERVIEW_PATH}?window=7d` }));
check(
  "S12: maxSessions keeps the newest session after a createdAt sort",
  () => {
    assert.equal(capBoot.counters.readSessionCalls, 1, "only one session may be read");
    assert.equal(capOverview.totals.tokens, 2 * M, "the newest session must win the cap");
  },
  `tokens=${capOverview.totals.tokens}`,
);
for (const dispose of capBoot.disposers) dispose();

// ---------------------------------------------------------------------------
// S13: title fallback chain (title → prompt prefix → empty string)
// ---------------------------------------------------------------------------
const titleBoot = createFakeContext(
  createCorpus([
    {
      id: "session-prompt-title",
      createdAt: NOW - 2 * HOUR,
      events: [
        {
          type: "user/message",
          seq: 1,
          time: NOW - HOUR,
          data: { source: { kind: "user" }, content: [{ type: "text", text: "这是一个没有标题但有很长提示词用来兜底的会话，请帮我分析一下问题出在哪里" }] },
        },
        messageEvent({ seq: 2, time: NOW - HOUR, provider: "opencode-go", model: "deepseek-v4.1-flash", input: 1 * M, output: 0 }),
      ],
    },
  ]),
);
apply(titleBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
const titleHeavy = bodyOf(await callRoute(titleBoot.routes.find((route) => route.path === HEAVY_PATH), { url: `${HEAVY_PATH}?window=7d` }));
check(
  "S13: missing title falls back to the first 24 prompt characters",
  () => {
    const expected = "这是一个没有标题但有很长提示词用来兜底的会话，请帮我分析一下问题出在哪里".slice(0, 24);
    assert.equal(titleHeavy.sessions[0].title, expected);
    assert.equal(titleHeavy.sessions[0].title.length, 24);
  },
  `title=${titleHeavy.sessions[0].title}`,
);
for (const dispose of titleBoot.disposers) dispose();

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
// PERF-03 warmup: one silent 2 s scan, cleared by the effect disposer
// ---------------------------------------------------------------------------
const scheduledTimers = [];
const clearedTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let warmBoot = null;
try {
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = {
      callback,
      delay,
      args,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      },
    };
    scheduledTimers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    clearedTimers.push(timer);
  };
  warmBoot = createFakeContext();
  apply(warmBoot.ctx, { ttlMs: 0, usdRate: 7.1, liveIntervalMs: 1000 });
} finally {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}
const warmTimers = scheduledTimers.filter((timer) => timer.delay === WARMUP_DELAY_MS);
check(
  "warmup: one silent 2 s scan is scheduled after mount",
  () => {
    assert.equal(WARMUP_DELAY_MS, 2000);
    assert.equal(warmTimers.length, 1, "apply must schedule exactly one warmup scan");
    assert.equal(typeof warmTimers[0].callback, "function");
    assert.equal(warmTimers[0].unrefCalled, true, "the warmup timer must not keep the process alive");
  },
  `timers=${warmTimers.length} delay=${warmTimers[0]?.delay}`,
);
await warmTimers[0].callback();
await new Promise((resolve) => setImmediate(resolve));
check(
  "warmup: the scheduled callback performs one silent scan",
  () => {
    assert.equal(warmBoot.counters.listSessionsCalls, 1);
    assert.equal(warmBoot.counters.readSessionCalls, 2);
  },
  `listCalls=${warmBoot.counters.listSessionsCalls} read=${warmBoot.counters.readSessionCalls}`,
);
check(
  "warmup: the effect disposer clears the timer",
  () => {
    const savedClearTimeout = globalThis.clearTimeout;
    globalThis.clearTimeout = (timer) => {
      clearedTimers.push(timer);
    };
    try {
      for (const disposer of warmBoot.disposers) disposer();
    } finally {
      globalThis.clearTimeout = savedClearTimeout;
    }
    assert.ok(clearedTimers.includes(warmTimers[0]), "ctx.effect cleanup must clearTimeout the warmup timer");
  },
  `cleared=${clearedTimers.length}`,
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

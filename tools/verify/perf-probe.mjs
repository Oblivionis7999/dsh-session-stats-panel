#!/usr/bin/env node
/**
 * perf-probe.mjs — performance measurements for the session-stats host half.
 *
 * Reuses the same idea as host-live.mjs (real session logs, fake plugin ctx,
 * direct handler calls) but focuses on timing, payload size and memory instead
 * of contract checks. It never writes business code and never touches DSH.
 *
 * Usage (repo root, run with --expose-gc for clean heap numbers):
 *   node --expose-gc tools/verify/perf-probe.mjs
 *   node --expose-gc tools/verify/perf-probe.mjs --json
 *   node --expose-gc tools/verify/perf-probe.mjs --reps 3 --ttl 150
 *
 * Scenarios (each repeated `--reps` times; medians reported):
 *   cold             first overview on a fresh plugin instance (full scan)
 *   overview-hot     second overview, response cache hit
 *   heavy-hot        heavy right after cold, reusing the same scan
 *   concurrent       overview + heavy fired with Promise.all on a fresh instance
 *   ttl-nopersist    overview after the response TTL expired, no persistence
 *                    backend (per-session TTL forces a full re-read)
 *   ttl-persist      overview after TTL expired, persistence revisions unchanged
 *                    (aggregates reused; rebuild only — the production path)
 *   revision-change  overview after TTL expired with one session revision bumped
 *
 * Also reports payload bytes / gzip bytes and cache memory (heap delta + peak RSS).
 *
 * Only `node:` builtins; no writes.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { apply } from "../../lib/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = "E:\\Program Files\\deepseekharness-webui\\home\\sessions";
const HOST = "127.0.0.1:2820";

const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i += 1) {
	const token = argv[i];
	if (!token.startsWith("--")) continue;
	const eq = token.indexOf("=");
	if (eq !== -1) {
		flags.set(token.slice(2, eq), token.slice(eq + 1));
		continue;
	}
	const next = argv[i + 1];
	if (next !== undefined && !next.startsWith("--")) {
		flags.set(token.slice(2), next);
		i += 1;
	} else {
		flags.set(token.slice(2), true);
	}
}

const asJson = Boolean(flags.get("json"));
const reps = Math.max(1, Number(flags.get("reps") ?? 3) || 3);
const ttlMs = Math.max(20, Number(flags.get("ttl") ?? 150) || 150);
const root = String(flags.get("root") ?? DEFAULT_ROOT).replace(/[\\/]+$/, "");

/* --------------------------------------------------------------- helpers */

function discoverSessionFiles(dir) {
	const out = [];
	const walk = (current, depth) => {
		if (depth > 4) return;
		let entries;
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full, depth + 1);
			else if (entry.name === "session.v4.jsonl.zstd") out.push(full);
		}
	};
	walk(dir, 0);
	return out;
}

function decodeWorkspaceName(name) {
	try {
		const inner = name.replace(/^--/, "").replace(/--$/, "");
		const text = inner
			.replace(/~0020/g, " ")
			.replace(/~([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
		return text.replace(/-/g, "\\").replace(/\\\\+/g, "\\");
	} catch {
		return name;
	}
}

function readFirstLine(buffer) {
	const text = zlib.zstdDecompressSync(buffer).toString("utf8");
	const newline = text.indexOf("\n");
	const line = newline === -1 ? text : text.slice(0, newline);
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round1 = (value) => Math.round(value * 10) / 10;

/* ---------------------------------------------------------------- corpus */

const tIndexStart = performance.now();
const files = discoverSessionFiles(root);
const sessions = [];
let compressedBytes = 0;
for (const file of files) {
	const workspaceDir = path.basename(path.dirname(path.dirname(file)));
	let buffer;
	let header;
	try {
		buffer = fs.readFileSync(file);
		header = readFirstLine(buffer);
	} catch {
		continue;
	}
	if (!header || header.type !== "session" || header.id === undefined) continue;
	compressedBytes += buffer.length;
	sessions.push({
		id: String(header.id),
		buffer,
		workspace: decodeWorkspaceName(workspaceDir),
		header: { ...header, cwd: header.cwd ?? decodeWorkspaceName(workspaceDir) },
	});
}
const indexMs = performance.now() - tIndexStart;
const byId = new Map(sessions.map((entry) => [entry.id, entry]));

function buildCtx({ persistence, ttl = 60_000 }) {
	const routes = new Map();
	const readStats = { reads: 0, lines: 0, decompressedBytes: 0, durations: [] };
	const disposers = [];
	const revisions = persistence ? new Map(sessions.map((entry) => [entry.id, "rev-1"])) : null;

	const readSession = (id) => {
		const entry = byId.get(String(id));
		if (!entry) throw new Error(`unknown session ${id}`);
		const readStarted = performance.now();
		const text = zlib.zstdDecompressSync(entry.buffer).toString("utf8");
		readStats.reads += 1;
		readStats.decompressedBytes += Buffer.byteLength(text);
		const events = [];
		for (const line of text.split("\n")) {
			if (line === "") continue;
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			readStats.lines += 1;
			if (event.type === "session") continue;
			events.push(event);
		}
		let inheritedEventCount = 0;
		for (const event of events) {
			if (event.type === "session/end-seed" && event.data?.inherited === true && Number.isFinite(event.seq)) {
				inheritedEventCount = Math.max(inheritedEventCount, Number(event.seq) + 1);
			}
		}
		readStats.durations.push(performance.now() - readStarted);
		return { session: entry.header, inheritedEventCount, events };
	};

	const ctx = {
		webServer: {
			register(route) {
				routes.set(route.path, route);
				return () => routes.delete(route.path);
			},
		},
		sessionQuery: {
			listSessions: async () => sessions.map((entry) => ({ header: entry.header, workspace: entry.workspace })),
			readSession: async (id) => readSession(id),
		},
		effect(callback, label) {
			const dispose = callback();
			if (typeof dispose === "function") disposers.push({ label, dispose });
		},
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		get(name) {
			if (name !== "sessionPersistence" || !persistence) return undefined;
			return {
				list: async () =>
					sessions.map((entry) => ({
						header: entry.header,
						revision: revisions.get(entry.id) ?? "rev-1",
					})),
			};
		},
	};

	const tApply = performance.now();
	apply(ctx, { ttlMs: ttl });
	const applyMs = performance.now() - tApply;
	// Snapshot the registered handlers, then run the effect disposer: that clears
	// the 2 s warmup timer (so it cannot pollute read counters) and unregisters
	// the live sampler. The handler closures stay callable.
	const handlers = new Map(routes);
	for (const entry of disposers) entry.dispose();
	disposers.length = 0;
	return { routes: handlers, readStats, applyMs, revisions };
}

function invoke(route, url) {
	const headers = {};
	const chunks = [];
	const res = {
		statusCode: 0,
		setHeader(name, value) {
			headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			chunks.push(body === undefined ? "" : String(body));
		},
	};
	const req = { method: "GET", url, headers: { host: HOST } };
	const started = performance.now();
	return route.handler(req, res).then(() => ({
		status: res.statusCode,
		ms: performance.now() - started,
		body: chunks.join(""),
		headers,
	}));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rss = () => process.memoryUsage().rss;
const heapUsed = () => process.memoryUsage().heapUsed;
const gc = () => {
	if (typeof global.gc === "function") global.gc();
};

/** Peak RSS sampled every 20 ms for the duration of an async operation. */
async function withPeakRss(operation) {
	let peak = rss();
	const timer = setInterval(() => {
		const value = rss();
		if (value > peak) peak = value;
	}, 20);
	timer.unref?.();
	try {
		const result = await operation();
		const value = rss();
		if (value > peak) peak = value;
		return { result, peak };
	} finally {
		clearInterval(timer);
	}
}

/* ------------------------------------------------------------- scenarios */

const report = {
	environment: {
		node: process.version,
		platform: process.platform,
		sessions: sessions.length,
		compressedBytes,
		indexMs: round1(indexMs),
		ttlMs,
		reps,
		gcAvailable: typeof global.gc === "function",
	},
	scenarios: {},
	payload: {},
	memory: {},
	raw: {},
};

async function coldScanOnce() {
	const boot = buildCtx({ persistence: true });
	const deps = { ...boot };
	const before = rss();
	// Longest main-thread stall: a 5 ms tick that cannot run while a session is
	// being decompressed/parsed shows up as a bigger gap between ticks.
	const gaps = [];
	let lastTick = performance.now();
	const ticker = setInterval(() => {
		const now = performance.now();
		gaps.push(now - lastTick - 5);
		lastTick = now;
	}, 5);
	const { result, peak } = await withPeakRss(async () => {
		const response = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
		return response;
	});
	clearInterval(ticker);
	const sortedGaps = gaps.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
	const elMaxMs = sortedGaps.length > 0 ? sortedGaps[sortedGaps.length - 1] : 0;
	const elP99Ms = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length * 0.99)] : 0;
	return {
		ms: result.ms,
		status: result.status,
		body: result.body,
		reads: boot.readStats.reads,
		decompressedBytes: boot.readStats.decompressedBytes,
		readDurations: boot.readStats.durations,
		applyMs: boot.applyMs,
		peakRss: peak,
		rssBefore: before,
		elMaxMs: Number.isFinite(elMaxMs) ? elMaxMs : 0,
		elP99Ms: Number.isFinite(elP99Ms) ? elP99Ms : 0,
		...deps,
	};
}

const coldRuns = [];
for (let i = 0; i < reps; i += 1) coldRuns.push(await coldScanOnce());
report.raw.cold = coldRuns.map((run) => ({ ms: round1(run.ms), reads: run.reads, applyMs: round1(run.applyMs) }));
report.scenarios.cold = {
	overviewMs: round1(median(coldRuns.map((run) => run.ms))),
	readSession: median(coldRuns.map((run) => run.reads)),
	applyMs: round1(median(coldRuns.map((run) => run.applyMs))),
	decompressedMB: round1(median(coldRuns.map((run) => run.decompressedBytes)) / 1048576),
	peakRssDeltaMB: coldRuns.map((run) => round1((run.peakRss - run.rssBefore) / 1048576)),
	readMsMax: round1(median(coldRuns.slice(0, 1).map((run) => Math.max(...run.readDurations)))),
	readMsMedian: round1(median(coldRuns.map((run) => median(run.readDurations)))),
};

// Hot overview + heavy on the last cold instance (its cache is warm).
const warm = buildCtx({ persistence: true });
await invoke(warm.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
const readsAfterWarmCold = warm.readStats.reads;
const hotRuns = [];
for (let i = 0; i < reps; i += 1) {
	const response = await invoke(warm.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	hotRuns.push({ ms: response.ms, readsDelta: warm.readStats.reads - readsAfterWarmCold });
}
report.scenarios.overviewHot = {
	ms: round1(median(hotRuns.map((run) => run.ms))),
	readSessionDelta: median(hotRuns.map((run) => run.readsDelta)),
};

// Heavy build (not response cache): rotate windows so each call has to rebuild.
const heavyWindows = ["7d", "14d", "30d"];
const heavyRuns = [];
for (let i = 0; i < reps; i += 1) {
	const windowKey = heavyWindows[i % heavyWindows.length];
	const readsBefore = warm.readStats.reads;
	const response = await invoke(warm.routes.get("/session-stats/api/heavy"), `/session-stats/api/heavy?window=${windowKey}`);
	heavyRuns.push({
		window: windowKey,
		ms: response.ms,
		bytes: Buffer.byteLength(response.body),
		readsDelta: warm.readStats.reads - readsBefore,
		body: response.body,
	});
}
// A repeat of the same window is the response-cache hit path.
const heavyRepeatReads = warm.readStats.reads;
const heavyRepeat = await invoke(warm.routes.get("/session-stats/api/heavy"), "/session-stats/api/heavy?window=30d");
report.scenarios.heavyHot = {
	buildMs: round1(median(heavyRuns.map((run) => run.ms))),
	buildReadSessionDelta: median(heavyRuns.map((run) => run.readsDelta)),
	cacheHitMs: round1(heavyRepeat.ms),
	cacheHitReadSessionDelta: warm.readStats.reads - heavyRepeatReads,
	windows: heavyRuns.map((run) => ({ window: run.window, ms: round1(run.ms) })),
};

// Concurrent overview + heavy on a fresh instance: one shared scan.
const concurrentRuns = [];
for (let i = 0; i < reps; i += 1) {
	const boot = buildCtx({ persistence: true });
	const started = performance.now();
	const [overviewResponse, heavyResponse] = await Promise.all([
		invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d"),
		invoke(boot.routes.get("/session-stats/api/heavy"), "/session-stats/api/heavy?window=7d"),
	]);
	concurrentRuns.push({
		totalMs: performance.now() - started,
		overviewMs: overviewResponse.ms,
		heavyMs: heavyResponse.ms,
		reads: boot.readStats.reads,
	});
}
report.scenarios.concurrent = {
	totalMs: round1(median(concurrentRuns.map((run) => run.totalMs))),
	overviewMs: round1(median(concurrentRuns.map((run) => run.overviewMs))),
	heavyMs: round1(median(concurrentRuns.map((run) => run.heavyMs))),
	readSession: median(concurrentRuns.map((run) => run.reads)),
	expectedOnce: sessions.length,
};
report.raw.concurrent = concurrentRuns.map((run) => ({
	totalMs: round1(run.totalMs),
	overviewMs: round1(run.overviewMs),
	heavyMs: round1(run.heavyMs),
	reads: run.reads,
}));

// TTL expiry without a persistence backend: the per-session TTL re-reads all.
const ttlNoPersistRuns = [];
for (let i = 0; i < reps; i += 1) {
	const boot = buildCtx({ persistence: false, ttl: ttlMs });
	const first = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	await sleep(ttlMs + 60);
	const readsBefore = boot.readStats.reads;
	const second = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	ttlNoPersistRuns.push({
		coldMs: first.ms,
		rebuildMs: second.ms,
		readsDelta: boot.readStats.reads - readsBefore,
	});
}
report.scenarios.ttlNoPersist = {
	coldMs: round1(median(ttlNoPersistRuns.map((run) => run.coldMs))),
	rebuildMs: round1(median(ttlNoPersistRuns.map((run) => run.rebuildMs))),
	readSessionDelta: median(ttlNoPersistRuns.map((run) => run.readsDelta)),
};

// TTL expiry with revisions unchanged: aggregates reused, only rebuild.
const ttlPersistRuns = [];
for (let i = 0; i < reps; i += 1) {
	const boot = buildCtx({ persistence: true, ttl: ttlMs });
	const first = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	await sleep(ttlMs + 60);
	const readsBefore = boot.readStats.reads;
	const second = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	ttlPersistRuns.push({
		coldMs: first.ms,
		rebuildMs: second.ms,
		readsDelta: boot.readStats.reads - readsBefore,
	});
}
report.scenarios.ttlPersist = {
	coldMs: round1(median(ttlPersistRuns.map((run) => run.coldMs))),
	rebuildMs: round1(median(ttlPersistRuns.map((run) => run.rebuildMs))),
	readSessionDelta: median(ttlPersistRuns.map((run) => run.readsDelta)),
};

// TTL expiry with one changed revision: only that session is re-read.
const revisionRuns = [];
for (let i = 0; i < reps; i += 1) {
	const boot = buildCtx({ persistence: true, ttl: ttlMs });
	const first = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	await sleep(ttlMs + 60);
	const changedId = sessions[i % sessions.length].id;
	boot.revisions.set(changedId, `rev-${i + 2}`);
	const readsBefore = boot.readStats.reads;
	const second = await invoke(boot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	revisionRuns.push({
		coldMs: first.ms,
		rebuildMs: second.ms,
		readsDelta: boot.readStats.reads - readsBefore,
	});
}
report.scenarios.revisionChange = {
	coldMs: round1(median(revisionRuns.map((run) => run.coldMs))),
	rebuildMs: round1(median(revisionRuns.map((run) => run.rebuildMs))),
	readSessionDelta: median(revisionRuns.map((run) => run.readsDelta)),
};

// Payload sizes: 7d from the cold/heavy runs, 30d after a warm scan.
const overviewBody7d = coldRuns[0].body;
const heavyBody7d = heavyRuns[0].body;
const overview30 = await invoke(warm.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=30d");
const heavy30 = await invoke(warm.routes.get("/session-stats/api/heavy"), "/session-stats/api/heavy?window=30d");
const sizeOf = (body) => ({
	bytes: Buffer.byteLength(body),
	gzipBytes: zlib.gzipSync(Buffer.from(body, "utf8")).length,
});
report.payload = {
	overview7d: sizeOf(overviewBody7d),
	heavy7d: sizeOf(heavyBody7d),
	overview30d: sizeOf(overview30.body),
	heavy30d: sizeOf(heavy30.body),
};

// Memory: baseline after a cold scan has grown the caches, then GC and read.
const memoryBoot = buildCtx({ persistence: true });
gc();
const heapBefore = heapUsed();
const rssBefore = rss();
let peakHeap = heapBefore;
const heapTimer = setInterval(() => {
	const value = heapUsed();
	if (value > peakHeap) peakHeap = value;
}, 20);
heapTimer.unref?.();
const memoryRun = await withPeakRss(async () => {
	const response = await invoke(memoryBoot.routes.get("/session-stats/api/overview"), "/session-stats/api/overview?window=7d");
	const heavy = await invoke(memoryBoot.routes.get("/session-stats/api/heavy"), "/session-stats/api/heavy?window=7d");
	return { response, heavy };
});
clearInterval(heapTimer);
gc();
const heapAfter = heapUsed();
const rssAfter = rss();
report.memory = {
	retainedHeapMB: round1((heapAfter - heapBefore) / 1048576),
	peakHeapDeltaMB: round1((peakHeap - heapBefore) / 1048576),
	rssDeltaMB: round1((rssAfter - rssBefore) / 1048576),
	peakRssMB: round1(memoryRun.peak / 1048576),
	peakRssDeltaMB: round1((memoryRun.peak - rssBefore) / 1048576),
	retainedHeapPerSessionKB: round1((heapAfter - heapBefore) / sessions.length / 1024),
	sessions: sessions.length,
};
report.scenarios.coldPeak = {
	peakRssMB: round1(median(coldRuns.map((run) => run.peakRss)) / 1048576),
	peakRssDeltaMB: round1(Math.max(...coldRuns.map((run) => run.peakRss - run.rssBefore)) / 1048576),
};

/* ---------------------------------------------------------------- output */

if (asJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	const line = (label, value, note = "") => console.log(`  ${label.padEnd(30)} ${String(value).padStart(10)}  ${note}`);
	console.log("");
	console.log("[perf-probe] environment");
	line("node", report.environment.node);
	line("sessions", sessions.length);
	line("compressed corpus", `${(compressedBytes / 1048576).toFixed(1)} MB`);
	line("index time", `${report.environment.indexMs} ms`);
	line("apply()", `${report.scenarios.cold.applyMs} ms`);
	console.log("");
	console.log("[perf-probe] scenarios (median of " + reps + ")");
	line("cold overview", `${report.scenarios.cold.overviewMs} ms`, `readSession=${report.scenarios.cold.readSession}, decompressed ${report.scenarios.cold.decompressedMB} MB`);
	line("cold longest session read", `${report.scenarios.cold.readMsMax} ms`, `median ${report.scenarios.cold.readMsMedian} ms`);
	line("overview hot", `${report.scenarios.overviewHot.ms} ms`, `reads+${report.scenarios.overviewHot.readSessionDelta}`);
	line("heavy build", `${report.scenarios.heavyHot.buildMs} ms`, `reads+${report.scenarios.heavyHot.buildReadSessionDelta}`);
	line("heavy response cache", `${report.scenarios.heavyHot.cacheHitMs} ms`, `reads+${report.scenarios.heavyHot.cacheHitReadSessionDelta}`);
	line("concurrent total", `${report.scenarios.concurrent.totalMs} ms`, `reads=${report.scenarios.concurrent.readSession}/${sessions.length}`);
	line("TTL rebuild (no persist)", `${report.scenarios.ttlNoPersist.rebuildMs} ms`, `reads+${report.scenarios.ttlNoPersist.readSessionDelta}`);
	line("TTL rebuild (persist)", `${report.scenarios.ttlPersist.rebuildMs} ms`, `reads+${report.scenarios.ttlPersist.readSessionDelta}`);
	line("TTL rebuild (1 changed)", `${report.scenarios.revisionChange.rebuildMs} ms`, `reads+${report.scenarios.revisionChange.readSessionDelta}`);
	console.log("");
	console.log("[perf-probe] payload");
	for (const [key, value] of Object.entries(report.payload)) {
		line(key, `${(value.bytes / 1024).toFixed(1)} kB`, `gzip ${(value.gzipBytes / 1024).toFixed(1)} kB`);
	}
	console.log("");
	console.log("[perf-probe] memory");
	line("retained heap (caches)", `${report.memory.retainedHeapMB} MB`, `${report.memory.retainedHeapPerSessionKB} kB/session`);
	line("peak heap delta", `${report.memory.peakHeapDeltaMB} MB`);
	line("rss delta (caches)", `${report.memory.rssDeltaMB} MB`);
	line("peak rss (cold scan)", `${report.scenarios.coldPeak.peakRssMB} MB`, `+${report.scenarios.coldPeak.peakRssDeltaMB} MB over baseline`);
	console.log("");
}

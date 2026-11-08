#!/usr/bin/env node
/**
 * host-live.mjs — run the *real* host plugin logic in this process against the
 * *real* session logs on disk, without restarting DSH.
 *
 * Why: DSH currently serves the host bundle from process memory, so new routes
 * in `lib/index.js` are only live after a restart. The plugin's own selfchecks
 * use synthetic fixtures. This harness closes that gap: it imports lib/index.js,
 * builds a fake plugin context whose `sessionQuery` reads and decompresses the
 * actual `session.v4.jsonl.zstd` files, calls `apply()`, and then drives the
 * registered HTTP handlers with fake req/res objects.
 *
 * It never writes business code, never touches the DSH process, and never
 * imports npm packages: `node:zlib` has `zstdDecompressSync` since Node 22.15.
 *
 * Usage (repo root):
 *   node tools/verify/host-live.mjs                 # all sessions, human summary
 *   node tools/verify/host-live.mjs --json           # machine-readable detail
 *   node tools/verify/host-live.mjs --limit 40       # only first 40 sessions
 *   node tools/verify/host-live.mjs --workspace dsh-session-stats-panel
 *   node tools/verify/host-live.mjs --root "<sessions dir>"
 *   node tools/verify/host-live.mjs --require-heavy  # fail (exit 1) if /heavy absent
 *
 * Checks performed:
 *   - apply() registers overview + live routes (and heavy when implemented)
 *   - GET overview -> 200, JSON shape, timings, payload bytes
 *   - loopback fence -> 403 for a non-loopback Host header
 *   - method allow-list -> 405 for POST
 *   - GET heavy (when registered) -> 200, shape, 56 heatmap days, descending
 *     leaderboards, session fields, payload bytes, ms
 *   - heatmap daily totals vs overview daily totals (same timezone day keys)
 *   - second call per route: scan-cache reuse (does not re-read sessions)
 *
 * Exit codes: 0 all checks pass, 1 a check failed, 2 harness could not run
 * (import/apply/log-discovery failure).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_ROOT = "E:\\Program Files\\deepseekharness-webui\\home\\sessions";
const HOST = "127.0.0.1:2820";
const LOOPBACK_HEADER = HOST;

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i += 1) {
	const a = argv[i];
	if (!a.startsWith("--")) continue;
	const eq = a.indexOf("=");
	if (eq !== -1) {
		flags.set(a.slice(2, eq), a.slice(eq + 1));
		continue;
	}
	const next = argv[i + 1];
	if (next !== undefined && !next.startsWith("--")) {
		flags.set(a.slice(2), next);
		i += 1;
	} else {
		flags.set(a.slice(2), true);
	}
}

const asJson = Boolean(flags.get("json"));
const limit = Number(flags.get("limit") ?? 0) || 0;
const workspaceFilter = flags.get("workspace") ? String(flags.get("workspace")).toLowerCase() : null;
const sessionsRoot = String(flags.get("root") ?? DEFAULT_ROOT).replace(/[\\/]+$/, "");
const requireHeavy = Boolean(flags.get("require-heavy"));
// `--no-inherit` forces inheritedEventCount=0, i.e. the pre-dedupe accounting.
// Running the harness twice (with and without) isolates the fork-dedupe effect.
const noInherit = Boolean(flags.get("no-inherit"));

const results = [];
function check(name, ok, detail = undefined, pending = false) {
	const status = pending ? "PENDING" : ok ? "PASS" : "FAIL";
	results.push({ name, status, detail });
	if (!asJson) {
		const suffix = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
		console.log(`[${status}] ${name}${suffix}`);
	}
	return ok;
}

function log(message) {
	if (!asJson) console.log(message);
}

/* ------------------------------------------------------------- discovery */

/** Recursively collect every `session.v4.jsonl.zstd` under the sessions root. */
function discoverSessionFiles(root) {
	const out = [];
	const walk = (dir, depth) => {
		if (depth > 4) return;
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full, depth + 1);
			else if (entry.name === "session.v4.jsonl.zstd") out.push(full);
		}
	};
	walk(root, 0);
	return out;
}

/** Decode the workspace directory encoding used by DSH session folders. */
function decodeWorkspaceName(name) {
	try {
		// `--E-FILES~0020FOR~0020DSH--` -> `E:\FILES FOR DSH`
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

/* -------------------------------------------------------------- fake ctx */

function makeFakeResponse() {
	const res = {
		statusCode: 0,
		headersSent: false,
		body: "",
		headers: Object.create(null),
		setHeader(key, value) {
			res.headers[String(key).toLowerCase()] = String(value);
			return res;
		},
		getHeader(key) {
			return res.headers[String(key).toLowerCase()];
		},
		writeHead(status, headers) {
			res.statusCode = status;
			if (headers && typeof headers === "object") {
				for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
			}
			res.headersSent = true;
			return res;
		},
		write(chunk) {
			res.body += Buffer.from(chunk).toString("utf8");
			return true;
		},
		end(chunk) {
			if (chunk !== undefined && chunk !== null) res.body += Buffer.from(chunk).toString("utf8");
			res.finished = true;
			res.headersSent = true;
			return res;
		},
	};
	return res;
}

/**
 * Invoke one registered handler with a synthetic request and collect the
 * response. Handlers are async and may or may not return a promise.
 */
async function invoke(route, { method = "GET", url = route.path, host = LOOPBACK_HEADER } = {}) {
	const req = { method, url, headers: { host, accept: "application/json" }, httpVersion: "1.1" };
	const res = makeFakeResponse();
	const started = performance.now();
	await route.handler(req, res);
	const ms = performance.now() - started;
	return { status: res.statusCode || 200, headers: res.headers, body: res.body, ms };
}

function parseJson(body) {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

/* ------------------------------------------------------- format helpers */

function bytes(value) {
	if (!Number.isFinite(value)) return "n/a";
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
	return `${(value / 1048576).toFixed(2)} MB`;
}

/** Count raw event times at/after `fromMs`, grouped by name. */
function countSince(timesMap, fromMs) {
	const out = new Map();
	for (const [name, times] of timesMap) {
		let count = 0;
		for (const time of times) if (time >= fromMs) count += 1;
		if (count > 0) out.set(name, count);
	}
	return out;
}

function dayKeyOf(startMs, timeZone) {
	return new Date(startMs).toLocaleDateString("sv-SE", { timeZone }).slice(0, 10);
}

/* ------------------------------------------------------------------ main */

async function main() {
	log(`[host-live] repo      ${REPO_ROOT}`);
	log(`[host-live] sessions  ${sessionsRoot}`);

	let aggregate;
	try {
		aggregate = await import("../../lib/index.js");
	} catch (error) {
		check("import lib/index.js", false, String(error?.message ?? error));
		return finish(2);
	}
	const { apply, OVERVIEW_PATH, LIVE_PATH } = aggregate;
	let commandProgramOf = null;
	try {
		const aggregateModule = await import("../../lib/aggregate.js");
		if (typeof aggregateModule.commandProgramOf === "function") commandProgramOf = aggregateModule.commandProgramOf;
	} catch {
		/* optional cross-check helper */
	}
	const HEAVY_PATH = aggregate.HEAVY_PATH ?? "/session-stats/api/heavy";
	check("lib/index.js exports apply()", typeof apply === "function");
	check(
		"HEAVY_PATH constant exported",
		typeof aggregate.HEAVY_PATH === "string",
		aggregate.HEAVY_PATH ?? "missing (task-5 not landed)",
		typeof aggregate.HEAVY_PATH !== "string",
	);

	/* Build the corpus index: header line only, compressed buffer retained. */
	const files = discoverSessionFiles(sessionsRoot);
	if (files.length === 0) {
		check("discover session logs", false, `none under ${sessionsRoot}`);
		return finish(2);
	}
	const tIndex = performance.now();
	const sessions = [];
	let compressedBytes = 0;
	let skipped = 0;
	for (const file of files) {
		const workspaceDir = path.basename(path.dirname(path.dirname(file)));
		const workspace = decodeWorkspaceName(workspaceDir);
		if (workspaceFilter && !`${workspace} ${path.basename(file)}`.toLowerCase().includes(workspaceFilter)) continue;
		if (limit > 0 && sessions.length >= limit) break;
		let buffer;
		try {
			buffer = fs.readFileSync(file);
		} catch {
			skipped += 1;
			continue;
		}
		let header;
		try {
			header = readFirstLine(buffer);
		} catch {
			skipped += 1;
			continue;
		}
		if (!header || header.type !== "session" || header.id === undefined) {
			skipped += 1;
			continue;
		}
		compressedBytes += buffer.length;
		sessions.push({
			id: String(header.id),
			file,
			buffer,
			workspace,
			header: { ...header, cwd: header.cwd ?? workspace },
		});
	}
	const indexMs = Math.round(performance.now() - tIndex);
	check(
		"discover session logs",
		sessions.length > 0,
		`${sessions.length} sessions, ${bytes(compressedBytes)}, ${indexMs}ms index, skipped=${skipped}`,
	);

	const byId = new Map(sessions.map((s) => [s.id, s]));
	const readStats = {
		reads: 0,
		lines: 0,
		decompressedBytes: 0,
		inheritedSessions: 0,
		inheritedEvents: 0,
		endSeedTotal: 0,
		inheritedMarkers: 0,
		seededSessions: 0,
		toolTimes: new Map(), // tool name -> event times (raw, filtered after the window is known)
		commandTimes: new Map(), // program token -> event times
		commandSamples: [],
	};

	/** Mimic `sessionQuery.readSession(id)`: header, inheritedEventCount, events. */
	function readSession(id) {
		const entry = byId.get(String(id));
		if (!entry) throw new Error(`unknown session ${id}`);
		const text = zlib.zstdDecompressSync(entry.buffer).toString("utf8");
		readStats.reads += 1;
		readStats.decompressedBytes += Buffer.byteLength(text);

		// 1) Parse every event line (the `session` header is returned separately).
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

		// 2) A forked/seeded session replays the parent prefix; only a
		// `session/end-seed` with `data.inherited === true` marks that cut.
		// `data: {}` is a resume/continue marker after a restart and must NEVER
		// be treated as an inheritance boundary (dsh-session lib/index.js:1422 vs
		// :1428). Take the LAST real marker's seq + 1.
		let inheritedEventCount = 0;
		let inheritedMarkerSeen = false;
		for (const event of events) {
			if (event.type !== "session/end-seed") continue;
			readStats.endSeedTotal += 1;
			if (event.data?.inherited === true) {
				readStats.inheritedMarkers += 1;
				if (Number.isFinite(event.seq)) {
					inheritedEventCount = event.seq + 1;
					inheritedMarkerSeen = true;
				}
			}
		}
		if (inheritedMarkerSeen) readStats.seededSessions += 1;
		if (inheritedEventCount > 0) {
			readStats.inheritedSessions += 1;
			readStats.inheritedEvents += inheritedEventCount;
		}
		const own = noInherit || inheritedEventCount === 0 ? events : events.slice(inheritedEventCount);

		// 3) Independent histogram over this session's own tool calls.
		for (const event of own) {
			if (event.type !== "tool/call") continue;
			const name = String(event.data?.name ?? "");
			if (name !== "") {
				const list = readStats.toolTimes.get(name) ?? [];
				list.push(Number(event.time) || 0);
				readStats.toolTimes.set(name, list);
			}
			if (!commandProgramOf) continue;
			const raw = event.data?.arguments;
			let args = null;
			try {
				args = typeof raw === "string" ? JSON.parse(raw) : raw;
			} catch {
				args = null;
			}
			const command = typeof args?.command === "string" ? args.command : "";
			if (command === "") continue;
			const program = commandProgramOf(command);
			if (program === "") continue;
			const list = readStats.commandTimes.get(program) ?? [];
			list.push(Number(event.time) || 0);
			readStats.commandTimes.set(program, list);
			if (readStats.commandSamples.length < 3) readStats.commandSamples.push(command.slice(0, 80));
		}

		return { session: entry.header, inheritedEventCount: noInherit ? 0 : inheritedEventCount, events };
	}

	const routes = new Map();
	const effectDisposers = [];
	const ctx = {
		webServer: {
			register(route) {
				routes.set(route.path, route);
				return () => routes.delete(route.path);
			},
		},
		sessionQuery: {
			listSessions: async () => sessions.map((s) => ({ header: s.header, workspace: s.workspace })),
			readSession: async (id) => readSession(id),
		},
		effect(callback, label) {
			const dispose = callback();
			if (typeof dispose === "function") effectDisposers.push({ label, dispose });
		},
		logger: {
			info() {},
			warn() {},
			error() {},
			debug() {},
		},
		get(name) {
			if (name === "sessionPersistence") return undefined; // TTL-based cache path
			return undefined;
		},
	};

	const tApply = performance.now();
	try {
		apply(ctx, { debug: false });
	} catch (error) {
		check("apply()", false, String(error?.stack ?? error));
		return finish(2);
	}
	check("apply()", true, `${Math.round(performance.now() - tApply)}ms, routes=${[...routes.keys()].join(", ")}`);

	const overviewRoute = routes.get(OVERVIEW_PATH);
	const liveRoute = routes.get(LIVE_PATH);
	const heavyRoute = routes.get(HEAVY_PATH);
	check("overview route registered", Boolean(overviewRoute), OVERVIEW_PATH);
	check("live route registered", Boolean(liveRoute), LIVE_PATH);
	check(
		"heavy route registered",
		Boolean(heavyRoute),
		heavyRoute ? HEAVY_PATH : `${HEAVY_PATH} not registered yet (host-dev work in progress)`,
		!heavyRoute,
	);

	/* ---------------------------------------------------------- overview */

	let overview = null;
	if (overviewRoute) {
		const first = await invoke(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` });
		const payload = parseJson(first.body);
		overview = payload;
		check("overview status 200", first.status === 200, `${first.status} in ${Math.round(first.ms)}ms`);
		check("overview content-type json", String(first.headers["content-type"] ?? "").includes("application/json"));
		check("overview cache-control no-store", first.headers["cache-control"] === "no-store");
		check("overview payload is JSON object", payload !== null && typeof payload === "object", bytes(Buffer.byteLength(first.body)));
		if (payload) {
			check("overview.ok === true", payload.ok === true);
			check("overview.window.key === 7d", payload.window?.key === "7d", payload.window?.key);
			check("overview.daily has 7 buckets", Array.isArray(payload.daily) && payload.daily.length === 7, payload.daily?.length);
			check("overview.totals.tokens is a finite number", Number.isFinite(payload.totals?.tokens), payload.totals?.tokens);
			check("overview.scan reports sessions", Number.isFinite(payload.scan?.sessionsScanned), payload.scan);
			check("no legacy `terminal` field (P0-A)", payload.terminal === undefined, payload.terminal === undefined ? "absent" : "STILL PRESENT");

			// Second call must reuse the response cache (no new readSession calls).
			const before = readStats.reads;
			const second = await invoke(overviewRoute, { url: `${OVERVIEW_PATH}?window=7d` });
			check(
				"overview second call served from cache",
				second.status === 200 && Math.round(second.ms) <= Math.max(50, Math.round(first.ms * 0.5)),
				`${Math.round(first.ms)}ms -> ${Math.round(second.ms)}ms, extra reads=${readStats.reads - before}`,
			);
		}
	}

	/* -------------------------------------------------------------- live */

	if (liveRoute) {
		const live = await invoke(liveRoute, { url: LIVE_PATH });
		const payload = parseJson(live.body);
		check("live status 200", live.status === 200, `${live.status} in ${Math.round(live.ms)}ms`);
		check("live.ok === true", payload?.ok === true);
		check("live has cpu/memory/eventLoop", Boolean(payload?.cpu && payload?.memory && payload?.eventLoop), Object.keys(payload ?? {}).join(","));
	}

	/* ------------------------------------------------------------ guards */

	if (overviewRoute) {
		const forbidden = await invoke(overviewRoute, {
			url: `${OVERVIEW_PATH}?window=7d`,
			host: "evil.example.com",
		});
		check("non-loopback Host -> 403", forbidden.status === 403, `${forbidden.status}`);
		const wrongMethod = await invoke(overviewRoute, { method: "POST", url: `${OVERVIEW_PATH}?window=7d` });
		check("POST overview -> 405", wrongMethod.status === 405, `${wrongMethod.status}`);
	}

	/* ------------------------------------------------------------- heavy */

	let heavyPayload = null;
	if (heavyRoute) {
		// The browser issues overview and heavy in parallel; both share one scan
		// (`scanInFlight`). heavy must therefore not re-read the corpus.
		const readsBeforeHeavy = readStats.reads;
		const first = await invoke(heavyRoute, { url: `${HEAVY_PATH}?window=7d` });
		const payload = parseJson(first.body);
		heavyPayload = payload;
		check(
			"heavy reuses the overview scan (no duplicate readSession)",
			readStats.reads === readsBeforeHeavy,
			`extra reads=${readStats.reads - readsBeforeHeavy}`,
		);
		check("heavy status 200", first.status === 200, `${first.status} in ${Math.round(first.ms)}ms`);
		check("heavy payload is JSON object", payload !== null && typeof payload === "object", bytes(Buffer.byteLength(first.body)));
		if (payload) {
			check("heavy.ok === true", payload.ok === true);
			check(
				"heavy payload has heatmap/toolLeaderboard/commandLeaderboard/sessions",
				["heatmap", "toolLeaderboard", "commandLeaderboard", "sessions"].every((k) => payload[k] !== undefined),
				Object.keys(payload).join(","),
			);

			const heatmap = payload.heatmap;
			const days = Array.isArray(heatmap) ? heatmap : Array.isArray(heatmap?.days) ? heatmap.days : null;
			check("heavy.heatmap has 56 days", Array.isArray(days) && days.length === 56, Array.isArray(days) ? days.length : typeof heatmap);
			if (Array.isArray(days)) {
				const sorted = days.every((d, i) => i === 0 || String(days[i - 1].date) < String(d.date));
				check("heatmap days ascending by date", sorted);
				const numeric = days.every((d) => Number.isFinite(d.tokens) && Number.isFinite(d.sessions));
				check("heatmap entries have numeric tokens/sessions", numeric);
				const total = days.reduce((sum, d) => sum + (Number.isFinite(d.tokens) ? d.tokens : 0), 0);
				check("heatmap token total > 0", total > 0, total.toLocaleString("en-US"));
				const timeZone = overview?.window?.timeZone ?? "Asia/Shanghai";
				const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone }).slice(0, 10);
				check("heatmap last day is today", String(days.at(-1)?.date) === todayKey, `${days.at(-1)?.date} vs ${todayKey}`);
				check(
					"heatmap has no future days",
					days.every((d) => String(d.date) <= todayKey),
					days.at(-1)?.date,
				);
			}

			const tools = payload.toolLeaderboard;
			const windowFrom = Number(overview?.window?.from) || 0;
			if (Array.isArray(tools)) {
				const descending = tools.every((row, i) => i === 0 || Number(tools[i - 1].count) >= Number(row.count));
				check("toolLeaderboard descending by count", descending, `${tools.length} rows`);
				check("toolLeaderboard length <= 20", tools.length <= 20, tools.length);
				check(
					"toolLeaderboard rows have name/count",
					tools.every((row) => typeof row.name === "string" && Number.isFinite(row.count)),
				);
				check(
					"toolLeaderboard lastCalledAt is a plausible epoch ms",
					tools.every((row) => Number.isFinite(row.lastCalledAt) && row.lastCalledAt > 1_600_000_000_000),
				);
				// Independent histogram over the raw tool/call events in the same window.
				if (windowFrom > 0) {
					const expected = countSince(readStats.toolTimes, windowFrom);
					let compared = 0;
					const mismatches = [];
					for (const row of tools) {
						const raw = expected.get(row.name);
						if (raw === undefined) continue;
						compared += 1;
						const tolerance = Math.max(3, Math.round(raw * 0.02));
						if (Math.abs(raw - row.count) > tolerance) mismatches.push(`${row.name}: ${row.count} vs raw ${raw}`);
					}
					check(
						"toolLeaderboard counts match raw tool/call events",
						compared > 0 && mismatches.length === 0,
						`compared=${compared} mismatched=${mismatches.length}${mismatches.length ? ` (${mismatches.slice(0, 3).join("; ")})` : ""}`,
					);
				}
			} else {
				check("toolLeaderboard is an array", false, typeof tools);
			}

			const commands = payload.commandLeaderboard;
			if (Array.isArray(commands)) {
				check(
					"commandLeaderboard rows expose `program` (not `name`)",
					commands.every((row) => typeof row.program === "string" && row.name === undefined),
					`${commands.length} rows`,
				);
				check(
					"commandLeaderboard descending by count",
					commands.every((row, i) => i === 0 || Number(commands[i - 1].count) >= Number(row.count)),
				);
				check("commandLeaderboard length <= 20", commands.length <= 20, commands.length);
				const programLike = commands.every((row) => !String(row.program).startsWith("/") && !String(row.program).includes(" "));
				check(
					"commandLeaderboard rows look like shell programs, not slash commands",
					programLike,
					commands.slice(0, 5).map((row) => row.program).join(","),
				);
				if (windowFrom > 0 && readStats.commandTimes.size > 0) {
					const expected = countSince(readStats.commandTimes, windowFrom);
					let compared = 0;
					const mismatches = [];
					for (const row of commands) {
						const raw = expected.get(row.program);
						if (raw === undefined) continue;
						compared += 1;
						const tolerance = Math.max(3, Math.round(raw * 0.02));
						if (Math.abs(raw - row.count) > tolerance) mismatches.push(`${row.program}: ${row.count} vs raw ${raw}`);
					}
					check(
						"commandLeaderboard counts match raw command tool calls",
						compared > 0 && mismatches.length === 0,
						`compared=${compared} mismatched=${mismatches.length}${mismatches.length ? ` (${mismatches.slice(0, 3).join("; ")})` : ""}`,
					);
				}
			} else {
				check("commandLeaderboard is an array", false, typeof commands);
			}

			if (payload.skillLeaderboard !== undefined) {
				const skills = payload.skillLeaderboard;
				check(
					"skillLeaderboard rows have name/count",
					Array.isArray(skills) && skills.every((row) => typeof row.name === "string" && Number.isFinite(row.count)),
					Array.isArray(skills) ? `${skills.length} rows` : typeof skills,
				);
			}

			const sessionsList = payload.sessions;
			if (Array.isArray(sessionsList)) {
				check("sessions list is non-empty", sessionsList.length > 0, `${sessionsList.length} rows`);
				const required = ["id", "title", "turns", "steps", "tokens", "costCNY", "lastActiveAt"];
				const missing = sessionsList.slice(0, 5).flatMap((row) => required.filter((key) => row[key] === undefined));
				check("session rows have required fields", missing.length === 0, missing.length ? [...new Set(missing)].join(",") : "ok");
				const titled = sessionsList.filter((row) => typeof row.title === "string" && row.title !== "").length;
				check(
					"session titles resolved",
					titled > 0,
					`${titled}/${sessionsList.length} (${Math.round((titled / sessionsList.length) * 100)}%)`,
				);
				const withCwd = sessionsList.filter((row) => typeof row.workspace === "string" && row.workspace !== "").length;
				check("session workspaces resolved", withCwd > 0, `${withCwd}/${sessionsList.length}`);
				const subagents = sessionsList.filter((row) => row.isSubagent === true).length;
				check(
					"session rows carry a boolean isSubagent",
					sessionsList.every((row) => typeof row.isSubagent === "boolean"),
					`${subagents}/${sessionsList.length} subagents`,
				);
				check(
					"session rows carry a boolean isArchived",
					sessionsList.every((row) => typeof row.isArchived === "boolean"),
				);
				check("session list capped at 100", sessionsList.length <= 100, sessionsList.length);
				// Dedupe / accounting reconciliation against overview totals (same window).
				if (!noInherit && overview && Number.isFinite(overview.totals?.tokens)) {
					const sumTokens = sessionsList.reduce((sum, row) => sum + (Number(row.tokens) || 0), 0);
					const ratio = sumTokens / overview.totals.tokens;
					const scanned = Number(overview.scan?.sessionsScanned) || 0;
					// The host returns at most SESSION_LIST_LIMIT (100) rows while the
					// overview covers every scanned session, so a truncated list must
					// sum to LESS than the total. Only a complete list has to match.
					const truncated = scanned > sessionsList.length;
					const ok = truncated ? Number.isFinite(ratio) && ratio > 0 && ratio <= 1.005 : Math.abs(ratio - 1) <= 0.02;
					check(
						"sessions token sum reconciles with overview.totals",
						ok,
						`sessions=${sumTokens.toLocaleString("en-US")} overview=${overview.totals.tokens.toLocaleString("en-US")} ratio=${ratio.toFixed(4)} list=${sessionsList.length}/${scanned}${truncated ? " (truncated, ratio<1 expected)" : ""}`,
					);
				}
			} else {
				check("sessions is an array", false, typeof sessionsList);
			}

			// Cross-check heatmap against overview daily, when both are available.
			if (overview && Array.isArray(days) && Array.isArray(overview.daily)) {
				const timeZone = overview.window?.timeZone ?? "Asia/Shanghai";
				const heatByDate = new Map(days.map((d) => [d.date, Number(d.tokens) || 0]));
				let compared = 0;
				let mismatched = 0;
				for (const bucket of overview.daily) {
					const key = dayKeyOf(Number(bucket.start), timeZone);
					if (!heatByDate.has(key)) continue;
					compared += 1;
					const a = Number(bucket.tokens) || 0;
					const b = heatByDate.get(key) || 0;
					const tolerance = Math.max(1, Math.round(Math.max(a, b) * 0.01));
					if (Math.abs(a - b) > tolerance) mismatched += 1;
				}
				check(
					"heatmap tokens agree with overview.daily",
					compared > 0 && mismatched === 0,
					`compared=${compared} mismatched=${mismatched}`,
				);
			}

			const before = readStats.reads;
			const second = await invoke(heavyRoute, { url: `${HEAVY_PATH}?window=7d` });
			check(
				"heavy second call served from cache",
				second.status === 200,
				`${Math.round(first.ms)}ms -> ${Math.round(second.ms)}ms, extra reads=${readStats.reads - before}`,
			);
		}

		const forbidden = await invoke(heavyRoute, { url: `${HEAVY_PATH}?window=7d`, host: "evil.example.com" });
		check("heavy non-loopback Host -> 403", forbidden.status === 403, `${forbidden.status}`);
		const wrongMethod = await invoke(heavyRoute, { method: "POST", url: `${HEAVY_PATH}?window=7d` });
		check("heavy POST -> 405", wrongMethod.status === 405, `${wrongMethod.status}`);
	}

	/* ------------------------------------------------------------ report */

	log("");
	log(
		`[host-live] readSession calls=${readStats.reads} lines=${readStats.lines} decompressed=${bytes(readStats.decompressedBytes)}`,
	);
	log(
		`[host-live] inheritance: end-seed=${readStats.endSeedTotal} inheritedMarkers=${readStats.inheritedMarkers} seededSessions=${readStats.seededSessions} skippedEvents=${readStats.inheritedEvents} mode=${noInherit ? "no-inherit (pre-dedupe)" : "deduped"}`,
	);
	const dumpDir = flags.get("dump") ? path.resolve(REPO_ROOT, String(flags.get("dump"))) : null;
	if (dumpDir) {
		fs.mkdirSync(dumpDir, { recursive: true });
		const freeze = (name, payload) => {
			if (payload === null || payload === undefined) return;
			fs.writeFileSync(path.join(dumpDir, name), JSON.stringify(payload, null, 2));
		};
		freeze("overview.7d.json", overview);
		freeze("heavy.7d.json", heavyPayload);
		log(`[host-live] dumped payloads to ${dumpDir}`);
	}
	const summary = summarize();
	log(`[host-live] ${summary.line}`);
	for (const disposer of effectDisposers) {
		try {
			disposer.dispose();
		} catch {
			/* disposal is best effort */
		}
	}
	return finish(summary.fail > 0 ? 1 : 0);
}

function summarize() {
	const pass = results.filter((r) => r.status === "PASS").length;
	const fail = results.filter((r) => r.status === "FAIL").length;
	const pending = results.filter((r) => r.status === "PENDING").length;
	return { pass, fail, pending, line: `${pass} PASS, ${fail} FAIL, ${pending} PENDING` };
}

function finish(code) {
	const summary = summarize();
	if (asJson) {
		console.log(
			JSON.stringify(
				{
					ok: summary.fail === 0,
					code,
					summary,
					checkedAt: new Date().toISOString(),
					checks: results,
				},
				null,
				2,
			),
		);
	} else {
		if (code !== 0) console.log(`[host-live] exit ${code}`);
	}
	process.exit(code);
}

main().catch((error) => {
	check("harness", false, String(error?.stack ?? error));
	finish(2);
});

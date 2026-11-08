#!/usr/bin/env node
/**
 * perf-browser.mjs — browser-side perf measurement for the session-stats panel.
 *
 * Uses a private Edge instance (default CDP_ENDPOINT=http://127.0.0.1:9224),
 * mocks `/session-stats/api/overview` + `/session-stats/api/heavy` through the
 * CDP Fetch domain (so the running host's old bundle does not matter), clicks
 * the sidebar entry and records:
 *
 *   - click -> 4 metric cards visible (median of N runs)
 *   - click -> heavy cards (heatmap/leaderboard/session rows) visible
 *   - overview/heavy request start delta (parallelism)
 *   - long tasks (>50 ms) and layout shifts during the first paint
 *   - window switch 7d -> 30d: progress bar appear/disappear, bars kept while busy
 *
 * Each run uses a fresh tab, so the app mounts from scratch (no restored panel).
 *
 * Usage:
 *   DSH_URL="http://127.0.0.1:2820/?token=..." node tools/verify/perf-browser.mjs
 *   DSH_URL=... node tools/verify/perf-browser.mjs --runs 3 --json
 *   DSH_URL=... CDP_ENDPOINT=http://127.0.0.1:9224 node tools/verify/perf-browser.mjs \
 *       --overview _notes/verify/.tmp/overview.7d.json \
 *       --heavy _notes/verify/.tmp/heavy.7d.json
 *
 * The two fixtures default to `_notes/verify/.tmp/{overview,heavy}.7d.json`.
 * Never writes to the repo; prints JSON when --json is passed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CDP_BASE = String(process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9224").replace(/\/$/, "");
const DSH_URL = String(process.env.DSH_URL ?? "").trim();

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
const runs = Math.max(1, Number(flags.get("runs") ?? 3) || 3);
const switchDelayMs = Math.max(50, Number(flags.get("switch-delay") ?? 700) || 700);
const overviewPath = path.resolve(REPO_ROOT, String(flags.get("overview") ?? "_notes/verify/.tmp/overview.7d.json"));
const heavyPath = path.resolve(REPO_ROOT, String(flags.get("heavy") ?? "_notes/verify/.tmp/heavy.7d.json"));
const overviewBody = fs.existsSync(overviewPath) ? fs.readFileSync(overviewPath, "utf8") : "";
const heavyBody = fs.existsSync(heavyPath) ? fs.readFileSync(heavyPath, "utf8") : "";
/**
 * A distinct payload for the 30d tab. The fixture is a 7d snapshot, so expand
 * the daily buckets to 30 and scale the totals; that makes "old data kept while
 * busy, then replaced" observable in the DOM (7 bars -> 30 bars, changed total).
 */
const overviewSwitchBody = (() => {
	if (!overviewBody) return "";
	try {
		const payload = JSON.parse(overviewBody);
		if (!Array.isArray(payload.daily) || payload.daily.length === 0) return overviewBody;
		const daily = Array.from({ length: 30 }, (_, index) => {
			const base = payload.daily[index % payload.daily.length];
			return { ...base, key: String(index) };
		});
		return JSON.stringify({
			...payload,
			window: { ...payload.window, key: "30d", bucketCount: 30, points: daily.map((entry) => entry.label) },
			totals: {
				...payload.totals,
				tokens: (Number(payload.totals?.tokens) || 0) * 4,
				costCNY: (Number(payload.totals?.costCNY) || 0) * 4,
				costUSD: (Number(payload.totals?.costUSD) || 0) * 4,
				costCNYTotal: (Number(payload.totals?.costCNYTotal) || 0) * 4,
			},
			daily,
		});
	} catch {
		return overviewBody;
	}
})();
if (!DSH_URL) {
	console.error("DSH_URL is required, e.g. DSH_URL='http://127.0.0.1:2820/?token=...'");
	process.exit(2);
}
if (!overviewBody || !heavyBody) {
	console.error(`missing fixtures:\n  ${overviewPath}\n  ${heavyPath}`);
	process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpJson(route, method = "GET") {
	const response = await fetch(`${CDP_BASE}${route}`, { method });
	if (!response.ok) throw new Error(`${method} ${route} -> ${response.status}`);
	return response.json();
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 0;
		this.pending = new Map();
		this.listeners = new Set();
		this.closed = false;
		this.errors = [];
		ws.addEventListener("message", (event) => this.#dispatch(event.data));
		ws.addEventListener("close", () => {
			this.closed = true;
			for (const [, entry] of this.pending) entry.reject(new Error("CDP socket closed"));
			this.pending.clear();
		});
	}

	static async connect(wsUrl) {
		const ws = new WebSocket(wsUrl);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 8000);
			ws.addEventListener("open", () => {
				clearTimeout(timer);
				resolve();
			}, { once: true });
			ws.addEventListener("error", () => {
				clearTimeout(timer);
				reject(new Error("WebSocket error"));
			}, { once: true });
		});
		return new Cdp(ws);
	}

	#dispatch(raw) {
		let msg;
		try {
			msg = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
		} catch {
			return;
		}
		if (msg.id !== undefined) {
			const entry = this.pending.get(msg.id);
			if (!entry) return;
			this.pending.delete(msg.id);
			if (msg.error) entry.reject(new Error(`${msg.error.message} (${msg.error.code})`));
			else entry.resolve(msg.result);
			return;
		}
		for (const fn of this.listeners) {
			try {
				fn(msg);
			} catch {
				/* ignore listener errors */
			}
		}
	}

	send(method, params = {}, timeoutMs = 30000) {
		if (this.closed) return Promise.reject(new Error("CDP socket is closed"));
		const id = (this.nextId += 1);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	on(listener) {
		this.listeners.add(listener);
	}

	close() {
		try {
			this.ws.close();
		} catch {
			/* ignore */
		}
	}
}

async function evaluate(cdp, expression, { awaitPromise = false, timeoutMs = 30000 } = {}) {
	const result = await cdp.send(
		"Runtime.evaluate",
		{ expression, awaitPromise, returnByValue: true, userGesture: true },
		timeoutMs,
	);
	if (result.exceptionDetails) {
		const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
		throw new Error(`page exception: ${String(text).slice(0, 300)}`);
	}
	return result.result?.value;
}

/** Wait until a page-side predicate returns truthy. */
async function waitFor(cdp, expression, timeoutMs = 20000, intervalMs = 100) {
	const started = Date.now();
	for (;;) {
		let value = false;
		try {
			value = await evaluate(cdp, `Boolean(${expression})`);
		} catch {
			value = false;
		}
		if (value) return Date.now() - started;
		if (Date.now() - started > timeoutMs) throw new Error(`waitFor timeout: ${expression}`);
		await sleep(intervalMs);
	}
}

/** Fulfil both API requests; `delay` lets the switch phase show the progress bar. */
function installMocks(cdp, state) {
	cdp.on((msg) => {
		if (msg.method !== "Fetch.requestPaused") return;
		const url = String(msg.params.request?.url ?? "");
		const is30d = /[?&]window=30d/.test(url);
		const handler = [
			{ pattern: "/session-stats/api/overview", body: is30d ? overviewSwitchBody : overviewBody },
			{ pattern: "/session-stats/api/heavy", body: heavyBody },
		].find((entry) => url.includes(entry.pattern));
		if (!handler) {
			cdp.send("Fetch.continueRequest", { requestId: msg.params.requestId }).catch(() => null);
			return;
		}
		const entry = { url, at: Date.now(), delay: state.delay };
		state.hits.push(entry);
		const respond = () => {
			entry.fulfilledAt = Date.now();
			cdp.send("Fetch.fulfillRequest", {
				requestId: msg.params.requestId,
				responseCode: 200,
				responseHeaders: [
					{ name: "content-type", value: "application/json; charset=utf-8" },
					{ name: "cache-control", value: "no-store" },
				],
				body: Buffer.from(handler.body).toString("base64"),
			}).catch(() => null);
		};
		if (state.delay > 0) setTimeout(respond, state.delay);
		else respond();
	});
	return cdp.send("Fetch.enable", {
		patterns: [
			{ urlPattern: "*/session-stats/api/overview*", requestStage: "Request" },
			{ urlPattern: "*/session-stats/api/heavy*", requestStage: "Request" },
		],
	});
}

const INSTRUMENT = `(() => {
	const perf = (window.__perf = {
		t0: performance.now(),
		fetchCalls: [],
		longtasks: [],
		shifts: [],
		paints: [],
		clickAt: null,
		firstCardAt: null,
		firstDataAt: null,
		firstHeavyAt: null,
		busySeen: false,
	});
	const original = window.fetch;
	window.fetch = function (input, init) {
		const url = String(typeof input === "string" ? input : (input && input.url) || "");
		const entry = { url, start: performance.now(), end: null, status: null };
		perf.fetchCalls.push(entry);
		const promise = original.call(this, input, init);
		promise.then(
			(response) => { entry.end = performance.now(); entry.status = response.status; },
			(error) => { entry.end = performance.now(); entry.error = String(error); },
		);
		return promise;
	};
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) perf.longtasks.push({ start: entry.startTime, duration: entry.duration });
		}).observe({ type: "longtask", buffered: true });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) if (!entry.hadRecentInput) perf.shifts.push({ start: entry.startTime, value: entry.value });
		}).observe({ type: "layout-shift", buffered: true });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) perf.paints.push({ name: entry.name, start: entry.startTime });
		}).observe({ type: "paint", buffered: true });
	} catch {}
	const scan = () => {
		const now = performance.now();
		const root = document.querySelector(".ssp-root");
		if (!perf.firstCardAt && document.querySelectorAll(".ssp-card").length >= 4 && (document.body.innerText || "").includes("总 Token 消耗")) perf.firstCardAt = now;
		if (!perf.firstDataAt && root && root.dataset.loading === "false") perf.firstDataAt = now;
		if (!perf.firstHeavyAt && document.querySelectorAll("[data-date]").length >= 56) perf.firstHeavyAt = now;
		if (root && root.dataset.busy === "true") perf.busySeen = true;
	};
	new MutationObserver(scan).observe(document.documentElement, {
		subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-busy", "class"],
	});
	scan();
	return true;
})()`;

const CLICK_PANEL = `(() => {
	const needles = ["肥鱼用量分析", "会话统计", "Fat Fish Usage", "Session stats", "Usage"];
	const preferred = [...document.querySelectorAll('button,[role="button"],a')];
	const byLabel = preferred.find((node) => {
		const text = ((node.getAttribute && node.getAttribute("aria-label")) || "").trim();
		const own = (node.textContent || "").trim();
		return needles.some((needle) => text === needle || own === needle);
	});
	const loose = preferred.find((node) => {
		const haystack = ((node.getAttribute && node.getAttribute("aria-label")) || "") + " " + (node.textContent || "");
		return needles.some((needle) => haystack.includes(needle));
	});
	const target = byLabel || loose;
	if (!target) return { clicked: false, candidates: preferred.length };
	const label = ((target.getAttribute && target.getAttribute("aria-label")) || target.textContent || "").trim().slice(0, 60);
	target.scrollIntoView({ block: "center" });
	window.__perf.clickAt = performance.now();
	target.click();
	return { clicked: true, label };
})()`;

const WAIT_CARDS = `new Promise((resolve) => {
	const started = performance.now();
	const check = () => {
		const root = document.querySelector(".ssp-root");
		const cards = document.querySelectorAll(".ssp-card").length;
		if (cards >= 4 && root && root.dataset.loading === "false") {
			observer.disconnect();
			clearTimeout(timer);
			resolve({ ms: performance.now() - (window.__perf.clickAt || started), cards });
			return true;
		}
		return false;
	};
	const observer = new MutationObserver(() => check());
	observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-loading", "class"] });
	const timer = setTimeout(() => {
		observer.disconnect();
		resolve({ timeout: true, cards: document.querySelectorAll(".ssp-card").length });
	}, 15000);
	check();
})`;

const WAIT_HEAVY = `new Promise((resolve) => {
	const started = performance.now();
	const timer = setInterval(() => {
		const cells = document.querySelectorAll("[data-date]").length;
		if (cells >= 56) {
			clearInterval(timer);
			resolve({ ms: performance.now() - (window.__perf.clickAt || started), cells });
			return;
		}
		if (performance.now() - started > 15000) {
			clearInterval(timer);
			resolve({ timeout: true, cells });
			return;
		}
	}, 10);
})`;

const CLICK_WINDOW = (label) => `(() => {
	const buttons = [...document.querySelectorAll("button,[role=tab]")];
	const target = buttons.find((node) => (node.textContent || "").trim() === ${JSON.stringify(label)})
		|| buttons.find((node) => (node.textContent || "").includes(${JSON.stringify(label)}));
	if (!target) return { clicked: false, buttons: buttons.slice(0, 12).map((n) => (n.textContent || "").trim()) };
	const root = document.querySelector(".ssp-root");
	const aside = document.querySelector(".ssp-aside-main");
	window.__switch = {
		clickAt: performance.now(),
		barsAtClick: document.querySelectorAll(".ssp-bars .ssp-bar-col").length,
		asideAtClick: aside ? aside.innerText.trim().slice(0, 40) : null,
		samples: [],
	};
	const timer = setInterval(() => {
		const node = document.querySelector(".ssp-root");
		const progress = document.querySelector(".ssp-progress");
		const asideNow = document.querySelector(".ssp-aside-main");
		window.__switch.samples.push({
			t: performance.now() - window.__switch.clickAt,
			busy: node ? node.dataset.busy === "true" : null,
			progress: Boolean(progress),
			bars: document.querySelectorAll(".ssp-bars .ssp-bar-col").length,
			cards: document.querySelectorAll(".ssp-card").length,
			aside: asideNow ? asideNow.innerText.trim().slice(0, 40) : null,
		});
		if (performance.now() - window.__switch.clickAt > 4000) clearInterval(timer);
	}, 10);
	target.click();
	return { clicked: true, label: (target.textContent || "").trim() };
})()`;

const READ_SWITCH = `new Promise((resolve) => {
	const started = performance.now();
	const timer = setInterval(() => {
		const state = window.__switch;
		const samples = state ? state.samples : [];
		const anyBusy = samples.some((sample) => sample.progress);
		const bars = document.querySelectorAll(".ssp-bars .ssp-bar-col").length;
		if (state && samples.length > 0 && !anyBusy && bars >= 30 && performance.now() - state.clickAt > 600) {
			clearInterval(timer);
			resolve(state);
			return;
		}
		if (performance.now() - started > 8000) {
			clearInterval(timer);
			resolve(state || null);
		}
	}, 25);
})`;

/* --------------------------------------------------------------- one run */

async function runOnce(index) {
	const target = await httpJson(`/json/new?${encodeURIComponent("about:blank")}`, "PUT");
	const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
	const consoleErrors = [];
	cdp.on((msg) => {
		if (msg.method === "Runtime.exceptionThrown") {
			consoleErrors.push(String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "").slice(0, 200));
		}
	});
	const state = { delay: 0, hits: [] };
	try {
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("Log.enable");
		await cdp.send("Network.enable");
		await installMocks(cdp, state);
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1366,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: DSH_URL });
		await waitFor(cdp, "document.readyState === 'complete' && document.body && document.body.innerText.length > 40", 30000);
		await sleep(1200); // let the app shell settle (this part is not measured)
		const alreadyOpen = await evaluate(cdp, "Boolean(document.querySelector('.ssp-root'))");
		await evaluate(cdp, INSTRUMENT);
		if (alreadyOpen) {
			// Leave the panel first so the click below is a real mount.
			await evaluate(cdp, `(() => {
				const away = [...document.querySelectorAll('button,[role="button"],a')].find((node) => /会话|新会话|Workspace|Chat/.test((node.textContent || "").trim()) && !/肥鱼量|会话统计/.test((node.textContent || "").trim()));
				if (away) away.click();
				return Boolean(away);
			})()`);
			await sleep(400);
		}
		state.delay = 0;
		state.hits.length = 0;
		const click = await evaluate(cdp, CLICK_PANEL);
		if (!click?.clicked) throw new Error(`panel entry not found: ${JSON.stringify(click)}`);
		const cards = await evaluate(cdp, WAIT_CARDS, { awaitPromise: true, timeoutMs: 20000 });
		const heavy = await evaluate(cdp, WAIT_HEAVY, { awaitPromise: true, timeoutMs: 20000 });
		const perfAfterLoad = await evaluate(cdp, `(() => {
			const perf = window.__perf;
			const calls = perf.fetchCalls.filter((entry) => entry.url.includes("/session-stats/api/"));
			const overview = calls.find((entry) => entry.url.includes("/overview"));
			const heavyCall = calls.find((entry) => entry.url.includes("/heavy"));
			return {
				clickAt: Number(perf.clickAt.toFixed(1)),
				requests: calls.map((entry) => ({ url: entry.url.replace(location.origin, ""), start: Number(entry.start.toFixed(1)), ms: entry.end === null ? null : Number((entry.end - entry.start).toFixed(1)), status: entry.status })),
				startDeltaMs: overview && heavyCall ? Number(Math.abs(overview.start - heavyCall.start).toFixed(1)) : null,
				firstCardAt: perf.firstCardAt === null ? null : Number((perf.firstCardAt - perf.clickAt).toFixed(1)),
				firstDataAt: perf.firstDataAt === null ? null : Number((perf.firstDataAt - perf.clickAt).toFixed(1)),
				firstHeavyAt: perf.firstHeavyAt === null ? null : Number((perf.firstHeavyAt - perf.clickAt).toFixed(1)),
				longtasks: perf.longtasks.map((entry) => ({ start: Number(entry.start.toFixed(1)), duration: Number(entry.duration.toFixed(1)) })),
				panelLongtasks: perf.longtasks
					.filter((entry) => entry.start >= perf.clickAt)
					.map((entry) => ({ start: Number((entry.start - perf.clickAt).toFixed(1)), duration: Number(entry.duration.toFixed(1)) })),
				shifts: perf.shifts.map((entry) => ({ start: Number(entry.start.toFixed(1)), value: Number(entry.value.toFixed(4)) })),
				paints: perf.paints,
			};
		})()`);

		/* window switch 7d -> 30d, with a delayed mock so the bar is observable */
		state.delay = switchDelayMs;
		state.hits.length = 0;
		const windowClick = await evaluate(cdp, CLICK_WINDOW("近 30 天"));
		const switchState = windowClick?.clicked ? await evaluate(cdp, READ_SWITCH, { awaitPromise: true, timeoutMs: 9000 }) : null;
		state.delay = 0;
		const switchRequests = state.hits.map((entry) => ({
			url: entry.url.replace(/^https?:\/\/[^/]+/, ""),
			delay: entry.delay,
			serverMs: entry.fulfilledAt ? entry.fulfilledAt - entry.at : null,
		}));
		const switchSummary = switchState
			? (() => {
					const samples = switchState.samples;
					const firstProgress = samples.find((sample) => sample.progress);
					const lastProgress = [...samples].reverse().find((sample) => sample.progress);
					const busyStart = samples.findIndex((sample) => sample.busy === true);
					const barsWhileBusy = busyStart === -1 ? null : samples[busyStart].bars;
					const cardsWhileBusy = busyStart === -1 ? null : samples[busyStart].cards;
					const asideWhileBusy = busyStart === -1 ? null : samples[busyStart].aside;
					const last = samples[samples.length - 1];
					return {
						clicked: true,
						progressAppearMs: firstProgress ? Number(firstProgress.t.toFixed(1)) : null,
						progressDisappearMs: lastProgress ? Number(lastProgress.t.toFixed(1)) : null,
						busySeen: samples.some((sample) => sample.busy === true),
						barsAtClick: switchState.barsAtClick,
						barsWhileBusy,
						barsAfter: last ? last.bars : null,
						cardsWhileBusy,
						asideAtClick: switchState.asideAtClick,
						asideWhileBusy,
						oldDataKept: switchState.asideAtClick !== null && switchState.asideAtClick === asideWhileBusy,
						sampleCount: samples.length,
					};
				})()
			: { clicked: false, detail: windowClick };
		return {
			run: index + 1,
			ok: true,
			click,
			clickToCardsMs: Number(cards.ms.toFixed(1)),
			cardsMountedMs: perfAfterLoad.firstCardAt,
			clickToHeavyMs: heavy.timeout ? null : Number(heavy.ms.toFixed(1)),
			cards: cards.cards,
			heatmapCells: heavy.cells,
			load: perfAfterLoad,
			switch: { ...switchSummary, requests: switchRequests },
			consoleErrors,
		};
	} finally {
		cdp.close();
		await httpJson(`/json/close/${target.id}`).catch(() => null);
	}
}

/* ------------------------------------------------------------------- main */

const results = [];
const failures = [];
for (let index = 0; index < runs; index += 1) {
	try {
		results.push(await runOnce(index));
	} catch (error) {
		failures.push({ run: index + 1, error: String(error?.message ?? error) });
	}
	await sleep(300);
}

const median = (values) => {
	const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
};

const ok = results.filter((result) => result.ok);
const summary = {
	runs: ok.length,
	failed: failures.length,
	cardsMountedMs: median(ok.map((result) => result.cardsMountedMs)),
	clickToCardsMs: median(ok.map((result) => result.clickToCardsMs)),
	clickToHeavyMs: median(ok.map((result) => result.clickToHeavyMs)),
	requestStartDeltaMs: median(ok.map((result) => result.load.startDeltaMs)),
	longTasksOver50: median(ok.map((result) => result.load.panelLongtasks.filter((entry) => entry.duration > 50).length)),
	maxLongTaskMs: median(ok.map((result) => Math.max(0, ...result.load.panelLongtasks.map((entry) => entry.duration)))),
	totalShift: median(ok.map((result) => result.load.shifts.reduce((sum, entry) => sum + entry.value, 0))),
	switchProgressAppearMs: median(ok.map((result) => result.switch.progressAppearMs)),
	switchProgressDisappearMs: median(ok.map((result) => result.switch.progressDisappearMs)),
	switchBarsWhileBusy: median(ok.map((result) => result.switch.barsWhileBusy)),
	switchBarsAfter: median(ok.map((result) => result.switch.barsAfter)),
	switchOldDataKept: ok.every((result) => result.switch.oldDataKept === true),
	consoleErrors: ok.reduce((sum, result) => sum + result.consoleErrors.length, 0),
};

const report = { endpoint: CDP_BASE, url: DSH_URL.replace(/token=[^&]+/, "token=<redacted>"), runs, summary, results, failures };
if (asJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log("");
	console.log("[perf-browser] summary (median of " + ok.length + " runs)");
	for (const [key, value] of Object.entries(summary)) console.log(`  ${key.padEnd(28)} ${value}`);
	console.log("");
	for (const result of results) {
		console.log(
			`  run ${result.run}: skeleton ${result.cardsMountedMs} ms · cards+data ${result.clickToCardsMs} ms · heavy ${result.clickToHeavyMs} ms · startΔ ${result.load.startDeltaMs} ms · switch bar ${result.switch.progressAppearMs}→${result.switch.progressDisappearMs} ms`,
		);
	}
	for (const failure of failures) console.log(`  run ${failure.run} FAILED: ${failure.error}`);
	console.log("");
}

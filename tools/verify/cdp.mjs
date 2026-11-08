#!/usr/bin/env node
/**
 * cdp.mjs — zero-dependency Chrome DevTools Protocol CLI for acceptance runs.
 *
 * Why this exists: the built-in browser_* tools fail against the Edge instance
 * used for panel verification ("DevTools socket closed"). This script talks to
 * the CDP HTTP endpoint + page WebSocket directly using Node's built-in global
 * `WebSocket` (Node >= 22). No npm packages, no Playwright, no puppeteer.
 *
 * Usage (from the repo root):
 *
 *   node tools/verify/cdp.mjs ping
 *       List page targets and the browser version. Proves the endpoint is alive.
 *
 *   node tools/verify/cdp.mjs open <url> [--settle <ms>] [--width <w>] [--height <h>]
 *                                  [--dark] [--mock "<path>=<file|json>"] [--mock-status <n>]
 *       Reuse the page whose origin matches <url>, otherwise create a new tab
 *       (PUT /json/new). Navigates, waits for Page.loadEventFired plus a settle
 *       delay, and starts recording console/exception/network events into
 *       `_notes/verify/.cdp/console-<targetId>.jsonl`.
 *       First run:  open "http://127.0.0.1:2820/?token=..."   (writes 30d cookie)
 *       Then:       open "http://127.0.0.1:2820/"
 *       `--dark` emulates prefers-color-scheme:dark *before* navigation so DSH's
 *       own boot script sets body[data-ds-dark-theme] (real dark theme).
 *       `--mock "session-stats/api/heavy=fixture.json"` fulfils matching requests
 *       from a local fixture inside this CDP session (Fetch domain), which is how
 *       the new client is exercised against /heavy while the host process still
 *       runs the old bundle. `--mock-status 500` injects an error response.
 *
 *   node tools/verify/cdp.mjs eval <js> [--await] [--json]
 *       Runtime.evaluate by value. Wrap in an async IIFE + pass --await to use
 *       awaits inside the expression. `--await` also treats a returned Promise
 *       as awaitable. Output is JSON (pretty unless --json).
 *
 *   node tools/verify/cdp.mjs click-text <text> [--index <n>] [--role <tag>]
 *       Find a *visible* element whose innerText contains <text>, score it
 *       (exact text > button/link > role=button > aria-label > leaf node),
 *       scroll it into view and click it. Prints what was clicked.
 *
 *   node tools/verify/cdp.mjs shot <path.png> [--full] [--scale <n>]
 *                                  [--width <w>] [--height <h>] [--dark]
 *                                  [--clip "x,y,w,h"] [--redact "<css selectors>"]
 *                                  [--hide "<css selectors>"] [--collapse]
 *       Page.captureScreenshot. `--full` uses Page.getLayoutMetrics'
 *       cssContentSize as the clip and captureBeyondViewport:true. Viewport and
 *       dark-scheme emulation are per DevTools session, so both are re-asserted
 *       inside this call before the capture.
 *
 *   node tools/verify/cdp.mjs console [--clear] [--json]
 *       Print the console/exception/network-error entries captured since the
 *       last `open` for this target. These are real CDP events, not guesses.
 *
 *   node tools/verify/cdp.mjs perf [--all] [--json]
 *       Read performance.getEntriesByType('resource') in the page, keep the
 *       entries whose URL contains "session-stats", and report duration /
 *       transferSize / encodedBodySize / decodedBodySize / start time.
 *       `--all` also lists non-session-stats resources.
 *
 *   node tools/verify/cdp.mjs api <path> [--json]
 *       In-page fetch(path) timed with performance.now(): status, ms, bytes,
 *       content-length. Uses the page's cookies/origin (auth safe), cache:
 *       'no-store'. Handy for warm/cold comparisons of the overview endpoint.
 *
 *   node tools/verify/cdp.mjs viewport <width> <height>
 *       Emulation.setDeviceMetricsOverride (scale 1, mobile false).
 *
 *   node tools/verify/cdp.mjs open-panel [--text 会话统计] [--until <js>]
 *                                    [--timeout <ms>] [--shot <path>]
 *                                    [--width <w>] [--height <h>] [--dark]
 *                                    [--mock "<path>=<file|json>"]
 *       Acceptance measurement helper: starts resource+DOM observers, clicks
 *       the sidebar button whose text is --text, and waits until --until (a JS
 *       expression) is truthy. Reports: click->element ms, first session-stats
 *       request ms, all session-stats requests, console errors. Optionally
 *       screenshots at that moment.
 *
 * Global flags: --target <targetId> (override page selection), --settle <ms>.
 * Env: CDP_ENDPOINT (default http://127.0.0.1:9222).
 *
 * Exit codes: 0 ok, 1 error, 2 unreachable endpoint, 3 click/eval target miss.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const STATE_DIR = path.join(REPO_ROOT, "_notes", "verify", ".cdp");
const CDP_BASE = (process.env.CDP_ENDPOINT || "http://127.0.0.1:9222").replace(/\/+$/, "");
const DEFAULT_HOST_HINT = "127.0.0.1:2820";

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
	const positional = [];
	const flags = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (!a.startsWith("--")) {
			positional.push(a);
			continue;
		}
		const eq = a.indexOf("=");
		if (eq !== -1) {
			flags.set(a.slice(2, eq), a.slice(eq + 1));
			continue;
		}
		const name = a.slice(2);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags.set(name, next);
			i += 1;
		} else {
			flags.set(name, true);
		}
	}
	return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0];

function flag(name, fallback = undefined) {
	return flags.has(name) ? flags.get(name) : fallback;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ http */

async function httpJson(route, method = "GET") {
	const res = await fetch(`${CDP_BASE}${route}`, { method, headers: { Accept: "application/json" } });
	const text = await res.text();
	if (!res.ok) throw new Error(`CDP ${method} ${route} -> ${res.status} ${text.slice(0, 200)}`);
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function listTargets() {
	const targets = await httpJson("/json/list");
	return Array.isArray(targets) ? targets : [];
}

function pageTargets(targets) {
	return targets.filter((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
}

function pickPage(targets, hint) {
	const pages = pageTargets(targets);
	const forced = flag("target");
	if (forced) {
		const found = pages.find((t) => t.id === forced);
		if (!found) throw new Error(`no page target with id ${forced}`);
		return found;
	}
	const wanted = hint || DEFAULT_HOST_HINT;
	return pages.find((t) => t.url.includes(wanted)) ?? null;
}

/* ------------------------------------------------------------- websocket */

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 0;
		this.pending = new Map();
		this.listeners = new Set();
		this.closed = false;
		ws.addEventListener("message", (ev) => this.#dispatch(ev.data));
		ws.addEventListener("close", () => {
			this.closed = true;
			for (const [, entry] of this.pending) entry.reject(new Error("CDP socket closed"));
			this.pending.clear();
		});
		ws.addEventListener("error", () => {
			this.closed = true;
		});
	}

	static async connect(wsUrl) {
		const ws = new WebSocket(wsUrl);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`WebSocket open timeout: ${wsUrl}`)), 8000);
			ws.addEventListener(
				"open",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			ws.addEventListener(
				"error",
				() => {
					clearTimeout(timer);
					reject(new Error(`WebSocket error connecting ${wsUrl}`));
				},
				{ once: true },
			);
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
		if (msg.id) {
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
				/* listener errors never break the client */
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
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	on(fn) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	close() {
		try {
			this.ws.close();
		} catch {
			/* already closed */
		}
	}
}

async function waitEvent(cdp, method, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		const off = cdp.on((msg) => {
			if (msg.method !== method) return;
			off();
			clearTimeout(timer);
			resolve(msg.params);
		});
		const timer = setTimeout(() => {
			off();
			reject(new Error(`timeout waiting for ${method}`));
		}, timeoutMs);
	});
}

/* -------------------------------------------------------------- console */

function consoleLogPath(targetId) {
	return path.join(STATE_DIR, `console-${targetId}.jsonl`);
}

function lastTargetPath() {
	return path.join(STATE_DIR, "last-target.json");
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function writeLastTarget(info) {
	ensureDir(STATE_DIR);
	fs.writeFileSync(lastTargetPath(), JSON.stringify(info, null, 2));
}

function readLastTarget() {
	try {
		return JSON.parse(fs.readFileSync(lastTargetPath(), "utf8"));
	} catch {
		return null;
	}
}

function resetConsoleLog(targetId) {
	ensureDir(STATE_DIR);
	fs.writeFileSync(consoleLogPath(targetId), "");
}

function appendConsole(targetId, record) {
	try {
		ensureDir(STATE_DIR);
		fs.appendFileSync(consoleLogPath(targetId), `${JSON.stringify(record)}\n`);
	} catch {
		/* logging must never break a verification run */
	}
}

function readConsoleLog(targetId) {
	try {
		return fs
			.readFileSync(consoleLogPath(targetId), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return { kind: "parse-error", raw: line };
				}
			});
	} catch {
		return [];
	}
}

function describeRemoteObject(obj) {
	if (!obj) return "";
	if (obj.type === "string") return obj.value ?? "";
	if (obj.unserializableValue !== undefined) return String(obj.unserializableValue);
	if (obj.value !== undefined) return typeof obj.value === "string" ? obj.value : JSON.stringify(obj.value);
	if (obj.preview?.properties) {
		return obj.preview.properties.map((p) => `${p.name}: ${p.value}`).join(" ");
	}
	return obj.description ?? obj.className ?? obj.type ?? "";
}

function applyConsoleListeners(cdp, targetId, onEntry) {
	const emit = (record) => {
		const enriched = { ...record, ts: Date.now(), at: new Date().toISOString() };
		appendConsole(targetId, enriched);
		if (onEntry) onEntry(enriched);
	};
	cdp.on((msg) => {
		if (msg.method === "Runtime.consoleAPICalled") {
			const p = msg.params;
			emit({
				kind: "console",
				level: p.type,
				text: (p.args ?? []).map(describeRemoteObject).join(" "),
				url: p.stackTrace?.callFrames?.[0]?.url ?? "",
				line: p.stackTrace?.callFrames?.[0]?.lineNumber ?? null,
			});
			return;
		}
		if (msg.method === "Runtime.exceptionThrown") {
			const d = msg.params.exceptionDetails;
			emit({
				kind: "exception",
				level: "error",
				text: d.exception?.description ?? d.text ?? "exception",
				url: d.url ?? "",
				line: d.lineNumber ?? null,
			});
			return;
		}
		if (msg.method === "Log.entryAdded") {
			const e = msg.params.entry;
			emit({
				kind: "log",
				level: e.level,
				text: e.text ?? "",
				url: e.url ?? "",
				line: (e.lineNumber ?? 0) + 1 || null,
			});
			return;
		}
		if (msg.method === "Network.loadingFailed") {
			const p = msg.params;
			emit({
				kind: "network",
				level: "error",
				text: `loadingFailed ${p.errorText} (${p.type})${p.canceled ? " canceled" : ""}`,
				url: "",
				requestId: p.requestId,
			});
			return;
		}
		if (msg.method === "Network.responseReceived") {
			const r = msg.params.response;
			if (!r.url.includes("session-stats")) return;
			emit({
				kind: "network",
				level: r.status >= 400 ? "error" : "info",
				text: `${r.status} ${r.url}`,
				url: r.url,
			});
		}
	});
}

/* --------------------------------------------------------------- helpers */

async function connectPage({ hint, allowCreate = false, openUrl = null } = {}) {
	let targets;
	try {
		targets = await listTargets();
	} catch (err) {
		console.error(`cannot reach CDP at ${CDP_BASE}: ${err.message}`);
		process.exit(2);
	}
	let page = pickPage(targets, hint);
	if (!page && allowCreate) {
		const created = await httpJson(`/json/new?${encodeURIComponent(openUrl || "about:blank")}`, "PUT");
		page = created && created.webSocketDebuggerUrl ? created : (await listTargets()).at(-1);
	}
	if (!page) {
		console.error("no matching page target; run `open <url>` first or pass --target");
		process.exit(2);
	}
	const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
	return { cdp, page };
}

async function evaluate(cdp, expression, { awaitPromise = false, returnByValue = true } = {}) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise,
		returnByValue,
		userGesture: true,
		includeCommandLineAPI: true,
	});
	if (result.exceptionDetails) {
		const d = result.exceptionDetails;
		throw new Error(d.exception?.description ?? d.text ?? "evaluation failed");
	}
	return result.result?.value;
}

async function pageReadyState(cdp) {
	try {
		return await evaluate(cdp, "document.readyState");
	} catch {
		return "unknown";
	}
}

async function waitNetworkQuiet(cdp, { quietMs = 400, timeoutMs = 15000, match = "session-stats" } = {}) {
	// Waits until no matching request is in flight for `quietMs` (or timeout),
	// tracked through Network events. This is what makes "render settled" honest.
	const inflight = new Set();
	let lastChange = Date.now();
	const off = cdp.on((msg) => {
		if (msg.method === "Network.requestWillBeSent") {
			if (!String(msg.params.request?.url || "").includes(match)) return;
			inflight.add(msg.params.requestId);
			lastChange = Date.now();
		} else if (msg.method === "Network.loadingFinished" || msg.method === "Network.loadingFailed") {
			if (inflight.delete(msg.params.requestId)) lastChange = Date.now();
		}
	});
	const started = Date.now();
	try {
		while (Date.now() - started < timeoutMs) {
			if (inflight.size === 0 && Date.now() - lastChange >= quietMs) return { idle: true, waitedMs: Date.now() - started };
			await sleep(60);
		}
		return { idle: inflight.size === 0, waitedMs: Date.now() - started, inflight: inflight.size };
	} finally {
		off();
	}
}


async function applyViewport(cdp, width, height, scale = 1, mobile = false) {
	// CDP emulation overrides are scoped to the DevTools session, so every CLI
	// invocation that cares about layout must re-assert them in its own socket.
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: scale,
		mobile,
	});
}


/**
 * Emulate a dark colour scheme *before* navigation so DSH's own boot script
 * (`matchMedia('(prefers-color-scheme: dark)')` -> `body[data-ds-dark-theme]`)
 * renders the real dark theme. This is the app's own code path, not a filter.
 */
async function applyColorScheme(cdp, dark) {
	await cdp.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }],
	});
}


/**
 * Fulfil matching HTTP requests with a local fixture, entirely inside this CDP
 * session. Used to exercise the new client against `/session-stats/api/heavy`
 * before the host process is restarted (Fetch domain, request stage).
 *
 *   --mock "/session-stats/api/heavy=path/to/fixture.json"
 *   --mock "/session-stats/api/heavy={\"ok\":true,...}"   (inline JSON)
 *   --mock-status 500                                     (error-path fixture)
 */
async function installMocks(cdp) {
	const specs = ["mock", "mock2", "mock3"]
		.map((key) => flag(key))
		.filter((value) => value !== undefined && value !== null && value !== true);
	if (specs.length === 0) return [];
	const handlers = [];
	for (let index = 0; index < specs.length; index += 1) {
		const spec = specs[index];
		const eq = String(spec).indexOf("=");
		const pattern = eq === -1 ? String(spec) : String(spec).slice(0, eq);
		const source = eq === -1 ? "" : String(spec).slice(eq + 1);
		let body = source;
		if (source && fs.existsSync(source)) body = fs.readFileSync(source, "utf8");
		// `--mock-status` applies to every mock; `--mock2-status` overrides mock2, etc.
		const key = ["mock", "mock2", "mock3"][index];
		const status = Number(flag(`${key}-status`, flag("mock-status", 200)));
		handlers.push({ pattern, status, bytes: Buffer.byteLength(body), hits: [], body });
	}
	if (handlers.length === 0) return [];
	// One Fetch.enable with every pattern: a second call would REPLACE the list.
	await cdp.send("Fetch.enable", {
		patterns: handlers.map((handler) => ({ urlPattern: `*${handler.pattern}*`, requestStage: "Request" })),
	});
	cdp.on((msg) => {
		if (msg.method !== "Fetch.requestPaused") return;
		const url = String(msg.params.request?.url ?? "");
		const handler = handlers.find((entry) => url.includes(entry.pattern));
		if (!handler) {
			cdp.send("Fetch.continueRequest", { requestId: msg.params.requestId }).catch(() => null);
			return;
		}
		handler.hits.push(url);
		cdp.send("Fetch.fulfillRequest", {
			requestId: msg.params.requestId,
			responseCode: handler.status,
			responseHeaders: [
				{ name: "content-type", value: "application/json; charset=utf-8" },
				{ name: "cache-control", value: "no-store" },
			],
			body: Buffer.from(handler.body).toString("base64"),
		}).catch(() => null);
	});
	return handlers.map(({ body, ...rest }) => rest);
}

/**
 * Collapse the application sidebar (270 px) to its icon rail so workspace names
 * and session titles stay out of README screenshots. The whale icon stays
 * visible. No-op when the sidebar is already collapsed.
 */
async function collapseSidebar(cdp) {
	const result = await evaluate(
		cdp,
		`(() => {
			const buttons = [...document.querySelectorAll('button,[role="button"]')];
			const collapse = buttons.find((b) => /收起侧边栏/.test(b.getAttribute("aria-label") || ""));
			if (!collapse) return { ok: true, alreadyCollapsed: true };
			collapse.click();
			return { ok: true, clicked: "收起侧边栏" };
		})()`,
	).catch(() => ({ ok: false }));
	await sleep(450);
	const measured = await evaluate(
		cdp,
		"(() => { const root = document.querySelector('.ssp-root'); const main = root ? root.getBoundingClientRect() : null; return { rootLeft: main ? Math.round(main.left) : null, innerWidth: window.innerWidth }; })()",
	).catch(() => null);
	return { ...result, ...measured };
}


/**
 * The stats panel scrolls inside `.ssp-root`, not on the document, so
 * captureBeyondViewport alone only grabs one screen. Flatten the overflow/height
 * constraints up the ancestor chain, remembering the original inline styles so
 * they can be restored after the screenshot (no page reload needed).
 */
async function expandPanel(cdp, selector) {
	const script = `(() => {
		const target = document.querySelector(${JSON.stringify(selector)});
		if (!target) return { ok: false, reason: "selector-not-found", selector: ${JSON.stringify(selector)} };
		const saved = [];
		const touch = (el) => {
			saved.push({ el, style: el.getAttribute("style") });
			el.style.overflow = "visible";
			el.style.height = "auto";
			el.style.maxHeight = "none";
		};
		let el = target;
		while (el && el !== document.documentElement) {
			touch(el);
			el = el.parentElement;
		}
		touch(document.body);
		touch(document.documentElement);
		window.__cdpFullPageRestore = saved;
		return {
			ok: true,
			touched: saved.length,
			scrollHeight: document.documentElement.scrollHeight,
			innerHeight: window.innerHeight,
		};
	})()`;
	return evaluate(cdp, script);
}

/** Restore whatever {@link expandPanel} touched. */
async function restorePanel(cdp) {
	const script = `(() => {
		const saved = window.__cdpFullPageRestore ?? [];
		for (const entry of saved) {
			if (entry.style === null) entry.el.removeAttribute("style");
			else entry.el.setAttribute("style", entry.style);
		}
		window.__cdpFullPageRestore = null;
		return saved.length;
	})()`;
	return evaluate(cdp, script).catch(() => 0);
}


/**
 * Browser "Failed to load resource: net::ERR_*" entries arrive through
 * Log.entryAdded with level=error but are network aborts (e.g. a navigation
 * cancelling an in-flight fetch), not JavaScript errors. Acceptance counts them
 * separately so a reload can never look like a console failure.
 */
function isNetworkLoadNoise(entry) {
	if (entry.kind !== "log") return false;
	const text = String(entry.text ?? "");
	// Transport-level failures reported through the Log domain: cancelled resource
	// loads and WebSocket drops caused by navigation / BFCache. They are not
	// JavaScript exceptions and must not be counted as console errors.
	return /^Failed to load resource/i.test(text) || /^WebSocket connection to .* failed/i.test(text);
}


/**
 * Hide elements for the duration of one screenshot (desktop-pet overlays, toasts,
 * anything that must not appear in a README image). Mirrors the redaction style
 * tag: injected before capture, removed after.
 */
async function hideElements(cdp, selector) {
	const css = `${selector} { display: none !important; }`;
	await evaluate(
		cdp,
		`(() => { let tag = document.getElementById("__cdp_hide"); if (!tag) { tag = document.createElement("style"); tag.id = "__cdp_hide"; document.head.appendChild(tag); } tag.textContent = ${JSON.stringify(css)}; return true; })()`,
	).catch(() => null);
	await sleep(150);
}

async function unhideElements(cdp) {
	await evaluate(cdp, "(() => { const tag = document.getElementById('__cdp_hide'); if (tag) tag.remove(); return true; })()").catch(() => 0);
}


/** Force an explicit theme state so a previous capture can never leak into this one. */
async function applyTheme(cdp, dark) {
	await applyColorScheme(cdp, dark);
	await evaluate(
		cdp,
		dark
			? "document.documentElement.dataset.dsThemeSource='dark';document.body.setAttribute('data-ds-dark-theme','');true"
			: "document.documentElement.dataset.dsThemeSource='system';document.body.removeAttribute('data-ds-dark-theme');true",
	).catch(() => null);
	await sleep(250);
}

function printJson(value) {
	const json = JSON.stringify(value, null, flag("json") ? undefined : 2);
	console.log(json);
}

/* -------------------------------------------------------------- commands */

async function cmdPing() {
	const version = await httpJson("/json/version");
	const targets = await listTargets();
	const pages = pageTargets(targets).map((t) => ({ id: t.id, url: t.url, title: t.title }));
	printJson({
		ok: true,
		endpoint: CDP_BASE,
		browser: version.Browser,
		protocolVersion: version["Protocol-Version"],
		pageCount: pages.length,
		pages,
	});
}

async function cmdOpen() {
	const url = positional[1];
	if (!url) {
		console.error("usage: cdp.mjs open <url> [--settle ms] [--no-reload]");
		process.exit(1);
	}
	const parsed = new URL(url);
	const origin = parsed.origin;

	let targets = await listTargets();
	let page = pageTargets(targets).find((t) => {
		try {
			return new URL(t.url).origin === origin;
		} catch {
			return false;
		}
	});
	if (!page) {
		page = await httpJson(`/json/new?${encodeURIComponent("about:blank")}`, "PUT");
		if (!page?.webSocketDebuggerUrl) throw new Error("failed to create page target");
	}

	const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
	resetConsoleLog(page.id);
	writeLastTarget({ id: page.id, url, at: new Date().toISOString() });
	applyConsoleListeners(cdp, page.id);

	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Log.enable");
	await cdp.send("Network.enable");
	const mocks = await installMocks(cdp);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: Number(flag("width", 1366)),
		height: Number(flag("height", 900)),
		deviceScaleFactor: Number(flag("scale", 1)),
		mobile: false,
	});

	const settle = Number(flag("settle", 1200));
	const vw = Number(flag("width", 1366));
	const vh = Number(flag("height", 900));
	const applyMetrics = () => applyViewport(cdp, vw, vh, Number(flag("scale", 1)));
	await applyMetrics();
	const wantDark = Boolean(flag("dark"));
	if (wantDark) await applyColorScheme(cdp, true);
	const started = Date.now();
	const loadFired = waitEvent(cdp, "Page.loadEventFired", 25000).catch(() => null);
	await cdp.send("Page.navigate", { url }).catch(() => null);
	await loadFired;
	// Device metrics overrides do not always survive a navigation; re-assert them
	// so screenshots are taken at the requested CSS viewport.
	const current = await evaluate(cdp, "({ w: innerWidth, h: innerHeight })").catch(() => null);
	if (!current || Math.abs(current.w - vw) > 2 || Math.abs(current.h - vh) > 2) {
		await applyMetrics();
		await sleep(250);
	}
	await waitNetworkQuiet(cdp, { quietMs: 400, timeoutMs: 15000 }).catch(() => null);
	await sleep(settle);
	const loadedMs = Date.now() - started;

	const info = await evaluate(
		cdp,
		"({ url: location.href, title: document.title, ready: document.readyState, bodyLen: document.body ? document.body.innerText.length : 0, hasToken: location.search.includes('token=') })",
	).catch(() => null);
	const entries = readConsoleLog(page.id);
	const errors = entries.filter((e) => (e.level === "error" || e.kind === "exception") && !isNetworkLoadNoise(e));
	const networkFailures = entries.filter(isNetworkLoadNoise);
	const theme = await evaluate(
		cdp,
		"({ darkAttr: document.body.hasAttribute('data-ds-dark-theme'), source: document.documentElement.dataset.dsThemeSource ?? null, bg: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme })",
	).catch(() => null);
	let mockProbe = null;
	if (mocks.length > 0) {
		const probePath = String(mocks[0].pattern).startsWith("/") ? String(mocks[0].pattern) : `/${mocks[0].pattern}`;
		mockProbe = await evaluate(
			cdp,
			`fetch(${JSON.stringify(probePath)}, { cache: "no-store" }).then(async (r) => ({ status: r.status, chars: (await r.text()).length })).catch((e) => ({ error: String(e) }))`,
			{ awaitPromise: true },
		).catch(() => null);
	}
	printJson({
		ok: true,
		targetId: page.id,
		mocks: mocks.map((mock) => ({ pattern: mock.pattern, status: mock.status, bytes: mock.bytes, hits: mock.hits.length })),
		mockProbe,
		theme,
		navigated: url,
		page: info,
		loadedMs,
		consoleEntries: entries.length,
		consoleErrors: errors.length,
		networkFailures: networkFailures.length,
		errors: errors.slice(0, 10).map((e) => ({ kind: e.kind, text: String(e.text).slice(0, 300) })),
	});
	cdp.close();
}

async function cmdEval() {
	const expression = positional.slice(1).join(" ");
	if (!expression) {
		console.error('usage: cdp.mjs eval "<js>" [--await]');
		process.exit(1);
	}
	const { cdp } = await connectPage();
	try {
		const wrapped = flag("await") ? `(async () => (${expression}))()` : expression;
		const value = await evaluate(cdp, wrapped, { awaitPromise: Boolean(flag("await")) });
		printJson({ ok: true, value });
	} finally {
		cdp.close();
	}
}

const CLICK_TEXT_SCRIPT = (text, index, roleFilter) => `(() => {
	const needle = ${JSON.stringify(text)};
	const wantIndex = ${Number(index ?? 0)};
	const roleFilter = ${JSON.stringify(roleFilter || null)};
	const all = Array.from(document.querySelectorAll('button,[role="button"],a,input,label,div,span,li'));
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) return false;
		const s = getComputedStyle(el);
		if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
		if (r.bottom < -2000 || r.top > window.innerHeight + 2000) return false;
		return true;
	};
	const candidates = all.filter((el) => {
		if (roleFilter && !el.matches(roleFilter)) return false;
		if (!visible(el)) return false;
		const own = (el.innerText || el.value || '').trim();
		const aria = (el.getAttribute('aria-label') || '').trim();
		return own.includes(needle) || aria.includes(needle);
	});
	if (!candidates.length) return { ok: false, reason: 'no-visible-match', needle };
	const score = (el) => {
		const own = (el.innerText || '').trim();
		const aria = (el.getAttribute('aria-label') || '').trim();
		let s = 0;
		if (own === needle) s += 120;
		if (aria === needle) s += 110;
		if (aria.includes(needle)) s += 40;
		const tag = el.tagName.toLowerCase();
		if (tag === 'button' || tag === 'a') s += 60;
		if (el.getAttribute('role') === 'button') s += 45;
		s -= Math.min(40, (own.match(/\\n/g) || []).length * 3);
		s -= Math.min(30, el.children.length * 2);
		return s;
	};
	candidates.sort((a, b) => score(b) - score(a));
	const el = candidates[Math.min(wantIndex, candidates.length - 1)];
	el.scrollIntoView({ block: 'center', inline: 'center' });
	const rect = el.getBoundingClientRect();
	const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60);
	el.focus?.();
	el.click();
	return {
		ok: true,
		tag: el.tagName.toLowerCase(),
		className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
		label,
		rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
		candidates: candidates.length,
		allMatches: candidates.slice(0, 5).map((c) => ({ tag: c.tagName.toLowerCase(), text: (c.innerText || '').trim().slice(0, 40) })),
	};
})()`;

async function cmdClickText() {
	const text = positional.slice(1).join(" ");
	if (!text) {
		console.error('usage: cdp.mjs click-text "<visible text>" [--index n] [--role selector]');
		process.exit(1);
	}
	const { cdp } = await connectPage();
	try {
		const script = CLICK_TEXT_SCRIPT(text, flag("index", 0), flag("role"));
		const result = await evaluate(cdp, script);
		printJson(result);
		if (!result?.ok) process.exitCode = 3;
	} finally {
		cdp.close();
	}
}

async function cmdShot() {
	const out = positional[1];
	if (!out) {
		console.error("usage: cdp.mjs shot <path.png> [--full] [--scale n]");
		process.exit(1);
	}
	const abs = path.isAbsolute(out) ? out : path.resolve(process.cwd(), out);
	ensureDir(path.dirname(abs));
	const { cdp } = await connectPage();
	try {
		await cdp.send("Page.enable");
		await applyViewport(cdp, Number(flag("width", 1366)), Number(flag("height", 900)), Number(flag("scale", 1)));
		// Always set an explicit theme state: CDP emulation is session-scoped but the
		// `data-ds-dark-theme` attribute written by the previous capture persists.
		await applyTheme(cdp, Boolean(flag("dark")));
		await sleep(400);
		if (flag("collapse")) await collapseSidebar(cdp);
		if (flag("hide")) await hideElements(cdp, String(flag("hide")));
		// Privacy redaction for README screenshots: mask the given selectors so
		// conversation titles / prompts / paths are unrecoverable, layout intact.
		let redacted = false;
		if (flag("redact")) {
			const selectors = String(flag("redact"));
			const css = `${selectors} { color: transparent !important; text-shadow: 0 0 7px rgba(0, 0, 0, 0.55) !important; filter: blur(5px) !important; user-select: none !important; }`;
			await evaluate(
				cdp,
				`(() => { let tag = document.getElementById("__cdp_redact"); if (!tag) { tag = document.createElement("style"); tag.id = "__cdp_redact"; document.head.appendChild(tag); } tag.textContent = ${JSON.stringify(css)}; return true; })()`,
			).catch(() => null);
			redacted = true;
			await sleep(120);
		}
		const params = { format: "png", fromSurface: true, captureBeyondViewport: true };
		let clip = null;
		let expanded = null;
		if (flag("clip")) {
			// `--clip "x,y,w,h"` captures one region (CSS px) at the requested scale.
			const parts = String(flag("clip")).split(",").map((value) => Number(value.trim()));
			if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
				clip = { x: parts[0], y: parts[1], width: parts[2], height: parts[3], scale: Number(flag("scale", 2)) };
				params.clip = clip;
			}
		}
		if (flag("full") && !flag("clip")) {
			// Default: flatten the panel's inner scroll container so the whole page
			// is captured. `--expand-selector <css>` overrides, `--no-expand` skips.
			if (!flag("no-expand")) {
				const selector = String(flag("expand-selector", ".ssp-root"));
				expanded = await expandPanel(cdp, selector).catch(() => null);
				await sleep(350);
			}
			const metrics = await cdp.send("Page.getLayoutMetrics");
			const size = metrics.cssContentSize ?? metrics.contentSize;
			clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
			params.clip = clip;
		}
		const { data } = await cdp.send("Page.captureScreenshot", params, 60000);
		const buf = Buffer.from(data, "base64");
		fs.writeFileSync(abs, buf);
		if (expanded) await restorePanel(cdp).catch(() => 0);
		if (redacted) {
			await evaluate(cdp, "(() => { const tag = document.getElementById('__cdp_redact'); if (tag) tag.remove(); return true; })()").catch(() => 0);
		}
		if (flag("hide")) await unhideElements(cdp);
		printJson({
			ok: true,
			path: abs,
			bytes: buf.length,
			full: Boolean(flag("full")),
			clip,
			expanded,
			dark: Boolean(flag("dark")),
			theme: await evaluate(
				cdp,
				"(() => { const r = document.querySelector('.ssp-root'); const c = document.querySelector('.ssp-card'); return { darkAttr: document.body.hasAttribute('data-ds-dark-theme'), bodyBg: getComputedStyle(document.body).backgroundColor, rootBg: r ? getComputedStyle(r).backgroundColor : null, cardBg: c ? getComputedStyle(c).backgroundColor : null, text: r ? getComputedStyle(r).color : null }; })()",
			).catch(() => null),
			viewport: await evaluate(cdp, "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })").catch(() => null),
			scroll: await evaluate(cdp, "({ x: scrollX, y: scrollY, docH: document.documentElement.scrollHeight })").catch(() => null),
			layout: await evaluate(
				cdp,
				"({ scrollWidth: document.documentElement.scrollWidth, innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth + 1 })",
			).catch(() => null),
		});
	} finally {
		cdp.close();
	}
}

async function cmdConsole() {
	const forced = flag("target");
	const last = readLastTarget();
	const targetId = forced || last?.id;
	if (!targetId) {
		console.error("no recorded target; run `open <url>` first");
		process.exit(1);
	}
	const entries = readConsoleLog(targetId);
	const networkFailures = entries.filter(isNetworkLoadNoise);
	const errors = entries.filter((e) => (e.level === "error" || e.kind === "exception") && !isNetworkLoadNoise(e));
	const warnings = entries.filter((e) => e.level === "warning" || e.level === "warn");
	const summary = {
		ok: errors.length === 0,
		targetId,
		total: entries.length,
		errors: errors.length,
		networkFailures: networkFailures.length,
		warnings: warnings.length,
		byKind: entries.reduce((acc, e) => {
			acc[e.kind] = (acc[e.kind] ?? 0) + 1;
			return acc;
		}, {}),
		entries: entries.map((e) => ({ at: e.at, kind: e.kind, level: e.level, text: String(e.text).slice(0, 500) })),
	};
	if (flag("clear")) {
		resetConsoleLog(targetId);
		summary.cleared = true;
	}
	printJson(summary);
	if (errors.length > 0) process.exitCode = 0; // errors are data, not a CLI failure
}

async function cmdPerf() {
	const { cdp } = await connectPage();
	try {
		const script = `(() => {
			const entries = performance.getEntriesByType('resource').map((e) => ({
				name: e.name,
				initiatorType: e.initiatorType,
				startTime: Math.round(e.startTime * 10) / 10,
				duration: Math.round(e.duration * 10) / 10,
				ttfb: Math.round((e.responseStart - e.requestStart) * 10) / 10,
				transferSize: e.transferSize,
				encodedBodySize: e.encodedBodySize,
				decodedBodySize: e.decodedBodySize,
			}));
			const nav = performance.getEntriesByType('navigation')[0];
			return {
				now: Math.round(performance.now()),
				navigation: nav ? {
					domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
					loadEvent: Math.round(nav.loadEventEnd),
					responseEnd: Math.round(nav.responseEnd),
				} : null,
				entries,
			};
		})()`;
		const raw = await evaluate(cdp, script);
		const all = raw.entries ?? [];
		const filtered = all.filter((e) => e.name.includes("session-stats"));
		const rows = (flag("all") ? all : filtered).map((e) => ({
			url: e.name.replace(/^https?:\/\/[^/]+/, ""),
			start: e.startTime,
			ms: e.duration,
			ttfb: e.ttfb,
			transfer: e.transferSize,
			encoded: e.encodedBodySize,
			decoded: e.decodedBodySize,
		}));
		printJson({
			ok: true,
			pageNow: raw.now,
			navigation: raw.navigation,
			sessionStatsRequests: filtered.length,
			totalResourceRequests: all.length,
			rows,
			all: flag("all") ? all.length : undefined,
		});
	} finally {
		cdp.close();
	}
}

async function cmdApi() {
	const apiPath = positional[1];
	if (!apiPath) {
		console.error("usage: cdp.mjs api <path> [--json]");
		process.exit(1);
	}
	const { cdp } = await connectPage();
	try {
		const script = `(async () => {
			const url = ${JSON.stringify(apiPath)};
			const t0 = performance.now();
			const res = await fetch(url, { cache: 'no-store' });
			const text = await res.text();
			const t1 = performance.now();
			return {
				status: res.status,
				ms: Math.round((t1 - t0) * 10) / 10,
				bytes: new TextEncoder().encode(text).length,
				chars: text.length,
				contentLength: res.headers.get('content-length'),
				cacheControl: res.headers.get('cache-control'),
				contentType: res.headers.get('content-type'),
				head: text.slice(0, 160),
			};
		})()`;
		const result = await evaluate(cdp, script, { awaitPromise: true });
		printJson({ ok: true, path: apiPath, ...result });
	} finally {
		cdp.close();
	}
}

const OPEN_PANEL_SCRIPT = (text, until, timeoutMs) => `(async () => {
	const needle = ${JSON.stringify(text)};
	const untilExpr = ${JSON.stringify(until)};
	const timeout = ${Number(timeoutMs)};
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const t0 = performance.now();
	const resources = [];
	const seen = new Set();
	const record = () => {
		for (const e of performance.getEntriesByType('resource')) {
			if (!e.name.includes('session-stats') || seen.has(e.name + '|' + e.startTime)) continue;
			seen.add(e.name + '|' + e.startTime);
			resources.push({
				url: e.name.replace(/^https?:\\/\\/[^/]+/, ''),
				start: Math.round(e.startTime * 10) / 10,
				ms: Math.round(e.duration * 10) / 10,
				transfer: e.transferSize,
				encoded: e.encodedBodySize,
			});
		}
	};
	const po = new PerformanceObserver(record);
	try { po.observe({ type: 'resource', buffered: true }); } catch { record(); }
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) return false;
		const s = getComputedStyle(el);
		return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
	};
	const texts = Array.from(document.querySelectorAll('button,[role="button"],a'));
	const matches = texts.filter((el) => visible(el) && (el.innerText || el.getAttribute('aria-label') || '').includes(needle));
	const button = matches.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null;
	if (!button) return { ok: false, reason: 'panel-button-not-found', needle, candidates: matches.length };
	button.scrollIntoView({ block: 'center' });
	button.click();
	const tClick = performance.now();
	const isTest = (el) => {
		try { return Boolean(eval(untilExpr)); } catch { return false; }
	};
	let readyMs = null;
	while (performance.now() - tClick < timeout) {
		record();
		if (isTest()) { readyMs = performance.now() - tClick; break; }
		await sleep(30);
	}
	record();
	po.disconnect();
	const cards = document.querySelectorAll('[class*="ssp-card"]').length;
	const metrics = document.querySelectorAll('[class*="ssp-metric"], [class*="ssp-stat"]').length;
	const errors = [];
	return {
		ok: readyMs !== null,
		clicked: (button.innerText || button.getAttribute('aria-label') || '').trim().slice(0, 40),
		readyMs: readyMs === null ? null : Math.round(readyMs * 10) / 10,
		elapsedMs: Math.round((performance.now() - t0) * 10) / 10,
		cardNodes: cards,
		metricNodes: metrics,
		resources,
		bodyHead: document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300) : '',
	};
})()`;

async function cmdOpenPanel() {
	const text = String(flag("text", "会话统计"));
	const until = String(flag("until", "document.querySelectorAll('[class*=\"ssp-card\"]').length > 0"));
	const timeoutMs = Number(flag("timeout", 8000));
	const { cdp, page } = await connectPage();
	try {
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		const mocks = await installMocks(cdp);
		await applyViewport(cdp, Number(flag("width", 1366)), Number(flag("height", 900)), Number(flag("scale", 1)));
		await applyTheme(cdp, Boolean(flag("dark")));
		await sleep(250);
		let collapsed = null;
		if (flag("collapse")) collapsed = await collapseSidebar(cdp);
		if (flag("hide")) await hideElements(cdp, String(flag("hide")));
		const before = await evaluate(
			cdp,
			"({ hasPanel: Boolean(document.querySelector('[class*=\"ssp-root\"]')), url: location.href, title: document.title })",
		).catch(() => null);
		const result = await evaluate(cdp, OPEN_PANEL_SCRIPT(text, until, timeoutMs), { awaitPromise: true });
		// `--eval-after "<js>"` runs one expression in the same session (where the
		// mocks are still active) and reports its value as `after`.
		let after = null;
		if (flag("eval-after")) {
			after = await evaluate(cdp, String(flag("eval-after")), { awaitPromise: true }).catch((error) => ({
				__error: String(error?.message ?? error),
			}));
		}
		const entries = readConsoleLog(page.id);
		const errors = entries.filter((e) => (e.level === "error" || e.kind === "exception") && !isNetworkLoadNoise(e));
		const networkFailures = entries.filter(isNetworkLoadNoise);
		const payload = { ...result, before, collapsed, after, consoleErrors: errors.length, networkFailures: networkFailures.length };
		payload.mocks = mocks.map((mock) => ({ pattern: mock.pattern, status: mock.status, bytes: mock.bytes, hits: mock.hits.length }));
		payload.layout = await evaluate(
			cdp,
			"({ scrollWidth: document.documentElement.scrollWidth, innerWidth, docHeight: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth > innerWidth + 1 })",
		).catch(() => null);
		payload.theme = await evaluate(
			cdp,
			"(() => { const r = document.querySelector('.ssp-root'); const c = document.querySelector('.ssp-card'); return { darkAttr: document.body.hasAttribute('data-ds-dark-theme'), bodyBg: getComputedStyle(document.body).backgroundColor, rootBg: r ? getComputedStyle(r).backgroundColor : null, cardBg: c ? getComputedStyle(c).backgroundColor : null, text: r ? getComputedStyle(r).color : null }; })()",
		).catch(() => null);
		if (flag("shot")) {
			await sleep(250);
			payload.viewport = await evaluate(cdp, "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })").catch(() => null);
			const abs = path.isAbsolute(flag("shot")) ? flag("shot") : path.resolve(process.cwd(), flag("shot"));
			ensureDir(path.dirname(abs));
			const params = { format: "png", fromSurface: true, captureBeyondViewport: true };
			let expanded = null;
			if (flag("full")) {
				if (!flag("no-expand")) {
					expanded = await expandPanel(cdp, String(flag("expand-selector", ".ssp-root"))).catch(() => null);
					await sleep(350);
				}
				const m = await cdp.send("Page.getLayoutMetrics");
				const size = m.cssContentSize ?? m.contentSize;
				params.clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
			}
			const { data } = await cdp.send("Page.captureScreenshot", params, 60000);
			fs.writeFileSync(abs, Buffer.from(data, "base64"));
			if (expanded) await restorePanel(cdp).catch(() => 0);
			payload.shot = abs;
			payload.expanded = expanded;
		}
		printJson(payload);
		if (!result?.ok) process.exitCode = 3;
	} finally {
		cdp.close();
	}
}

async function cmdViewport() {
	const width = Number(positional[1]);
	const height = Number(positional[2]);
	if (!width || !height) {
		console.error("usage: cdp.mjs viewport <width> <height>");
		process.exit(1);
	}
	const { cdp } = await connectPage();
	try {
		await applyViewport(cdp, width, height, Number(flag("scale", 1)), Boolean(flag("mobile")));
		await sleep(300);
		const actual = await evaluate(cdp, "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
		printJson({ ok: true, requested: { width, height }, actual });
	} finally {
		cdp.close();
	}
}

/* ------------------------------------------------------------------ main */

const COMMANDS = {
	ping: cmdPing,
	open: cmdOpen,
	eval: cmdEval,
	"click-text": cmdClickText,
	shot: cmdShot,
	console: cmdConsole,
	perf: cmdPerf,
	api: cmdApi,
	"open-panel": cmdOpenPanel,
	viewport: cmdViewport,
};

async function main() {
	if (!command || command === "help" || command === "--help") {
		console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, ""));
		return;
	}
	const fn = COMMANDS[command];
	if (!fn) {
		console.error(`unknown command: ${command} (known: ${Object.keys(COMMANDS).join(", ")})`);
		process.exit(1);
	}
	const guard = setTimeout(() => {
		console.error("cdp.mjs: hard timeout after 120s");
		process.exit(1);
	}, 120000);
	guard.unref();
	try {
		await fn();
	} catch (err) {
		console.error(`cdp.mjs ${command} failed: ${err?.message ?? err}`);
		process.exitCode = 1;
	}
}

await main();

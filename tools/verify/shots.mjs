#!/usr/bin/env node
/**
 * shots.mjs — one command for the README screenshots (sanitized demo data).
 *
 * Output (default 1366x900 unless noted):
 *   panel-light.png     light theme, first screen (today bar visible)
 *   panel-dark.png      real dark theme, first screen
 *   panel-full.png      whole panel, light (heatmap + leaderboards + session list)
 *   panel-900.png       narrow layout at 900 px, whole panel
 *   icon-4x.png         sidebar whale icon at 4x (18 px slot legibility evidence)
 *
 * Privacy / determinism:
 *   - Both `/session-stats/api/overview` and `/session-stats/api/heavy` are served
 *     from sanitized fixtures (`demo-fixtures.mjs`): demo session titles / prompts /
 *     workspaces, provider prefixes renamed to demo-a..demo-h.
 *   - The application sidebar is collapsed to its icon rail, so no workspace name
 *     or chat title is in frame.
 *   - The desktop-pet overlay (`.dshwv-root`) is hidden for the capture.
 *
 * Every capture runs `open-panel` (mocks + viewport + collapse + hide) in one CDP
 * session, because CDP emulation is session-scoped and a second session would lose
 * the mocked endpoints. DSH is never restarted.
 *
 * Usage:
 *   node tools/verify/shots.mjs
 *   node tools/verify/shots.mjs --outdir _notes/verify/shots
 *   node tools/verify/shots.mjs --real        # real fixtures — NOT for public use
 *   node tools/verify/shots.mjs --no-full
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CDP = path.join(HERE, "cdp.mjs");

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

const url = String(flags.get("url") ?? "http://127.0.0.1:2820/");
const label = String(flags.get("text") ?? "肥鱼用量分析");
const outdir = path.resolve(REPO_ROOT, String(flags.get("outdir") ?? "_notes/verify/shots"));
const demoDir = path.resolve(REPO_ROOT, String(flags.get("demo") ?? "_notes/verify/fixtures"));
const timeoutMs = Number(flags.get("timeout") ?? 30000);
const width = Number(flags.get("width") ?? 1366);
const height = Number(flags.get("height") ?? 900);
const wantFull = !flags.get("no-full");
const useReal = Boolean(flags.get("real"));

const overviewFixture = path.join(demoDir, useReal ? "overview.7d.json" : "demo-overview.json");
const heavyFixture = path.join(demoDir, useReal ? "heavy.7d.json" : "demo-heavy.json");
for (const fixture of [overviewFixture, heavyFixture]) {
	if (!fs.existsSync(fixture)) {
		console.error(`missing fixture: ${fixture}`);
		console.error("run: node tools/verify/host-live.mjs --dump _notes/verify/fixtures && node tools/verify/demo-fixtures.mjs");
		process.exit(2);
	}
}
fs.mkdirSync(outdir, { recursive: true });

/**
 * Things that must never appear in a public README image:
 * - the desktop-pet overlay and its menu;
 * - the signed-in account avatar (a real DeepSeek profile picture).
 */
const PET_SELECTOR = ".dshwv-root,.dshwv-menu,.yHnPSG_avatar img";

const KPI_READY = `(() => {
	const values = [...document.querySelectorAll('.ssp-stat .ssp-value-num')];
	return values.length >= 4 && values.every((node) => {
		const text = (node.textContent || '').trim();
		return text !== '' && text !== '—';
	});
})()`;
const TODAY_READY = `document.querySelectorAll('.ssp-today-cell').length >= 4 && Boolean(document.querySelector('.ssp-forecast'))`;
// The live card is fetched from the real host and can take a few seconds when the
// old bundle is busy scanning; a capture before it lands leaves the card empty.
const LIVE_READY = `Boolean(document.querySelector('.ssp-live')) && document.querySelector('.ssp-live').innerText.includes('PID')`;
const READY = `(${KPI_READY}) && (${TODAY_READY}) && (${LIVE_READY})`;

function run(args, { allowFailure = false } = {}) {
	try {
		const stdout = execFileSync(process.execPath, [CDP, ...args], {
			encoding: "utf8",
			cwd: REPO_ROOT,
			maxBuffer: 32 * 1024 * 1024,
		});
		const start = stdout.indexOf("{");
		return start === -1 ? { raw: stdout } : JSON.parse(stdout.slice(start));
	} catch (error) {
		if (allowFailure) return { failed: true, stderr: String(error.stderr ?? error.message).slice(0, 2000) };
		throw new Error(`cdp.mjs ${args[0]} failed: ${String(error.stderr ?? error.message).slice(0, 1500)}`);
	}
}

/**
 * Capture one image through `open-panel`, so the mocks, viewport, sidebar
 * collapse, pet hiding and the screenshot all happen in a single CDP session.
 */
function capture({ file, viewportWidth = width, viewportHeight = height, dark = false, full = false }) {
	const target = path.join(outdir, file);
	const args = [
		"open-panel",
		"--text", label,
		"--until", READY,
		"--timeout", String(timeoutMs),
		"--width", String(viewportWidth),
		"--height", String(viewportHeight),
		"--collapse",
		"--hide", PET_SELECTOR,
		"--mock", `session-stats/api/overview=${overviewFixture}`,
		"--mock2", `session-stats/api/heavy=${heavyFixture}`,
		"--shot", target,
	];
	if (dark) args.push("--dark");
	if (full) args.push("--full", "--expand-selector", ".ssp-root");
	const result = run(args);
	return { name: file, result, target };
}

const report = {
	ok: false,
	sanitized: !useReal,
	fixtures: { overview: path.relative(REPO_ROOT, overviewFixture), heavy: path.relative(REPO_ROOT, heavyFixture) },
	files: [],
	consoleErrors: null,
	networkFailures: null,
};

run(["open", url, "--settle", "900", "--width", String(width), "--height", String(height), "--hide", PET_SELECTOR]);

const captures = [
	capture({ file: "panel-light.png" }),
	capture({ file: "panel-dark.png", dark: true }),
];
if (wantFull) {
	captures.push(capture({ file: "panel-full.png", full: true }));
	captures.push(capture({ file: "panel-900.png", viewportWidth: 900, viewportHeight: 900, full: true }));
}

// Icon zoom: measure the whale glyph and clip around it.
const iconInfo = run(
	[
		"eval",
		"(() => { const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('rect').length > 40); if (!svg) return null; const r = svg.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), rects: svg.querySelectorAll('rect').length }; })()",
		"--await",
	],
	{ allowFailure: true },
);
const icon = iconInfo?.value ?? null;
let iconCapture = null;
if (icon) {
	const pad = 7;
	const clip = `${icon.x - pad},${icon.y - pad},${icon.w + pad * 2},${icon.h + pad * 2}`;
	const zoomTarget = path.join(outdir, "icon-4x.png");
	captures.push({ name: "icon-4x.png", result: run(["shot", zoomTarget, "--clip", clip, "--scale", "4"]), target: zoomTarget });
	// 1:1 crop of the real 18 px sidebar slot (evidence for "is it legible at 18px").
	const actualPad = 4;
	const actualClip = `${icon.x - actualPad},${icon.y - actualPad},${icon.w + actualPad * 2},${icon.h + actualPad * 2}`;
	const actualTarget = path.join(outdir, "icon-18px.png");
	iconCapture = { name: "icon-18px.png", result: run(["shot", actualTarget, "--clip", actualClip, "--scale", "1"]), target: actualTarget };
	captures.push(iconCapture);
}

for (const entry of captures) {
	const result = entry.result ?? {};
	const size = fs.existsSync(entry.target) ? fs.statSync(entry.target).size : 0;
	report.files.push({
		name: entry.name,
		path: path.relative(REPO_ROOT, entry.target),
		bytes: size,
		ok: Boolean(result.ok),
		readyMs: result.readyMs ?? null,
		clicked: result.clicked ?? null,
		collapsed: result.collapsed ?? null,
		mocks: result.mocks ?? null,
		expanded: result.expanded ?? null,
		theme: result.theme ?? null,
		layout: result.layout ?? null,
		clip: result.clip ?? null,
	});
}

const consoleReport = run(["console"]);
report.consoleErrors = consoleReport.errors ?? null;
report.networkFailures = consoleReport.networkFailures ?? null;
report.icon = icon;
report.ok =
	report.consoleErrors === 0 &&
	report.files.every((file) => file.ok && file.bytes > 0) &&
	report.files.length === (wantFull ? 6 : 4);

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

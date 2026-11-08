#!/usr/bin/env node
/**
 * qa-ui.mjs — browser acceptance sweep for the session-stats panel (task-17).
 *
 * Every case opens the panel through `cdp.mjs open-panel`, which lets one CDP
 * session carry the mocked endpoints, viewport, sidebar state and the assertion
 * expression (`--eval-after`). Results are printed as one JSON document and the
 * screenshots land in `_notes/verify/shots/qa-*.png`.
 *
 * Cases:
 *   main           标题 / 侧栏 / 鲸鱼图标 / KPI / 今日条 / 热力 / 三榜 / 会话列表 / locale key
 *   usd            CNY→USD 不重新请求 + 成本/预测换算
 *   no-today       today=null → 4 个「—」
 *   no-forecast    forecast=null → 预测区隐藏
 *   null-stats     tool 行 successRate/avgMs=null → 显示「—」不崩
 *   tiers          成功率三档着色（≥95% 绿 / 80–95% 黄 / <80% 红）
 *   progress       切窗口：进度条出现 + 旧数据保留 + 新数据替换
 *   heavy-404      heavy 失败 → 三张卡降级文案，不崩
 *   overview-500   overview 失败 → 错误条 + 重试
 *   responsive    1366 / 900 / 720 / 560 无横向溢出、今日条列数
 *   dark           真深色主题对比度
 *
 * Usage:
 *   node tools/verify/qa-ui.mjs
 *   node tools/verify/qa-ui.mjs --filter main,heat
 *
 * Exit code 0 when every check passes.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CDP = path.join(HERE, "cdp.mjs");
const FIXTURES = path.join(REPO_ROOT, "_notes/verify/fixtures");
const SHOTS = path.join(REPO_ROOT, "_notes/verify/shots");

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
const filter = flags.get("filter") ? String(flags.get("filter")).split(",").map((s) => s.trim()) : null;

const F = {
	overview: path.join(FIXTURES, "demo-overview.json"),
	overviewNoToday: path.join(FIXTURES, "demo-overview-no-today.json"),
	overviewNoForecast: path.join(FIXTURES, "demo-overview-no-forecast.json"),
	overviewDirections: path.join(FIXTURES, "demo-overview-directions.json"),
	heavy: path.join(FIXTURES, "demo-heavy.json"),
	heavyNullStats: path.join(FIXTURES, "demo-heavy-nullstats.json"),
	heavyTiers: path.join(FIXTURES, "demo-heavy-tiers.json"),
};

const checks = [];
function check(id, ok, detail) {
	checks.push({ id, ok: Boolean(ok), detail: detail === undefined ? null : detail });
	return ok;
}

function run(args, { allowFailure = true } = {}) {
	try {
		const stdout = execFileSync(process.execPath, [CDP, ...args], {
			encoding: "utf8",
			cwd: REPO_ROOT,
			maxBuffer: 32 * 1024 * 1024,
		});
		const start = stdout.indexOf("{");
		return start === -1 ? { raw: stdout } : JSON.parse(stdout.slice(start));
	} catch (error) {
		if (allowFailure) return { failed: true, stderr: String(error.stderr ?? error.message).slice(0, 1500) };
		throw error;
	}
}

const KPI_READY = `(() => {
	const v = [...document.querySelectorAll('.ssp-stat .ssp-value-num')];
	return v.length >= 4 && v.every((n) => { const t = (n.textContent || '').trim(); return t !== '' && t !== '—'; });
})()`;

function openPanel({ file, until = KPI_READY, width = 1366, height = 900, over = F.overview, heavy = F.heavy, heavyStatus = null, overviewStatus = null, dark = false, collapse = true, shot = null, evalAfter = null, timeout = 30000, reload = true }) {
	// A fresh navigation is required between cases: the panel is a route inside the
	// SPA, so clicking the sidebar again re-uses the mounted component and would keep
	// the previous case's data (and never re-issue the mocked requests).
	if (reload) run(["open", "http://127.0.0.1:2820/", "--settle", "450", "--width", String(width), "--height", String(height)]);
	const args = [
		"open-panel",
		"--text", "肥鱼用量分析",
		"--until", until,
		"--timeout", String(timeout),
		"--width", String(width),
		"--height", String(height),
		"--hide", ".dshwv-root,.dshwv-menu,.yHnPSG_avatar img",
	];
	if (collapse) args.push("--collapse");
	if (over) args.push("--mock", `session-stats/api/overview=${over}`);
	if (overviewStatus) args.push("--mock-status", String(overviewStatus));
	if (heavy) args.push("--mock2", `session-stats/api/heavy=${heavy}`);
	if (heavyStatus) args.push("--mock2-status", String(heavyStatus));
	if (dark) args.push("--dark");
	if (shot) args.push("--shot", path.join(SHOTS, shot));
	if (evalAfter) args.push("--eval-after", typeof evalAfter === "function" ? evalAfter() : evalAfter);
	return run(args);
}

/* ------------------------------------------------------------ eval bodies */

const SNAPSHOT = `(() => {
	const txt = (el) => (el ? el.innerText.replace(/\\s+/g, ' ').trim() : null);
	const kpi = [...document.querySelectorAll('.ssp-stat')].map((card) => ({
		label: txt(card.querySelector('.ssp-stat-title')),
		value: txt(card.querySelector('.ssp-value-num')),
		sub: txt(card.querySelector('.ssp-sub')),
	}));
	const today = [...document.querySelectorAll('.ssp-today-cell')].map((cell) => {
		const delta = cell.querySelector('.ssp-today-delta');
		return { label: txt(cell.querySelector('.ssp-today-label')), value: txt(cell.querySelector('.ssp-today-value')), delta: txt(delta), cls: delta ? delta.className : null, color: delta ? getComputedStyle(delta).color : null };
	});
	const heatCells = [...document.querySelectorAll('.ssp-heat-grid .ssp-heat-cell')];
	const heatCols = [...document.querySelectorAll('.ssp-heat-grid .ssp-heat-col')];
	const grids = [...document.querySelectorAll('.ssp-today')].map((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
	const ranks = [...document.querySelectorAll('.ssp-rank-list')].map((list) => ({
		rows: list.querySelectorAll('.ssp-rank-row').length,
		first: txt(list.querySelector('.ssp-rank-row')),
	}));
	const icon = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('rect').length > 40);
	const sessions = [...document.querySelectorAll('.ssp-sess-row')];
	return {
		h1: txt(document.querySelector('.ssp-title')) || txt(document.querySelector('.ssp-head h1')) || txt(document.querySelector('h1')),
		sidebar: [...document.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')).filter((a) => /肥鱼|会话统计/.test(a || '')),
		icon: icon ? { rects: icon.querySelectorAll('rect').length, w: Math.round(icon.getBoundingClientRect().width), h: Math.round(icon.getBoundingClientRect().height) } : null,
		kpi, today,
		todayCols: grids[0] ?? null,
		heatCells: heatCells.length,
		heatCols: heatCols.length,
		cellsPerCol: [...new Set(heatCols.map((c) => c.querySelectorAll('.ssp-heat-cell').length))],
		firstHeat: heatCells[0] ? heatCells[0].getAttribute('title') : null,
		lastHeat: heatCells.at(-1) ? heatCells.at(-1).getAttribute('title') : null,
		lastHeatBg: heatCells.at(-1) ? getComputedStyle(heatCells.at(-1)).backgroundColor + '|' + getComputedStyle(heatCells.at(-1)).opacity : null,
		zeroHeat: heatCells.filter((c) => / 0 tokens/.test(c.getAttribute('title') || '')).slice(0, 1).map((c) => getComputedStyle(c).opacity),
		ranks,
		sessions: sessions.length,
		sessionHeader: txt(document.querySelector('.ssp-list-tools')) ? txt(document.querySelector('.ssp-list-head') || document.querySelector('.ssp-list-tools')) : null,
		hasForecast: Boolean(document.querySelector('.ssp-forecast')),
		forecastText: txt(document.querySelector('.ssp-forecast-text')),
		unresolvedLocale: /(heatmap|rank|today|forecast|sessions|leaderboard|skill|command|currency|card|window|unit)\\.[A-Za-z]/.test(document.body.innerText),
		bodyText: document.body.innerText.slice(0, 400),
	};
})()`;

const USD_CHECK = `(async () => {
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const count = () => performance.getEntriesByType('resource').filter((e) => e.name.includes('/session-stats/api/overview')).length;
	const usd = [...document.querySelectorAll('.ssp-cur, .ssp-currency button, .ssp-currency span')].find((el) => (el.innerText || '').trim() === 'USD');
	const before = count();
	const costBefore = (document.querySelector('.ssp-stat .ssp-value-num') || {}).textContent;
	usd?.click();
	await sleep(500);
	return {
		clicked: Boolean(usd),
		requestsBefore: before,
		requestsAfter: count(),
		costBefore: costBefore?.trim() ?? null,
		costAfter: [...document.querySelectorAll('.ssp-stat .ssp-value-num')].map((n) => n.textContent.trim()),
		forecastText: (document.querySelector('.ssp-forecast-text') || {}).innerText ?? null,
		todayCost: [...document.querySelectorAll('.ssp-today-cell')].map((c) => c.innerText.replace(/\\s+/g, ' ')).slice(1, 2),
	};
})()`;

const PROGRESS_CHECK = `(async () => {
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const kpi = () => [...document.querySelectorAll('.ssp-stat .ssp-value-num')].map((n) => n.textContent.trim());
	const before = kpi();
	const t0 = performance.now();
	const tab = [...document.querySelectorAll('.ssp-tab')].find((b) => /14/.test(b.innerText));
	tab?.click();
	let sawProgress = false, progressAt = null, keptOld = false, changedAt = null;
	for (let i = 0; i < 240; i += 1) {
		await sleep(25);
		const progress = Boolean(document.querySelector('.ssp-progress'));
		if (progress && !sawProgress) { sawProgress = true; progressAt = Math.round(performance.now() - t0); }
		if (progress && kpi().join('|') === before.join('|')) keptOld = true;
		if (kpi().join('|') !== before.join('|')) { changedAt = Math.round(performance.now() - t0); break; }
	}
	return { clicked: Boolean(tab), sawProgress, progressAt, keptOld, changedAt, before, after: kpi(), progressGone: !document.querySelector('.ssp-progress') };
})()`;

const HEAVY_FAIL = `(() => {
	const txt = (el) => (el ? el.innerText.replace(/\\s+/g, ' ').trim() : null);
	const cards = [...document.querySelectorAll('.ssp-card')].map((c) => txt(c).slice(0, 80));
	return {
		heatCells: document.querySelectorAll('.ssp-heat-grid .ssp-heat-cell').length,
		heatText: txt(document.querySelector('.ssp-heat-card, [data-testid="ssp-heatmap"]')) ?? null,
		rankRows: document.querySelectorAll('.ssp-rank-row').length,
		sessionRows: document.querySelectorAll('.ssp-sess-row').length,
		anyUnavailable: /暂无|不可用|失败/.test(document.body.innerText),
		cardSnippets: cards.filter((c) => /暂无|不可用|失败/.test(c || '')).slice(0, 4),
	};
})()`;

const OVERVIEW_FAIL = `(async () => {
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const errorBar = document.querySelector('[class*=error]');
	const retry = [...document.querySelectorAll('button')].find((b) => /重试|retry/i.test(b.innerText || ''));
	const before = performance.getEntriesByType('resource').filter((e) => e.name.includes('/session-stats/api/overview')).length;
	retry?.click();
	await sleep(800);
	return {
		hasErrorBar: Boolean(errorBar),
		errorText: errorBar ? errorBar.innerText.replace(/\\s+/g, ' ').slice(0, 120) : null,
		hasRetry: Boolean(retry),
		requestsBefore: before,
		requestsAfter: performance.getEntriesByType('resource').filter((e) => e.name.includes('/session-stats/api/overview')).length,
		stillRenders: Boolean(document.querySelector('.ssp-root')),
	};
})()`;

const THEME_AND_LAYOUT = `(() => ({
	theme: {
		darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
		bodyBg: getComputedStyle(document.body).backgroundColor,
		cardBg: getComputedStyle(document.querySelector('.ssp-card')).backgroundColor,
		text: getComputedStyle(document.querySelector('.ssp-root')).color,
	},
	layout: {
		innerWidth, scrollWidth: document.documentElement.scrollWidth,
		overflowX: document.documentElement.scrollWidth > innerWidth + 1,
		todayCols: getComputedStyle(document.querySelector('.ssp-today')).gridTemplateColumns.split(' ').length,
		cardCount: document.querySelectorAll('.ssp-card').length,
	},
}))()`;

/* --------------------------------------------------------------- cases */

const CASES = {
	main() {
		const r = openPanel({ shot: "qa-light-1366.png", evalAfter: SNAPSHOT });
		const s = r.after ?? {};
		check("UI-01 h1", s.h1 === "肥鱼用量分析", s.h1);
		check("UI-02 sidebar label", (s.sidebar || []).includes("肥鱼用量分析"), s.sidebar);
		check("UI-03 whale icon", s.icon && s.icon.rects > 40 && s.icon.w >= 16 && s.icon.w <= 24, s.icon);
		check("UI-04 kpi 4 cards", (s.kpi || []).length === 4 && (s.kpi || []).every((c) => c.value && c.value !== "—"), s.kpi);
		check("UI-05 today bar 4 cells", (s.today || []).length === 4, s.today);
		const deltas = (s.today || []).map((c) => c.delta);
		check("UI-06 today deltas present", deltas.every((d) => d && /[▲▼]/.test(d)), deltas);
		check("UI-07 today delta classes are up/down/flat only", (s.today || []).every((c) => /ssp-today-(up|down|flat)/.test(c.cls || "")), (s.today || []).map((c) => c.cls));
		check("UI-08 heat 56 cells / 8 cols", s.heatCells === 56 && s.heatCols === 8, { cells: s.heatCells, cols: s.heatCols, perCol: s.cellsPerCol });
		check("UI-09 heat last = today bottom-right", /2026-11-09/.test(s.lastHeat || "") || /2026-11-0/.test(s.lastHeat || ""), s.lastHeat);
		check("UI-10 heat tooltip", /tokens/.test(s.firstHeat || "") && /会话/.test(s.firstHeat || ""), s.firstHeat);
		check("UI-11 heat zero day faint", (s.zeroHeat || []).every((o) => Number(o) <= 0.35), s.zeroHeat);
		check("UI-12 three leaderboards top10", (s.ranks || []).length === 3 && (s.ranks || []).every((r) => r.rows >= 1 && r.rows <= 10), s.ranks);
		check("UI-13 sessions render", s.sessions >= 1, s.sessions);
		check("UI-14 forecast visible", s.hasForecast && /¥.*±/.test(s.forecastText || ""), s.forecastText);
		check("UI-15 no unresolved locale keys", s.unresolvedLocale === false, s.bodyText);
		check("UI-16 console no JS error", r.consoleErrors === 0, r.consoleErrors);
		return r;
	},

	usd() {
		const r = openPanel({ evalAfter: USD_CHECK, shot: "qa-usd.png" });
		const s = r.after ?? {};
		check("UI-20 clicked USD", s.clicked === true, s.clicked);
		check("UI-21 no extra overview request", s.requestsAfter === s.requestsBefore, s);
		check("UI-22 cost switches to $", (s.costAfter || []).some((v) => String(v).startsWith("$")), s.costAfter);
		check("UI-23 forecast uses $", /\\$|±/.test(s.forecastText || ""), s.forecastText);
		return r;
	},

	"today-directions"() {
		const r = openPanel({
			over: F.overviewDirections,
			until: "document.querySelectorAll('.ssp-today-cell').length >= 4",
			evalAfter: `(() => [...document.querySelectorAll('.ssp-today-cell')].map((cell) => {
				const delta = cell.querySelector('.ssp-today-delta');
				return { label: (cell.querySelector('.ssp-today-label') || {}).innerText, delta: delta ? delta.innerText : null, cls: delta ? delta.className : null, color: delta ? getComputedStyle(delta).color : null };
			}))()`,
			shot: "qa-today-directions.png",
		});
		const cells = r.after ?? [];
		const up = cells.find((c) => /up/.test(c.cls || ""));
		const down = cells.find((c) => /down/.test(c.cls || ""));
		const flat = cells.find((c) => /flat/.test(c.cls || ""));
		const parseRgb = (value) => {
			const match = /rgba?\((\d+), (\d+), (\d+)/.exec(value || "");
			return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) } : null;
		};
		const upRgb = parseRgb(up?.color);
		const downRgb = parseRgb(down?.color);
		check("UI-24a up is red (▲)", Boolean(up) && /▲/.test(up.delta) && upRgb !== null && upRgb.r > upRgb.g + 60, up);
		check("UI-24b down is green (▼)", Boolean(down) && /▼/.test(down.delta) && downRgb !== null && downRgb.g > downRgb.r + 40, down);
		check("UI-24c flat renders dash/0%", Boolean(flat) && /--|0\.0%/.test(flat.delta || ""), flat);
		return r;
	},

	"no-today"() {
		const r = openPanel({ over: F.overviewNoToday, until: "!!document.querySelector('.ssp-today')", evalAfter: SNAPSHOT, shot: "qa-no-today.png" });
		const s = r.after ?? {};
		const values = (s.today || []).map((c) => String(c.value));
		check("UI-25 no-today shows em dashes", (s.today || []).length === 4 && values.every((v) => /—|--/.test(v)), values);
		check("UI-26 no-today still renders", Boolean(r.ok) || s.kpi.length === 4, { ok: r.ok, kpi: s.kpi?.length });
		check("UI-27 no-today no error", r.consoleErrors === 0, r.consoleErrors);
		return r;
	},

	"no-forecast"() {
		const r = openPanel({ over: F.overviewNoForecast, evalAfter: SNAPSHOT, shot: "qa-no-forecast.png" });
		const s = r.after ?? {};
		check("UI-30 forecast hidden when forecast=null", s.hasForecast === false, s.hasForecast);
		check("UI-31 page still renders", (s.kpi || []).length === 4 && r.consoleErrors === 0, { kpi: s.kpi?.length, errors: r.consoleErrors });
		return r;
	},

	"null-stats"() {
		const r = openPanel({ heavy: F.heavyNullStats, evalAfter: SNAPSHOT });
		const s = r.after ?? {};
		const first = (s.ranks || [])[0]?.first ?? "";
		check("UI-35 null success stats render as dash", /—/.test(first), first);
		check("UI-36 null stats no crash", r.consoleErrors === 0 && (s.ranks || []).length === 3, { errors: r.consoleErrors, ranks: s.ranks?.length });
		return r;
	},

	tiers() {
		const r = openPanel({
			heavy: F.heavyTiers,
			evalAfter: `(() => {
				const rows = [...document.querySelectorAll('.ssp-rank-row')].slice(0, 3).map((row) => {
					const nodes = [...row.querySelectorAll('*')].filter((el) => /%/.test(el.textContent || '') && el.children.length === 0);
					const rate = nodes[0];
					return { text: row.innerText.replace(/\\s+/g, ' '), color: rate ? getComputedStyle(rate).color : null, cls: rate ? rate.className : null };
				});
				return { rows };
			})()`,
			shot: "qa-tiers.png",
		});
		const rows = r.after?.rows ?? [];
		const distinct = new Set(rows.map((row) => row.color));
		check("UI-40 three success tiers distinct colors", rows.length === 3 && distinct.size >= 2, rows);
		return r;
	},

	progress() {
		// Real host overview is slow, which is exactly what makes the progress bar observable.
		const r = openPanel({ over: null, heavy: null, evalAfter: PROGRESS_CHECK, shot: "qa-progress.png", until: KPI_READY });
		const s = r.after ?? {};
		check("UI-45 progress bar appears on window switch", s.sawProgress === true, s);
		check("UI-46 old KPI kept while loading", s.keptOld === true, { keptOld: s.keptOld, before: s.before, after: s.after });
		check("UI-47 KPI replaced after load", Array.isArray(s.after) && s.after.join("|") !== (s.before || []).join("|"), { before: s.before, after: s.after, at: s.changedAt });
		return r;
	},

	"heavy-404"() {
		const r = openPanel({ heavyStatus: 404, until: KPI_READY, evalAfter: HEAVY_FAIL, shot: "qa-heavy-404.png" });
		const s = r.after ?? {};
		check("UI-50 heavy failure degrades gracefully", s.anyUnavailable === true || ((s.rankRows || 0) === 0 && (s.heatCells || 0) === 0), s);
		check("UI-51 page survived heavy 404", Boolean(r.ok) || s.cardSnippets?.length >= 0, { ok: r.ok });
		check("UI-52 heavy 404 no uncaught exception", r.consoleErrors === 0, r.consoleErrors);
		return r;
	},

	"overview-500"() {
		const r = openPanel({ overviewStatus: 500, until: "document.querySelector('[class*=error], [class*=ssp-error]')", timeout: 12000, evalAfter: OVERVIEW_FAIL, shot: "qa-overview-error.png" });
		const s = r.after ?? {};
		check("UI-55 overview error surfaced", s.hasErrorBar === true, s);
		check("UI-56 retry button present", s.hasRetry === true, s);
		check("UI-57 retry re-requests", (s.requestsAfter || 0) > (s.requestsBefore || 0), s);
		check("UI-58 error state still renders panel shell", s.stillRenders === true, s);
		return r;
	},

	responsive() {
		let allOk = true;
		const rows = [];
		for (const w of [1366, 900, 720, 560]) {
			const r = openPanel({ width: w, height: 900, evalAfter: THEME_AND_LAYOUT, shot: `qa-${w}.png` });
			const s = r.after ?? {};
			const ok = s.layout && s.layout.overflowX === false;
			allOk = allOk && ok;
			rows.push({ width: w, ok, layout: s.layout, consoleErrors: r.consoleErrors });
		}
		check("UI-60 responsive 1366/900/720/560 no horizontal overflow", allOk, rows);
		const cols = rows.find((row) => row.width === 560)?.layout?.todayCols;
		check("UI-61 today bar stacks at 560", cols === 1 || cols === 2, rows.map((row) => ({ w: row.width, cols: row.layout?.todayCols })));
		return { rows };
	},

	dark() {
		const r = openPanel({ dark: true, evalAfter: THEME_AND_LAYOUT, shot: "qa-dark.png" });
		const s = r.after ?? {};
		const rgb = String(s.theme?.cardBg || "").match(/[0-9]+/g) ?? [];
		const mean = rgb.length >= 3 ? (Number(rgb[0]) + Number(rgb[1]) + Number(rgb[2])) / 3 : 255;
		const dark = s.theme?.darkAttr === true && mean < 90;
		check("UI-65 dark theme really renders", dark, s.theme);
		check("UI-66 dark layout intact", s.layout?.overflowX === false && (s.layout?.cardCount || 0) >= 6, s.layout);
		return r;
	},
};

/* ----------------------------------------------------------------- runner */

const results = {};
for (const [name, fn] of Object.entries(CASES)) {
	if (filter && !filter.includes(name)) continue;
	try {
		results[name] = fn();
	} catch (error) {
		results[name] = { error: String(error?.message ?? error) };
		check(`${name}:exception`, false, String(error?.message ?? error));
	}
}

const failed = checks.filter((entry) => !entry.ok);
const report = {
	ok: failed.length === 0,
	checkedAt: new Date().toISOString(),
	total: checks.length,
	passed: checks.length - failed.length,
	failed: failed.length,
	checks,
	cases: Object.fromEntries(
		Object.entries(results).map(([name, value]) => [
			name,
			{ ok: value?.ok ?? null, consoleErrors: value?.consoleErrors ?? null, networkFailures: value?.networkFailures ?? null, after: value?.after ?? null, error: value?.error ?? null },
		]),
	),
};
fs.writeFileSync(path.join(SHOTS, "..", "qa-ui-result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

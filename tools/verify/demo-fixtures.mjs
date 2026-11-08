#!/usr/bin/env node
/**
 * demo-fixtures.mjs — turn the real payload snapshots into *sanitized* demo
 * payloads used for public README screenshots.
 *
 * What is replaced (the only personally identifying parts):
 *   sessions[].id / title / lastPrompt / workspace / isArchived
 * What is kept (structure + aggregate numbers, no conversation text):
 *   overview: totals, daily, models, costs, palette, scan
 *   heavy:    heatmap, tool / command / skill leaderboards, session counters
 *
 * The script also runs a leak check afterwards: no original title/prompt/workspace
 * string may survive anywhere in the demo payload.
 *
 * Usage:
 *   node tools/verify/demo-fixtures.mjs
 *   node tools/verify/demo-fixtures.mjs --src _notes/verify/fixtures --out _notes/verify/fixtures
 *   node tools/verify/demo-fixtures.mjs --sessions 12   # cap the demo list length
 *
 * Inputs (produced by `host-live.mjs --dump`): heavy.7d.json / overview.7d.json
 * Outputs: demo-heavy.json / demo-overview.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

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

const srcDir = path.resolve(REPO_ROOT, String(flags.get("src") ?? "_notes/verify/fixtures"));
const outDir = path.resolve(REPO_ROOT, String(flags.get("out") ?? "_notes/verify/fixtures"));
const sessionCap = Number(flags.get("sessions") ?? 0) || 0;
// Upstream route/provider names (e.g. `opencode-go/...`, `workbuddy-subscription/...`)
// reveal which relays/subscriptions the machine uses, so they are renamed to
// `demo-a/...`, `demo-b/...` while the model name after the slash is kept.
const sanitizeModels = !flags.get("keep-models");
const PROVIDER_MAP = new Map();

const DEMO_TITLES = [
	"重构登录页表单校验",
	"修复 WebSocket 重连风暴",
	"优化首屏加载体积",
	"拆分订单服务接口",
	"排查 CI 偶发失败",
	"设计权限模型迁移",
	"补充端到端测试",
	"重构数据同步管道",
	"打磨设置页交互",
	"定位内存泄漏",
	"整理 API 错误码",
	"接入对象存储上传",
	"梳理发布流程",
	"优化查询慢日志",
	"统一错误提示文案",
	"补齐接口文档",
];

const DEMO_PROMPTS = [
	"把校验规则抽成共用的 schema，错误提示统一走 i18n。",
	"重连要加指数退避，断网恢复后只保留一条连接。",
	"先把首屏依赖拆开，路由级懒加载，别引第三方包。",
	"订单查询和写入拆成两个接口，老调用方要兼容。",
	"这个用例在 CI 上偶发失败，先看是不是时序问题。",
	"权限从角色改成资源级，迁移脚本要能回滚。",
	"关键路径补端到端用例，跑在本地就行。",
	"同步任务改成增量，失败要能续传。",
	"设置页开关切换时不要整页重渲染。",
	"堆内存一直在涨，怀疑是事件监听没解绑。",
	"把散落的错误码收敛到一处，前端按 code 处理。",
	"上传走预签名 URL，别让服务端转发大文件。",
];

const DEMO_WORKSPACES = ["demo-workspace", "demo-web-app", "demo-services"];

const heavyPath = path.join(srcDir, "heavy.7d.json");
const overviewPath = path.join(srcDir, "overview.7d.json");

if (!fs.existsSync(heavyPath)) {
	console.error(`missing ${heavyPath}; run: node tools/verify/host-live.mjs --dump _notes/verify/fixtures`);
	process.exit(2);
}

const heavy = JSON.parse(fs.readFileSync(heavyPath, "utf8"));
const overview = fs.existsSync(overviewPath) ? JSON.parse(fs.readFileSync(overviewPath, "utf8")) : null;

/** Every original string that must not survive into the demo payload. */
const leaks = [];
const collectLeaks = (sessions) => {
	for (const session of sessions) {
		for (const key of ["title", "lastPrompt", "workspace", "id"]) {
			const value = session?.[key];
			if (typeof value === "string" && value !== "") leaks.push(value);
		}
	}
};
collectLeaks(Array.isArray(heavy.sessions) ? heavy.sessions : []);

const sessions = (Array.isArray(heavy.sessions) ? heavy.sessions : []).map((session, index) => ({
	...session,
	id: `demo-session-${String(index + 1).padStart(3, "0")}`,
	title: DEMO_TITLES[index % DEMO_TITLES.length],
	lastPrompt: DEMO_PROMPTS[index % DEMO_PROMPTS.length],
	workspace: DEMO_WORKSPACES[index % DEMO_WORKSPACES.length],
	isArchived: index % 11 === 10,
}));

const demoHeavy = {
	...heavy,
	sessions: sessionCap > 0 ? sessions.slice(0, sessionCap) : sessions,
};
const demoOverview = overview ? { ...overview } : null;

// Tool success rate / average duration (3.1 UI). The running host has no
// `tool/result` pairing yet, so the demo payload supplies deterministic,
// plausible values: same tool name always yields the same numbers.
if (Array.isArray(demoHeavy.toolLeaderboard)) {
	const hashOf = (text) => {
		let hash = 2166136261;
		for (let i = 0; i < text.length; i += 1) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 16777619) >>> 0;
		}
		return hash;
	};
	demoHeavy.toolLeaderboard = demoHeavy.toolLeaderboard.map((row) => {
		if (row.errorCount !== undefined && row.successRate !== undefined && row.avgMs !== undefined) return row;
		const hash = hashOf(String(row.name ?? ""));
		const pairs = Math.max(1, Math.round((Number(row.count) || 1) * 0.97));
		const failShare = 0.004 + (hash % 60) / 1000; // 0.4% – 6.3%
		const errorCount = Math.min(pairs, Math.round(pairs * failShare));
		const successRate = Number(((pairs - errorCount) / pairs).toFixed(5));
		const avgMs = 60 + (hash % 2400); // 60 ms – ~2.5 s
		return { ...row, errorCount, successRate, avgMs };
	});
}

if (sanitizeModels && demoOverview) {
	// Build a stable provider -> demo-provider map from the payload itself.
	const providers = new Set();
	const collect = (models) => {
		if (!Array.isArray(models)) return;
		for (const model of models) {
			if (typeof model?.provider === "string" && model.provider !== "") providers.add(model.provider);
			if (typeof model?.route === "string" && model.route.includes("/")) providers.add(model.route.split("/")[0]);
		}
	};
	collect(demoOverview.models);
	for (const bucket of Array.isArray(demoOverview.daily) ? demoOverview.daily : []) collect(bucket.models);
	const providerList = [...providers].sort();
	let index = 0;
	for (const provider of providerList) {
		const letter = String.fromCharCode(97 + (index % 26));
		PROVIDER_MAP.set(provider, `demo-${letter}`);
		index += 1;
	}
	const rewrite = (value) => {
		if (typeof value === "string") {
			let next = value;
			for (const [real, demo] of PROVIDER_MAP) next = next.split(real).join(demo);
			return next;
		}
		if (Array.isArray(value)) return value.map(rewrite);
		if (value && typeof value === "object") {
			const out = {};
			for (const [key, entry] of Object.entries(value)) out[rewrite(key)] = rewrite(entry);
			return out;
		}
		return value;
	};
	const rewritten = rewrite(demoOverview);
	Object.keys(demoOverview).forEach((key) => delete demoOverview[key]);
	Object.assign(demoOverview, rewritten);
	demoOverview.modelProviders = { note: "provider names replaced with demo-a/demo-b for public screenshots", count: PROVIDER_MAP.size };
}

// Public README must show the P1 features (today-vs-yesterday bar, cost forecast
// tail). The running host is still the old bundle and never sends `today` /
// `yesterday` / `forecast`, so the demo overview supplies plausible demo values.
if (demoOverview) {
	if (demoOverview.today === undefined) {
		demoOverview.today = { tokens: 84100000, costCNY: 21.6, sessions: 3, cacheHitRate: 0.994 };
	}
	if (demoOverview.yesterday === undefined) {
		demoOverview.yesterday = { tokens: 76500000, costCNY: 19.4, sessions: 2, cacheHitRate: 0.991 };
	}
	if (demoOverview.forecast === undefined) {
		demoOverview.forecast = {
			slope: 2.4,
			intercept: 190,
			monthEndEstimate: 246,
			sigma: 18,
			dataPoints: 12,
			daysLeft: 21,
		};
	}
	demoOverview.demoData = true;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "demo-heavy.json"), `${JSON.stringify(demoHeavy, null, 2)}\n`);
if (demoOverview) fs.writeFileSync(path.join(outDir, "demo-overview.json"), `${JSON.stringify(demoOverview, null, 2)}\n`);

// Leak check: every original private string must be gone from the demo payload.
const demoText = JSON.stringify(demoHeavy) + (demoOverview ? JSON.stringify(demoOverview) : "");
const remaining = [...new Set(leaks)].filter((value) => value.length >= 4 && demoText.includes(value));

const report = {
	ok: remaining.length === 0,
	sourceHeavyBytes: fs.statSync(heavyPath).size,
	demoHeavyBytes: fs.statSync(path.join(outDir, "demo-heavy.json")).size,
	demoOverviewBytes: demoOverview ? fs.statSync(path.join(outDir, "demo-overview.json")).size : null,
	sessions: demoHeavy.sessions.length,
	replaced: ["id", "title", "lastPrompt", "workspace", "isArchived"].concat(sanitizeModels ? ["model provider/route prefixes"] : []),
	providerMap: Object.fromEntries(PROVIDER_MAP),
	leaks: remaining.slice(0, 10),
	outputs: [path.join(outDir, "demo-heavy.json"), demoOverview ? path.join(outDir, "demo-overview.json") : null].filter(Boolean),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

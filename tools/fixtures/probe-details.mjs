#!/usr/bin/env node
/**
 * Second-pass probes for the numbers the contract needs:
 *   - title coverage / last-title-wins / fallback title shapes
 *   - last user prompt extraction under `source.kind` filtering
 *   - token share by session origin (top-level vs subagent)
 *   - fork/resume `session/end-seed` and inherited-prefix double counting
 *   - shell-command leaderboard normalization
 *
 * Usage: node tools/fixtures/probe-details.mjs [--out path]
 * Zero dependencies, read-only.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { dirname, join } from "node:path";

const ROOT = "E:/Program Files/deepseekharness-webui/home/sessions";
const argv = process.argv.slice(2);
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "";

const logs = [];
for (const d of readdirSync(ROOT, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const w = join(ROOT, d.name);
  for (const e of readdirSync(w, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const f = join(w, e.name, "session.v4.jsonl.zstd");
    try {
      readFileSync(f);
      logs.push({ f, id: e.name });
    } catch {
      /* not materialized */
    }
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const textParts = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((p) => isObj(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text);
const stats = (nums) => {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
};

// Prompt source kinds that carry a human- or agent-authored instruction. Every
// other kind (runtime-context, time-context, progress-updates-nudge, ...) is a
// runtime injection and must never surface as "last prompt".
const PROMPT_KINDS = new Set(["user", "agent-message", "skill-invocation", "user-approval"]);

const r = {
  sessions: 0,
  titles: {
    sessionsWithAnyTitle: 0,
    sessionsWithoutAnyTitle: 0,
    missingSessionDetail: [],
    lastTitleKinds: {},
    lastTitleLength: null,
    fallbackSamples: [],
    providerSamples: [],
    titlesPerSession: null,
  },
  prompts: {
    byOrigin: {},
    lastAnySourceKinds: {},
    lastAnyLength: null,
    recommendedLength: null,
    recommendedMissing: 0,
    noisyExamples: [],
    recommendedSamples: [],
  },
  tokens: { total: 0, byOrigin: {}, sessionsByOrigin: {}, inheritedTokens: 0, inheritedEvents: 0 },
  forks: { seeded: 0, withInheritedMarker: 0, inheritedEventTotal: 0, totalEventTotal: 0, details: [] },
  shell: { calls: 0, programs: {}, normalizedPrograms: {}, distinctPrograms: 0 },
};

/** Strip leading env assignments and `cd ... &&` chains to approximate the real program. */
function programOf(command) {
  let cmd = String(command).trim();
  for (let guard = 0; guard < 4; guard += 1) {
    cmd = cmd.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, "");
    const cd = cmd.match(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|\|\||;)\s*/);
    if (cd) cmd = cmd.slice(cd[0].length);
    else break;
  }
  const first = cmd.split(/[\s;|&]+/)[0] ?? "";
  return first || "<empty>";
}

for (const log of logs) {
  let evs;
  try {
    evs = zstdDecompressSync(readFileSync(log.f)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    continue;
  }
  const header = evs[0]?.type === "session" ? evs[0] : null;
  if (!header) continue;
  const events = evs.slice(1);
  r.sessions += 1;
  const origin = header.origin === "subagent" ? "subagent" : "top-level";

  // ---- titles ----
  const titleEvents = events.filter((e) => e.type === "session/title" && typeof e.data?.title === "string" && e.data.title !== "");
  if (titleEvents.length > 0) {
    r.titles.sessionsWithAnyTitle += 1;
    const last = titleEvents[titleEvents.length - 1].data;
    const kind = String(last.source?.kind ?? "<none>");
    r.titles.lastTitleKinds[kind] = (r.titles.lastTitleKinds[kind] ?? 0) + 1;
    r.titles.lastTitleLength ??= [];
    r.titles.lastTitleLength.push(last.title.length);
    if (kind === "fallback" && r.titles.fallbackSamples.length < 4) r.titles.fallbackSamples.push(last.title);
    if (kind === "provider" && r.titles.providerSamples.length < 3) r.titles.providerSamples.push(last.title);
    r.titles.titlesPerSession ??= [];
    r.titles.titlesPerSession.push(titleEvents.length);
  } else {
    r.titles.sessionsWithoutAnyTitle += 1;
    if (r.titles.missingSessionDetail.length < 6) {
      r.titles.missingSessionDetail.push({ id: log.id, origin, events: events.length, firstTime: events[0]?.time ?? null });
    }
  }

  // ---- prompts ----
  const userMsgs = events.filter((e) => e.type === "user/message");
  const promptEvents = userMsgs.filter((e) => PROMPT_KINDS.has(String(e.data?.source?.kind ?? "")));
  const anyText = (e) => textParts(e.data?.content).join("\n").trim();
  const lastAny = [...userMsgs].reverse().find((e) => anyText(e) !== "");
  if (lastAny) {
    const kind = String(lastAny.data?.source?.kind ?? "<none>");
    r.prompts.lastAnySourceKinds[kind] = (r.prompts.lastAnySourceKinds[kind] ?? 0) + 1;
    r.prompts.lastAnyLength ??= [];
    r.prompts.lastAnyLength.push(anyText(lastAny).length);
    if (r.prompts.noisyExamples.length < 3 && !PROMPT_KINDS.has(kind)) {
      r.prompts.noisyExamples.push({ kind, text: anyText(lastAny).slice(0, 120) });
    }
  }
  const lastPrompt = [...promptEvents].reverse().find((e) => anyText(e) !== "");
  const bucket = (r.prompts.byOrigin[origin] ??= { sessions: 0, hasRecommended: 0 });
  bucket.sessions += 1;
  if (lastPrompt) {
    bucket.hasRecommended += 1;
    r.prompts.recommendedLength ??= [];
    r.prompts.recommendedLength.push(anyText(lastPrompt).length);
    if (r.prompts.recommendedSamples.length < 4) r.prompts.recommendedSamples.push(anyText(lastPrompt).slice(0, 100));
  } else {
    r.prompts.recommendedMissing += 1;
  }

  // ---- tokens ----
  let total = 0;
  for (const e of events) {
    if (e.type !== "assistant/message") continue;
    const n = Number(e.data?.usage?.totalTokens);
    if (Number.isFinite(n)) total += n;
  }
  r.tokens.total += total;
  r.tokens.byOrigin[origin] = (r.tokens.byOrigin[origin] ?? 0) + total;
  r.tokens.sessionsByOrigin[origin] = (r.tokens.sessionsByOrigin[origin] ?? 0) + 1;

  // ---- forks / inherited prefix ----
  const inheritedMarkers = events.filter((e) => e.type === "session/end-seed" && e.data?.inherited === true);
  if (header.isSeeded === true) {
    r.forks.seeded += 1;
    if (inheritedMarkers.length > 0) {
      r.forks.withInheritedMarker += 1;
      const cut = inheritedMarkers[inheritedMarkers.length - 1].seq + 1; // seq is 0-based and contiguous
      const inheritedEvents = events.filter((e) => e.seq < cut);
      let inheritedTokens = 0;
      for (const e of inheritedEvents) {
        if (e.type === "assistant/message") inheritedTokens += Number(e.data?.usage?.totalTokens) || 0;
      }
      r.tokens.inheritedTokens += inheritedTokens;
      r.tokens.inheritedEvents += inheritedEvents.length;
      r.forks.inheritedEventTotal += inheritedEvents.length;
      r.forks.details.push({
        id: log.id,
        parent: header.parentSession,
        inheritedCount: cut,
        events: events.length,
        inheritedTokens,
        totalTokens: total,
        sketch: { inherited: inheritedEvents.length, owned: events.length - inheritedEvents.length },
      });
    }
  }
  r.forks.totalEventTotal += events.length;

  // ---- shell programs ----
  for (const e of events) {
    if (e.type !== "tool/call") continue;
    const name = String(e.data?.name ?? "");
    if (name !== "win_bash" && name !== "pwsh") continue;
    let args = null;
    try {
      args = JSON.parse(String(e.data?.arguments ?? "{}"));
    } catch {
      continue;
    }
    if (!isObj(args) || typeof args.command !== "string") continue;
    r.shell.calls += 1;
    const first = args.command.trim().split(/[\s;|&]+/)[0] || "<empty>";
    r.shell.programs[first] = (r.shell.programs[first] ?? 0) + 1;
    const norm = programOf(args.command);
    r.shell.normalizedPrograms[norm] = (r.shell.normalizedPrograms[norm] ?? 0) + 1;
    r.shell.distinctPrograms = Object.keys(r.shell.normalizedPrograms).length;
  }
}

const top = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));
r.titles.lastTitleLength = stats(r.titles.lastTitleLength ?? []);
r.titles.titlesPerSession = stats(r.titles.titlesPerSession ?? []);
r.prompts.lastAnyLength = stats(r.prompts.lastAnyLength ?? []);
r.prompts.recommendedLength = stats(r.prompts.recommendedLength ?? []);
r.prompts.recommendedMissingRate = `${r.prompts.recommendedMissing}/${r.sessions}`;
r.tokens.byOriginPct = Object.fromEntries(
  Object.entries(r.tokens.byOrigin).map(([k, v]) => [k, `${((v / Math.max(1, r.tokens.total)) * 100).toFixed(1)}%`]),
);
r.tokens.total = Math.round(r.tokens.total);
r.shell.programs = top(r.shell.programs, 12);
r.shell.normalizedPrograms = top(r.shell.normalizedPrograms, 15);

const text = JSON.stringify(r, null, 2);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text, "utf8");
  console.log(`wrote ${OUT} (${text.length} bytes)`);
} else console.log(text);

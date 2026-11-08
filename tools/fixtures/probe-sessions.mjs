#!/usr/bin/env node
/**
 * Probe real DSH session logs (zstd-compressed JSONL) and report the fields the
 * stats panel needs. Read-only: never writes to the DSH home directory.
 *
 * Usage:
 *   node tools/fixtures/probe-sessions.mjs                # scan all sessions
 *   node tools/fixtures/probe-sessions.mjs --max 6        # first 6 (by size, desc)
 *   node tools/fixtures/probe-sessions.mjs --out _notes/probe-summary.json
 *
 * Zero dependencies. Node 22+ (zlib.zstdDecompressSync).
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { dirname, join } from "node:path";

const SESSIONS_ROOT = "E:/Program Files/deepseekharness-webui/home/sessions";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const MAX = Number(argOf("--max", "0")) || 0;
const OUT = argOf("--out", "");

/** Recursively list `session.v4.jsonl.zstd` files under the sessions root. */
function listLogs(root) {
  const out = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const workspaceDir = join(root, dir.name);
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(workspaceDir, entry.name, "session.v4.jsonl.zstd");
      try {
        out.push({ file, workspace: dir.name, sessionDir: entry.name, size: statSync(file).size });
      } catch {
        /* session without a log file yet */
      }
    }
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

/** Decompress and split one log into parsed lines (header line included). */
function readLog(file) {
  const raw = zstdDecompressSync(readFileSync(file)).toString("utf8");
  const lines = raw.split("\n");
  const parsed = [];
  let bad = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      bad += 1;
    }
  }
  return { parsed, bad, decompressedBytes: raw.length };
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keysOf = (v) => (isObj(v) ? Object.keys(v).sort() : []);

/** Count field presence over a list of values. */
function tallyFields(values) {
  const counts = new Map();
  for (const v of values) for (const k of keysOf(v)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
}

/** Truncate a sample for the report; keeps structure, drops huge text. */
function trim(value, depth = 0) {
  if (depth > 6) return "<depth>";
  if (typeof value === "string") return value.length > 240 ? value.slice(0, 240) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, 4).map((v) => trim(v, depth + 1));
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = trim(v, depth + 1);
    return out;
  }
  return value;
}

const logs = listLogs(SESSIONS_ROOT);
const chosen = MAX > 0 ? logs.slice(0, MAX) : logs;

const summary = {
  scannedAt: new Date().toISOString(),
  sessionsRoot: SESSIONS_ROOT,
  totalLogs: logs.length,
  scannedLogs: chosen.length,
  perSession: [],
  globalTypeCounts: {},
  headerFieldCounts: {},
  envelopeFieldCounts: {},
  dataFieldCounts: {},   // by event type -> field presence counts
  toolNames: {},
  commandPrograms: {},
  toolResultShape: {},   // shape buckets for success/failure/duration
  userPartShapes: {},
  skillEvidence: [],
  samples: {},           // first occurrence per event type (trimmed)
  anomalies: [],
};

const globalTypes = new Map();
const headerFields = [];
const envelopeFields = [];
const dataFields = new Map(); // type -> array of data objs
const toolNames = new Map();
const commandPrograms = new Map();
const toolResultShapes = new Map();
const userPartShapes = new Map();

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

for (const log of chosen) {
  let parsed, bad, decompressedBytes;
  try {
    ({ parsed, bad, decompressedBytes } = readLog(log.file));
  } catch (err) {
    summary.anomalies.push({ session: log.sessionDir, error: String(err) });
    continue;
  }
  if (parsed.length === 0) {
    summary.anomalies.push({ session: log.sessionDir, error: "empty log" });
    continue;
  }

  // Physical format v4 stores the header as line 0, tagged `type: "session"`.
  const first = parsed[0];
  const header = isObj(first) && first.type === "session" && first.id !== undefined ? first : null;
  const events = header ? parsed.slice(1) : parsed;
  if (header) headerFields.push(header);
  else summary.anomalies.push({ session: log.sessionDir, note: "first line is not a header", firstLine: trim(first) });

  const typeCounts = {};
  const times = [];
  const seqs = [];
  let ignorable = 0;
  const skills = [];

  for (const ev of events) {
    if (!isObj(ev)) continue;
    const type = String(ev.type ?? "<missing>");
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    bump(globalTypes, type);
    envelopeFields.push(ev);
    if (ev.ignorable === true) ignorable += 1;
    if (typeof ev.time === "number") times.push(ev.time);
    if (typeof ev.seq === "number") seqs.push(ev.seq);
    if (!isObj(ev.data)) continue;
    const list = dataFields.get(type) ?? [];
    list.push(ev.data);
    dataFields.set(type, list);
    if (summary.samples[type] === undefined) summary.samples[type] = trim(ev);

    if (type === "tool/call") {
      const name = String(ev.data.name ?? "<missing>");
      bump(toolNames, name);
      if (/skill/i.test(name)) skills.push({ seq: ev.seq, name, arguments: trim(ev.data.arguments, 2) });
      const args = ev.data.arguments;
      if (isObj(args) && typeof args.skill === "string") skills.push({ seq: ev.seq, name, skill: args.skill });
    }
    if (type === "tool/result") {
      const shape = [
        `hasIsError=${Object.hasOwn(ev.data, "isError")}`,
        `hasError=${Object.hasOwn(ev.data, "error")}`,
        `hasDurationMs=${Object.hasOwn(ev.data, "durationMs")}`,
        `hasContent=${Object.hasOwn(ev.data, "content")}`,
        `hasCallId=${Object.hasOwn(ev.data, "callId")}`,
        `hasToolName=${Object.hasOwn(ev.data, "name")}`,
      ].join(",");
      bump(toolResultShapes, shape);
    }
    if (type === "command/run") bump(commandPrograms, String(ev.data.program ?? "<missing>"));
    if (type === "user/message") {
      const content = ev.data.message?.content;
      const parts = Array.isArray(content) ? content.map((p) => {
        if (typeof p === "string") return "string";
        if (!isObj(p)) return typeof p;
        return `${String(p.type)}:${Object.keys(p).sort().join("+")}`;
      }) : [`<${typeof content}>`];
      bump(userPartShapes, [...new Set(parts)].sort().join(" | "));
    }
    if (/skill/i.test(type)) skills.push({ seq: ev.seq, type, data: trim(ev.data, 2) });
  }

  // seq must be monotonic within one log; time must be epoch ms in a sane range.
  let seqMonotonic = true;
  for (let i = 1; i < seqs.length; i++) if (seqs[i] <= seqs[i - 1]) seqMonotonic = false;
  const timeMin = times.length ? Math.min(...times) : null;
  const timeMax = times.length ? Math.max(...times) : null;
  const timeLooksMs = timeMin !== null && timeMin > 1e12;

  summary.perSession.push({
    sessionDir: log.sessionDir,
    workspace: log.workspace,
    compressedBytes: log.size,
    decompressedBytes,
    header: header ? trim(header) : null,
    headerKeys: header ? keysOf(header) : [],
    eventCount: events.length,
    inheritedEventCount: header?.inheritedEventCount,
    badLines: bad,
    ignorableEvents: ignorable,
    eventTypes: typeCounts,
    seqMonotonic,
    timeLooksEpochMs: timeLooksMs,
    timeRange: timeMin === null ? null : [new Date(timeMin).toISOString(), new Date(timeMax).toISOString()],
    skills,
  });
}

summary.globalTypeCounts = Object.fromEntries([...globalTypes].sort((a, b) => b[1] - a[1]));
summary.headerFieldCounts = tallyFields(headerFields);
summary.envelopeFieldCounts = tallyFields(envelopeFields);
summary.dataFieldCounts = Object.fromEntries(
  [...dataFields].sort((a, b) => b[1].length - a[1].length).map(([type, list]) => [type, { events: list.length, fields: tallyFields(list) }]),
);
summary.toolNames = Object.fromEntries([...toolNames].sort((a, b) => b[1] - a[1]).slice(0, 40));
summary.commandPrograms = Object.fromEntries([...commandPrograms].sort((a, b) => b[1] - a[1]).slice(0, 40));
summary.toolResultShape = Object.fromEntries([...toolResultShapes].sort((a, b) => b[1] - a[1]));
summary.userPartShapes = Object.fromEntries([...userPartShapes].sort((a, b) => b[1] - a[1]));
summary.skillEvidence = summary.perSession.flatMap((s) => s.skills.map((x) => ({ session: s.sessionDir, ...x }))).slice(0, 20);

const text = JSON.stringify(summary, null, 2);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text, "utf8");
  console.log(`wrote ${OUT} (${text.length} bytes)`);
}
console.log(text);

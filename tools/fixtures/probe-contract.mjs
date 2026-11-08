#!/usr/bin/env node
/**
 * Focused field contract probe over real DSH session logs.
 *
 * Answers, with measured frequencies rather than assumptions:
 *   - session/title coverage + fallback source
 *   - user/message content-part shapes and last-prompt extractability
 *   - tool/call + tool/result pairing, success flag, derivable duration
 *   - command/run (slash command) vs shell commands inside win_bash/pwsh calls
 *   - turn/step counting口径
 *   - session/end-seed / ignorable events / subagent sessions
 *   - skill tool calls and their name extraction
 *
 * Usage: node tools/fixtures/probe-contract.mjs [--out path]
 * Zero dependencies, read-only.
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
const OUT = argOf("--out", "");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function listLogs(root) {
  const out = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const workspaceDir = join(root, dir.name);
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(workspaceDir, entry.name, "session.v4.jsonl.zstd");
      try {
        statSync(file);
        out.push({ file, workspace: dir.name, sessionDir: entry.name });
      } catch {
        /* not materialized */
      }
    }
  }
  return out;
}

function readLog(file) {
  const raw = zstdDecompressSync(readFileSync(file)).toString("utf8");
  const parsed = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      /* torn tail */
    }
  }
  const header = parsed[0]?.type === "session" ? parsed[0] : null;
  return { header, events: header ? parsed.slice(1) : parsed };
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pct = (a, b) => (b === 0 ? "0%" : `${((a / b) * 100).toFixed(1)}%`);
const stats = (nums) => {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
};
const elementStats = (arr) => {
  const out = [];
  if (arr.length === 0) return out;
  const step = Math.max(1, Math.floor(arr.length / 8));
  for (let i = 0; i < arr.length; i += step) {
    const d = new Date(arr[i]);
    const p2 = (n) => String(n).padStart(2, "0");
    out.push(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`);
  }
  return out;
};

// ---------------------------------------------------------------------------
// accumulators
// ---------------------------------------------------------------------------

const logs = listLogs(SESSIONS_ROOT);
const report = {
  scannedAt: new Date().toISOString(),
  sessions: logs.length,
  header: { origin: {}, delegationDepth: {}, isSeeded: {}, cwdNonEmpty: 0, parentSession: 0, agentPreset: {}, version: {} },
  subagent: { count: 0, withTitle: 0, withUserText: 0, avgEvents: 0 },
  title: {
    sessionsWithTitle: 0,
    sessionsWithoutTitle: 0,
    eventsPerSession: {},
    sources: {},
    sourceKinds: {},
    titleLength: null,
    samples: [],
    fallbackFromFirstUserText: 0,
    withoutTitleButUserText: 0,
    messageSeqsEmpty: 0,
  },
  userMessage: {
    total: 0,
    sessionsWithUserMessage: 0,
    sessionsWithTextPart: 0,
    partTypes: {},
    textPartCount: null,
    lastPromptTextLength: null,
    lastPromptExtractOk: 0,
    lastPromptMissingOnSessionsWithUserMsg: 0,
    sessionsLastPromptOnlyNonText: 0,
    lastPromptSamples: [],
    roles: {},
    sources: {},
  },
  tool: {
    calls: 0,
    argumentsIsJsonString: 0,
    argumentsIsObject: 0,
    argumentsParseFail: 0,
    resultCount: 0,
    isErrorTrue: 0,
    isErrorFalse: 0,
    errorField: 0,
    metaPresent: 0,
    metaKeys: {},
    matchedCallIds: 0,
    unmatchedResults: 0,
    unmatchedCalls: 0,
    durationMs: null,
    negativeDurations: 0,
    resultContentParts: {},
    toolResultMessageKeys: {},
  },
  command: {
    runEvents: 0,
    runNameValues: {},
    runBareSamples: [],
    doneKinds: {},
    doneHasExitCode: 0,
    shellCallNames: {},
    shellCommandParseOk: 0,
    shellCommandParseFail: 0,
    topPrograms: {},
    workdirField: {},
  },
  turnStep: {
    sessions: 0,
    turnStart: 0,
    turnEnd: 0,
    stepStart: 0,
    stepEnd: 0,
    sessionsTurnStartEqualsDistinct: 0,
    sessionsTurnStartGreaterDistinct: 0,
    sessionsStepStartEqualsDistinct: 0,
    sessionsStepStartGreaterDistinct: 0,
    turnNumbersRestart: 0,
    duplicateStepKeys: 0,
    turnsFromDistinctTurnEnd: null,
    stepsFromStepEnd: null,
    incompleteSessions: [],
    reasonKinds: {},
  },
  endSeed: { count: 0, shapes: {}, sessions: 0, seededSessions: 0, seededWithMarker: 0 },
  ignorable: { total: 0, byType: {} },
  skill: { calls: 0, names: {}, samples: [], argumentKeys: {} },
  times: { min: null, max: null, nonEpochMs: 0 },
};

const turnReasonKinds = report.turnStep.reasonKinds;
const titleSources = report.title.sources;
const bump = (map, k) => {
  map[k] = (map[k] ?? 0) + 1;
};

for (const log of logs) {
  let header, events;
  try {
    ({ header, events } = readLog(log.file));
  } catch {
    continue;
  }
  if (!header) continue;

  // header
  bump(report.header.origin, String(header.origin ?? "top-level"));
  bump(report.header.delegationDepth, String(header.delegationDepth ?? 0));
  bump(report.header.isSeeded, String(header.isSeeded ?? false));
  bump(report.header.agentPreset, String(header.agentPreset ?? "<none>"));
  bump(report.header.version, String(header.version));
  if (typeof header.cwd === "string" && header.cwd !== "") report.header.cwdNonEmpty += 1;
  if (header.parentSession !== undefined) report.header.parentSession += 1;
  const isSubagent = header.origin === "subagent";

  const titleEvents = events.filter((e) => e.type === "session/title");
  const userEvents = events.filter((e) => e.type === "user/message");
  const callEvents = events.filter((e) => e.type === "tool/call");
  const resultEvents = events.filter((e) => e.type === "tool/result");
  const turnStarts = events.filter((e) => e.type === "turn/start");
  const turnEnds = events.filter((e) => e.type === "turn/end");
  const stepStarts = events.filter((e) => e.type === "step/start");
  const stepEnds = events.filter((e) => e.type === "step/end");
  const endSeeds = events.filter((e) => e.type === "session/end-seed");

  if (isSubagent) {
    report.subagent.count += 1;
    report.subagent.avgEvents += events.length;
    if (titleEvents.length > 0) report.subagent.withTitle += 1;
    const hasText = userEvents.some((e) => contentTextParts(e.data).length > 0);
    if (hasText) report.subagent.withUserText += 1;
  }

  // ---- title ----
  if (titleEvents.length > 0) {
    report.title.sessionsWithTitle += 1;
    bump(report.title.eventsPerSession, `>=${Math.min(titleEvents.length, 5)}`);
  } else report.title.sessionsWithoutTitle += 1;
  for (const ev of titleEvents) {
    const d = ev.data ?? {};
    bump(report.title.sourceKinds, String(d.source?.kind ?? "<none>"));
    bump(titleSources, String(d.title ?? "").slice(0, 80) === "" ? "<empty>" : "<non-empty>");
    if (!Array.isArray(d.messageSeqs) || d.messageSeqs.length === 0) report.title.messageSeqsEmpty += 1;
    if (report.title.samples.length < 6 && isObj(d.source) && d.source.kind !== "fallback") {
      report.title.samples.push({ kind: d.source.kind, title: d.title, messageSeqs: d.messageSeqs });
    }
  }
  if (titleEvents.length === 0) {
    const firstText = userEvents.map((e) => contentTextParts(e.data).join(" ").trim()).find((t) => t !== "");
    if (firstText !== undefined) report.title.withoutTitleButUserText += 1;
  }

  // ---- user messages ----
  if (userEvents.length > 0) {
    report.userMessage.sessionsWithUserMessage += 1;
    report.userMessage.total += userEvents.length;
    const textLengths = [];
    for (const ev of userEvents) {
      const d = ev.data ?? {};
      bump(report.userMessage.roles, String(d.role ?? "<none>"));
      bump(report.userMessage.sources, String(d.source?.kind ?? "<none>"));
      const parts = Array.isArray(d.content) ? d.content : [];
      for (const p of parts) {
        const t = isObj(p) ? String(p.type ?? "<none>") : typeof p;
        bump(report.userMessage.partTypes, t);
      }
      const texts = contentTextParts(d);
      if (texts.length > 0) textLengths.push(...texts.map((t) => t.length));
    }
    if (textLengths.length > 0) report.userMessage.sessionsWithTextPart += 1;
    // last prompt = concatenated text parts of the last user/message
    const last = userEvents[userEvents.length - 1];
    const lastText = contentTextParts(last.data ?? {}).join("\n").trim();
    if (lastText !== "") {
      report.userMessage.lastPromptExtractOk += 1;
      report.userMessage.lastPromptTextLength ??= [];
      report.userMessage.lastPromptTextLength.push(lastText.length);
      if (report.userMessage.lastPromptSamples.length < 5) {
        report.userMessage.lastPromptSamples.push(lastText.slice(0, 100));
      }
    } else {
      // A session can end on an image-only prompt; fall back to the last textual one.
      const fallback = [...userEvents].reverse().map((e) => contentTextParts(e.data ?? {}).join("\n").trim()).find((t) => t !== "");
      if (fallback === undefined) report.userMessage.sessionsLastPromptOnlyNonText += 1;
      else {
        report.userMessage.lastPromptExtractOk += 1;
        report.userMessage.lastPromptTextLength ??= [];
        report.userMessage.lastPromptTextLength.push(fallback.length);
        if (report.userMessage.lastPromptSamples.length < 5) report.userMessage.lastPromptSamples.push(fallback.slice(0, 100));
      }
    }
    report.userMessage.textPartCount ??= [];
    report.userMessage.textPartCount.push(textLengths.length);
  }

  // ---- tool calls / results ----
  report.tool.calls += callEvents.length;
  report.tool.resultCount += resultEvents.length;
  const callById = new Map();
  for (const ev of callEvents) {
    const d = ev.data ?? {};
    const args = d.arguments;
    if (typeof args === "string") {
      report.tool.argumentsIsJsonString += 1;
      try {
        JSON.parse(args);
      } catch {
        report.tool.argumentsParseFail += 1;
      }
    } else if (isObj(args)) report.tool.argumentsIsObject += 1;
    if (d.callId !== undefined) callById.set(String(d.callId), ev);
    if (String(d.name) === "skill") {
      report.skill.calls += 1;
      let parsed = null;
      try {
        parsed = typeof args === "string" ? JSON.parse(args) : args;
      } catch {
        /* keep null */
      }
      if (isObj(parsed)) {
        for (const k of Object.keys(parsed)) bump(report.skill.argumentKeys, k);
        const name = String(parsed.name ?? parsed.skill ?? parsed.id ?? "<none>");
        bump(report.skill.names, name);
        if (report.skill.samples.length < 6) {
          report.skill.samples.push({ seq: ev.seq, name, args: Object.keys(parsed) });
        }
      }
    }
    if (d.name === "win_bash" || d.name === "pwsh") {
      bump(report.command.shellCallNames, d.name);
      let parsed = null;
      try {
        parsed = typeof args === "string" ? JSON.parse(args) : args;
      } catch {
        /* ignore */
      }
      if (isObj(parsed) && typeof parsed.command === "string") {
        report.command.shellCommandParseOk += 1;
        for (const k of Object.keys(parsed)) bump(report.command.workdirField, k);
        const first = parsed.command.trim().split(/[\s;|&]+/)[0] ?? "";
        bump(report.command.topPrograms, first);
      } else report.command.shellCommandParseFail += 1;
    }
  }
  const resultCallIds = new Set();
  for (const ev of resultEvents) {
    const d = ev.data ?? {};
    const message = d.message ?? {};
    for (const k of Object.keys(message)) bump(report.tool.toolResultMessageKeys, k);
    if (message.isError === true) report.tool.isErrorTrue += 1;
    else if (message.isError === false) report.tool.isErrorFalse += 1;
    if (d.error !== undefined) {
      report.tool.errorField += 1;
      if (report.tool.errorSamples === undefined) report.tool.errorSamples = [];
      if (report.tool.errorSamples.length < 3) {
        report.tool.errorSamples.push(
          typeof d.error === "string" ? d.error.slice(0, 200) : JSON.stringify(d.error).slice(0, 200),
        );
      }
    }
    if (d.meta !== undefined) {
      report.tool.metaPresent += 1;
      if (isObj(d.meta)) for (const k of Object.keys(d.meta)) bump(report.tool.metaKeys, k);
    }
    for (const p of Array.isArray(message.content) ? message.content : []) {
      bump(report.tool.resultContentParts, isObj(p) ? String(p.type ?? "<none>") : typeof p);
    }
    const callId = message.toolCallId ?? message.source?.callId;
    if (callId !== undefined) {
      resultCallIds.add(String(callId));
      const call = callById.get(String(callId));
      if (call !== undefined) {
        report.tool.matchedCallIds += 1;
        const delta = Number(ev.time) - Number(call.time);
        if (Number.isFinite(delta)) {
          if (delta < 0) report.tool.negativeDurations += 1;
          report.tool.durationMs ??= [];
          report.tool.durationMs.push(delta);
        }
      }
    }
  }
  for (const id of callById.keys()) if (!resultCallIds.has(id)) report.tool.unmatchedCalls += 1;
  for (const id of resultCallIds) if (!callById.has(id)) report.tool.unmatchedResults += 1;

  // ---- command ----
  const runs = events.filter((e) => e.type === "command/run");
  const dones = events.filter((e) => e.type === "command/done");
  report.command.runEvents += runs.length;
  for (const ev of runs) {
    const d = ev.data ?? {};
    bump(report.command.runNameValues, String(d.name ?? "<none>"));
    if (report.command.runBareSamples.length < 3) report.command.runBareSamples.push(d);
  }
  for (const ev of dones) {
    const d = ev.data ?? {};
    bump(report.command.doneKinds, String(d.kind ?? "<none>"));
    if (Object.hasOwn(d, "exitCode")) report.command.doneHasExitCode += 1;
  }

  // ---- turns / steps ----
  report.turnStep.sessions += 1;
  report.turnStep.turnStart += turnStarts.length;
  report.turnStep.turnEnd += turnEnds.length;
  report.turnStep.stepStart += stepStarts.length;
  report.turnStep.stepEnd += stepEnds.length;
  const turnNumbers = new Set(turnStarts.map((e) => Number(e.data?.turn)));
  const stepKeys = new Set(stepStarts.map((e) => `${e.data?.turn}:${e.data?.step}`));
  const turnEndNumbers = new Set(turnEnds.map((e) => Number(e.data?.turn)));
  if (turnStarts.length === turnNumbers.size) report.turnStep.sessionsTurnStartEqualsDistinct += 1;
  else report.turnStep.sessionsTurnStartGreaterDistinct += 1;
  if (stepStarts.length === stepKeys.size) report.turnStep.sessionsStepStartEqualsDistinct += 1;
  else report.turnStep.sessionsStepStartGreaterDistinct += 1;
  // does the turn number restart (resume) or repeat within the log?
  let restarts = false;
  const seq = turnStarts.map((e) => Number(e.data?.turn));
  for (let i = 1; i < seq.length; i += 1) if (!(seq[i] > seq[i - 1])) restarts = true;
  if (restarts) report.turnStep.turnNumbersRestart += 1;
  for (const e of turnEnds) bump(turnReasonKinds, String(e.data?.reason?.kind ?? "<none>"));
  if (turnStarts.length !== turnEnds.length || stepStarts.length !== stepEnds.length) {
    report.turnStep.incompleteSessions.push({
      session: log.sessionDir,
      turnStart: turnStarts.length,
      turnEnd: turnEnds.length,
      stepStart: stepStarts.length,
      stepEnd: stepEnds.length,
    });
  }

  // ---- end-seed ----
  if (endSeeds.length > 0) {
    report.endSeed.sessions += 1;
    report.endSeed.count += endSeeds.length;
    bump(report.endSeed.shapes, JSON.stringify(endSeeds[0].data ?? {}));
  }
  if (header.isSeeded === true) {
    report.endSeed.seededSessions += 1;
    if (endSeeds.length > 0) report.endSeed.seededWithMarker += 1;
  }

  // ---- ignorable ----
  for (const ev of events) {
    if (ev.ignorable === true) {
      report.ignorable.total += 1;
      bump(report.ignorable.byType, String(ev.type));
    }
  }

  // ---- time ----
  for (const ev of events) {
    const t = Number(ev.time);
    if (!Number.isFinite(t)) continue;
    if (t < 1e12 || t > 4e12) report.times.nonEpochMs += 1;
    if (report.times.min === null || t < report.times.min) report.times.min = t;
    if (report.times.max === null || t > report.times.max) report.times.max = t;
  }
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

report.subagent.avgEvents = Math.round(report.subagent.avgEvents / Math.max(1, report.subagent.count));
report.title.titleLength = stats(report.title.samples.map((s) => String(s.title ?? "").length));
report.userMessage.textPartCount = stats(report.userMessage.textPartCount ?? []);
report.userMessage.lastPromptTextLength = stats(report.userMessage.lastPromptTextLength ?? []);
report.tool.durationMs = stats(report.tool.durationMs ?? []);
report.command.topPrograms = Object.fromEntries(
  Object.entries(report.command.topPrograms).sort((a, b) => b[1] - a[1]).slice(0, 25),
);
report.turnStep.turnsFromDistinctTurnEnd = `Σ distinct turn numbers per session is the stable count; turn/start==distinct in ${report.turnStep.sessionsTurnStartEqualsDistinct}/${report.turnStep.sessions}`;
report.times.range = [new Date(report.times.min).toISOString(), new Date(report.times.max).toISOString()];
report.samplesTime = elementStats([report.times.min, report.times.max]);

const text = JSON.stringify(report, null, 2);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text, "utf8");
  console.log(`wrote ${OUT} (${text.length} bytes)`);
} else console.log(text);

/** Text parts of a user message: `data.content[]` items of `{type:"text", text}`. */
function contentTextParts(data) {
  const content = data?.content;
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const part of content) {
    if (!isObj(part)) continue;
    if (part.type === "text" && typeof part.text === "string") out.push(part.text);
  }
  return out;
}

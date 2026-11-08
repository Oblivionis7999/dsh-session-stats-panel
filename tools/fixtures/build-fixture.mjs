#!/usr/bin/env node
/**
 * Build `events-sample.json` from one real DSH session log.
 *
 * Every selected event keeps its real shape (envelope + data keys); all
 * human-readable strings are replaced with placeholders and paths/IDs are
 * rewritten, so the fixture can be committed. A second, hand-built session
 * demonstrates the fork prefix (`session/end-seed {inherited:true}` +
 * `inheritedEventCount`) so selfchecks can prove inherited events are skipped.
 *
 * Usage: node tools/fixtures/build-fixture.mjs [--out tools/fixtures/events-sample.json]
 * Zero dependencies, read-only against the DSH home directory.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { join } from "node:path";

const ROOT = "E:/Program Files/deepseekharness-webui/home/sessions";
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "tools/fixtures/events-sample.json";
const SOURCE_ID = "session-3a12dc96-d972-42ae-b0c9-b1b5986dc849";

const PROMPT_KINDS = new Set(["user", "agent-message", "skill-invocation", "user-approval"]);
const FIXTURE_CWD = "E:\\fixture-workspace";

/** Locate one session log by session id across all workspace directories. */
function findLog(id) {
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const w = join(ROOT, d.name);
    for (const e of readdirSync(w, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name !== id) continue;
      const f = join(w, e.name, "session.v4.jsonl.zstd");
      if (existsSync(f)) return f;
    }
  }
  return null;
}

const textParts = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((p) => p !== null && typeof p === "object" && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text);

// ---------------------------------------------------------------------------
// sanitizers (shape-preserving)
// ---------------------------------------------------------------------------

let msgCounter = 0;
const nextMsgId = () => `msg-fixture-${++msgCounter}`;

/** Replace every string value with one stable placeholder (keeps keys/numbers). */
function scrubStrings(value, placeholder = "[示例文本]") {
  if (typeof value === "string") return placeholder;
  if (Array.isArray(value)) return value.map((v) => scrubStrings(v, placeholder));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubStrings(v, placeholder);
    return out;
  }
  return value;
}

/** Rewrite tool-call arguments into an equivalent, harmless argument object. */
function sanitizeArguments(name, raw) {
  let args;
  try {
    args = JSON.parse(String(raw));
  } catch {
    return JSON.stringify({ note: "[示例参数]" });
  }
  if (args === null || typeof args !== "object") return JSON.stringify({ note: "[示例参数]" });
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (k === "command") out[k] = name === "pwsh" ? "ls -la" : "python tools\\demo.py";
    else if (k === "file_path" || k === "path" || k === "workdir" || k === "cwd") out[k] = `${FIXTURE_CWD}\\README.md`;
    else if (k === "name") out[k] = "example-skill";
    else out[k] = "[示例参数]";
  }
  return JSON.stringify(out);
}

/** Build a callId map so a call and its result keep pointing at one another. */
function sanitizeCallId(callId, map) {
  if (!map.has(callId)) map.set(callId, `call_fixture_${map.size + 1}`);
  return map.get(callId);
}

function sanitizeContent(content, callIdMap) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part === null || typeof part !== "object") return part;
    if (part.type === "text") return { type: "text", text: "[示例工具结果]" };
    if (part.type === "image") {
      return {
        type: "image",
        attachment: {
          attachmentId: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          mediaType: "image/png",
          width: part.attachment?.width ?? 64,
          height: part.attachment?.height ?? 64,
          bytes: part.attachment?.bytes ?? 1024,
          name: "example.png",
        },
      };
    }
    if (part.type === "file") {
      return {
        type: "file",
        attachment: {
          attachmentId: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          name: "example.md",
          bytes: part.attachment?.bytes ?? 1024,
        },
      };
    }
    return scrubStrings(part);
  });
}

/** Sanitize one event; `titleMode` names the placeholder for title events. */
function sanitizeEvent(ev, ctx) {
  const out = JSON.parse(JSON.stringify(ev));
  const d = out.data ?? {};
  switch (out.type) {
    case "permission/preset":
      d.preset = "standard";
      break;
    case "command/run":
      d.commandId = "cmd-fixture-1";
      d.args = " standard";
      break;
    case "command/done":
      d.commandId = "cmd-fixture-1";
      d.text = "Command completed";
      break;
    case "user/message": {
      d.id = nextMsgId();
      const label = PROMPT_KINDS.has(d.source?.kind) ? "[示例用户消息]" : "[示例运行时上下文]";
      d.content = Array.isArray(d.content)
        ? d.content.map((part) => {
            if (part?.type === "text") return { type: "text", text: label };
            if (part?.type === "file") {
              return {
                type: "file",
                attachment: { attachmentId: "sha256:0000", name: "example.md", bytes: part.attachment?.bytes ?? 1024 },
              };
            }
            if (part?.type === "image") {
              return {
                type: "image",
                attachment: {
                  attachmentId: "sha256:0001",
                  mediaType: "image/png",
                  width: part.attachment?.width ?? 64,
                  height: part.attachment?.height ?? 64,
                  bytes: part.attachment?.bytes ?? 1024,
                  name: "example.png",
                },
              };
            }
            return scrubStrings(part);
          })
        : [];
      if (d.source !== null && typeof d.source === "object") {
        delete d.source.rpcId;
        d.source.clientTimeZone = "Asia/Shanghai";
        // Runtime-context messages carry policy/config snippets; keep the shape, drop the text.
        if (Array.isArray(d.source.sections)) {
          d.source.sections = d.source.sections.map((s) =>
            s !== null && typeof s === "object" ? { ...s, text: "[示例运行时上下文片段]" } : s,
          );
        }
      }
      break;
    }
    case "session/title":
      d.title = ctx.titleMode === "provider" ? "示例会话标题（模型优化后）" : "示例会话标题";
      if (d.source?.kind === "provider") {
        d.source.provider = "session-title-first-prompt-llm";
        d.source.model = { provider: "deepseek-account", model: "deepseek-flash" };
      }
      break;
    case "tool/call":
      d.callId = sanitizeCallId(d.callId, ctx.callIds);
      d.arguments = sanitizeArguments(d.name, d.arguments);
      if (d.name === "skill") d.arguments = JSON.stringify({ name: "example-skill" });
      break;
    case "tool/result": {
      const message = d.message ?? {};
      message.id = `res-fixture-${ctx.resultSeq++}`;
      message.toolCallId = ctx.callIds.get(message.toolCallId) ?? "call_fixture_0";
      if (message.source !== null && typeof message.source === "object") message.source.callId = message.toolCallId;
      message.content =
        message.isError === true
          ? [{ type: "text", text: "[示例错误信息]" }]
          : [{ type: "text", text: "[示例工具结果]" }];
      d.message = message;
      if (d.error !== undefined) d.error = { name: "ToolError", code: "EXAMPLE_FAILURE" };
      if (d.meta !== undefined) {
        // Keep scalar metadata only: nested diffs/files arrays would bloat the fixture.
        const meta = {};
        for (const [k, v] of Object.entries(d.meta)) {
          if (typeof v === "number" || typeof v === "boolean") meta[k] = v;
          else if (typeof v === "string") {
            if (k === "cwd" || k === "path") meta[k] = `${FIXTURE_CWD}\\README.md`;
            else meta[k] = v.length <= 16 ? v : "[示例元数据]";
          }
        }
        d.meta = meta;
      }
      break;
    }
    case "assistant/message": {
      const message = d.message ?? {};
      message.id = nextMsgId();
      message.content = [{ type: "text", text: "[示例助手回复]" }];
      if (message.source !== null && typeof message.source === "object") {
        delete message.source.replayState;
        message.source.provider = "deepseek-account";
        message.source.model = "deepseek-flash";
      }
      d.message = message;
      d.stream = [];
      break;
    }
    case "session/end-seed":
      d.inherited = undefined;
      if (ev.data?.inherited === true) d.inherited = true;
      else delete d.inherited;
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

const logFile = findLog(SOURCE_ID);
if (logFile === null) {
  console.error(`source session not found: ${SOURCE_ID}`);
  process.exit(1);
}
const lines = zstdDecompressSync(readFileSync(logFile)).toString("utf8").split("\n").filter(Boolean);
const header = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => JSON.parse(l));

const pick = (pred) => events.find(pred);
const resultFor = (call) =>
  events.find((e) => e.type === "tool/result" && e.data?.message?.toolCallId === call.data?.callId);

const selected = [];
const add = (ev) => {
  if (ev !== undefined && ev !== null && !selected.includes(ev)) selected.push(ev);
};

add(pick((e) => e.type === "permission/preset"));
const commandRun = pick((e) => e.type === "command/run");
add(commandRun);
if (commandRun) {
  add(events.find((e) => e.type === "command/done" && e.data?.commandId === commandRun.data?.commandId));
}
const turnStart = pick((e) => e.type === "turn/start");
add(turnStart);
const stepStart = pick((e) => e.type === "step/start" && e.data?.turn === turnStart?.data?.turn && e.data?.step === 1);
add(stepStart);
add(pick((e) => e.type === "user/message" && e.data?.source?.kind === "user"));
const titleFallback = pick((e) => e.type === "session/title" && e.data?.source?.kind === "fallback");
add(titleFallback);
const readCall = pick((e) => e.type === "tool/call" && e.data?.name === "read");
const pwshCall = pick((e) => e.type === "tool/call" && e.data?.name === "pwsh");
const skillCall = pick((e) => e.type === "tool/call" && e.data?.name === "skill");
const failResult = pick(
  (e) =>
    e.type === "tool/result" &&
    e.data?.message?.isError === true &&
    e.data?.error !== undefined &&
    ["read", "pwsh", "win_bash", "edit", "write", "grep"].includes(
      events.find((c) => c.type === "tool/call" && c.data?.callId === e.data?.message?.toolCallId)?.data?.name,
    ),
);
const failCall = failResult === undefined ? undefined : events.find((e) => e.type === "tool/call" && e.data?.callId === failResult.data?.message?.toolCallId);
for (const call of [readCall, pwshCall, skillCall, failCall]) {
  add(call);
  add(call === undefined ? undefined : resultFor(call));
}
add(pick((e) => e.type === "assistant/message" && e.data?.usage !== undefined));
add(events.find((e) => e.type === "step/end" && e.data?.turn === stepStart?.data?.turn && e.data?.step === stepStart?.data?.step));
const lastRealPrompt = [...events].reverse().find((e) => e.type === "user/message" && PROMPT_KINDS.has(e.data?.source?.kind ?? "") && textParts(e.data?.content).length > 0);
add(lastRealPrompt);
const syntheticPrompt = pick((e) => e.type === "user/message" && !PROMPT_KINDS.has(e.data?.source?.kind ?? "") && textParts(e.data?.content).length > 0);
add(syntheticPrompt);
const titleProvider = pick((e) => e.type === "session/title" && e.data?.source?.kind === "provider");
add(titleProvider);
add(pick((e) => e.type === "session/end-seed"));
add(events.find((e) => e.type === "turn/end" && e.data?.turn === turnStart?.data?.turn));
// A second, completed turn makes the fixture useful for turn/step counting assertions.
const turnStart2 = events.find((e) => e.type === "turn/start" && e.data?.turn === 2);
const stepStart2 = events.find((e) => e.type === "step/start" && e.data?.turn === 2 && e.data?.step === 1);
add(turnStart2);
add(stepStart2);
add(events.find((e) => e.type === "step/end" && e.data?.turn === 2 && e.data?.step === stepStart2?.data?.step));
add(events.find((e) => e.type === "turn/end" && e.data?.turn === 2));

selected.sort((a, b) => a.seq - b.seq);

// A naive "last user/message" must pick a runtime injection, proving the
// source-kind filter matters. If the real log does not end that way, append a
// synthetic message after the last selected seq (documented in the fixture).
const lastUserSelected = [...selected].reverse().find((e) => e.type === "user/message");
if (lastUserSelected === undefined || PROMPT_KINDS.has(lastUserSelected.data?.source?.kind ?? "")) {
  const template = syntheticPrompt ?? pick((e) => e.type === "user/message");
  if (template !== undefined) {
    const appended = JSON.parse(JSON.stringify(template));
    appended.seq = Math.max(...selected.map((e) => e.seq)) + 1;
    appended.time = Math.max(...selected.map((e) => e.time)) + 1;
    selected.push(appended);
  }
}

const topHeader = {
  type: "session",
  version: 4,
  id: "session-fixture-top-0001",
  createdAt: 1791216000000,
  cwd: FIXTURE_CWD,
  isSeeded: false,
  delegationDepth: 0,
  agentPreset: "standard",
};

const ctx = { callIds: new Map(), resultSeq: 0, titleMode: "fallback" };
const topEvents = selected.map((ev) => {
  ctx.titleMode = ev.type === "session/title" && ev.data?.source?.kind === "provider" ? "provider" : "fallback";
  return sanitizeEvent(ev, ctx);
});

// ---------------------------------------------------------------------------
// fork sample (hand-built to the physical v4 format documented in the contract)
// ---------------------------------------------------------------------------

const forkHeader = {
  type: "session",
  version: 4,
  id: "session-fixture-fork-0002",
  createdAt: 1791217000000,
  cwd: FIXTURE_CWD,
  parentSession: "session-fixture-top-0001",
  isSeeded: true,
  delegationDepth: 0,
  agentPreset: "standard",
};

const forkEvents = [
  { type: "permission/preset", seq: 0, time: 1791217000001, data: { preset: "standard" } },
  {
    type: "user/message",
    seq: 1,
    time: 1791217000002,
    data: { content: [{ type: "text", text: "[继承自父会话的用户消息]" }], role: "user", id: "msg-fork-1", source: { kind: "user" } },
  },
  {
    type: "assistant/message",
    seq: 2,
    time: 1791217000003,
    data: {
      turn: 1,
      step: 1,
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1100 },
      message: { role: "assistant", content: [{ type: "text", text: "[继承的助手回复]" }], source: { kind: "model", provider: "deepseek-account", model: "deepseek-flash" }, id: "msg-fork-2" },
      stream: [],
    },
  },
  {
    type: "tool/call",
    seq: 3,
    time: 1791217000004,
    data: { turn: 1, step: 1, callId: "call_fork_inherited_1", name: "read", arguments: JSON.stringify({ file_path: `${FIXTURE_CWD}\\README.md` }) },
  },
  {
    type: "tool/result",
    seq: 4,
    time: 1791217000005,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "tool",
        source: { kind: "tool", callId: "call_fork_inherited_1" },
        toolCallId: "call_fork_inherited_1",
        content: [{ type: "text", text: "[继承的工具结果]" }],
        isError: false,
        id: "res-fork-1",
      },
    },
  },
  { type: "session/end-seed", seq: 5, time: 1791217000006, data: { inherited: true } },
  { type: "turn/start", seq: 6, time: 1791217000007, data: { turn: 1 } },
  { type: "step/start", seq: 7, time: 1791217000008, data: { turn: 1, step: 1 } },
  {
    type: "user/message",
    seq: 8,
    time: 1791217000009,
    data: { content: [{ type: "text", text: "[分叉子会话自己的用户消息]" }], role: "user", id: "msg-fork-3", source: { kind: "user" } },
  },
  {
    type: "assistant/message",
    seq: 9,
    time: 1791217000010,
    data: {
      turn: 1,
      step: 1,
      usage: { inputTokens: 180, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 200 },
      message: { role: "assistant", content: [{ type: "text", text: "[分叉子会话的助手回复]" }], source: { kind: "model", provider: "deepseek-account", model: "deepseek-flash" }, id: "msg-fork-4" },
      stream: [],
    },
  },
  { type: "step/end", seq: 10, time: 1791217000011, data: { turn: 1, step: 1 } },
  { type: "turn/end", seq: 11, time: 1791217000012, data: { turn: 1, reason: { kind: "completed" } } },
];
const forkInheritedEventCount = 6; // seq 0..5

// ---------------------------------------------------------------------------
// derived expectations (computed from the sanitized sample, not from the raw log)
// ---------------------------------------------------------------------------

const derivedTitle = (() => {
  const titles = topEvents.filter((e) => e.type === "session/title");
  return titles.length === 0 ? "" : titles[titles.length - 1].data.title;
})();
const derivedLastPrompt = (() => {
  const msgs = topEvents.filter((e) => e.type === "user/message");
  const prompt = [...msgs].reverse().find((e) => PROMPT_KINDS.has(e.data?.source?.kind ?? "") && textParts(e.data?.content).join("").trim() !== "");
  return prompt === undefined ? "" : textParts(prompt.data.content).join("\n").trim();
})();
const normalizedProgram = (command) => {
  let cmd = String(command).trim();
  for (let i = 0; i < 4; i += 1) {
    cmd = cmd.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, "");
    const cd = cmd.match(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|\|\||;)\s*/);
    if (cd) cmd = cmd.slice(cd[0].length);
    else break;
  }
  return cmd.split(/[\s;|&]+/)[0] || "<empty>";
};
const toolCounts = {};
const skillNames = {};
const programs = {};
let tokensTotal = 0;
/** Token total recomputed from the four disjoint buckets (`usage.totalTokens` is optional). */
const usageTotal = (u) =>
  (Number(u?.inputTokens) || 0) + (Number(u?.outputTokens) || 0) + (Number(u?.cacheReadTokens) || 0) + (Number(u?.cacheWriteTokens) || 0);
for (const ev of topEvents) {
  if (ev.type === "assistant/message") tokensTotal += usageTotal(ev.data?.usage);
  if (ev.type !== "tool/call") continue;
  toolCounts[ev.data.name] = (toolCounts[ev.data.name] ?? 0) + 1;
  let args = null;
  try {
    args = JSON.parse(ev.data.arguments);
  } catch {
    /* ignore */
  }
  if (ev.data.name === "skill" && args !== null) skillNames[args.name] = (skillNames[args.name] ?? 0) + 1;
  if ((ev.data.name === "pwsh" || ev.data.name === "win_bash") && typeof args?.command === "string") {
    const p = normalizedProgram(args.command);
    programs[p] = (programs[p] ?? 0) + 1;
  }
}

const fixture = {
  fixtureVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "Sanitized real events from a DSH v4 session log; all human-readable text replaced with placeholders, paths/IDs rewritten. Fork session is a hand-built physical-format sample.",
  note: "Session 1 is the trimmed real log (in-progress revisions may append a synthetic runtime message to the tail). Session 2 marks an inherited fork prefix: events with seq < inheritedEventCount are parent copies and MUST be excluded from aggregation.",
  sessions: [
    { id: topHeader.id, header: topHeader, inheritedEventCount: 0, events: topEvents },
    { id: forkHeader.id, header: forkHeader, inheritedEventCount: forkInheritedEventCount, events: forkEvents },
  ],
  derived: {
    title: derivedTitle,
    lastPrompt: derivedLastPrompt,
    lastPromptMustIgnoreSourceKinds: ["runtime-context", "time-context", "progress-updates-nudge"],
    turns: topEvents.filter((e) => e.type === "turn/start").length,
    steps: topEvents.filter((e) => e.type === "step/start").length,
    commandRun: topEvents.filter((e) => e.type === "command/run").length,
    toolCallCounts: toolCounts,
    skillNames,
    shellPrograms: programs,
    tokensTotal,
    fork: {
      inheritedEventCount: forkInheritedEventCount,
      ownedTokens: 200,
      naiveAllEventsTokens: 1300,
      ownedTurns: 1,
      naiveAllEventsToolCalls: 1,
      ownedToolCalls: 0,
      title: "",
      lastPrompt: "[分叉子会话自己的用户消息]",
    },
  },
};

writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n", "utf8");
const size = readFileSync(OUT, "utf8").length;
console.log(`wrote ${OUT} (${size} bytes, ${topEvents.length + forkEvents.length} events)`);
console.log(
  JSON.stringify(
    {
      derivedTitle,
      derivedLastPrompt,
      turns: fixture.derived.turns,
      steps: fixture.derived.steps,
      toolCallCounts: toolCounts,
      skillNames,
      programs,
      tokensTotal,
    },
    null,
    1,
  ),
);

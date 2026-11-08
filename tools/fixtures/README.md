# tools/fixtures — 会话日志抽样与数据契约 fixture

本目录是 task-1「数据契约侦察」的复跑工具与脱敏样本，**不参与插件运行时**，也没有第三方依赖。
用途：在改动 `lib/aggregate.js` 的聚合口径、或新增 heavy/热力/排行榜功能前，用真实 DSH 会话日志验证字段路径与数量级；`events-sample.json` 供 `tools/selfcheck*.mjs` 离线断言。

环境：Node **22+**（用到 `zlib.zstdDecompressSync`，本机 Node 24 实测可用）；Windows 路径；只读，不会写 DSH 目录。

## 文件

| 文件 | 作用 |
|---|---|
| `probe-sessions.mjs` | 全量扫描：事件类型频率、header 字段覆盖率、每种事件的 data 字段出现率、tool 名/command 名分布、每个会话的 header/事件数/时间范围 |
| `probe-contract.mjs` | 字段契约细节：`tool/call`+`tool/result` 配对/成功标志/可推导耗时、`user/message` content part 形状、prompt source.kind 分布、turn/step 计数一致性、end-seed/ignorable、skill 调用 |
| `probe-details.mjs` | 第二批数字：标题覆盖率与来源、最后 prompt 过滤前后差异、token 按 origin 占比、分叉继承前缀重复量、shell 命令归一化 Top |
| `build-fixture.mjs` | 从一条真实日志裁剪 + 脱敏，生成 `events-sample.json`（含一个手写分叉样本） |
| `events-sample.json` | **已生成**的 18KB fixture：39 条事件、2 个会话、`derived` 期望值；可直接被 selfcheck import |

`probe-*.mjs` 默认读 `E:/Program Files/deepseekharness-webui/home/sessions`；换机器时改文件顶部的 `SESSIONS_ROOT` / `ROOT` 常量。

## 复跑命令（仓库根目录）

```bash
node tools/fixtures/probe-sessions.mjs --out _notes/probe-summary.json
node tools/fixtures/probe-contract.mjs --out _notes/probe-contract.json
node tools/fixtures/probe-details.mjs  --out _notes/probe-details.json
node tools/fixtures/build-fixture.mjs
```

- 输出 JSON 到 `_notes/`（仓库已忽略/可清理），**不要**把几百 KB 的 probe 输出提交进仓库。
- `build-fixture.mjs` 会覆盖 `tools/fixtures/events-sample.json`；正常开发不需要重跑，只有日志格式升级或契约字段变化时才重跑并复查 diff。
- 三条 probe 脚本合计约 10 秒（168 会话 / 97MB 压缩日志），可以随时复跑。

## events-sample.json 结构

```jsonc
{
  "fixtureVersion": 1,
  "source": "Sanitized real events ...",
  "note": "fork prefix MUST be excluded ...",
  "sessions": [
    { "id": "session-fixture-top-0001", "header": { /* SessionHeader */ }, "inheritedEventCount": 0, "events": [ /* 27 events */ ] },
    { "id": "session-fixture-fork-0002", "header": { /* isSeeded: true, parentSession */ }, "inheritedEventCount": 6, "events": [ /* 12 events */ ] }
  ],
  "derived": {
    "title": "...", "lastPrompt": "...", "turns": 2, "steps": 2, "commandRun": 1,
    "toolCallCounts": { "pwsh": 1, "read": 1, "skill": 1, "edit": 1 },
    "skillNames": { "example-skill": 1 },
    "shellPrograms": { "ls": 1 },
    "tokensTotal": 12757,
    "fork": { "inheritedEventCount": 6, "ownedTokens": 200, "naiveAllEventsTokens": 1300, "ownedTurns": 1, "naiveAllEventsToolCalls": 1, "ownedToolCalls": 0, "lastPrompt": "..." }
  }
}
```

覆盖的事件类型：`session` header、`permission/preset`、`command/run`+`command/done`、`turn/start|end`、`step/start|end`、`user/message`（真实 prompt + 注入型 `runtime-context` + 图片/file part）、`session/title`（fallback + provider 双条，验证取最后一条）、`tool/call`（pwsh/read/skill/edit，arguments 为 JSON 字符串）、`tool/result`（成功、带 meta、`isError:true`+`data.error`）、`assistant/message`（usage 故意缺 `totalTokens`，验证四桶求和）、`session/end-seed`。

### 自检导入示例

```js
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../fixtures/events-sample.json", import.meta.url), "utf8"));
const [top, fork] = fixture.sessions;
```

断言建议（全部已在契约文档 §8 列出）：`titleOf/lastPromptOf/sessionCounters/collectToolCalls/collectSkillCalls/collectCommands` 的输出要与 `derived` 一致；`fork` 用 `inheritedEventCount` 切片后 tokens 必须是 200、tool call 0，直接全量算会得到 1300 / 1（反向断言）。

## 隐私

- fixture 中所有用户文本、命令、路径、附件名、ID 都已替换为 `[示例…]` / `E:\fixture-workspace` / `call_fixture_N` 占位；会话 id 为 `session-fixture-*`。
- 保留的是**字段结构**和数值（usage token、seq/time 量级），不含真实会话内容。
- 重新生成 fixture 后提交前请 `git diff tools/fixtures/events-sample.json` 自查，确认没有真实文本残留。

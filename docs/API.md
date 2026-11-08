# HTTP API

宿主半在 DSH 的本地 web 服务上注册三条**只读**路由，浏览器半只消费它们，不写回任何数据。

| 路由 | 内容 | 大致耗时 |
| --- | --- | --- |
| `GET /session-stats/api/overview?window=<key>` | 指标卡、每日 / 构成 / 模型明细所需的一切聚合 | 预热后单次 < 100ms 量级，另有 `ttlMs` 响应缓存 |
| `GET /session-stats/api/heavy?window=<key>` | 热力日历、工具 / 命令 / 技能排行、分会话列表 | 复用同一份扫描结果，只做内存聚合 |
| `GET /session-stats/api/live` | 进程 CPU / 内存 / 事件循环延迟 / 运行时长 | 同步返回、无 I/O |

`window` 取 `24h` / `7d` / `14d` / `30d`，非法值回落到配置里的 `window`（默认 `7d`）。

## 通用约定

- **仅回环**：默认只接受 `Host` 为 `127.0.0.1` / `localhost` / `[::1]` 的请求；其余返回 `403`，响应体直接说明该开哪个开关（`allowPrivateHosts` 或 `allowedHosts`）。
- **只允许 GET**：其它方法返回 `405` 并带 `Allow: GET`。
- **不缓存**：所有响应都带 `Cache-Control: no-store`，浏览器不会拿到陈旧数据。
- **错误体**：`{ "ok": false, "error": "<code>", "message": "<人类可读说明>" }`；扫描失败时 `error` 为 `overview_failed` / `heavy_failed` / `live_failed`。

```jsonc
// 403：Host 不是回环地址
{ "ok": false, "error": "forbidden",
  "message": "this endpoint only answers loopback requests; to view the panel over a LAN address or reverse proxy, set \"allowPrivateHosts: true\" (private ranges only) or add the host to \"allowedHosts\" in cordis.patch.yml",
  "host": "stats.example.com:2820" }
```

## GET /session-stats/api/overview

```http
GET /session-stats/api/overview?window=7d
```

响应每个字段的含义：

| 字段 | 说明 |
| --- | --- |
| `window` | `key` / `granularity`（`hour` 或 `day`）/ `bucketCount` / `from` / `to` / `label` / `labelEn` / `timeZone` / `offsetMs` / `points[]`（柱图横轴标签） |
| `currency` | `code: "CNY"`、`symbol: "¥"`、`usdRate`、`usdSymbol: "$"`；人民币是权威口径，美元只是派生显示 |
| `totals.tokens` | 四个互斥桶之和：`input`（未缓存输入）+ `output` + `cacheRead` + `cacheWrite` |
| `totals.costCNY` / `costUSD` | 纯 token 成本；官方搜索费单独计入 `searchCostCNY` |
| `totals.costCNYTotal` | `costCNY + searchCostCNY`（`costCNYWithSearch` 同值，旧字段保留） |
| `totals.cacheHitRate` | `cacheRead / (input + cacheRead + cacheWrite)`，分母为 0 时记 0 |
| `totals.sessions` | 窗口内出现过 usage 事件的会话数；`avgTokensPerSession` 是窗口总量 ÷ 会话数 |
| `totals.pricedTokens` / `unpricedTokens` | 命中官方价目 / 未计价模型的 token 量；`priced` 为 `unpricedTokens === 0` |
| `totals.searches` / `searchCostCNY` | 官方联网搜索的请求次数与按次费用（¥0.005 / 次） |
| `pricing` | `tableVersion`、`peakMultiplier`、`peakEvents` / `offPeakEvents`、`mode`（`peak` / `offpeak` / `mixed` / `none`）、`holidays[]`、`makeupWorkdays[]`、`holidaySource`、`search{unit,priceCNY,note}`、`fallbackTier`、`priceLevels{official,unpriced}` |
| `modelPalette` / `otherModelColor` | 10 色模型色板；第 11 个及之后的模型统一用 `otherModelColor` |
| `composition` | Token 四桶构成切片 `{ key, tokens, share }`；`cacheWrite` 为 0 时不出现 |
| `costComposition` | 按模型成本占比切片 `{ key, route, label, vendor, color, costCNY, share }`；`share` 的分母是 **`costCNYTotal`（含搜索费）**，未计价模型（成本 0）不进入 |
| `daily[]` | 每个时间桶：`key` / `label` / `start` / `end` / 四桶 / `tokens` / `costCNY` / `costUSD` / `searches` / `searchCostCNY` / `events` / `models[]`（当天各模型的 `route,label,color,vendor,priceLevel,tokens,costCNY,costUSD,share`） |
| `models[]` | 每个模型：`provider` / `model` / `route` / `label` / `color` / 四桶 / `tokens` / `costCNY` / `costUSD` / `share` / `events` / `priced` / `priceKey` / `vendor` / `priceLevel` / `sourceUrl`，按 token 降序 |
| `today` / `yesterday` | `{ tokens, costCNY, sessions, cacheHitRate }`，按 `timeZone` 切日；当天 / 昨天没有活动时为 `null`。`costCNY` **只含模型成本，不含官方搜索费**，与 `daily[].costCNY` 同口径 |
| `forecast` | `{ slope, intercept, monthEndEstimate, sigma, dataPoints, daysLeft }`；有效数据不足 7 天时为 `null`。`monthEndEstimate` 是**月末那一天的日成本**（不是累计），由 `intercept + slope × (29 + daysLeft)` 得来 |
| `scan` | 本次扫描的 `sessionsScanned` / `sessionsTotal` / `readCount` / `cachedCount`，用于排查缓存命中情况 |

> `models[]` 末尾可能追加一条**合成行**：有官方搜索时 `route` 为 `official/server-tool-search`、`costsOnly: true`、`searches` 为次数、`shareByCost` 为成本占比。它不进 token 环图（0 token 会扭曲占比），只出现在明细表与成本卡副行。

```jsonc
{
  "ok": true,
  "generatedAt": 1793718000000,
  "window": { "key": "7d", "granularity": "day", "bucketCount": 7,
              "from": 1793203200000, "to": 1793808000000,
              "label": "近 7 天", "labelEn": "Last 7 days",
              "timeZone": "Asia/Shanghai", "offsetMs": 28800000,
              "points": ["11/3", "11/4", "11/5", "11/6", "11/7", "11/8", "11/9"] },
  "currency": { "code": "CNY", "symbol": "¥", "usdRate": 7.1, "usdSymbol": "$" },
  "totals": { "tokens": 764900000, "input": 3380000, "output": 3410000,
              "cacheRead": 758100000, "cacheWrite": 0,
              "costCNY": 47.48, "costUSD": 6.69,
              "searches": 3, "searchCostCNY": 0.015,
              "costCNYTotal": 47.495, "costCNYWithSearch": 47.495,
              "cacheHitRate": 0.99556, "sessions": 22, "avgTokensPerSession": 34768182,
              "pricedTokens": 714900000, "unpricedTokens": 50000000, "priced": false,
              "unpricedModels": 1, "events": 1234 },
  "pricing": { "tableVersion": "vendor-official-2026-11", "peakMultiplier": 2,
               "peakEvents": 10, "offPeakEvents": 4, "mode": "mixed",
               "holidays": [], "makeupWorkdays": [], "holidaySource": "国办发明电〔2025〕7号",
               "usdRate": 7.1, "fallbackTier": "deepseek-flash",
               "officialLists": ["vendor-official"],
               "search": { "unit": "per-request", "priceCNY": 0.005, "note": "¥5 / 1000 次成功请求" },
               "priceLevels": { "official": 2, "unpriced": 1 } },
  "modelPalette": ["#12b886", "#4dabf7", "#9775fa", "#ff922b", "#22b8cf",
                   "#f06595", "#fcc419", "#5c7cfa", "#b08968", "#adb5bd"],
  "otherModelColor": "#868e96",
  "composition": [
    { "key": "cacheRead", "tokens": 758100000, "share": 0.991111 },
    { "key": "input", "tokens": 3380000, "share": 0.004419 },
    { "key": "output", "tokens": 3410000, "share": 0.004458 }
  ],
  "costComposition": [
    { "key": "deepseek/deepseek-v4.1-flash", "route": "deepseek/deepseek-v4.1-flash",
      "label": "deepseek-v4.1-flash", "vendor": "deepseek", "color": "#12b886",
      "costCNY": 47.48, "share": 1 }
  ],
  "daily": [
    { "key": "0", "label": "11/3", "start": 1793203200000, "end": 1793289600000,
      "input": 482000, "output": 487000, "cacheRead": 108000000, "cacheWrite": 0,
      "tokens": 108969000, "costCNY": 6.78, "costUSD": 0.955,
      "searches": 0, "searchCostCNY": 0, "events": 176,
      "models": [
        { "route": "deepseek/deepseek-v4.1-flash", "label": "deepseek-v4.1-flash",
          "color": "#12b886", "vendor": "deepseek", "priceLevel": "official",
          "tokens": 108969000, "costCNY": 6.78, "costUSD": 0.955, "share": 1 }
      ] }
  ],
  "models": [
    { "provider": "deepseek", "model": "deepseek-v4.1-flash",
      "route": "deepseek/deepseek-v4.1-flash", "label": "deepseek-v4.1-flash",
      "color": "#12b886", "input": 3380000, "output": 3410000,
      "cacheRead": 758100000, "cacheWrite": 0, "tokens": 764900000,
      "costCNY": 47.48, "costUSD": 6.69, "share": 1, "events": 1234,
      "priced": true, "priceKey": "deepseek-flash", "vendor": "deepseek",
      "priceLevel": "official",
      "sourceUrl": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing" }
  ],
  "today":     { "tokens": 84100000, "costCNY": 5.21, "sessions": 3, "cacheHitRate": 0.994 },
  "yesterday": { "tokens": 76500000, "costCNY": 4.83, "sessions": 2, "cacheHitRate": 0.991 },
  "forecast":  { "slope": 0.041, "intercept": 4.2, "monthEndEstimate": 6.25,
                 "sigma": 0.31, "dataPoints": 12, "daysLeft": 21 },
  "scan": { "sessionsScanned": 22, "sessionsTotal": 22, "readCount": 22, "cachedCount": 0 }
}
```

## GET /session-stats/api/heavy

```http
GET /session-stats/api/heavy?window=7d
```

比分块加载里「慢的那一半」：热力日历、三个排行榜、会话列表。它**复用 overview 那一轮的扫描结果**，不会触发第二次全量读取；响应另有独立缓存（TTL 同 `ttlMs`）。

排行榜是按天统计的，所以 `window` 会映射成它覆盖的自然日：`24h` 通常落在两天里，`7d` 是 7 天。

| 字段 | 形状 | 口径 |
| --- | --- | --- |
| `heatmap[]` | `{ date: "YYYY-MM-DD", tokens, turns, sessions }` × 56 | 最近 8 周，旧 → 新；`sessions` 是当天有活动的会话数（按 session 去重） |
| `toolLeaderboard[]` | `{ name, count, lastCalledAt, errorCount, successRate, avgMs }`，Top 20 降序 | 来自 `tool/call` 的 `data.name`。`errorCount` 与 `successRate` / `avgMs` 靠 `tool/result` 配对：`successRate = (配对结果数 − errorCount) / 配对结果数`，**没有配对结果时为 `null`**；`avgMs` 是配对结果的平均耗时，逐条钳到 0–1 小时，没配对也为 `null`；配对不上的调用**不算失败**，也不进分母。前端按 `<95%` / `80–95%` / `<80%` 三档着色 |
| `commandLeaderboard[]` | `{ program, count, lastCalledAt }`，Top 20 降序 | **Shell 程序口径**：`win_bash` / `pwsh` 调用里 `arguments.command` 的首个 token——先剥掉 `cd <dir> &&` 前缀和 `VAR=value` 赋值，再跳过空串与 `$` / `=` 开头的碎片。不是斜杠命令 `command/run`——实测那类事件只有个位数，做不成排行 |
| `skillLeaderboard[]` | `{ name, count, lastCalledAt }`，Top 20 降序 | `tool/call` 且 `name === "skill"`，取 `arguments.name` |
| `sessions[]` | 见下，最多 100 条，按 `lastActiveAt` 降序 | 主会话与子会话都在，`isSubagent` 区分 |
| `generatedAt` | 毫秒时间戳 | 生成时刻 |

会话字段：

| 字段 | 说明 |
| --- | --- |
| `id` / `title` | 会话 id；标题取最后一条 `session/title`。没有标题时先退到 `lastPrompt` 前 24 字，还空就返回空串，前端显示「未命名会话」 |
| `turns` / `steps` | `turn/start` / `step/start` 的计数 |
| `tokens` / `costCNY` | 这个会话**从创建到现在的累计**（所有能读到的事件），不是「统计窗口内」的量，也不随 `window` 变化 |
| `cacheHitRate` | 0–1，口径与指标卡一致 |
| `lastPrompt` | 最后一条用户消息的文本，截断 80 字 |
| `lastActiveAt` / `createdAt` | 毫秒时间戳 |
| `workspace` | 会话的工作目录（`header.cwd`） |
| `isArchived` | **当前恒为 `false`**：DSH 的会话 API 没有归档字段，插件不编造 |
| `isSubagent` | `header.origin === "subagent"`；前端默认隐藏子会话，可用「包含子会话」开关显示 |

```jsonc
{
  "ok": true,
  "generatedAt": 1793718000000,
  "heatmap": [
    { "date": "2026-09-15", "tokens": 0, "turns": 0, "sessions": 0 },
    { "date": "2026-11-09", "tokens": 84100000, "turns": 41, "sessions": 3 }
  ],
  "toolLeaderboard":    [ { "name": "read", "count": 214, "lastCalledAt": 1793717000000,
                           "errorCount": 2, "successRate": 0.9907, "avgMs": 236 } ],
  "commandLeaderboard": [ { "program": "cd", "count": 118, "lastCalledAt": 1793716000000 } ],
  "skillLeaderboard":   [ { "name": "code-review", "count": 4, "lastCalledAt": 1793610000000 } ],
  "sessions": [
    { "id": "8f1c…", "title": "会话统计 3.0 改造", "turns": 41, "steps": 96,
      "tokens": 84100000, "costCNY": 5.21, "cacheHitRate": 0.994,
      "lastPrompt": "把 README 重做成有图的形态 …",
      "lastActiveAt": 1793717000000, "createdAt": 1793500000000,
      "workspace": "E:\\work\\demo-project",
      "isArchived": false, "isSubagent": false }
  ]
}
```

## GET /session-stats/api/live

同步返回、不做任何 I/O，面板每 5 秒轮询一次。

| 字段 | 说明 |
| --- | --- |
| `cpu.single` / `cpu.machine` / `cpu.cores` | 进程 CPU 百分比（可 > 100%，即多核当量）、整机占比（`single / cores`）、核数 |
| `memory` | `rssMB` / `heapUsedMB` / `heapTotalMB` / `externalMB` / `arrayBuffersMB` |
| `eventLoop` | `p99ms` / `meanMs` / `resolutionMs`，每次读取后 reset，反映「上次轮询以来」的延迟 |
| `uptimeSec` / `uptimeText` | 进程运行时长，文本形如 `42s` / `29m` / `3h 05m` / `2d 4h` |
| `pid` / `node` / `platform` | 进程信息 |
| `history` | `values[]`（环形缓冲）、`peak`、`windowSec`、`intervalMs`；默认 5s × 60 = 5 分钟 |

```jsonc
{
  "ok": true, "sampledAt": 1793718000000, "intervalMs": 5000, "points": 60, "windowSec": 300,
  "cpu": { "single": 120.8, "machine": 5, "cores": 24 },
  "memory": { "rssMB": 619, "heapUsedMB": 190, "heapTotalMB": 240,
              "externalMB": 6, "arrayBuffersMB": 2 },
  "eventLoop": { "p99ms": 12.1, "meanMs": 2.5, "resolutionMs": 10 },
  "uptimeSec": 1740, "uptimeText": "29m", "pid": 2866, "node": "v24.21.0", "platform": "win32",
  "history": { "values": [0, 0.1], "peak": 0.1, "windowSec": 300, "intervalMs": 5000 }
}
```

## 缓存与增量

- **会话级**：按 `sessionPersistence.list()` 的 revision 判断会话是否变化，只重读变化的会话；没有 persistence 后端时退化为「每会话 `ttlMs`」。
- **响应级**：`overview` 与 `heavy` 各自按 `window + timeZone` 缓存 `ttlMs`（默认 60s），`ttlMs: 0` 表示每次请求都重算（会话级增量仍生效）。
- **预热**：DSH 启动约 2 秒后静默跑一次全量扫描，让第一次打开面板时缓存是热的；失败只写 debug 日志，不影响功能。
- **读取容错**：单会话读取超时（`readTimeoutMs`，默认 10s）或日志损坏时跳过该会话并记日志，其余照常统计。

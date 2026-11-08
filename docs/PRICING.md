# 价目与计费口径

> 价目版本：`vendor-official-2026-11` · 抓取日期 2026-11-04 · 金额单位：**百万（1,000,000）tokens**
> 本文与 `lib/pricing.js` 的 `OFFICIAL_PRICE_TABLE` 一一对应；改价时两边一起改，并重跑 `node tools/selfcheck.mjs`。

## 只认「原厂官方价目」

面板里的成本是**本地估算**，口径刻意收得很窄：只使用各模型厂商官网公布的按量计费价目。

- DeepSeek 用 DeepSeek 的价目、GLM 用智谱的、Kimi 用 Moonshot 的、Claude 用 Anthropic 的……
- **转售 / 聚合平台的价目、跨厂商兜底价一律不用**——同一个模型在不同渠道的价格可能差一倍，混用会让「哪家贵」这个判断失效。
- 查不到官方价目的模型**不猜、不计钱**：响应里 `priceLevel: "unpriced"`、成本记 0，明细列显示「未计价」，表底提示「N 个模型无官方定价，未计入金额（tokens x.xxM）」。

## 计价规则

| 规则 | 说明 |
| --- | --- |
| 四桶互斥 | 总 tokens = 未缓存输入 + 输出 + 缓存读取 + 缓存写入；`input` 本身就是**未缓存**部分 |
| 缓存写入 | 有独立写入价的模型用独立价（OpenAI 30 分钟档、Anthropic 5 分钟档），没有则按「未命中输入」价 |
| 峰谷 | 只对 DeepSeek 生效：工作日北京时间 09:00–12:00、14:00–18:00（左闭右开）**×2**；其余时刻、周末、法定节假日、调休外的日子按谷价 |
| 汇率 | 人民币是权威口径；美元 = 人民币 / `usdRate`（默认 7.1）。中国厂商 CNY 价目不做折算，海外厂商 USD 价目按 `usdRate` 折算成 CNY 展示 |
| 官方搜索 | 按次计费，见下文；不进环形图（0 token 会扭曲占比），只出现在指标卡副行与分模型明细的合成行 |
| 取价时机 | 按**事件时间**取价：Gemini 4 Argon 在 2026-11-30（含）前用优惠价，2026-12-01 00:00（北京）起用正式价 |

## 价目快照

只取**短上下文 / 标准档**：OpenAI 的 ≥272K 长上下文档、xAI 的 ≥200K 档、阿里云非北京地域价、Anthropic 的 >100K 档都**没有**实现（原因写在 `lib/pricing.js` 对应表项的注释里）。阿里云中国站 CNY 价目为 JS 渲染、未能完整核验，因此采用其官方国际站 USD 价目，再按 `usdRate` 折算展示。

### DeepSeek

<sub>CNY / 百万 tokens · 峰时 ×2</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek Flash | `deepseek-flash` | 0.02 | 1 | 1 | 4 |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 0.15 | 4.5 | 4.5 | 13.5 |

<sub>来源：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing></sub>

### Zhipu AI

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| GLM-5.3 | `glm-5.3` | 2 | 8 | 8 | 28 |
| GLM-5.3-Flash | `glm-5.3-flash` | 0.23 | 0.8 | 0.8 | 2.8 |
| GLM-5.3-FlashX | `glm-5.3-flashx` | 0.57 | 2 | 2 | 7 |
| GLM-5.2 | `glm-5.2` | 2 | 8 | 8 | 28 |
| GLM-5.1 | `glm-5.1` | 1.3 | 6 | 6 | 24 |

<sub>来源：<https://docs.bigmodel.cn/cn/guide/start/pricing.md></sub>

### Moonshot AI

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Kimi K3.1 Pro | `kimi-k3.1-pro` | 1.3 | 13 | 13 | 68 |
| Kimi K3.1 Pro Highspeed | `kimi-k3.1-pro-highspeed` | 1.3 | 26 | 26 | 136 |
| Kimi K3 | `kimi-k3` | 2 | 20 | 20 | 100 |
| Kimi K2.7 Code | `kimi-k2.7-code` | 1.3 | 6.5 | 6.5 | 27 |
| Kimi K2.7 Code Highspeed | `kimi-k2.7-code-highspeed` | 2.6 | 13 | 13 | 54 |
| Kimi K2.6 | `kimi-k2.6` | 1.1 | 6.5 | 6.5 | 27 |

<sub>来源：<https://platform.kimi.com/docs/pricing/chat></sub>

### Alibaba Cloud

<sub>USD / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Qwen3.8 Max | `qwen3.8-max` | 0.165 | 2.0625 | 1.65 | 4.951 |
| Qwen3.8 Flash | `qwen3.8-flash` | 0.0113 | 0.14125 | 0.113 | 0.382 |
| Qwen3.7 Plus | `qwen3.7-plus` | 0.04 | 0.5 | 0.4 | 1.6 |

<sub>来源：<https://www.alibabacloud.com/help/zh/model-studio/model-pricing></sub>

### MiniMax

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| MiniMax-M3 | `minimax-m3` | 0.42 | 2.1 | 2.1 | 8.4 |
| MiniMax-M3.1-Flash | `minimax-m3.1-flash` | 0.1 | 1 | 1 | 4 |

<sub>来源：<https://platform.minimax.cn/docs/pricing/overview.md></sub>

### Tencent

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Hy3 | `hy3` | 0.25 | 1 | 1 | 4 |
| Hy4 preview | `hy4-preview` | 0.3 | 6 | 6 | 18 |

<sub>来源：<https://cloud.tencent.com/document/product/1759/127342></sub>

### StepFun

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Step 5 Preview | `step-5-preview` | 0.7 | 7 | 7 | 20 |

<sub>来源：<https://platform.stepfun.com/docs/zh/guides/pricing/details.md></sub>

### Xiaomi

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| MiMo-V2.6-Pro | `mimo-v2.6-pro` | 0.025 | 3 | 3 | 6 |
| MiMo-V2.6-Flash | `mimo-v2.6-flash` | 0.02 | 1 | 1 | 2 |
| MiMo-V2.6-Pro-Ultraspeed | `mimo-v2.6-pro-ultraspeed` | 0.25 | 30 | 30 | 60 |

<sub>来源：<https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go></sub>

### Meituan

<sub>CNY / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| LongCat-2.0 | `longcat-2.0` | 0.1 | 5 | 5 | 20 |

<sub>来源：<https://longcat.chat/platform/docs/zh/pricing/long-cat-2.0></sub>

### xAI

<sub>USD / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Grok 4.7 | `grok-4.7` | 0.5 | 2 | 2 | 6 |
| Grok 4.6 | `grok-4.6` | 0.5 | 2 | 2 | 6 |
| Grok 4.5 | `grok-4.5` | 0.3 | 2 | 2 | 6 |
| Grok 4.3 | `grok-4.3` | 0.2 | 1.25 | 1.25 | 2.5 |
| Grok Build 0.1 | `grok-build-0.1` | 0.2 | 1 | 1 | 2 |

<sub>来源：<https://docs.x.ai/developers/pricing></sub>

### OpenAI

<sub>USD / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| GPT-6 Luna | `gpt-6-luna` | 0.01 | 0.125 | 0.1 | 0.5 |
| GPT-5.6 Luna | `gpt-5.6-luna` | 0.02 | 0.25 | 0.2 | 1.2 |
| GPT-6.1 Sol | `gpt-6.1-sol` | 0.1 | 2.5 | 2 | 10 |
| GPT-6.1 Terra | `gpt-6.1-terra` | 0.05 | 1.25 | 1 | 5 |
| GPT-6 Sol | `gpt-6-sol` | 0.2 | 2.5 | 2 | 10 |
| GPT-5.6 Sol | `gpt-5.6-sol` | 0.4 | 5 | 4 | 20 |
| GPT-5.6 Terra | `gpt-5.6-terra` | 0.2 | 2.5 | 2 | 12 |
| GPT-5.1 | `gpt-5.1` | 0.125 | 1.25 | 1.25 | 10 |
| GPT-5 | `gpt-5` | 0.125 | 1.25 | 1.25 | 10 |
| GPT-5 mini | `gpt-5-mini` | 0.025 | 0.25 | 0.25 | 2 |
| GPT-5.4 mini | `gpt-5.4-mini` | 0.075 | 0.75 | 0.75 | 4.5 |
| GPT-5.4 nano | `gpt-5.4-nano` | 0.02 | 0.2 | 0.2 | 1.25 |
| GPT-4.1 | `gpt-4.1` | 0.5 | 2 | 2 | 8 |
| GPT-4o mini | `gpt-4o-mini` | 0.075 | 0.15 | 0.15 | 0.6 |

<sub>来源：<https://developers.openai.com/api/docs/pricing.md></sub>

### Anthropic

<sub>USD / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Claude Fable 5.1 | `claude-fable-5-1` | 0.25 | 12.5 | 10 | 50 |
| Claude Opus 5.5 | `claude-opus-5-5` | 0.2 | 5 | 4 | 20 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 0.1 | 2.5 | 2 | 10 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 0.01 | 0.125 | 0.1 | 0.5 |

<sub>来源：<https://platform.claude.com/docs/en/about-claude/pricing></sub>

### Google

<sub>USD / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Gemini 4 Argon（优惠期，至 2026-11-30） | `gemini-4-argon` | 0.1 | 2 | 2 | 10 |
| Gemini 4 Argon（正式价，2026-12-01 起） | `gemini-4-argon` | 0.2 | 4 | 4 | 20 |

<sub>来源：<https://ai.google.dev/gemini-api/docs/latest-model></sub>

### Meta

<sub>USD / 百万 tokens</sub>

| 模型 | 价目键 | 缓存命中 | 缓存写入 | 未命中输入 | 输出 |
| --- | --- | --- | --- | --- | --- |
| Muse Spark 1.3 Contributor | `muse-spark-1.3-contributor` | 0.15 | 1.25 | 1.25 | 4.25 |
| Muse Wonder | `muse-wonder` | 0.2 | 4 | 4 | 20 |

<sub>来源：<https://www.meta.ai/pricing></sub>


## 未计价（`priceLevel: "unpriced"`，成本记 0）

- **Reflection Beam / Iceman**：无公开按量计费价目。
- **Meta Muse Spark 1.2**：官方价目未列该版本（1.3 已入表）。
- **小米 MiMo V2.5 / V2.5-Pro**：官方页标注 2026-10-21 已下线。
- **LongCat 2.5 Preview Free**：官方定价页只列 LongCat-2.0。
- 以及任何未出现在上表的模型 id（例如 `claude-opus-4.1`、`kimi-k2.7-codex`）。

## 峰谷与节假日

DeepSeek 只对**工作日**的 09:00–12:00 / 14:00–18:00 收峰价，其余时段（含周末、法定节假日）为谷价。这里有两个只用「周末判断」会算错的地方：

| 情况 | 举例 | 正确处理 |
| --- | --- | --- |
| 长假中间的**工作日** | 2026-02-16（周一，春节假期内） | 按假期 → **谷价**（当工作日会虚高 100%） |
| **调休上班的周末** | 2026-02-14（周六，春节调休） | 按工作日 → **峰价**（当周末会少算 50%） |

插件内置 2026 年中国法定节假日 **33 天**与调休上班日 **6 天**（依据[国办发明电〔2025〕7号](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)），跨年后请更新内置表，或在 `cordis.patch.yml` 里显式给出新一年的 `holidays` / `makeupWorkdays`（传 `[]` 表示清空）。

峰谷时段是官方按**北京时间**定义的，不随 `timeZone` 配置变化；`timeZone` 只决定「日 / 小时桶怎么切」。

## 官方搜索

DSH 的联网搜索走 `dsh-web-search-deepseek`，**每次搜索是一次独立 API 调用**，并在会话日志里留下一条 `web/deepseek-search-llm-request` 事件。

- 计费单位是**这条事件**（每个 query 一次请求），不是 `tool/call` 里的 `web_search`——实测同会话 85 条搜索请求事件 vs 30 条 tool/call，数错会少算。
- 官方价目：**每 1,000 次成功请求 ¥5**，即 **¥0.005 / 次**，平铺，不参与峰谷、不做汇率折算。
- `web_fetch` **不统计**：DSH 的 fetch 是本地直连，不走 DeepSeek Fetch API，不产生费用。
- 搜索调用自身的 token（那次 messages 调用）**日志里没有 usage**，本地无法还原 token 费用，只能统计「按次费用」，所以面板金额与平台账单可能不完全一致。

响应中的相关字段：`totals.searches`、`totals.searchCostCNY`、`totals.costCNYTotal = totals.costCNY + totals.searchCostCNY`；`daily[].searches` / `daily[].searchCostCNY`；`pricing.search`。

## 口径细节

- **只取短上下文 / 标准档**：OpenAI 的 ≥272K、xAI 的 ≥200K、Anthropic 的 >100K、阿里云的非北京地域价都没有实现，上表即插件实际取用的档位。
- **缓存写入价**：OpenAI 用 30 分钟档、Anthropic 用 5 分钟档、Kimi 用 5 分钟 TTL 档（1 小时档未建模）；官方标注「缓存写入免费」的厂商（GLM、MiMo 等）按未命中输入价计。
- **促销与折扣**：MiniMax-M3 的长期 5 折已计入表内；LongCat-2.0 的限时折扣**未**采用，按刊例价计。
- **别名映射**：`k3` / `k3-256k` → Kimi K3，`kimi-for-coding` → K2.7 Code，`kimi-for-coding-highspeed` → K2.7 Code Highspeed；`deepseek-v4-flash` 按 Flash 档计。
- **腾讯混元**用 TokenHub 刊例价（批量推理 5 折与开源权重本地部署的免费价不采用）。
- **Muse 系列**（Meta）使用运营方提供的官方价目页。
- **step-5-preview** 的缓存命中价自 2026-10-14 起调整为 0.70。

## 怎么改价

1. 改 `lib/pricing.js` 的 `OFFICIAL_PRICE_TABLE`（带 `sourceUrl` 与 `verifiedAt`）；
2. 同步改 `PRICE_TABLE_VERSION`（会出现在响应里，便于排查）；
3. 同步更新本文档的价目快照（直接从代码生成，别手抄）；
4. 跑 `node tools/selfcheck.mjs`。

> 价格只用于看板展示，不是账单。调价、长上下文档、地区差价都可能让面板金额与平台后台不一致。

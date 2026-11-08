<p align="center"><strong>简体中文</strong> | <a href="README_en.md">English</a></p>

<div align="center">
  <img src="https://raw.githubusercontent.com/Oblivionis7999/dsh-session-stats-panel/main/icon.svg" alt="肥鱼用量分析" width="128">
  <h1>肥鱼用量分析</h1>
  <p>
    DeepSeek Harness 左侧栏的用量统计页面。<br>
    看 token 和钱花在哪、今天比昨天多还是少，还有 DSH 自己吃多少 CPU 和内存。
  </p>
  <p><b>零第三方依赖</b> · 图表全是手写 SVG · 只读本机会话日志，不上传</p>

  <p>
    <a href="https://www.npmjs.com/package/dsh-session-stats-panel"><img src="https://img.shields.io/badge/version-3.1.0-12b886" alt="Version"></a>
    <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.5-12b886" alt="DSH">
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Oblivionis7999/dsh-session-stats-panel?color=12b886" alt="License"></a>
    <a href="https://github.com/Oblivionis7999/dsh-session-stats-panel/stargazers"><img src="https://img.shields.io/github/stars/Oblivionis7999/dsh-session-stats-panel?color=12b886" alt="Stars"></a>
    <a href="https://github.com/Oblivionis7999/dsh-session-stats-panel/issues"><img src="https://img.shields.io/github/issues/Oblivionis7999/dsh-session-stats-panel?color=12b886" alt="Issues"></a>
    <img src="https://img.shields.io/badge/node-%E2%89%A522.19-12b886" alt="Node">
  </p>

<a href="#这是什么">这是什么</a> • <a href="#效果">效果</a> • <a href="#核心特性">核心特性</a> • <a href="#安装">安装</a> • <a href="#配置">配置</a> • <a href="#页面速览">页面速览</a> • <a href="#数据与隐私">数据与隐私</a> • <a href="#开发与自检">开发与自检</a> • <a href="#常见问题">常见问题</a>
</div>

## 这是什么

一个 DSH 插件。装上之后左侧栏会多一个「肥鱼用量分析」页面，点开就是本机会话的用量统计。名字来自社区对 DeepSeek 的叫法：小鲸鱼，也叫蓝色大肥鱼。

页面上能看到这些：

- 一共用了多少 token、大概花了多少钱、缓存命中率多少（复用了多少之前读过的内容）
- 每个模型占多少，每天用了多少
- 今天比昨天多还是少，月底大概会花多少
- 最近 8 周哪几天忙，哪些工具和命令用得最多
- 每个会话花了多少、最后在问什么

数据全部从本机的会话日志算出来。宿主那边只开几个只读接口，浏览器那边只负责画图。图都是手写的 SVG，没有图表库，包也没有第三方依赖。

它不上传数据，不改会话日志，也不联网。价格是打包在里面的官方价目表快照。

> 3.0 去掉了 2.x 的 K 线模式，面板只剩统计这一个视图，接口也精简了。

## 效果

<table>
<tr>
<td width="50%" align="center"><a href="docs/screenshots/panel-light.png"><img src="https://raw.githubusercontent.com/Oblivionis7999/dsh-session-stats-panel/main/docs/screenshots/panel-light.png" alt="浅色主题下的肥鱼用量分析页面" width="100%"></a></td>
<td width="50%" align="center"><a href="docs/screenshots/panel-dark.png"><img src="https://raw.githubusercontent.com/Oblivionis7999/dsh-session-stats-panel/main/docs/screenshots/panel-dark.png" alt="深色主题下的肥鱼用量分析页面" width="100%"></a></td>
</tr>
<tr>
<td align="center">浅色主题，近 7 天 · 示例数据（已脱敏）</td>
<td align="center">深色主题，跟着宿主走 · 示例数据（已脱敏）</td>
</tr>
</table>

<p align="center"><a href="docs/screenshots/panel-full.png"><img src="https://raw.githubusercontent.com/Oblivionis7999/dsh-session-stats-panel/main/docs/screenshots/panel-full.png" alt="肥鱼用量分析整页" width="100%"></a></p>
<p align="center">整页：分模型明细、热力日历、三个排行和会话列表 · 示例数据（已脱敏）</p>

## 核心特性

| 特性 | 说明 |
| --- | --- |
| **四个指标卡** | 总 token、预估成本、会话数、缓存命中率。时间档和币种在右上角切，切币种不发新请求 |
| **今日概览** | 今天和昨天比：涨了 ▲、跌了 ▼、昨天没数据就是 `—`。今天还没用过，四个都是 `—`，不报错 |
| **每日消耗** | 一天一根柱子，按模型分颜色。柱子的总和跟指标卡的总数对得上 |
| **Token 与成本环图** | 两个圈：一个看 token 怎么分的（未缓存输入、输出、缓存读、缓存写），一个看钱花在哪个模型上。颜色和下面的明细表对得上 |
| **成本预测** | 拿最近 30 天的日成本算一条直线，虚线画到月底，标个大概值。有效天数不够 7 天就不画 |
| **活跃度热力日历** | 最近 8 周，一天一格，颜色越深用量越大。能在 token 和会话数之间切，鼠标停上去看那天的数字。没活动的日子是浅色，不是空着 |
| **工具 / 命令 / 技能排行** | 三个榜，按调用次数从多到少排。命令看的是 shell 里跑的第一个词，像 `cd`、`git`；工具那栏还带成功率和平均耗时。名字太长会截断，鼠标停上去看全名 |
| **分会话列表** | 一个会话一张卡：标题、轮数、步数、token、成本、最后一句提示词。能按标题和提示词搜，能按最近、token、成本排。子会话默认藏起来，可以打开 |
| **分块加载** | 打开先出指标卡，热力、排行、会话列表后到。切时间档时旧数据不消失，顶上一条进度条 |
| **运行状态采样** | DSH 自己的 CPU、内存、卡不卡（事件循环延迟）、运行了多久。每 5 秒采一次，下面是最近 5 分钟的 CPU 曲线 |
| **主题跟随** | 颜色跟着 DSH 的深浅主题走，不另配一套色板 |
| **原厂价目** | 只按各家官网的价目算。查不到官方价的模型标「未计价」，不猜 |

本机实测（约 170 个会话、约 375 MB 日志）：冷启动全量扫描约 2.4 秒，这一步在 DSH 启动 2 秒后由后台预热跑掉，所以第一次打开面板不用等；overview 响应约 17 kB（15–18 kB 之间浮动），heavy 约 48 kB，heavy 复用同一轮扫描、只多花 3 ms。3.0 之前一次响应 62.8 kB，其中 72% 是已经删掉的 K 线数据。

## 安装

装的是 DSH 插件，不是独立软件。`dsh plugin add` 会把依赖写进 profile，把包里的 `cordis.patch.yml` 叠进 bundle 层，不用手改配置。

```powershell
# 方式一：从 npm 装（3.1.0 发布之后可用）
dsh plugin --profile web add dsh-session-stats-panel

# 方式二：直接从 GitHub 装
dsh plugin --profile web add "git+https://github.com/Oblivionis7999/dsh-session-stats-panel.git"

# 方式三：本地开发，link 进 profile，不复制文件
dsh plugin --profile web add "link:E:\path\to\dsh-session-stats-panel"

# 卸载
dsh plugin --profile web remove dsh-session-stats-panel
```

> npm 上的 3.1.0 要等发版之后才有。发版前先用方式二从 GitHub 装。

装完按这个顺序走：

1. 先把正在跑的 DSH 停掉。跑着的时候依赖会被锁住，装完再起
2. 用上面任意一条命令安装
3. 重启 DSH。bundle 列表变了不会热重载
4. 浏览器 `Ctrl+Shift+R` 强刷一次。客户端产物是打开页面的时候才取的
5. 左侧栏的面板列表里会多一个 **肥鱼用量分析**（在「插件」「自动化任务」上面），点进去就是

> 插件不占新端口，也不写你的数据。宿主那边只在本地 web 服务上挂几个只读路由。

### 兼容性

| 插件版本 | 状态 | DSH |
| --- | --- | --- |
| **3.1.x**（当前） | ✅ 主线：热力日历、三个排行、会话列表、今日概览、成本预测、分块加载、工具成功率 | `>= 0.2.1-rc.5` |
| 2.x | 🗄 归档 | `>= 0.2.1-rc.5` |

## 配置

所有项都有默认值，不写也能跑。要改就写进 `cordis.patch.yml` 的 `config`：

```yaml
- insert:
    - id: session-stats-panel
      name: dsh-session-stats-panel
      config:
        window: 7d                # 默认时间档：24h | 7d | 14d | 30d
        usdRate: 7.1              # 美元的显示汇率，人民币才是准的
        timeZone: Asia/Shanghai   # 按哪个时区切天和小时（决定「昨天」从几点算）
        ttlMs: 60000              # overview 缓存多久（毫秒），0 表示每次重算
        # 用手机或另一台电脑通过局域网 IP 打开时才要开；
        # 公网域名一直拒，免得网页用 DNS rebinding 把本地日志读走
        allowPrivateHosts: false
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `window` | `"7d"` | 打开时的默认时间档：`24h` / `7d` / `14d` / `30d` |
| `usdRate` | `7.1` | 人民币换美元的显示汇率，只影响美元显示 |
| `timeZone` | `"Asia/Shanghai"` | 按哪个时区切天和小时，不在中国就改成自己的区 |
| `ttlMs` | `60000` | overview 响应缓存；`0` 表示每次请求都重算（会话级增量缓存还生效） |
| `sessionConcurrency` | `3` | 一次扫描同时读几个会话（1–16） |
| `readTimeoutMs` | `10000` | 单个会话读多久算超时，超时就跳过它、记条日志 |
| `liveIntervalMs` | `5000` | `/live` 多久采一次 CPU（1000–60000） |
| `livePoints` | `60` | CPU 曲线留多少个点（6–600），默认 5 秒 × 60 = 5 分钟 |
| `allowedHosts` | `[]` | 额外放行的 Host，反代域名写这里 |
| `allowPrivateHosts` | `false` | 放行私有网段、`*.local`、单标签主机名 |
| `holidays` | 内置 2026 表 | 按谷价算的北京日期，传 `[]` 是显式清空 |
| `makeupWorkdays` | 内置 2026 表 | 调休上班的周末，按工作日算峰价 |
| `debug` | `false` | 打开后打扫描明细日志 |

> **loader id 不要改，固定是 `session-stats-panel`。** 官方的 `@deepseek-ai/dsh-session-stats` 用的是 `session-stats`，加载器按 id 建表、后加载的覆盖先加载的。撞了 id，官方的 `sessionStats` 投影就静默不挂载，界面上看不出来，只是流式输出的计时数据没了。

价格怎么算、峰谷怎么判，写在 [docs/PRICING.md](docs/PRICING.md)。接口和字段在 [docs/API.md](docs/API.md)。

## 页面速览

| 区域 | 内容 |
| --- | --- |
| 顶栏 | 时间档（24h / 7d / 14d / 30d）和币种（人民币 / 美元） |
| 指标卡 | 总 token、预估成本、会话数、缓存命中率，每张下面一行副信息 |
| 今日概览 | 今天的四个数跟昨天比，带 ▲ / ▼ / `—` |
| 运行状态 | CPU（进程、整机、核数）、内存、卡不卡（事件循环延迟）、运行了多久、PID 和 Node 版本，底部一条 5 分钟 CPU 曲线 |
| 每日消耗 | 按模型分色的日堆叠柱；开了预测会多一条虚到月底的线 |
| 构成环图 | token 四桶的构成，加上按模型的成本占比，中间是总量和金额 |
| 分模型明细 | 色块、模型名（带 provider）、占比条、token、占比、成本，按 token 从多到少排 |
| 热力日历 | 最近 8 周的活跃度，token 和会话数两种模式 |
| 排行 | 工具、命令、技能各取前十，条形长度按最高值缩放 |
| 会话列表 | 最多 50 张会话卡，能搜索、能排序，子会话默认藏起来 |

窄屏：桌面端三张图表卡并排，`<1100px` 变两列，`<720px` 变一列。卡片和热力、排行、列表都不横向溢出。

## 数据与隐私

- **只读**。只调 `ctx.sessionQuery.listSessions()` 和 `readSession()`。事件上只读 usage、`tool/call`、`turn/start`、`step/start`、`user/message`、`session/title` 这些，不写回任何东西。日志坏了、读超时、时间戳不对，就跳过那个会话，不影响别的。
- **不上传，不联网**。没有遥测，没有远程请求。价目表是打包进去的快照，不会自己去拉。
- **只对本机开放**。默认只认 `127.0.0.1` / `localhost` / `[::1]`，别的 Host 一律 403，响应里会直接告诉你该开哪个开关。每条响应都带 `Cache-Control: no-store`。
- **增量读**。每个会话有一个表示「有没有改动过」的标记（revision），由持久化后端（persistence）提供；只有变了的会话才重新读，没变的直接用内存里的结果。没有 persistence 后端时退化成每个会话按 `ttlMs` 过期。内存里只留最近 31 天、每小时一格的数据。
- **fork 去重**。从已有会话复制出来的会话（`isSeeded`），开头那段事件是父会话的复制品，`readSession()` 的 `inheritedEventCount` 就是这段有多长。算之前会切掉，只算这个会话自己新增的部分。这段在本机约占 token 总量的 7.8%，旧版是重复算的，3.0 起改过来了。
- **金额是估的**。按各家官网的价目一条条算。DeepSeek 分峰谷，别的厂商是平铺价。美元价目按 `usdRate` 折成人民币展示。查不到官方价的模型标「未计价」，成本记 0，不猜。
- **官方搜索按次算**。每次联网搜索是一笔独立请求，¥0.005 一次，单独加在成本卡副行。搜索自己那次调用的 token 日志里没有 usage，本地还原不出来。

## 开发与自检

零依赖。`npm install` 只在要装宿主对等依赖时才需要。自检不联网、不起 DSH、不写用户数据。

```powershell
# 语法检查
node --check index.js
node --check lib\index.js
node --check lib\pricing.js
node --check lib\aggregate.js
node --check client.js

# 三套自检：核心 / 宿主 / 客户端
node tools\selfcheck.mjs
node tools\selfcheck-host.mjs
node tools\selfcheck-client.mjs

# 或者一次跑完
npm run selfcheck
```

- `tools/selfcheck.mjs`：拿假事件算 token、成本、命中率、每天的量、模型占比，还有热力、排行、会话列表这几张新卡要的数据
- `tools/selfcheck-host.mjs`：拿假 ctx 跑 `apply()`，直接调接口处理函数（不监听端口），检查返回结构、请求来源（Host）和请求方法的限制、缓存、预热定时器
- `tools/selfcheck-client.mjs`：拿假的 `window` / `document` / React 渲染一遍，检查文案、数字、热力格数、排行宽度、搜索和排序、空状态

改完怎么生效：

| 改了什么 | 怎么生效 |
| --- | --- |
| `lib/*.js`（宿主） | 重启 DSH，再强刷浏览器 |
| `client.js`、`locale/*.json`（浏览器） | 刷新页面就行，客户端插件会自动热更新（HMR） |
| `cordis.patch.yml`（配置 / 挂载） | 重启 DSH |

## 目录结构

```text
dsh-session-stats-panel/
├─ package.json          # name / type: module / main: lib/index.js / dsh.bundle.patch / dsh.client
├─ cordis.patch.yml       # bundle patch：insert 本插件行（含可选 config）
├─ icon.svg               # 插件管理器 / 市场图标
├─ locale/{zh,en}.json    # 包元信息文案（插件列表用）
├─ index.js               # 宿主半的别名入口（re-export lib/index.js）
├─ lib/
│  ├─ index.js            # 宿主半：路由、增量扫描缓存、/live 采样（package main）
│  ├─ pricing.js          # 纯函数：价目表、峰谷判断、costOfUsage、美元换算
│  └─ aggregate.js        # 纯函数：事件 → 小时桶 → 窗口汇总 / 日桶 / 模型桶 / 热力 / 排行 / 会话列表
├─ client.js              # 浏览器半：__ModuleLoader__ 包装，React + 内联 SVG
├─ docs/
│  ├─ API.md              # 接口和响应字段
│  ├─ PRICING.md          # 价目快照、峰谷规则、未计价清单
│  └─ screenshots/        # README 用的截图
├─ tools/
│  ├─ selfcheck.mjs       # 核心自检
│  ├─ selfcheck-host.mjs  # 宿主路由自检
│  └─ selfcheck-client.mjs# 客户端渲染自检
├─ README.md / README_en.md
└─ LICENSE
```

## 常见问题

**打开面板时指标卡先出来，热力和排行要等一下？**
对，这是分块加载。指标和图表走 `/overview`，先渲染；热力、排行、会话列表走 `/heavy`，另一个请求。切时间档时旧数据不会消失，顶上会出现一条 2px 的进度条。

**改了代码没反应？**
宿主（`lib/*.js`）要重启 DSH，再强刷浏览器。浏览器那边（`client.js`、`locale/*.json`）刷新页面就够，客户端插件会自动热更新。

**CPU 怎么显示 120%？**
这个数按「进程花掉的 CPU 时间 ÷ 实际过了多久」算。V8 的后台编译、垃圾回收、读文件解压这些会在别的线程上跑，所以一个进程能超过 100%。120.8% 就是 1.21 个核。旁边的整机占比才是这台机器用了多少。

**为什么有的模型显示「未计价」？**
只认各家官网的按量价目。查不到的（下线的版本、没有公开价的模型）不估，成本记 0，明细里写「未计价」，表底会告诉你几个模型没算进去。

**面板的钱和账单对不上？**
两个原因。一是只算日志里带 usage 的 `assistant/message`，没 usage 的调用不估。二是联网搜索按次数算钱，搜索自己那次调用的 token 日志里没有。面板是估的，不是账单。

**手机或者别的电脑打不开？**
默认只认本机。局域网访问把 `allowPrivateHosts` 打开；反代域名写进 `allowedHosts`。公网域名一直拒。

**「近 7 天」的日界不是我这边的时间？**
`timeZone` 默认 `Asia/Shanghai`，改成自己的区。DeepSeek 的峰谷时段是官方按北京时间定的，不跟这个走。

**会和官方的 `@deepseek-ai/dsh-session-stats` 打架吗？**
不会。这个插件的 loader id 是 `session-stats-panel`，官方是 `session-stats`，两个能一起挂。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai)：插件宿主，插件、ModuleLoader、侧栏插槽都是它提供的
- README 的排版参考了 [dsh-ssh-tunnel](https://github.com/OMSociety/dsh-ssh-tunnel) 和 [dsh-github-workbench](https://github.com/meyaomiao/dsh-github-workbench)
- 价目来自各家厂商官网，抓取日期和链接都记在 [docs/PRICING.md](docs/PRICING.md)

用着顺手点个 Star ⭐。有问题去 [Issues](https://github.com/Oblivionis7999/dsh-session-stats-panel/issues) 提，每个版本的改动在 [Releases](https://github.com/Oblivionis7999/dsh-session-stats-panel/releases)。

## 许可证

[MIT](LICENSE) © 2026 织风裁月 (Oblivionis7999)。价目表是各厂商官网价格的快照，只用来本地估算，不是账单。

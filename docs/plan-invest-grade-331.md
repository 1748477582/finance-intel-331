# 331 财经情报站 · 投资级 331 升级实施计划

> 目标：把现有「331 三问 + 钱去哪」从「新闻解读框架」升级为「投资决策翻译框架」。
> 保留 331 内核（这是区别于豆包泛聊的护城河），补 4 个投资级字段 + 1 个升级。
> 合规红线不变：只到行业 / 资产类别，绝不出个股、代码、买卖建议。

---

## 0. 方向确认（已定）

- 产品定位：个人「投资情报精炼器」，辅助投资决策，不是荐股工具。
- 对标：豆包级 UI 质感 + 可信分析；差异化 = 331 结构化 + 个人关注域映射 + 数据点全溯源 + 纯 localStorage 零后端。
- 用户最常用场景：① 每天打开 10 秒看今日真信号 + 钱往哪流；② 遇重要新闻深挖 331；③ 看宏观 / 政策对我的关注域有啥影响。

## 1. 字段变更总表

| 维度 | 现状 | 投资级做法 | 代码落点 |
|---|---|---|---|
| ② 谁说的 | `role`（5 类）+ `discount` | 加 `level`：地方 / 中央 / 监管 / 企业 | buildPrompt 1213 / mergeLLM 1511 / analyze331 1332 |
| 钱去哪 | `flow` 三选一 | 保留 `flow` + 加 `flow_mag`(大/中/小) + `flow_dur`(脉冲/趋势) | buildPrompt 1213 / mergeLLM 1523 |
| 影响翻译 | `impact:{equity,bond}` 粗糙文本 | 升级为 `impact.domains:[{id,dir,strength,horizon,text,chain[]}]` | buildPrompt 1215 / mergeLLM 1544 / renderDetail 2873 |
| 置信度 & 证伪 | 无 | 新增 `confidence:{land_prob,market_conf,falsify}` | buildPrompt / mergeLLM / renderDetail |
| 反向验证 | 无 | 新增 `reserve`（捕捉信源自身保留 / 矛盾态度） | buildPrompt / mergeLLM / renderDetail |

**不改**：三问提问方式、`flow` 三选一抓手、`hypeCheck` 标题加戏检测、数据点抽取规则。

---

## 2. Phase A — 数据模型 + 提示词（纯逻辑，先落地、先可测）

### A1. `buildPrompt`（index.html 1178–1229）
在 1212–1215 的 JSON schema 改为：

```
{
  "q1_what":"",
  "q2_who":{"name":"","role":"地方/中央/监管/企业/券商","discount":"","level":"地方/中央/监管/企业"},
  "q3_why":"",
  "flow":"more/less/shift",
  "flow_mag":"大/中/小",
  "flow_dur":"脉冲/趋势",
  "flow_why":"",
  "tone":0,
  "data_points":[...同上...],
  "impact":{"domains":[{"id":"equity","dir":"利好/利空/中性","strength":"高/中/低","horizon":"即时/1季/半年+","text":"","chain":["一阶...","二阶...","三阶..."]}]},
  "confidence":{"land_prob":0-1,"market_conf":0-1,"falsify":""},
  "reserve":""
}
```

在「三句话拆解」与「资金流向」指令块后追加硬约束：
- `q2_who.level`：必须判断发布主体层级——地方政府 / 中央部委 / 监管部门 / 企业。地方政策传导到全国的含金量远低于中央。
- `flow_mag` / `flow_dur`：三选一只能表达方向，必须再给幅度（大/中/小）和持续性（脉冲=一次性刺激 / 趋势=持续方向）。北京降门槛未降利率属「中 / 趋势」。
- `impact.domains`：对每个开启的关注域（equity/bond/…）给 方向 + 强度 + 时间轴 + 一句翻译 + 传导链（一阶政策→二阶产业链/资产→三阶组合）。**禁止个股、代码、买卖建议**。
- `confidence.land_prob`：这条政策/表态真正落地执行的概率。`market_conf`：市场短期会据此反应的概率。`falsify`：什么信号出现说明本判断要修正（例：「若 1 个月内二手房成交未放量，说明力度不足」）。
- `reserve`：信源自身的保留 / 矛盾态度（如研报写「作用有限」），原文摘录，禁止自行发挥。

### A2. `mergeLLM`（index.html 1506–1546）
在 `item.a331` 对象（1508–1525）补：
```js
q2_who.level: (o.q2_who && o.q2_who.level) || (role ? role.level : ''),
flow_mag: (o.flow_mag === '大' || o.flow_mag === '中' || o.flow_mag === '小') ? o.flow_mag : '中',
flow_dur: (o.flow_dur === '脉冲' || o.flow_dur === '趋势') ? o.flow_dur : '趋势',
confidence: {
  land_prob: clamp01(o.confidence && o.confidence.land_prob),
  market_conf: clamp01(o.confidence && o.confidence.market_conf),
  falsify: (o.confidence && o.confidence.falsify) || ''
},
reserve: o.reserve || ''
```
`item.llmImpact`（1544）改为 `item.llmImpact = o.impact || null;`（兼容旧 `{equity,bond}`：renderDetail 检测 `domains` 存在才用，否则回退 `translateImpact` 规则版）。

### A3. `analyze331` 规则版（index.html 1310–1344）
返回对象补默认值：`level`、`flow_mag:'中'`、`flow_dur:'趋势'`、`confidence:{land_prob:0.5,market_conf:0.3,falsify:''}`、`reserve:''`、`impact:{domains:[]}`。
`level` 可由 `role` 映射（macro→中央，broker→券商，local→地方）。

### A4. 接受标准（Phase A）
- `tests/run.js` 新增 §14「投资级 331 字段」：
  - `mergeLLM` 解析 `flow_mag`/`flow_dur`/`level` 非法值回退默认；
  - `confidence` 字段存在且 `land_prob` 被 clamp 到 [0,1]；
  - `reserve` 透传；`impact.domains` 数组透传；
  - `analyze331` 返回的默认对象含全部新字段（非空 undefined）。

---

## 3. Phase B — 详情页重排 + CSS（对标豆包质感）

### B1. `renderDetail`（index.html 2823–2886）
- **② 谁说的**：在 `a.q2_who.roleName` 后加 `level` 徽章（如「地方政策」「中央部委」）。
- **一个重点**：`dflow` 行追加 `flow_mag` + `flow_dur` 两个小标签（红涨绿跌：幅度大=深红，趋势=实心，脉冲=空心）。
- **影响翻译（带传导链）**：改造 2873 区块。有 `item.llmImpact.domains` 时逐域渲染：方向色点 + 强度标签 + 时间轴标签 + 翻译句 + `chain` 三步传导链（可折叠）。无 `domains` 时回退 `translateImpact` 规则版（保持兼容）。
- **新增「置信度 & 证伪」区块**：进度条展示 `land_prob` / `market_conf`；`falsify` 一句话红字提示「什么信号出现说明判断要修正」。
- **新增「反向验证」区块**：展示 `reserve`（信源自身保留态度），这是「为什么信这条」的可信度背书。

### B2. CSS（detail 区块，参考 .dwhy 386 / .impacts 385）
新增：`.dlevel`（层级徽章）、`.dflow-mag`/`.dflow-dur`（幅度/持续性标签）、`.conf-bar`（置信进度条）、`.chain`（三步传导链，箭头连接）、`.reserve`（黄底保留态度框）。
视觉原则：留白、弱边框、移动端单列、加载态 / 空态文案（豆包级）。

### B3. 接受标准（Phase B）
- `_smoke.js` 新增断言：详情页含 `dlevel` / `dflow-mag` / `conf-bar` / `chain` / `reserve` 节点；
- 旧 `llmImpact:{equity,bond}` 数据不报错（回退路径）；
- 移动端 360px 宽下单列不溢出。

---

## 4. Phase C — 首页信号排序用新字段

- `renderDash`（dash 卡片）：卡片角标显示 `flow_mag`（大=红角标）与 `confidence.land_prob`（高=实心点）。
- 排序：在现有 `score` 之后，用 `flow_mag` 权重 + `confidence.land_prob` 做二级排序，让「幅度大 + 落地概率高」的条目自动浮到首屏前 3。
- 接受标准：`tests/run.js` 或 `_smoke.js` 断言 dash 前 3 条满足「land_prob≥0.6 或 flow_mag=大」优先。

---

## 5. Phase D — 测试 + 推送

1. `tests/run.js` 加 §14（A4）；`tests/lint.js` 维持 33；`_smoke.js` 加 B3 断言。
2. 全套跑绿：`node tests/run.js`（122+）、`node tests/lint.js`（33）、`node _smoke.js`（PASS）、`node _smoke_feed.js`（PASS）。
3. `node --check` 抽取脚本语法 OK。
4. `GITHUB_TOKEN=... python push_github.py` 推送，核验 HEAD + deploy 成功。
5. 提醒：部署后浏览器刷新（localStorage key 不丢）；旧 `feed.json` 里 `a331.engine:'llm'` 条目点「重新 AI 拆解」用新提示词重跑（消耗 GLM-4.7 体验包）。

---

## 6. 成本与风险

- **成本**：每条约 +30~50% LLM 输出。当前闸门（日上限 60、单跑 10、信号分≥50）够用；若日后放宽抓取量再评估。
- **模型**：新字段靠 GLM-4.7 理解力；flash 系（`glm-4.7-flash`）也能跑但质量略降，用户可在设置切。
- **合规**：`impact.domains` / `reserve` / `confidence` 全部禁个股与买卖建议，继承现有 `disc-inline` 红线声明。
- **兼容**：旧 `feed.json` 的 `{equity,bond}` 结构在 renderDetail 回退，不强制重跑。
- **不做什么**：不做荐股、不做仓位建议、不做回测预测、不接入个人账户。

---

## 7. 执行顺序建议

A → B → C → D 串行。每阶段独立可测、可推送。最高价值最低风险的是 **A+B**（让单条详情从「新闻解读」变「决策翻译」），建议优先做完这两步先推送一版给你看效果，再上 C。

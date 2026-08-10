// scripts/fetch.mjs — 331 财经情报站 · 真实数据抓取
// 由 .github/workflows/fetch.yml 每日两次触发，生成仓库根目录 feed.json。
// 前端 loadFeed() 在「本机无存档」或点刷新时加载 feed.json。
//
// 设计原则：
//   1. 每个源独立 try/catch，任何一个挂掉不影响其它源；
//   2. 全部源都失败时回落到 curated 样例，保证 feed.json 永远是合法结构；
//   3. LLM 增强走成本闸门（规则分过线 + 每次运行上限），key 从环境变量读，绝不写进仓库。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const FLOWS = ['more', 'less', 'shift'];

// LLM 闸门：只给规则分过线的条目花钱，且每次运行有硬上限
const GATE = { minScore: 50, perRunCap: 10, concurrency: 3 };
const ZHIPU_EP = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
// glm-4-flash 免费且不带思维链、响应快；glm-4.5-flash 也免费但会先推理、慢一截；glm-4-plus 需账户有余额
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || 'glm-4-flash';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function uid() { return 'feed_' + Math.random().toString(36).slice(2, 10); }
function log(...a) { console.log('[fetch]', ...a); }

// ---- 带超时的 HTTP ----
async function http(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: Object.assign({ 'User-Agent': UA, 'Accept': '*/*' }, opts.headers || {}),
      method: opts.method || 'GET',
      body: opts.body,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return opts.text ? await r.text() : await r.json();
  } finally { clearTimeout(timer); }
}
const httpJSON = (u, o) => http(u, o);
const httpText = (u, o) => http(u, Object.assign({ text: true }, o));

// ---- 数据源配置 ----
// use: 'signal' → 进入情报库；'noise' → 噪音对照
// 一手官方源放在最前，它们是 331 里权重最高的「官方一级」
const SOURCES = [
  { id: 'stats',    name: '国家统计局', use: 'signal', kind: 'stats',
    url: 'https://www.stats.gov.cn/sj/zxfb/', base: 'https://www.stats.gov.cn/sj/zxfb/' },
  { id: 'pbc',      name: '中国人民银行', use: 'signal', kind: 'pbc',
    url: 'http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html', base: 'http://www.pbc.gov.cn' },
  { id: 'sina724',  name: '新浪财经 7x24', use: 'signal', kind: 'live',
    url: 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=30&zhibo_id=152&tag_id=0&dire=f&dpc=1' },
  { id: 'baidutop', name: '热搜／论坛', use: 'noise', kind: 'hot',
    url: 'https://top.baidu.com/board?tab=finance' },
];

// ================= 适配器 =================

// 中文网页里数字前后常被排版空格切开（"上涨 0.5 %"），会让前端正则抽不出数据点，这里先收干净
function cleanCN(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/([\u4e00-\u9fa5，。；：、（）《》])\s+/g, '$1')
    .replace(/\s+([\u4e00-\u9fa5，。；：、（）《》%])/g, '$1')
    .trim();
}

// 抓详情页正文。失败不影响主流程，返回空串即可
async function fetchBody(url, limit = 700) {
  try {
    const html = await httpText(url, { timeout: 12000 });
    const body = cleanCN(html.slice(html.indexOf('trs_') > 0 ? html.indexOf('trs_') : 0));
    const start = body.search(/[\u4e00-\u9fa5]{6,}/);
    return start >= 0 ? body.slice(start, start + limit) : '';
  } catch { return ''; }
}

// 国家统计局「数据发布」：一手硬数据，标题里通常直接带同比数字
async function fetchStats(src) {
  const html = await httpText(src.url);
  const re = /<li>\s*<a[^>]+href="([^"]+)"[^>]*title='([^']+)'[\s\S]*?<span>\s*([\d]{4}-[\d]{2}-[\d]{2})\s*<\/span>\s*<\/li>/g;
  const out = []; let m;
  while ((m = re.exec(html)) !== null && out.length < 6) {
    const href = m[1].replace(/^\.\//, src.base);
    const title = cleanCN(m[2]);
    const hard = /\d+(\.\d+)?%|指数|价格|增长|下降|上涨/.test(title);
    out.push({
      id: uid(), src: '国家统计局', date: m[3], url: href, title,
      body: '', read: '', flow: guessFlow(title),
      inc: hard ? 'hard' : 'policy', multi: true, hot: false, slow: true,
      fields: ['f2'], chains: [], event: eventKey(title),
    });
  }
  // 只给前 3 条拉正文，控制 Action 运行时长
  for (const it of out.slice(0, 3)) it.body = await fetchBody(it.url);
  return out;
}

// 中国人民银行「新闻发布」：政策原文一手源
async function fetchPBC(src) {
  const html = await httpText(src.url);
  const re = /<a\s+href="(\/goutongjiaoliu\/[^"]+)"[^>]*title="([^"]+)"[^>]*istitle="true"/g;
  const out = []; let m;
  while ((m = re.exec(html)) !== null && out.length < 6) {
    const href = src.base + m[1];
    const title = cleanCN(m[2]);
    const d = m[1].match(/\/(\d{4})(\d{2})(\d{2})\d{6,}\//);
    // 会见/通话这类外事条目信息增量低，丢掉
    if (/会见|通话|出席.*会议组织|访问/.test(title)) continue;
    out.push({
      id: uid(), src: '中国人民银行', date: d ? d[1] + '-' + d[2] + '-' + d[3] : todayISO(),
      url: href, title, body: '', read: '', flow: guessFlow(title),
      inc: /\d+(\.\d+)?%|\d+亿|\d+万亿|报告|统计/.test(title) ? 'hard' : 'policy',
      multi: false, hot: false, slow: /报告|统计|情况/.test(title),
      fields: ['f2'], chains: [], event: eventKey(title),
    });
  }
  for (const it of out.slice(0, 3)) it.body = await fetchBody(it.url);
  return out;
}

// 财经快讯：新浪 7x24。只留带政策/数据关键词的，纯行情播报直接丢
const LIVE_KEEP = /(央行|统计局|财政部|发改委|证监会|国常会|政治局|降准|降息|LPR|MLF|专项债|国债|CPI|PPI|GDP|社融|信贷|M2|外汇|汇率|房地产|限购|税收|补贴|关税|美联储|加息|降息)/;
async function fetchLive(src) {
  const j = await httpJSON(src.url);
  const list = (j && j.result && j.result.data && j.result.data.feed && j.result.data.feed.list) || [];
  const out = [];
  for (const it of list) {
    const raw = String(it.rich_text || it.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length < 12) continue;
    if (!LIVE_KEEP.test(raw)) continue;
    if (/^【?今日.{0,6}要闻|^【?早报|^【?午间|^【?收评/.test(raw)) continue;   // 汇总贴没有单一事件，丢掉
    const title = raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
    out.push({
      id: uid(), src: '新浪财经 7x24', date: (it.create_time || '').slice(0, 10) || todayISO(),
      url: it.docurl || src.url,
      title, body: raw,
      read: '', flow: guessFlow(raw),
      inc: /\d+(\.\d+)?%|\d+亿|\d+万亿/.test(raw) ? 'hard' : 'policy',
      multi: false, hot: false, slow: false,
      fields: ['f1', 'f2'], chains: [], event: eventKey(raw),
    });
    if (out.length >= 12) break;
  }
  return out;
}

// 热搜：噪音对照组。百度热榜页面里嵌了 <!--s-data:{...}-->
async function fetchHot(src) {
  const html = await httpText(src.url);
  const m = html.match(/<!--s-data:([\s\S]*?)-->/);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  const cards = (data && data.data && data.data.cards) || [];
  const items = (cards[0] && cards[0].content) || [];
  return items.slice(0, 5).map((it) => ({
    id: uid(), src: '热搜／论坛', date: todayISO(), url: it.url || '',
    title: String(it.word || it.query || '').slice(0, 60),
    body: String(it.desc || '').slice(0, 300) || '热榜话题，无数据、无信源、无政策依据。',
    read: '热榜条目，零信息增量。',
    flow: 'more', inc: 'emo', multi: false, hot: true, slow: false,
    fields: ['f1'], chains: [], event: '',
  }));
}

const ADAPTERS = { stats: fetchStats, pbc: fetchPBC, live: fetchLive, hot: fetchHot };

// ---- 全源失败时的兜底，保证 feed.json 永远可用 ----
function fallbackItems() {
  return [
    { id: uid(), src: '国家统计局', date: todayISO(), flow: 'shift', slow: true,
      title: '本轮抓取未取到实时数据（占位）', url: 'https://www.stats.gov.cn/sj/zxfb/',
      body: '所有数据源本次抓取均失败，这是占位条目。请查看 Action 日志排查网络或接口变更。',
      read: '占位条目，不构成任何判断依据。',
      fields: ['f2'], chains: [], inc: 'hard', multi: false, hot: false, event: '' },
  ];
}

// ================= 工具 =================
// 事件归并键：跨源关联靠它把「同一件事的不同说法」聚到一起
const EVENT_KEYS = [
  [/居民消费价格|CPI/, 'CPI'], [/工业生产者出厂价格|PPI/, 'PPI'],
  [/采购经理指数|PMI/, 'PMI'], [/国内生产总值|GDP/, 'GDP'],
  [/广义货币|M2/, 'M2'], [/社会融资|社融/, '社融'],
  [/贷款市场报价利率|LPR/, 'LPR'], [/降准|存款准备金/, '降准'],
  [/降息|逆回购利率|MLF/, '利率'], [/专项债|国债发行/, '政府债'],
  [/房地产|楼市|限购|房贷/, '房地产'], [/关税/, '关税'],
  [/美联储/, '美联储'], [/汇率|人民币兑/, '汇率'],
];
function eventKey(t) {
  const s = String(t || '');
  for (const [re, k] of EVENT_KEYS) if (re.test(s)) {
    const ym = s.match(/(\d{4})年(\d{1,2})月/);
    return ym ? k + ' ' + ym[1] + '-' + String(ym[2]).padStart(2, '0') : k;
  }
  return '';
}
function guessFlow(t) {
  if (/降准|降息|宽松|下调|减税|补贴|扩大投资|专项债|放宽|支持/.test(t)) return 'more';
  if (/收紧|加息|上调|从严|限制|退出|回收|监管|处罚/.test(t)) return 'less';
  return 'shift';
}

// 规则分：与前端 score() 同口径的简化版，用来决定谁值得花 LLM 的钱
const TIER1 = ['国家统计局', '中国人民银行', '财政部', '发改委'];
function ruleScore(it) {
  let v = 0;
  if (TIER1.some((x) => (it.src || '').includes(x))) v += 35;
  else if (/见闻|快讯|路透|彭博/.test(it.src || '')) v += 18;
  if (it.inc === 'hard') v += 25; else if (it.inc === 'policy') v += 18;
  if (it.multi) v += 13;
  if (it.hot) v -= 10;
  if (/\d+(\.\d+)?%|\d+亿|\d+万亿/.test(it.title + it.body)) v += 12;
  return Math.max(0, Math.min(100, v));
}

// ================= LLM 增强 =================
function llmPrompt(it) {
  return [
    '你是财经新闻结构化拆解助手，严格遵循「331 法则」。只输出 JSON，不要解释、不要 markdown。',
    'q1_what：这条到底说了什么，贴近原文，禁止美化措辞。',
    'q2_who：谁说的，一句话说明这个身份该打几折。',
    'q3_why：为什么是现在说，结合时点语境。',
    'flow 三选一：more=钱变多 / less=钱变少 / shift=钱换地方。flow_why 给一句理由。',
    'read：一句话讲清「这跟普通人的钱有什么关系」，禁止出现个股名称、代码与买卖建议。',
    'schema: {"q1_what":"","q2_who":"","q3_why":"","flow":"","flow_why":"","read":""}',
    '===== 新闻 =====',
    '标题：' + it.title,
    '信源：' + it.src + '　日期：' + it.date,
    '正文：' + (it.body || it.title),
  ].join('\n');
}
function parseLLM(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
async function enrich(items) {
  const key = process.env.ZHIPU_API_KEY;
  if (!key) { log('未配置 ZHIPU_API_KEY，跳过 LLM 增强（规则结果照常输出）'); return 0; }
  const cands = items
    .map((it) => ({ it, s: ruleScore(it) }))
    .filter((x) => x.s >= GATE.minScore)
    .sort((a, b) => b.s - a.s)
    .slice(0, GATE.perRunCap);
  log('LLM 候选 ' + cands.length + ' 条（闸门 ≥' + GATE.minScore + '，上限 ' + GATE.perRunCap + '）');
  let n = 0;

  async function one(it) {
    const payload = {
      model: ZHIPU_MODEL, temperature: 0.2,
      messages: [{ role: 'user', content: llmPrompt(it) }],
    };
    // glm-4.5 系默认开思维链，很慢；显式关掉
    if (/^glm-4\.5/.test(ZHIPU_MODEL)) payload.thinking = { type: 'disabled' };
    try {
      const j = await httpJSON(ZHIPU_EP, {
        method: 'POST', timeout: 40000,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(payload),
      });
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      const o = parseLLM(msg && msg.content);
      if (!o) throw new Error('返回不是合法 JSON');
      it.a331 = {
        engine: 'llm',
        q1_what: { text: o.q1_what || '', hype: null, url: it.url || '' },
        q2_who: { name: it.src, role: 'broker', roleName: '', discount: o.q2_who || '', desc: '' },
        q3_why: { text: o.q3_why || '', refs: [] },
        tone: null,
        flow: FLOWS.includes(o.flow) ? o.flow : it.flow,
        flow_why: o.flow_why || '',
      };
      if (FLOWS.includes(o.flow)) it.flow = o.flow;
      if (o.read) it.read = o.read;
      n++;
    } catch (e) {
      log('LLM 失败（保留规则结果）:', it.title.slice(0, 24), e && e.message);
    }
  }

  // 小并发池：串行太慢会拖垮 Action，全并发又容易被限流
  const queue = cands.map(function (x) { return x.it; });
  const workers = Array.from({ length: Math.min(GATE.concurrency, queue.length) }, async function () {
    while (queue.length) { const it = queue.shift(); if (it) await one(it); }
  });
  await Promise.all(workers);
  return n;
}

// ---- 归一化 ----
function normalize(raw) {
  return {
    id: raw.id || uid(),
    title: String(raw.title || '').slice(0, 200),
    src: raw.src || '',
    date: raw.date || todayISO(),
    body: String(raw.body || '').slice(0, 1200),
    url: raw.url || '',
    event: raw.event || '',
    flow: FLOWS.includes(raw.flow) ? raw.flow : 'shift',
    slow: !!raw.slow,
    read: raw.read || '',
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    chains: Array.isArray(raw.chains) ? raw.chains : [],
    inc: raw.inc || 'hard',
    multi: !!raw.multi,
    hot: !!raw.hot,
    use: raw.use || 'signal',
    a331: raw.a331 || undefined,
  };
}

async function main() {
  const out = [];
  const stat = {};
  for (const src of SOURCES) {
    try {
      const fn = ADAPTERS[src.kind];
      if (!fn) { stat[src.id] = 'no-adapter'; continue; }
      const items = await fn(src);
      items.forEach((it) => { it.use = src.use; out.push(it); });
      stat[src.id] = items.length;
      log(src.id, '→', items.length, '条');
    } catch (e) {
      stat[src.id] = 'error: ' + (e && e.message);
      console.error('[fetch] source failed:', src.id, e && e.message);
    }
  }

  // 标题去重
  const seen = new Set();
  let items = out.filter((it) => {
    const k = (it.title || '').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });

  if (!items.length) { log('全部源均无产出，使用兜底条目'); items = fallbackItems(); stat.fallback = true; }

  const llmN = await enrich(items);

  const feed = {
    generatedAt: new Date().toISOString(),
    watch: ['equity', 'bond'],
    stat: Object.assign({ total: items.length, llm: llmN }, stat),
    intel: items.map(normalize),
  };
  const file = path.join(ROOT, 'feed.json');
  fs.writeFileSync(file, JSON.stringify(feed, null, 2), 'utf8');
  log('feed.json written:', feed.intel.length, 'items, llm', llmN, '->', file);
}

main().catch((e) => { console.error(e); process.exit(1); });

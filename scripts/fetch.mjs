// scripts/fetch.mjs — 331 财经情报站 · 真实数据抓取骨架
// 由 .github/workflows/fetch.yml 每小时触发，生成仓库根目录 feed.json。
// 前端 loadFeed() 在「本机无存档」时加载 feed.json 作为种子数据。
//
// 设计原则：所有抓取逻辑收敛到 SOURCES 配置 + ADAPTERS 适配器 + normalize()，
// 后续接入真实 API / RSS / 网页解析时，只需替换对应 kind 的适配器，不动主流程。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---- 数据源配置（与前端 FEED_SOURCES 对应）----
// use: 'signal' → 进入情报库；'noise' → 仅作噪音对照
const SOURCES = [
  { id: 'stats', name: '国家统计局', use: 'signal', kind: 'official',
    url: 'https://www.stats.gov.cn/sj/zxfb/' },
  { id: 'pbc',   name: '中国人民银行', use: 'signal', kind: 'official',
    url: 'http://www.pbc.gov.cn/diaochatongjisi/116219/index.html' },
  { id: 'wscn',  name: '华尔街见闻', use: 'signal', kind: 'overseas',
    url: 'https://wallstreetcn.com/live/global' },
  { id: 'weibo', name: '热搜／论坛', use: 'noise', kind: 'social',
    url: '' },
];

const FLOWS = ['more', 'less', 'shift'];
function todayISO() { return new Date().toISOString().slice(0, 10); }
function uid() { return 'feed_' + Math.random().toString(36).slice(2, 10); }

// ---- 适配器：每种 kind 一个 fetch 函数 ----
// TODO: 接入真实接口 / RSS / 网页解析。当前返回样例数据，保证整条管线可端到端验证。
const ADAPTERS = {
  official: async (src) => sampleOfficial(src),
  overseas: async (src) => sampleOverseas(src),
  social:   async (src) => sampleSocial(src),
};

// ---- 样例数据（占位；真实接入后删除 sample* 函数）----
function sampleOfficial(src) {
  if (src.id === 'stats') return [{
    id: uid(), src: '国家统计局', date: todayISO(), flow: 'shift', slow: false,
    title: 'CPI/PPI 月度数据发布（样例）', url: src.url,
    body: '国家统计局发布最新物价数据。样例条目，接入真实抓取后替换。',
    read: '物价低位运行，对债券有利、对顺周期不利。',
    fields: ['f2'], chains: [], inc: 'hard', multi: true, hot: false, event: '',
  }];
  if (src.id === 'pbc') return [{
    id: uid(), src: '中国人民银行', date: todayISO(), flow: 'more', slow: false,
    title: 'M2 货币供应数据发布（样例）', url: src.url,
    body: '中国人民银行发布金融统计数据。样例条目，接入真实抓取后替换。',
    read: '货币供应温和增长，尚未看到明显宽松。',
    fields: ['f2'], chains: [], inc: 'hard', multi: false, hot: false, event: '',
  }];
  return [];
}
function sampleOverseas(src) {
  return [{
    id: uid(), src: '华尔街见闻', date: todayISO(), flow: 'shift', slow: false,
    title: '外资配置中国资产比例（样例）', url: src.url,
    body: '样例条目，接入真实抓取后替换。',
    read: '海外视角的资金流向观察，属于机构行为记录。',
    fields: ['f1', 'f6'], chains: [], inc: 'view', multi: true, hot: false, event: '',
  }];
}
function sampleSocial(src) {
  return [{
    id: uid(), src: '热搜／论坛', date: todayISO(), flow: 'more', slow: false, hot: true,
    title: '#A股又双叒涨了#（样例）', url: '',
    body: '话题内容为市场情绪讨论，无数据、无信源、无政策依据。',
    read: '热榜条目，零信息增量。',
    fields: ['f1'], chains: [], inc: 'emo', multi: false, hot: true, event: '',
  }];
}

// ---- 归一化：把原始条目整理成前端期望的字段形状 ----
function normalize(raw) {
  return {
    id: raw.id || uid(),
    title: String(raw.title || '').slice(0, 200),
    src: raw.src || '',
    date: raw.date || todayISO(),
    body: raw.body || '',
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
  };
}

async function main() {
  const out = [];
  for (const src of SOURCES) {
    try {
      const fn = ADAPTERS[src.kind] || (async () => []);
      const items = await fn(src);
      items.forEach((it) => { it.use = src.use; out.push(normalize(it)); });
    } catch (e) {
      console.error('source failed:', src.id, e && e.message);
    }
  }
  const feed = { generatedAt: new Date().toISOString(), watch: ['equity', 'bond'], intel: out };
  const file = path.join(ROOT, 'feed.json');
  fs.writeFileSync(file, JSON.stringify(feed, null, 2), 'utf8');
  console.log('feed.json written:', out.length, 'items ->', file);
}

main().catch((e) => { console.error(e); process.exit(1); });

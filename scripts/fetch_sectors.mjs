// scripts/fetch_sectors.mjs — 331 财经情报站 · 板块行情数据抓取
// 由 .github/workflows/deploy.yml 每日触发，生成仓库根目录 sectors.json。
// 前端在情报详情页加载 sectors.json，显示关联板块的当日表现。
//
// 设计原则：
//   1. 数据来源：东方财富板块行情API（公开接口）
//   2. 失败时回落到上一次的sectors.json或占位数据，保证文件永远合法
//   3. 只抓取主要板块，控制数据量
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 15000;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function nowStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') +
    ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':00';
}
function log(...a) { console.log('[fetch-sectors]', ...a); }

// ---- 带超时的 HTTP ----
async function http(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: Object.assign({ 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://quote.eastmoney.com/' }, opts.headers || {}),
      method: opts.method || 'GET',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return opts.text ? await r.text() : await r.json();
  } finally { clearTimeout(timer); }
}

// ---- 关注领域到板块的映射 ----
// fields: 对应DEF_FIELDS中的id
const SECTOR_MAP = [
  { name: '半导体', fields: ['f5'], emCode: 'BK1036' },
  { name: '人工智能', fields: ['f5'], emCode: 'BK1135' },
  { name: '新能源汽车', fields: ['f4'], emCode: 'BK0481' },
  { name: '锂电池', fields: ['f4'], emCode: 'BK0574' },
  { name: '房地产', fields: ['f3'], emCode: 'BK0451' },
  { name: '银行', fields: ['f2', 'f6'], emCode: 'BK0475' },
  { name: '黄金', fields: ['f6'], emCode: 'BK0478' },
  { name: '基建', fields: ['f7'], emCode: 'BK0424' },
  { name: '消费', fields: ['f9'], emCode: 'BK0438' },
  { name: '有色金属', fields: ['f10'], emCode: 'BK0478' },
  { name: '煤炭', fields: ['f10'], emCode: 'BK0437' },
  { name: '港口航运', fields: ['f8'], emCode: 'BK0450' },
];

const INDEX_MAP = [
  { name: '上证指数', fields: ['f1'], secid: '1.000001' },
  { name: '深证成指', fields: ['f1'], secid: '0.399001' },
  { name: '创业板指', fields: ['f1'], secid: '0.399006' },
];

// ---- 抓取东方财富板块行情 ----
async function fetchEastMoneySector(sector) {
  // 东方财富板块行情API
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=90.${sector.emCode}&fields=f43,f44,f45,f46,f47,f48,f60,f168,f169,f170`;
  try {
    const j = await http(url);
    const d = j && j.data;
    if (!d) return null;
    // f43: 最新价, f170: 涨跌幅, f47: 成交量, f48: 成交额
    const change = d.f170 ? d.f170 / 100 : 0;
    const amount = d.f48 ? d.f48 / 100000000 : 0; // 转成亿
    return {
      name: sector.name,
      change: Math.round(change * 100) / 100,
      amount: Math.round(amount * 100) / 100,
      net_inflow: 0, // 资金流向需要另外接口，先留0
      leader: '',
      leader_change: 0,
      fields: sector.fields,
    };
  } catch (e) {
    log('板块抓取失败:', sector.name, e.message);
    return null;
  }
}

// ---- 抓取指数行情 ----
async function fetchEastMoneyIndex(idx) {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${idx.secid}&fields=f43,f44,f45,f46,f47,f48,f60,f168,f169,f170`;
  try {
    const j = await http(url);
    const d = j && j.data;
    if (!d) return null;
    const change = d.f170 ? d.f170 / 100 : 0;
    const close = d.f43 ? d.f43 / 100 : 0;
    const amount = d.f48 ? d.f48 / 100000000 : 0;
    return {
      name: idx.name,
      change: Math.round(change * 100) / 100,
      close: Math.round(close * 100) / 100,
      amount: Math.round(amount * 100) / 100,
      fields: idx.fields,
    };
  } catch (e) {
    log('指数抓取失败:', idx.name, e.message);
    return null;
  }
}

// ---- 兜底数据（全部抓取失败时使用） ----
function fallbackData() {
  return {
    date: todayISO(),
    updated: nowStr(),
    note: '本次抓取失败，使用占位数据',
    sectors: SECTOR_MAP.map(s => ({
      name: s.name, change: 0, amount: 0, net_inflow: 0,
      leader: '', leader_change: 0, fields: s.fields,
    })),
    indices: INDEX_MAP.map(i => ({
      name: i.name, change: 0, close: 0, amount: 0, fields: i.fields,
    })),
  };
}

async function main() {
  const sectors = [];
  const indices = [];

  log('开始抓取板块行情...');

  // 串行抓取，避免被限流
  for (const s of SECTOR_MAP) {
    const data = await fetchEastMoneySector(s);
    if (data) {
      sectors.push(data);
      log('  ✓', s.name, data.change + '%');
    } else {
      // 单个失败时用占位
      sectors.push({
        name: s.name, change: 0, amount: 0, net_inflow: 0,
        leader: '', leader_change: 0, fields: s.fields,
      });
    }
  }

  log('开始抓取指数行情...');
  for (const i of INDEX_MAP) {
    const data = await fetchEastMoneyIndex(i);
    if (data) {
      indices.push(data);
      log('  ✓', i.name, data.change + '%');
    } else {
      indices.push({
        name: i.name, change: 0, close: 0, amount: 0, fields: i.fields,
      });
    }
  }

  const result = {
    date: todayISO(),
    updated: nowStr(),
    sectors: sectors,
    indices: indices,
  };

  const file = path.join(ROOT, 'sectors.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
  log('sectors.json written:', sectors.length, 'sectors,', indices.length, 'indices ->', file);
}

main().catch((e) => {
  console.error(e);
  // 出错时写兜底数据
  const file = path.join(ROOT, 'sectors.json');
  fs.writeFileSync(file, JSON.stringify(fallbackData(), null, 2), 'utf8');
  log('写入兜底数据 ->', file);
  process.exit(0); // 不阻断部署
});

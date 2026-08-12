// Runtime smoke test: mock DOM + run the full index.html script, then renderAll / openDetail / 四栏导航.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no script block'); process.exit(1); }
const code = m[1];

function FakeEl(id) {
  this.id = id; this._html = ''; this.value = ''; this.textContent = '';
  this.options = [];
  this.style = {};
  this._cls = Object.create(null);
  this._attr = Object.create(null);
  this._kids = Object.create(null);          // selector -> [FakeEl]
  this.addEventListener = function(){};
  const self = this;
  this.classList = {
    add(c){ self._cls[c] = 1; },
    remove(c){ delete self._cls[c]; },
    toggle(c, on){
      if (on === undefined) { if (self._cls[c]) delete self._cls[c]; else self._cls[c] = 1; }
      else if (on) self._cls[c] = 1; else delete self._cls[c];
    },
    contains(c){ return !!self._cls[c]; }
  };
  this.getAttribute = function(k){ return self._attr[k]; };
  this.querySelectorAll = function(sel){ return self._kids[sel] || []; };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get() { return this._html; }, set(v) { this._html = String(v); }
});

const els = {};
const REG = { sec: [], tabs: [] };
const document = {
  getElementById(id) { return els[id] || (els[id] = new FakeEl(id)); },
  createElement() { return new FakeEl('created'); },
  querySelectorAll(sel) {
    if (sel === '.sec') return REG.sec;
    if (sel === '[data-t]') return REG.tabs;
    return [];
  }
};

/* ---- 依据 index.html 真实标记搭出可断言的 DOM 骨架（导航相关） ---- */
const secKeys = [...html.matchAll(/<section class="sec[^"]*" id="sec-([a-z]+)"/g)].map(x => x[1]);
secKeys.forEach(k => {
  const el = document.getElementById('sec-' + k);
  if (html.indexOf('<section class="sec on" id="sec-' + k + '"') > -1) el.classList.add('on');
  REG.sec.push(el);
});
const tabKeys = [...new Set([...html.matchAll(/data-t="([a-z]+)"/g)].map(x => x[1]))];
tabKeys.forEach(k => {
  ['top', 'bottom'].forEach(pos => {
    const b = new FakeEl('tab-' + pos + '-' + k);
    b._attr['data-t'] = k;
    if (k === 'dash') b.classList.add('on');
    REG.tabs.push(b);
  });
});
const subs = [...html.matchAll(/<div class="sub( on)?" id="sub-([a-z]+)-([a-z]+)"/g)];
subs.forEach(x => {
  const [, on, g, k] = x;
  const el = document.getElementById('sub-' + g + '-' + k);
  if (on) el.classList.add('on');
  const host = document.getElementById('sec-' + g);
  (host._kids['.sub'] = host._kids['.sub'] || []).push(el);
});
[...html.matchAll(/id="subnav-([a-z]+)"/g)].map(x => x[1]).forEach(g => {
  const nav = document.getElementById('subnav-' + g);
  nav._kids['button'] = [];
  const block = html.slice(html.indexOf('id="subnav-' + g + '"'));
  const end = block.indexOf('</nav>');
  [...block.slice(0, end).matchAll(/data-s="([a-z]+-[a-z]+)"/g)].forEach((x, i) => {
    const b = new FakeEl('sn-' + x[1]);
    b._attr['data-s'] = x[1];
    if (i === 0) b.classList.add('on');
    nav._kids['button'].push(b);
  });
});

const store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k,v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; }
};
const sandbox = {
  document, window: { scrollTo(){} }, localStorage, alert(){}, console,
  setTimeout, clearTimeout, Math, JSON, Date, String, Array, Object, Number,
  parseInt, parseFloat, isNaN, RegExp, Boolean, escape, Set
};
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'index-inline.js' });
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

let bad = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); }
  else { bad++; console.error('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

// Inspect what got defined
const fns = ['renderAll','renderDash','renderDatacenter','renderSettings','openDetail','renderDetail','go','subgo','toggleQuick','alertCards','seed','load'];
console.log('--- defined functions ---');
fns.forEach(f => console.log('  ' + f.padEnd(18), typeof sandbox[f]));
if (fns.some(f => typeof sandbox[f] !== 'function')) { console.error('缺少函数定义'); process.exit(1); }

try {
  sandbox.renderAll();
  console.log('--- renderAll() OK ---');
  ['dashAlerts','dashHeads','radList','fieldChart','slowList','dTrend','dAlerts','dIndTable','dSigTrend','dCross','watchList','srcInfo','flowN','flowBar','macroList','detailBox']
    .forEach(id => {
      const len = els[id] && els[id]._html ? els[id]._html.length : 0;
      console.log('  #' + id + ' html len =', len);
    });
  ok('dSigTrend 渲染出时间线 SVG', els['dSigTrend']._html.indexOf('trend-svg') > -1);
  ok('时间线含资金流向堆叠带图例', els['dSigTrend']._html.indexOf('下方色带') > -1);
  ok('堆叠带坐标为合法数字（无字符串拼接错位）',
    !/y="\d{4,}"/.test(els['dSigTrend']._html), (els['dSigTrend']._html.match(/y="\d{4,}"/g) || []).slice(0, 3));
  ok('dCross 渲染出跨源卡片', els['dCross']._html.indexOf('xcard') > -1);
  ok('跨源卡片带时间跨度或日期', /跨 \d+ 天|\d{4}-\d{2}-\d{2}/.test(els['dCross']._html));
} catch (e) {
  console.error('RENDER ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

// ---- 告警面板：指标异常 + 关注突增 ----
try {
  const cards = sandbox.alertCards();
  const spikes = sandbox.detectSpikes();
  console.log('--- alertCards ---  共', cards.length, '张 | 突增', spikes.length, '项');
  ok('alertCards 返回数组', Array.isArray(cards));
  if (spikes.length) {
    ok('突增卡片出现在告警面板', cards.some(c => c.indexOf('关注突增') > -1));
    ok('仪表盘告警区含突增', els['dashAlerts']._html.indexOf('关注突增') > -1);
  } else {
    console.log('  · 预置数据无突增事件，跳过突增渲染断言');
  }
} catch (e) {
  console.error('ALERT ERROR:', e.message); process.exit(1);
}

// ---- 四栏导航 + 二级分组 ----
try {
  console.log('--- 四栏导航 ---  tabs =', tabKeys.join('/'), '| sections =', secKeys.join('/'));
  ok('顶栏有 5 个入口', tabKeys.length === 5, tabKeys);
  ok('五栏为 dash/intel/data/analysis/me',
    ['dash','intel','data','analysis','me'].every(k => tabKeys.indexOf(k) > -1), tabKeys);
  ok('每个 tab 都有对应 section', tabKeys.every(k => secKeys.indexOf(k) > -1), secKeys);

  const onSec = () => REG.sec.filter(s => s.classList.contains('on')).map(s => s.id);
  const onTab = () => REG.tabs.filter(b => b.classList.contains('on')).map(b => b.getAttribute('data-t'))[0];
  const onSub = g => (els['sec-' + g]._kids['.sub'] || []).filter(x => x.classList.contains('on')).map(x => x.id);

  sandbox.go('me');
  ok('go("me") 只点亮 sec-me', onSec().length === 1 && onSec()[0] === 'sec-me', onSec());
  ok('go("me") 同步高亮 tab', onTab() === 'me', onTab());

  sandbox.go('settings');
  ok('旧入口 go("settings") 落到 我的→设置',
    onSec()[0] === 'sec-me' && onSub('me').join() === 'sub-me-set', [onSec(), onSub('me')]);
  sandbox.go('review');
  ok('旧入口 go("review") 落到 我的→决策复盘',
    onSec()[0] === 'sec-me' && onSub('me').join() === 'sub-me-rv', onSub('me'));
  sandbox.go('chain');
  ok('旧入口 go("chain") 落到 数据→产业链',
    onSec()[0] === 'sec-data' && onSub('data').join() === 'sub-data-chain', onSub('data'));
  sandbox.go('datacenter');
  ok('旧入口 go("datacenter") 落到 数据→指标趋势', onSub('data').join() === 'sub-data-ind', onSub('data'));

  sandbox.subgo('data', 'rel');
  ok('subgo 切换二级分组唯一生效', onSub('data').join() === 'sub-data-rel', onSub('data'));
  const nb = els['subnav-data']._kids['button'].filter(b => b.classList.contains('on')).map(b => b.getAttribute('data-s'));
  ok('二级导航按钮同步高亮', nb.join() === 'data-rel', nb);

  sandbox.go('dash');
  ok('回到 dash 正常', onSec()[0] === 'sec-dash' && onTab() === 'dash');

  const qb = sandbox.document.getElementById('quickBody');
  qb.style.display = 'none';
  sandbox.toggleQuick();
  ok('手动速记可展开', qb.style.display === 'block', qb.style.display);
  sandbox.toggleQuick();
  ok('手动速记可收起', qb.style.display === 'none', qb.style.display);
} catch (e) {
  console.error('NAV ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

// Open a detail for the first intel (if any)
try {
  const intel = (sandbox.DB && sandbox.DB.intel) || [];
  if (intel.length) {
    sandbox.openDetail(intel[0].id);
    console.log('--- openDetail("' + intel[0].id + '") OK; detailBox html len =',
      els['detailBox'] ? els['detailBox']._html.length : 0);
    const dh = els['detailBox']._html;
    ok('详情页标注拆解引擎', /eng-ai|eng-rule/.test(dh));
    ok('详情页含影响翻译区块', /我的钱会怎样/.test(dh));
    ok('详情页含置信度与证伪区块', /置信度与证伪/.test(dh));
    ok('规则版也渲染层级徽章容器或幅度标签（字段存在即可）', /dlevel|dfm-|dfd-/.test(dh) || /幅度/.test(dh));
    // 用一条带 domains 的 LLM 数据验证投资级字段渲染
    const lv = sandbox.analyze331(intel[0]);
    lv.engine = 'llm';
    lv.impact = {domains:[{id:'equity', dir:'利好', strength:'中', horizon:'半年+', text:'地产链改善', chain:['政策','产业链','组合']}]};
    lv.confidence = {land_prob:0.7, market_conf:0.5, falsify:'若成交未放量说明力度不足'};
    lv.reserve = '中金认为作用有限';
    lv.flow_mag = '中'; lv.flow_dur = '趋势';
    sandbox.DB.intel[0].a331 = lv;
    sandbox.openDetail(intel[0].id);
    const dh2 = els['detailBox']._html;
    ok('投资级：渲染传导链 chain', /chain-ar/.test(dh2));
    ok('投资级：渲染置信度进度条', /conf-fill/.test(dh2));
    ok('投资级：渲染证伪信号', /证伪信号/.test(dh2));
    ok('投资级：渲染反向验证', /反向验证/.test(dh2));
    ok('投资级：渲染幅度标签', /dfm-/.test(dh2) && /dfd-/.test(dh2));
  } else {
    console.log('--- no intel to openDetail ---');
  }
} catch (e) {
  console.error('OPENDETAIL ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

if (bad) { console.error('\nSMOKE TEST FAILED（' + bad + ' 项）'); process.exit(1); }
console.log('\nSMOKE TEST PASSED');

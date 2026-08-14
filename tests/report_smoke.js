// 财富情报网 · 分析报告 冒烟测试
// 在 fake DOM 中加载 report.html 的脚本，验证：聚合不抛错、板块确信度 0~100、
// 合规净化器能剥离代码、全文扫描无泄漏。
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('report.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const feed = JSON.parse(fs.readFileSync('feed.json', 'utf8'));
const sectors = JSON.parse(fs.readFileSync('sectors.json', 'utf8'));

function stripTags(s){ return String(s || '').replace(/<[^>]*>/g, ''); }
function FakeEl(id){
  this.id = id; this._html = ''; this.value = ''; this.textContent = '';
  this.className = ''; this.style = {};
  this.options = []; this.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get(){ return this._html; },
  set(v){ this._html = String(v); this.textContent = stripTags(v); }
});
const els = {};
const document = {
  getElementById(id){ return els[id] || (els[id] = new FakeEl(id)); },
  createElement(){ return new FakeEl('created'); },
  querySelectorAll(){ return []; },
  body: new FakeEl('body')
};
const store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; }
};
function fakeFetch(url){
  let data = /sectors/.test(url) ? sectors : feed;
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}
const sandbox = {
  document, window: { scrollTo(){} }, localStorage, console,
  setTimeout, clearTimeout, Math, JSON, Date, String, Array, Object, Number,
  parseInt, parseFloat, isNaN, RegExp, Boolean, Promise, Blob, URL,
  navigator: {}, fetch: fakeFetch
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'report-inline.js' });

let pass = 0, fail = 0;
function t(name, cond, extra){
  if(cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

setTimeout(() => {
  try {
    const AGG = sandbox.AGG;
    t('AGG 已生成且非空', Array.isArray(AGG) && AGG.length > 0, AGG && AGG.length);
    t('板块确信度均在 0~100', AGG.every(o => o.conf >= 0 && o.conf <= 100), AGG.map(o => o.sector + ':' + o.conf));

    const sm = AGG.filter(o => o.sector === '半导体')[0];
    const ev = AGG.filter(o => o.sector === '新能源汽车')[0];
    t('半导体 聚合到催化且确信度>0', sm && sm.cat > 0 && sm.conf > 0, sm && { cat: sm.cat, conf: sm.conf });
    t('新能源汽车 资金流出象限(净流<0)', ev && ev.net < 0, ev && ev.net);

    // 合规净化器单元测试
    const p1 = sandbox.purify('建议买入 688981 与 00981.HK');
    t('净化器剥离 6 位代码', p1.removed.indexOf('688981') >= 0, p1.removed);
    t('净化器剥离 .HK 代码', p1.removed.indexOf('00981.HK') >= 0, p1.removed);
    const p2 = sandbox.purify('这是一段纯净的行业描述，半导体板块受益');
    t('纯净文本净化后 clean=true', p2.clean === true, p2);

    // 全文终检：report 容器渲染后，badge 应为合规 ok
    const badge = els['badge'];
    t('合规终检 badge 为 badge-ok（全文无泄漏）', badge && /badge-ok/.test(badge.className), badge && badge.className);
    t('报告正文已渲染（含「板块确信度排行」）', els['report'] && /板块确信度排行/.test(els['report'].innerHTML), els['report'] && els['report'].innerHTML.slice(0, 40));

    console.log('\n报告冒烟：通过 ' + pass + '，失败 ' + fail);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('REPORT SMOKE ERROR:', e.message);
    console.error((e.stack || '').split('\n').slice(0, 8).join('\n'));
    process.exit(1);
  }
}, 200);

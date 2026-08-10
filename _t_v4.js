/* V4 数据层验证：种子增强 / 历史趋势 / 异常告警 / 331 拆解 / 影响翻译 / 迁移 */
var ex = require('./tests/extract');

var store = {};
global.localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(store,k) ? store[k] : null; },
  setItem: function(k,v){ store[k] = String(v); },
  removeItem: function(k){ delete store[k]; }
};
global.alert = function(m){ console.log('[alert]', m); };

var html = ex.readHtml();
var core = ex.extractCore(html);
eval(core);

var pass = 0, fail = 0, failed = [];
function t(name, cond, extra){
  if(cond){ pass++; console.log('  \u2713 ' + name); }
  else { fail++; failed.push(name); console.log('  \u2717 ' + name + (extra!==undefined ? '  \u2192  ' + JSON.stringify(extra) : '')); }
}
function sec(s){ console.log('\n=== ' + s + ' ==='); }

/* 合规检查只看「人读得到的内容」（标题/正文/解读/信源/事件），
   不看 url —— 政府站点路径里常有 6 位数字（如 customs.gov.cn/.../302249/...），属误报 */
function contentStr(){
  var parts = [];
  (DB.intel || []).forEach(function(i){
    ['title','read','body','src','event'].forEach(function(k){ if(i[k]) parts.push(i[k]); });
  });
  (DB.macros || []).forEach(function(m){ if(m.n) parts.push(m.n); if(m.t) parts.push(m.t); });
  (DB.decisions || []).forEach(function(d){ if(d.q) parts.push(d.q); if(d.note) parts.push(d.note); if(d.rnote) parts.push(d.rnote); });
  return parts.join(' ');
}
var STOCK_RE = /\b(6\d{5}|0\d{5}|3\d{5})\b/;

sec('0. 常量层存在性');
t('KEY 升到 v4', KEY === 'wb_331_data_v4', KEY);
t('INDICATORS 指标表 >= 15', INDICATORS.length >= 15, INDICATORS.length);
t('LLM_VENDORS 含三家', LLM_VENDORS.length === 3 && ['qwen','doubao','glm'].every(function(v){ return LLM_VENDORS.some(function(x){ return x.id===v; }); }));
t('WATCH_DOMAINS 含 4 个关注域', WATCH_DOMAINS.length === 4, WATCH_DOMAINS.map(function(d){ return d.id; }));
t('GATE 含两级成本闸门', GATE.llmMinScore > 0 && GATE.dailyLlmCap > 0, GATE);
t('SPEAKER_ROLES 含 5 类身份', SPEAKER_ROLES.length === 5, SPEAKER_ROLES.map(function(r){ return r.id; }));
t('TONE_LADDER 含 0-3 四级', TONE_LADDER.length === 4, TONE_LADDER.map(function(x){ return x.lv; }));

sec('1. 首次加载 = 预置种子（v4）');
store = {};
load();
t('版本号 = 4', DB.v === 4, DB.v);
t('布尔 seeded', DB.seeded === true);
t('预置情报 >= 18 条（10 基础 + 8 历史）', DB.intel.length >= 18, DB.intel.length);
t('每条情报都有 url 字段', DB.intel.every(function(i){ return i.url !== undefined; }));
t('每条情报都有 body 字段', DB.intel.every(function(i){ return i.body !== undefined; }));
t('每条情报都被提炼出 dps', DB.intel.every(function(i){ return Array.isArray(i.dps); }));
t('至少有 1 条抽到数据点', allPoints().length > 0, allPoints().length);
t('关注域开关已同步', WATCH_DOMAINS.filter(function(d){ return d.on; }).length === 2, WATCH_DOMAINS.filter(function(d){ return d.on; }).map(function(d){ return d.id; }));
t('不含股票代码（合规，仅查人读内容）', STOCK_RE.test(contentStr()) === false, (contentStr().match(STOCK_RE) || [])[0]);

sec('2. 种子增强：SEED_EXTRA 把原文链接/正文补进演示情报');
var forex = DB.intel.filter(function(i){ return i.title.indexOf('外汇储备') > -1; })[0];
t('外储条目补到了正文', forex && forex.body && forex.body.indexOf('34188') > -1, forex && forex.body);
t('外储条目补到了官方链接', forex && forex.url && forex.url.indexOf('safe.gov.cn') > -1, forex && forex.url);
var beijing = DB.intel.filter(function(i){ return i.title.indexOf('北京全面放开限购') > -1; })[0];
t('自媒体「全面放开」条目有 body（用于演示分歧降权）', beijing && beijing.body && beijing.body.length > 10, beijing && (beijing.body||'').slice(0,20));

sec('3. 历史趋势 trendSeries');
var cpi = trendSeries('cpi');
t('CPI 历史 >= 4 期', cpi.length >= 4, cpi.map(function(o){ return o.p.period + ':' + o.p.value; }));
t('趋势按时间升序', (function(){
  for(var i=1;i<cpi.length;i++){ if(periodKey(cpi[i].p.period) < periodKey(cpi[i-1].p.period)) return false; } return true;
})());
t('CPI 含刻意制造的反转（0.1→0.3→0.2→0.5）',
  cpi.some(function(o){ return o.p.value===0.1; }) &&
  cpi.some(function(o){ return o.p.value===0.5; }));
var m2 = trendSeries('m2');
t('M2 历史 >= 2 期', m2.length >= 2, m2.map(function(o){ return o.p.period + ':' + o.p.value; }));

sec('4. 异常告警 detectAnomaly');
var alerts = detectAnomaly();
t('能产生告警列表', Array.isArray(alerts));
t('CPI 方向反转被检出（reverse）',
  alerts.some(function(a){ return a.kind === 'reverse' && a.ind.indexOf('CPI') > -1; }),
  alerts.map(function(a){ return a.kind + ':' + a.ind; }));

sec('5. 331 拆解 analyze331');
var sample = DB.intel.filter(function(i){ return i.title.indexOf('北京楼市限购松绑') > -1; })[0];
var a331 = analyze331(sample);
t('返回 engine 字段', a331.engine === 'rule');
t('q1_what 含原文/溯源', a331.q1_what && a331.q1_what.text.length > 0 && a331.q1_what.url !== undefined);
t('q2_who 含身份识别', a331.q2_who && a331.q2_who.role && a331.q2_who.roleName, a331.q2_who);
t('q2_who 身份应是官方/权威（非中间商）', a331.q2_who.role !== 'broker', a331.q2_who.role);
t('q3_why 含「为什么现在说」语境', a331.q3_why && a331.q3_why.text.indexOf('最近') > -1, a331.q3_why && a331.q3_why.text.slice(0,30));
t('tone 含四级强度', a331.tone && typeof a331.tone.lv === 'number');
t('flow 三选一', ['more','less','shift'].indexOf(a331.flow) >= 0, a331.flow);

sec('6. 个人影响翻译 translateImpact（合规红线）');
var impact = translateImpact(sample, a331);
t('返回 equity + bond 两行', impact.length === 2 && impact[0].id === 'equity' && impact[1].id === 'bond', impact.map(function(x){ return x.id; }));
t('权益行含产业链（只到行业）', impact[0].extra && impact[0].extra.indexOf('产业链') > -1, impact[0].extra);
t('翻译文案不含股票代码（合规）',
  JSON.stringify(impact).match(/\b(6\d{5}|0\d{5}|3\d{5})\b/) === null,
  (JSON.stringify(impact).match(/\b(6\d{5}|0\d{5}|3\d{5})\b/)||[])[0]);
t('债券行对「只表态未动手」有提醒', impact[1].extra && impact[1].extra.length > 0, impact[1].extra);

sec('7. 相关新闻 relatedIntel');
var rel = relatedIntel(sample, 5);
t('能找出同事件相关条目（北京限购组）',
  rel.some(function(x){ return x.event === '北京楼市限购松绑'; }), rel.map(function(x){ return x.title.slice(0,12); }));

sec('8. 迁移：旧 v3 存档升级到 v4，数据不丢');
store = {};
store[KEY] = JSON.stringify({
  v:3, seeded:true,
  intel:[
    {id:'a1', title:'央行降准0.5个百分点', src:'中国人民银行', inc:'hard', multi:true, slow:false, hot:false,
     read:'流动性宽松', flow:'more', fields:['f2'], date:'2026-08-01'},
    {id:'a2', title:'AI服务器PCB需求上行', src:'外资投行', inc:'hard', multi:false, slow:false, hot:false,
     read:'算力链景气', flow:'shift', fields:['f5'], date:'2026-08-02'}
  ],
  decisions:[{id:'d1', q:'旧决策', act:'wait', note:'x', date:'2026-08-01', due:'2026-08-05', done:false, result:'', rnote:'', link:''}],
  fields: JSON.parse(JSON.stringify(DEF_FIELDS)),
  chains: JSON.parse(JSON.stringify(DEF_CHAINS)),
  macros:[{id:'m1', n:'M2 同比', v:'9.0%', d:'up', t:'x'}]
});
load();
t('旧数据被读取未被示例覆盖', DB.intel.length === 2, DB.intel.length);
t('版本号升到 4', DB.v === 4);
t('旧情报自动补 url/body 字段', DB.intel.every(function(i){ return i.url !== undefined && i.body !== undefined; }));
t('旧情报自动提炼 dps（不依赖硬编码）', DB.intel.every(function(i){ return Array.isArray(i.dps); }));
t('旧决策不丢', DB.decisions.length === 1 && DB.decisions[0].q === '旧决策');
t('旧宏观数据不丢', DB.macros.length === 1);
t('迁移后写入 v4 存档', !!store[KEY] && JSON.parse(store[KEY]).v === 4);

sec('9. 迁移：v2 存档也能读上来');
store = {};
store['wb_331_data_v2'] = JSON.stringify({
  v:2, seeded:true,
  intel:[
    {id:'b1', title:'央行降准0.5个百分点', src:'中国人民银行', inc:'hard', multi:true, slow:false, hot:false,
     read:'流动性宽松', flow:'more', fields:['f2'], date:'2026-08-01'}
  ],
  decisions:[], fields: JSON.parse(JSON.stringify(DEF_FIELDS)), macros:[]
});
load();
t('v2 数据被读取（无 v4 存档时回退）', DB.intel.length >= 1, DB.intel.length);
t('v2 升级后版本为 4', DB.v === 4);

console.log('\n' + '='.repeat(46));
console.log('  V4 通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if(fail){ console.log('  失败项：\n   - ' + failed.join('\n   - ')); }
console.log('='.repeat(46));
process.exit(fail > 0 ? 1 : 0);

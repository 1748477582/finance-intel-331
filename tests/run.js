/* 331 财经情报站 · 数据层断言测试
   在 Node 里 mock 浏览器存储后直接 eval 数据层，不依赖任何三方库 */

var ex = require('./extract');

var store = {};
global.localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(store,k) ? store[k] : null; },
  setItem: function(k,v){ store[k] = String(v); },
  removeItem: function(k){ delete store[k]; }
};
global.alert = function(m){ console.log('[alert]', m); };

var html = ex.readHtml();
var core = ex.extractCore(html);

/* eslint-disable no-eval */
eval(core);

var pass = 0, fail = 0, failed = [];
function t(name, cond, extra){
  if(cond){ pass++; console.log('  \u2713 ' + name); }
  else {
    fail++; failed.push(name);
    console.log('  \u2717 ' + name + (extra!==undefined ? '  \u2192  ' + JSON.stringify(extra) : ''));
  }
}
function sec(s){ console.log('\n=== ' + s + ' ==='); }

console.log('数据层字符数: ' + core.length);

/* ---------- 1. 信号分公式 ---------- */
sec('1. 信号分与分级');
load();
t('官方+硬数据+多源 = 73 强信号',
  score({src:'国家统计局', inc:'hard', multi:true}).v===73 && score({src:'国家统计局', inc:'hard', multi:true}).lv==='strong',
  score({src:'国家统计局', inc:'hard', multi:true}));
t('官方+政策+多源+热搜 = 53 可参考',
  score({src:'地方政府／住建委', inc:'policy', multi:true, hot:true}).v===53 && score({src:'地方政府／住建委', inc:'policy', multi:true, hot:true}).lv==='mid',
  score({src:'地方政府／住建委', inc:'policy', multi:true, hot:true}));
t('自媒体+纯情绪+热搜 = 0 噪音（下限钳制）',
  score({src:'自媒体／大V', inc:'emo', hot:true}).v===0 && score({src:'自媒体／大V', inc:'emo', hot:true}).lv==='noise',
  score({src:'自媒体／大V', inc:'emo', hot:true}));
t('官方+硬数据+多源+慢信号 = 83 强信号',
  score({src:'国家统计局', inc:'hard', multi:true, slow:true}).v===83,
  score({src:'国家统计局', inc:'hard', multi:true, slow:true}).v);
t('券商研报+观点 = 30 噪音',
  score({src:'券商研报', inc:'view'}).v===30 && score({src:'券商研报', inc:'view'}).lv==='noise',
  score({src:'券商研报', inc:'view'}));
t('权威媒体+硬数据+多源 = 61 可参考',
  score({src:'第一财经', inc:'hard', multi:true}).v===61,
  score({src:'第一财经', inc:'hard', multi:true}).v);
t('未知信源按自媒体兜底 w=8',
  score({src:'某不存在的号', inc:'view'}).v===18,
  score({src:'某不存在的号', inc:'view'}).v);
t('分数不超上限 100',
  score({src:'中国人民银行', inc:'hard', multi:true, slow:true}).v<=100);
t('公式字符串含各分项（可复算，非黑箱）',
  score({src:'国家统计局', inc:'hard', multi:true}).formula.indexOf('官方一级 40')>=0 &&
  score({src:'国家统计局', inc:'hard', multi:true}).formula.indexOf('硬数据 +25')>=0 &&
  score({src:'国家统计局', inc:'hard', multi:true}).formula.indexOf('多源 +8')>=0);

/* ---------- 2. 资金流向 ---------- */
sec('2. 资金流向判定');
t('降准降息 → 钱变多', guessFlow('央行宣布降准0.5个百分点，释放流动性')==='more');
t('加征关税 → 钱变少', guessFlow('美方宣布加征关税，监管趋严')==='less');
t('产业升级出口 → 钱换地方', guessFlow('集成电路出口翻倍，产业结构升级')==='shift');
t('无关键词兜底 shift', guessFlow('今天天气不错')==='shift');
t('多关键词命中有确定结果', ['more','less','shift'].indexOf(guessFlow('北京楼市限购松绑'))>=0);

/* ---------- 3. 领域匹配 ---------- */
sec('3. 关注领域匹配');
t('央行降准 → 货币政策', guessFields('央行降准，LPR下调').indexOf('f2')>=0);
t('楼市限购 → 楼市房贷', guessFields('北京楼市限购松绑').indexOf('f3')>=0);
t('芯片算力 → 半导体AI', guessFields('AI算力服务器芯片需求').indexOf('f5')>=0);
t('黄金外储 → 黄金外汇', guessFields('黄金储备连续增持，外储上升').indexOf('f6')>=0);
t('无关文本 → 空', guessFields('今天中午吃什么').length===0);

/* ---------- 4. 产业链映射 ---------- */
sec('4. 产业链映射');
t('默认 4 条产业链', DB.chains.length===4, DB.chains.map(function(c){return c.n;}));
t('每条链 3 层结构', DB.chains.every(function(c){ return c.tiers && c.tiers.length===3; }));
t('每条链有板块归类', DB.chains.every(function(c){ return !!c.sector; }));
t('每条链有避坑提示', DB.chains.every(function(c){ return !!c.note && c.note.length>10; }));
t('PCB覆铜板 → AI算力硬件', guessChains('高盛上调PCB／CCL覆铜板预期').indexOf('ch1')>=0);
t('锂电池整车 → 新能源车', guessChains('动力电池装机量提升，整车渗透率创新高').indexOf('ch2')>=0);
t('楼市限购 → 地产链', guessChains('北京楼市限购松绑').indexOf('ch3')>=0);
t('央行购金 → 黄金贵金属', guessChains('央行购金连续21个月，金价走高').indexOf('ch4')>=0);
t('无关文本 → 空链', guessChains('今天中午吃什么').length===0);
var chainAll = DB.chains.reduce(function(n,c){ return n + c.tiers.reduce(function(m,tr){ return m + tr.items.length; },0); },0);
t('产业链环节总数 > 40', chainAll>40, chainAll);
t('产业链不含股票代码（合规）',
  JSON.stringify(DB.chains).match(/\b(6\d{5}|0\d{5}|3\d{5})\b/)===null,
  (JSON.stringify(DB.chains).match(/\b(6\d{5}|0\d{5}|3\d{5})\b/)||[])[0]);

/* ---------- 5. 事件聚合与分歧检测 ---------- */
sec('5. 多源比对与解读分歧');
var gs = groupByEvent();
t('聚合出 3 个事件组', gs.length===3, gs.map(function(g){return g.name+'('+g.items.length+')';}));
t('空 event 不参与聚合', gs.every(function(g){ return g.name.trim()!==''; }));
var conflictGroups = gs.filter(function(g){ return g.conflict; });
t('检出 1 组分歧', conflictGroups.length===1, conflictGroups.map(function(g){return g.name;}));
t('分歧组是「北京楼市限购松绑」', conflictGroups[0] && conflictGroups[0].name==='北京楼市限购松绑');
t('分歧组同时含官方与自媒体', conflictGroups[0].hasOfficial===true && conflictGroups[0].hasSelf===true);
t('分歧组含 2 种流向', conflictGroups[0].flows.length===2, conflictGroups[0].flows);
t('分歧组排在最前', gs[0].conflict===true);
t('组内按分数降序（官方自然靠前）', (function(){
  var a=conflictGroups[0].items; for(var i=1;i<a.length;i++){ if(score(a[i-1]).v < score(a[i]).v) return false; } return true;
})());
var dt = divergeText(conflictGroups[0]);
t('分歧文案非空且提示信源层级', dt.length>0 && dt.indexOf('自媒体')>=0, dt);
t('无分歧组返回空文案', divergeText({conflict:false})==='');
var noConf = gs.filter(function(g){ return !g.conflict; });
t('官方+机构同向不误报为分歧（外储组）',
  noConf.some(function(g){ return g.name==='7月外储与黄金储备'; }));
t('官方+机构同向不误报为分歧（AI算力组）',
  noConf.some(function(g){ return g.name==='AI算力硬件景气度'; }));

/* ---------- 6. 晨报生成 ---------- */
sec('6. 每日晨报');
var b = genBrief(7);
t('晨报非空', b.length>200, b.length);
t('含标题', b.indexOf('【331 情报晨报】')===0);
t('含统计区间', b.indexOf('统计区间：')>0);
t('含资金流向格局', b.indexOf('■ 资金流向格局：')>0);
t('含强信号板块', b.indexOf('■ 强信号')>0);
t('含分歧提醒板块', b.indexOf('■ 解读分歧提醒')>0);
t('含慢信号板块', b.indexOf('■ 慢信号轨道')>0);
t('含噪音过滤板块', b.indexOf('■ 已过滤噪音')>0);
t('噪音条目标注过滤原因', b.indexOf('自媒体信源')>0 || b.indexOf('无信息增量')>0);
t('含免责声明（合规）', b.indexOf('不构成任何投资建议')>0);
t('免责含「不代表涨跌方向」（合规）', b.indexOf('不代表涨跌方向')>0);
t('晨报不含股票代码（合规）', b.match(/\b(6\d{5}|0\d{5}|3\d{5})\b/)===null);
t('1 天区间可生成', genBrief(1).length>100 && genBrief(1).indexOf('（1 天）')>0);
t('30 天区间不短于 7 天', genBrief(30).length>=b.length);

/* ---------- 7. 存储与版本迁移 ---------- */
sec('7. 存储与 V2→V3 迁移');
save();   // 主动落盘，验证存档往返（load 仅在确有本机存档时自动写回）
t('保存后 v4 存档存在', !!store[KEY]);
var sz = Buffer.byteLength(store[KEY], 'utf8');
t('存档体积远低于 5MB 上限', sz < 5*1024*1024, (sz/1024).toFixed(1)+'KB');
t('存档往返一致', (function(){
  var r = JSON.parse(store[KEY]);
  return r.intel.length===DB.intel.length && r.chains.length===4 && r.decisions.length===DB.decisions.length;
})());

store = {}; DB = null;
store['wb_331_data_v2'] = JSON.stringify({
  v:2, seeded:true,
  intel:[
    {id:'a1', title:'央行降准0.5个百分点', src:'中国人民银行', inc:'hard', multi:true, slow:false, hot:false,
     read:'流动性宽松', flow:'more', fields:['f2'], date:'2026-08-01'},
    {id:'a2', title:'AI服务器PCB需求上行', src:'外资投行', inc:'hard', multi:false, slow:false, hot:false,
     read:'算力链景气', flow:'shift', fields:['f5'], date:'2026-08-02'}
  ],
  decisions:[{id:'d1', q:'旧决策', act:'wait', note:'x', date:'2026-08-01', due:'2026-08-05', done:false, result:'', rnote:'', link:''}],
  fields: JSON.parse(JSON.stringify(DEF_FIELDS)),
  macros:[{id:'m1', n:'M2 同比', v:'9.0%', d:'up', t:'钱变多'}]
});
load();
t('V2 数据被读取，未被示例覆盖', DB.intel.length===2, DB.intel.length);
t('版本号升到 4', DB.v===4);
t('自动补齐产业链定义表', DB.chains && DB.chains.length===4);
t('旧情报自动补 event 字段', DB.intel.every(function(i){ return i.event===''; }));
t('旧情报自动回填产业链结构', Array.isArray(DB.intel[0].chains));
t('旧情报 PCB 自动挂到 AI 算力链', DB.intel[1].chains.indexOf('ch1')>=0, DB.intel[1].chains);
t('旧决策不丢', DB.decisions.length===1 && DB.decisions[0].q==='旧决策');
t('旧宏观数据不丢', DB.macros.length===1);
t('迁移后写入 v4 存档', !!store[KEY]);
t('迁移后可再次正常读取', (function(){ DB=null; load(); return DB.intel.length===2 && DB.chains.length===4; })());

store = {}; DB = null;
load();
t('空存储首次加载 = 预置示例', DB.seeded===true && DB.intel.length===18, DB.intel.length);
t('预置含逾期决策', DB.decisions.some(function(d){ return !d.done && diffDays(todayStr(), d.due)<0; }));
t('预置含今天到期决策', DB.decisions.some(function(d){ return !d.done && d.due===todayStr(); }));
t('预置含已复盘决策', DB.decisions.some(function(d){ return d.done && d.result; }));
t('预置含慢信号', DB.intel.some(function(i){ return i.slow; }));
t('预置含噪音降权演示', DB.intel.some(function(i){ return score(i).lv==='noise'; }));
t('预置每条情报都有 chains 字段', DB.intel.every(function(i){ return Array.isArray(i.chains); }));
t('预置每条情报都有 event 字段', DB.intel.every(function(i){ return typeof i.event==='string'; }));
t('预置数据不含股票代码（合规）',
  (function(){
    var txt = DB.intel.map(function(i){ return [i.title, i.read, i.body, i.src, i.event].join(' '); }).join(' ');
    return txt.match(/\b(6\d{5}|0\d{5}|3\d{5})\b/)===null;
  })());

/* ---------- 8. 决策复盘 ---------- */
sec('8. 决策复盘');
var done = DB.decisions.filter(function(d){ return d.done; });
var right = done.filter(function(d){ return d.result==='right'; });
t('命中率可计算', done.length>0 && !isNaN(Math.round(right.length/done.length*100)));
t('逾期天数计算正确', diffDays(todayStr(), shift(-2))===-2);
t('未来到期计算正确', diffDays(todayStr(), shift(3))===3);
t('今天到期计算为 0', diffDays(todayStr(), todayStr())===0);

/* ---------- 9. 安全 ---------- */
sec('9. 安全');
t('HTML 转义生效', esc('<script>alert(1)</script>')==='&lt;script&gt;alert(1)&lt;/script&gt;');
t('引号转义', esc('a"b\'c')==='a&quot;b&#39;c');
t('null / undefined 安全', esc(null)==='' && esc(undefined)==='');

/* ---------- 10. 在线 feed 数据契约（loadFeed 依赖的数据层） ---------- */
sec('10. 在线 feed 数据契约');
var feed = JSON.parse(require('fs').readFileSync(require('path').resolve(__dirname, '..', 'feed.json'), 'utf8'));
t('feed 含情报数组', Array.isArray(feed.intel) && feed.intel.length>=1, feed.intel && feed.intel.length);
t('feed 条目可经 extractDataPoints 派生数据点',
  feed.intel.every(function(it){
    var dps = extractDataPoints((it.title||'') + '。' + (it.body||it.read||''), {date: it.date, src: it.src});
    return Array.isArray(dps);
  }));
t('feed 条目必填字段齐全', feed.intel.every(function(it){ return it.id && it.title && it.src && it.date; }));

/* ---------- 11. P2 信号时间线 + 跨源关联（数据层） ---------- */
sec('11. P2 信号时间线 + 跨源关联');
var st = signalTrend();
t('signalTrend 返回 labels/avg/counts/flows', !!(st.labels && st.avg && st.counts && st.flows));
t('labels 与 avg/counts 等长', st.labels.length===st.avg.length && st.avg.length===st.counts.length);
t('labels 升序排列', st.labels.every(function(d,i){ return i===0 || d>=st.labels[i-1]; }), st.labels);
t('每日均值分数 ∈ [0,100]', st.avg.every(function(v){ return v>=0 && v<=100; }), st.avg);
t('预置数据跨多个日期（时间线非单点）', st.labels.length>=2, st.labels.length);
var all = groupByEvent();
var cs = crossSource();
t('crossSource 返回数组', Array.isArray(cs));
t('跨源关联包含多源覆盖事件', cs.some(function(g){ return g.items.length>=2; }));
t('若有分歧事件则必在跨源关联中', all.filter(function(g){return g.conflict;}).every(function(g){ return cs.some(function(c){ return c.name===g.name; }); }));
t('跨源关联按信源数降序（多源优先）', cs.every(function(g,i){ return i===0 || cs[i-1].items.length>=g.items.length; }));

/* ---------- 12. P2 增强：流向堆叠 / 时间跨度 / 关注突增 ---------- */
sec('12. P2 增强（流向带 / 跨度 / 突增）');
t('signalTrend.flows 与 labels 等长', st.flows.length===st.labels.length, [st.flows.length, st.labels.length]);
t('每日流向条数之和 = 当日情报条数',
  st.flows.every(function(f,i){
    var sum = Object.keys(f).reduce(function(a,k){ return a + (f[k]||0); }, 0);
    return sum === st.counts[i];
  }), st.flows);
t('流向键只出现 more/less/shift',
  st.flows.every(function(f){ return Object.keys(f).every(function(k){ return ['more','less','shift'].indexOf(k)>=0; }); }));

var sp0 = crossSpan({items:[{date:'2025-08-01'},{date:'2025-08-05'},{date:'2025-08-03'}]});
t('crossSpan 取最早最晚日期', sp0.from==='2025-08-01' && sp0.to==='2025-08-05', sp0);
t('crossSpan 天数含首尾（8/1→8/5 = 5 天）', sp0.days===5, sp0.days);
t('crossSpan 单日事件 = 1 天', crossSpan({items:[{date:'2025-08-01'}]}).days===1);
t('crossSpan 空输入不炸', crossSpan({}).days===0 && crossSpan({items:[]}).from==='');
t('crossSource 每组都带 span', cs.every(function(g){ return g.span && typeof g.span.days==='number'; }));
t('span 天数 ≥ 1（有日期时）', cs.every(function(g){ return !g.span.from || g.span.days>=1; }));

var spk = detectSpikes();
t('detectSpikes 返回数组', Array.isArray(spk));
t('突增阈值默认 3', SPIKE_MIN===3);
t('突增项条数均 ≥ SPIKE_MIN', spk.every(function(x){ return x.n>=SPIKE_MIN; }), spk.map(function(x){return x.n;}));
t('突增项按条数降序', spk.every(function(x,i){ return i===0 || spk[i-1].n>=x.n; }));
t('突增项含 say / intelId / span', spk.every(function(x){ return x.say && typeof x.intelId==='string' && x.span; }));
t('提高阈值后结果不增多', detectSpikes(99).length<=spk.length);
t('阈值 2 时结果 ⊇ 默认阈值结果',
  spk.every(function(x){ return detectSpikes(2).some(function(y){ return y.name===x.name; }); }));

/* ---------- 13. LLM 成本闸门 ---------- */
sec('13. LLM 成本闸门');
DB.llm = {vendor:'', key:'', model:''};
var hi = {id:'_g1', src:'国家统计局', inc:'hard', multi:true, date: todayStr()};   // 73 分
var lo = {id:'_g2', src:'自媒体／小作文', inc:'emo', date: todayStr()};            // 低分
t('未配 key 时闸门关闭', llmGate(hi).ok===false && llmGate(hi).code==='nokey');
DB.llm = {vendor:'glm', key:'test-key-not-real', model:''};
t('配了 key + 高分 → 放行', llmGate(hi).ok===true, llmGate(hi));
t('低分被闸门拦下', llmGate(lo).ok===false && llmGate(lo).code==='lowscore', llmGate(lo));
t('闸门阈值 = GATE.llmMinScore', score(hi).v>=GATE.llmMinScore && score(lo).v<GATE.llmMinScore, [score(hi).v, score(lo).v]);
t('已 LLM 拆解过的不重复调用',
  llmGate({id:'_g3', src:'国家统计局', inc:'hard', multi:true, a331:{engine:'llm'}}).code==='done');
t('空条目安全返回', llmGate(null).ok===false && llmGate(null).code==='noitem');
DB.llmStat = {day: todayStr(), n: GATE.dailyLlmCap};
t('日上限用满后拦下', llmGate(hi).ok===false && llmGate(hi).code==='cap', llmGate(hi));
DB.llmStat = {day:'1999-01-01', n: 999};
t('跨天自动清零计数', llmUsage().n===0 && llmUsage().day===todayStr(), llmUsage());
t('bumpLlmUsage 累加', (function(){ DB.llmStat={day:todayStr(), n:0}; bumpLlmUsage(); return bumpLlmUsage()===2; })());
DB.llm = {vendor:'', key:'', model:''};
DB.llmStat = {day: todayStr(), n: 0};

sec('14. 投资级 331 字段（level / flow_mag / flow_dur / confidence / reserve / impact.domains）');
var it = {id:'_i1', title:'北京优化住房限购', src:'北京市住建委', body:'非京籍五环内社保年限 2 年改 1 年，公积金贷款上限提高', date: todayStr(), url:'http://x'};
var rule = analyze331(it);
t('规则版含 level（由角色映射）', typeof rule.q2_who.level === 'string');
t('规则版 flow_mag 默认 中', rule.flow_mag === '中');
t('规则版 flow_dur 默认 趋势', rule.flow_dur === '趋势');
t('规则版 confidence 三字段齐全', rule.confidence && typeof rule.confidence.land_prob==='number' && typeof rule.confidence.market_conf==='number' && 'falsify' in rule.confidence);
t('规则版 reserve 默认空串', rule.reserve === '');
t('规则版 impact.domains 为空数组', Array.isArray(rule.impact.domains) && rule.impact.domains.length===0);
var o = {
  q2_who:{name:'北京市住建委', role:'macro', discount:'', level:'地方'},
  flow:'more', flow_mag:'中', flow_dur:'趋势', flow_why:'门槛降',
  impact:{domains:[{id:'equity', dir:'利好', strength:'中', horizon:'半年+', text:'地产链边际改善', chain:['政策','产业链','组合']}]},
  confidence:{land_prob:0.7, market_conf:0.5, falsify:'若成交未放量说明力度不足'},
  reserve:'中金认为作用有限'
};
var m = {}; mergeLLM(m, o);
t('mergeLLM 透传 level', m.a331.q2_who.level === '地方');
t('mergeLLM flow_mag 非法值回退 中', (function(){ var x={}; mergeLLM(x,{flow:'more',flow_mag:'巨',flow_dur:'永恒'}); return x.a331.flow_mag==='中' && x.a331.flow_dur==='趋势'; })());
t('mergeLLM confidence 被 clamp 到 [0,1]', (function(){ var x={}; mergeLLM(x,{confidence:{land_prob:5, market_conf:-1, falsify:'g'}}); return x.a331.confidence.land_prob===1 && x.a331.confidence.market_conf===0; })());
t('mergeLLM reserve 透传', m.a331.reserve === '中金认为作用有限');
t('mergeLLM llmImpact.domains 透传', m.llmImpact && m.llmImpact.domains && m.llmImpact.domains[0].id === 'equity');
t('mergeLLM 旧 impact{equity,bond} 不报错', (function(){ var x={}; mergeLLM(x,{impact:{equity:'好',bond:''}}); return x.llmImpact && !x.llmImpact.domains; })());

console.log('\n' + '='.repeat(44));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if(fail){ console.log('  失败项：\n   - ' + failed.join('\n   - ')); }
console.log('='.repeat(44));
process.exit(fail>0 ? 1 : 0);

/* 331 财经情报站 · 静态一致性与规范检查
   守住三条底线：零外部依赖、无悬空引用、合规措辞 */

var ex = require('./extract');

var html = ex.readHtml();
var js = ex.extractScripts(html).join('\n');
var markup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');

var pass = 0, fail = 0, failed = [];
function t(name, cond, extra){
  if(cond){ pass++; console.log('  \u2713 ' + name); }
  else {
    fail++; failed.push(name);
    console.log('  \u2717 ' + name + (extra!==undefined ? '  \u2192  ' + JSON.stringify(extra) : ''));
  }
}
function sec(s){ console.log('\n=== ' + s + ' ==='); }

/* ---------- 1. 零外部依赖 ---------- */
sec('1. 零外部依赖（离线可用）');
var extLinks = (html.match(/(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*/g) || []);
t('无任何外部 CDN / 字体 / 图表库引用', extLinks.length===0, extLinks);
t('无 import / require 外部模块', /\b(?:import\s+[\w{*]|require\s*\()/.test(js)===false);
t('存在内联样式块', html.indexOf('<style>')>=0);
t('存在内联脚本块', ex.extractScripts(html).length>=1);

/* ---------- 2. 图标规范 ---------- */
sec('2. 图标与字体规范');
var emoji = html.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
t('全文无 emoji 当图标', emoji===null, emoji ? emoji.slice(0,8) : null);
var svgCount = (html.match(/<svg/g) || []).length;
t('使用内联 SVG 图标（≥20 处）', svgCount>=20, svgCount);
t('使用系统字体栈', /-apple-system|BlinkMacSystemFont/.test(html));

/* ---------- 3. 函数与元素引用完整性 ---------- */
sec('3. 引用完整性');
var defined = {};
(js.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(function(m){
  defined[m.replace(/function\s+/, '').replace(/\s*\($/, '')] = 1;
});
var GLOBALS = ['alert','confirm','prompt','parseInt','parseFloat','isNaN','encodeURIComponent',
  'decodeURIComponent','setTimeout','setInterval','String','Number','Boolean','Array','Object',
  'JSON','Math','Date','Blob','FileReader','URL','if','for','while','return','typeof','switch','catch','function'];

var calls = {};
var evtRe = /on(?:click|change|input|submit|keyup|load)\s*=\s*(["'])([\s\S]*?)\1/g, em;
while((em = evtRe.exec(html)) !== null){
  var body = em[2];
  var cre = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g, cm;
  while((cm = cre.exec(body)) !== null) calls[cm[1]] = 1;
}
var missingFn = Object.keys(calls).filter(function(c){
  return !defined[c] && GLOBALS.indexOf(c)<0;
});
console.log('     函数定义 ' + Object.keys(defined).length + ' 个，内联事件调用 ' + Object.keys(calls).length + ' 个');
t('内联事件调用的函数全部有定义', missingFn.length===0, missingFn);

var idsUsed = {};
var idRe = /getElementById\(\s*(["'])([^"']+)\1\s*\)/g, im;
while((im = idRe.exec(js)) !== null) idsUsed[im[2]] = 1;
var idsDefined = {};
(markup.match(/\sid\s*=\s*["']([^"']+)["']/g) || []).forEach(function(m){
  idsDefined[m.replace(/^\s*id\s*=\s*["']/, '').replace(/["']$/, '')] = 1;
});
(js.match(/id="([A-Za-z_][\w\-]*)"/g) || []).forEach(function(m){
  idsDefined[m.slice(4, -1)] = 1;
});
var missingId = Object.keys(idsUsed).filter(function(i){ return !idsDefined[i]; });
console.log('     取用 id ' + Object.keys(idsUsed).length + ' 个，已定义 id ' + Object.keys(idsDefined).length + ' 个');
t('所有取用的元素 id 都存在', missingId.length===0, missingId);

/* ---------- 4. 移动端适配 ---------- */
sec('4. 移动端适配');
t('声明 viewport', /name=["']viewport["']/.test(html));
t('viewport 支持刘海屏', /viewport-fit=cover/.test(html));
t('适配 iPhone 底部安全区', html.indexOf('safe-area-inset')>=0);
t('输入框字号 ≥16px（防 iOS 缩放）', /font-size:\s*1[6-9]px/.test(html));
t('按钮点击区 ≥44px', /min-height:\s*4[4-9]px|min-height:\s*[5-9]\dpx/.test(html));
t('存在窄屏媒体查询', html.indexOf('@media')>=0);
t('可添加到主屏幕', /apple-mobile-web-app-capable/.test(html));

/* ---------- 5. 数据安全闭环 ---------- */
sec('5. 数据安全闭环');
t('提供 JSON 导出', js.indexOf('function exportJSON')>=0);
t('提供导入恢复', js.indexOf('function importJSON')>=0);
t('提供 CSV 导出', js.indexOf('function exportCSV')>=0);
t('清空数据有二次确认', /function askClear/.test(js) && /showModal|confirm/.test(js));
t('导入无条数上限', /slice\(0,\s*\d+\)/.test(js.slice(js.indexOf('function importJSON'), js.indexOf('function importJSON')+900))===false);
t('存储写入有异常兜底', /catch\s*\([\s\S]{0,40}\)\s*\{[\s\S]{0,120}存储/.test(js));

/* ---------- 6. 合规措辞 ---------- */
sec('6. 合规底线');
var BANNED = ['推荐买入','建议买入','建议持有','必涨','稳赚','保本','包赚','荐股','目标价','抄底信号','financial advice'];
var hit = BANNED.filter(function(w){ return html.indexOf(w)>=0; });
t('无投顾类违规措辞', hit.length===0, hit);
t('页面含免责声明', html.indexOf('不构成任何投资建议')>=0);
t('明示不代表涨跌方向', html.indexOf('不代表涨跌方向')>=0);
t('明示不含标的推荐', html.indexOf('不含任何标的推荐')>=0);
t('明示数据仅存本机', /只在本机|仅存本机|不上传|存在你的浏览器/.test(html));

/* ---------- 7. 体积 ---------- */
sec('7. 体积');
var bytes = Buffer.byteLength(html, 'utf8');
console.log('     index.html = ' + (bytes/1024).toFixed(1) + 'KB');
t('单文件体积 < 500KB', bytes < 500*1024, (bytes/1024).toFixed(1)+'KB');

console.log('\n' + '='.repeat(44));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if(fail){ console.log('  失败项：\n   - ' + failed.join('\n   - ')); }
console.log('='.repeat(44));
process.exit(fail>0 ? 1 : 0);

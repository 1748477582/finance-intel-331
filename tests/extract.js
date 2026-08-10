/* 从 index.html 中抽取脚本与数据层，供 run.js / lint.js 复用 */
var fs = require('fs');
var path = require('path');

var HTML_PATH = path.join(__dirname, '..', 'index.html');
var RENDER_MARK = '/* ==========================================================\n   渲染层';
var CORE_MARK = '331 财经情报站 —— 数据层';

function readHtml(){
  return fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
}

function extractScripts(html){
  var out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
  while((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/* 数据层：无任何 DOM 依赖，可在 Node 里直接 eval */
function extractCore(html){
  var js = extractScripts(html).join('\n');
  if(js.indexOf(CORE_MARK) < 0) throw new Error('index.html 里找不到数据层起始标记，注释块是否被改动？');
  var i = js.indexOf(RENDER_MARK);
  if(i < 0) throw new Error('index.html 里找不到渲染层起始标记，注释块是否被改动？');
  return js.slice(0, i);
}

module.exports = {
  HTML_PATH: HTML_PATH,
  readHtml: readHtml,
  extractScripts: extractScripts,
  extractCore: extractCore
};

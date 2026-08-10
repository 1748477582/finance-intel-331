// Runtime smoke test: mock DOM + run the full index.html script, then renderAll + openDetail.
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
  this.addEventListener = function(){};
  this.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get() { return this._html; }, set(v) { this._html = String(v); }
});
const els = {};
const document = {
  getElementById(id) { return els[id] || (els[id] = new FakeEl(id)); },
  createElement() { return new FakeEl('created'); }
};
const store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k,v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; }
};
const sandbox = {
  document, window: { scrollTo(){} }, localStorage, alert(){}, console,
  setTimeout, clearTimeout, Math, JSON, Date, String, Array, Object, Number,
  parseInt, parseFloat, isNaN, RegExp, Boolean, escape
};
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'index-inline.js' });
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// Inspect what got defined
const fns = ['renderAll','renderDash','renderDatacenter','renderSettings','openDetail','renderDetail','go','seed','load'];
console.log('--- defined functions ---');
fns.forEach(f => console.log(f, typeof sandbox[f]));

try {
  sandbox.renderAll();
  console.log('--- renderAll() OK ---');
  ['dashAlerts','dashHeads','radList','fieldChart','slowList','dTrend','dAlerts','dIndTable','watchList','srcInfo','flowN','flowBar','macroList','detailBox']
    .forEach(id => {
      const len = els[id] && els[id]._html ? els[id]._html.length : 0;
      console.log('  #' + id + ' html len =', len);
    });
} catch (e) {
  console.error('RENDER ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

// Open a detail for the first intel (if any)
try {
  const db = sandbox.DB || (sandbox.load && sandbox.load()) || {};
  const intel = (sandbox.DB && sandbox.DB.intel) || [];
  if (intel.length) {
    sandbox.openDetail(intel[0].id);
    console.log('--- openDetail("' + intel[0].id + '") OK; detailBox html len =',
      els['detailBox'] ? els['detailBox']._html.length : 0);
  } else {
    console.log('--- no intel to openDetail ---');
  }
} catch (e) {
  console.error('OPENDETAIL ERROR:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('\nSMOKE TEST PASSED');

// Verify loadFeed() consumes feed.json on first visit (no localStorage KEY).
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function FakeEl(id) {
  this.id = id; this._html = ''; this.value = ''; this.textContent = '';
  this.options = []; this.style = {}; this.addEventListener = function(){};
  this.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get() { return this._html; }, set(v) { this._html = String(v); }
});
const els = {};
const document = {
  getElementById(id){ return els[id] || (els[id] = new FakeEl(id)); },
  createElement(){ return new FakeEl('created'); }
};
const store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k,v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; }
};

const feedRaw = fs.readFileSync('feed.json', 'utf8');
const sandbox = {
  document, window: { scrollTo(){} }, localStorage, alert(){}, console,
  setTimeout, clearTimeout, Math, JSON, Date, String, Array, Object, Number,
  parseInt, parseFloat, isNaN, RegExp, Boolean,
  fetch: async () => ({ ok: true, json: async () => JSON.parse(feedRaw) })
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'index-inline.js' });

// 真实抓取后 feed 里不再有「样例」占位标题，改用「标题集合是否来自 feed.json」做溯源判定
const FEED = JSON.parse(feedRaw);
const feedTitles = new Set((FEED.intel || []).map(i => i.title));
const countFromFeed = arr => (arr || []).filter(i => feedTitles.has(i.title)).length;

(async () => {
  try {
    await sandbox.loadFeed();
    const intel = sandbox.DB.intel;
    const fromFeed = countFromFeed(intel);
    console.log('feed.json items  =', (FEED.intel || []).length, '| llm 增强 =', (FEED.stat && FEED.stat.llm) || 0);
    console.log('intel count      =', intel ? intel.length : 'n/a');
    console.log('feed-sourced     =', fromFeed);
    console.log('first src        =', intel && intel[0] && intel[0].src);
    console.log('feed.last 记录   =', sandbox.DB.feed && sandbox.DB.feed.last ? 'yes' : 'no');
    console.log('dps derived      =', intel && intel[0] && Array.isArray(intel[0].dps) ? intel[0].dps.length : 'n/a');
    if (fromFeed >= 1 && fromFeed === (FEED.intel || []).length && Array.isArray(intel[0].dps)) {
      console.log('\nLOADFEED TEST PASSED');
    } else {
      console.error('\nLOADFEED TEST FAILED');
      process.exit(1);
    }

    // --- Force-refresh test: refreshFeed() must bypass the _loadedFromStorage guard ---
    // Simulate a returning user whose local store now exists, then clear their in-memory intel
    // and confirm the manual "刷新情报" button still repopulates from feed.json.
    const KEY = sandbox.KEY || 'wb_331_data_v4';
    store[KEY] = JSON.stringify(sandbox.DB);
    sandbox.load();                                   // re-reads store -> _loadedFromStorage = true
    sandbox.DB.intel = [];                            // simulate local view emptied
    const cleared = sandbox.DB.intel.length;
    await sandbox.refreshFeed();                      // force path -> re-applies online feed
    const reFed = countFromFeed(sandbox.DB.intel);
    console.log('force-refresh intel =', sandbox.DB.intel.length, '| cleared =', cleared, '| feed-sourced =', reFed);
    if (reFed >= 1 && sandbox.DB.intel.length > cleared) {
      console.log('\nREFRESH TEST PASSED');
    } else {
      console.error('\nREFRESH TEST FAILED');
      process.exit(1);
    }
  } catch (e) {
    console.error('LOADFEED ERROR:', e.message);
    console.error((e.stack || '').split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
})();

/* 财经情报站 - Service Worker */
const CACHE_NAME = 'finance-intel-331-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

/* 安装：预缓存核心资源 */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_ASSETS).catch(function() {
        /* 部分资源可能不存在，不阻塞安装 */
        return Promise.resolve();
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* 激活：清理旧缓存 */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* 请求拦截：策略路由 */
self.addEventListener('fetch', function(event) {
  const req = event.request;

  /* 只处理GET请求 */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* feed.json：网络优先，失败回退缓存（数据每日更新） */
  if (url.pathname.endsWith('/feed.json') || url.pathname === '/feed.json') {
    event.respondWith(
      fetch(req).then(function(response) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(req);
      })
    );
    return;
  }

  /* 导航请求（HTML页面）：网络优先，失败回退缓存，再失败回退index.html */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function(response) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* 其他资源（图标、manifest等）：网络优先，缓存回退 */
  event.respondWith(
    fetch(req).then(function(response) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(req, clone);
      });
      return response;
    }).catch(function() {
      return caches.match(req);
    })
  );
});
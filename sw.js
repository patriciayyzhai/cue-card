/* Offline shell: cache-first for app assets, network-first (cache fallback) for the cloud SDK CDN.
   Cached assets are query-free, so any entry URL (with or without ?sharecode=...) resolves to the
   cached app shell. Only registered over https. */
var CACHE = 'cuecard-v4';
var SHELL = 'index.html';
var ASSETS = [SHELL, 'styles.css', 'seed.js', 'app.js', 'cloud-config.js', 'cloud.js',
  'vendor/workbuddy-cloud-sdk.global.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Each asset individually: one failed fetch must never break the offline shell.
      return Promise.all(ASSETS.map(function (a) {
        return c.add(a).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var same;
  try { same = new URL(req.url).origin === self.location.origin; } catch (err) { return; }

  if (!same) {
    // Cross-origin (cloud SDK): use the network when available, fall back to the cached copy offline.
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque')) {
          var cp = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp).catch(function () {}); });
        }
        return r;
      }).catch(function () { return caches.match(req, { ignoreSearch: true }); })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.ok) {
          var cp = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); });
        }
        return r;
      }).catch(function () { return hit; });

      // Navigations (home-screen launch is "/" or "/?sharecode=...") fall back to the cached shell.
      if (hit) return hit;
      var wantsHtml = req.mode === 'navigate' || req.mode === 'navigation' ||
        ((req.headers.get('accept') || '').indexOf('text/html') > -1);
      if (wantsHtml) return caches.match(SHELL).then(function (shell) { return shell || net; });
      return net;
    })
  );
});

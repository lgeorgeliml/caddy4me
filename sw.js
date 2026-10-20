/* Caddy4Me service worker: offline app shell + cached map tiles */
var SHELL = 'c4m-shell-v2';
var FONTS = 'c4m-fonts-v1';
var TILES = 'c4m-tiles-v1';
var FILES = ['./', 'index.html', 'styles.css', 'engine.js', 'map.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'images/amen-corner.jpg', 'images/bunker.jpg', 'images/fairway.jpg', 'images/golf-ball.jpg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== TILES && k !== FONTS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // V2 fonts: cache first so the look survives no signal on the course
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (res) { if (res.ok || res.type === 'opaque') c.put(e.request, res.clone()); return res; });
      });
    }));
    return;
  }
  if (url.hostname === 'server.arcgisonline.com') {
    // map tiles: cache first, keep what has been seen
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (res) { if (res.ok || res.type === 'opaque') c.put(e.request, res.clone()); return res; });
      });
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    // app files: serve cached copy straight away, refresh it in the background
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(e.request).then(function (res) { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
  // everything else (wind API) goes straight to the network
});

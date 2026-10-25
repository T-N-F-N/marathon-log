// Offline support: always try the network first so updates show up at once; fall back to the cache when offline.
const CACHE = "marathon-log-v4";
const SHELL = ["./", "index.html", "run.js", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const cacheable = url.origin === location.origin || url.host.includes("fonts.") || url.host === "cdnjs.cloudflare.com";
  if (!cacheable) return;   // 地図タイルなどはキャッシュしない
  const key = e.request.mode === "navigate" ? "index.html" : e.request;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key, {ignoreSearch: true}))
  );
});

// Service worker: makes the app installable and load offline.
const CACHE = "lph-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./core.js", "./billing.js", "./stock.js", "./parties.js", "./reports.js", "./firebase-config.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase SDK files from gstatic: cache-first (versioned URLs never change)
  if (url.hostname === "www.gstatic.com") {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    })));
    return;
  }

  // Our own files: network-first so updates show immediately, fall back to cache offline
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))));
  }
  // Everything else (Firestore / Auth APIs) goes straight to the network.
});

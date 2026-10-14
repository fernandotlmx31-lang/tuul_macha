/* Service worker: deja la app disponible sin internet una vez abierta.
   Si cambias archivos de la app, sube el número de VERSION para forzar la actualización. */
const VERSION = "1";
const CACHE = "tuul-pos-v" + VERSION;
const SHELL = [
  "./", "index.html", "style.css", "storage.js", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mine = url.origin === location.origin;
  const fonts = url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com");
  if (!mine && !fonts) return;

  // Muestra lo guardado al instante y actualiza en segundo plano
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; })
        .catch(() => cached || (req.mode === "navigate" ? cache.match("index.html") : Response.error()));
      return cached || network;
    })
  );
});

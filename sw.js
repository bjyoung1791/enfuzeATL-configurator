// Enfuze Configurator — service worker
// Bump CACHE_VERSION when shipping updates so clients pick up new app shell.
const CACHE_VERSION = "v9";
const APP_CACHE = `enfuze-app-${CACHE_VERSION}`;
const RUNTIME_CACHE = `enfuze-runtime-${CACHE_VERSION}`;

// HTML pages + static assets served from our own origin.
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./projects.html",
  "./manifest.json",
  "./enfuzelogo-brown.png",
];

// Third-party CDN scripts the app depends on. Precaching these means a
// flaky CDN never results in a blank page after the SW has installed.
// Cross-origin responses come back as "opaque" (no body inspection) but
// are still valid cache entries that the browser can replay.
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Use allSettled so a single CDN flake doesn't abort SW installation.
    await Promise.allSettled([
      ...APP_SHELL.map((u) => cache.add(u)),
      ...CDN_ASSETS.map((u) => cache.add(new Request(u, { mode: "no-cors" }))),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Same-origin /api/* routes must never be cached — they're dynamic and
  // stale responses would silently show old data (e.g. the Users list
  // after creating a new user). Pass through to the network unmodified.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }

  // HTML navigations: network-first so updates ship; fall back to cached shell.
  // ALWAYS return a Response — never resolve to undefined (that produces a
  // blank page in the browser).
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const copy = res.clone();
        caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      } catch (e) {
        // Network failed. Try exact match, then the app shell.
        const exact = await caches.match(req);
        if (exact) return exact;
        // Match against the pathname only (strips query string), which is
        // what handles .../index.html?project=123 falling back to cached
        // .../index.html.
        const pathOnly = new Request(url.origin + url.pathname);
        const byPath = await caches.match(pathOnly);
        if (byPath) return byPath;
        const shell = await caches.match("./index.html");
        if (shell) return shell;
        return new Response(
          "<!doctype html><meta charset=utf-8><title>Offline</title>" +
          "<body style=\"font-family:sans-serif;padding:40px;text-align:center\">" +
          "<h2>You're offline</h2><p>This page hasn't been cached yet.</p></body>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // Supabase REST: network-first with cache fallback for offline reads.
  if (url.hostname.endsWith("supabase.co")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (CDN JS, fonts, icons): cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

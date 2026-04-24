// Enfuze Configurator — service worker
// Bump CACHE_VERSION when shipping updates so clients pick up new app shell.
const CACHE_VERSION = "v16";
const RUNTIME_CACHE = `enfuze-runtime-${CACHE_VERSION}`;

// Scope is kept minimal on purpose:
//   * HTML navigations are NOT intercepted — the browser talks to the
//     server directly. This avoids the class of "blank page after the SW
//     caches a weird response / race on activation" bugs we were hitting.
//     The app is staff-only and assumes a network connection anyway.
//   * Same-origin /api/* is bypassed so dynamic API responses can never
//     be served stale.
//   * Cross-origin CDN scripts + fonts are cache-first for speed, since
//     they're versioned (URL includes the version number).
//   * Supabase REST is network-first with cache fallback for brief
//     offline moments.

self.addEventListener("install", (event) => {
  // No precaching. The old cache from v9 and earlier is cleaned in activate.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Never intercept HTML navigations. Let the browser talk to the server
  // directly. This is the safest default for a staff-only, always-online
  // app and rules the service worker out as a cause of blank pages.
  if (req.mode === "navigate") return;

  const url = new URL(req.url);

  // Same-origin /api/* is always network — never cache dynamic API data.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }

  // Same-origin static assets (including HTML that's fetched as a
  // sub-resource) — pass through to the network to avoid ever serving a
  // stale page. We still cache CDN assets below for perf.
  if (url.origin === self.location.origin) {
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

  // Cross-origin CDN (React, Babel, XLSX, Supabase JS, fonts): cache-first.
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

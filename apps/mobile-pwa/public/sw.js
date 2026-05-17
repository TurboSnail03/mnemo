/**
 * Mnemo Service Worker — v3
 *
 * ─── The blank-screen bug explained ──────────────────────────────────────────
 * Vite builds produce content-hashed JS chunks (e.g. index-Abc123.js).
 * The old SW was caching /index.html with Cache-First, so after a deploy:
 *   • SW serves stale index.html  →  references OLD chunk filenames
 *   • Old chunks no longer exist on Vercel  →  404  →  blank screen
 *
 * The fix: HTML navigation requests always go NetworkFirst.  The hashed JS/CSS
 * chunks are content-addressed so CacheFirst is safe for them.
 *
 * ─── Cache strategy ──────────────────────────────────────────────────────────
 * • Navigation (HTML)  →  NetworkFirst (fall back to cached shell if offline)
 * • Same-origin assets (JS/CSS/fonts with hash in URL)  →  CacheFirst
 * • API requests & googleapis.com  →  NetworkOnly  (never cache personal data)
 * • Google Fonts stylesheets  →  StaleWhileRevalidate
 */

// Bump this string on every deploy to invalidate the old cache instantly.
// The build pipeline (or a pre-commit hook) should do this automatically.
// Using ISO timestamp as the version so it's always unique.
const CACHE_VERSION = 'mnemo-v3-__BUILD_TS__';
const SHELL_CACHE   = `shell-${CACHE_VERSION}`;
const ASSET_CACHE   = `assets-${CACHE_VERSION}`;
const FONT_CACHE    = 'mnemo-fonts-v1';          // intentionally stable — fonts don't change

// Minimal app shell — only pre-cache lightweight, stable files
const SHELL_PRECACHE = [
  '/manifest.json',
  '/favicon.svg',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_PRECACHE))
      .then(() => self.skipWaiting())   // activate immediately, don't wait for old tabs to close
  );
});

// ── Activate: delete every cache that doesn't match current version ───────────
self.addEventListener('activate', (event) => {
  const keepCaches = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => !keepCaches.has(k))
          .map((k) => {
            console.log('[Mnemo SW] Deleting stale cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests — always pass through (POST, PUT, DELETE for API calls)
  if (request.method !== 'GET') {
    return;   // let browser handle normally — no respondWith = default network
  }

  // 2. API backend (Render URL or localhost dev) — NetworkOnly
  //    Match: anything that isn't the app's own Vercel origin, except fonts CDN
  const isGoogleApi    = url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('google.com');
  const isExternalApi  = url.hostname.includes('render.com') || url.hostname.includes('onrender.com');
  const isLocalApi     = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const isOAuthRelated = url.pathname.includes('/oauth') || url.pathname.includes('/token');

  if (isLocalApi || isExternalApi || isOAuthRelated) {
    // NetworkOnly: don't intercept, just let the browser fetch normally
    return;
  }

  // 3. Google Font stylesheets — StaleWhileRevalidate (updates in background)
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // 4. Google Font files — CacheFirst (woff2 files with version in URL — stable)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // 5. Google API / OAuth calls — NetworkOnly (never cache tokens or user data)
  if (isGoogleApi) {
    return;
  }

  // 6. HTML Navigation (the app shell at /) — NetworkFirst
  //    This is the critical fix: always try to get fresh index.html
  //    so new Vite chunk filenames are referenced correctly.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 7. Same-origin hashed assets (JS/CSS — e.g. /assets/index-Abc123.js)
  //    These are content-addressed so CacheFirst is safe forever.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // 8. Everything else on the same origin — StaleWhileRevalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
  // All other cross-origin requests fall through to the browser (default network)
});

// ── Strategy implementations ──────────────────────────────────────────────────

/**
 * NetworkFirst for navigation: try network, fall back to cached index.html.
 * Timeout after 4 s to avoid hanging on flaky connections.
 */
async function networkFirstNavigation(request) {
  try {
    const networkResponse = await fetchWithTimeout(request, 4000);
    // Cache the fresh index.html for offline fallback
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    // Network failed (offline or timeout) — serve cached index.html
    const cached = await caches.match('/index.html') || await caches.match('/');
    return cached || new Response('Mnemo is offline and has no cached shell yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * CacheFirst: serve from cache; if miss, fetch, cache, return.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

/**
 * StaleWhileRevalidate: serve from cache immediately (if available),
 * then update cache in the background from network.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => cached);  // if network fails and we had no cache, re-use cached

  return cached || networkFetch;
}

/**
 * fetch() with a configurable timeout.
 */
function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── Message handler: allow the app to force SW update ─────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── ArthaSaathi Service Worker ──────────────────────────────────────────────
// Strategy: Cache-first for assets, network-first for dynamic data
// Version bump the CACHE_NAME to force update on deploy

const CACHE_NAME      = 'arthasaathi-v1.0.0';
const STATIC_CACHE    = 'arthasaathi-static-v1.0.0';
const DYNAMIC_CACHE   = 'arthasaathi-dynamic-v1.0.0';

// ── Assets to pre-cache on install ─────────────────────────────────────────
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Fonts (cache Google Fonts fallback)
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// ── Install: pre-cache critical assets ─────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing ArthaSaathi Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      console.log('[SW] Pre-caching app shell');
      // Use addAll with individual error handling
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn(`[SW] Failed to cache: ${url}`, err))
        )
      );
    }).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// ── Activate: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating ArthaSaathi Service Worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activation complete — claiming clients');
      return self.clients.claim(); // Take control of all open tabs
    })
  );
});

// ── Fetch: cache-first with network fallback ────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and browser extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.origin.includes('analytics') || url.origin.includes('hotjar')) return;

  // ── Strategy 1: Cache-first for static assets (JS, CSS, images, fonts)
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Strategy 2: Network-first for HTML navigation (always get fresh HTML)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // ── Strategy 3: Stale-while-revalidate for everything else
  event.respondWith(staleWhileRevalidate(request));
});

// ── Caching Strategies ──────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise || offlineFallback(request);
}

// ── Offline fallback page ───────────────────────────────────────────────────
async function offlineFallback(request) {
  if (request.headers.get('accept')?.includes('text/html')) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;

    // Inline offline page as last resort
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  return new Response('Offline', { status: 503 });
}

// ── Helper: detect static assets ───────────────────────────────────────────
function isStaticAsset(url) {
  return (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|webp)$/) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/static/')
  );
}

// ── Push Notifications ──────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {
    title: 'ArthaSaathi',
    body:  'Time to log today\'s expenses! 💰',
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  data.icon  || '/icons/icon-192.png',
      badge: data.badge || '/icons/icon-72.png',
      tag:   data.tag   || 'arthasaathi-reminder',
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: [
        { action: 'open',    title: '📊 Open App' },
        { action: 'dismiss', title: 'Dismiss'     },
      ]
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// ── Background Sync (for future API integration) ────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-expenses') {
    console.log('[SW] Background sync: syncing expenses...');
    // Reserved for future server sync feature
  }
});

// ── Inline Offline HTML ─────────────────────────────────────────────────────
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ArthaSaathi — Offline</title>
<style>
  body{font-family:'DM Sans',sans-serif;background:#f7f2ea;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  .wrap{max-width:320px}
  .icon{font-size:64px;margin-bottom:24px}
  h1{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:300;margin-bottom:12px;letter-spacing:-0.5px}
  p{font-size:15px;line-height:1.7;color:#7a7468;margin-bottom:28px}
  button{background:linear-gradient(135deg,#c9a84c,#e8c97a);border:none;padding:14px 32px;border-radius:50px;font-size:15px;font-weight:600;cursor:pointer;color:#0a0a0f}
</style>
</head>
<body>
<div class="wrap">
  <div class="icon">📡</div>
  <h1>You're offline</h1>
  <p>No internet connection detected. ArthaSaathi works offline — just reload once you had it open before.</p>
  <button onclick="location.reload()">Try Again</button>
</div>
</body>
</html>`;

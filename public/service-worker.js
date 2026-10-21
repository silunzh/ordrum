'use strict';

// scripts/version-pwa.cjs stamps this from the complete static shell before build.
const BUILD_ID = '274f4390fd332c72';
const BASE_URL = new URL('./',self.location.href);
const CACHE_SCOPE = BASE_URL.pathname === '/' ? '' : `${encodeURIComponent(BASE_URL.pathname)}-`;
const SHELL_PREFIX = `ordrum-shell-${CACHE_SCOPE}`;
const SHELL_CACHE = `${SHELL_PREFIX}${BUILD_ID}`;
const AUDIO_CACHE = `ordrum-audio-${CACHE_SCOPE}v1`;
const CORE_FILES = [
  'index.html','style.css','study.css','workspace.css','settings.css','settings.js','study.js','session.js','app.js','cloud.js',
  'pwa.js','github-sync.js','vocab.json','audio-map.json','manifest.webmanifest',
  'icons/icon.svg','icons/icon-192.png','icons/icon-512.png',
  'icons/icon-maskable-512.png','icons/apple-touch-icon.png',
];
// The host canonicalizes /index.html to /. Fetch the canonical shell directly
// so install never has to accept a redirected response (including auth pages).
const INDEX_URL = BASE_URL.href;
const CORE_URLS = new Set(CORE_FILES.map(file => file === 'index.html' ? INDEX_URL : new URL(file,BASE_URL).href));

function expectedType(url,response) {
  const type = response.headers.get('Content-Type')?.toLowerCase() || '';
  const path = new URL(url).pathname;
  if (url === INDEX_URL) return type.includes('text/html');
  if (path.endsWith('.js')) return /(?:javascript|ecmascript)/.test(type);
  if (path.endsWith('.css')) return type.includes('text/css');
  if (path.endsWith('.json') || path.endsWith('.webmanifest')) return /(?:application\/json|manifest\+json)/.test(type);
  if (path.endsWith('.png')) return type.includes('image/png');
  if (path.endsWith('.svg')) return type.includes('image/svg+xml');
  if (path.endsWith('.m4a')) return /(?:audio\/|video\/mp4|application\/octet-stream)/.test(type);
  return path.endsWith('.html') && type.includes('text/html');
}
async function safeStaticResponse(url,response) {
  if (!response || response.status !== 200 || response.redirected || response.type === 'opaque') return false;
  if (response.url && response.url !== url) return false;
  if (/(?:no-store|private)/i.test(response.headers.get('Cache-Control') || '')) return false;
  if (!expectedType(url,response)) return false;
  if (url === INDEX_URL) {
    const html = await response.clone().text();
    // A protected host may return a login page with a 200 status. Never retain it.
    if (!html.includes('id="mode-content"') || !html.includes('src="app.js"')) return false;
  }
  return true;
}

self.addEventListener('install',event => {
  event.waitUntil((async () => {
    try {
      const entries = await Promise.all(Array.from(CORE_URLS,async url => {
        const response = await fetch(new Request(url,{cache:'reload',credentials:'same-origin'}));
        if (!await safeStaticResponse(url,response)) throw new Error('Static shell is not ready for offline use.');
        return [url,response];
      }));
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(entries.map(([url,response]) => cache.put(url,response)));
      // Updates wait until the user approves or every older window is closed.
    } catch (error) {
      await caches.delete(SHELL_CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate',event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event => {
  if (event.data?.type === 'ORDRUM_ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'ORDRUM_CACHE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const ready = (await cache.keys()).length >= CORE_FILES.length;
      event.ports?.[0]?.postMessage({type:'ORDRUM_CACHE_STATUS',ready,build:BUILD_ID});
    })());
  }
});

function rangeResponse(response,rangeHeader) {
  return response.arrayBuffer().then(buffer => {
    const size = buffer.byteLength;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
    let start,end;
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
      end = match[1] ? (match[2] ? Math.min(Number(match[2]),size-1) : size-1) : size-1;
    }
    if (!match || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
      return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    }
    return new Response(buffer.slice(start,end+1),{status:206,statusText:'Partial Content',headers:{
      'Content-Type':response.headers.get('Content-Type') || 'audio/mp4',
      'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes',
    }});
  });
}
async function audioResponse(request,event) {
  const url = new URL(request.url);
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(url.href);
  if (cached) return request.headers.has('Range') ? rangeResponse(cached,request.headers.get('Range')) : cached;
  try {
    // iOS media requests use Range. Store a complete clip, then return its range.
    const headers = new Headers(request.headers);
    headers.delete('Range');
    const full = await fetch(new Request(url.href,{headers,credentials:'same-origin',cache:'no-cache'}));
    if (await safeStaticResponse(url.href,full)) {
      event.waitUntil(cache.put(url.href,full.clone()).catch(() => {}));
      return request.headers.has('Range') ? rangeResponse(full,request.headers.get('Range')) : full;
    }
    // Redirected authentication or other private responses are never cached.
    return fetch(request);
  } catch (_) {
    return new Response('This audio clip has not been saved for offline listening.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}
function isAppNavigation(url,request) {
  if (request.mode !== 'navigate' || ![BASE_URL.pathname,new URL('index.html',BASE_URL).pathname].includes(url.pathname)) return false;
  return !url.search || (Array.from(url.searchParams).length === 1 && url.searchParams.get('source') === 'homescreen');
}
self.addEventListener('fetch',event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== BASE_URL.origin) return;
  // Strict allowlists leave authentication, API, cloud progress and all unknown
  // URLs entirely to the network. No account information enters these caches.
  if (isAppNavigation(url,request)) {
    event.respondWith((async () => (await (await caches.open(SHELL_CACHE)).match(INDEX_URL)) || fetch(request))());
  } else if (CORE_URLS.has(url.href)) {
    event.respondWith((async () => (await (await caches.open(SHELL_CACHE)).match(url.href)) || fetch(request))());
  } else if (!url.search && url.pathname.startsWith(new URL('audio/',BASE_URL).pathname) && /\/[a-f0-9]{16}\.m4a$/.test(url.pathname)) {
    event.respondWith(audioResponse(request,event));
  }
});

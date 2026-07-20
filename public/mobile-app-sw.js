const SHELL_CACHE='codem8s-mobile-shell-v2';
const IDENTITY_CACHE='codem8s-mobile-identities-v1';
const SHELL=['/mobile-app.html','/codem8s-app-icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>![SHELL_CACHE,IDENTITY_CACHE].includes(key)).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const identity=url.pathname.startsWith('/mobile-manifest-')||url.pathname.startsWith('/mobile-icon-');
  if(identity){event.respondWith(caches.open(IDENTITY_CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||new Response('Not found',{status:404})));return;}
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(SHELL_CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('/mobile-app.html'))));
});
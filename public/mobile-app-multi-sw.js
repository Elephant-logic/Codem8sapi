self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  if(url.pathname===scope.pathname+'icon'){
    event.respondWith((async()=>{
      const keys=await caches.keys();
      for(const key of keys){
        if(!key.startsWith('codem8s-isolated-icon-'))continue;
        const hit=await caches.open(key).then(cache=>cache.match(url.pathname));
        if(hit)return hit;
      }
      return fetch('/codem8s-app-icon.svg');
    })());
  }
});
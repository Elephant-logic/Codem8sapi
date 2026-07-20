const scopeUrl=new URL(self.registration.scope);
const parts=scopeUrl.pathname.split('/').filter(Boolean);
const appId=parts[parts.length-1]||'app';
const cacheName='codem8s-isolated-v4-'+appId;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.add(new Request(scopeUrl.href,{cache:'reload'}))).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==scopeUrl.origin||!url.pathname.startsWith(scopeUrl.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    const cached=await cache.match(event.request,{ignoreSearch:true});
    if(cached)return cached;
    if(event.request.mode==='navigate'){
      try{
        const response=await fetch(event.request);
        if(response&&response.ok)await cache.put(scopeUrl.href,response.clone());
        return response;
      }catch{
        return (await cache.match(scopeUrl.href,{ignoreSearch:true}))||Response.error();
      }
    }
    try{return await fetch(event.request)}catch{return Response.error()}
  })());
});
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  try{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key==='codem8s-mobile-shell-v1'||key==='codem8s-mobile-shell-v2'||key==='codem8s-mobile-identities-v1').map(key=>caches.delete(key)));
    await self.registration.unregister();
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients)client.navigate(client.url);
  }catch{}
})())});
self.addEventListener('fetch',()=>{});
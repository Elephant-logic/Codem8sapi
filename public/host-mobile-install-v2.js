(() => {
  const frame=document.getElementById('codem8s-app'),STORE='codem8s_app_store_v1';
  const win=()=>frame?.contentWindow,doc=()=>{try{return frame?.contentDocument}catch{return null}};
  const badge=document.getElementById('codem8s-version');if(badge)badge.textContent='Codem8s 10.8.6';
  async function cleanOldWorker(){
    try{
      if('serviceWorker'in navigator){
        const rootScope=new URL('/',location.origin).href;
        for(const registration of await navigator.serviceWorker.getRegistrations()){
          const script=registration.active?.scriptURL||registration.installing?.scriptURL||registration.waiting?.scriptURL||'';
          if(registration.scope===rootScope||/\/mobile-app-sw\.js(?:$|\?)/.test(script))await registration.unregister();
        }
      }
      if('caches'in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter(key=>key.startsWith('codem8s-mobile-')&&!key.startsWith('codem8s-mobile-meta-v2')).map(key=>caches.delete(key)));
      }
    }catch{}
  }
  cleanOldWorker();
  addEventListener('pageshow',cleanOldWorker);
  function apps(){try{return JSON.parse(win().localStorage.getItem(STORE)||'[]')}catch{return[]}}
  function put(items){win().localStorage.setItem(STORE,JSON.stringify(items.slice(0,40)))}
  function wire(){const d=doc();if(!d||d.documentElement.dataset.mobileInstallV2)return;d.documentElement.dataset.mobileInstallV2='1';d.addEventListener('click',e=>{const b=e.target.closest('[data-continue]');if(!b)return;const overlay=b.closest('div[style*="z-index:2147483647"]');if(!overlay)return;e.preventDefault();e.stopImmediatePropagation();const name=String(overlay.querySelector('[data-name]')?.value||'').trim();const preview=overlay.querySelector('[data-preview]')?.src||'';const cardId=d.querySelector('#appsStoreGrid button[data-install][data-install-active]')?.dataset.install||overlay.dataset.appId||win().localStorage.getItem('codem8s_pending_install_id');const id=cardId||win().localStorage.getItem('codem8s_mobile_selected_app');if(!id||!name)return;put(apps().map(x=>x.id===id?{...x,installName:name,icon:preview||x.icon,updatedAt:Date.now()}:x));win().localStorage.setItem('codem8s_mobile_selected_app',id);overlay.remove();window.open('/mobile/index.html?id='+encodeURIComponent(id),'_blank','noopener')},true);d.addEventListener('click',e=>{const b=e.target.closest('button[data-install]');if(!b)return;win().localStorage.setItem('codem8s_pending_install_id',b.dataset.install);d.querySelectorAll('button[data-install]').forEach(x=>x.removeAttribute('data-install-active'));b.setAttribute('data-install-active','1')},true)}
  frame?.addEventListener('load',wire);setInterval(wire,800);
})();

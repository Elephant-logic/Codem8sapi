(() => {
  const frame=document.getElementById('codem8s-app'),STORE='codem8s_app_store_v1';
  const win=()=>frame?.contentWindow,doc=()=>{try{return frame?.contentDocument}catch{return null}};
  const badge=document.getElementById('codem8s-version');if(badge)badge.textContent='Codem8s 10.9.0';
  async function cleanOldRootInstaller(){
    try{
      if('serviceWorker'in navigator){
        const root=new URL('/',location.origin).href;
        for(const registration of await navigator.serviceWorker.getRegistrations()){
          const script=registration.active?.scriptURL||registration.waiting?.scriptURL||registration.installing?.scriptURL||'';
          if(registration.scope===root&&/\/mobile-app-sw\.js(?:$|\?)/.test(script))await registration.unregister();
        }
      }
      if('caches'in window){
        for(const key of await caches.keys()){
          if(['codem8s-mobile-shell-v1','codem8s-mobile-shell-v2','codem8s-mobile-identities-v1'].includes(key))await caches.delete(key);
        }
      }
    }catch{}
  }
  cleanOldRootInstaller();
  function apps(){try{return JSON.parse(win().localStorage.getItem(STORE)||'[]')}catch{return[]}}
  function put(items){win().localStorage.setItem(STORE,JSON.stringify(items.slice(0,40)))}
  function safe(id){return String(id||'app').replace(/[^a-z0-9_-]/gi,'-')}
  function wire(){
    const d=doc();if(!d||d.documentElement.dataset.mobileMulti)return;d.documentElement.dataset.mobileMulti='1';
    d.addEventListener('click',e=>{
      const button=e.target.closest('button[data-install]');if(!button)return;
      win().localStorage.setItem('codem8s_pending_install_id',button.dataset.install);
      d.querySelectorAll('button[data-install]').forEach(x=>x.removeAttribute('data-install-active'));
      button.setAttribute('data-install-active','1');
    },true);
    d.addEventListener('click',e=>{
      const button=e.target.closest('[data-continue]');if(!button)return;
      const overlay=button.closest('div[style*="z-index:2147483647"]');if(!overlay)return;
      e.preventDefault();e.stopImmediatePropagation();
      const id=win().localStorage.getItem('codem8s_pending_install_id')||win().localStorage.getItem('codem8s_mobile_selected_app');
      const name=String(overlay.querySelector('[data-name]')?.value||'').trim();
      const icon=overlay.querySelector('[data-preview]')?.src||'';
      if(!id||!name)return;
      put(apps().map(item=>item.id===id?{...item,installName:name,icon:icon||item.icon,updatedAt:Date.now()}:item));
      win().localStorage.setItem('codem8s_mobile_selected_app',id);
      overlay.remove();
      window.open('/mobile-apps/'+encodeURIComponent(safe(id))+'/?setup=1','_blank','noopener');
    },true);
  }
  frame?.addEventListener('load',wire);setInterval(wire,800);
})();
(() => {
  const frame = document.getElementById('codem8s-app');
  const win = () => frame?.contentWindow;
  const doc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  function readProject() {
    const w = win(); if (!w) return null;
    const records = [];
    for (let i=0;i<w.localStorage.length;i++) {
      const key=w.localStorage.key(i); if(!/^codem8s_project_/i.test(key||'')) continue;
      try { const value=JSON.parse(w.localStorage.getItem(key)||'null'); if(value?.files) records.push(value); } catch {}
    }
    return records.sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0))[0]||null;
  }
  function isFramework(project) {
    const names=Object.keys(project?.files||{});
    if(names.some(name=>/\.(tsx?|jsx)$/i.test(name))) return true;
    const packageName=names.find(name=>/(^|\/)package\.json$/i.test(name));
    const text=packageName?project.files[packageName]:'';
    return /"(?:react|react-scripts|vite|typescript|next|webpack)"\s*:/i.test(text||'');
  }
  function enforceFrameworkSafety(){
    const w=win(),d=doc(),project=readProject(); if(!w||!d||!isFramework(project)) return;
    const autoFix=d.querySelector('#autoFix');
    if(autoFix&&autoFix.checked){autoFix.checked=false;autoFix.dispatchEvent(new Event('change',{bubbles:true}));}
    try{w.localStorage.setItem('codem8s_auto_fix','false');}catch{}
  }
  function wire(){
    const d=doc(); if(!d||d.documentElement.dataset.frameworkProjectSafety==='1') return;
    d.documentElement.dataset.frameworkProjectSafety='1';
    d.addEventListener('click',event=>{
      const button=event.target.closest('button'); if(!button) return;
      const text=(button.textContent||'').trim().toLowerCase();
      if(isFramework(readProject())&&(button.id==='fixNow'||/repair|auto fix/.test(text))){
        event.preventDefault();event.stopImmediatePropagation();
        const status=d.querySelector('#status, .status');
        if(status){status.textContent='Framework project: legacy repair skipped. Use the compiled Preview result.';status.classList.remove('err');status.classList.add('ok');}
      }
    },true);
  }
  frame?.addEventListener('load',wire);
  setInterval(()=>{wire();enforceFrameworkSafety();},300);
})();

(() => {
  if (document.querySelector('script[data-codem8s-apk-builder]')) return;
  const script=document.createElement('script');
  script.src='/host-apk-builder-v1.js?v=1.0.1';
  script.dataset.codem8sApkBuilder='1';
  document.head.appendChild(script);
})();

(() => {
  const frame=document.getElementById('codem8s-app');
  let locked=false,observer=null;
  function appDoc(){try{return frame?.contentDocument||null;}catch{return null;}}
  function stopRepairLoop(reason){
    if(locked)return;locked=true;
    const d=appDoc(),w=frame?.contentWindow;if(!d||!w)return;
    try{w.localStorage.setItem('codem8s_auto_fix','false');}catch{}
    const autoFix=d.querySelector('#autoFix');if(autoFix){autoFix.checked=false;autoFix.disabled=true;try{autoFix.dispatchEvent(new Event('change',{bubbles:true}));}catch{}}
    d.querySelectorAll('button').forEach(button=>{const text=(button.textContent||'').trim().toLowerCase();if(button.id==='fixNow'||/repair|auto fix|retry fix/.test(text)){button.disabled=true;button.dataset.repairLocked='1';}});
    d.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const text=(button.textContent||'').trim().toLowerCase();if(button.dataset.repairLocked==='1'||button.id==='fixNow'||/repair|auto fix|retry fix/.test(text)){event.preventDefault();event.stopImmediatePropagation();}},true);
    const status=d.querySelector('#status, .status');if(status){status.textContent=reason||'Repair stopped after a regression. The last working snapshot was kept.';status.classList.remove('ok');status.classList.add('err');}
  }
  function watch(){locked=false;observer?.disconnect();const d=appDoc();if(!d?.documentElement)return;observer=new MutationObserver(()=>{const text=d.body?.innerText||'';if(/Rejected repair\b|regression detected|Previously passing check failed/i.test(text))stopRepairLoop('Repair stopped: the attempted fix introduced a regression, so no further automatic repair will run.');});observer.observe(d.documentElement,{subtree:true,childList:true,characterData:true});}
  frame?.addEventListener('load',watch);setInterval(()=>{if(!observer)watch();},1000);
})();

(() => {
  const frame=document.getElementById('codem8s-app');
  function installGuard(){
    const w=frame?.contentWindow;if(!w||w.__codem8sEmptyEntryGuard)return;w.__codem8sEmptyEntryGuard=true;
    const storage=w.localStorage,originalSetItem=storage.setItem.bind(storage);
    storage.setItem=function guardedSetItem(key,value){
      if(/^codem8s_project_/i.test(String(key))){
        try{
          const before=JSON.parse(storage.getItem(key)||'null'),after=JSON.parse(String(value));
          const beforeName=Object.keys(before?.files||{}).find(name=>/(^|\/)index\.html?$/i.test(name));
          const afterName=Object.keys(after?.files||{}).find(name=>/(^|\/)index\.html?$/i.test(name));
          const beforeHtml=beforeName?String(before.files[beforeName]||''):'',afterHtml=afterName?String(after.files[afterName]||''):'';
          if(beforeHtml.trim()&&!afterHtml.trim()){
            const d=frame?.contentDocument,status=d?.querySelector('#status, .status');
            if(status){status.textContent='Blocked unsafe change: index.html cannot be replaced with an empty file.';status.classList.remove('ok');status.classList.add('err');}
            throw new Error('Codem8s blocked an update that would empty index.html.');
          }
        }catch(error){if(/blocked an update|cannot be replaced/i.test(String(error?.message||error)))throw error;}
      }
      return originalSetItem(key,value);
    };
  }
  frame?.addEventListener('load',installGuard);setInterval(installGuard,500);
})();
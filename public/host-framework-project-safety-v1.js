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
  script.src='/host-apk-builder-v1.js?v=1.1.0';
  script.dataset.codem8sApkBuilder='1';
  document.head.appendChild(script);
})();

(() => {
  if (document.querySelector('script[data-codem8s-ai-agent]')) return;
  const script=document.createElement('script');
  script.src='/host-ai-builder-agent-v1.js?v=1.1.0';
  script.dataset.codem8sAiAgent='1';
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
  const BACKUP_PREFIX='codem8s_index_backup_v2:';
  let nativeSetItem=null;

  function entry(project){
    const files=project?.files||{};
    const name=Object.keys(files).find(path=>/(^|\/)index\.html?$/i.test(path));
    return {name,html:name?String(files[name]||''):''};
  }
  function backupKey(projectKey){return `${BACKUP_PREFIX}${projectKey}`;}
  function status(message){
    try{
      const d=frame?.contentDocument,node=d?.querySelector('#status, .status');
      if(node){node.textContent=message;node.classList.remove('ok');node.classList.add('err');}
    }catch{}
  }
  function saveBackup(storage,projectKey,project){
    const current=entry(project);
    if(!current.name||!current.html.trim())return;
    try{nativeSetItem.call(storage,backupKey(projectKey),JSON.stringify({path:current.name,html:current.html,at:Date.now()}));}catch{}
  }
  function readBackup(storage,projectKey){
    try{return JSON.parse(storage.getItem(backupKey(projectKey))||'null');}catch{return null;}
  }
  function protectValue(storage,key,value){
    let after;
    try{after=JSON.parse(String(value));}catch{return value;}
    if(!after?.files||typeof after.files!=='object')return value;

    let before=null;
    try{before=JSON.parse(storage.getItem(key)||'null');}catch{}
    const previous=entry(before),next=entry(after);
    const saved=readBackup(storage,key);
    const fallback=previous.html.trim()?{path:previous.name,html:previous.html}:saved?.html?.trim()?saved:null;

    if(fallback&&(!next.name||!next.html.trim())){
      after.files={...after.files,[next.name||fallback.path||'index.html']:fallback.html};
      after.updatedAt=Date.now();
      status('Recovered index.html: an unsafe empty project save was blocked.');
      saveBackup(storage,key,after);
      return JSON.stringify(after);
    }

    if(next.html.trim())saveBackup(storage,key,after);
    return value;
  }
  function scanAndRecover(){
    const w=frame?.contentWindow;if(!w)return;
    const storage=w.localStorage;
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i);if(!/^codem8s_project_/i.test(key||''))continue;
      let project=null;try{project=JSON.parse(storage.getItem(key)||'null');}catch{}
      if(!project?.files)continue;
      const current=entry(project);
      if(current.html.trim()){saveBackup(storage,key,project);continue;}
      const saved=readBackup(storage,key);
      if(saved?.html?.trim()){
        project.files={...project.files,[current.name||saved.path||'index.html']:saved.html};
        project.updatedAt=Date.now();
        nativeSetItem.call(storage,key,JSON.stringify(project));
        status('Recovered index.html from the protected project backup.');
      }
    }
  }
  function installGuard(){
    const w=frame?.contentWindow;if(!w)return;
    const storage=w.localStorage;
    if(!nativeSetItem)nativeSetItem=w.Storage.prototype.setItem;
    if(!w.__codem8sIndexProtectionV2){
      w.__codem8sIndexProtectionV2=true;
      const original=nativeSetItem;
      w.Storage.prototype.setItem=function(key,value){
        const text=String(key||'');
        return original.call(this,key,/^codem8s_project_/i.test(text)?protectValue(this,text,value):value);
      };
      w.addEventListener('pagehide',scanAndRecover);
      w.addEventListener('beforeunload',scanAndRecover);
    }
    scanAndRecover();
  }
  frame?.addEventListener('load',()=>setTimeout(installGuard,0));
  setInterval(installGuard,250);
})();
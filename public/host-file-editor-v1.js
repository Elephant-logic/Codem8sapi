(() => {
  const frame = document.getElementById('codem8s-app');
  const KEYS = ['codem8s_project_v4','codem8s_project_v7','codem8s_project_v8','codem8s_project_v3'];
  const win = () => frame?.contentWindow;
  const doc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  function record(){ const w=win(); if(!w) return null; for(const key of KEYS){ try{ const value=JSON.parse(w.localStorage.getItem(key)||'null'); if(value?.files&&typeof value.files==='object') return {key,value}; }catch{} } return null; }
  function write(project){ const w=win(); if(!w) throw new Error('Project is unavailable.'); for(const key of KEYS){ if(w.localStorage.getItem(key)!=null) w.localStorage.setItem(key,JSON.stringify(project)); } }
  function names(project){ return Object.keys(project?.files||{}).sort((a,b)=>a.localeCompare(b)); }
  function safeName(value){ return String(value||'').trim().replace(/^\/+/, '').replace(/\\/g,'/'); }
  function wire(){
    const d=doc(); if(!d||d.documentElement.dataset.directFileEditor==='1') return;
    const toolbar=d.querySelector('.toolbar'), main=d.querySelector('.main'); if(!toolbar||!main) return;
    d.documentElement.dataset.directFileEditor='1';
    const tab=d.createElement('button'); tab.className='tab'; tab.textContent='File Editor'; toolbar.insertBefore(tab,toolbar.querySelector('.spacer'));
    const pane=d.createElement('div'); pane.id='directFileEditorPane'; pane.className='workspace';
    pane.innerHTML=`<div style="height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:10px;padding:12px;overflow:hidden"><div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px"><select id="directFileName" style="min-width:0;padding:10px;border-radius:10px;background:#07111f;color:#edf5ff;border:1px solid #365477"></select><button id="directFileNew" class="toolbtn">New file</button><button id="directFileImport" class="toolbtn">Import file</button><input id="directFileInput" type="file" hidden></div><textarea id="directFileContent" spellcheck="false" style="width:100%;height:100%;resize:none;padding:12px;border-radius:12px;border:1px solid #365477;background:#050d18;color:#edf5ff;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace"></textarea><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center"><button id="directFileSave" class="toolbtn">Save changes</button><button id="directFileDelete" class="toolbtn">Delete file</button><span id="directFileStatus" style="color:#8fa4c1;font-size:12px;text-align:right">Edit, add or replace project files directly.</span></div></div>`;
    main.appendChild(pane);
    const select=pane.querySelector('#directFileName'), area=pane.querySelector('#directFileContent'), status=pane.querySelector('#directFileStatus'), input=pane.querySelector('#directFileInput');
    function setStatus(text,error=false){ status.textContent=text; status.style.color=error?'#ff7892':'#8fa4c1'; }
    function refresh(preferred){ const r=record(); if(!r) return setStatus('No active project found.',true); const list=names(r.value); select.innerHTML=list.map(n=>`<option value="${n.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${n}</option>`).join(''); const pick=preferred&&list.includes(preferred)?preferred:list[0]||''; select.value=pick; area.value=pick?String(r.value.files[pick]??''):''; setStatus(`${pick||'No file'} · ${area.value.length} characters`); }
    select.onchange=()=>{ const r=record(); area.value=r?String(r.value.files[select.value]??''):''; setStatus(`${select.value} · ${area.value.length} characters`); };
    pane.querySelector('#directFileSave').onclick=()=>{ try{ const r=record(); if(!r) throw new Error('No active project found.'); const name=safeName(select.value); if(!name) throw new Error('Choose a file first.'); r.value.files[name]=area.value; r.value.updatedAt=Date.now(); write(r.value); setStatus(`Saved ${name} · ${area.value.length} characters`); }catch(e){ setStatus(e.message,true); } };
    pane.querySelector('#directFileNew').onclick=()=>{ const name=safeName(prompt('New file name, for example index.html')); if(!name) return; const r=record(); if(!r) return setStatus('No active project found.',true); if(Object.prototype.hasOwnProperty.call(r.value.files,name)&&!confirm(`${name} already exists. Open it?`)) return; if(!Object.prototype.hasOwnProperty.call(r.value.files,name)){ r.value.files[name]=''; write(r.value); } refresh(name); area.focus(); };
    pane.querySelector('#directFileImport').onclick=()=>input.click();
    input.onchange=async()=>{ const file=input.files?.[0]; input.value=''; if(!file) return; try{ const text=await file.text(); const target=safeName(prompt('Save this file in the project as:',file.name)); if(!target) return; const r=record(); if(!r) throw new Error('No active project found.'); if(Object.prototype.hasOwnProperty.call(r.value.files,target)&&!confirm(`Replace existing ${target}?`)) return; r.value.files[target]=text; r.value.updatedAt=Date.now(); write(r.value); refresh(target); setStatus(`Imported ${target} · ${text.length} characters`); }catch(e){ setStatus(e.message,true); } };
    pane.querySelector('#directFileDelete').onclick=()=>{ const name=select.value; if(!name||!confirm(`Delete ${name}?`)) return; const r=record(); if(!r) return; delete r.value.files[name]; r.value.updatedAt=Date.now(); write(r.value); refresh(); };
    tab.addEventListener('click',e=>{ e.preventDefault(); e.stopImmediatePropagation(); d.querySelectorAll('.tab').forEach(n=>n.classList.remove('active')); d.querySelectorAll('.workspace').forEach(n=>n.classList.remove('active')); tab.classList.add('active'); pane.classList.add('active'); refresh(select.value); },true);
    refresh();
  }
  frame?.addEventListener('load',wire); setInterval(wire,800);
})();
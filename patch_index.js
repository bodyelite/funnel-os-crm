const fs = require('fs');
const file = require("path").join(__dirname, "public", "index.html");
let code = fs.readFileSync(file, 'utf8');
let count = 0;

// ── Fix 1: Patente en retoma ─────────────────────────────────────
if (!code.includes('ti-plate')) {
  code = code.replace(
    `<input id="ti-year" placeholder="Año (2019)" value="\${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-color"`,
    `<input id="ti-year" placeholder="Año (2019)" value="\${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-plate" placeholder="Patente (ej: ABCD12)" value="\${ti.plate||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx); text-transform:uppercase;">
            <input id="ti-color"`
  );
  count++; console.log('✅ Fix 1: campo Patente');
} else console.log('⚠️ Fix 1 ya aplicado');

// ── Fix 2: plate en saveTiFields ─────────────────────────────────
if (!code.includes("const plate = ")) {
  code = code.replace(
    `body:JSON.stringify({make,model,year,color,km:document.getElementById('ti-km')?.value||'',version:document.getElementById('ti-version')?.value||''})`,
    `body:JSON.stringify({make,model,year,color,plate:(document.getElementById('ti-plate')||{}).value?.toUpperCase()||'',km:document.getElementById('ti-km')?.value||'',version:document.getElementById('ti-version')?.value||''})`
  );
  count++; console.log('✅ Fix 2: plate en saveTiFields');
} else console.log('⚠️ Fix 2 ya aplicado');

// ── Fix 3: Dashboard vendedor en refresh ─────────────────────────
if (!code.includes('dashboard/vendedor')) {
  code = code.replace(
    `isA?api('GET','/api/dashboard/team'+q):Promise.resolve([]),isA?api('GET','/api/analytics/channels'+q):Promise.resolve([])]);S.leads=leads;S.team=team||[];S.channels=channels||[];renderAll();`,
    `isA?api('GET','/api/dashboard/team'+q):Promise.resolve([]),isA?api('GET','/api/analytics/channels'+q):Promise.resolve([]),!isA?api('GET','/api/dashboard/vendedor'+q):Promise.resolve(null)]);S.leads=leads;S.team=team||[];S.channels=channels||[];S.vendKpi=vendKpi||null;renderAll();`
  );
  // también actualizar la declaración del Promise.all
  code = code.replace(
    `const[leads,team,channels]=await Promise.all([`,
    `const[leads,team,channels,vendKpi]=await Promise.all([`
  );
  count++; console.log('✅ Fix 3: dashboard vendedor');
} else console.log('⚠️ Fix 3 ya aplicado');

// ── Fix 4: renderDashVendedor ─────────────────────────────────────
if (!code.includes('renderDashVendedor')) {
  code = code.replace(
    `function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();`,
    `function renderDashVendedor(){if(!S.vendKpi)return;const k=S.vendKpi;const scF=$('scF'),scR=$('scR'),scC=$('scC'),scRS=$('scRS');if(scF)scF.textContent=k.sla?.fresh??'—';if(scR)scR.textContent=k.sla?.risk??'—';if(scC)scC.textContent=k.sla?.critical??'—';if(scRS)scRS.textContent=k.sla?.reassigned??'—';renderFunnel();}
function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();else renderDashVendedor();`
  );
  count++; console.log('✅ Fix 4: renderDashVendedor');
} else console.log('⚠️ Fix 4 ya aplicado');

// ── Fix 5: Tab Historial de Gestión ─────────────────────────────
if (!code.includes('mtabGestion2')) {
  // 5a: botón tab
  code = code.replace(
    `>🕐 Historial</button></div>`,
    `>🕐 Historial</button><button id="mtabGestion2" onclick="switchModalTab('gestion2')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--tm);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px">📁 Historial de Gestión</button></div>`
  );
  // 5b: pane HTML
  code = code.replace(
    `<div id="mHistPane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>`,
    `<div id="mHistPane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>\n<div id="mGestion2Pane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>`
  );
  // 5c: switchModalTab
  code = code.replace(
    `function switchModalTab(tab){\n  var g=document.getElementById('mtabGestion'),h=document.getElementById('mtabHistorial');\n  var mp=document.getElementById('mMainPane'),hp=document.getElementById('mHistPane');\n  if(!g||!mp)return;\n  if(tab==='historial'){\n    g.style.color='var(--tm)';g.style.borderBottomColor='transparent';\n    h.style.color='var(--ac)';h.style.borderBottomColor='var(--ac)';\n    mp.style.display='none';\n    if(hp){hp.style.display='block';var l=findLead(S.mid);if(l)renderModalHistory(l);}\n  }else{\n    if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}\n    g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';\n    if(hp)hp.style.display='none';\n    mp.style.display='grid';\n  }\n}`,
    `function switchModalTab(tab){
  var g=document.getElementById('mtabGestion'),h=document.getElementById('mtabHistorial'),g2=document.getElementById('mtabGestion2');
  var mp=document.getElementById('mMainPane'),hp=document.getElementById('mHistPane'),gp=document.getElementById('mGestion2Pane');
  if(!g||!mp)return;
  [g,h,g2].forEach(function(t){if(t){t.style.color='var(--tm)';t.style.borderBottomColor='transparent';}});
  [mp,hp,gp].forEach(function(p){if(p)p.style.display='none';});
  if(tab==='historial'){
    if(h){h.style.color='var(--ac)';h.style.borderBottomColor='var(--ac)';}
    if(hp){hp.style.display='block';var l=findLead(S.mid);if(l)renderModalHistory(l);}
  } else if(tab==='gestion2'){
    if(g2){g2.style.color='var(--ac)';g2.style.borderBottomColor='var(--ac)';}
    if(gp){gp.style.display='block';var l=findLead(S.mid);if(l)renderHistorialGestion(l);}
  } else {
    g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';
    mp.style.display='grid';
  }
}`
  );
  // 5d: función renderHistorialGestion
  code = code.replace(
    `function renderModalHistory(l){`,
    `function renderHistorialGestion(l){
  var pane=document.getElementById('mGestion2Pane');if(!pane)return;
  var _e=function(s){return String(s||'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});};
  var _dt=function(ts){try{return new Date(ts).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}};
  var items=[];
  (l.notes||[]).forEach(function(n){if(n.author==='Resumen IA')return;items.push({ts:n.ts||0,type:'nota',icon:'📝',label:_e(n.author||'Sistema'),content:_e(n.content||'')});});
  if(l.nextAction&&l.nextAction.text){items.push({ts:new Date(l.nextAction.date||l.nextAction.createdAt||0).getTime(),type:'tarea',icon:'📅',label:'Tarea agendada',content:_e(l.nextAction.text)+(l.nextAction.iaCompleted?' ✅':'')});}
  (l.pastActions||[]).forEach(function(a){items.push({ts:new Date(a.date||a.createdAt||0).getTime(),type:'tarea',icon:'✅',label:'Tarea completada',content:_e(a.text||'')});});
  (l.history||[]).forEach(function(h){items.push({ts:h.ts||0,type:'estado',icon:'🔄',label:'Cambio de estado',content:_e(h.content||'')});});
  items.sort(function(a,b){return(a.ts||0)-(b.ts||0);});
  var resHTML=l.ai_summary?'<div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:10px;padding:14px;margin-bottom:16px;color:#fff"><div style="font-size:10px;font-weight:700;letter-spacing:.08em;opacity:.8;margin-bottom:6px">🧠 RESUMEN IA</div><div style="font-size:12px;line-height:1.6">'+_e(l.ai_summary)+'</div></div>':'';
  if(!items.length&&!l.ai_summary){pane.innerHTML='<div style="color:var(--tm);font-size:12px;padding:8px">Sin historial de gestión aún.</div>';return;}
  var colMap={nota:'var(--ac)',tarea:'#10b981',estado:'#f59e0b'};
  pane.innerHTML=resHTML+'<div style="font-size:10.5px;color:var(--tm);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:14px">📁 Bitácora Cronológica</div>'+items.map(function(item){var col=colMap[item.type]||'var(--ac)';return'<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start"><div style="width:28px;height:28px;border-radius:50%;background:'+col+'22;border:2px solid '+col+';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">'+item.icon+'</div><div style="flex:1;background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:8px 10px"><div style="font-size:11px;font-weight:700;color:'+col+';margin-bottom:3px">'+item.label+'</div><div style="font-size:12px;color:var(--ts);line-height:1.5">'+item.content+'</div>'+(item.ts?'<div style="font-size:10px;color:var(--tm);margin-top:4px">'+_dt(item.ts)+'</div>':'')+'</div></div>';}).join('');
}

function renderModalHistory(l){`
  );
  // 5e: openModal reset
  code = code.replace(
    `if(mp){mp.style.display='grid';if(hp)hp.style.display='none';if(g){g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';}if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}}`,
    `if(mp){mp.style.display='grid';if(hp)hp.style.display='none';var _gp=document.getElementById('mGestion2Pane');if(_gp)_gp.style.display='none';if(g){g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';}if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}var _g2=document.getElementById('mtabGestion2');if(_g2){_g2.style.color='var(--tm)';_g2.style.borderBottomColor='transparent';}}`
  );
  count++; console.log('✅ Fix 5: tab Historial de Gestión completo');
} else console.log('⚠️ Fix 5 ya aplicado');

fs.writeFileSync(file, code, 'utf8');
console.log(`\n✅ ${count} fix(es) aplicados`);

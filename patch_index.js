const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'public', 'index.html');
let code = fs.readFileSync(file, 'utf8');
let count = 0;

// ── Fix 1: Campo Patente en retoma ──────────────────────────────
const F1 = `            <input id="ti-make" placeholder="Marca (Toyota)" value="\${ti.make||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-model" placeholder="Modelo (Yaris)" value="\${ti.model||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-year" placeholder="Año (2019)" value="\${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-color" placeholder="Color (Blanco)" value="\${ti.color||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-km" placeholder="Kilometraje (ej: 45.000 km)" value="\${ti.km||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-version" placeholder="Version/Equipamiento (ej: 4x4 Full)" value="\${ti.version||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">`;
const R1 = `            <input id="ti-make" placeholder="Marca (Toyota)" value="\${ti.make||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-model" placeholder="Modelo (Yaris)" value="\${ti.model||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-year" placeholder="Año (2019)" value="\${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-plate" placeholder="Patente (ej: ABCD12)" value="\${ti.plate||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx); text-transform:uppercase;">
            <input id="ti-color" placeholder="Color (Blanco)" value="\${ti.color||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-km" placeholder="Kilometraje (ej: 45.000 km)" value="\${ti.km||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-version" placeholder="Version/Equipamiento (ej: 4x4 Full)" value="\${ti.version||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">`;
if(code.includes(F1)){code=code.replace(F1,R1);count++;console.log('✅ Fix 1: Patente en retoma');}
else console.log('⚠️ Fix 1 no encontrado');

// ── Fix 2: plate en saveTiFields ────────────────────────────────
const F2 = `  const color = (document.getElementById('ti-color')||{}).value||'';
  await fetch('/api/leads/'+leadId+'/tradein', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({make,model,year,color,km:document.getElementById('ti-km')?.value||'',version:document.getElementById('ti-version')?.value||''}) });`;
const R2 = `  const color = (document.getElementById('ti-color')||{}).value||'';
  const plate = (document.getElementById('ti-plate')||{}).value?.toUpperCase()||'';
  await fetch('/api/leads/'+leadId+'/tradein', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({make,model,year,color,plate,km:document.getElementById('ti-km')?.value||'',version:document.getElementById('ti-version')?.value||''}) });`;
if(code.includes(F2)){code=code.replace(F2,R2);count++;console.log('✅ Fix 2: plate en saveTiFields');}
else console.log('⚠️ Fix 2 no encontrado');

// ── Fix 3: Dashboard vendedor en refresh ────────────────────────
const F3 = `async function refresh(){if(!S.token)return;const q=qstr(),isA=S.user?.role==='admin';try{const[leads,team,channels]=await Promise.all([api('GET','/api/leads'+q),isA?api('GET','/api/dashboard/team'+q):Promise.resolve([]),isA?api('GET','/api/analytics/channels'+q):Promise.resolve([])]);S.leads=leads;S.team=team||[];S.channels=channels||[];renderAll();}catch(e){console.error('refresh:',e.message);}}`;
const R3 = `async function refresh(){if(!S.token)return;const q=qstr(),isA=S.user?.role==='admin';try{const[leads,team,channels,vendKpi]=await Promise.all([api('GET','/api/leads'+q),isA?api('GET','/api/dashboard/team'+q):Promise.resolve([]),isA?api('GET','/api/analytics/channels'+q):Promise.resolve([]),!isA?api('GET','/api/dashboard/vendedor'+q):Promise.resolve(null)]);S.leads=leads;S.team=team||[];S.channels=channels||[];S.vendKpi=vendKpi||null;renderAll();}catch(e){console.error('refresh:',e.message);}}`;
if(code.includes(F3)){code=code.replace(F3,R3);count++;console.log('✅ Fix 3: dashboard vendedor en refresh');}
else console.log('⚠️ Fix 3 no encontrado');

// ── Fix 4: renderDashVendedor en renderAll ──────────────────────
const F4 = `function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();renderLeads();`;
const R4 = `function renderDashVendedor(){if(!S.vendKpi)return;const k=S.vendKpi;const scF=$('scF'),scR=$('scR'),scC=$('scC'),scRS=$('scRS');if(scF)scF.textContent=k.sla?.fresh??'—';if(scR)scR.textContent=k.sla?.risk??'—';if(scC)scC.textContent=k.sla?.critical??'—';if(scRS)scRS.textContent=k.sla?.reassigned??'—';renderFunnel();}
function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();else renderDashVendedor();renderLeads();`;
if(code.includes(F4)&&!code.includes('renderDashVendedor')){code=code.replace(F4,R4);count++;console.log('✅ Fix 4: renderDashVendedor');}
else console.log('⚠️ Fix 4 no encontrado o ya aplicado');

// ── Fix 5: Tercera tab "Historial de Gestión" ───────────────────
// 5a. Agregar botón tab en HTML
const F5a = `<button id="mtabGestion" onclick="switchModalTab('gestion')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--ac);cursor:pointer;border-bottom:3px solid var(--ac);margin-bottom:-2px">📋 Gestión</button><button id="mtabHistorial" onclick="switchModalTab('historial')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--tm);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px">🕐 Historial</button>`;
const R5a = `<button id="mtabGestion" onclick="switchModalTab('gestion')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--ac);cursor:pointer;border-bottom:3px solid var(--ac);margin-bottom:-2px">📋 Gestión</button><button id="mtabHistorial" onclick="switchModalTab('historial')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--tm);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px">🕐 Historial</button><button id="mtabGestion2" onclick="switchModalTab('gestion2')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--tm);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px">📁 Historial de Gestión</button>`;
if(code.includes(F5a)&&!code.includes('mtabGestion2')){code=code.replace(F5a,R5a);count++;console.log('✅ Fix 5a: tab Historial de Gestión');}
else console.log('⚠️ Fix 5a no encontrado o ya existe');

// 5b. Agregar pane HTML para la nueva tab
const F5b = `<div id="mHistPane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>`;
const R5b = `<div id="mHistPane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>
<div id="mGestion2Pane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>`;
if(code.includes(F5b)&&!code.includes('mGestion2Pane')){code=code.replace(F5b,R5b);count++;console.log('✅ Fix 5b: pane mGestion2Pane');}
else console.log('⚠️ Fix 5b no encontrado o ya existe');

// 5c. Actualizar switchModalTab para manejar la tercera tab
const F5c = `function switchModalTab(tab){
  var g=document.getElementById('mtabGestion'),h=document.getElementById('mtabHistorial');
  var mp=document.getElementById('mMainPane'),hp=document.getElementById('mHistPane');
  if(!g||!mp)return;
  if(tab==='historial'){
    g.style.color='var(--tm)';g.style.borderBottomColor='transparent';
    h.style.color='var(--ac)';h.style.borderBottomColor='var(--ac)';
    mp.style.display='none';
    if(hp){hp.style.display='block';var l=findLead(S.mid);if(l)renderModalHistory(l);}
  }else{
    if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}
    g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';
    if(hp)hp.style.display='none';
    mp.style.display='grid';
  }
}`;
const R5c = `function switchModalTab(tab){
  var g=document.getElementById('mtabGestion'),h=document.getElementById('mtabHistorial'),g2=document.getElementById('mtabGestion2');
  var mp=document.getElementById('mMainPane'),hp=document.getElementById('mHistPane'),gp=document.getElementById('mGestion2Pane');
  if(!g||!mp)return;
  // Reset todos
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
}`;
if(code.includes(F5c)){code=code.replace(F5c,R5c);count++;console.log('✅ Fix 5c: switchModalTab actualizado');}
else console.log('⚠️ Fix 5c no encontrado');

// 5d. Agregar función renderHistorialGestion
const F5d = `function renderModalHistory(l){`;
const R5d = `function renderHistorialGestion(l){
  var pane=document.getElementById('mGestion2Pane');if(!pane)return;
  var esc=function(s){return String(s||'').replace(/[&<>'"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});};
  var fDT=function(ts){try{return new Date(ts).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}};
  // Construir línea de tiempo unificada
  var items=[];
  // Notas (excl. sistema de resumen IA)
  (l.notes||[]).forEach(function(n){
    if(n.author==='Resumen IA')return;
    items.push({ts:n.ts||0,type:'nota',icon:'📝',label:esc(n.author||'Sistema'),content:esc(n.content||'')});
  });
  // nextAction / pastActions
  if(l.nextAction&&l.nextAction.text){
    items.push({ts:new Date(l.nextAction.date||l.nextAction.createdAt||0).getTime(),type:'tarea',icon:'📅',label:'Tarea agendada',content:esc(l.nextAction.text)+(l.nextAction.iaCompleted?' <span style="color:var(--ok);font-size:10px">✅ Completada</span>':'')});
  }
  (l.pastActions||[]).forEach(function(a){
    items.push({ts:new Date(a.date||a.createdAt||0).getTime(),type:'tarea',icon:'✅',label:'Tarea completada',content:esc(a.text||'')});
  });
  // Historial de cotizaciones
  (l.history||[]).forEach(function(h){
    items.push({ts:h.ts||0,type:'cotizacion',icon:'🔄',label:'Cambio de estado',content:esc(h.content||'')});
  });
  // Resumen IA al inicio si existe
  var resumenHTML='';
  if(l.ai_summary){
    resumenHTML='<div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:10px;padding:14px;margin-bottom:16px;color:#fff">'
      +'<div style="font-size:10px;font-weight:700;letter-spacing:.08em;opacity:.8;margin-bottom:6px">🧠 RESUMEN IA</div>'
      +'<div style="font-size:12px;line-height:1.6">'+esc(l.ai_summary)+'</div></div>';
  }
  // Ordenar cronológicamente
  items.sort(function(a,b){return(a.ts||0)-(b.ts||0);});
  if(!items.length&&!l.ai_summary){pane.innerHTML='<div style="color:var(--tm);font-size:12px;padding:8px">Sin historial de gestión aún.</div>';return;}
  var colMap={nota:'var(--ac)',tarea:'#10b981',cotizacion:'#f59e0b'};
  pane.innerHTML=resumenHTML
    +'<div style="font-size:10.5px;color:var(--tm);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:14px">📁 Bitácora Cronológica</div>'
    +items.map(function(item){
      var col=colMap[item.type]||'var(--ac)';
      return '<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start">'
        +'<div style="width:28px;height:28px;border-radius:50%;background:'+col+'22;border:2px solid '+col+';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">'+item.icon+'</div>'
        +'<div style="flex:1;background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:8px 10px">'
        +'<div style="font-size:11px;font-weight:700;color:'+col+';margin-bottom:3px">'+item.label+'</div>'
        +'<div style="font-size:12px;color:var(--ts);line-height:1.5">'+item.content+'</div>'
        +(item.ts?'<div style="font-size:10px;color:var(--tm);margin-top:4px">'+fDT(item.ts)+'</div>':'')
        +'</div></div>';
    }).join('');
}

function renderModalHistory(l){`;
if(code.includes(F5d)&&!code.includes('renderHistorialGestion')){code=code.replace(F5d,R5d);count++;console.log('✅ Fix 5d: renderHistorialGestion');}
else console.log('⚠️ Fix 5d no encontrado o ya existe');

// 5e. Actualizar openModal para resetear correctamente la tercera tab
const F5e = `if(mp){mp.style.display='grid';if(hp)hp.style.display='none';if(g){g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';}if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}}`;
const R5e = `if(mp){mp.style.display='grid';if(hp)hp.style.display='none';var gp2=document.getElementById('mGestion2Pane');if(gp2)gp2.style.display='none';if(g){g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';}if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}var g2=document.getElementById('mtabGestion2');if(g2){g2.style.color='var(--tm)';g2.style.borderBottomColor='transparent';}}`;
if(code.includes(F5e)){code=code.replace(F5e,R5e);count++;console.log('✅ Fix 5e: openModal reset tercera tab');}
else console.log('⚠️ Fix 5e no encontrado');

fs.writeFileSync(file, code, 'utf8');
console.log(`\n✅ Listo — ${count} fix(es) aplicados`);

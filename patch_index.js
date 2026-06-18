const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'public', 'index.html');
let code = fs.readFileSync(file, 'utf8');
let n = 0;

function rep(f, r, label) {
  if (code.includes(f)) { code = code.replace(f, r); n++; console.log('✅', label); }
  else console.log('⚠️ Ya aplicado o no encontrado:', label);
}

// 1. Patente en retoma
rep(
  `<input id="ti-year" placeholder="Año (2019)" value="\${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">\n            <input id="ti-color"`,
  `<input id="ti-year" placeholder="Año (2019)" value="\${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">\n            <input id="ti-plate" placeholder="Patente (ej: ABCD12)" value="\${ti.plate||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx); text-transform:uppercase;">\n            <input id="ti-color"`,
  'Patente en retoma'
);

// 2. plate en saveTiFields
rep(
  `body:JSON.stringify({make,model,year,color,km:document.getElementById('ti-km')?.value||'',version:document.getElementById('ti-version')?.value||''})`,
  `body:JSON.stringify({make,model,year,color,plate:(document.getElementById('ti-plate')||{}).value?.toUpperCase()||'',km:document.getElementById('ti-km')?.value||'',version:document.getElementById('ti-version')?.value||''})`,
  'plate en saveTiFields'
);

// 3. Dashboard vendedor en refresh
rep(
  `const[leads,team,channels]=await Promise.all([api('GET','/api/leads'+q),isA?api('GET','/api/dashboard/team'+q):Promise.resolve([]),isA?api('GET','/api/analytics/channels'+q):Promise.resolve([])]);S.leads=leads;S.team=team||[];S.channels=channels||[];renderAll();`,
  `const[leads,team,channels,vendKpi]=await Promise.all([api('GET','/api/leads'+q),isA?api('GET','/api/dashboard/team'+q):Promise.resolve([]),isA?api('GET','/api/analytics/channels'+q):Promise.resolve([]),!isA?api('GET','/api/dashboard/vendedor'+q):Promise.resolve(null)]);S.leads=leads;S.team=team||[];S.channels=channels||[];S.vendKpi=vendKpi||null;renderAll();`,
  'Dashboard vendedor en refresh'
);

// 4. renderDashVendedor + renderAll fix
rep(
  `function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();`,
  `function renderDashVendedor(){if(!S.vendKpi)return;const k=S.vendKpi;const scF=$('scF'),scR=$('scR'),scC=$('scC'),scRS=$('scRS');if(scF)scF.textContent=k.sla?.fresh??'—';if(scR)scR.textContent=k.sla?.risk??'—';if(scC)scC.textContent=k.sla?.critical??'—';if(scRS)scRS.textContent=k.sla?.reassigned??'—';renderFunnel();}\nfunction renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();else renderDashVendedor();`,
  'renderDashVendedor'
);

// 5. Botón Análisis IA en nav
rep(
  `>🧠 BI</button><button data-view="config" id="navC">⚙️ Config</button>`,
  `>🧠 BI</button><button data-view="analisis" id="navAnalisis" style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;margin-left:4px;font-family:inherit">🔍 Análisis IA</button><button data-view="config" id="navC">⚙️ Config</button>`,
  'Botón Análisis IA en nav'
);

// 6. Vista Análisis IA + tercera tab modal — insertar antes de view-bi
rep(
  `<section id="view-bi" class="view"`,
  `<section id="view-analisis" class="view" style="padding:20px;max-width:1100px;margin:0 auto">
<div class="st">🔍 Análisis Estratégico IA</div>
<div style="display:grid;grid-template-columns:280px 1fr;gap:20px;align-items:start">
<div style="background:var(--p2);border:1px solid var(--bd);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px">
  <div style="font-weight:700;font-size:13px;color:var(--ts)">Filtros de Análisis</div>
  <div><label style="font-size:11px;color:var(--tm);font-weight:600">ORIGEN</label>
  <select id="iaFiltroSource" style="width:100%;margin-top:4px;padding:7px;border-radius:7px;border:1px solid var(--bd);background:var(--bg);color:var(--ts);font-size:12px;font-family:inherit">
    <option value="">Todos</option><option value="MercadoLibre">MercadoLibre</option><option value="Chileautos">Chileautos</option><option value="WhatsApp">WhatsApp</option><option value="Meta Ads">Meta Ads</option><option value="Instagram">Instagram</option><option value="Chat Web">Chat Web</option><option value="Manual">Manual</option>
  </select></div>
  <div><label style="font-size:11px;color:var(--tm);font-weight:600">ESTADO</label>
  <select id="iaFiltroStatus" style="width:100%;margin-top:4px;padding:7px;border-radius:7px;border:1px solid var(--bd);background:var(--bg);color:var(--ts);font-size:12px;font-family:inherit">
    <option value="">Todos</option><option value="Nuevo">Nuevo</option><option value="Contactados">Contactados</option><option value="En proceso">En proceso</option><option value="Reservado">Reservado</option><option value="Cerrado">Cerrado</option><option value="Perdido">Perdido</option>
  </select></div>
  <div><label style="font-size:11px;color:var(--tm);font-weight:600">VENDEDOR</label>
  <select id="iaFiltroVendedor" style="width:100%;margin-top:4px;padding:7px;border-radius:7px;border:1px solid var(--bd);background:var(--bg);color:var(--ts);font-size:12px;font-family:inherit"><option value="">Todos</option></select></div>
  <div><label style="font-size:11px;color:var(--tm);font-weight:600">DESDE</label>
  <input type="date" id="iaFiltroDes" style="width:100%;margin-top:4px;padding:7px;border-radius:7px;border:1px solid var(--bd);background:var(--bg);color:var(--ts);font-size:12px;font-family:inherit;box-sizing:border-box"></div>
  <div><label style="font-size:11px;color:var(--tm);font-weight:600">HASTA</label>
  <input type="date" id="iaFiltroHas" style="width:100%;margin-top:4px;padding:7px;border-radius:7px;border:1px solid var(--bd);background:var(--bg);color:var(--ts);font-size:12px;font-family:inherit;box-sizing:border-box"></div>
  <div id="iaLeadsCount" style="font-size:11px;color:var(--tm);text-align:center;padding:6px;background:var(--bg);border-radius:6px;border:1px solid var(--bd)">— leads en selección</div>
  <button onclick="ejecutarAnalisisIA()" id="btnAnalisisIA" style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:8px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">🔍 Generar Análisis IA</button>
  <button onclick="limpiarAnalisis()" style="background:var(--bg);color:var(--tm);border:1px solid var(--bd);border-radius:8px;padding:8px;font-size:12px;cursor:pointer;font-family:inherit">🗑 Limpiar</button>
</div>
<div id="iaResultado" style="background:var(--p2);border:1px solid var(--bd);border-radius:12px;padding:20px;min-height:400px">
  <div style="color:var(--tm);font-size:13px;text-align:center;padding:60px 20px"><div style="font-size:32px;margin-bottom:12px">🔍</div><div style="font-weight:600">Selecciona filtros y genera el análisis</div></div>
</div></div></section>

<section id="view-bi" class="view"`,
  'Vista Análisis IA'
);

// 7. Tab nav click handler — agregar analisis
rep(
  `if(view==='bi'){loadBI('mapa');}else if(view==='config')`,
  `if(view==='bi'){loadBI('mapa');}else if(view==='analisis'){initAnalisisIA();}else if(view==='config')`,
  'Nav click handler analisis'
);

// 8. Tab Historial de Gestión en modal
if (!code.includes('mtabGestion2')) {
  code = code.replace(
    `>🕐 Historial</button></div>`,
    `>🕐 Historial</button><button id="mtabGestion2" onclick="switchModalTab('gestion2')" style="background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;color:var(--tm);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px">📁 Historial de Gestión</button></div>`
  );
  code = code.replace(
    `<div id="mHistPane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>`,
    `<div id="mHistPane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>\n<div id="mGestion2Pane" style="display:none;flex:1;overflow-y:auto;padding:16px 20px"></div>`
  );
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
  code = code.replace(
    `if(mp){mp.style.display='grid';if(hp)hp.style.display='none';if(g){g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';}if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}}`,
    `if(mp){mp.style.display='grid';if(hp)hp.style.display='none';var _gp=document.getElementById('mGestion2Pane');if(_gp)_gp.style.display='none';if(g){g.style.color='var(--ac)';g.style.borderBottomColor='var(--ac)';}if(h){h.style.color='var(--tm)';h.style.borderBottomColor='transparent';}var _g2=document.getElementById('mtabGestion2');if(_g2){_g2.style.color='var(--tm)';_g2.style.borderBottomColor='transparent';}}`
  );
  n++; console.log('✅ Tab Historial de Gestión (modal)');
} else console.log('⚠️ Tab modal ya aplicada');

// 9. Función renderHistorialGestion + JS Análisis IA (antes del cierre </script>)
if (!code.includes('renderHistorialGestion')) {
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
  n++; console.log('✅ renderHistorialGestion');
}

if (!code.includes('ejecutarAnalisisIA')) {
  code = code.replace(
    `</script>\n</body>\n</html>`,
    `// ── ANÁLISIS IA ──────────────────────────────────────────────────
function initAnalisisIA(){
  const sel=document.getElementById('iaFiltroVendedor');if(!sel)return;
  sel.innerHTML='<option value="">Todos</option>';
  (S.users||[]).filter(u=>u.role!=='admin').forEach(u=>{sel.innerHTML+=\`<option value="\${u.username}">\${u.name}</option>\`;});
  actualizarConteoIA();
  ['iaFiltroSource','iaFiltroStatus','iaFiltroVendedor','iaFiltroDes','iaFiltroHas'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('change',actualizarConteoIA);});
}
function getFiltrosIA(){return{source:document.getElementById('iaFiltroSource')?.value||'',status:document.getElementById('iaFiltroStatus')?.value||'',assignedTo:document.getElementById('iaFiltroVendedor')?.value||'',desde:document.getElementById('iaFiltroDes')?.value||'',hasta:document.getElementById('iaFiltroHas')?.value||''};}
function actualizarConteoIA(){
  const f=getFiltrosIA();let leads=S.leads||[];
  if(f.source)leads=leads.filter(l=>l.source===f.source);
  if(f.status)leads=leads.filter(l=>l.status===f.status);
  if(f.assignedTo)leads=leads.filter(l=>l.assignedTo===f.assignedTo);
  if(f.desde)leads=leads.filter(l=>new Date(l.lastInteraction||l.createdAt||0)>=new Date(f.desde));
  if(f.hasta)leads=leads.filter(l=>new Date(l.lastInteraction||l.createdAt||0)<=new Date(f.hasta+'T23:59:59'));
  const el=document.getElementById('iaLeadsCount');if(el){const ov=leads.length>50;el.textContent=leads.length+' lead'+(leads.length!==1?'s':'')+' en selección'+(ov?' ⚠️ máx 50':'');el.style.color=ov?'#ef4444':'var(--tm)';}
}
async function ejecutarAnalisisIA(){
  const btn=document.getElementById('btnAnalisisIA'),res=document.getElementById('iaResultado'),f=getFiltrosIA();
  btn.disabled=true;btn.textContent='⏳ Analizando...';
  res.innerHTML='<div style="text-align:center;padding:60px;color:var(--tm)"><div style="font-size:28px;margin-bottom:12px">🤖</div><div style="font-weight:600;margin-bottom:6px">Analizando leads con IA...</div></div>';
  try{
    const filtros={};
    if(f.source)filtros.source=f.source;if(f.status)filtros.status=f.status;if(f.assignedTo)filtros.assignedTo=f.assignedTo;
    if(f.desde)filtros.desde=f.desde;if(f.hasta)filtros.hasta=f.hasta+'T23:59:59';
    const data=await api('POST','/api/leads/analisis-ia',{filtros});
    const html=data.reporte.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/🔴/g,'<span style="color:#ef4444">🔴</span>').replace(/🟡/g,'<span style="color:#f59e0b">🟡</span>').replace(/🟢/g,'<span style="color:#10b981">🟢</span>').replace(/^---$/gm,'<hr style="border:none;border-top:1px solid var(--bd);margin:16px 0">').replace(/\n/g,'<br>');
    res.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><div style="font-weight:700;font-size:14px;color:var(--ts)">📋 Reporte — '+data.totalLeads+' leads analizados</div><button onclick="copiarReporte()" style="background:var(--bg);border:1px solid var(--bd);color:var(--ts);border-radius:7px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit">📋 Copiar</button></div><div id="iaReporteTexto" style="font-size:13px;line-height:1.7;color:var(--ts);font-family:inherit">'+html+'</div>';
  }catch(e){res.innerHTML='<div style="color:#ef4444;padding:20px;text-align:center">❌ Error: '+e.message+'</div>';}
  finally{btn.disabled=false;btn.textContent='🔍 Generar Análisis IA';}
}
function copiarReporte(){const el=document.getElementById('iaReporteTexto');if(el)navigator.clipboard.writeText(el.innerText).then(()=>toast('Reporte copiado ✓'));}
function limpiarAnalisis(){['iaFiltroSource','iaFiltroStatus','iaFiltroVendedor','iaFiltroDes','iaFiltroHas'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});actualizarConteoIA();const res=document.getElementById('iaResultado');if(res)res.innerHTML='<div style="color:var(--tm);font-size:13px;text-align:center;padding:60px 20px"><div style="font-size:32px;margin-bottom:12px">🔍</div><div style="font-weight:600">Selecciona filtros y genera el análisis</div></div>';}
</script>
</body>
</html>`
  );
  n++; console.log('✅ JS Análisis IA');
}

fs.writeFileSync(file, code, 'utf8');
console.log(`\n✅ Total: ${n} fix(es) aplicados`);

const fs=require('fs');
function patch(f,o,n,l){
  const c=fs.readFileSync(f,'utf8');
  if(!c.includes(o)){console.error('❌ '+l);process.exit(1);}
  fs.writeFileSync(f,c.split(o).join(n));
  console.log('✅ '+l);
}
function patchFn(f,name,newBody,l){
  let c=fs.readFileSync(f,'utf8');
  const sig='\nfunction '+name+'(';
  const si=c.indexOf(sig);
  if(si<0){console.error('❌ '+l);process.exit(1);}
  const bi=c.indexOf('{',si+sig.length);
  let d=0,i=bi;
  while(i<c.length){if(c[i]==='{')d++;else if(c[i]==='}'){d--;if(!d)break;}i++;}
  fs.writeFileSync(f,c.slice(0,si+1)+newBody+c.slice(i+1));
  console.log('✅ '+l);
}
const H='public/index.html';

// H9 ── Quitar ai_summary del bloque ctx (Regla 2)
patch(H,
`\${l.ai_summary?\`<div class=\\"ctx-row\\" style=\\"margin-top:4px\\"><span class=\\"ctx-key\\" style=\\"color:var(--ac)\\">🧠 Nota IA</span><span class=\\"ctx-note\\" style=\\"color:var(--ts);font-style:normal\\">\${esc(l.ai_summary)}</span></div>\`:''}`,
``,
'H9: ai_summary fuera de ctx');

// H10 ── renderModal: AISummary + assignedTo admin (Reglas 1 y 2)
patch(H,
`  renderModalCtx(l);renderModalChat(l);renderModalNotes(l);}`,
`  renderModalCtx(l);renderModalChat(l);renderModalNotes(l);renderModalAISummary(l);
  var ab=$('mAssignBlock'),ms=$('mAssign');
  if(S.user&&S.user.role==='admin'&&ab){
    ab.style.display='block';
    ms.innerHTML=(S.users||[]).filter(function(u){return u.role==='vendedor';}).map(function(u){return'<option value="'+u.username+'" '+(u.username===l.assignedTo?'selected':'')+'>'+esc(u.name)+'</option>';}).join('');
  }else if(ab){ab.style.display='none';}
}`,
'H10: renderModal assignedTo + AISummary');

// H11 ── Función renderModalAISummary (Regla 2)
patch(H,
`function renderModalNotes(l){`,
`function renderModalAISummary(l){
  var box=$('aiSumBox'),txt=$('aiSumTxt');if(!box||!txt)return;
  if(l&&l.ai_summary){box.style.display='block';txt.textContent=l.ai_summary;}
  else{box.style.display='none';txt.textContent='';}
}
function renderModalNotes(l){`,
'H11: función renderModalAISummary');

// H12 ── Burbuja morada ia_proactiva en chat (Regla 3)
patch(H,
`const cls=m.role==='user'?'us':m.role==='agent'?'an':'bo';const tag=m.role==='agent'?\`<span class=\\"at\\">👤 \${esc(m.agentName||m.agent||'Agente')}</span>\`:'';return\`<div class=\\"bb \${cls}\\">\${tag}\${esc(m.content)}\${m.ts?\`<span class=\\"ts3\\">\${fTM(m.ts)}</span>\`:''}</div>\`;}).join('');$('mChat').scrollTop=$('mChat').scrollHeight;}`,
`const isIP=m.role==='ia_proactiva';const cls=m.role==='user'?'us':m.role==='agent'?'an':isIP?'ip':'bo';const tag=m.role==='agent'?\`<span class=\\"at\\">👤 \${esc(m.agentName||m.agent||'Agente')}</span>\`:isIP?\`<span class=\\"at\\" style=\\"color:#7c3aed\\">🤖 IA Proactiva</span>\`:'';return\`<div class=\\"bb \${cls}\\">\${tag}\${esc(m.content)}\${m.ts?\`<span class=\\"ts3\\">\${fTM(m.ts)}</span>\`:''}</div>\`;}).join('');$('mChat').scrollTop=$('mChat').scrollHeight;}`,
'H12: Burbuja morada ia_proactiva');

// H13 ── Verde si nextAction vencido en Kanban (Regla 2)
patch(H,
`\${l.nextAction&&l.nextAction.date?'<div style=\\"font-size:11px;color:#f59e0b;font-weight:bold;margin-top:4px\\">⏰ '+new Date(l.nextAction.date).toLocaleString('es-CL',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</div>':''}`,
`\${l.nextAction&&l.nextAction.date?(function(){var d=new Date(l.nextAction.date),p=d<=new Date();return'<div style=\\"font-size:11px;color:'+(p?'#16a34a':'#f59e0b')+';font-weight:bold;margin-top:4px\\">'+(p?'✅':'⏰')+' '+d.toLocaleString('es-CL',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(l.nextAction.delegateToIA?' 🤖':'')+(l.nextAction.iaCompleted?' ✓':'')+' </div>';})():''}`,
'H13: Verde nextAction pasado');

// H14 ── delegateToIA en agendaBtn (Regla 3)
patch(H,
`const updated=await api('PATCH','/api/leads/'+S.mid,{nextAction:{text:txt,date:dt||null,createdAt:new Date().toISOString()}});`,
`const delegar=$('delegaIA')?$('delegaIA').checked:false;
    const updated=await api('PATCH','/api/leads/'+S.mid,{nextAction:{text:txt,date:dt||null,createdAt:new Date().toISOString(),delegateToIA:delegar,iaCompleted:false}});`,
'H14: delegateToIA en agendaBtn');

// H15a ── Limpiar llamada a renderPerfTable en renderDash (Regla 5)
patch(H,
`function renderDash(){renderSlaCards();renderFunnel();renderPerfTable();}`,
`function renderDash(){renderSlaCards();renderFunnel();}`,
'H15a: renderDash sin renderPerfTable');

// H15b ── Vaciar cuerpo de renderPerfTable (muerta) (Regla 5)
patchFn(H,'renderPerfTable',`function renderPerfTable(){}`,
'H15b: renderPerfTable vaciada');

// H16a ── Input contraseña en renderUserTable (Regla 1)
patch(H,
`class="up" value="\${esc(u.phone||'')}"></td><td><select class="us"`,
`class="up" value="\${esc(u.phone||'')}"></td><td><input class="upw" type="password" placeholder="••••" style="width:64px"></td><td><select class="us"`,
'H16a: Campo pwd en tabla');

// H16b ── Save handler incluye password (Regla 1)
patch(H,
`await api('PUT','/api/users/'+encodeURIComponent(un),{name:row.querySelector('.un').value.trim(),role:row.querySelector('.ur').value,phone:row.querySelector('.up').value.trim(),status:row.querySelector('.us').value});toast(un+' actualizado ✓')`,
`var _b={name:row.querySelector('.un').value.trim(),role:row.querySelector('.ur').value,phone:row.querySelector('.up').value.trim(),status:row.querySelector('.us').value};var _pw=row.querySelector('.upw');if(_pw&&_pw.value.trim())_b.password=_pw.value.trim();await api('PUT','/api/users/'+encodeURIComponent(un),_b);toast(un+' actualizado ✓')`,
'H16b: Save handler con password');

// H17 ── mSv incluye assignedTo en payload (Regla 1)
patch(H,
`if(!Object.keys(payload).length){toast('Sin cambios');btn.disabled=false;btn.textContent='Guardar cambios';return;}await api('PATCH','/api/leads/'+S.mid,payload);`,
`if(S.user&&S.user.role==='admin'){var mAss=$('mAssign');if(mAss&&mAss.value&&mAss.value!==l?.assignedTo)payload.assignedTo=mAss.value;}if(!Object.keys(payload).length){toast('Sin cambios');btn.disabled=false;btn.textContent='Guardar cambios';return;}await api('PATCH','/api/leads/'+S.mid,payload);`,
'H17: mSv con assignedTo');

// H18 ── Nav handler carga inventario (Regla 2)
patch(H,
`if(view==='config'){await loadConfig();await loadUsers();}});});`,
`if(view==='config'){await loadConfig();await loadUsers();}else if(view==='inventario'){await renderInventario();}});});`,
'H18: Nav inventario');

// H19a ── Insertar renderInventario antes de loadConfig (Regla 2)
patch(H,
`async function loadConfig(){`,
`async function renderInventario(){
  var grid=$('invGrid'),bs=$('invBrand');if(!grid)return;
  grid.innerHTML='<div class="ke" style="grid-column:1/-1;padding:20px">Cargando...</div>';
  try{
    var data=await api('GET','/api/inventory/scraper');
    var inv=data.structured||[];
    if(bs){
      var brands=[...new Set(inv.map(function(i){return i.brand;}).filter(Boolean))].sort();
      bs.innerHTML='<option value="">Todas las marcas</option>'+brands.map(function(b){return'<option>'+esc(b)+'</option>';}).join('');
    }
    var mp=$('invMaxPrice'),pl=$('invPriceLbl');
    function applyF(){
      var br=(bs?bs.value:'').toLowerCase(),mx=parseInt(mp?mp.value:50000000);
      var fil=inv.filter(function(i){return(!br||(i.brand||'').toLowerCase()===br)&&((i.price||0)<=mx);});
      if(!fil.length){grid.innerHTML='<div class="ke" style="grid-column:1/-1;padding:20px">Sin resultados.</div>';return;}
      grid.innerHTML=fil.map(function(i){
        return'<div class="inv-card"><div class="inv-brand">'+esc(i.brand||'—')+'</div>'
          +'<div class="inv-model">'+esc(i.model)+(i.year?' '+i.year:'')+'</div>'
          +'<div class="inv-price">'+fCLP(i.price||0)+'</div>'
          +'<div class="inv-meta">Stock: '+(i.stock||0)+(i.fuel?' · '+esc(i.fuel):'')+(i.color?' · '+esc(i.color):'')+'</div>'
          +(i.highlights?'<div class="inv-meta">'+esc(i.highlights)+'</div>':'')
          +'</div>';
      }).join('');
    }
    applyF();
    if(bs)bs.onchange=applyF;
    if(mp)mp.oninput=function(){if(pl)pl.textContent='Hasta '+fCLP(parseInt(mp.value));applyF();};
    var rb=$('invRefresh');if(rb)rb.onclick=renderInventario;
  }catch(e){grid.innerHTML='<div class="ke" style="grid-column:1/-1;padding:20px;color:var(--bd2)">Error: '+esc(e.message)+'</div>';}
}
async function loadConfig(){`,
'H19a: renderInventario');

// H19b ── renderTeam → KPIs dashboard (Regla 5)
patchFn(H,'renderTeam',
`function renderTeam(){
  var team=S.team||[],ch=S.channels||[],cont=$('kpiDash');if(!cont)return;
  if(!team.length&&!ch.length){cont.innerHTML='<div class="ke" style="padding:24px">Sin datos de equipo.</div>';return;}
  var mxL=Math.max.apply(null,[1].concat(ch.map(function(c){return c.leads||0;})));
  var chB=ch.length?ch.map(function(c){
    return'<div class="bar-row"><span class="blabel">'+esc(c.channel)+'</span>'
      +'<div class="btrack"><div class="bfill" style="width:'+Math.round(((c.leads||0)/mxL)*100)+'%"></div></div>'
      +'<span class="bval">'+(c.leads||0)+'</span></div>';
  }).join(''):'<div style="color:var(--tm);font-size:12px">Sin datos de canal</div>';
  var mxR=Math.max.apply(null,[1].concat(team.map(function(v){return v.avgResponseMin||0;})));
  var rB=team.length?team.map(function(v){
    var pct=mxR>0?Math.round(((v.avgResponseMin||0)/mxR)*100):0;
    var col=(v.avgResponseMin||0)>30?'var(--bd2)':(v.avgResponseMin||0)>15?'var(--wn)':'var(--ok)';
    return'<div class="bar-row"><span class="blabel">'+esc((v.name||'?').split(' ')[0])+'</span>'
      +'<div class="btrack"><div class="bfill" style="width:'+pct+'%;background:'+col+'"></div></div>'
      +'<span class="bval">'+(v.avgResponseMin||0)+'m</span></div>';
  }).join(''):'<div style="color:var(--tm);font-size:12px">Sin datos</div>';
  var tL=S.leads.length||1;
  var rL=S.leads.filter(function(l){return l.reassigned;}).length;
  var tR=((rL/tL)*100).toFixed(1);
  var cL=S.leads.filter(function(l){return l.status==='Cerrado';}).length;
  var tC=((cL/tL)*100).toFixed(1);
  var vR=team.map(function(v){
    return'<div class="bar-row"><span class="blabel">'+esc((v.name||'?').split(' ')[0])+'</span>'
      +'<div style="flex:1;display:flex;gap:4px;font-size:10.5px;font-weight:700">'
      +'<span style="color:var(--ok)">🟢'+v.sla.fresh+'</span>'
      +'<span style="color:var(--wn)">🟡'+v.sla.risk+'</span>'
      +'<span style="color:var(--bd2)">🔴'+v.sla.critical+'</span>'
      +'<span style="color:var(--ac);margin-left:auto">'+v.closed+' cerr.</span></div></div>';
  }).join('');
  cont.innerHTML='<div class="kpi-grid">'
    +'<div class="kpi-card"><h4>📡 Pipeline por Canal</h4><div class="bar-wrap">'+chB+'</div></div>'
    +'<div class="kpi-card"><h4>⏱ Tiempo Medio 1ª Respuesta</h4><div class="bar-wrap">'+rB+'</div>'
    +'<div style="margin-top:8px;font-size:11px;color:var(--tm)">🟢 &lt;15m &nbsp;🟡 15-30m &nbsp;🔴 &gt;30m</div></div>'
    +'<div class="kpi-card" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><h4 style="grid-column:1/-1">📊 Métricas Globales</h4>'
    +'<div class="kpi-stat"><div class="ks-n" style="color:'+(parseFloat(tR)>20?'var(--bd2)':'var(--ok)')+'">'+tR+'%</div><div class="ks-l">Tasa Reasignación</div></div>'
    +'<div class="kpi-stat"><div class="ks-n" style="color:var(--ok)">'+tC+'%</div><div class="ks-l">Tasa Conversión</div></div></div>'
    +'<div class="kpi-card"><h4>👥 Vendedores</h4><div class="bar-wrap">'+vR+'</div></div>'
    +'</div>';
}`,
'H19b: renderTeam → KPIs');

console.log('\n✅ Todos los patches aplicados. CRM v2.0 listo.\n');

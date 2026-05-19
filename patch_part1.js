const fs=require('fs');
function patch(f,o,n,l){
  const c=fs.readFileSync(f,'utf8');
  if(!c.includes(o)){console.error('❌ '+l);process.exit(1);}
  fs.writeFileSync(f,c.split(o).join(n));
  console.log('✅ '+l);
}
const S='server.js',H='public/index.html';

// S1 ── Motor alertas limpio + Admin 30min (Regla 4)
patch(S,
`        if(nextObj&&nextObj.username!==lead.assignedTo){
          lead.assignedTo=nextObj.username;lead.reassigned=true;lead.reassignedAt=new Date().toISOString();changed=true;
          if(nextObj.phone)sendWA(nextObj.phone,\`🚨 REASIGNACIÓN: Se te asignó el lead [\${lead.name}] porque el vendedor anterior no respondió en 30 min. ¡Atiéndelo ya!\`).catch(()=>{});
          const admin=allUsers.find(u=>u.role==='admin');
          if(admin?.phone)sendWA(admin.phone,\`📢 AVISO GERENCIAL: El lead [\${lead.name}] fue reasignado a [\${nextObj.name||nextObj.username}] por negligencia (>30 min).\`).catch(()=>{});
        }else{lead.reassigned=true;lead.reassignedAt=new Date().toISOString();changed=true;}
      }
      if(mins>SLA_YELLOW&&!lead.criticalAlertSent){
        lead.criticalAlertSent=true;changed=true;
        const admin=allUsers.find(u=>u.role==='admin');
        if(admin?.phone)sendWA(admin.phone,\`🚨 ALERTA CRÍTICA: El lead [\${lead.name}] lleva más de 50 min sin atención tras ser reasignado.\`).catch(()=>{});
      }
    }`,
`        if(nextObj&&nextObj.username!==lead.assignedTo){
          const aiSumR=lead.ai_summary?' Resumen IA: '+lead.ai_summary:'';
          lead.assignedTo=nextObj.username;lead.reassigned=true;lead.reassignedAt=new Date().toISOString();lead.adminReassignAlertSent=false;changed=true;
          if(nextObj.phone)sendWA(nextObj.phone,'🚨 REASIGNACIÓN: Se te asignó el lead ['+lead.name+'] porque el anterior no respondió en 30 min.'+aiSumR).catch(()=>{});
        }else{lead.reassigned=true;lead.reassignedAt=new Date().toISOString();lead.adminReassignAlertSent=false;changed=true;}
      }
      if(lead.reassigned&&lead.reassignedAt&&lead.unread&&lead.adminReassignAlertSent===false){
        const minsR=(Date.now()-new Date(lead.reassignedAt).getTime())/60000;
        if(minsR>SLA_REASSIGN){
          lead.adminReassignAlertSent=true;changed=true;
          const adminU=allUsers.find(u=>u.role==='admin');
          const aiSumA=lead.ai_summary?' Resumen IA: '+lead.ai_summary:'';
          if(adminU?.phone)sendWA(adminU.phone,'📢 ALERTA ADMIN: ['+lead.name+'] lleva 30+ min sin atención tras reasignación.'+aiSumA).catch(()=>{});
        }
      }
    }`,
'S1: Motor alertas');

// S2 ── Webhook: ai_summary en campo dedicado (Regla 2)
patch(S,
`const resumenIAWH=(resCompWH.choices?.[0]?.message?.content||'').trim()||'Interés en crédito/retoma detectado.';
          ld[tenant][idx].notes.push({content:'🧠 '+resumenIAWH,author:'Resumen IA',ts:Date.now()});
          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Asignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.').catch(()=>{});`,
`const resumenIAWH=(resCompWH.choices?.[0]?.message?.content||'').trim()||'Interés en crédito/retoma detectado.';
          ld[tenant][idx].ai_summary=resumenIAWH;
          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Reasignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.').catch(()=>{});`,
'S2: Webhook ai_summary');

// S3 ── Scraper endpoint + Cron IA Proactiva (Reglas 2 y 3)
patch(S,
`app.use(express.static(path.join(__dirname,'public')));`,
`app.get('/api/inventory/scraper',auth('admin','vendedor'),async(req,res)=>{
  res.json({ts:scrapeCache.ts,raw:scrapeCache.data||'',structured:await tRead(F.inventory,req.tenant)});
});
setInterval(async()=>{
  for(const t of TENANTS){
    try{
      const leads=await tRead(F.leads,t);let changed=false;
      for(const lead of leads){
        if(FINAL_ST.has(lead.status))continue;
        const na=lead.nextAction;
        if(!na||!na.date||!na.delegateToIA||na.iaCompleted)continue;
        if(new Date(na.date)>new Date())continue;
        try{
          const histSnip=(lead.chatHistory||[]).slice(-10).map(m=>(m.role==='user'?'Cliente':m.role==='agent'?'Vendedor':'IA')+': '+m.content).join('\\n');
          const comp=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.6,max_tokens:160,messages:[{role:'user',content:'Eres asesor de ventas. Redacta mensaje breve de seguimiento en español chileno para WhatsApp (max 3 oraciones, emoji). Instrucción: "'+na.text+'". Historial:\\n'+histSnip}]});
          const iaMsg=(comp.choices?.[0]?.message?.content||'').trim();
          if(!iaMsg)continue;
          const phone=(lead.phone||'').replace(/\\D/g,'');
          if(phone)await sendWA(phone,iaMsg).catch(()=>{});
          lead.chatHistory=lead.chatHistory||[];
          lead.chatHistory.push({role:'ia_proactiva',content:iaMsg,ts:Date.now(),agentName:'IA Proactiva'});
          na.iaCompleted=true;na.iaCompletedAt=new Date().toISOString();
          lead.lastInteraction=new Date().toISOString();changed=true;
          console.log('[IA-Proactiva] Enviado a '+lead.name);
        }catch(eP){console.error('[IA-Proactiva]',lead.name,eP.message);}
      }
      if(changed)await tWrite(F.leads,t,leads);
    }catch(eT){console.error('[IA-Proactiva-cron]',eT.message);}
  }
},60000);
app.use(express.static(path.join(__dirname,'public')));`,
'S3: Scraper endpoint + IA Proactiva cron');

// H1 ── CSS nuevos elementos
patch(H,
`}.toast.show{opacity:1;transform:translateY(0)}.toast.err{background:var(--bd2)}</style>`,
`}.toast.show{opacity:1;transform:translateY(0)}.toast.err{background:var(--bd2)}
.bb.ip{background:linear-gradient(135deg,rgba(139,92,246,.18),rgba(109,40,217,.12));border:1px solid rgba(139,92,246,.35);color:#4c1d95;align-self:flex-end;border-top-right-radius:2px}
.ai-sum-box{margin-top:10px;background:linear-gradient(135deg,rgba(139,92,246,.1),rgba(59,130,246,.06));border:1px solid rgba(139,92,246,.35);border-radius:9px;padding:10px 12px;display:none}
.ai-sum-box .ai-label{font-size:10.5px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}
.ai-sum-box .ai-txt{font-size:12px;color:var(--ts);line-height:1.5}
.inv-filters{background:var(--p);border:1px solid var(--bd);border-radius:var(--r);padding:12px 16px;margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.inv-card{background:var(--p);border:1px solid var(--bd);border-radius:var(--r);padding:14px;transition:all var(--tr)}
.inv-card:hover{border-color:var(--bdm);transform:translateY(-1px)}
.inv-brand{font-size:10.5px;font-weight:700;color:var(--tm);text-transform:uppercase;letter-spacing:.05em}
.inv-model{font-weight:700;font-size:13px;margin:2px 0 6px}
.inv-price{font-size:18px;font-weight:800;color:var(--ac);letter-spacing:-.02em}
.inv-meta{font-size:11px;color:var(--tm);margin-top:4px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.kpi-card{background:var(--p);border:1px solid var(--bd);border-radius:var(--r);padding:18px}
.kpi-card h4{font-size:11px;font-weight:700;color:var(--tm);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.bar-wrap{display:flex;flex-direction:column;gap:6px}
.bar-row{display:flex;align-items:center;gap:8px;font-size:12px}
.bar-row .blabel{min-width:90px;color:var(--ts);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-row .btrack{flex:1;background:var(--p2);border-radius:4px;height:10px;overflow:hidden}
.bar-row .bfill{height:100%;border-radius:4px;background:var(--ac)}
.bar-row .bval{min-width:36px;text-align:right;font-weight:700}
.kpi-stat{text-align:center;padding:10px 0}
.kpi-stat .ks-n{font-size:40px;font-weight:800;letter-spacing:-.03em;color:var(--ac)}
.kpi-stat .ks-l{font-size:12px;color:var(--tm);margin-top:4px}
</style>`,
'H1: CSS');

// H2 ── Botón Inventario en nav
patch(H,
`<button data-view="config" id="navC">⚙️ Config</button>`,
`<button data-view="inventario" id="navInv">🚗 Inventario</button><button data-view="config" id="navC">⚙️ Config</button>`,
'H2: Nav Inventario');

// H3 ── Secciones Equipo → KPIs + nueva sección Inventario
patch(H,
`<section id="view-team" class="view"><div class="st">Gestión de Equipo</div><div class="tg" id="tGrd"></div></section>
<section id="view-config" class="view">`,
`<section id="view-team" class="view"><div class="st">📊 KPIs del Equipo</div><div id="kpiDash"></div></section>
<section id="view-inventario" class="view">
<div class="st">🚗 Inventario</div>
<div class="inv-filters">
  <span style="font-size:11.5px;font-weight:600;color:var(--tm)">Filtrar:</span>
  <select id="invBrand" style="background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:6px 10px;border-radius:7px;font-family:inherit;font-size:12px"><option value="">Todas las marcas</option></select>
  <input type="range" id="invMaxPrice" min="0" max="50000000" step="500000" value="50000000" style="flex:1;max-width:200px">
  <span id="invPriceLbl" style="font-size:12px;color:var(--ts);font-weight:600;white-space:nowrap">Hasta $50.000.000</span>
  <button id="invRefresh" class="bs" style="padding:6px 12px;font-size:12px">🔄 Actualizar</button>
</div>
<div class="inv-grid" id="invGrid"><div class="ke" style="padding:20px;grid-column:1/-1">Cargando...</div></div>
</section>
<section id="view-config" class="view">`,
'H3: Secciones Inventario + KPIs Equipo');

// H4 ── AI Summary box en modal (Regla 2)
patch(H,
`<div><div class="acl">Responder al cliente (→ WhatsApp)</div><div class="acmp"><textarea id="aMsg" placeholder="Escribe un mensaje..." rows="2"></textarea><button class="snb" id="aSnd">Enviar ➤</button></div></div>
</div>`,
`<div><div class="acl">Responder al cliente (→ WhatsApp)</div><div class="acmp"><textarea id="aMsg" placeholder="Escribe un mensaje..." rows="2"></textarea><button class="snb" id="aSnd">Enviar ➤</button></div></div>
<div class="ai-sum-box" id="aiSumBox"><div class="ai-label">🧠 Resumen IA</div><div class="ai-txt" id="aiSumTxt"></div></div>
</div>`,
'H4: AI Summary box modal');

// H5 ── Selector Reasignar solo admin (Regla 1)
patch(H,
`<div><h4>Estado</h4><select id="mSt"></select></div>`,
`<div><h4>Estado</h4><select id="mSt"></select></div>
<div id="mAssignBlock" style="display:none"><h4>Reasignar a <span style="font-size:10px;background:var(--as);color:var(--ac);padding:2px 6px;border-radius:4px;font-weight:700">ADMIN</span></h4><select id="mAssign" style="width:100%;padding:8px 10px;background:var(--p2);border:1px solid var(--bd);color:var(--tx);border-radius:7px;font-family:inherit;font-size:12.5px"></select></div>`,
'H5: Reasignar admin-only');

// H6 ── Checkbox Delegar IA en agenda (Regla 3)
patch(H,
`      <button id="agendaBtn" class="bp" style="padding:6px 12px;font-size:12px;white-space:nowrap">Agendar</button>`,
`      <label style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ts);cursor:pointer;user-select:none"><input type="checkbox" id="delegaIA" style="accent-color:var(--ac)"> 🤖 Delegar IA</label>
      <button id="agendaBtn" class="bp" style="padding:6px 12px;font-size:12px;white-space:nowrap">Agendar</button>`,
'H6: Checkbox Delegar IA');

// H7 ── Eliminar bloque Rendimiento por Vendedor (Regla 5)
patch(H,
`<div class="bt">③ Rendimiento por Vendedor</div>
<div class="pt" id="perfT"></div>
</section>`,
`</section>`,
'H7: Eliminar Rendimiento Vendedor');

// H8 ── Columna Nueva Pwd en tabla usuarios (Regla 1)
patch(H,
`<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Teléfono</th><th>Estado</th><th>Acciones</th></tr></thead>`,
`<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Teléfono</th><th>Nueva Pwd</th><th>Estado</th><th>Acciones</th></tr></thead>`,
'H8: Columna contraseña');

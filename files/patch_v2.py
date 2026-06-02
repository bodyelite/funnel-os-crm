#!/usr/bin/env python3
import re, sys, shutil, os

SERVER = "server.js"
if not os.path.exists(SERVER):
    print("ERROR: server.js not found in current directory")
    sys.exit(1)

with open(SERVER, "r", encoding="utf-8") as f:
    src = f.read()

shutil.copy(SERVER, SERVER + ".bak_v2")
changes = []

# ─────────────────────────────────────────────────────────────────
# R1 — Identidad dinámica: marcela() usa lead.botPersona si existe
# Cambia el fallback de null a 'Cata' en la llamada del webhook
# ─────────────────────────────────────────────────────────────────
OLD_R1_WEBHOOK = "const assignedNameWH=assignedUserWH?.name||null;"
NEW_R1_WEBHOOK = "const assignedNameWH=ld[tenant][idx].botPersona||assignedUserWH?.name||'Cata';"
if OLD_R1_WEBHOOK in src:
    src = src.replace(OLD_R1_WEBHOOK, NEW_R1_WEBHOOK)
    changes.append("R1a: webhook usa botPersona dinamico")
else:
    print("WARN R1a: bloque no encontrado — revisar manualmente")

OLD_R1_CHAT = "const assignedNameChat=assignedUserChat?.name||null;"
NEW_R1_CHAT = "const assignedNameChat=leads[idx].botPersona||assignedUserChat?.name||'Cata';"
if OLD_R1_CHAT in src:
    src = src.replace(OLD_R1_CHAT, NEW_R1_CHAT)
    changes.append("R1b: /api/chat usa botPersona dinamico")
else:
    print("WARN R1b: bloque no encontrado — revisar manualmente")

OLD_R1_MARCELA = "const assignedNameChat=assignedUserChat?.name||null;"
# ya cubierto arriba

# R1 — cuando agente responde, persiste su nombre en botPersona
OLD_R1_AGENT = """leads[idx].chatHistory.push({role:'agent',content,ts:Date.now(),agent:req.user.username,agentName:req.user.name||req.user.username});
  leads[idx].unread=false;leads[idx].lastInteraction=new Date().toISOString();leads[idx].alertLevel=calcAlert(leads[idx]);"""
NEW_R1_AGENT = """leads[idx].chatHistory.push({role:'agent',content,ts:Date.now(),agent:req.user.username,agentName:req.user.name||req.user.username});
  leads[idx].botPersona=req.user.name||req.user.username;
  leads[idx].unread=false;leads[idx].lastInteraction=new Date().toISOString();leads[idx].alertLevel=calcAlert(leads[idx]);"""
if OLD_R1_AGENT in src:
    src = src.replace(OLD_R1_AGENT, NEW_R1_AGENT)
    changes.append("R1c: agente persiste nombre en botPersona")
else:
    print("WARN R1c: bloque agente no encontrado — revisar manualmente")

# ─────────────────────────────────────────────────────────────────
# R2 — Trazabilidad anuncio: captura referral del webhook WA
# ─────────────────────────────────────────────────────────────────
OLD_R2 = "    const from=msg.from;let body=msg.text?.body||msg.button?.text||null;"
NEW_R2 = """    const from=msg.from;let body=msg.text?.body||msg.button?.text||null;

    // R2: Captura referral de Meta Ads (WhatsApp Business API)
    const referral=msg.referral||null;
    const adTracing=referral?{
      ad_id:referral.headline_id||referral.source_id||referral.ad_id||null,
      headline:referral.headline||null,
      source_url:referral.source_url||null,
      source_type:referral.source_type||null,
      media_type:referral.media_type||null,
    }:null;"""
if OLD_R2 in src:
    src = src.replace(OLD_R2, NEW_R2)
    changes.append("R2a: extraccion referral del mensaje entrante")
else:
    print("WARN R2a: linea from/body no encontrada — revisar manualmente")

# R2 — persiste adTracing en el lead al crearlo
OLD_R2_LEAD_NEW = """        source: detectedSource, status: 'Nuevo',
        lastInteraction: n, lastClientTs: n,
        interest: detectedInterest,
        assignedTo: assignedObj.username, botActive: true,
        alertLevel: 'none', intentSignal: 'NONE', unread: true,
        notes: initNotes, chatHistory: []"""
NEW_R2_LEAD_NEW = """        source: detectedSource, status: 'Nuevo',
        lastInteraction: n, lastClientTs: n,
        interest: detectedInterest,
        assignedTo: assignedObj.username, botActive: true,
        alertLevel: 'none', intentSignal: 'NONE', unread: true,
        notes: initNotes, chatHistory: [],
        adTracing: adTracing"""
if OLD_R2_LEAD_NEW in src:
    src = src.replace(OLD_R2_LEAD_NEW, NEW_R2_LEAD_NEW)
    changes.append("R2b: adTracing persistido en lead nuevo")
else:
    print("WARN R2b: bloque lead nuevo no encontrado — revisar manualmente")

# R2 — actualiza adTracing en lead existente si llega referral
OLD_R2_EXISTING = "    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});"
NEW_R2_EXISTING = """    if(adTracing&&!ld[tenant][idx].adTracing)ld[tenant][idx].adTracing=adTracing;
    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});"""
if OLD_R2_EXISTING in src:
    src = src.replace(OLD_R2_EXISTING, NEW_R2_EXISTING)
    changes.append("R2c: adTracing actualizado en lead existente")
else:
    print("WARN R2c: push chatHistory no encontrado — revisar manualmente")

# ─────────────────────────────────────────────────────────────────
# R3 — Backend: endpoint DELETE masivo de leads
# ─────────────────────────────────────────────────────────────────
WIPE_ENDPOINT = """
app.delete('/api/leads/wipe',auth('admin'),async(req,res)=>{
  const leads=await read(F.leads);
  const tenant=req.tenant||'demo_automotora';
  const prev=(leads[tenant]||[]).length;
  leads[tenant]=[];
  if(req.query.all==='true'){
    for(const t of TENANTS){leads[t]=[];}
  }
  await write(F.leads,leads);
  console.log('[WIPE] Leads eliminados:',prev,'tenant:',tenant);
  res.json({ok:true,deleted:prev,tenant});
});
"""
# Insertar antes del middleware de archivos estáticos
OLD_STATIC = "app.use(express.static(path.join(__dirname,'public')));"
if WIPE_ENDPOINT.strip() not in src:
    src = src.replace(OLD_STATIC, WIPE_ENDPOINT + "\n" + OLD_STATIC)
    changes.append("R3: endpoint DELETE /api/leads/wipe agregado")
else:
    changes.append("R3: endpoint wipe ya existia")

# ─────────────────────────────────────────────────────────────────
# R3 — Frontend: busqueda, seleccion masiva, borrado en vista Leads
# Reemplaza el bloque de la seccion view-leads
# ─────────────────────────────────────────────────────────────────
OLD_LEADS_SECTION = """<section id="view-leads" class="view">
<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
  <div class="st" style="margin-bottom:0">Leads</div>
  <button id="btnNuevoLead" onclick="openNuevoLeadModal()" style="background:var(--ac);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px">＋ Nuevo Lead</button>
</div>
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--p);border:1px solid var(--bd);border-radius:var(--r);padding:10px 14px;margin-bottom:12px">
  <span class="lbl">Canal</span>
  <select id="filtCanal" onchange="renderLeads()" style="background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:5px 10px;border-radius:7px;font-family:inherit;font-size:12px">
    <option value="">Todos</option>
    <option value="WhatsApp">WhatsApp</option>
    <option value="Chileautos">Chileautos</option>
    <option value="Yapo">Yapo</option>
    <option value="MercadoLibre">MercadoLibre</option>
    <option value="Meta Ads">Meta Ads</option>
    <option value="Referido">Referido</option>
    <option value="Llamada">Llamada</option>
    <option value="Otro">Otro</option>
  </select>
  <span class="lbl">Estado</span>
  <select id="filtEstado" onchange="renderLeads()" style="background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:5px 10px;border-radius:7px;font-family:inherit;font-size:12px">
    <option value="">Todos</option>
    <option value="Nuevo">Nuevo</option>
    <option value="En Proceso">En Proceso</option>
    <option value="Contactado">Contactado</option>
    <option value="Calificado">Calificado</option>
    <option value="Negociación">Negociación</option>
    <option value="Agendado">Agendado</option>
    <option value="Reservado">Reservado</option>
    <option value="Seguimiento">Seguimiento</option>
    <option value="Cerrado">Cerrado</option>
    <option value="Abandonado">Abandonado</option>
    <option value="esperando_respuesta_chileautos">En Espera CA</option>
    <option value="esperando_respuesta_general">En Espera General</option>
  </select>
  <button onclick="document.getElementById('filtCanal').value='';document.getElementById('filtEstado').value='';renderLeads();" style="background:transparent;border:1px solid var(--bd);color:var(--tm);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">Limpiar</button>
  <span id="filtCount" style="margin-left:auto;font-size:11px;color:var(--tm)"></span>
</div>
<div class="tw" id="lTbl"></div>
</section>"""

NEW_LEADS_SECTION = """<section id="view-leads" class="view">
<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
  <div class="st" style="margin-bottom:0">Leads</div>
  <div style="display:flex;gap:8px;align-items:center">
    <button id="btnDeleteSelected" onclick="deleteSelectedLeads()" style="display:none;background:var(--bd2);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">🗑 Eliminar seleccionados</button>
    <button id="btnNuevoLead" onclick="openNuevoLeadModal()" style="background:var(--ac);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px">＋ Nuevo Lead</button>
  </div>
</div>
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--p);border:1px solid var(--bd);border-radius:var(--r);padding:10px 14px;margin-bottom:12px">
  <input id="busquedaLead" type="text" placeholder="🔍 Buscar por nombre, teléfono o interés..." oninput="renderLeads()" style="background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:6px 12px;border-radius:7px;font-family:inherit;font-size:12px;width:240px">
  <span class="lbl">Canal</span>
  <select id="filtCanal" onchange="renderLeads()" style="background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:5px 10px;border-radius:7px;font-family:inherit;font-size:12px">
    <option value="">Todos</option>
    <option value="WhatsApp">WhatsApp</option>
    <option value="Chileautos">Chileautos</option>
    <option value="Yapo">Yapo</option>
    <option value="MercadoLibre">MercadoLibre</option>
    <option value="Meta Ads">Meta Ads</option>
    <option value="Referido">Referido</option>
    <option value="Llamada">Llamada</option>
    <option value="Otro">Otro</option>
  </select>
  <span class="lbl">Estado</span>
  <select id="filtEstado" onchange="renderLeads()" style="background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:5px 10px;border-radius:7px;font-family:inherit;font-size:12px">
    <option value="">Todos</option>
    <option value="Nuevo">Nuevo</option>
    <option value="En Proceso">En Proceso</option>
    <option value="Contactado">Contactado</option>
    <option value="Calificado">Calificado</option>
    <option value="Negociación">Negociación</option>
    <option value="Agendado">Agendado</option>
    <option value="Reservado">Reservado</option>
    <option value="Seguimiento">Seguimiento</option>
    <option value="Cerrado">Cerrado</option>
    <option value="Abandonado">Abandonado</option>
    <option value="esperando_respuesta_chileautos">En Espera CA</option>
    <option value="esperando_respuesta_general">En Espera General</option>
  </select>
  <button onclick="document.getElementById('filtCanal').value='';document.getElementById('filtEstado').value='';document.getElementById('busquedaLead').value='';renderLeads();" style="background:transparent;border:1px solid var(--bd);color:var(--tm);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">Limpiar</button>
  <label style="display:flex;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:var(--tm);cursor:pointer">
    <input type="checkbox" id="chkSelectAll" onchange="toggleSelectAll(this.checked)" style="accent-color:var(--ac)"> Seleccionar todos
  </label>
  <span id="filtCount" style="font-size:11px;color:var(--tm)"></span>
</div>
<div class="tw" id="lTbl"></div>
</section>"""

if OLD_LEADS_SECTION in src:
    src = src.replace(OLD_LEADS_SECTION, NEW_LEADS_SECTION)
    changes.append("R3: frontend leads actualizado con busqueda y seleccion masiva")
else:
    print("WARN R3: seccion view-leads no encontrada exacta — revisar manualmente")

# R3 — actualizar renderLeads para soportar busqueda, checkbox y adTracing
OLD_RENDER_LEADS = """function renderLeads(){
  const gc='grid-template-columns:8px 8px 11px 1.3fr .9fr 1.1fr .85fr .85fr 1.2fr .75fr';
  const hd=`<div class="tr2 hd" style="${gc}"><div></div><div></div><div></div><div>Nombre</div><div>Tel.</div><div>Interés</div><div>Canal</div><div>Asignado</div><div>Estado</div><div>Última</div></div>`;
  const filtCanal = document.getElementById('filtCanal')?.value || '';
  const filtEstado = document.getElementById('filtEstado')?.value || '';
  let leads = S.leads || [];
  if(filtCanal) leads = leads.filter(l => (l.source||'') === filtCanal);
  if(filtEstado) leads = leads.filter(l => (l.status||'') === filtEstado);
  const countEl = document.getElementById('filtCount');
  if(countEl) countEl.textContent = (filtCanal||filtEstado) ? `${leads.length} resultado${leads.length!==1?'s':''}` : `${leads.length} leads`;
  const rows = leads.length ? leads.map(l=>`<div class="tr2" style="${gc}" data-id="${l.id}">${l.unread?'<div class="ud"></div>':'<div></div>'}${adot(l.alertLevel)}${sdot(l.intentSignal||'NONE')}<div><strong>${esc(l.name)}</strong></div><div style="font-size:11.5px;color:var(--tm)">${esc(l.phone||'—')}</div><div style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.interest||'—')}</div><div>${cSrc(l.source)}</div><div>${cUsr(l.assignedTo)}</div><div>${stpl(l.status)}</div><div style="font-size:11px;color:var(--tm)">${fDT(l.lastClientTs||l.lastInteraction)}</div></div>`).join('') : '<div class="ke" style="padding:16px">Sin leads para este filtro.</div>';
  $('lTbl').innerHTML=hd+rows;
  $('lTbl').querySelectorAll('.tr2[data-id]').forEach(el=>el.addEventListener('click',()=>openModal(+el.dataset.id)));
}"""

NEW_RENDER_LEADS = """// selectedLeads set global
if(typeof window._selLeads==='undefined')window._selLeads=new Set();

function toggleSelectAll(checked){
  window._selLeads=new Set();
  document.querySelectorAll('.lead-chk').forEach(chk=>{
    chk.checked=checked;
    if(checked)window._selLeads.add(+chk.dataset.id);
  });
  const btn=document.getElementById('btnDeleteSelected');
  if(btn)btn.style.display=window._selLeads.size?'block':'none';
}

function onLeadCheck(chk){
  const id=+chk.dataset.id;
  if(chk.checked)window._selLeads.add(id);
  else window._selLeads.delete(id);
  const btn=document.getElementById('btnDeleteSelected');
  if(btn)btn.style.display=window._selLeads.size?'block':'none';
  const all=document.getElementById('chkSelectAll');
  if(all){
    const total=document.querySelectorAll('.lead-chk').length;
    all.checked=window._selLeads.size===total&&total>0;
    all.indeterminate=window._selLeads.size>0&&window._selLeads.size<total;
  }
}

async function deleteSelectedLeads(){
  if(!window._selLeads.size)return;
  if(!confirm('¿Eliminar '+window._selLeads.size+' lead(s) seleccionado(s)? Esta acción no se puede deshacer.'))return;
  const ids=[...window._selLeads];
  let ok=0,err=0;
  for(const id of ids){
    try{
      await api('PATCH','/api/leads/'+id,{status:'_delete_'});
      ok++;
    }catch(e){err++;}
  }
  window._selLeads=new Set();
  const btn=document.getElementById('btnDeleteSelected');
  if(btn)btn.style.display='none';
  const all=document.getElementById('chkSelectAll');
  if(all)all.checked=false;
  toast(ok+' lead(s) eliminado(s)'+(err?' | '+err+' errores':'')+'.',err>0);
  await refresh();
}

function renderLeads(){
  const gc='grid-template-columns:28px 8px 8px 11px 1.2fr .85fr 1fr .8fr .8fr 1.1fr .7fr';
  const hd=`<div class="tr2 hd" style="${gc}"><div></div><div></div><div></div><div></div><div>Nombre</div><div>Tel.</div><div>Interés</div><div>Canal</div><div>Anuncio</div><div>Estado</div><div>Última</div></div>`;
  const filtCanal = document.getElementById('filtCanal')?.value || '';
  const filtEstado = document.getElementById('filtEstado')?.value || '';
  const busqueda = (document.getElementById('busquedaLead')?.value||'').toLowerCase().trim();
  let leads = S.leads || [];
  if(filtCanal) leads = leads.filter(l => (l.source||'') === filtCanal);
  if(filtEstado) leads = leads.filter(l => (l.status||'') === filtEstado);
  if(busqueda) leads = leads.filter(l =>
    (l.name||'').toLowerCase().includes(busqueda)||
    (l.phone||'').toLowerCase().includes(busqueda)||
    (l.interest||'').toLowerCase().includes(busqueda)
  );
  const countEl = document.getElementById('filtCount');
  if(countEl) countEl.textContent = `${leads.length} lead${leads.length!==1?'s':''}`;
  const rows = leads.length ? leads.map(l=>{
    const adLabel=l.adTracing?.headline?`<span title="${esc(l.adTracing.headline)}" style="font-size:10px;color:var(--ac);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;max-width:100px">${esc(l.adTracing.headline.slice(0,18))}…</span>`:'<span style="font-size:10px;color:var(--tm)">—</span>';
    const isSel=window._selLeads.has(l.id);
    return `<div class="tr2" style="${gc}" data-id="${l.id}">
      <div onclick="event.stopPropagation()"><input type="checkbox" class="lead-chk" data-id="${l.id}" ${isSel?'checked':''} onchange="onLeadCheck(this)" style="accent-color:var(--ac);cursor:pointer"></div>
      ${l.unread?'<div class="ud"></div>':'<div></div>'}${adot(l.alertLevel)}${sdot(l.intentSignal||'NONE')}
      <div><strong>${esc(l.name)}</strong></div>
      <div style="font-size:11.5px;color:var(--tm)">${esc(l.phone||'—')}</div>
      <div style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.interest||'—')}</div>
      <div>${cSrc(l.source)}</div>
      <div>${adLabel}</div>
      <div>${stpl(l.status)}</div>
      <div style="font-size:11px;color:var(--tm)">${fDT(l.lastClientTs||l.lastInteraction)}</div>
    </div>`;
  }).join('') : '<div class="ke" style="padding:16px">Sin leads para este filtro.</div>';
  $('lTbl').innerHTML=hd+rows;
  $('lTbl').querySelectorAll('.tr2[data-id]').forEach(el=>{
    el.addEventListener('click',e=>{
      if(e.target.type==='checkbox')return;
      openModal(+el.dataset.id);
    });
  });
}"""

if OLD_RENDER_LEADS in src:
    src = src.replace(OLD_RENDER_LEADS, NEW_RENDER_LEADS)
    changes.append("R3: renderLeads actualizado con busqueda, checkbox, adTracing column")
else:
    print("WARN R3: renderLeads no encontrado exacto — revisar manualmente")

# R3 — endpoint backend para borrado individual (wipe por status _delete_)
OLD_PATCH_LEADS = """  const patch={};for(const k of ALLOWED)if(req.body[k]!==undefined)patch[k]=req.body[k];
  if(patch.status!==undefined&&!VALID_ST.has(patch.status))return res.status(400).json({error:'Status inválido'});"""
NEW_PATCH_LEADS = """  // Borrado individual via patch status '_delete_'
  if(req.body.status==='_delete_'){
    const before=leads.length;
    const remaining=leads.filter(x=>x.id!=req.params.id);
    await tWrite(F.leads,req.tenant,remaining);
    return res.json({ok:true,deleted:before-remaining.length});
  }
  const patch={};for(const k of ALLOWED)if(req.body[k]!==undefined)patch[k]=req.body[k];
  if(patch.status!==undefined&&!VALID_ST.has(patch.status))return res.status(400).json({error:'Status inválido'});"""
if OLD_PATCH_LEADS in src:
    src = src.replace(OLD_PATCH_LEADS, NEW_PATCH_LEADS)
    changes.append("R3: borrado individual via PATCH status _delete_ habilitado")
else:
    print("WARN R3: bloque patch leads no encontrado — revisar manualmente")

# ─── Guardar ───────────────────────────────────────────────────────
with open(SERVER, "w", encoding="utf-8") as f:
    f.write(src)

print("\n✅ Patch aplicado. Cambios:")
for c in changes:
    print(f"  ✓ {c}")
print(f"\n📁 Backup en {SERVER}.bak_v2")
print("\nVerificando sintaxis...")

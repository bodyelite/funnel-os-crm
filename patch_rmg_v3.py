#!/usr/bin/env python3
import os, shutil, re

HTML = "public/index.html"
SERVER = "server.js"

for f in [HTML, SERVER]:
    if not os.path.exists(f):
        print(f"ERROR: {f} no encontrado")
        raise SystemExit(1)

with open(HTML, "r", encoding="utf-8") as f:
    html = f.read()
with open(SERVER, "r", encoding="utf-8") as f:
    srv = f.read()

shutil.copy(HTML, HTML + ".bak_rmg")
shutil.copy(SERVER, SERVER + ".bak_rmg")

changes = []

# ═══════════════════════════════════════════════════════════════
# R2 — Solo RMG en login, sin demo_clinica ni demo_automotora
# ═══════════════════════════════════════════════════════════════
OLD_LOGIN_SELECT = """<select id="liT"><option value="demo_automotora">Automotora Andes</option><option value="rmg">RMG Autos</option><option value="demo_clinica">Clínica Vital</option></select>"""
NEW_LOGIN_SELECT = """<select id="liT"><option value="demo_automotora">RMG Autos</option></select>"""
if OLD_LOGIN_SELECT in html:
    html = html.replace(OLD_LOGIN_SELECT, NEW_LOGIN_SELECT)
    changes.append("R2: login muestra solo RMG Autos")
else:
    print("WARN R2: selector login no encontrado exacto")

# ═══════════════════════════════════════════════════════════════
# R3 — Campo 'clave' en sección Config empresa
# ═══════════════════════════════════════════════════════════════
OLD_CFG_FORM = """<div class="cfg"><div><label class="cfl">Nombre</label><input class="cfi" id="cfgN" placeholder="Automotora Andes"></div><div><label class="cfl">Color acento</label><input type="color" class="cfi" id="cfgC" value="#3b82f6" style="padding:4px;height:36px;cursor:pointer"></div></div><div class="ca" style="margin-top:12px"><button class="bp" id="cfgSB">Guardar Empresa</button></div>"""
NEW_CFG_FORM = """<div class="cfg"><div><label class="cfl">Nombre del negocio</label><input class="cfi" id="cfgN" placeholder="RMG Autos"></div><div><label class="cfl">Color acento</label><input type="color" class="cfi" id="cfgC" value="#3b82f6" style="padding:4px;height:36px;cursor:pointer"></div></div><div style="margin-top:12px"><label class="cfl">Clave de acceso (modifica para cambiar contraseña global)</label><div style="display:flex;gap:8px;align-items:center"><input class="cfi" id="cfgClave" type="password" placeholder="Nueva clave (dejar vacío para no cambiar)" style="flex:1"><button type="button" onclick="toggleClave()" style="background:var(--p2);border:1px solid var(--bd);color:var(--tm);padding:8px 12px;border-radius:8px;cursor:pointer;font-size:12px">👁</button></div></div><div class="ca" style="margin-top:12px"><button class="bp" id="cfgSB">Guardar Empresa</button></div>"""
if OLD_CFG_FORM in html:
    html = html.replace(OLD_CFG_FORM, NEW_CFG_FORM)
    changes.append("R3: campo clave agregado en Config")
else:
    print("WARN R3: bloque config no encontrado exacto")

# R3 — JS para toggleClave y guardar clave en cfgSB handler
OLD_CFG_SAVE = """$('cfgSB').addEventListener('click',async()=>{const btn=$('cfgSB');btn.disabled=true;btn.textContent='…';try{const n=$('cfgN').value.trim(),ac=$('cfgC').value;await api('PUT','/api/config',{businessName:n,accentColor:ac});$('bizName').textContent=n||'FunnelOS';document.documentElement.style.setProperty('--ac',ac);toast('Configuración guardada ✓');}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent='Guardar Empresa';}});"""
NEW_CFG_SAVE = """function toggleClave(){const i=$('cfgClave');i.type=i.type==='password'?'text':'password';}
$('cfgSB').addEventListener('click',async()=>{const btn=$('cfgSB');btn.disabled=true;btn.textContent='…';try{const n=$('cfgN').value.trim(),ac=$('cfgC').value,clave=$('cfgClave')?.value?.trim();const payload={businessName:n,accentColor:ac};if(clave){payload.newPassword=clave;}await api('PUT','/api/config',payload);if(clave&&payload.newPassword){await api('PUT','/api/config/password',{newPassword:clave}).catch(()=>{});}$('bizName').textContent=n||'RMG Autos';document.documentElement.style.setProperty('--ac',ac);if($('cfgClave'))$('cfgClave').value='';toast('Configuración guardada ✓');}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent='Guardar Empresa';}});"""
if OLD_CFG_SAVE in html:
    html = html.replace(OLD_CFG_SAVE, NEW_CFG_SAVE)
    changes.append("R3: guardar clave desde config")
else:
    print("WARN R3: handler cfgSB no encontrado exacto")

# ═══════════════════════════════════════════════════════════════
# R1 — Modal Nuevo Lead con selectores de inventario
# ═══════════════════════════════════════════════════════════════
OLD_LEAD_INTERES = """    <div style="grid-column:1/-1">
      <label style="font-size:11.5px;color:var(--tm);display:block;margin-bottom:4px;font-weight:600">Vehículo de Interés</label>
      <input id="nlInteres" type="text" placeholder="Ej: 2024 Toyota Corolla" style="width:100%;padding:9px 12px;background:var(--p2);border:1px solid var(--bd);color:var(--tx);border-radius:8px;font-family:inherit;font-size:13px">
    </div>"""
NEW_LEAD_INTERES = """    <div>
      <label style="font-size:11.5px;color:var(--tm);display:block;margin-bottom:4px;font-weight:600">Marca</label>
      <select id="nlMarca" onchange="onNlMarcaChange()" style="width:100%;padding:9px 12px;background:var(--p2);border:1px solid var(--bd);color:var(--tx);border-radius:8px;font-family:inherit;font-size:13px">
        <option value="">Seleccionar marca...</option>
      </select>
    </div>
    <div>
      <label style="font-size:11.5px;color:var(--tm);display:block;margin-bottom:4px;font-weight:600">Vehículo de Interés</label>
      <select id="nlInteres" style="width:100%;padding:9px 12px;background:var(--p2);border:1px solid var(--bd);color:var(--tx);border-radius:8px;font-family:inherit;font-size:13px">
        <option value="">Seleccionar marca primero...</option>
      </select>
    </div>
    <div style="grid-column:1/-1">
      <label style="font-size:11.5px;color:var(--tm);display:block;margin-bottom:4px;font-weight:600">Detalles adicionales del interés</label>
      <input id="nlInteresExtra" type="text" placeholder="Ej: interesado en crédito, quiere tasar auto en parte de pago..." style="width:100%;padding:9px 12px;background:var(--p2);border:1px solid var(--bd);color:var(--tx);border-radius:8px;font-family:inherit;font-size:13px">
    </div>"""
if OLD_LEAD_INTERES in html:
    html = html.replace(OLD_LEAD_INTERES, NEW_LEAD_INTERES)
    changes.append("R1: modal lead manual con selectores marca/auto del inventario")
else:
    print("WARN R1: campo nlInteres no encontrado exacto")

# R1 — JS para cargar inventario en modal nuevo lead
OLD_OPEN_LEAD = """function openNuevoLeadModal(){
  const modal = document.getElementById('nlBg');
  modal.style.display = 'flex';
  document.getElementById('nlNombre').value = '';
  document.getElementById('nlTel').value = '';
  document.getElementById('nlInteres').value = '';
  document.getElementById('nlNota').value = '';
  document.getElementById('nlErr').textContent = '';
  document.getElementById('nlCanal').value = 'WhatsApp';
  // Poblar vendedores
  const sel = document.getElementById('nlAsignado');
  sel.innerHTML = '';
  (S.team||[]).filter(u=>u.role!=='admin'||true).forEach(u=>{
    const o = document.createElement('option');
    o.value = u.username; o.textContent = u.displayName||u.username;
    sel.appendChild(o);
  });
  if(!sel.options.length){ const o=document.createElement('option'); o.value='vendedor1'; o.textContent='vendedor1'; sel.appendChild(o); }
  onNlCanalChange();
}"""
NEW_OPEN_LEAD = """function openNuevoLeadModal(){
  const modal = document.getElementById('nlBg');
  modal.style.display = 'flex';
  document.getElementById('nlNombre').value = '';
  document.getElementById('nlTel').value = '';
  if(document.getElementById('nlInteresExtra'))document.getElementById('nlInteresExtra').value = '';
  document.getElementById('nlNota').value = '';
  document.getElementById('nlErr').textContent = '';
  document.getElementById('nlCanal').value = 'WhatsApp';
  const sel = document.getElementById('nlAsignado');
  sel.innerHTML = '';
  (S.users||[]).filter(u=>u.role==='vendedor').forEach(u=>{
    const o = document.createElement('option');
    o.value = u.username; o.textContent = u.name||u.username;
    sel.appendChild(o);
  });
  if(!sel.options.length){ const o=document.createElement('option'); o.value='daniela'; o.textContent='Daniela Narváez'; sel.appendChild(o); }
  onNlCanalChange();
  cargarInventarioEnModal();
}

async function cargarInventarioEnModal(){
  try{
    const data = await api('GET','/api/inventory/scraper');
    const items = data.structured||[];
    window._nlInventario = items;
    const marcas = [...new Set(items.map(i=>i.brand).filter(Boolean))].sort();
    const selMarca = document.getElementById('nlMarca');
    if(!selMarca)return;
    selMarca.innerHTML = '<option value="">Seleccionar marca...</option>';
    marcas.forEach(m=>{
      const o=document.createElement('option');
      o.value=m; o.textContent=m;
      selMarca.appendChild(o);
    });
  }catch(e){console.error('Error cargando inventario:',e);}
}

function onNlMarcaChange(){
  const marca = document.getElementById('nlMarca')?.value||'';
  const selAuto = document.getElementById('nlInteres');
  if(!selAuto)return;
  selAuto.innerHTML = '<option value="">Seleccionar vehículo...</option>';
  if(!marca)return;
  const items = (window._nlInventario||[]).filter(i=>i.brand===marca);
  items.forEach(i=>{
    const o=document.createElement('option');
    const label = [i.model, i.year, i.km?i.km:'', i.precio_credito?'$'+parseInt(i.precio_credito).toLocaleString('es-CL'):''].filter(Boolean).join(' · ');
    o.value = label;
    o.dataset.link = i.link||'';
    o.dataset.price = i.precio_credito||i.price||0;
    o.dataset.km = i.km||'';
    o.dataset.model = i.model||'';
    o.textContent = label;
    selAuto.appendChild(o);
  });
}"""
if OLD_OPEN_LEAD in html:
    html = html.replace(OLD_OPEN_LEAD, NEW_OPEN_LEAD)
    changes.append("R1: openNuevoLeadModal con inventario dinamico")
else:
    print("WARN R1: openNuevoLeadModal no encontrado exacto")

# R1 — crearLeadManual usa el selector combinado
OLD_CREAR_LEAD = """  const nombre = document.getElementById('nlNombre').value.trim();
  const tel    = document.getElementById('nlTel').value.trim();
  const canal  = document.getElementById('nlCanal').value;
  const asign  = document.getElementById('nlAsignado').value;
  const interes= document.getElementById('nlInteres').value.trim();
  const nota   = document.getElementById('nlNota').value.trim();"""
NEW_CREAR_LEAD = """  const nombre = document.getElementById('nlNombre').value.trim();
  const tel    = document.getElementById('nlTel').value.trim();
  const canal  = document.getElementById('nlCanal').value;
  const asign  = document.getElementById('nlAsignado').value;
  const selAuto= document.getElementById('nlInteres');
  const interesBase = selAuto?.value||'';
  const interesExtra = document.getElementById('nlInteresExtra')?.value?.trim()||'';
  const interes = [interesBase, interesExtra].filter(Boolean).join(' — ');
  const nota   = document.getElementById('nlNota').value.trim();
  // capturar datos del auto seleccionado
  const selOpt = selAuto?.selectedOptions?.[0];
  const autoLink  = selOpt?.dataset?.link||'';
  const autoPrice = selOpt?.dataset?.price||'';
  const autoKm    = selOpt?.dataset?.km||'';"""
if OLD_CREAR_LEAD in html:
    html = html.replace(OLD_CREAR_LEAD, NEW_CREAR_LEAD)
    changes.append("R1: crearLeadManual combina marca+auto+extra")
else:
    print("WARN R1: bloque crearLeadManual variables no encontrado")

# ═══════════════════════════════════════════════════════════════
# R4 — PWA Manifest + ícono RMG en head
# ═══════════════════════════════════════════════════════════════
PWA_HEAD = """<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0f172a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="RMG CRM">
<link rel="apple-touch-icon" href="/icon-192.svg">
<link rel="icon" type="image/svg+xml" href="/icon-192.svg">"""
if 'rel="manifest"' not in html:
    html = html.replace('</head>', PWA_HEAD + '\n</head>', 1)
    changes.append("R4: PWA manifest y meta tags agregados")
else:
    print("INFO R4: manifest ya existia")

# ═══════════════════════════════════════════════════════════════
# R5 — Sonido notificación + badge rojo no leídos por usuario
# ═══════════════════════════════════════════════════════════════
NOTIF_JS = """
// ── R5: Sonido y badge notificaciones por usuario ──────────────
let _lastUnread = 0;
let _audioCtx = null;

function getMyUnreadCount(){
  if(!S.leads||!S.user)return 0;
  return S.leads.filter(l=>{
    if(!l.unread)return false;
    if(S.user.role==='vendedor')return l.assignedTo===S.user.username;
    return true; // admin ve todos
  }).length;
}

function playNotifSound(){
  try{
    if(!_audioCtx)_audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const ctx=_audioCtx;
    // Simula el "ding" de WhatsApp: dos tonos cortos
    const times=[[0,.08,800,.3],[.1,.08,1000,.2]];
    times.forEach(([start,dur,freq,vol])=>{
      const o=ctx.createOscillator();
      const g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.type='sine';o.frequency.value=freq;
      g.gain.setValueAtTime(0,ctx.currentTime+start);
      g.gain.linearRampToValueAtTime(vol,ctx.currentTime+start+0.01);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+start+dur);
      o.start(ctx.currentTime+start);
      o.stop(ctx.currentTime+start+dur+0.05);
    });
  }catch(e){}
}

function updateBadge(count){
  // Actualizar titulo de pestaña
  const base='RMG CRM';
  document.title=count>0?`(${count}) ${base}`:base;
  // Badge en botón de Leads del sidebar
  const leadsBtn=document.querySelector('.sb nav button[data-view="leads"]');
  if(leadsBtn){
    let badge=leadsBtn.querySelector('.notif-badge');
    if(count>0){
      if(!badge){
        badge=document.createElement('span');
        badge.className='notif-badge';
        badge.style.cssText='background:#ef4444;color:#fff;border-radius:50%;font-size:10px;font-weight:700;padding:1px 5px;margin-left:6px;min-width:18px;text-align:center;display:inline-block;line-height:16px';
        leadsBtn.appendChild(badge);
      }
      badge.textContent=count>99?'99+':count;
    }else{
      if(badge)badge.remove();
    }
  }
  // PWA badge API si disponible
  if('setAppBadge' in navigator){
    if(count>0)navigator.setAppBadge(count).catch(()=>{});
    else navigator.clearAppBadge().catch(()=>{});
  }
}

function checkNotifications(){
  const count=getMyUnreadCount();
  if(count>_lastUnread){
    playNotifSound();
  }
  updateBadge(count);
  _lastUnread=count;
}

// Activar sonido con primer click (política de navegadores)
document.addEventListener('click',function initAudio(){
  try{_audioCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}
  document.removeEventListener('click',initAudio);
},{once:true});
// ── fin R5 ────────────────────────────────────────────────────
"""

if 'playNotifSound' not in html:
    html = html.replace('</script>\n<script>\nwindow.saveTiFields', NOTIF_JS + '\n</script>\n<script>\nwindow.saveTiFields')
    changes.append("R5: sonido y badge no leídos por usuario")
else:
    print("INFO R5: notificaciones ya existian")

# R5 — llamar checkNotifications después de cada refresh
OLD_RENDER_ALL = "function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();renderLeads();renderChileautos();renderEsperaGeneral();renderKanban();renderCalendar();if(isA){renderAnalytics();renderTeam();}if(S.mid&&$('mbg').classList.contains('show'))refreshModalSilent();if(S.slaOpen)renderSlaPanel(S.slaOpen);if(S.funOpen)renderFunPanel(S.funOpen);}"
NEW_RENDER_ALL = "function renderAll(){const isA=S.user?.role==='admin';if(isA)renderDash();renderLeads();renderChileautos();renderEsperaGeneral();renderKanban();renderCalendar();if(isA){renderAnalytics();renderTeam();}if(S.mid&&$('mbg').classList.contains('show'))refreshModalSilent();if(S.slaOpen)renderSlaPanel(S.slaOpen);if(S.funOpen)renderFunPanel(S.funOpen);try{checkNotifications();}catch(e){}}"
if OLD_RENDER_ALL in html:
    html = html.replace(OLD_RENDER_ALL, NEW_RENDER_ALL)
    changes.append("R5: checkNotifications llamado en cada render")
else:
    print("WARN R5: renderAll no encontrado exacto")

# ═══════════════════════════════════════════════════════════════
# SERVER.JS — endpoint cambio de clave global
# ═══════════════════════════════════════════════════════════════
OLD_STATIC_SRV = "app.use(express.static(path.join(__dirname,'public')));"
NEW_CLAVE_EP = """
app.put('/api/config/password',auth('admin'),async(req,res)=>{
  const{newPassword}=req.body||{};
  if(!newPassword||newPassword.length<3)return res.status(400).json({error:'Clave muy corta'});
  const users=await tRead(F.users,req.tenant);
  users.forEach(u=>{u.password=newPassword;});
  await tWrite(F.users,req.tenant,users);
  console.log('[CONFIG] Clave actualizada para tenant:',req.tenant);
  res.json({ok:true,updated:users.length});
});
"""
if '/api/config/password' not in srv:
    srv = srv.replace(OLD_STATIC_SRV, NEW_CLAVE_EP + "\n" + OLD_STATIC_SRV)
    changes.append("SERVER: endpoint cambio de clave global")
else:
    print("INFO SERVER: endpoint clave ya existia")

# ── Guardar ───────────────────────────────────────────────────
with open(HTML, "w", encoding="utf-8") as f:
    f.write(html)
with open(SERVER, "w", encoding="utf-8") as f:
    f.write(srv)

print("\n✅ Patch aplicado. Cambios:")
for c in changes:
    print(f"  ✓ {c}")
print(f"\n📁 Backups: {HTML}.bak_rmg | {SERVER}.bak_rmg")

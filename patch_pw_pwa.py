#!/usr/bin/env python3
import os, shutil

HTML = "public/index.html"
if not os.path.exists(HTML):
    print("ERROR: public/index.html no encontrado")
    raise SystemExit(1)

with open(HTML, "r", encoding="utf-8") as f:
    html = f.read()

shutil.copy(HTML, HTML + ".bak_pw")
changes = []

# ═══════════════════════════════════════════════════════════════
# R1 — Tabla de usuarios: mostrar campo Nueva Contraseña visible
# El campo .up actualmente es teléfono. La tabla tiene columnas:
# Usuario | Nombre | Rol | Teléfono | Nueva Pwd | Estado | Acciones
# El problema es que el input de nueva contraseña no tiene clase
# diferenciadora y se renderiza vacío sin placeholder claro.
# ═══════════════════════════════════════════════════════════════
OLD_USER_TABLE_HEADER = """<table class="ut" id="uTbl"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Teléfono</th><th>Nueva Pwd</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="uTbd"></tbody></table>"""
NEW_USER_TABLE_HEADER = """<table class="ut" id="uTbl"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Teléfono WhatsApp</th><th>Nueva Contraseña</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="uTbd"></tbody></table>"""
if OLD_USER_TABLE_HEADER in html:
    html = html.replace(OLD_USER_TABLE_HEADER, NEW_USER_TABLE_HEADER)
    changes.append("R1a: header tabla usuarios actualizado")

# El renderUserTable genera las filas — el campo de nueva pwd
# debe ser type=password con placeholder y botón de toggle
OLD_RENDER_USER = """function renderUserTable(users){const tbody=$('uTbd');tbody.innerHTML=users.map(u=>`<tr data-un="${esc(u.username)}"><td><strong>${esc(u.username)}</strong></td><td><input class="un" value="${esc(u.name)}"></td><td><select class="ur"><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option><option value="vendedor" ${u.role==='vendedor'?'selected':''}>Vendedor</option><option value="secretaria" ${u.role==='secretaria'?'selected':''}>Secretaria</option></select></td><td><input class="up" value="${esc(u.phone||'')}"></td><td><select class="us"><option value="Activo" ${(u.status||'Activo')==='Activo'?'selected':''}>Activo</option><option value="Inactivo" ${u.status==='Inactivo'?'selected':''}>Inactivo</option></select></td><td style="display:flex;gap:6px"><button class="bp usv" style="padding:6px 10px;font-size:12px">Guardar</button>${u.role!=='admin'?`<button class="bdn udl">Eliminar</button>`:''}</td></tr>`).join('');"""
NEW_RENDER_USER = """function renderUserTable(users){const tbody=$('uTbd');tbody.innerHTML=users.map(u=>`<tr data-un="${esc(u.username)}">
  <td><strong>${esc(u.username)}</strong><div style="font-size:10px;color:var(--tm);margin-top:2px">${u.role==='admin'?'👔 Gerencia':u.role==='vendedor'?'💼 Vendedor':'📋 Secretaria'}</div></td>
  <td><input class="un" value="${esc(u.name)}" placeholder="Nombre completo"></td>
  <td><select class="ur"><option value="admin" ${u.role==='admin'?'selected':''}>Admin / Gerencia</option><option value="vendedor" ${u.role==='vendedor'?'selected':''}>Vendedor</option><option value="secretaria" ${u.role==='secretaria'?'selected':''}>Secretaria</option></select></td>
  <td><input class="up" value="${esc(u.phone||'')}" placeholder="+56912345678"></td>
  <td>
    <div style="display:flex;gap:4px;align-items:center">
      <input class="upw" type="password" placeholder="Nueva clave..." style="width:110px;padding:6px 8px;background:var(--p3);border:1px solid var(--bd);color:var(--tx);border-radius:6px;font-size:12px;font-family:inherit">
      <button type="button" onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password'" style="background:var(--p2);border:1px solid var(--bd);color:var(--tm);padding:5px 7px;border-radius:6px;cursor:pointer;font-size:11px">👁</button>
    </div>
  </td>
  <td><select class="us"><option value="Activo" ${(u.status||'Activo')==='Activo'?'selected':''}>Activo</option><option value="Inactivo" ${u.status==='Inactivo'?'selected':''}>Inactivo</option></select></td>
  <td style="display:flex;gap:6px;flex-wrap:wrap">
    <button class="bp usv" style="padding:6px 10px;font-size:12px">Guardar</button>
    ${u.role!=='admin'?`<button class="bdn udl">Eliminar</button>`:''}
  </td>
</tr>`).join('');"""
if OLD_RENDER_USER in html:
    html = html.replace(OLD_RENDER_USER, NEW_RENDER_USER)
    changes.append("R1b: tabla usuarios con campo contraseña visible por fila")
else:
    print("WARN R1b: renderUserTable no encontrado exacto")

# Actualizar el handler de guardar usuario para incluir la nueva pwd
OLD_USV_HANDLER = """row.querySelector('.usv').addEventListener('click',async()=>{const btn=row.querySelector('.usv');btn.disabled=true;btn.textContent='…';try{await api('PUT','/api/users/'+encodeURIComponent(un),{name:row.querySelector('.un').value.trim(),role:row.querySelector('.ur').value,phone:row.querySelector('.up').value.trim(),status:row.querySelector('.us').value});toast(un+' actualizado ✓');await loadUsers();}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent='Guardar';}});"""
NEW_USV_HANDLER = """row.querySelector('.usv').addEventListener('click',async()=>{const btn=row.querySelector('.usv');btn.disabled=true;btn.textContent='…';try{const payload={name:row.querySelector('.un').value.trim(),role:row.querySelector('.ur').value,phone:row.querySelector('.up').value.trim(),status:row.querySelector('.us').value};const pwField=row.querySelector('.upw');if(pwField&&pwField.value.trim()){payload.password=pwField.value.trim();}await api('PUT','/api/users/'+encodeURIComponent(un),payload);if(pwField)pwField.value='';toast(un+' actualizado ✓');await loadUsers();}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent='Guardar';}});"""
if OLD_USV_HANDLER in html:
    html = html.replace(OLD_USV_HANDLER, NEW_USV_HANDLER)
    changes.append("R1c: handler guardar usuario incluye nueva contraseña")
else:
    print("WARN R1c: handler usv no encontrado exacto")

# ═══════════════════════════════════════════════════════════════
# R2 — Registrar Service Worker para PWA en iOS y Android
# ═══════════════════════════════════════════════════════════════
SW_REGISTER = """
<script>
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js')
      .then(r=>console.log('[SW] Registrado:',r.scope))
      .catch(e=>console.log('[SW] Error:',e));
  });
}
// Prompt de instalación para Android Chrome
let _deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _deferredPrompt=e;
  const btn=document.getElementById('btnInstallApp');
  if(btn)btn.style.display='flex';
});
window.addEventListener('appinstalled',()=>{
  _deferredPrompt=null;
  const btn=document.getElementById('btnInstallApp');
  if(btn)btn.style.display='none';
  console.log('[PWA] App instalada');
});
</script>"""

if 'serviceWorker' not in html:
    html = html.replace('</body>', SW_REGISTER + '\n</body>')
    changes.append("R2: Service Worker registrado para iOS/Android PWA")
else:
    print("INFO R2: serviceWorker ya registrado")

# Botón instalar app en sidebar
OLD_SIDEBAR_LOUT = """<button class="lout" id="loutB">Cerrar sesión</button>"""
NEW_SIDEBAR_LOUT = """<button id="btnInstallApp" onclick="installApp()" style="display:none;margin-top:8px;background:linear-gradient(135deg,#D4A843,#F2C955);color:#0f172a;border:none;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;align-items:center;gap:6px;letter-spacing:.04em">📲 Instalar App</button>
<button class="lout" id="loutB">Cerrar sesión</button>"""
if OLD_SIDEBAR_LOUT in html:
    html = html.replace(OLD_SIDEBAR_LOUT, NEW_SIDEBAR_LOUT)
    changes.append("R2: botón instalar app en sidebar")
else:
    print("WARN R2: botón logout no encontrado exacto")

# JS installApp
INSTALL_JS = """
function installApp(){
  if(_deferredPrompt){
    _deferredPrompt.prompt();
    _deferredPrompt.userChoice.then(r=>{
      if(r.outcome==='accepted'){
        const btn=document.getElementById('btnInstallApp');
        if(btn)btn.style.display='none';
      }
      _deferredPrompt=null;
    });
  }
}
"""
if 'function installApp' not in html:
    html = html.replace('</script>\n<script>\nwindow.saveTiFields', INSTALL_JS + '\n</script>\n<script>\nwindow.saveTiFields')
    changes.append("R2: función installApp agregada")

with open(HTML, "w", encoding="utf-8") as f:
    f.write(html)

print("\n✅ Patch aplicado:")
for c in changes:
    print(f"  ✓ {c}")
print(f"\n📁 Backup: {HTML}.bak_pw")

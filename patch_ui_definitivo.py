import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    src = f.read()

FUNCS = """
async function saveTiFields(leadId) {
  const make = (document.getElementById('ti-make')||{}).value||'';
  const model = (document.getElementById('ti-model')||{}).value||'';
  const year = (document.getElementById('ti-year')||{}).value||'';
  const color = (document.getElementById('ti-color')||{}).value||'';
  await fetch('/api/leads/'+leadId+'/tradein', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({make,model,year,color}) });
  showToast('Datos guardados ✅');
}
async function solicitarTasacion(leadId) {
  const r = await fetch('/api/tasacion/request', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({leadId}) });
  const d = await r.json();
  showToast(d.ok ? `Tasación solicitada a taller 🔧` : 'Error: '+d.error);
}
async function registrarOferta(leadId) {
  const offerAmount = parseFloat((document.getElementById('offerInput')||{}).value||'0');
  if (!offerAmount) return showToast('Ingresa un monto válido');
  const r = await fetch('/api/tasacion/offer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({leadId, offerAmount}) });
  if ((await r.json()).ok) { showToast('Oferta registrada ✅'); renderModal(leadId); }
}
"""

UI = """
(function injectTradeInSection() {
  const currentLead = typeof l !== 'undefined' ? l : (typeof S !== 'undefined' && S.leads ? S.leads.find(x => x.id == (typeof id !== 'undefined'?id:null)) : null);
  if (!currentLead) return;
  const ti = currentLead.tradeIn || {};
  const isAdmin = S && S.user && S.user.role === 'admin';
  const html = `<div style="margin-top:18px;border:1px solid #334155;border-radius:10px;padding:14px;background:#0f172a;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:18px;">🔄</span><strong style="color:#e2e8f0;font-size:14px;">Detalles de Retoma</strong><span style="margin-left:auto;font-size:11px;background:#f59e0b22;color:#f59e0b;padding:2px 8px;border-radius:20px;">${ti.status||'Pendiente'}</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;"><label style="color:#94a3b8;font-size:12px;">Marca<br><input id="ti-make" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.make||''}"></label><label style="color:#94a3b8;font-size:12px;">Modelo<br><input id="ti-model" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.model||''}"></label><label style="color:#94a3b8;font-size:12px;">Año<br><input id="ti-year" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.year||''}"></label><label style="color:#94a3b8;font-size:12px;">Color<br><input id="ti-color" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.color||''}"></label></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button onclick="saveTiFields('${currentLead.id}')" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">💾 Guardar</button><button onclick="solicitarTasacion('${currentLead.id}')" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">🔧 Solicitar Tasación a Taller</button></div>` + (isAdmin ? `<div style="margin-top:10px;border-top:1px solid #1e293b;padding-top:10px;"><span style="color:#94a3b8;font-size:12px;margin-right:8px;">Oferta ($)</span><input type="number" id="offerInput" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 10px;font-size:13px;width:120px;margin-right:8px;"><button onclick="registrarOferta('${currentLead.id}')" style="background:#22c55e;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">✅ Registrar Oferta</button></div>` : '') + `</div>`;
  const anchor = document.querySelector('.modal-body');
  if (anchor) { 
    const div = document.createElement('div'); 
    div.innerHTML = html; 
    anchor.appendChild(div.firstElementChild); 
  }
})();
"""

if "solicitarTasacion" not in src:
    src += "\n<script>\n" + FUNCS + "\n</script>\n"

match = re.search(r'(function\s+renderModal\s*\([^)]*\)\s*\{)', src)
if match and "injectTradeInSection" not in src:
    start = match.end()
    d = 1
    i = start
    while i < len(src) and d > 0:
        if src[i] == '{': d += 1
        elif src[i] == '}': d -= 1
        i += 1
    src = src[:i-1] + UI + src[i-1:]

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(src)
print("✅ Interfaz de Retoma inyectada con seguridad absoluta.")

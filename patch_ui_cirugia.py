import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Limpiamos las inyecciones de fuerza bruta anteriores (para no dejar basura)
src = re.sub(r'<script>\s*// --- MOTOR DE TASACION INFALIBLE ---.*?</script>', '', src, flags=re.DOTALL)
src = re.sub(r'<script>\s*async function saveTiFields\(leadId\).*?</script>', '', src, flags=re.DOTALL)

# 2. Inyectamos la UI de Retoma directamente dentro del string de renderModal() de forma segura
TRADEIN_JS = """
    // ── SPRINT 4: UI de Tasación (Inyectada de forma segura) ─────────────────
    (function renderTradeIn() {
      const modalContenedor = document.querySelector('.ca2'); // Esta es la columna derecha real de tu modal
      if (!modalContenedor || document.getElementById('tradein-section')) return;
      
      const lead = S.leads.find(x => x.id === S.mid);
      if (!lead) return;
      const ti = lead.tradeIn || {};
      const isAdmin = S.user && S.user.role === 'admin';
      const statusColor = ti.status === 'Evaluado' ? '#059669' : '#d97706';
      
      const html = `
        <div id="tradein-section" style="margin-bottom:12px; border:1px solid var(--bd); border-radius:8px; padding:12px; background:var(--p2);">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <h4 style="margin:0; font-size:11px; color:var(--tm); text-transform:uppercase;">🚗 Detalles de Retoma</h4>
            <span style="font-size:10px; background:${statusColor}22; color:${statusColor}; padding:2px 6px; border-radius:4px; font-weight:bold;">${ti.status||'Pendiente'}</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px;">
            <input id="ti-make" placeholder="Marca (Toyota)" value="${ti.make||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-model" placeholder="Modelo (Yaris)" value="${ti.model||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-year" placeholder="Año (2019)" value="${ti.year||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <input id="ti-color" placeholder="Color (Blanco)" value="${ti.color||''}" style="width:100%; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
          </div>
          <div style="display:flex; gap:6px;">
            <button onclick="saveTiFields('${lead.id}')" style="flex:1; background:var(--ac); color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">💾 Guardar</button>
            <button onclick="solicitarTasacion('${lead.id}')" style="flex:1.5; background:#8b5cf6; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">🔧 Solicitar Tasación</button>
          </div>
          ${isAdmin ? `
          <div style="margin-top:10px; border-top:1px solid var(--bd); padding-top:10px; display:flex; gap:6px; align-items:center;">
            <input type="number" id="offerInput" placeholder="Monto oferta ($)" style="flex:1; padding:6px; background:var(--p3); border:1px solid var(--bd); border-radius:4px; font-size:11.5px; color:var(--tx);">
            <button onclick="registrarOferta('${lead.id}')" style="background:var(--ok); color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">✅ Confirmar</button>
          </div>` : ''}
        </div>
      `;
      
      // Inyectarlo justo encima del botón de "Guardar cambios"
      modalContenedor.insertAdjacentHTML('afterbegin', html);
    })();
    // ──────────────────────────────────────────────────────────────────────────
"""

# Inyectamos el JS visual dentro de renderModal
if "renderTradeIn" not in src:
    # Buscar el final de renderModal() y meterlo antes del cierre
    pattern = re.compile(r'(function\s+renderModal\(\)\{.*?)(\n\})', re.DOTALL)
    src = pattern.sub(r'\1\n' + TRADEIN_JS + r'\2', src)

# 3. Inyectamos las funciones lógicas de forma segura
FUNCS = """
<script>
window.saveTiFields = async function(leadId) {
  const make = (document.getElementById('ti-make')||{}).value||'';
  const model = (document.getElementById('ti-model')||{}).value||'';
  const year = (document.getElementById('ti-year')||{}).value||'';
  const color = (document.getElementById('ti-color')||{}).value||'';
  await fetch('/api/leads/'+leadId+'/tradein', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({make,model,year,color}) });
  toast('Datos de retoma guardados ✓');
};
window.solicitarTasacion = async function(leadId) {
  const r = await fetch('/api/tasacion/request', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({leadId}) });
  toast(r.ok ? 'Tasación solicitada a taller 🔧' : 'Error al solicitar');
};
window.registrarOferta = async function(leadId) {
  const offerAmount = parseFloat((document.getElementById('offerInput')||{}).value||'0');
  if (!offerAmount) return toast('Ingresa un monto válido', true);
  const r = await fetch('/api/tasacion/offer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({leadId, offerAmount}) });
  if (r.ok) { toast('Oferta registrada ✓ Vendedor notificado'); closeModal(); refresh(); }
};
</script>
"""

if "window.solicitarTasacion" not in src:
    src = src.replace('</body>', FUNCS + '\n</body>')

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(src)
print("✅ Cirugía completada. El panel de retoma ahora usa las clases correctas del CRM.")

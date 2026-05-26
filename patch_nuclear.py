import sys

with open('public/index.html', 'r', encoding='utf-8') as f:
    src = f.read()

if "tradein-section" not in src:
    js = """
    <script>
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
      showToast(d.ok ? 'Tasación solicitada a taller 🔧' : 'Error: '+d.error);
    }
    async function registrarOferta(leadId) {
      const offerAmount = parseFloat((document.getElementById('offerInput')||{}).value||'0');
      if (!offerAmount) return showToast('Ingresa un monto válido');
      const r = await fetch('/api/tasacion/offer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({leadId, offerAmount}) });
      if ((await r.json()).ok) { showToast('Oferta registrada ✅'); renderModal(leadId); }
    }

    // Interceptar renderModal para inyectar la UI sin romper el HTML original
    setTimeout(() => {
      if (typeof renderModal === 'function' && !window._patchedModal) {
        window._patchedModal = true;
        const originalRender = renderModal;
        window.renderModal = async function(id) {
          const res = await originalRender(id);
          setTimeout(() => {
            const lead = S.leads.find(x => x.id == id);
            if (!lead || document.getElementById('tradein-section')) return;
            const ti = lead.tradeIn || {};
            const isAdmin = S.user && S.user.role === 'admin';
            const html = `<div id="tradein-section" style="margin-top:18px;border:1px solid #334155;border-radius:10px;padding:14px;background:#0f172a;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:18px;">🔄</span><strong style="color:#e2e8f0;font-size:14px;">Detalles de Retoma</strong><span style="margin-left:auto;font-size:11px;background:#f59e0b22;color:#f59e0b;padding:2px 8px;border-radius:20px;">${ti.status||'Pendiente'}</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;"><label style="color:#94a3b8;font-size:12px;">Marca<br><input id="ti-make" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.make||''}"></label><label style="color:#94a3b8;font-size:12px;">Modelo<br><input id="ti-model" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.model||''}"></label><label style="color:#94a3b8;font-size:12px;">Año<br><input id="ti-year" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.year||''}"></label><label style="color:#94a3b8;font-size:12px;">Color<br><input id="ti-color" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.color||''}"></label></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button onclick="saveTiFields('${lead.id}')" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">💾 Guardar</button><button onclick="solicitarTasacion('${lead.id}')" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">🔧 Solicitar Tasación a Taller</button></div>` + (isAdmin ? `<div style="margin-top:10px;border-top:1px solid #1e293b;padding-top:10px;"><span style="color:#94a3b8;font-size:12px;margin-right:8px;">Oferta ($)</span><input type="number" id="offerInput" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 10px;font-size:13px;width:120px;margin-right:8px;"><button onclick="registrarOferta('${lead.id}')" style="background:#22c55e;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">✅ Registrar Oferta</button></div>` : '') + `</div>`;
            const anchor = document.querySelector('.modal-body') || document.querySelector('.modal-content') || document.getElementById('modal-notes')?.parentNode;
            if(anchor) anchor.insertAdjacentHTML('beforeend', html);
          }, 300); // Darle tiempo a la UI original a cargar
          return res;
        };
      }
    }, 1000);
    </script>
    """
    src = src.replace('</body>', js + '\n</body>') if '</body>' in src else src + js
    with open('public/index.html', 'w', encoding='utf-8') as f:
        f.write(src)
    print("✅ Parche inyectado (Modo Ninja).")
else:
    print("⚠️ El parche ya estaba aplicado.")

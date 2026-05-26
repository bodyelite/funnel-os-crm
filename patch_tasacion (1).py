#!/usr/bin/env python3
import re
import subprocess
import sys
import os

SERVER_PATH = "server.js"
FRONTEND_PATH = "public/index.html"

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def validate_node(path):
    result = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"❌ node --check {path} FALLÓ:\n{result.stderr}")
        sys.exit(1)
    print(f"✅ node --check {path} OK")

# ─────────────────────────────────────────────
# PATCH 1: STAFF_TASACION constant in server.js
# ─────────────────────────────────────────────
def patch_staff_const(src):
    # Only inject if not already present
    if "STAFF_TASACION" in src:
        print("⚠️  STAFF_TASACION ya existe — omitiendo.")
        return src

    # Inject after the last top-level `const` declaration block near the top
    # We look for the first `const` that lives outside functions (module-level)
    # Strategy: find "const sendWA" or any recognisable module-level const
    pattern = re.compile(
        r'(const\s+sendWA\s*=)',
        re.DOTALL
    )
    match = pattern.search(src)
    if not match:
        # Fallback: inject after first module-level 'const ' line
        pattern = re.compile(r'(^const\s+\w+\s*=)', re.MULTILINE)
        match = pattern.search(src)
    if not match:
        print("❌ No se encontró punto de anclaje para STAFF_TASACION.")
        sys.exit(1)

    staff_block = (
        "const STAFF_TASACION = [\n"
        "  {name:'Valentina',   phone:'56955145504'},\n"
        "  {name:'Recepcion',   phone:'56983300262'},\n"
        "  {name:'Juan Carlos', phone:'56937648536'}\n"
        "];\n\n"
    )
    insert_pos = match.start()
    src = src[:insert_pos] + staff_block + src[insert_pos:]
    print("✅ STAFF_TASACION inyectado.")
    return src

# ─────────────────────────────────────────────
# PATCH 2: POST /api/tasacion/request endpoint
# ─────────────────────────────────────────────
ENDPOINT_REQUEST = """
// ── SPRINT 4: Tasación Request ──────────────────────────────────────────────
app.post('/api/tasacion/request', async (req, res) => {
  try {
    const { leadId, tenant = 'default' } = req.body;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    const ti = lead.tradeIn || {};
    const texto = `📋 SOLICITUD DE TASACIÓN:\\nLead: ${lead.name}\\n` +
      `Vehículo en retoma: ${ti.make || '?'} ${ti.model || '?'} ${ti.year || '?'}\\n` +
      `Color: ${ti.color || '?'}\\nPor favor evaluar y registrar oferta en el CRM.`;

    for (const staff of STAFF_TASACION) {
      await sendWA(staff.phone, texto);
    }
    res.json({ ok: true, notified: STAFF_TASACION.length });
  } catch (err) {
    console.error('/api/tasacion/request error:', err);
    res.status(500).json({ error: err.message });
  }
});

"""

ENDPOINT_OFFER = """
// ── SPRINT 4: Tasación Offer ─────────────────────────────────────────────────
app.post('/api/tasacion/offer', async (req, res) => {
  try {
    const { leadId, offerAmount, tenant = 'default' } = req.body;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    if (!lead.tradeIn) lead.tradeIn = { make:'', model:'', year:'', color:'', status:'Pendiente', offer:0 };
    lead.tradeIn.offer = Number(offerAmount);
    lead.tradeIn.status = 'Evaluado';

    await tWrite(F.leads, tenant, leads);

    const fmt = new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(lead.tradeIn.offer);
    if (lead.assignedTo) {
      const users = await tRead(F.users, tenant, []);
      const vendedor = users.find(u => u.name === lead.assignedTo || u.id === lead.assignedTo);
      if (vendedor && vendedor.phone) {
        const msg = `✅ TASACIÓN LISTA\\nLead: ${lead.name}\\n` +
          `Retoma: ${lead.tradeIn.make} ${lead.tradeIn.model} ${lead.tradeIn.year}\\n` +
          `Oferta taller: ${fmt}\\nYa puedes cerrar la venta.`;
        await sendWA(vendedor.phone, msg);
      }
    }
    res.json({ ok: true, offer: lead.tradeIn.offer, status: lead.tradeIn.status });
  } catch (err) {
    console.error('/api/tasacion/offer error:', err);
    res.status(500).json({ error: err.message });
  }
});

"""

def patch_endpoints(src):
    if "/api/tasacion/request" in src:
        print("⚠️  Endpoint tasacion/request ya existe — omitiendo.")
    else:
        # Inject before app.listen or before the last app.get/app.post block
        pattern = re.compile(r'(app\.listen\s*\()', re.DOTALL)
        match = pattern.search(src)
        if not match:
            print("❌ No se encontró app.listen para inyectar endpoints de tasación.")
            sys.exit(1)
        insert_pos = match.start()
        src = src[:insert_pos] + ENDPOINT_REQUEST + src[insert_pos:]
        print("✅ Endpoint /api/tasacion/request inyectado.")

    if "/api/tasacion/offer" in src:
        print("⚠️  Endpoint tasacion/offer ya existe — omitiendo.")
    else:
        pattern = re.compile(r'(app\.listen\s*\()', re.DOTALL)
        match = pattern.search(src)
        if not match:
            print("❌ No se encontró app.listen para inyectar endpoint offer.")
            sys.exit(1)
        insert_pos = match.start()
        src = src[:insert_pos] + ENDPOINT_OFFER + src[insert_pos:]
        print("✅ Endpoint /api/tasacion/offer inyectado.")

    return src

# ─────────────────────────────────────────────
# PATCH 4: Frontend renderModal — tradeIn UI
# ─────────────────────────────────────────────
TRADEIN_UI = """
    // ── SPRINT 4: Sección Retoma / Tasación ──────────────────────────────────
    (function injectTradeInSection() {
      const ti = lead.tradeIn || {};
      const isAdmin = S.user && S.user.role === 'admin';
      const statusColor = ti.status === 'Evaluado' ? '#22c55e' : '#f59e0b';
      const offerFmt = ti.offer
        ? new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(ti.offer)
        : '—';

      const html = `
        <div id="tradein-section" style="margin-top:18px;border:1px solid #334155;border-radius:10px;padding:14px;background:#0f172a;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-size:18px;">🔄</span>
            <strong style="color:#e2e8f0;font-size:14px;">Detalles de Retoma</strong>
            <span style="margin-left:auto;font-size:11px;color:${statusColor};background:${statusColor}22;padding:2px 8px;border-radius:20px;">${ti.status || 'Pendiente'}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <label style="color:#94a3b8;font-size:12px;">Marca<br>
              <input id="ti-make" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.make||''}">
            </label>
            <label style="color:#94a3b8;font-size:12px;">Modelo<br>
              <input id="ti-model" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.model||''}">
            </label>
            <label style="color:#94a3b8;font-size:12px;">Año<br>
              <input id="ti-year" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.year||''}">
            </label>
            <label style="color:#94a3b8;font-size:12px;">Color<br>
              <input id="ti-color" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;" value="${ti.color||''}">
            </label>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button onclick="saveTiFields('${lead.id}')" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">💾 Guardar Datos</button>
            <button onclick="solicitarTasacion('${lead.id}')" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">🔧 Solicitar Tasación a Taller</button>
            ${isAdmin ? `
            <span style="color:#64748b;font-size:11px;margin-left:4px;">Oferta actual: <strong style="color:#22c55e;">${offerFmt}</strong></span>
            ` : ''}
          </div>
          ${isAdmin ? `
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #1e293b;padding-top:10px;">
            <span style="color:#94a3b8;font-size:12px;">Registrar Oferta Taller ($)</span>
            <input type="number" id="offerInput" placeholder="ej: 4500000" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 10px;font-size:13px;width:160px;">
            <button onclick="registrarOferta('${lead.id}')" style="background:#22c55e;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">✅ Registrar Oferta ($)</button>
          </div>
          ` : ''}
        </div>
      `;

      // Inject into modal — find the notes or actions section as anchor
      const anchor = document.getElementById('modal-notes') || document.getElementById('modal-actions') || document.querySelector('.modal-body');
      if (anchor) {
        const div = document.createElement('div');
        div.innerHTML = html;
        anchor.parentNode && anchor.parentNode.insertBefore(div.firstElementChild, anchor.nextSibling);
      }
    })();
    // ── Fin Sprint 4 tradeIn UI ───────────────────────────────────────────────
"""

TRADEIN_FUNCTIONS = """
// ── SPRINT 4: Helpers tasación ────────────────────────────────────────────────
async function saveTiFields(leadId) {
  const make  = (document.getElementById('ti-make')  || {}).value || '';
  const model = (document.getElementById('ti-model') || {}).value || '';
  const year  = (document.getElementById('ti-year')  || {}).value || '';
  const color = (document.getElementById('ti-color') || {}).value || '';
  await fetch('/api/leads/' + leadId + '/tradein', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ make, model, year, color })
  });
  showToast('Datos de retoma guardados ✅');
}

async function solicitarTasacion(leadId) {
  const r = await fetch('/api/tasacion/request', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ leadId })
  });
  const d = await r.json();
  showToast(d.ok ? `Tasación solicitada a ${d.notified} técnicos 🔧` : 'Error: ' + d.error);
}

async function registrarOferta(leadId) {
  const offerAmount = parseFloat((document.getElementById('offerInput') || {}).value || '0');
  if (!offerAmount || offerAmount <= 0) { showToast('Ingresa un monto válido'); return; }
  const r = await fetch('/api/tasacion/offer', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ leadId, offerAmount })
  });
  const d = await r.json();
  if (d.ok) {
    showToast('Oferta registrada ✅ Vendedor notificado por WhatsApp');
    renderModal(leadId);
  } else {
    showToast('Error: ' + d.error);
  }
}
// ── Fin helpers tasación ──────────────────────────────────────────────────────
"""

def patch_frontend(src):
    # Inject tradeIn UI call inside renderModal function body
    if "injectTradeInSection" in src:
        print("⚠️  tradeIn UI ya existe en frontend — omitiendo UI.")
    else:
        # Find renderModal function and locate its closing area
        # We look for the end of renderModal or a known anchor inside it
        pattern = re.compile(
            r'(function\s+renderModal\s*\([^)]*\)\s*\{)',
            re.DOTALL
        )
        match = pattern.search(src)
        if not match:
            # Try arrow function or async variant
            pattern = re.compile(
                r'((?:async\s+)?(?:function\s+renderModal|renderModal\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)\s*\{)',
                re.DOTALL
            )
            match = pattern.search(src)

        if not match:
            print("❌ No se encontró renderModal en el frontend.")
            sys.exit(1)

        # Find the closing brace of renderModal by brace counting
        start = match.end()
        depth = 1
        i = start
        while i < len(src) and depth > 0:
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
            i += 1
        # i is now just after the closing brace of renderModal
        closing_brace_pos = i - 1  # position of '}'

        # Inject TRADEIN_UI just before the closing brace
        src = src[:closing_brace_pos] + TRADEIN_UI + "\n" + src[closing_brace_pos:]
        print("✅ tradeIn UI inyectado en renderModal.")

    # Inject helper functions before </script> or end of script block
    if "solicitarTasacion" in src:
        print("⚠️  Helpers tasación ya existen — omitiendo.")
    else:
        # Find last </script> tag
        pattern = re.compile(r'(</script\s*>)', re.IGNORECASE)
        matches = list(pattern.finditer(src))
        if not matches:
            print("❌ No se encontró </script> en el frontend.")
            sys.exit(1)
        last_script = matches[-1]
        insert_pos = last_script.start()
        src = src[:insert_pos] + TRADEIN_FUNCTIONS + "\n" + src[insert_pos:]
        print("✅ Funciones solicitarTasacion / registrarOferta inyectadas.")

    return src

# ─────────────────────────────────────────────
# PATCH 5: PATCH endpoint /api/leads/:id/tradein
# ─────────────────────────────────────────────
ENDPOINT_TRADEIN_PATCH = """
// ── SPRINT 4: PATCH tradeIn fields ──────────────────────────────────────────
app.patch('/api/leads/:id/tradein', async (req, res) => {
  try {
    const { tenant = 'default' } = req.query;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    if (!lead.tradeIn) lead.tradeIn = { make:'', model:'', year:'', color:'', status:'Pendiente', offer:0 };
    const { make, model, year, color } = req.body;
    if (make  !== undefined) lead.tradeIn.make  = make;
    if (model !== undefined) lead.tradeIn.model = model;
    if (year  !== undefined) lead.tradeIn.year  = year;
    if (color !== undefined) lead.tradeIn.color = color;

    await tWrite(F.leads, tenant, leads);
    res.json({ ok: true, tradeIn: lead.tradeIn });
  } catch (err) {
    console.error('/api/leads/:id/tradein PATCH error:', err);
    res.status(500).json({ error: err.message });
  }
});

"""

def patch_tradein_patch_endpoint(src):
    if "/api/leads/:id/tradein" in src:
        print("⚠️  Endpoint PATCH tradein ya existe — omitiendo.")
        return src

    pattern = re.compile(r'(app\.listen\s*\()', re.DOTALL)
    match = pattern.search(src)
    if not match:
        print("❌ No se encontró app.listen para inyectar PATCH tradein.")
        sys.exit(1)
    insert_pos = match.start()
    src = src[:insert_pos] + ENDPOINT_TRADEIN_PATCH + src[insert_pos:]
    print("✅ Endpoint PATCH /api/leads/:id/tradein inyectado.")
    return src

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    for path in [SERVER_PATH, FRONTEND_PATH]:
        if not os.path.exists(path):
            print(f"❌ Archivo no encontrado: {path}")
            sys.exit(1)

    print("\n=== PATCH server.js ===")
    srv = read(SERVER_PATH)
    srv = patch_staff_const(srv)
    srv = patch_endpoints(srv)
    srv = patch_tradein_patch_endpoint(srv)
    write(SERVER_PATH, srv)
    validate_node(SERVER_PATH)

    print("\n=== PATCH public/index.html ===")
    html = read(FRONTEND_PATH)
    html = patch_frontend(html)
    write(FRONTEND_PATH, html)
    print("✅ Frontend actualizado.")

    print("\n✅ SPRINT 4 — Motor de Tasación aplicado correctamente.\n")

if __name__ == "__main__":
    main()

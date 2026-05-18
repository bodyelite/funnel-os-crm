# ══════════════════════════════════════════════════════════════
# fix_final.py — 3 parches quirúrgicos, sin tocar layout
# ══════════════════════════════════════════════════════════════

# ── PATCH 1: server.js — prompt más imperativo para resumen ──
with open('server.js', 'r', encoding='utf-8') as f:
    sv = f.read()

OLD_PROMPT = (
    'RESPONDE SOLO JSON (sin markdown):\n'
    '{"reply":"<texto con emojis>","intent_signal":"NONE"|"BLUE"|"YELLOW",'
    '"intent_reason":"<nota>","schedule_detected":true|false,'
    '"schedule_text":"<hora si aplica>",'
    '"resumen_ejecutivo":"<max 3 líneas: qué busca el cliente, por dónde llegó, dudas principales>"}`;'
    '\n}'
)
NEW_PROMPT = (
    'REGLA ABSOLUTA DE FORMATO — NUNCA la omitas:\n'
    'Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin texto extra).\n'
    'El campo "resumen_ejecutivo" es OBLIGATORIO en cada respuesta. '
    'Si no tienes suficiente contexto todavía, escribe lo que puedas inferir.\n'
    'RESPONDE SOLO JSON (sin markdown):\n'
    '{"reply":"<texto con emojis>","intent_signal":"NONE"|"BLUE"|"YELLOW",'
    '"intent_reason":"<nota>","schedule_detected":true|false,'
    '"schedule_text":"<hora si aplica>",'
    '"resumen_ejecutivo":"<OBLIGATORIO: 1) qué busca el cliente 2) por dónde llegó / canal 3) dudas o frenos de compra detectados y próxima acción sugerida>"}`;'
    '\n}'
)
assert OLD_PROMPT in sv, "FALLO P1: bloque prompt no encontrado en server.js"
sv = sv.replace(OLD_PROMPT, NEW_PROMPT, 1)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(sv)
print("✅ PATCH 1 OK — server.js: prompt resumen_ejecutivo reforzado")


# ── PATCH 2 + 3: index.html — paleta y renderModalCtx ───────
with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ── PATCH 2: :root — paleta gris elegante con contraste real ─
OLD_ROOT = (
    ':root{--bg:#f1f5f9;--p:#ffffff;--p2:#f8fafc;--p3:#e2e8f0;'
    '--ac:#2563eb;--adk:#1d4ed8;--as:rgba(37,99,235,.10);'
    '--bd:rgba(0,0,0,.09);--bdm:rgba(0,0,0,.15);'
    '--tx:#1e293b;--ts:#334155;--tm:#64748b;'
    '--ok:#059669;--wn:#d97706;--bd2:#dc2626;'
    '--oks:rgba(5,150,105,.10);--wns:rgba(217,119,6,.10);--bds:rgba(220,38,38,.10);'
    '--sb:#2563eb;--sy:#d97706;--sbs:rgba(37,99,235,.12);--sys:rgba(217,119,6,.12);'
    '--ag:#dcfce7;--agt:#14532d;--r:10px;--tr:.13s ease}'
)
NEW_ROOT = (
    # --bg: gris suave perla, --p: blanco puro para paneles,
    # --p2: gris visible para filas alternas/inputs,
    # --p3: gris medio para campos de formulario,
    # sombra en paneles aportada vía --bdm más opaco
    ':root{--bg:#eef2f7;--p:#ffffff;--p2:#f1f5f9;--p3:#dde3ec;'
    '--ac:#0284c7;--adk:#0369a1;--as:rgba(2,132,199,.12);'
    '--bd:rgba(15,23,42,.11);--bdm:rgba(15,23,42,.18);'
    '--tx:#1a202c;--ts:#334155;--tm:#5a6a85;'
    '--ok:#059669;--wn:#b45309;--bd2:#dc2626;'
    '--oks:rgba(5,150,105,.13);--wns:rgba(180,83,9,.13);--bds:rgba(220,38,38,.13);'
    '--sb:#0284c7;--sy:#b45309;--sbs:rgba(2,132,199,.15);--sys:rgba(180,83,9,.15);'
    '--ag:#ecfdf5;--agt:#065f46;--r:10px;--tr:.13s ease}'
)
assert OLD_ROOT in html, "FALLO P2: bloque :root no encontrado en index.html"
html = html.replace(OLD_ROOT, NEW_ROOT, 1)
print("✅ PATCH 2 OK — index.html: paleta gris elegante aplicada")

# ── PATCH 3: renderModalCtx — bloque 🤖 más legible en claro ─
# El problema: --as en tema claro es casi invisible sobre blanco.
# Solución: background sólido azul muy suave (#e0f2fe) + texto navy.
OLD_CTX = (
    'function renderModalCtx(l){'
    "const ctx=$('mCtx');"
    'const lastNote=Array.isArray(l.notes)&&l.notes.length?l.notes[l.notes.length-1]:null;'
    'if(!l.interest&&!lastNote&&!l.ai_summary){ctx.style.display=\'none\';return;}'
    'ctx.style.display=\'block\';'
    'ctx.innerHTML=`'
    '${l.ai_summary?`<div class="ctx-row" style="background:var(--as);border-radius:7px;'
    'padding:7px 9px;margin-bottom:6px;border-left:3px solid var(--ac)">'
    '<span class="ctx-key" style="color:var(--ac)">🤖 IA</span>'
    '<span class="ctx-val" style="color:var(--ts);font-style:italic;font-size:11.5px">'
    '${esc(l.ai_summary)}</span></div>`:\'\'}'
    '${l.interest?`<div class="ctx-row"><span class="ctx-key">🚗 Interés</span>'
    '<span class="ctx-val">${esc(l.interest)}</span></div>`:\'\'}'
    '${l.source?`<div class="ctx-row"><span class="ctx-key">📡 Canal</span>'
    '<span class="ctx-val">${cSrc(l.source)}</span></div>`:\'\'}'
    '${l.lastClientTs?`<div class="ctx-row"><span class="ctx-key">📅 Origen</span>'
    '<span class="ctx-val">${fDT(l.lastClientTs)}</span></div>`:\'\'}'
    '${lastNote&&lastNote.content?`<div class="ctx-row"><span class="ctx-key">📝 Nota</span>'
    '<span class="ctx-note">${esc(lastNote.content.slice(0,100))} — '
    "<em>${esc(lastNote.author||'')}</em></span></div>"
    "`:''}"
    '`;};'
)
NEW_CTX = (
    'function renderModalCtx(l){'
    "const ctx=$('mCtx');"
    'const lastNote=Array.isArray(l.notes)&&l.notes.length?l.notes[l.notes.length-1]:null;'
    'if(!l.interest&&!lastNote&&!l.ai_summary){ctx.style.display=\'none\';return;}'
    'ctx.style.display=\'block\';'
    'ctx.innerHTML=`'
    # bloque IA: fondo azul suave sólido, borde izquierdo intenso, texto navy
    '${l.ai_summary?`<div class="ctx-row" style="background:#e0f2fe;border-radius:8px;'
    'padding:9px 11px;margin-bottom:8px;border-left:4px solid #0284c7;display:block">'
    '<span class="ctx-key" style="color:#0369a1;font-size:10px;font-weight:800;'
    'text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">'
    '🤖 Resumen Marcela IA</span>'
    '<span style="color:#1e3a5f;font-size:12px;line-height:1.5;white-space:pre-wrap">'
    '${esc(l.ai_summary)}</span></div>`:\'\'}'
    '${l.interest?`<div class="ctx-row"><span class="ctx-key">🚗 Interés</span>'
    '<span class="ctx-val">${esc(l.interest)}</span></div>`:\'\'}'
    '${l.source?`<div class="ctx-row"><span class="ctx-key">📡 Canal</span>'
    '<span class="ctx-val">${cSrc(l.source)}</span></div>`:\'\'}'
    '${l.lastClientTs?`<div class="ctx-row"><span class="ctx-key">📅 Origen</span>'
    '<span class="ctx-val">${fDT(l.lastClientTs)}</span></div>`:\'\'}'
    '${lastNote&&lastNote.content?`<div class="ctx-row"><span class="ctx-key">📝 Nota</span>'
    '<span class="ctx-note">${esc(lastNote.content.slice(0,100))} — '
    "<em>${esc(lastNote.author||'')}</em></span></div>"
    "`:''}"
    '`;};'
)
assert OLD_CTX in html, "FALLO P3: función renderModalCtx no encontrada — verificar cadena"
html = html.replace(OLD_CTX, NEW_CTX, 1)
print("✅ PATCH 3 OK — index.html: bloque 🤖 IA más visible en tema claro")

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("✅ Todos los parches aplicados correctamente (3/3)")

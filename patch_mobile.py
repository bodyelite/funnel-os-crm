#!/usr/bin/env python3
import os, shutil

HTML = "public/index.html"
if not os.path.exists(HTML):
    print("ERROR: public/index.html no encontrado")
    raise SystemExit(1)

with open(HTML, "r", encoding="utf-8") as f:
    src = f.read()

shutil.copy(HTML, HTML + ".bak_mobile")

# ── El bug principal: los media queries están atrapados dentro de .toast{}
# Los extraemos y los ponemos correctamente al final del bloque <style>

OLD_TOAST_BUG = """.toast{position:fixed;bottom:22px;right:22px;background:var(--ok);color:#fff;padding:9px 15px;border-radius:8px;font-size:12.5px;font-weight:600;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .2s,transform .2s;z-index:300
/* ═══════════════════════════════════════════════════════════════
   MOBILE RESPONSIVE  —  max-width: 768px
   ═══════════════════════════════════════════════════════════════ */
@media (max-width:768px){
  html,body{overflow-x:hidden;width:100%}
  .app{grid-template-columns:1fr!important;grid-template-rows:auto 1fr!important;min-height:100vh}
  .sb{flex-direction:row!important;align-items:center;justify-content:flex-start;padding:6px 10px!important;border-right:none!important;border-bottom:1px solid var(--bd);overflow-x:auto;gap:4px;position:sticky;top:0;z-index:100;-webkit-overflow-scrolling:touch;background:var(--p)}
  .sb h1{font-size:11.5px!important;white-space:nowrap;flex-shrink:0;margin:0 6px 0 0!important}
  .sb .who{display:none!important}
  .sb nav{display:flex!important;flex-direction:row!important;gap:2px!important;overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;flex:1;min-width:0}
  .sb nav button{width:auto!important;white-space:nowrap;padding:5px 8px!important;margin-bottom:0!important;font-size:11px!important;flex-shrink:0}
  .sb .lout{margin-top:0!important;flex-shrink:0;padding:5px 8px!important;font-size:10.5px!important}
  .mn{padding:8px!important;max-height:none;overflow-y:auto;overflow-x:hidden}
  .st{font-size:14px!important;margin-bottom:8px!important}
  .tb{padding:6px 8px!important;gap:5px;flex-wrap:wrap}
  .tb .lbl{font-size:10px!important}
  .tb input,.tb select,.tb button{font-size:11px!important;padding:4px 7px!important}
  .qk button{padding:4px 7px!important;font-size:10.5px!important}
  #rI{display:none!important}
  .s4,.s3{grid-template-columns:1fr 1fr!important;gap:6px!important}
  .sb2{padding:10px 12px!important}
  .sb2 .sc{font-size:24px!important}
  .fg{grid-template-columns:1fr!important;gap:8px}
  .tw,.ct,.pt{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tw .tr2{min-width:580px}
  .ct .cr2{min-width:540px}
  .pt .pr{min-width:520px}
  .ut{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .kb{display:flex!important;flex-direction:row!important;grid-auto-flow:unset!important;grid-auto-columns:unset!important;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;gap:8px;padding-bottom:12px}
  .kbc{flex:0 0 85vw!important;max-width:320px!important;scroll-snap-align:start;max-height:calc(100vh - 220px)}
  .cw{margin-top:12px}
  .cg table{min-width:540px!important}
  .cal-nav button{font-size:11px!important;padding:5px 10px!important}
  #calLabel{font-size:11px!important;min-width:auto!important}
  .mbg{align-items:stretch!important;padding:0!important;justify-content:stretch}
  .mo{width:100%!important;max-width:100%!important;height:100vh!important;max-height:100vh!important;margin:0!important;border-radius:0!important;position:fixed!important;top:0;bottom:0;left:0;right:0;overflow:hidden;display:flex;flex-direction:column}
  .mbd{grid-template-columns:1fr!important;padding:10px 12px!important;gap:12px;overflow-y:auto;flex:1}
  .mh2{padding:10px 12px!important;flex-shrink:0}
  .mht{font-size:13px!important}
  .lcards{grid-template-columns:1fr!important}
  .cfg{grid-template-columns:1fr!important}
  .pt .pr{grid-template-columns:1.2fr repeat(4,1fr) !important}
  #agendaText,#agendaDate{width:100%!important;min-width:unset!important}
  .vw{padding:0!important}
}
@media (hover:none) and (pointer:coarse){
  html,body{overflow-x:hidden;width:100%}
  .app{grid-template-columns:1fr!important;grid-template-rows:auto 1fr!important;min-height:100vh}
  .sb{flex-direction:row!important;align-items:center;justify-content:flex-start;padding:6px 10px!important;border-right:none!important;border-bottom:1px solid var(--bd);overflow-x:auto;gap:4px;position:sticky;top:0;z-index:100;-webkit-overflow-scrolling:touch;background:var(--p)}
  .sb h1{font-size:11.5px!important;white-space:nowrap;flex-shrink:0;margin:0 6px 0 0!important}
  .sb .who{display:none!important}
  .sb nav{display:flex!important;flex-direction:row!important;gap:2px!important;overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;flex:1;min-width:0}
  .sb nav button{width:auto!important;white-space:nowrap;padding:5px 8px!important;margin-bottom:0!important;font-size:11px!important;flex-shrink:0}
  .sb .lout{margin-top:0!important;flex-shrink:0;padding:5px 8px!important;font-size:10.5px!important}
  .mn{padding:8px!important;max-height:none;overflow-y:auto;overflow-x:hidden}
  .st{font-size:14px!important;margin-bottom:8px!important}
  .tb{padding:6px 8px!important;gap:5px;flex-wrap:wrap}
  .tb .lbl{font-size:10px!important}
  .tb input,.tb select,.tb button{font-size:11px!important;padding:4px 7px!important}
  .qk button{padding:4px 7px!important;font-size:10.5px!important}
  #rI{display:none!important}
  .s4,.s3{grid-template-columns:1fr 1fr!important;gap:6px!important}
  .sb2{padding:10px 12px!important}
  .sb2 .sc{font-size:24px!important}
  .fg{grid-template-columns:1fr!important;gap:8px}
  .tw,.ct,.pt{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tw .tr2{min-width:580px}
  .ct .cr2{min-width:540px}
  .pt .pr{min-width:520px}
  .ut{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .kb{display:flex!important;flex-direction:row!important;grid-auto-flow:unset!important;grid-auto-columns:unset!important;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;gap:8px;padding-bottom:12px}
  .kbc{flex:0 0 85vw!important;max-width:320px!important;scroll-snap-align:start;max-height:calc(100vh - 220px)}
  .cw{margin-top:12px}
  .cg table{min-width:540px!important}
  .cal-nav button{font-size:11px!important;padding:5px 10px!important}
  #calLabel{font-size:11px!important;min-width:auto!important}
  .mbg{align-items:stretch!important;padding:0!important;justify-content:stretch}
  .mo{width:100%!important;max-width:100%!important;height:100vh!important;max-height:100vh!important;margin:0!important;border-radius:0!important;position:fixed!important;top:0;bottom:0;left:0;right:0;overflow:hidden;display:flex;flex-direction:column}
  .mbd{grid-template-columns:1fr!important;padding:10px 12px!important;gap:12px;overflow-y:auto;flex:1}
  .mh2{padding:10px 12px!important;flex-shrink:0}
  .mht{font-size:13px!important}
  .lcards{grid-template-columns:1fr!important}
  .cfg{grid-template-columns:1fr!important}
  .pt .pr{grid-template-columns:1.2fr repeat(4,1fr) !important}
  #agendaText,#agendaDate{width:100%!important;min-width:unset!important}
  .vw{padding:0!important}
}
@media (max-width:480px){
  .sb h1{font-size:10.5px!important}
  .sb nav button{font-size:10px!important;padding:4px 6px!important}
  .s3,.s4{grid-template-columns:1fr 1fr!important}
  .sb2{padding:9px 11px!important}
  .sb2 .sc{font-size:22px!important}
  .kbc{flex:0 0 90vw!important;max-width:90vw!important}
  .mbd{padding:8px!important;gap:10px!important}
  .cg table{min-width:480px!important;font-size:10px!important}
  .tb{padding:5px 7px!important}
  .tb input,.tb select,.tb button{font-size:10.5px!important}
  .kn{font-size:11.5px!important}
  .kt{font-size:10px!important}
}
@media (hover:none) and (pointer:coarse) and (max-width:600px){
  .sb h1{font-size:10.5px!important}
  .sb nav button{font-size:10px!important;padding:4px 6px!important}
  .s3,.s4{grid-template-columns:1fr 1fr!important}
  .sb2{padding:9px 11px!important}
  .sb2 .sc{font-size:22px!important}
  .kbc{flex:0 0 90vw!important;max-width:90vw!important}
  .mbd{padding:8px!important;gap:10px!important}
  .cg table{min-width:480px!important;font-size:10px!important}
  .tb{padding:5px 7px!important}
  .tb input,.tb select,.tb button{font-size:10.5px!important}
  .kn{font-size:11.5px!important}
  .kt{font-size:10px!important}
}

@media(max-width:480px){
  /* En pantallas muy pequeñas: 1 sola columna en grillas */
  .s4{grid-template-columns:1fr 1fr}
  .s3{grid-template-columns:1fr 1fr}
  .fg{grid-template-columns:1fr 1fr}
  .sb2 .sc{font-size:26px}
}
}.toast.show{opacity:1;transform:translateY(0)}.toast.err{background:var(--bd2)}"""

NEW_TOAST_FIXED = """.toast{position:fixed;bottom:22px;right:22px;background:var(--ok);color:#fff;padding:9px 15px;border-radius:8px;font-size:12.5px;font-weight:600;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .2s,transform .2s;z-index:300}.toast.show{opacity:1;transform:translateY(0)}.toast.err{background:var(--bd2)}

@media(max-width:768px){
  html,body{overflow-x:hidden;width:100%}
  .app{grid-template-columns:1fr!important;grid-template-rows:auto 1fr!important;min-height:100vh}
  .sb{flex-direction:row!important;align-items:center;justify-content:flex-start;padding:6px 10px!important;border-right:none!important;border-bottom:1px solid var(--bd);overflow-x:auto;gap:4px;position:sticky;top:0;z-index:100;-webkit-overflow-scrolling:touch;background:var(--p)}
  .sb h1{font-size:11.5px!important;white-space:nowrap;flex-shrink:0;margin:0 6px 0 0!important}
  .sb .who{display:none!important}
  .sb nav{display:flex!important;flex-direction:row!important;gap:2px!important;overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;flex:1;min-width:0}
  .sb nav button{width:auto!important;white-space:nowrap;padding:5px 8px!important;margin-bottom:0!important;font-size:11px!important;flex-shrink:0}
  .sb .lout{margin-top:0!important;flex-shrink:0;padding:5px 8px!important;font-size:10.5px!important}
  .mn{padding:8px!important;max-height:none;overflow-y:auto;overflow-x:hidden}
  .st{font-size:14px!important;margin-bottom:8px!important}
  .tb{padding:6px 8px!important;gap:5px;flex-wrap:wrap}
  .tb .lbl{font-size:10px!important}
  .tb input,.tb select,.tb button{font-size:11px!important;padding:4px 7px!important}
  .qk button{padding:4px 7px!important;font-size:10.5px!important}
  #rI{display:none!important}
  .s4,.s3{grid-template-columns:1fr 1fr!important;gap:6px!important}
  .sb2{padding:10px 12px!important}
  .sb2 .sc{font-size:24px!important}
  .fg{grid-template-columns:1fr!important;gap:8px}
  .tw,.ct,.pt{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tw .tr2{min-width:580px}
  .ct .cr2{min-width:540px}
  .pt .pr{min-width:520px}
  .ut{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .kb{display:flex!important;flex-direction:row!important;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;gap:8px;padding-bottom:12px}
  .kbc{flex:0 0 85vw!important;max-width:320px!important;scroll-snap-align:start;max-height:calc(100vh - 220px)}
  .cw{margin-top:12px}
  .cg table{min-width:540px!important}
  .cal-nav button{font-size:11px!important;padding:5px 10px!important}
  .mbg{align-items:stretch!important;padding:0!important;justify-content:stretch}
  .mo{width:100%!important;max-width:100%!important;height:100vh!important;max-height:100vh!important;margin:0!important;border-radius:0!important;position:fixed!important;top:0;bottom:0;left:0;right:0;overflow:hidden;display:flex;flex-direction:column}
  .mbd{grid-template-columns:1fr!important;padding:10px 12px!important;gap:12px;overflow-y:auto;flex:1}
  .mh2{padding:10px 12px!important;flex-shrink:0}
  .mht{font-size:13px!important}
  .lcards{grid-template-columns:1fr!important}
  .cfg{grid-template-columns:1fr!important}
  #agendaText,#agendaDate{width:100%!important;min-width:unset!important}
  .lcards{grid-template-columns:1fr!important}
  /* modal full screen mobile */
  .mo{border-radius:0!important}
  /* login card */
  .lc{max-width:calc(100vw - 32px)!important;padding:24px!important}
  /* analytics table */
  .ct{overflow-x:auto}
  .cr2{min-width:600px}
  /* dashboard funnel */
  .fg{grid-template-columns:1fr 1fr!important}
  /* tabbar en modal */
  #mtabGestion,#mtabHistorial{font-size:12px!important;padding:8px 10px!important}
  /* busqueda leads */
  #busquedaLead{width:100%!important}
}

@media(max-width:480px){
  .sb h1{font-size:10.5px!important}
  .sb nav button{font-size:10px!important;padding:4px 6px!important}
  .s3,.s4{grid-template-columns:1fr 1fr!important}
  .sb2 .sc{font-size:22px!important}
  .kbc{flex:0 0 90vw!important;max-width:90vw!important}
  .mbd{padding:8px!important;gap:10px!important}
  .fg{grid-template-columns:1fr!important}
  .tb input,.tb select,.tb button{font-size:10.5px!important}
  .kn{font-size:11.5px!important}
  .kt{font-size:10px!important}
  /* ocultar columnas secundarias en tabla leads */
  .tr2>div:nth-child(5){display:none}
}"""

if OLD_TOAST_BUG in src:
    src = src.replace(OLD_TOAST_BUG, NEW_TOAST_FIXED)
    print("✓ Bug media queries corregido — extraidos de dentro de .toast{}")
else:
    print("WARN: patron de bug no encontrado exacto")
    print("      Buscando forma alternativa de insertar mobile CSS...")
    # Alternativa: agregar viewport meta si no existe y CSS al final del style
    if 'name="viewport"' not in src:
        src = src.replace('<meta charset="UTF-8">',
            '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">')
        print("✓ Viewport meta tag agregado")
    MOBILE_CSS = """
@media(max-width:768px){
  html,body{overflow-x:hidden;width:100%}
  .app{grid-template-columns:1fr!important;grid-template-rows:auto 1fr!important}
  .sb{flex-direction:row!important;padding:6px 10px!important;border-right:none!important;border-bottom:1px solid var(--bd);overflow-x:auto;position:sticky;top:0;z-index:100;background:var(--p)}
  .sb h1{font-size:11.5px!important;white-space:nowrap;margin:0 6px 0 0!important}
  .sb .who{display:none!important}
  .sb nav{display:flex!important;flex-direction:row!important;overflow-x:auto;flex-wrap:nowrap;flex:1}
  .sb nav button{width:auto!important;white-space:nowrap;padding:5px 8px!important;font-size:11px!important}
  .sb .lout{margin-top:0!important;padding:5px 8px!important}
  .mn{padding:8px!important}
  .s3,.s4{grid-template-columns:1fr 1fr!important}
  .fg{grid-template-columns:1fr 1fr!important}
  .tw,.ct,.pt{overflow-x:auto}
  .tw .tr2{min-width:580px}
  .kb{display:flex!important;overflow-x:auto;gap:8px}
  .kbc{flex:0 0 85vw!important;max-width:320px!important}
  .mbg{padding:0!important}
  .mo{width:100%!important;max-width:100%!important;height:100vh!important;max-height:100vh!important;border-radius:0!important;position:fixed!important;inset:0;display:flex;flex-direction:column}
  .mbd{grid-template-columns:1fr!important;padding:10px 12px!important;overflow-y:auto;flex:1}
  .lc{max-width:calc(100vw - 32px)!important;padding:24px!important}
  #busquedaLead{width:100%!important}
}
@media(max-width:480px){
  .sb h1{font-size:10.5px!important}
  .s3,.s4,.fg{grid-template-columns:1fr 1fr!important}
  .sb2 .sc{font-size:22px!important}
  .kbc{flex:0 0 90vw!important}
}
"""
    src = src.replace("</style>", MOBILE_CSS + "\n</style>", 1)
    print("✓ CSS mobile insertado antes del cierre de </style>")

# Asegurar viewport meta tag
if 'name="viewport"' not in src:
    src = src.replace(
        '<meta charset="UTF-8">',
        '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">'
    )
    print("✓ Viewport meta tag asegurado")

with open(HTML, "w", encoding="utf-8") as f:
    f.write(src)

print("\n✅ patch_mobile aplicado correctamente")
print(f"📁 Backup en {HTML}.bak_mobile")

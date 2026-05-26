# -*- coding: utf-8 -*-
# patch_frontend_sprint2.py — v2 con regex tolerante a formato
# Ejecutar desde la raíz del proyecto: python3 patch_frontend_sprint2.py

import re, sys, subprocess

HTM = 'public/index.html'

# ─────────────────────────────────────────────────────────────────────────────
def load():
    return open(HTM, 'r', encoding='utf-8').read()

def save(src):
    open(HTM, 'w', encoding='utf-8').write(src)

def check(label, pattern, src, flags=0):
    m = re.search(pattern, src, flags)
    if not m:
        # Diagnóstico: mostrar zona aproximada para depurar
        words = re.findall(r'\w+', pattern.replace(r'\s*','').replace(r'\s+',''))[:4]
        hint = ' '.join(words)
        idx = src.lower().find(hint.lower().split()[0]) if words else -1
        snippet = repr(src[max(0,idx-60):idx+120]) if idx != -1 else '(nada cercano)'
        print(f'FALLO [{label}] — patron no encontrado')
        print(f'  patron: {pattern}')
        print(f'  zona HTML cercana: {snippet}')
        sys.exit(1)
    return m

def validate_js(src):
    tag = re.search(r'<script>(.*?)</script>', src, re.DOTALL)
    if not tag:
        print('AVISO: no se encontró bloque <script>')
        return
    open('/tmp/_sprint2_check.js', 'w', encoding='utf-8').write(tag.group(1))
    r = subprocess.run(['node', '--check', '/tmp/_sprint2_check.js'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print('ERROR SINTAXIS JS:\n' + r.stderr)
        sys.exit(1)
    print('  Sintaxis JS OK')

# ─────────────────────────────────────────────────────────────────────────────
src = load()

# ══════════════════════════════════════════════════════════════════════════════
# P1 — Mobile CSS: insertar reglas al inicio del bloque @media 768px
# ══════════════════════════════════════════════════════════════════════════════
P1_PAT = r'(@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{)'
check('P1 @media 768px', P1_PAT, src)

MOBILE_RULES = (
    r'\1'
    '\n  .kb{display:flex!important;flex-direction:row;overflow-x:auto;'
    '-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;gap:8px;padding-bottom:12px}'
    '\n  .kbc{flex:0 0 80vw!important;max-width:290px;scroll-snap-align:start;'
    'max-height:calc(100vh - 180px)}'
    '\n  .mo{width:100%!important;max-width:100%!important;border-radius:16px 16px 0 0!important;'
    'max-height:96vh!important;margin:0!important;position:fixed;bottom:0;left:0;right:0}'
    '\n  .mbg{align-items:flex-end!important;padding:0!important}'
    '\n  .mbd{grid-template-columns:1fr!important;padding:10px 12px;gap:12px}'
    '\n  .ut{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}'
    '\n  .ut table{min-width:520px}'
    '\n  .tw,.ct,.pt{overflow-x:auto;-webkit-overflow-scrolling:touch}'
    '\n  .tw .tr2,.ct .cr2,.pt .pr{min-width:560px}'
    '\n  .cal-nav{flex-wrap:wrap!important;gap:6px}'
    '\n  .cal-nav button{font-size:11px!important;padding:5px 9px!important}'
    '\n  #calG table{min-width:460px}'
    '\n  .mbd #mAssignBlock select{width:100%}'
)

# Solo insertar si las reglas no están ya
if 'scroll-snap-type:x mandatory' not in src:
    src = re.sub(P1_PAT, MOBILE_RULES, src, count=1)
    print('OK [P1 mobile CSS insertado]')
else:
    print('SKIP [P1 mobile CSS ya presente]')

# ══════════════════════════════════════════════════════════════════════════════
# P2 — Botones de navegación de calendario
# ══════════════════════════════════════════════════════════════════════════════
P2_PAT = (
    r'(<div\s+class=["\']cw["\']>)'           # grupo 1: <div class="cw">
    r'(<div\s+class=["\']bt["\']>)'           # grupo 2: <div class="bt">
    r'(Agenda[^<]*)'                          # grupo 3: texto "Agenda..."
    r'(</div>)'                               # grupo 4: cierre bt
    r'(<div[^>]+id=["\']calG["\'][^>]*></div>)'  # grupo 5: <div id="calG">
    r'(</div>)'                               # grupo 6: cierre cw
)
check('P2 bloque agenda calG', P2_PAT, src)

CAL_BUTTONS = (
    r'\1'
    r'<div class="bt" style="display:flex;align-items:center;'
    r'justify-content:space-between;flex-wrap:wrap;gap:8px">'
    r'\3'
    r'<div class="cal-nav" style="display:flex;align-items:center;gap:6px">'
    r'<button id="calPrev" style="background:var(--p2);border:1px solid var(--bd);'
    r'color:var(--ts);padding:5px 11px;border-radius:7px;font-size:12px;'
    r'cursor:pointer;font-family:inherit">&laquo; Anterior</button>'
    r'<button id="calHoy" style="background:var(--ac);color:#fff;border:none;'
    r'padding:5px 11px;border-radius:7px;font-size:12px;cursor:pointer;'
    r'font-family:inherit;font-weight:600">Hoy</button>'
    r'<button id="calNext" style="background:var(--p2);border:1px solid var(--bd);'
    r'color:var(--ts);padding:5px 11px;border-radius:7px;font-size:12px;'
    r'cursor:pointer;font-family:inherit">Siguiente &raquo;</button>'
    r'</div></div>'
    r'<div style="overflow-x:auto">\5</div>'
    r'\6'
)

if 'calPrev' not in src:
    src = re.sub(P2_PAT, CAL_BUTTONS, src, count=1)
    print('OK [P2 botones Anterior/Hoy/Siguiente]')
else:
    print('SKIP [P2 botones ya presentes]')

# ══════════════════════════════════════════════════════════════════════════════
# P3 — Variable global calWeekOffset (antes de const S=)
# ══════════════════════════════════════════════════════════════════════════════
P3_PAT = r'(const\s+S\s*=\s*\{)'
check('P3 const S=', P3_PAT, src)

if 'calWeekOffset' not in src:
    src = re.sub(P3_PAT, r'var calWeekOffset=0;\n\1', src, count=1)
    print('OK [P3 calWeekOffset global]')
else:
    print('SKIP [P3 calWeekOffset ya declarado]')

# ══════════════════════════════════════════════════════════════════════════════
# P4 — renderCalendar() dinámica con navegación
# ══════════════════════════════════════════════════════════════════════════════
P4_START = r'function\s+renderCalendar\s*\(\s*\)\s*\{'
P4_END   = r'\nfunction\s+renderAnalytics\s*\('

m_start = check('P4 renderCalendar inicio', P4_START, src)
m_end   = check('P4 renderAnalytics fin',  P4_END,   src)

NEW_RENDER_CALENDAR = r"""function renderCalendar(){
  var today=new Date();today.setHours(0,0,0,0);
  var base=new Date(today);base.setDate(today.getDate()+(calWeekOffset||0)*7);
  var dow=base.getDay();
  var mon=new Date(base);mon.setDate(base.getDate()-(dow===0?6:dow-1));
  var DAY_NAMES=['Lun','Mar','Mi\u00e9','Jue','Vie','S\u00e1b','Dom'];
  var HOURS=Array.from({length:13},function(_,i){return i+8;});
  var FINAL_S=new Set(['Cerrado','Abandonado','Perdido']);
  var SCHED=new Set(['Agendado','Calificado']);
  var weekDates=DAY_NAMES.map(function(_,i){var d=new Date(mon);d.setDate(mon.getDate()+i);return d;});
  var evMap={};
  function addEv(ds,h,lead,isTask){var k=ds+':'+String(h).padStart(2,'0');if(!evMap[k])evMap[k]=[];evMap[k].push({lead:lead,isTask:isTask});}
  (S.leads||[]).forEach(function(l){
    if(FINAL_S.has(l.status))return;
    if(l.nextAction&&l.nextAction.date){var d=new Date(l.nextAction.date);if(!isNaN(d.getTime()))addEv(d.toISOString().slice(0,10),d.getHours(),l,true);}
    if(SCHED.has(l.status)&&l.scheduleText){var d2=new Date(l.scheduleText);if(!isNaN(d2.getTime()))addEv(d2.toISOString().slice(0,10),d2.getHours(),l,false);}
  });
  var nowH=new Date().getHours();
  var isThisWeek=(calWeekOffset||0)===0;
  var html='<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:460px;border:1px solid var(--bd);border-radius:8px;overflow:hidden"><thead><tr>'
    +'<th style="width:46px;padding:5px 6px;background:var(--p2);border-bottom:2px solid var(--bdm);border-right:2px solid var(--bdm);color:var(--tm);font-size:9.5px;font-weight:700;text-align:center">Hora</th>';
  weekDates.forEach(function(d,i){
    var isTd=isThisWeek&&d.getTime()===today.getTime();
    html+='<th style="padding:5px 4px;background:'+(isTd?'var(--as)':'var(--p2)')+';border-bottom:2px solid var(--bdm);border-right:1px solid var(--bd);color:'+(isTd?'var(--ac)':'var(--tm)')+';font-weight:'+(isTd?'800':'600')+';text-align:center;font-size:10.5px">'+DAY_NAMES[i]+'<br><span style="font-size:14px;font-weight:800;color:'+(isTd?'var(--ac)':'var(--tx)')+'">'+((d.getMonth()+1)+'/'+d.getDate())+'</span></th>';
  });
  html+='</tr></thead><tbody>';
  HOURS.forEach(function(h){
    var isNowRow=isThisWeek&&h===nowH;
    html+='<tr><td style="padding:3px 6px;background:var(--p2);border-right:2px solid var(--bdm);border-bottom:1px solid var(--bd);color:'+(isNowRow?'var(--ac)':'var(--tm)')+';font-weight:'+(isNowRow?'700':'500')+';font-size:10.5px;white-space:nowrap;vertical-align:top">'+String(h).padStart(2,'0')+':00</td>';
    weekDates.forEach(function(d){
      var ds=d.toISOString().slice(0,10);
      var k=ds+':'+String(h).padStart(2,'0');
      var evs=evMap[k]||[];
      var isTd=isThisWeek&&d.getTime()===today.getTime();
      var cell='';
      evs.forEach(function(ev){
        var l=ev.lead,isTask=ev.isTask;
        var now=new Date();
        var isPast=isTask&&l.nextAction&&new Date(l.nextAction.date)<=now;
        var isIA=isTask&&l.nextAction&&l.nextAction.delegateToIA;
        var col=isTask?(isPast?'#16a34a':'#f59e0b'):(l.status==='Agendado'?'var(--ok)':'var(--wn)');
        var bg=isTask?(isPast?'rgba(22,163,74,.13)':'rgba(245,158,11,.13)'):(l.status==='Agendado'?'var(--oks)':'var(--wns)');
        var icon=isTask?(isIA?(isPast?'&#x2705; ':'&#x1F916; '):(isPast?'&#x2713; ':'&#x23F0; ')):(l.status==='Agendado'?'&#x1F4C5; ':'&#x2B50; ');
        var label=isTask?(l.nextAction&&l.nextAction.text||'Tarea'):l.status;
        cell+='<div class="ce" data-id="'+l.id+'" style="background:'+bg+';border-left:2px solid '+col+';color:var(--tx);padding:3px 5px;border-radius:3px;margin-bottom:2px;cursor:pointer;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(l.name)+' - '+esc(label)+'">'+icon+esc(l.name)+'</div>';
      });
      html+='<td style="padding:3px;border-right:1px solid var(--bd);border-bottom:1px solid var(--bd);vertical-align:top;min-height:32px;background:'+(isTd?'rgba(37,99,235,.025)':'var(--p)')+'">'+(cell||'')+'</td>';
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  $('calG').innerHTML=html;
  $('calG').querySelectorAll('.ce[data-id]').forEach(function(el){
    el.addEventListener('click',function(){openModal(+el.dataset.id);});
  });
  var cp=$('calPrev'),ch=$('calHoy'),cn=$('calNext');
  if(cp){cp.onclick=function(){calWeekOffset=(calWeekOffset||0)-1;renderCalendar();};}
  if(ch){ch.onclick=function(){calWeekOffset=0;renderCalendar();};}
  if(cn){cn.onclick=function(){calWeekOffset=(calWeekOffset||0)+1;renderCalendar();};}
}
"""

src = src[:m_start.start()] + NEW_RENDER_CALENDAR + src[m_end.start():]
print('OK [P4 renderCalendar dinamico con navegacion]')

# ══════════════════════════════════════════════════════════════════════════════
# Guardar y validar
# ══════════════════════════════════════════════════════════════════════════════
save(src)
validate_js(src)

print('\n4/4 patches aplicados correctamente')
print('git add public/index.html && git commit -m "feat: sprint2 mobile+agenda dinamica+selector vendedor" && git push')

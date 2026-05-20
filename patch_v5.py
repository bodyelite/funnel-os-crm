# -*- coding: utf-8 -*-
# patch_v5.py — 5 parches criticos FunnelOS CRM
# Ejecutar desde la raiz del proyecto: python3 patch_v5.py

import sys

SRV = 'server.js'
HTM = 'public/index.html'

def patch(fp, label, old, new):
    src = open(fp,'r',encoding='utf-8').read()
    if old not in src:
        print('FALLO ['+label+']'); sys.exit(1)
    open(fp,'w',encoding='utf-8').write(src.replace(old,new,1))
    print('OK ['+label+']')

# P1a: reset /api/chat sincroniza estado completo al dashboard
patch(SRV,'P1a reset /api/chat',
"if(message.trim().toLowerCase()==='/reset'){leads[idx].chatHistory=[];leads[idx].intentSignal='NONE';leads[idx].keywordAlertSent=false;leads[idx].notes=(leads[idx].notes||[]).concat({content:'\U0001f504 Historial reseteado por comando',author:'Sistema',ts:Date.now()});await tWrite(F.leads,tenant,leads);return res.json({reply:'\U0001f504 Memoria borrada. \u00a1Empecemos de cero! \U0001f697',status:leads[idx].status});}",
"if(message.trim().toLowerCase()==='/reset'){const _rn=new Date().toISOString();leads[idx].chatHistory=[];leads[idx].intentSignal='NONE';leads[idx].keywordAlertSent=false;leads[idx].status='Nuevo';leads[idx].alertLevel='none';leads[idx].unread=true;leads[idx].reassigned=false;leads[idx].reassignedAt=null;leads[idx].adminReassignAlertSent=false;leads[idx].nextAction=null;leads[idx].ai_summary='';leads[idx].lastInteraction=_rn;leads[idx].lastClientTs=_rn;leads[idx].notes=(leads[idx].notes||[]).concat({content:'\U0001f504 Historial reseteado por comando',author:'Sistema',ts:Date.now()});await tWrite(F.leads,tenant,leads);return res.json({reply:'\U0001f504 Memoria borrada. \u00a1Empecemos de cero! \U0001f697',status:'Nuevo',alertLevel:'none',lead:leads[idx]});}"
)

# P1b: reset /webhook sincroniza estado completo
patch(SRV,'P1b reset /webhook',
"if(body.trim().toLowerCase()==='/reset'){ld[tenant][idx].chatHistory=[];ld[tenant][idx].intentSignal='NONE';ld[tenant][idx].keywordAlertSent=false;ld[tenant][idx].notes=(ld[tenant][idx].notes||[]).concat({content:'\U0001f504 Historial reseteado por comando',author:'Sistema',ts:Date.now()});await tWrite(F.leads,tenant,ld[tenant]);await sendWA(from,'\U0001f504 Memoria borrada. \u00a1Empecemos de cero! \U0001f697');return;}",
"if(body.trim().toLowerCase()==='/reset'){const _rn=new Date().toISOString();ld[tenant][idx].chatHistory=[];ld[tenant][idx].intentSignal='NONE';ld[tenant][idx].keywordAlertSent=false;ld[tenant][idx].status='Nuevo';ld[tenant][idx].alertLevel='none';ld[tenant][idx].unread=true;ld[tenant][idx].reassigned=false;ld[tenant][idx].reassignedAt=null;ld[tenant][idx].adminReassignAlertSent=false;ld[tenant][idx].nextAction=null;ld[tenant][idx].ai_summary='';ld[tenant][idx].lastInteraction=_rn;ld[tenant][idx].lastClientTs=_rn;ld[tenant][idx].notes=(ld[tenant][idx].notes||[]).concat({content:'\U0001f504 Historial reseteado por comando',author:'Sistema',ts:Date.now()});await tWrite(F.leads,tenant,ld[tenant]);await sendWA(from,'\U0001f504 Memoria borrada. \u00a1Empecemos de cero! \U0001f697');return;}"
)

# P2: inyectar nextAction retargeting en /webhook cuando bot envia link rmgautos.cl
patch(SRV,'P2 retargeting webhook',
"ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});applySignal(ld[tenant][idx],p);",
"ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});applySignal(ld[tenant][idx],p);\n      if(p.reply&&p.reply.indexOf('rmgautos.cl')!==-1&&!(ld[tenant][idx].nextAction&&!ld[tenant][idx].nextAction.iaCompleted)){ld[tenant][idx].nextAction={text:'\u00bfPudiste ver la ficha en el enlace? F\u00edjate en los detalles del equipamiento \U0001f440 \u00bfQu\u00e9 te pareci\u00f3?',date:new Date(Date.now()+2*60000).toISOString(),createdAt:new Date().toISOString(),delegateToIA:true,iaCompleted:false};}"
)

# P3: mSv desacoplado — assignedTo independiente de nota
patch(HTM,'P3 mSv independiente',
"$('mSv').addEventListener('click',async()=>{if(!S.mid)return;const btn=$('mSv');btn.disabled=true;btn.textContent='\u2026';try{const l=findLead(S.mid);const st=$('mSt').value;const note=$('mNt').value.trim();const payload={};if(st&&st!==l?.status)payload.status=st;if(note)payload.note=note;if(!Object.keys(payload).length){toast('Sin cambios');btn.disabled=false;btn.textContent='Guardar cambios';return;}await api('PATCH','/api/leads/'+S.mid,payload);$('mNt').value='';toast('Lead actualizado \u2713');await refresh();renderModal();}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent='Guardar cambios';}});",
"$('mSv').addEventListener('click',async()=>{if(!S.mid)return;const btn=$('mSv');btn.disabled=true;btn.textContent='\u2026';try{const l=findLead(S.mid);const st=$('mSt').value;const note=$('mNt').value.trim();const payload={};if(st&&st!==l?.status)payload.status=st;if(S.user&&S.user.role==='admin'){const mAss=$('mAssign');if(mAss&&mAss.value&&mAss.value!==l?.assignedTo)payload.assignedTo=mAss.value;}if(note)payload.note=note;if(!Object.keys(payload).length){toast('Sin cambios');btn.disabled=false;btn.textContent='Guardar cambios';return;}await api('PATCH','/api/leads/'+S.mid,payload);$('mNt').value='';toast('Lead actualizado \u2713');await refresh();renderModal();}catch(e){toast(e.message,true);}finally{btn.disabled=false;btn.textContent='Guardar cambios';}});"
)

# P4: eliminar comparacion de timezone Santiago que bloqueaba el cron de IA
patch(SRV,'P4 fix timezone cron',
"        var _cl=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Santiago'}));\n        if(new Date(na.date)>_cl)continue;",
"        if(new Date(na.date)>new Date())continue;"
)

# P5: renderCalendar time-blocking (tabla con filas de hora 08-20h y columnas por dia)
src = open(HTM,'r',encoding='utf-8').read()
s = src.find('function renderCalendar(){const today')
e = src.find('function renderAnalytics()')
if s==-1 or e==-1:
    print('FALLO [P5 anchors]'); sys.exit(1)

NEW = (
"function renderCalendar(){\n"
"  const today=new Date();today.setHours(0,0,0,0);\n"
"  const dow=today.getDay();\n"
"  const mon=new Date(today);mon.setDate(today.getDate()-(dow===0?6:dow-1));\n"
"  const DAY_NAMES=['Lun','Mar','Mi\xe9','Jue','Vie','S\xe1b','Dom'];\n"
"  const HOURS=Array.from({length:13},(_,i)=>i+8);\n"
"  const FINAL_S=new Set(['Cerrado','Abandonado','Perdido']);\n"
"  const SCHED=new Set(['Agendado','Calificado']);\n"
"  const weekDates=DAY_NAMES.map((_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return d;});\n"
"  const evMap={};\n"
"  function addEv(ds,h,lead,isTask){const k=ds+':'+String(h).padStart(2,'0');if(!evMap[k])evMap[k]=[];evMap[k].push({lead,isTask});}\n"
"  S.leads.forEach(l=>{\n"
"    if(FINAL_S.has(l.status))return;\n"
"    if(l.nextAction&&l.nextAction.date){const d=new Date(l.nextAction.date);if(!isNaN(d.getTime()))addEv(d.toISOString().slice(0,10),d.getHours(),l,true);}\n"
"    if(SCHED.has(l.status)&&l.scheduleText){const d=new Date(l.scheduleText);if(!isNaN(d.getTime()))addEv(d.toISOString().slice(0,10),d.getHours(),l,false);}\n"
"  });\n"
"  const nowH=new Date().getHours();\n"
"  let html='<div style=\"overflow-x:auto\"><table style=\"width:100%;border-collapse:collapse;font-size:11px;min-width:560px;border:1px solid var(--bd);border-radius:8px;overflow:hidden\"><thead><tr>'\n"
"    +'<th style=\"width:46px;padding:5px 6px;background:var(--p2);border-bottom:2px solid var(--bdm);border-right:2px solid var(--bdm);color:var(--tm);font-size:9.5px;font-weight:700;text-align:center\">Hora</th>';\n"
"  weekDates.forEach((d,i)=>{\n"
"    const isTd=d.getTime()===today.getTime();\n"
"    html+='<th style=\"padding:5px 4px;background:'+(isTd?'var(--as)':'var(--p2)')+';border-bottom:2px solid var(--bdm);border-right:1px solid var(--bd);color:'+(isTd?'var(--ac)':'var(--tm)')+';font-weight:'+(isTd?'800':'600')+';text-align:center;font-size:10.5px\">'+DAY_NAMES[i]+'<br><span style=\"font-size:14px;font-weight:800;color:'+(isTd?'var(--ac)':'var(--tx)')+'\">'+d.getDate()+'</span></th>';\n"
"  });\n"
"  html+='</tr></thead><tbody>';\n"
"  HOURS.forEach(h=>{\n"
"    const isNowRow=h===nowH;\n"
"    html+='<tr><td style=\"padding:3px 6px;background:var(--p2);border-right:2px solid var(--bdm);border-bottom:1px solid var(--bd);color:'+(isNowRow?'var(--ac)':'var(--tm)')+';font-weight:'+(isNowRow?'700':'500')+';font-size:10.5px;white-space:nowrap;vertical-align:top\">'+String(h).padStart(2,'0')+':00</td>';\n"
"    weekDates.forEach(d=>{\n"
"      const ds=d.toISOString().slice(0,10);\n"
"      const k=ds+':'+String(h).padStart(2,'0');\n"
"      const evs=evMap[k]||[];\n"
"      const isTd=d.getTime()===today.getTime();\n"
"      let cell='';\n"
"      evs.forEach(({lead:l,isTask})=>{\n"
"        const now=new Date();\n"
"        const isPast=isTask&&new Date(l.nextAction.date)<=now;\n"
"        const isIA=isTask&&l.nextAction&&l.nextAction.delegateToIA;\n"
"        const col=isTask?(isPast?'#16a34a':'#f59e0b'):(l.status==='Agendado'?'var(--ok)':'var(--wn)');\n"
"        const bg=isTask?(isPast?'rgba(22,163,74,.13)':'rgba(245,158,11,.13)'):(l.status==='Agendado'?'var(--oks)':'var(--wns)');\n"
"        const icon=isTask?(isIA?(isPast?'&#x2705; ':'&#x1F916; '):(isPast?'&#x2713; ':'&#x23F0; ')):(l.status==='Agendado'?'&#x1F4C5; ':'&#x2B50; ');\n"
"        const label=isTask?(l.nextAction&&l.nextAction.text||'Tarea'):l.status;\n"
"        cell+='<div class=\"ce\" data-id=\"'+l.id+'\" style=\"background:'+bg+';border-left:2px solid '+col+';color:var(--tx);padding:3px 5px;border-radius:3px;margin-bottom:2px;cursor:pointer;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\" title=\"'+esc(l.name)+' - '+esc(label)+'\">'+icon+esc(l.name)+'</div>';\n"
"      });\n"
"      html+='<td style=\"padding:3px;border-right:1px solid var(--bd);border-bottom:1px solid var(--bd);vertical-align:top;min-height:32px;background:'+(isTd?'rgba(37,99,235,.025)':'var(--p)')+'\">'+cell+'</td>';\n"
"    });\n"
"    html+='</tr>';\n"
"  });\n"
"  html+='</tbody></table></div>';\n"
"  $('calG').innerHTML=html;\n"
"  $('calG').querySelectorAll('.ce[data-id]').forEach(el=>el.addEventListener('click',()=>openModal(+el.dataset.id)));\n"
"}\n\n"
)

open(HTM,'w',encoding='utf-8').write(src[:s]+NEW+src[e:])
print('OK [P5 renderCalendar time-blocking]')
print('\n5/5 parches aplicados. Haz git add . && git commit -m "fix: 5 bugs criticos CRM" && git push')

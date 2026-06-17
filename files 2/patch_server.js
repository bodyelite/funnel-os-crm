const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'server.js');
let s = fs.readFileSync(file, 'utf8');

// Fix 1: botDebounce map
const F1 = `const chatSessions=new Map();`;
const R1 = `const chatSessions=new Map();
// ── DEBOUNCE: acumula mensajes del mismo número por 5s antes de responder ──
const botDebounce = new Map();`;
if (s.includes(F1) && !s.includes('botDebounce')) { s = s.replace(F1, R1); console.log('✅ Fix 1: botDebounce map'); }
else console.log('⚠️ Fix 1 ya aplicado');

// Fix 2: bloque principal del webhook
const F2 = `    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    ld[tenant][idx].unread=true;ld[tenant][idx].lastClientTs=new Date().toISOString();
    if(ld[tenant][idx].botActive!==false){
      if(body.trim().toLowerCase()==='/reset'){ld[tenant].splice(idx,1);await tWrite(F.leads,tenant,ld[tenant]);console.log('[RESET] Lead eliminado para',from,'— listo para nuevo ingreso');return;}
      const allUsersWH=await tRead(F.users,tenant);
      const assignedUserWH=allUsersWH.find(u=>u.username===ld[tenant][idx].assignedTo)||RMG_VENDORS.find(v=>v.username===ld[tenant][idx].assignedTo);
      const assignedNameWH=ld[tenant][idx].botPersona||assignedUserWH?.name||'Cata';
      const p=await marcela(tenant,ld[tenant][idx].chatHistory.slice(0,-1),body,ld[tenant][idx].notes,assignedNameWH,ld[tenant][idx].source);
      applySignal(ld[tenant][idx],p);`;

if (s.includes(F2)) {
  const R2 = `    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    ld[tenant][idx].unread=true;ld[tenant][idx].lastClientTs=new Date().toISOString();
    if(ld[tenant][idx].botActive!==false){
      if(body.trim().toLowerCase()==='/reset'){ld[tenant].splice(idx,1);await tWrite(F.leads,tenant,ld[tenant]);console.log('[RESET] Lead eliminado para',from,'— listo para nuevo ingreso');return;}

      // ── DEBOUNCE 5s ──
      if(botDebounce.has(from)) clearTimeout(botDebounce.get(from).timer);
      const acc = botDebounce.get(from) || { messages: [] };
      acc.timer = setTimeout(async () => {
        botDebounce.delete(from);
        try {
          const _tok=(process.env.WA_TOKEN||'').trim(), _pid=(process.env.WA_PHONE_ID||'').trim();
          if(_tok&&_pid) fetch(\`https://graph.facebook.com/v19.0/\${_pid}/messages\`,{method:'POST',headers:{Authorization:'Bearer '+_tok,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',status:'read',message_id:msg.id})}).catch(()=>{});
          const ldF=await read(F.leads); if(!ldF[tenant]) return;
          const idxF=ldF[tenant].findIndex(l=>l.phone&&l.phone.replace(/\\D/g,'').includes(from.replace(/\\D/g,'')));
          if(idxF===-1) return;
          const allUsersWH=await tRead(F.users,tenant);
          const assignedUserWH=allUsersWH.find(u=>u.username===ldF[tenant][idxF].assignedTo)||RMG_VENDORS.find(v=>v.username===ldF[tenant][idxF].assignedTo);
          const assignedNameWH=ldF[tenant][idxF].botPersona||assignedUserWH?.name||'Cata';
          const lastMsg=ldF[tenant][idxF].chatHistory.filter(m=>m.role==='user').slice(-1)[0]?.content||body;
          const p=await marcela(tenant,ldF[tenant][idxF].chatHistory.slice(0,-1),lastMsg,ldF[tenant][idxF].notes,assignedNameWH,ldF[tenant][idxF].source);
          applySignal(ldF[tenant][idxF],p);
          if(p.schedule_detected&&p.schedule_text){ldF[tenant][idxF].notes=(ldF[tenant][idxF].notes||[]);ldF[tenant][idxF].notes.push({content:'🚨 CITA AGENDADA POR IA: '+p.schedule_text,author:'Sistema',ts:Date.now()});ldF[tenant][idxF].intentSignal='BLUE';ldF[tenant][idxF].nextAction={text:'📞 Llamar al cliente: '+p.schedule_text,date:new Date(Date.now()+60000).toISOString(),createdAt:new Date().toISOString(),delegateToIA:false,iaCompleted:false};}
          let _isEnd=false;
          if(!p.reply||p.reply.trim()===''){ldF[tenant][idxF].notes=(ldF[tenant][idxF].notes||[]);ldF[tenant][idxF].notes.push({content:'🤫 IA detectó fin de conversación.',author:'Sistema',ts:Date.now()});_isEnd=true;}
          else{ldF[tenant][idxF].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});if(p.reply.indexOf('rmgautos.cl')!==-1&&!(ldF[tenant][idxF].nextAction&&!ldF[tenant][idxF].nextAction.iaCompleted)){ldF[tenant][idxF].nextAction={text:'¿Pudiste ver la ficha en el enlace? Fíjate en los detalles del equipamiento 👀 ¿Qué te pareció?',date:new Date(Date.now()+3*60000).toISOString(),createdAt:new Date().toISOString(),delegateToIA:true,iaCompleted:false};}}
          if(esKeywordCalif(body)&&!ldF[tenant][idxF].keywordAlertSent){ldF[tenant][idxF].keywordAlertSent=true;ldF[tenant][idxF].intentSignal='BLUE';ldF[tenant][idxF].notes=(ldF[tenant][idxF].notes||[]);try{const hSW=ldF[tenant][idxF].chatHistory.slice(-10).map(m=>(m.role==='user'?'Cliente':'Asesor')+': '+m.content).join('\\n');const rCW=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.4,max_tokens:200,messages:[{role:'system',content:'Briefing 3 líneas: (1) nombre y auto. (2) lo que dijo. (3) acción para el vendedor.'},{role:'user',content:'NOMBRE: '+ldF[tenant][idxF].name+'\\nHISTORIAL:\\n'+hSW}]});const rIAWH=(rCW.choices?.[0]?.message?.content||'').trim()||'Interés detectado.';ldF[tenant][idxF].ai_summary=rIAWH;alertStaff(tenant,assignedUserWH,'✅ Lead Asignado','✅ Lead: '+ldF[tenant][idxF].name+'. Resumen: '+rIAWH+' — Entra al CRM.');}catch(eW){ldF[tenant][idxF].notes.push({content:'🧠 IA falló: '+eW.message,author:'Sistema',ts:Date.now()});alertStaff(tenant,assignedUserWH,'✅ Lead Asignado','✅ Lead: '+ldF[tenant][idxF].name+'. Revisa bitácora.');}}
          if(!_isEnd) await sendWA(from,p.reply);
          ldF[tenant][idxF].lastInteraction=new Date().toISOString();ldF[tenant][idxF].alertLevel=calcAlert(ldF[tenant][idxF]);
          await write(F.leads,ldF);
          try{await notifyTenantPush(tenant,ldF[tenant]||[]);}catch(_){}
        }catch(eDeb){console.error('[DEBOUNCE-ERR]',eDeb.message);}
      },5000);
      botDebounce.set(from,acc);
      ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
      await write(F.leads,ld); return;
    }`;
  s = s.replace(F2, R2);
  console.log('✅ Fix 2: debounce webhook');
} else console.log('⚠️ Fix 2 no encontrado');

// Fix 3: cierre correcto del webhook
const F3_A = `      if(!_isEnd) await sendWA(from,p.reply);
    }
    ld[tenant][idx].lastInteraction=new Date().toISOString();
    ld[tenant][idx].lastClientTs=new Date().toISOString();
    ld[tenant][idx].unread=true;ld[tenant][idx].lastClientTs=new Date().toISOString();
    ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
    await write(F.leads,ld);
    console.log('[WH-SAVED] Lead guardado:',ld[tenant][idx].name,'phone:',from,'idx:',idx);
    try{ await notifyTenantPush(tenant, ld[tenant]||[]); console.log('[PUSH] Notificación enviada'); }catch(ePush){ console.warn('[PUSH] error:',ePush.message); }
  }catch(e){console.error('Webhook:',e);}
});`;
const R3_A = `    // Bot pausado — solo guardar
    ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
    await write(F.leads,ld);try{await notifyTenantPush(tenant,ld[tenant]||[]);}catch(_){}
  }catch(e){console.error('Webhook:',e);}
});`;
if(s.includes(F3_A)){s=s.replace(F3_A,R3_A);console.log('✅ Fix 3: cierre webhook');}
else console.log('⚠️ Fix 3 no encontrado (puede que ya esté limpio)');

fs.writeFileSync(file, s, 'utf8');
console.log('\n✅ server.js guardado');

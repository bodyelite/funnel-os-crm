const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

const OLD1 = `          const lastMsg=ldF[tenant][idxF].chatHistory.filter(m=>m.role==='user').slice(-1)[0]?.content||body;
          const p=await marcela(tenant,ldF[tenant][idxF].chatHistory.slice(0,-1),lastMsg,ldF[tenant][idxF].notes,assignedNameWH,ldF[tenant][idxF].source);`;
const NEW1 = `          const fullHistory = ldF[tenant][idxF].chatHistory;
          const lastUserMsg = fullHistory.filter(m=>m.role==='user').slice(-1)[0]?.content || body;
          const p=await marcela(tenant,fullHistory.slice(0,-1),lastUserMsg,ldF[tenant][idxF].notes,assignedNameWH,ldF[tenant][idxF].source);`;
if (code.includes(OLD1)) { code = code.replace(OLD1, NEW1); console.log('✅ Fix 1: historial completo'); }
else console.log('⚠️ Fix 1 ya aplicado');

const OLD2 = `      botDebounce.set(from,acc);
      ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
      await write(F.leads,ld); return;
    }
      
      if(p.schedule_detected && p.schedule_text) {
          ld[tenant][idx].notes = Array.isArray(ld[tenant][idx].notes) ? ld[tenant][idx].notes : [];
          ld[tenant][idx].notes.push({content: '🚨 CITA AGENDADA POR IA: ' + p.schedule_text, author: 'Sistema', ts: Date.now()});
          ld[tenant][idx].intentSignal = 'BLUE';
          // Clavamos la cita en la agenda del vendedor
          ld[tenant][idx].nextAction = {text: '📞 Llamar al cliente: ' + p.schedule_text, date: new Date(Date.now()+60000).toISOString(), createdAt: new Date().toISOString(), delegateToIA: false, iaCompleted: false};
      }

      let _isEnd = false;
      if(!p.reply || p.reply.trim() === '') {
          ld[tenant][idx].notes = Array.isArray(ld[tenant][idx].notes) ? ld[tenant][idx].notes : [];
          ld[tenant][idx].notes.push({content: '🤫 IA detectó fin de conversación y no respondió para evitar repeticiones.', author: 'Sistema', ts: Date.now()});
          _isEnd = true;
      } else {
          ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
          if(p.reply.indexOf('rmgautos.cl')!==-1&&!(ld[tenant][idx].nextAction&&!ld[tenant][idx].nextAction.iaCompleted)){ld[tenant][idx].nextAction={text:'¿Pudiste ver la ficha en el enlace? Fíjate en los detalles del equipamiento 👀 ¿Qué te pareció?',date:new Date(Date.now()+3*60000).toISOString(),createdAt:new Date().toISOString(),delegateToIA:true,iaCompleted:false};}
      }
      if(esKeywordCalif(body)&&!ld[tenant][idx].keywordAlertSent){
        ld[tenant][idx].keywordAlertSent=true;
        ld[tenant][idx].intentSignal='BLUE';
        ld[tenant][idx].notes=Array.isArray(ld[tenant][idx].notes)?ld[tenant][idx].notes:[];
        try{
          const histSnipWH=ld[tenant][idx].chatHistory.slice(-10).map(m=>(m.role==='user'?'Cliente':'Asesor')+': '+m.content).join('\\n');
          const resCompWH=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.4,max_tokens:200,messages:[{role:'system',content:'Eres un asistente comercial de automotora. Con el historial de chat y las notas del vendedor, redacta un BRIEFING narrativo de maximo 3 lineas: (1) [Nombre] consulta por [auto especifico]. (2) [Que dijo sobre financiamiento, retoma, fecha o acuerdo]. (3) Sugerencia: [accion concreta para el vendedor ahora]. Espanol directo, sin emojis, sin titulos, solo el parrafo.'},{role:'user',content:'NOMBRE: '+ld[tenant][idx].name+'\\nHISTORIAL:\\n'+histSnipWH}]});
          const resumenIAWH=(resCompWH.choices?.[0]?.message?.content||'').trim()||'Interés en crédito/retoma detectado.';
          ld[tenant][idx].ai_summary=resumenIAWH;
          alertStaff(tenant, assignedUserWH, '✅ Lead Reasignado', '✅ Lead Reasignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.');
        }catch(eIAWH){
          console.error('[Resumen-Error /webhook]', eIAWH);
          ld[tenant][idx].notes.push({content:'🧠 Cliente mencionó crédito/retoma/seguro. (OpenAI falló: '+eIAWH.message+')',author:'Resumen IA',ts:Date.now()});
          alertStaff(tenant, assignedUserWH, '✅ Lead Asignado', '✅ Lead Asignado: '+ld[tenant][idx].name+'. Revisa la bitácora del CRM.');
        }
      }
    // Bot pausado — solo guardar`;
const NEW2 = `      botDebounce.set(from,acc);
      ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
      await write(F.leads,ld); return;
    }
    // Bot pausado — solo guardar`;
if (code.includes(OLD2)) { code = code.replace(OLD2, NEW2); console.log('✅ Fix 2: código zombie eliminado'); }
else console.log('⚠️ Fix 2 ya aplicado');

fs.writeFileSync(file, code, 'utf8');
console.log('✅ server.js guardado');

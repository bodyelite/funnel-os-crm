'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, 'server.js');
const HTML   = path.join(__dirname, 'public', 'index.html');

function patch(file, label, oldStr, newStr) {
  const src = fs.readFileSync(file, 'utf8');
  const idx = src.indexOf(oldStr);
  if (idx === -1) { console.error('❌ FALLO [' + label + '] en ' + path.basename(file)); process.exit(1); }
  fs.writeFileSync(file, src.slice(0, idx) + newStr + src.slice(idx + oldStr.length), 'utf8');
  console.log('✅ [' + label + ']');
}

patch(HTML, 'B1 — viewport meta tag',
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">',
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">'
);

patch(HTML, 'B2 — kanban badge nextAction simple',
  '<div class="kn">${esc(l.name)}</div><div class="kt">${l.status===\'Reservado\'?\'🔒 \'+fMin(l.reservadoAt||l.lastInteraction):fMin(mAgo(l.lastClientTs||l.lastInteraction))}</div></div>',
  '<div class="kn">${esc(l.name)}</div><div class="kt">${l.status===\'Reservado\'?\'🔒 \'+fMin(l.reservadoAt||l.lastInteraction):fMin(mAgo(l.lastClientTs||l.lastInteraction))}</div>${l.nextAction&&l.nextAction.date?\'<div style="font-size:11px;color:#f59e0b;margin-top:4px;font-weight:600">\u23f0 \'+l.nextAction.date.slice(5,16).replace(\'T\',\' \')+\'</div>\':\'\'}</div>'
);

patch(SERVER, 'B3a — resumen OpenAI en /api/chat',
  "    // KEYWORD DETECTOR — status NUNCA cambia, solo nota en bitácora + WA al vendedor\n" +
  "    if(esKeywordCalif(message)&&!leads[idx].keywordAlertSent){\n" +
  "      leads[idx].keywordAlertSent=true;\n" +
  "      leads[idx].intentSignal='BLUE';\n" +
  "      // Resumen contextualizado con los últimos mensajes\n" +
  "      const histSnip=leads[idx].chatHistory.slice(-6).map(m=>(m.role==='user'?'Cliente':'IA')+': '+m.content).join('\\n');\n" +
  "      const resumen='🧠 Resumen IA (crédito/retoma detectado):\\n'+histSnip;\n" +
  "      leads[idx].notes=Array.isArray(leads[idx].notes)?leads[idx].notes:[];\n" +
  "      leads[idx].notes.push({content:resumen,author:assignedNameChat||'Marcela IA',ts:Date.now()});\n" +
  "      if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,\n" +
  "        '✅ Lead Asignado: '+leads[idx].name+'. Lee el resumen de crédito/retoma en la bitácora del CRM.'\n" +
  "      ).catch(()=>{});\n" +
  "      console.log('[keyword-calif] '+leads[idx].name+' asignado a '+assignedNameChat+' — nota guardada');\n" +
  "    }",
  "    // KEYWORD DETECTOR — status NUNCA cambia; resumen IA via OpenAI\n" +
  "    if(esKeywordCalif(message)&&!leads[idx].keywordAlertSent){\n" +
  "      leads[idx].keywordAlertSent=true;\n" +
  "      leads[idx].intentSignal='BLUE';\n" +
  "      leads[idx].notes=Array.isArray(leads[idx].notes)?leads[idx].notes:[];\n" +
  "      try{\n" +
  "        const histSnip=leads[idx].chatHistory.slice(-10).map(m=>(m.role==='user'?'Cliente':'Asesor')+': '+m.content).join('\\n');\n" +
  "        const notasSnip=(leads[idx].notes||[]).slice(-3).map(n=>n.author+': '+n.content).join('\\n');\n" +
  "        const resComp=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.3,max_tokens:120,messages:[{role:'system',content:'Eres un asistente CRM. Lee el chat y redacta un resumen ejecutivo de máximo 2 líneas para el vendedor indicando: qué auto busca el cliente, su método de pago (crédito/contado) y si tiene auto en retoma. Responde solo el resumen, sin introducción.'},{role:'user',content:'CHAT:\\n'+histSnip+(notasSnip?'\\nNOTAS PREVIAS:\\n'+notasSnip:'')}]});\n" +
  "        const resumenIA=(resComp.choices?.[0]?.message?.content||'').trim()||'Interés detectado en crédito/retoma.';\n" +
  "        leads[idx].notes.push({content:'🧠 '+resumenIA,author:'Resumen IA',ts:Date.now()});\n" +
  "        if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,'✅ Lead Asignado: '+leads[idx].name+'. Resumen IA: '+resumenIA+' — Entra al CRM para cerrar.').catch(()=>{});\n" +
  "      }catch(eIA){\n" +
  "        console.error('[OpenAI Resumen Error]:', eIA.message);\n" +
  "        leads[idx].notes.push({content:'🧠 Cliente mencionó crédito/retoma/seguro. Revisar chat.',author:'Resumen IA',ts:Date.now()});\n" +
  "        if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,'✅ Lead Asignado: '+leads[idx].name+'. Lee el resumen en la bitácora del CRM.').catch(()=>{});\n" +
  "      }\n" +
  "      console.log('[keyword-calif] '+leads[idx].name+' — resumen IA procesado');\n" +
  "    }"
);

patch(SERVER, 'B3b — resumen OpenAI en /webhook',
  "      // KEYWORD DETECTOR — status NUNCA cambia, nota en bitácora + WA al vendedor\n" +
  "      if(esKeywordCalif(body)&&!ld[tenant][idx].keywordAlertSent){\n" +
  "        ld[tenant][idx].keywordAlertSent=true;\n" +
  "        ld[tenant][idx].intentSignal='BLUE';\n" +
  "        const histSnipWH=ld[tenant][idx].chatHistory.slice(-6).map(m=>(m.role==='user'?'Cliente':'IA')+': '+m.content).join('\\n');\n" +
  "        const resumenWH='🧠 Resumen IA (crédito/retoma detectado):\\n'+histSnipWH;\n" +
  "        ld[tenant][idx].notes=Array.isArray(ld[tenant][idx].notes)?ld[tenant][idx].notes:[];\n" +
  "        ld[tenant][idx].notes.push({content:resumenWH,author:assignedNameWH||'Marcela IA',ts:Date.now()});\n" +
  "        if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,\n" +
  "          '✅ Lead Asignado: '+ld[tenant][idx].name+'. Lee el resumen de crédito/retoma en la bitácora del CRM.'\n" +
  "        ).catch(()=>{});\n" +
  "        console.log('[keyword-calif] '+ld[tenant][idx].name+' asignado a '+assignedNameWH);\n" +
  "      }",
  "      // KEYWORD DETECTOR — status NUNCA cambia; resumen IA via OpenAI\n" +
  "      if(esKeywordCalif(body)&&!ld[tenant][idx].keywordAlertSent){\n" +
  "        ld[tenant][idx].keywordAlertSent=true;\n" +
  "        ld[tenant][idx].intentSignal='BLUE';\n" +
  "        ld[tenant][idx].notes=Array.isArray(ld[tenant][idx].notes)?ld[tenant][idx].notes:[];\n" +
  "        try{\n" +
  "          const histSnipWH=ld[tenant][idx].chatHistory.slice(-10).map(m=>(m.role==='user'?'Cliente':'Asesor')+': '+m.content).join('\\n');\n" +
  "          const resCompWH=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.3,max_tokens:120,messages:[{role:'system',content:'Eres un asistente CRM. Lee el chat y redacta un resumen ejecutivo de máximo 2 líneas para el vendedor indicando: qué auto busca el cliente, su método de pago (crédito/contado) y si tiene auto en retoma. Responde solo el resumen, sin introducción.'},{role:'user',content:'CHAT:\\n'+histSnipWH}]});\n" +
  "          const resumenIAWH=(resCompWH.choices?.[0]?.message?.content||'').trim()||'Interés en crédito/retoma detectado.';\n" +
  "          ld[tenant][idx].notes.push({content:'🧠 '+resumenIAWH,author:'Resumen IA',ts:Date.now()});\n" +
  "          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Asignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.').catch(()=>{});\n" +
  "        }catch(eIAWH){\n" +
  "          console.error('[OpenAI Resumen Error]:', eIAWH.message);\n" +
  "          ld[tenant][idx].notes.push({content:'🧠 Cliente mencionó crédito/retoma/seguro.',author:'Resumen IA',ts:Date.now()});\n" +
  "          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Asignado: '+ld[tenant][idx].name+'. Revisa la bitácora del CRM.').catch(()=>{});\n" +
  "        }\n" +
  "        console.log('[keyword-calif] '+ld[tenant][idx].name+' — resumen IA procesado');\n" +
  "      }"
);

const { execSync } = require('child_process');
try { execSync('node --check "' + SERVER + '"', { stdio: 'pipe' }); console.log('✅ Sintaxis server.js OK'); }
catch(e) { console.error('❌ Sintaxis:\n' + e.stderr?.toString()); process.exit(1); }
console.log('\n🎉 3 bugs corregidos:\n  B1 viewport meta\n  B2 kanban badge simple\n  B3 resumen OpenAI con try/catch + console.error\n');

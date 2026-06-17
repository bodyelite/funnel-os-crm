const fs = require('fs'), path = require('path');

// ── PATCH SERVER.JS ──
const sf = path.join(__dirname, 'server.js');
let s = fs.readFileSync(sf, 'utf8');

// 1. alertStaff
const AS_OLD = `async function sendWA(to, text, retries = 2) {`;
const AS_NEW = `// ── alertStaff: WA + Push en paralelo ──
async function alertStaff(tenant, userObj, title, body) {
  if (!userObj) return;
  if (userObj.phone) sendWA(userObj.phone, body).catch(() => {});
  if (userObj.username && tenant) sendWebPush(tenant, userObj.username, { title, body, ts: Date.now() }).catch(() => {});
}

async function sendWA(to, text, retries = 2) {`;

if (s.includes(AS_OLD) && !s.includes('alertStaff')) { s = s.replace(AS_OLD, AS_NEW); console.log('✅ alertStaff creada'); }
else console.log('⚠️ alertStaff ya existe');

const reps = [
  [`        if(admin?.phone)sendWA(admin.phone,msg).catch(()=>{});\n        if(assignedUser?.phone)sendWA(assignedUser.phone,msg).catch(()=>{});`,
   `        alertStaff(tenant, admin, '🔴 Reserva Vencida', msg);\n        alertStaff(tenant, assignedUser, '🔴 Reserva Vencida', msg);`],
  [`          if(nextObj.phone)sendWA(nextObj.phone,'🚨 REASIGNACIÓN: Se te asignó el lead ['+lead.name+'] porque el anterior no respondió en 30 min.'+aiSumR).catch(()=>{});`,
   `          alertStaff(tenant, nextObj, '🚨 Reasignación', '🚨 REASIGNACIÓN: Se te asignó el lead ['+lead.name+'] porque el anterior no respondió en 30 min.'+aiSumR);`],
  [`          if(adminU?.phone)sendWA(adminU.phone,'📢 ALERTA ADMIN: ['+lead.name+'] lleva 30+ min sin atención tras reasignación.'+aiSumA).catch(()=>{});`,
   `          alertStaff(tenant, adminU, '📢 Alerta Admin', '📢 ALERTA ADMIN: ['+lead.name+'] lleva 30+ min sin atención tras reasignación.'+aiSumA);`],
  [`    if(assignedObj?.phone)sendWA(assignedObj.phone,\`🔔 NUEVO LEAD: \"\${message.slice(0,60)}\" — atiéndelo en el CRM ahora.\`).catch(()=>{});`,
   `    alertStaff(tenant, assignedObj, '🔔 Nuevo Lead', \`🔔 NUEVO LEAD: "\${message.slice(0,60)}" — atiéndelo en el CRM ahora.\`);`],
  [`        if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,'✅ Lead Asignado: '+leads[idx].name+'. Resumen IA: '+resumenIA+' — Entra al CRM para cerrar.').catch(()=>{});`,
   `        alertStaff(tenant, assignedUserChat, '✅ Lead Asignado', '✅ Lead Asignado: '+leads[idx].name+'. Resumen IA: '+resumenIA+' — Entra al CRM para cerrar.');`],
  [`        if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,'✅ Lead Asignado: '+leads[idx].name+'. Lee el resumen en la bitácora del CRM.').catch(()=>{});`,
   `        alertStaff(tenant, assignedUserChat, '✅ Lead Asignado', '✅ Lead Asignado: '+leads[idx].name+'. Lee el resumen en la bitácora del CRM.');`],
  [`    if (assignedObj.phone) sendWA(assignedObj.phone, \`🔔 NUEVO LEAD CHILEAUTOS asignado a ti. Entra a FunnelOS → Chileautos para verlo.\`).catch(()=>{});`,
   `    alertStaff(tenant, assignedObj, '🔔 Nuevo Lead Chileautos', '🔔 NUEVO LEAD CHILEAUTOS asignado a ti. Entra a FunnelOS → Chileautos para verlo.');`],
  [`    if (vend?.phone) sendWA(vend.phone, '\\u{1F514} NUEVO LEAD MANUAL [' + canal + ']: ' + nombre + ' asignado a ti en FunnelOS.').catch(()=>{});`,
   `    alertStaff(tenant, vend, '🔔 Nuevo Lead Manual', '🔔 NUEVO LEAD MANUAL [' + canal + ']: ' + nombre + ' asignado a ti en FunnelOS.');`],
  [`    if (assignedObj.phone) sendWA(assignedObj.phone, '🔔 NUEVO LEAD CHILEAUTOS: ' + name + ' interesado en ' + vehicleTitle).catch(()=>{});`,
   `    alertStaff(tenant, assignedObj, '🔔 Nuevo Lead Chileautos', '🔔 NUEVO LEAD CHILEAUTOS: ' + name + ' interesado en ' + vehicleTitle);`],
  [`      if(assignedObj.phone) sendWA(assignedObj.phone, \`🔔 NUEVO LEAD WA\${srcTag}: \${contactName} — \"\${detectedInterest.slice(0,60)}\" — atiéndelo ahora.\`).catch(()=>{});`,
   `      alertStaff(tenant, assignedObj, '🔔 Nuevo Lead WA', \`🔔 NUEVO LEAD WA\${srcTag}: \${contactName} — "\${detectedInterest.slice(0,60)}" — atiéndelo ahora.\`);`],
  [`      if(_av?.phone)sendWA(_av.phone,'\\u{1F514} '+prevSrc+': '+ld[tenant][idx].name+' respondio! Ya esta en tu embudo.').catch(()=>{});`,
   `      alertStaff(tenant, _av, '🔔 Lead respondió', '🔔 '+prevSrc+': '+ld[tenant][idx].name+' respondió! Ya está en tu embudo.');`],
  [`            sendWA(_av.phone, \`🔔 REINGRESO MULTICANAL: \${ld[tenant][idx].name} volvió a cotizar. Nuevo origen: \${newSource} (\${newInterest}). Revisa el CRM.\`).catch(()=>{});`,
   `            alertStaff(tenant, _av, '🔔 Reingreso', \`🔔 REINGRESO MULTICANAL: \${ld[tenant][idx].name} volvió a cotizar. Nuevo origen: \${newSource} (\${newInterest}). Revisa el CRM.\`);`],
  [`          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Reasignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.').catch(()=>{});`,
   `          alertStaff(tenant, assignedUserWH, '✅ Lead Reasignado', '✅ Lead Reasignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.');`],
  [`          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Asignado: '+ld[tenant][idx].name+'. Revisa la bitácora del CRM.').catch(()=>{});`,
   `          alertStaff(tenant, assignedUserWH, '✅ Lead Asignado', '✅ Lead Asignado: '+ld[tenant][idx].name+'. Revisa la bitácora del CRM.');`],
];
let n=0; for(const [f,r] of reps){ if(s.includes(f)){s=s.replace(f,r);n++;} }
console.log(`✅ ${n}/${reps.length} alertas reemplazadas`);

// 2. Endpoint analisis-ia
const EP_OLD = `app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));`;
const EP_NEW = `// ── ANÁLISIS IA DE LEADS ────────────────────────────────────────
app.post('/api/leads/analisis-ia', auth('admin','vendedor'), async (req, res) => {
  try {
    const { leadIds, filtros } = req.body || {};
    const allLeads = await tRead(F.leads, req.tenant);
    const allUsers = await tRead(F.users, req.tenant);
    let leads = allLeads;
    if (leadIds && leadIds.length) {
      leads = allLeads.filter(l => leadIds.includes(String(l.id)));
    } else if (filtros) {
      if (filtros.source) leads = leads.filter(l => l.source === filtros.source);
      if (filtros.status) leads = leads.filter(l => l.status === filtros.status);
      if (filtros.assignedTo) leads = leads.filter(l => l.assignedTo === filtros.assignedTo);
      if (filtros.desde) leads = leads.filter(l => new Date(l.lastInteraction||l.createdAt||0) >= new Date(filtros.desde));
      if (filtros.hasta) leads = leads.filter(l => new Date(l.lastInteraction||l.createdAt||0) <= new Date(filtros.hasta));
    }
    if (!leads.length) return res.status(400).json({ error: 'No hay leads con esos criterios' });
    if (leads.length > 50) return res.status(400).json({ error: 'Máximo 50 leads por análisis. Aplica más filtros.' });
    const contexto = leads.map(l => {
      const vendedor = allUsers.find(u => u.username === l.assignedTo)?.name || l.assignedTo || 'Sin asignar';
      const diasSinActividad = l.lastClientTs ? Math.floor((Date.now() - new Date(l.lastClientTs).getTime()) / 86400000) : '?';
      const diasCreado = l.createdAt ? Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 86400000) : '?';
      const chat = (l.chatHistory || []).slice(-10).map(m => \`[\${m.role}]: \${m.content?.slice(0,150)}\`).join('\\n');
      const notas = (l.notes || []).slice(-5).map(n => \`\${n.author}: \${n.content?.slice(0,100)}\`).join('\\n');
      return \`---\\nLEAD: \${l.name} | TEL: \${l.phone} | ORIGEN: \${l.source} | ESTADO: \${l.status}\\nVENDEDOR: \${vendedor} | DÍAS SIN ACTIVIDAD: \${diasSinActividad} | DÍAS EN CRM: \${diasCreado}\\nINTERÉS: \${l.interest||'No especificado'}\\nNOTAS: \${notas||'Sin notas'}\\nCHAT:\\n\${chat||'Sin historial'}\`;
    }).join('\\n\\n');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 3000,
      messages: [{ role: 'user', content: \`Eres un analista comercial senior de una automotora. Analiza los siguientes leads del CRM y entrega un reporte estratégico.\\n\\nPara cada lead indica:\\n1. Situación actual y diagnóstico\\n2. Tiempo estancado y posible razón\\n3. Acción concreta recomendada (específica, no genérica)\\n4. Urgencia: 🔴 Alta / 🟡 Media / 🟢 Baja\\n\\nAl final: resumen por vendedor y top 3 acciones prioritarias.\\n\\n\${contexto}\\n\\nResponde en español, formato claro con separadores entre leads.\` }]
    });
    res.json({ ok: true, reporte: completion.choices[0].message.content, totalLeads: leads.length });
  } catch(e) { console.error('[ANALISIS-IA]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));`;

if (!s.includes('/api/leads/analisis-ia')) { s = s.replace(EP_OLD, EP_NEW); console.log('✅ Endpoint analisis-ia agregado'); }
else console.log('⚠️ Endpoint ya existe');

fs.writeFileSync(sf, s, 'utf8');
console.log('✅ server.js guardado');

# -*- coding: utf-8 -*-
# patch_sla_retargeting.py — Sprint 3: alertas SLA riesgo + retargeting post-link
# Ejecutar desde la raiz del proyecto: python3 patch_sla_retargeting.py

import re, sys, subprocess

SRV = 'server.js'
src = open(SRV, 'r', encoding='utf-8').read()

# ═════════════════════════════════════════════════════════════════════════════
# Cron nuevo que se inyecta DESPUES del cron de IA Proactiva existente
# ═════════════════════════════════════════════════════════════════════════════
ANCHOR = "},60000);\napp.use(express.static(path.join(__dirname,'public')));"
if ANCHOR not in src:
    print('FALLO — anchor cron IA Proactiva no encontrado'); sys.exit(1)

NEW_CRON = '''},60000);

// ════════════════════════════════════════════════════════════════════════════
// CRON Sprint 3 — Alertas SLA Riesgo (20m) + Retargeting Post-Link (2m)
// Corre cada 30 segundos. Cada lead lleva flags para evitar repeticion.
// ════════════════════════════════════════════════════════════════════════════
setInterval(async () => {
  for (const t of TENANTS) {
    try {
      const leads = await tRead(F.leads, t);
      const users = await tRead(F.users, t);
      let changed = false;

      for (const lead of leads) {
        if (FINAL_ST.has(lead.status)) continue;

        // ─── TAREA 1: Alerta SLA riesgo a los 20 min sin atencion ──────────
        if (lead.status === 'Nuevo' && !lead.reassigned && !lead.riskAlertSent) {
          const ref = lead.lastClientTs || lead.lastInteraction;
          if (ref) {
            const minsSinAtencion = (Date.now() - new Date(ref).getTime()) / 60000;
            if (minsSinAtencion >= 20 && minsSinAtencion < 30) {
              const assigned = users.find(u => u.username === lead.assignedTo)
                            || RMG_VENDORS.find(v => v.username === lead.assignedTo);
              if (assigned && assigned.phone) {
                const msg = '🚨 ALERTA: El lead [' + lead.name + '] lleva 20 min sin atención. '
                          + 'Te quedan 10 min antes de que el sistema lo reasigne.';
                sendWA(assigned.phone, msg).catch(() => {});
                console.log('[SLA-Risk] Alerta 20m enviada a', assigned.username, 'por lead', lead.name);
              }
              lead.riskAlertSent = true;
              changed = true;
            }
          }
        }

        // ─── TAREA 2: Retargeting Post-Link a los 2 min sin respuesta ──────
        if (lead.botActive === true && !lead.followUpSent && Array.isArray(lead.chatHistory) && lead.chatHistory.length) {
          // Buscar el ULTIMO mensaje del bot que contiene rmgautos.cl
          let lastLinkTs = null;
          for (let i = lead.chatHistory.length - 1; i >= 0; i--) {
            const m = lead.chatHistory[i];
            if ((m.role === 'bot' || m.role === 'ia_proactiva') && m.content && m.content.indexOf('rmgautos.cl') !== -1) {
              lastLinkTs = m.ts || null;
              break;
            }
            if (m.role === 'user') break; // si el ultimo es del user, no hay link sin respuesta
          }
          if (lastLinkTs) {
            const last = lead.chatHistory[lead.chatHistory.length - 1];
            const isLastFromBot = last.role === 'bot' || last.role === 'ia_proactiva';
            const minsDesdeLink = (Date.now() - lastLinkTs) / 60000;
            if (isLastFromBot && minsDesdeLink >= 2) {
              const phone = (lead.phone || '').replace(/\\D/g, '');
              if (phone) {
                const followUp = '¿Pudiste ver la ficha en el enlace? 👀 Fíjate en el equipamiento, ¡es lo que más preguntan! ¿Qué te pareció?';
                sendWA(phone, followUp).catch(() => {});
                lead.chatHistory.push({ role: 'ia_proactiva', content: followUp, ts: Date.now(), agentName: 'Retargeting Bot' });
                lead.lastInteraction = new Date().toISOString();
                lead.followUpSent = true;
                changed = true;
                console.log('[Retargeting] Follow-up enviado a', lead.name);
              }
            }
          }
        }
      }

      if (changed) await tWrite(F.leads, t, leads);
    } catch (e) {
      console.error('[Sprint3-Cron]', t, e.message);
    }
  }
}, 30000);

app.use(express.static(path.join(__dirname,'public')));'''

src = src.replace(ANCHOR, NEW_CRON, 1)
print('OK [cron SLA Risk 20m + Retargeting 2m inyectado]')

# Reset flags cuando se resetea memoria del lead — agregar a /reset (ambos endpoints)
# En /api/chat
RESET_OLD_1 = "leads[idx].status='Nuevo';leads[idx].alertLevel='none';leads[idx].unread=true;leads[idx].reassigned=false;leads[idx].reassignedAt=null;leads[idx].adminReassignAlertSent=false;"
RESET_NEW_1 = RESET_OLD_1 + "leads[idx].riskAlertSent=false;leads[idx].followUpSent=false;"
if RESET_OLD_1 in src:
    src = src.replace(RESET_OLD_1, RESET_NEW_1, 1)
    print('OK [reset /api/chat incluye flags Sprint3]')

# En /webhook
RESET_OLD_2 = "ld[tenant][idx].status='Nuevo';ld[tenant][idx].alertLevel='none';ld[tenant][idx].unread=true;ld[tenant][idx].reassigned=false;ld[tenant][idx].reassignedAt=null;ld[tenant][idx].adminReassignAlertSent=false;"
RESET_NEW_2 = RESET_OLD_2 + "ld[tenant][idx].riskAlertSent=false;ld[tenant][idx].followUpSent=false;"
if RESET_OLD_2 in src:
    src = src.replace(RESET_OLD_2, RESET_NEW_2, 1)
    print('OK [reset /webhook incluye flags Sprint3]')

open(SRV, 'w', encoding='utf-8').write(src)

r = subprocess.run(['node', '--check', SRV], capture_output=True, text=True)
if r.returncode != 0:
    print('ERROR SINTAXIS:\\n' + r.stderr); sys.exit(1)
print('Sintaxis Node.js OK')

print('\\nDeploy:')
print('git add server.js && git commit -m "feat: SLA risk 20m + retargeting post-link 2m" && git push')

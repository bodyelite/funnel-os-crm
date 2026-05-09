#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

fs.readdirSync(__dirname)
  .filter(f => /^patch_v\d+\.js$/.test(f))
  .forEach(f => { fs.unlinkSync(path.join(__dirname, f)); console.log('🗑  ' + f); });

function applyPatch(filepath, label, oldStr, newStr) {
  const src = fs.readFileSync(filepath, 'utf8');
  const idx = src.indexOf(oldStr);
  if (idx === -1) { console.error('❌  PATCH ' + label + ': bloque no encontrado en ' + filepath); process.exit(1); }
  fs.writeFileSync(filepath, src.slice(0, idx) + newStr + src.slice(idx + oldStr.length), 'utf8');
  console.log('✅  PATCH ' + label);
}

const SERVER = path.join(__dirname, 'server.js');
const HTML   = path.join(__dirname, 'public', 'index.html');

// ══════════════════════════════════════════════════════════════════════════════
// SERVER — S1: /api/leads garantiza chatHistory siempre como array
// ══════════════════════════════════════════════════════════════════════════════
applyPatch(SERVER, 'S1 — /api/leads: chatHistory siempre []',
  `app.get('/api/leads', auth(), async (req, res) => {
  const all = await applySlaRules(req.tenant);
  res.json(filterByRole(all, req.user));
});`,
  `app.get('/api/leads', auth(), async (req, res) => {
  const all = await applySlaRules(req.tenant);
  const leads = filterByRole(all, req.user)
    .map(l => ({ ...l, chatHistory: Array.isArray(l.chatHistory) ? l.chatHistory : [] }));
  res.json(leads);
});`
);

// ══════════════════════════════════════════════════════════════════════════════
// HTML — F1: loadMonitor() muestra TODOS los leads activos (no solo con chatHistory)
// ══════════════════════════════════════════════════════════════════════════════
applyPatch(HTML, 'F1 — loadMonitor: todos los leads activos sin filtro chatHistory',
  `    chats = (await r.json()).filter(x => Array.isArray(x.chatHistory) && x.chatHistory.length)
      .sort((a, b) => new Date(b.lastInteraction) - new Date(a.lastInteraction));`,
  `    const FINAL_ST = new Set(['Cerrado', 'Abandonado']);
    chats = (await r.json())
      .filter(x => !FINAL_ST.has(x.status))
      .map(x => ({ ...x, chatHistory: Array.isArray(x.chatHistory) ? x.chatHistory : [] }))
      .sort((a, b) => new Date(b.lastInteraction) - new Date(a.lastInteraction));`
);

// ══════════════════════════════════════════════════════════════════════════════
// HTML — F2: renderMonitorList() no rompe con chatHistory vacío
// ══════════════════════════════════════════════════════════════════════════════
applyPatch(HTML, 'F2 — renderMonitorList: preview seguro con chatHistory vacío',
  `  $('monList').innerHTML = chats.length ? chats.map(c => {
    const last = c.chatHistory[c.chatHistory.length-1];
    const m = calcMin(c.lastInteraction);
    const isAlert = m > 20 && !['Cerrado','Abandonado'].includes(c.status);
    return \`
      <div class="cr \${c.id===activeChatId?'active':''}" onclick="selectChat(\${c.id})">
        <div class="cr-avatar">\${initials(c.name)}</div>
        <div class="cr-info">
          <div class="cr-top"><span class="cr-name">\${escape(c.name)}</span><span class="cr-time">\${fmtSLA(c.lastInteraction)}</span></div>
          <div class="cr-preview">\${escape(last.content)}</div>
        </div>
        <div class="cr-status \${isAlert?'alert':''}"></div>
      </div>\`;
  }).join('') : '<div class="empty" style="padding:32px 20px;font-size:12.5px;">Cuando los leads chateen, aparecerán aquí.</div>';`,
  `  $('monList').innerHTML = chats.length ? chats.map(c => {
    const last = c.chatHistory.length ? c.chatHistory[c.chatHistory.length - 1] : null;
    const m = calcMin(c.lastInteraction);
    const isAlert = m > 20 && !['Cerrado','Abandonado'].includes(c.status);
    return \`
      <div class="cr \${c.id===activeChatId?'active':''}" onclick="selectChat(\${c.id})">
        <div class="cr-avatar">\${initials(c.name)}</div>
        <div class="cr-info">
          <div class="cr-top"><span class="cr-name">\${escape(c.name)}</span><span class="cr-time">\${fmtSLA(c.lastInteraction)}</span></div>
          <div class="cr-preview">\${last ? escape(last.content) : '<em style="color:var(--text-mute);">Sin mensajes aún · nuevo lead</em>'}</div>
        </div>
        <div class="cr-status \${isAlert?'alert':''}"></div>
      </div>\`;
  }).join('') : '<div class="empty" style="padding:32px 20px;font-size:12.5px;">Sin leads activos.</div>';`
);

// ══════════════════════════════════════════════════════════════════════════════
// HTML — F3: renderConv() no rompe con chatHistory vacío, muestra estado inicial
// ══════════════════════════════════════════════════════════════════════════════
applyPatch(HTML, 'F3 — renderConv: chatHistory vacío muestra placeholder',
  `    <div class="conv-msgs" id="convMsgs">
      \${c.chatHistory.map(m => {
        const cls = m.role === 'user' ? 'user' : (m.role === 'agent' ? 'agent' : 'bot');
        return \`<div class="conv-bubble \${cls}">\${escape(m.content)}\${m.ts?\`<span class="ts">\${fmtTime(m.ts)}</span>\`:''}</div>\`;
      }).join('')}
    </div>`,
  `    <div class="conv-msgs" id="convMsgs">
      \${c.chatHistory.length
        ? c.chatHistory.map(m => {
            const cls = m.role === 'user' ? 'user' : (m.role === 'agent' ? 'agent' : 'bot');
            return \`<div class="conv-bubble \${cls}">\${escape(m.content)}\${m.ts?\`<span class="ts">\${fmtTime(m.ts)}</span>\`:''}</div>\`;
          }).join('')
        : \`<div style="flex:1;display:flex;align-items:center;justify-content:center;
              text-align:center;color:var(--text-mute);font-size:13px;padding:32px;line-height:1.6;">
              💬<br><strong style="color:var(--text-soft);">Aún no hay mensajes.</strong><br>
              Escribe para iniciar la conversación con \${escape(c.name)}.
            </div>\`}
    </div>`
);

console.log('\n🎉  patch_chats.js OK — server.js (S1) + index.html (F1-F3) actualizados\n');

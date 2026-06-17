const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

const OLD = `    const sndRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/messages\`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(msgBody)
    });
    
    fsSync.unlinkSync(req.file.path); // Borrar temporal

    if(sndRes.ok) {
      leads[idx].chatHistory = leads[idx].chatHistory || [];
      leads[idx].chatHistory.push({ role: 'agent', content: '[ARCHIVO ENVIADO AL CLIENTE]', ts: Date.now(), agent: req.user.username });
      await tWrite(F.leads, req.tenant, leads);
      return res.json({ success: true });
    } else {
      const err = await sndRes.json();
      return res.status(502).json({error: 'Error al enviar por WA', details: err});
    }`;

const NEW = `    const sndRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/messages\`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(msgBody)
    });
    const sndJson = await sndRes.json();
    console.log('[SEND-MEDIA] mediaId:', mediaId, '| response:', JSON.stringify(sndJson));
    
    try { fsSync.unlinkSync(req.file.path); } catch(_) {}

    if(sndRes.ok && sndJson.messages) {
      leads[idx].chatHistory = leads[idx].chatHistory || [];
      leads[idx].chatHistory.push({ role: 'agent', content: '[ARCHIVO ENVIADO AL CLIENTE]', ts: Date.now(), agent: req.user.username });
      await tWrite(F.leads, req.tenant, leads);
      return res.json({ success: true });
    } else {
      return res.status(502).json({error: 'Error al enviar por WA', details: sndJson});
    }`;

if (code.includes(OLD)) {
  code = code.replace(OLD, NEW);
  fs.writeFileSync(file, code, 'utf8');
  console.log('✅ Listo');
} else {
  console.log('❌ Bloque no encontrado');
}

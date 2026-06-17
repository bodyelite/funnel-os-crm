const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

const OLD = `    // Enviar directamente con link público (Meta descarga el archivo)
    const msgBody = {
      messaging_product: 'whatsapp',
      to: phone,
      type: type,
      [type]: { link: publicUrl }
    };

    const sndRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/messages\`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(msgBody)
    });

    // Borrar temporal después de 60s (Meta necesita tiempo para descargarlo)
    setTimeout(() => { try { fsSync.unlinkSync(req.file.path); } catch(_){} }, 60000);

    if(sndRes.ok) {
      leads[idx].chatHistory = leads[idx].chatHistory || [];
      leads[idx].chatHistory.push({ role: 'agent', content: '[ARCHIVO ENVIADO AL CLIENTE]', ts: Date.now(), agent: req.user.username });
      await tWrite(F.leads, req.tenant, leads);
      return res.json({ success: true });
    } else {
      const err = await sndRes.json();
      fsSync.unlinkSync(req.file.path);
      return res.status(502).json({error: 'Error al enviar por WA', details: err});
    }`;

const NEW = `    // Enviar con link público (Meta descarga el archivo)
    const mediaObj = { link: publicUrl };
    if (type === 'document') mediaObj.filename = req.file.originalname || tmpName;

    const msgBody = {
      messaging_product: 'whatsapp',
      to: phone,
      type: type,
      [type]: mediaObj
    };

    const sndRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/messages\`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(msgBody)
    });
    const sndJson = await sndRes.json();
    console.log('[SEND-MEDIA] to:', phone, '| type:', type, '| url:', publicUrl, '| response:', JSON.stringify(sndJson));

    // Borrar temporal después de 60s
    setTimeout(() => { try { fsSync.unlinkSync(req.file.path); } catch(_){} }, 60000);

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

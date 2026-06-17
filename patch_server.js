const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

const OLD = `app.post('/api/leads/:id/send-media', auth('admin','vendedor'), uploadWA.single('file'), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({error: 'Archivo requerido'});
    const leads = await tRead(F.leads, req.tenant);
    const idx = leads.findIndex(x => x.id == req.params.id);
    if(idx === -1) return res.status(404).json({error: 'Lead no encontrado'});
    
    const token = (process.env.WA_TOKEN || '').trim();
    const phoneId = (process.env.WA_PHONE_ID || '').trim();
    const phone = (leads[idx].phone || '').replace(/\\D/g,'');
    if(!token || !phoneId || !phone) return res.status(500).json({error: 'WA no configurado o sin telefono'});

    // 1. Subir archivo a los servidores de Meta
    const form = new (require('form-data'))();
    form.append('file', fsSync.createReadStream(req.file.path), { contentType: req.file.mimetype });
    form.append('type', req.file.mimetype);
    form.append('messaging_product', 'whatsapp');
    
    const upRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/media\`, {
      method: 'POST',
      headers: { ...form.getHeaders(), Authorization: 'Bearer ' + token },
      body: form
    });
    const upJson = await upRes.json();
    if(!upJson.id) return res.status(502).json({error: 'Fallo al subir a Meta', details: upJson});
    const mediaId = upJson.id;

    // 2. Enviar el ID del archivo al cliente
    let type = 'document';
    if(req.file.mimetype.startsWith('image/')) type = 'image';
    if(req.file.mimetype.startsWith('video/')) type = 'video';

    const msgBody = {
      messaging_product: 'whatsapp',
      to: phone,
      type: type,
      [type]: { id: mediaId }
    };

    const sndRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/messages\`, {
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
    }
  } catch(e) {
    console.error(e);
    res.status(500).json({error: e.message});
  }
});`;

const NEW = `app.post('/api/leads/:id/send-media', auth('admin','vendedor'), uploadWA.single('file'), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({error: 'Archivo requerido'});
    const leads = await tRead(F.leads, req.tenant);
    const idx = leads.findIndex(x => x.id == req.params.id);
    if(idx === -1) return res.status(404).json({error: 'Lead no encontrado'});

    const token = (process.env.WA_TOKEN || '').trim();
    const phoneId = (process.env.WA_PHONE_ID || '').trim();
    const phone = (leads[idx].phone || '').replace(/\\D/g,'');
    if(!token || !phoneId || !phone) return res.status(500).json({error: 'WA no configurado o sin telefono'});

    // Servir el archivo temporalmente como URL pública
    const tmpName = req.file.filename || path.basename(req.file.path);
    const publicUrl = (process.env.RENDER_EXTERNAL_URL || 'https://body-elite-giftcards.onrender.com') + '/tmp-media/' + tmpName;

    // Determinar tipo
    let type = 'document';
    if(req.file.mimetype.startsWith('image/')) type = 'image';
    if(req.file.mimetype.startsWith('video/')) type = 'video';

    // Enviar directamente con link público (Meta descarga el archivo)
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
    }
  } catch(e) {
    console.error(e);
    res.status(500).json({error: e.message});
  }
});`;

if (code.includes(OLD)) {
  code = code.replace(OLD, NEW);
  // Agregar ruta estática para servir archivos temporales
  const STATIC_OLD = `app.use(express.static(path.join(__dirname,'public')));`;
  const STATIC_NEW = `app.use(express.static(path.join(__dirname,'public')));
app.use('/tmp-media', require('express').static('/tmp'));`;
  if (code.includes(STATIC_OLD) && !code.includes('/tmp-media')) {
    code = code.replace(STATIC_OLD, STATIC_NEW);
    console.log('✅ Ruta /tmp-media agregada');
  }
  fs.writeFileSync(file, code, 'utf8');
  console.log('✅ Listo — send-media usa URL pública en vez de upload binario');
} else {
  console.log('❌ Bloque no encontrado');
}

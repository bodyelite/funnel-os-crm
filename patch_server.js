const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

const OLD = `app.post('/api/leads/:id/send-template', auth('admin','vendedor'), async (req, res) => {
  try {
    const tenant = req.tenant;
    const { templateName, params } = req.body;
    if (!templateName) return res.status(400).json({ error: 'templateName requerido' });
    const leads = await tRead(F.leads, tenant);
    const lead = leads.find(l => l.id == req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
    const token = (process.env.WA_TOKEN || '').trim(), phoneId = (process.env.WA_PHONE_ID || '').trim();
    if (!token || !phoneId) return res.status(500).json({ error: 'WA no configurado' });
    const phone = lead.phone?.replace(/\\D/g,'');
    if (!phone) return res.status(400).json({ error: 'Lead sin teléfono' });
    const components = [];
    if (params && params.length) {
      components.push({
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: String(p) }))
      });
    }
    const lang = req.body.language || 'es';
    const waRes = await fetch(\`https://graph.facebook.com/v19.0/\${phoneId}/messages\`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: phone, type: 'template',
        template: { name: templateName, language: { code: lang }, components }
      })
    });
    const waJson = await waRes.json();
    if (!waRes.ok) return res.status(502).json({ error: 'WA error', detail: waJson });
    // Registrar en chatHistory
    const idx = leads.findIndex(l => l.id == req.params.id);
    leads[idx].chatHistory = leads[idx].chatHistory || [];
    leads[idx].chatHistory.push({ role: 'bot', content: \`[PLANTILLA WA ENVIADA: \${templateName}]\`, ts: Date.now() });
    if (leads[idx].waSequence) {
      leads[idx].waSequence.step = 4;
      leads[idx].waSequence.lastSentAt = new Date().toISOString();
    }
    await tWrite(F.leads, tenant, leads);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});`;

const NEW = `app.post('/api/leads/:id/send-template', auth('admin','vendedor'), async (req, res) => {
  try {
    const tenant = req.tenant;
    const { templateName, params } = req.body;
    if (!templateName) return res.status(400).json({ error: 'templateName requerido' });
    const leads = await tRead(F.leads, tenant);
    const idx = leads.findIndex(l => l.id == req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Lead no encontrado' });
    const phone = (leads[idx].phone || '').replace(/\\D/g,'');
    if (!phone) return res.status(400).json({ error: 'Lead sin teléfono' });
    const ok = await sendWATemplate(phone, templateName, params || []);
    if (!ok) return res.status(502).json({ error: 'Error al enviar plantilla WA' });
    leads[idx].chatHistory = leads[idx].chatHistory || [];
    leads[idx].chatHistory.push({ role: 'bot', content: \`[PLANTILLA WA ENVIADA: \${templateName}]\`, ts: Date.now() });
    await tWrite(F.leads, tenant, leads);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});`;

if (code.includes(OLD)) {
  code = code.replace(OLD, NEW);
  fs.writeFileSync(file, code, 'utf8');
  console.log('✅ Listo — endpoint send-template ahora usa sendWATemplate');
} else {
  console.log('❌ Bloque no encontrado — puede que ya esté aplicado');
}

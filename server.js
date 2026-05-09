'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.RENDER ? '/var/data' : path.join(__dirname, 'data');
if (!fsSync.existsSync(DATA)) fsSync.mkdirSync(DATA, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const F = {
  users: path.join(DATA, 'users.json'),
  leads: path.join(DATA, 'leads.json'),
  config: path.join(DATA, 'config.json'),
  bot: path.join(DATA, 'bot.json'),
  inventory: path.join(DATA, 'inventory.json'),
  rr: path.join(DATA, 'rr.json'),
  spend: path.join(DATA, 'spend.json')
};

const TENANTS = ['demo_automotora', 'demo_clinica'];
const sessions = new Map();
const chatSessions = new Map();

// SLA reglas
const SLA_FRESH = 10, SLA_RISK = 20, SLA_CRITICAL = 30, SLA_REASSIGN = 30, SLA_GERENCIA = 15;
const ACTIVE_STATUSES = new Set(['Nuevo', 'En Proceso', 'Agendado', 'Seguimiento', 'Lead Calificado - Contacto Agendado']);
const FINAL_STATUSES = new Set(['Cerrado', 'Abandonado']);

const read = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return {}; } };
const write = (f, d) => fs.writeFile(f, JSON.stringify(d, null, 2));
const tRead = async (f, t, fb = []) => { const s = await read(f); return s[t] !== undefined ? s[t] : fb; };
const tWrite = async (f, t, d) => { const s = await read(f); s[t] = d; await write(f, s); };
const validTenant = (t) => TENANTS.includes(t) ? t : TENANTS[0];

// FILTRO ESCUDO
const SHIELD_KEYWORDS = ['body elite', 'botox', 'lipo', 'lipoescultura', 'estetica', 'masaje', 'doctora', 'tratamiento', 'acido', 'hialuronico'];
const SHIELD_RESPONSE = '¡Hola! Este número ahora es exclusivo de Automotora Andes. Si buscas a la clínica Body Elite, por favor contáctalos a través de su Instagram o canales oficiales. ¡Gracias!';

function isResidualTraffic(msg) {
  const m = (msg || '').toLowerCase();
  return SHIELD_KEYWORDS.some(kw => m.includes(kw));
}

// LOGICA MARCELA
function reagendarSiFueraHorario(msg) {
  const m = (msg || '').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const meridiem = (m[3] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return (hour >= 9 && hour < 20) ? null : { sugerido: 'mañana a las 09:00 hrs' };
}

async function getMarcelaResponse(tenant, history, msg) {
  const inv = await tRead(F.inventory, tenant, []);
  const invStr = inv.map(i => `- [${i.id}] ${i.model} ${i.year} | Stock: ${i.stock} | $${(i.price || 0).toLocaleString('es-CL')} | ${i.highlights}`).join('\n');
  
  const prompt = `Eres Marcela, asesora comercial de Automotora Andes. Hablas español de Chile.
  INVENTARIO: ${invStr}
  REGLAS:
  1. Si preguntan por un modelo, ofrece 1 o 2 alternativas similares del inventario.
  2. CTA OBLIGATORIO si hay interés: "¿Te gustaría que te llame un ejecutivo para darte el mejor precio o coordinar una prueba de manejo? Trabajamos de 09:00 a 20:00 hrs. Dime qué día y a qué hora te acomoda más."
  3. Si proponen horario fuera de 09:00-20:00, re-agenda para mañana a las 09:00.
  
  RESPONDE SIEMPRE EN JSON:
  { "reply": "...", "intent_signal": "BLUE"|"YELLOW"|"NONE", "schedule": "..." }`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: prompt }, ...history.slice(-10), { role: "user", content: msg }]
  });
  
  return JSON.parse(completion.choices[0].message.content);
}

// ENDPOINTS API (RESTAURADOS)
app.post('/api/auth/login', async (req, res) => {
  const { username, password, tenant } = req.body;
  const t = validTenant(tenant);
  const users = await tRead(F.users, t);
  const u = users.find(x => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = crypto.randomBytes(24).toString('hex');
  const safe = { username: u.username, name: u.name, role: u.role };
  sessions.set(token, { user: safe, tenant: t });
  res.json({ token, user: safe, tenant: t });
});

app.get('/api/leads', async (req, res) => {
  const token = req.header('X-Auth-Token');
  const sess = sessions.get(token);
  if (!sess) return res.status(401).json({ error: 'No autenticado' });
  const leads = await tRead(F.leads, sess.tenant);
  res.json(sess.user.role === 'vendedor' ? leads.filter(l => l.assignedTo === sess.user.username) : leads);
});

app.get('/api/pipeline', async (req, res) => {
  const token = req.header('X-Auth-Token');
  const sess = sessions.get(token);
  if (!sess) return res.status(401).json({ error: 'No autenticado' });
  const cfg = await tRead(F.config, sess.tenant);
  const leads = await tRead(F.leads, sess.tenant);
  const filtered = sess.user.role === 'vendedor' ? leads.filter(l => l.assignedTo === sess.user.username) : leads;
  res.json((cfg.stages || []).map(s => ({ stage: s, leads: filtered.filter(l => l.status === s) })));
});

// WEBHOOKS WHATSAPP
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === 'zara_token_123') {
    res.status(200).send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msgObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msgObj || !msgObj.text) return;

  const from = msgObj.from;
  const text = msgObj.text.body;

  if (isResidualTraffic(text)) {
    await sendWhatsAppMessage(from, SHIELD_RESPONSE);
    return;
  }

  const tenant = 'demo_automotora';
  const leadsData = await read(F.leads);
  if (!leadsData[tenant]) leadsData[tenant] = [];
  let idx = leadsData[tenant].findIndex(l => l.phone && l.phone.includes(from));

  if (idx === -1) {
    leadsData[tenant].unshift({ id: Date.now(), name: 'WhatsApp Lead', phone: from, status: 'Nuevo', chatHistory: [], botActive: true });
    idx = 0;
  }

  const lead = leadsData[tenant][idx];
  lead.chatHistory.push({ role: 'user', content: text, ts: Date.now() });

  if (lead.botActive) {
    const { reply, intent_signal } = await getMarcelaResponse(tenant, lead.chatHistory.slice(0,-1), text);
    lead.chatHistory.push({ role: 'bot', content: reply, ts: Date.now() });
    if (intent_signal !== "NONE") {
      lead.status = 'Lead Calificado - Contacto Agendado';
      lead.intentSignal = intent_signal;
    }
    await sendWhatsAppMessage(from, reply);
  }
  await write(F.leads, leadsData);
});

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v17.0/${process.env.WA_PHONE_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, text: { body: text } })
  });
}

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

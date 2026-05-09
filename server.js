'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder' });

// ─── ENV de WhatsApp Cloud API ────────────────────────────────────────────────
const WA_TOKEN = process.env.WA_TOKEN || '';
const WA_PHONE_ID = process.env.WA_PHONE_ID || '';
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'funnelos_verify_2026';

// ─── Helpers de archivos ──────────────────────────────────────────────────────
function readJSON(file, fallback = {}) {
  try {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('readJSON error', file, e.message);
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

// ─── Auth mínimo (demo) ───────────────────────────────────────────────────────
function auth() {
  return (req, res, next) => {
    const tenant = req.headers['x-tenant-id'] || req.query.tenant || 'demo_automotora';
    const username = req.headers['x-user'] || 'gerente';
    const users = readJSON('users.json', {});
    const tenantUsers = users[tenant] || [];
    const user = tenantUsers.find(u => u.username === username) || tenantUsers[0];
    req.tenant = tenant;
    req.user = user || { username: 'gerente', role: 'admin', name: 'Demo' };
    next();
  };
}

function filterByRole(leads, user) {
  if (!user) return leads;
  if (user.role === 'admin' || user.role === 'secretaria') return leads;
  return leads.filter(l => !l.assignedTo || l.assignedTo === user.username);
}

async function applySlaRules(tenant) {
  const all = readJSON('leads.json', {});
  return all[tenant] || [];
}

// ─── Sesiones de chat por sessionId / phone ───────────────────────────────────
const sessions = new Map();

function getSession(sessionId, tenant) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      tenant,
      history: [],
      leadId: null
    });
  }
  return sessions.get(sessionId);
}

// ─── Validación de horario (09:00 - 20:00) ────────────────────────────────────
function reagendarSiFueraHorario(textoUsuario) {
  const m = (textoUsuario || '').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const meridiem = (m[3] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour >= 9 && hour < 20) return null;
  return { reagendar: true, sugerido: 'mañana a las 09:00 hrs' };
}

// ─── Marcela: System prompt ───────────────────────────────────────────────────
function buildMarcelaPrompt(tenant, inventarioStr, businessName) {
  return `Eres Marcela, asesora comercial virtual de ${businessName}. Tu tono es cercano, profesional y resolutivo. Hablas en español de Chile.

INVENTARIO DISPONIBLE (úsalo como única fuente de verdad de stock y precios):
${inventarioStr}

REGLAS DE NEGOCIO OBLIGATORIAS:
1. CONSULTORÍA: Cuando el cliente pregunte por un modelo específico, confirma disponibilidad consultando el inventario y SIEMPRE ofrece 1 o 2 alternativas similares disponibles (por categoría, precio o uso).
2. CTA OBLIGATORIO: Cuando detectes interés real (preguntas sobre precio, financiamiento, disponibilidad, prueba de manejo, visita), debes lanzar EXACTAMENTE este texto al final de tu mensaje: "¿Te gustaría que te llame un ejecutivo para darte el mejor precio o coordinar una prueba de manejo? Trabajamos de 09:00 a 20:00 hrs. Dime qué día y a qué hora te acomoda más."
3. HORARIO: Si el cliente propone una hora fuera de 09:00 a 20:00, NO la aceptes. Re-agenda automáticamente para el día siguiente a las 09:00 hrs y confírmalo cordialmente.
4. PRECIOS EN CLP: Formatea los precios como $24.990.000 (puntos como separador de miles).
5. NO inventes modelos, precios ni stock. Si no está en el inventario, dilo y ofrece alternativas reales.

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder SIEMPRE con un único objeto JSON válido, sin texto adicional fuera del JSON, con esta estructura exacta:
{
  "reply": "<texto que verá el cliente>",
  "intent_signal": "NONE" | "BLUE" | "YELLOW",
  "intent_reason": "<breve explicación interna>",
  "schedule_detected": true | false,
  "schedule_text": "<fecha y hora detectadas o vacío>"
}

CRITERIOS DE SEMÁFORO (intent_signal):
- "BLUE": el cliente confirma agenda concreta y explícita (ej: "Voy mañana a las 12", "Sí, llámame hoy a las 18:00", "Perfecto, el sábado a las 10").
- "YELLOW": el cliente muestra intención tibia o ambigua (ej: "Trataré de ir en la tarde", "Quizás mañana", "Lo voy a pensar", "Tal vez después").
- "NONE": no hay respuesta al CTA o aún no se ha lanzado.

Si schedule_detected=true y la hora cae fuera del horario 09:00-20:00, en "reply" propone día siguiente 09:00 hrs.
Recuerda: SOLO devuelve el JSON, sin markdown, sin backticks, sin prefijos.`;
}

function inventarioToString(inv) {
  if (!Array.isArray(inv) || !inv.length) return '(sin inventario cargado)';
  return inv.map(i =>
    `- [${i.id}] ${i.model} ${i.year} | Stock: ${i.stock} | $${(i.price || 0).toLocaleString('es-CL')} | ${i.fuel} | ${i.color} | ${i.highlights}`
  ).join('\n');
}

function safeParseMarcela(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── Núcleo Marcela: dado un sessionId + mensaje, retorna parsed JSON ─────────
async function runMarcela(sessionId, tenant, message) {
  const session = getSession(sessionId, tenant);
  const cfg = readJSON('config.json', {})[tenant] || {};
  const businessName = cfg.businessName || 'nuestra empresa';
  const inv = (readJSON('inventory.json', {})[tenant]) || [];
  const inventarioStr = inventarioToString(inv);

  session.history.push({ role: 'user', content: message });
  const systemPrompt = buildMarcelaPrompt(tenant, inventarioStr, businessName);

  let parsed = null;
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        ...session.history.slice(-12)
      ]
    });
    const raw = completion.choices?.[0]?.message?.content || '';
    parsed = safeParseMarcela(raw);
  } catch (e) {
    console.error('OpenAI error:', e.message);
  }

  if (!parsed) {
    parsed = {
      reply: 'Disculpa, tuve un problema técnico. ¿Puedes repetir tu consulta?',
      intent_signal: 'NONE',
      intent_reason: 'fallback',
      schedule_detected: false,
      schedule_text: ''
    };
  }

  if (parsed.schedule_detected && parsed.schedule_text) {
    const fuera = reagendarSiFueraHorario(parsed.schedule_text);
    if (fuera) {
      parsed.reply += '\n\n(Nota: nuestro horario es de 09:00 a 20:00 hrs. Te propongo agendarte mañana a las 09:00 hrs, ¿te parece?)';
      parsed.intent_signal = 'YELLOW';
    }
  }

  session.history.push({ role: 'assistant', content: parsed.reply });
  return { parsed, session };
}

// ─── Persistencia común de lead + semáforo ────────────────────────────────────
function upsertLeadConSemaforo({ tenant, session, parsed, message, leadInit }) {
  const leadsDB = readJSON('leads.json', {});
  if (!leadsDB[tenant]) leadsDB[tenant] = [];

  let lead = session.leadId ? leadsDB[tenant].find(l => l.id === session.leadId) : null;

  // Buscar por phone si viene en leadInit (caso WhatsApp)
  if (!lead && leadInit?.phone) {
    lead = leadsDB[tenant].find(l => l.phone === leadInit.phone);
    if (lead) session.leadId = lead.id;
  }

  let leadCaptured = false;
  if (!lead) {
    lead = {
      id: Date.now(),
      name: leadInit?.name || 'Lead ' + new Date().toLocaleString('es-CL'),
      phone: leadInit?.phone || '',
      source: leadInit?.source || 'Simulador Chat',
      status: 'Nuevo',
      lastInteraction: new Date().toISOString(),
      interest: message.slice(0, 80),
      assignedTo: 'vendedor1',
      botActive: true,
      alertLevel: 'none',
      intentSignal: 'NONE',
      chatHistory: []
    };
    leadsDB[tenant].push(lead);
    session.leadId = lead.id;
    leadCaptured = true;
  }

  lead.chatHistory = Array.isArray(lead.chatHistory) ? lead.chatHistory : [];
  lead.chatHistory.push({ role: 'user', content: message, ts: Date.now() });
  lead.chatHistory.push({ role: 'bot', content: parsed.reply, ts: Date.now() });
  lead.lastInteraction = new Date().toISOString();

  if (parsed.intent_signal === 'BLUE' || parsed.intent_signal === 'YELLOW') {
    lead.intentSignal = parsed.intent_signal;
    lead.status = 'Lead Calificado - Contacto Agendado';
    lead.scheduleText = parsed.schedule_text || '';
  } else if (!lead.intentSignal) {
    lead.intentSignal = 'NONE';
  }

  writeJSON('leads.json', leadsDB);
  return { lead, leadCaptured };
}

// ─── WhatsApp Cloud API: envío ────────────────────────────────────────────────
async function sendWhatsAppMessage(toPhone, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.warn('⚠️  WA_TOKEN o WA_PHONE_ID no configurados — mensaje no enviado a', toPhone);
    return { ok: false, reason: 'missing_credentials' };
  }
  try {
    const url = `https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: { preview_url: false, body: text }
      })
    });
    const data = await r.json();
    if (!r.ok) console.error('WA send error:', data);
    return { ok: r.ok, data };
  } catch (e) {
    console.error('WA send exception:', e.message);
    return { ok: false, error: e.message };
  }
}

// ─── FILTRO ESCUDO: tráfico residual Body Elite ──────────────────────────────
const SHIELD_KEYWORDS = [
  'body elite', 'bodyelite',
  'lipo', 'lipoescultura', 'liposuccion', 'liposucción',
  'clinica', 'clínica',
  'estetica', 'estética',
  'masaje', 'masajes',
  'doctora', 'doctor',
  'tratamiento', 'tratamientos'
];
const SHIELD_RESPONSE = '¡Hola! Este número ahora es exclusivo de Automotora Andes. Si buscas a la clínica Body Elite, por favor contáctalos a través de su Instagram o canales oficiales. ¡Gracias!';

function isResidualTraffic(msgBody) {
  if (!msgBody) return false;
  const norm = msgBody.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return SHIELD_KEYWORDS.some(kw => {
    const k = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return norm.includes(k);
  });
}

// ─── /api/config y /api/bot ───────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const tenant = req.query.tenant || 'demo_automotora';
  const cfg = readJSON('config.json', {});
  res.json(cfg[tenant] || {});
});

app.get('/api/bot', (req, res) => {
  const tenant = req.query.tenant || 'demo_automotora';
  const bots = readJSON('bot.json', {});
  res.json(bots[tenant] || { greeting: '¡Hola! Soy Marcela, ¿en qué puedo ayudarte?' });
});

// ─── /api/chat (simulador web) ────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message, tenant: bodyTenant } = req.body || {};
    const tenant = bodyTenant || req.headers['x-tenant-id'] || 'demo_automotora';
    if (!sessionId || !message) return res.status(400).json({ reply: 'Datos incompletos.' });

    const { parsed, session } = await runMarcela(sessionId, tenant, message);
    const { lead, leadCaptured } = upsertLeadConSemaforo({
      tenant, session, parsed, message,
      leadInit: { source: 'Simulador Chat' }
    });

    res.json({
      reply: parsed.reply,
      leadCaptured,
      intentSignal: lead.intentSignal,
      status: lead.status
    });
  } catch (e) {
    console.error('chat error', e);
    res.status(500).json({ reply: 'Error interno. Intenta nuevamente.' });
  }
});

// ─── WhatsApp Webhook GET (verificación) ──────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    console.log('✅ Webhook WA verificado');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ─── WhatsApp Webhook POST (mensajes entrantes) ───────────────────────────────
app.post('/webhook', async (req, res) => {
  // ACK rápido para evitar reintentos de Meta
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!messages || !messages.length) return;

    const msg = messages[0];
    const from = msg.from;
    const msg_body = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
    const contactName = value?.contacts?.[0]?.profile?.name || ('Lead WA ' + from);

    if (!msg_body) return;

    // ─── ESCUDO: tráfico residual Body Elite ─────────────────────────────────
    if (isResidualTraffic(msg_body)) {
      console.log('🛡  Escudo activado para', from, '→', msg_body.slice(0, 60));
      await sendWhatsAppMessage(from, SHIELD_RESPONSE);
      return; // no IA, no persistencia
    }

    const tenant = 'demo_automotora';
    const sessionId = 'wa_' + from;

    // Pasamos por Marcela
    const { parsed, session } = await runMarcela(sessionId, tenant, msg_body);

    // Persistimos lead + semáforo
    upsertLeadConSemaforo({
      tenant, session, parsed, message: msg_body,
      leadInit: { name: contactName, phone: from, source: 'WhatsApp' }
    });

    // Enviamos respuesta por WhatsApp
    await sendWhatsAppMessage(from, parsed.reply);
  } catch (e) {
    console.error('webhook error', e);
  }
});

// ─── /api/leads ───────────────────────────────────────────────────────────────
app.get('/api/leads', auth(), async (req, res) => {
  const all = await applySlaRules(req.tenant);
  const leads = filterByRole(all, req.user)
    .map(l => ({
      ...l,
      chatHistory: Array.isArray(l.chatHistory) ? l.chatHistory : [],
      intentSignal: l.intentSignal || 'NONE'
    }));
  res.json(leads);
});

app.patch('/api/leads/:id', auth(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = readJSON('leads.json', {});
  const arr = db[req.tenant] || [];
  const lead = arr.find(l => l.id === id);
  if (!lead) return res.status(404).json({ error: 'no encontrado' });
  Object.assign(lead, req.body || {});
  lead.lastInteraction = new Date().toISOString();
  writeJSON('leads.json', db);
  res.json(lead);
});

// ─── /api/users ───────────────────────────────────────────────────────────────
app.get('/api/users', auth(), (req, res) => {
  const u = readJSON('users.json', {});
  res.json(u[req.tenant] || []);
});

// ─── /api/inventory ───────────────────────────────────────────────────────────
app.get('/api/inventory', auth(), (req, res) => {
  const inv = readJSON('inventory.json', {});
  res.json(inv[req.tenant] || []);
});

app.listen(PORT, () => {
  console.log('🚀 Server listo en http://localhost:' + PORT);
  console.log('📲 Webhook WA:    /webhook  (verify token: ' + WA_VERIFY_TOKEN + ')');
  console.log('🛡  Escudo Body Elite: ACTIVO');
});

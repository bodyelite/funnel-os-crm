'use strict';

// ===== INTELIGENCIA ARTIFICIAL MARCELA (OpenAI - Structured JSON) =====
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.RENDER ? '/var/data' : path.join(__dirname, 'data');
if (!fsSync.existsSync(DATA)) fsSync.mkdirSync(DATA, { recursive: true });

app.use(express.json());

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

// SLA reglas (minutos)
const SLA_FRESH    = 10;
const SLA_RISK     = 20;
const SLA_CRITICAL = 30;
const SLA_REASSIGN = 30;
const SLA_GERENCIA = 15;
const ACTIVE_STATUSES = new Set(['Nuevo', 'En Proceso', 'Agendado', 'Seguimiento', 'Lead Calificado - Contacto Agendado']);
const FINAL_STATUSES  = new Set(['Cerrado', 'Abandonado']);
const QUALIFIED_STAGE = 'Lead Calificado - Contacto Agendado';

const read = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return {}; } };
const write = (f, d) => fs.writeFile(f, JSON.stringify(d, null, 2));
const tRead = async (f, t, fb = []) => { const s = await read(f); return s[t] !== undefined ? s[t] : fb; };
const tWrite = async (f, t, d) => { const s = await read(f); s[t] = d; await write(f, s); };
const validTenant = (t) => TENANTS.includes(t) ? t : TENANTS[0];

// ============================================================================
// ===== MARCELA: NÚCLEO IA CON JSON STRUCTURED OUTPUT =========================
// ============================================================================
function inventarioToString(inv) {
  if (!Array.isArray(inv) || !inv.length) return '(sin inventario cargado)';
  return inv.map(i =>
    `- [${i.id}] ${i.model}${i.year ? ' ' + i.year : ''} | Stock: ${i.stock} | $${(i.price || 0).toLocaleString('es-CL')}${i.fuel ? ' | ' + i.fuel : ''}${i.color ? ' | ' + i.color : ''}${i.highlights ? ' | ' + i.highlights : ''}`
  ).join('\n');
}

function buildMarcelaPrompt(businessName, inventarioStr) {
  return `Eres Marcela, asesora comercial virtual de ${businessName}. Tono cercano, profesional y resolutivo. Hablas español de Chile.

INVENTARIO DISPONIBLE (única fuente de verdad de stock y precios):
${inventarioStr}

REGLAS DE NEGOCIO OBLIGATORIAS:
1. CONSULTORÍA: Cuando el cliente pregunte por un modelo, confirma disponibilidad consultando el inventario y SIEMPRE ofrece 1 o 2 alternativas similares disponibles.
2. CTA OBLIGATORIO: Si detectas interés real (precio, financiamiento, disponibilidad, prueba de manejo, visita), termina tu mensaje EXACTAMENTE con: "¿Te gustaría que te llame un ejecutivo para darte el mejor precio o coordinar una prueba de manejo? Trabajamos de 09:00 a 20:00 hrs. Dime qué día y a qué hora te acomoda más."
3. HORARIO: Si el cliente propone una hora fuera de 09:00 a 20:00, NO la aceptes; re-agenda al día siguiente a las 09:00 hrs.
4. PRECIOS: formato CLP $24.990.000 (puntos como separador de miles).
5. NUNCA inventes modelos, precios ni stock fuera del inventario.

FORMATO DE RESPUESTA OBLIGATORIO — SOLO JSON, sin markdown, sin backticks:
{
  "reply": "<texto que verá el cliente>",
  "intent_signal": "NONE" | "BLUE" | "YELLOW",
  "intent_reason": "<breve nota interna>",
  "schedule_detected": true | false,
  "schedule_text": "<fecha y hora detectadas o vacío>"
}

CRITERIOS DE SEMÁFORO:
- "BLUE": agenda concreta y explícita ("Voy mañana a las 12", "Sí llámame hoy a las 18:00").
- "YELLOW": intención tibia o ambigua ("Trataré de ir", "Quizás mañana", "Lo voy a pensar").
- "NONE": aún no hay respuesta al CTA.`;
}

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

function safeParseMarcela(raw) {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

async function getMarcelaResponse(tenant, history, msg) {
  try {
    const cfgAll = await read(F.config);
    const cfg = cfgAll[tenant] || {};
    const inv = await tRead(F.inventory, tenant, []);
    const businessName = cfg.businessName || 'nuestra empresa';
    const systemPrompt = buildMarcelaPrompt(businessName, inventarioToString(inv));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-12).map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content
      })),
      { role: 'user', content: msg }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    let parsed = safeParseMarcela(raw);

    if (!parsed) {
      parsed = {
        reply: 'Disculpa, tuve un problema procesando tu consulta. ¿Puedes repetirla?',
        intent_signal: 'NONE',
        intent_reason: 'fallback_parse',
        schedule_detected: false,
        schedule_text: ''
      };
    }

    if (parsed.schedule_detected && parsed.schedule_text) {
      const fuera = reagendarSiFueraHorario(parsed.schedule_text);
      if (fuera) {
        parsed.reply += '\n\n(Nuestro horario es de 09:00 a 20:00 hrs. Te propongo agendarte mañana a las 09:00 hrs, ¿te acomoda?)';
        parsed.intent_signal = 'YELLOW';
      }
    }

    return parsed;
  } catch (e) {
    console.error('❌ Error Marcela/OpenAI:', e.message);
    return {
      reply: 'Lo siento, tuve un pequeño problema técnico. ¿Podrías repetirme eso?',
      intent_signal: 'NONE',
      intent_reason: 'error_openai',
      schedule_detected: false,
      schedule_text: ''
    };
  }
}

function aplicarSemaforoAlLead(lead, parsed) {
  if (parsed.intent_signal === 'BLUE' || parsed.intent_signal === 'YELLOW') {
    lead.intentSignal = parsed.intent_signal;
    lead.status = QUALIFIED_STAGE;
    lead.scheduleText = parsed.schedule_text || '';
  } else if (!lead.intentSignal) {
    lead.intentSignal = 'NONE';
  }
  return lead;
}

// ============================================================================
// ===== Round-Robin ==========================================================
// ============================================================================
async function getActiveSellers(tenant) {
  const users = await tRead(F.users, tenant);
  return users.filter(u => u.role === 'vendedor' && (u.status === undefined || u.status === 'Activo'));
}

async function rrNext(tenant, excludeUsername = null) {
  const sellers = await getActiveSellers(tenant);
  if (!sellers.length) return null;
  const pool = excludeUsername ? sellers.filter(s => s.username !== excludeUsername) : sellers;
  const list = pool.length ? pool : sellers;
  const rrState = await read(F.rr);
  const idx = (rrState[tenant] || 0) % list.length;
  const chosen = list[idx];
  rrState[tenant] = (idx + 1) % list.length;
  await write(F.rr, rrState);
  return chosen.username;
}

// ===== Helpers de alerta =====
function computeAlertLevel(lead) {
  if (FINAL_STATUSES.has(lead.status)) return 'none';
  if (lead.status !== 'Nuevo') return 'none';
  const mins = (Date.now() - new Date(lead.lastInteraction).getTime()) / 60000;
  if (mins > SLA_CRITICAL) return 'critical';
  if (mins > SLA_RISK || lead.reassigned) return 'risk';
  return 'fresh';
}

async function applySlaRules(tenant) {
  const leads = await tRead(F.leads, tenant);
  let changed = false;
  for (const lead of leads) {
    if (FINAL_STATUSES.has(lead.status)) continue;
    const prevAlert = lead.alertLevel || 'none';
    const mins = (Date.now() - new Date(lead.lastInteraction).getTime()) / 60000;

    if (lead.status === 'Nuevo') {
      if (mins > SLA_REASSIGN && !lead.reassigned) {
        const next = await rrNext(tenant, lead.assignedTo);
        if (next && next !== lead.assignedTo) {
          lead.assignedTo = next;
          lead.reassigned = true;
          lead.reassignedAt = new Date().toISOString();
          lead.lastInteraction = new Date().toISOString();
          lead.alertLevel = 'risk';
          changed = true;
          continue;
        }
      }
      if (lead.reassigned && lead.reassignedAt) {
        const minsPostReassign = (Date.now() - new Date(lead.reassignedAt).getTime()) / 60000;
        if (minsPostReassign > SLA_GERENCIA && lead.assignedTo !== 'gerente') {
          lead.assignedTo = 'gerente';
          lead.alertLevel = 'critical';
          changed = true;
          continue;
        }
      }
    }

    const newAlert = computeAlertLevel(lead);
    if (newAlert !== prevAlert) { lead.alertLevel = newAlert; changed = true; }
    if (lead.botActive === undefined) { lead.botActive = true; changed = true; }
  }
  if (changed) await tWrite(F.leads, tenant, leads);
  return leads;
}

// ============================================================================
// ===== SEED =================================================================
// ============================================================================
async function seed() {
  const min = (n) => { const d = new Date(); d.setMinutes(d.getMinutes() - n); return d.toISOString(); };
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

  const users = await read(F.users);
  if (!users.demo_automotora) users.demo_automotora = [
    { username: 'gerente', password: 'demo', name: 'Andrés Salas', role: 'admin' },
    { username: 'vendedor1', password: 'demo', name: 'Rodrigo Vidal', role: 'vendedor', status: 'Activo' },
    { username: 'vendedor2', password: 'demo', name: 'Camila Aravena', role: 'vendedor', status: 'Activo' },
    { username: 'recepcion', password: 'demo', name: 'Daniela Ortiz', role: 'secretaria' }
  ];
  if (!users.demo_clinica) users.demo_clinica = [
    { username: 'gerente', password: 'demo', name: 'Dr. Hernán Vidal', role: 'admin' },
    { username: 'vendedor1', password: 'demo', name: 'Karina Bravo', role: 'vendedor', status: 'Activo' },
    { username: 'recepcion', password: 'demo', name: 'Marcela Tapia', role: 'secretaria' }
  ];
  await write(F.users, users);

  const leads = await read(F.leads);
  if (!leads.demo_automotora) leads.demo_automotora = [
    { id: 1001, name: 'María González', phone: '+56 9 8765 4321', source: 'Meta Ads', status: 'Calificado', lastInteraction: min(8), interest: 'SUV familiar', assignedTo: 'vendedor1', botActive: true, alertLevel: 'none', model: 'SUV 7 plazas 2.0T', intentSignal: 'NONE', chatHistory: [
      { role: 'user', content: 'Quiero info de SUV para familia de 5' },
      { role: 'bot', content: 'Tenemos modelos 7 plazas con tercera fila. ¿Uso urbano o ruta?' }
    ]},
    { id: 1002, name: 'Carlos Rojas', phone: '+56 9 5544 3322', source: 'Google Ads', status: 'Contactado', lastInteraction: min(45), interest: 'Camioneta 4x4', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Camioneta Diésel 4x4', intentSignal: 'NONE', chatHistory: [] },
    { id: 1003, name: 'Javiera Muñoz', phone: '+56 9 7788 9900', source: 'Instagram', status: 'Negociación', lastInteraction: min(120), interest: 'Sedán económico', assignedTo: 'vendedor2', botActive: true, alertLevel: 'red', model: 'Sedán 1.6L', intentSignal: 'NONE', chatHistory: [] },
    { id: 1004, name: 'Diego Fuentes', phone: '+56 9 2233 4455', source: 'Referido', status: 'Cerrado', lastInteraction: day(1), interest: 'Hatchback', assignedTo: 'vendedor2', botActive: false, alertLevel: 'none', model: 'Sedán 1.6L', chatHistory: [] },
    { id: 1005, name: 'Antonia Pérez', phone: '+56 9 6677 8899', source: 'Meta Ads', status: 'Nuevo', lastInteraction: min(5), interest: 'SUV compacto', assignedTo: 'vendedor1', botActive: true, alertLevel: 'none', model: 'SUV 7 plazas 2.0T', intentSignal: 'NONE', chatHistory: [] },
    { id: 1006, name: 'Sebastián Vargas', phone: '+56 9 1122 3344', source: 'Landing Page', status: 'Calificado', lastInteraction: min(95), interest: 'Camioneta diésel', assignedTo: 'vendedor2', botActive: true, alertLevel: 'red', model: 'Camioneta Diésel 4x4', intentSignal: 'NONE', chatHistory: [] },
    { id: 1007, name: 'Camila Soto', phone: '+56 9 9988 7766', source: 'Google Ads', status: 'Contactado', lastInteraction: min(38), interest: 'Eléctrico', assignedTo: 'vendedor1', botActive: true, alertLevel: 'yellow', model: 'Eléctrico Compacto', intentSignal: 'NONE', chatHistory: [] },
    { id: 1008, name: 'Tomás Herrera', phone: '+56 9 3322 1100', source: 'Chileautos', status: 'Nuevo', lastInteraction: min(220), interest: 'SUV usado', assignedTo: 'vendedor2', botActive: true, alertLevel: 'red', model: 'SUV 7 plazas 2.0T', intentSignal: 'NONE', chatHistory: [] },
    { id: 1009, name: 'Pablo Riquelme', phone: '+56 9 4455 6677', source: 'Chileautos', status: 'Cerrado', lastInteraction: day(2), interest: 'Camioneta', assignedTo: 'vendedor1', botActive: false, alertLevel: 'none', model: 'Camioneta Diésel 4x4', chatHistory: [] },
    { id: 1010, name: 'Valentina Roa', phone: '+56 9 7799 1122', source: 'Meta Ads', status: 'Cerrado', lastInteraction: day(3), interest: 'SUV familiar', assignedTo: 'vendedor2', botActive: false, alertLevel: 'none', model: 'SUV 7 plazas 2.0T', chatHistory: [] }
  ];
  if (!leads.demo_clinica) leads.demo_clinica = [
    { id: 2001, name: 'Patricia Rivera', phone: '+56 9 3344 5566', source: 'Google Ads', status: 'Calificado', lastInteraction: min(12), interest: 'Dermatología', assignedTo: 'vendedor1', botActive: true, alertLevel: 'none', model: 'Hora Dermatología', intentSignal: 'NONE', chatHistory: [] },
    { id: 2002, name: 'Roberto Cárcamo', phone: '+56 9 7766 5544', source: 'Meta Ads', status: 'Contactado', lastInteraction: min(50), interest: 'Chequeo preventivo', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Medicina General', intentSignal: 'NONE', chatHistory: [] },
    { id: 2003, name: 'Isidora Lagos', phone: '+56 9 4433 2211', source: 'Landing Page', status: 'Nuevo', lastInteraction: min(180), interest: 'Estética', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Hora Dermatología', intentSignal: 'NONE', chatHistory: [] },
    { id: 2004, name: 'Constanza Mella', phone: '+56 9 5566 7788', source: 'Instagram', status: 'Negociación', lastInteraction: min(85), interest: 'Plan integral', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Hora Ginecología', intentSignal: 'NONE', chatHistory: [] }
  ];
  await write(F.leads, leads);

  const cfg = await read(F.config);
  if (!cfg.demo_automotora) cfg.demo_automotora = {
    businessName: 'Automotora Andes', accentColor: '#1e40af',
    stages: ['Nuevo', 'Contactado', 'Calificado', QUALIFIED_STAGE, 'Negociación', 'Cerrado', 'Perdido'],
    prompt_base: 'Eres Marcela, asesora de Automotora Andes.'
  };
  if (!cfg.demo_clinica) cfg.demo_clinica = {
    businessName: 'Clínica Vital', accentColor: '#0d9488',
    stages: ['Nuevo', 'Contactado', 'Agendado', QUALIFIED_STAGE, 'Atendido', 'Cerrado', 'Perdido'],
    prompt_base: 'Eres asistente de Clínica Vital.'
  };
  // Asegura que la etapa nueva esté presente en configuraciones existentes
  for (const t of TENANTS) {
    if (cfg[t] && Array.isArray(cfg[t].stages) && !cfg[t].stages.includes(QUALIFIED_STAGE)) {
      const idx = cfg[t].stages.indexOf('Calificado');
      if (idx >= 0) cfg[t].stages.splice(idx + 1, 0, QUALIFIED_STAGE);
      else cfg[t].stages.splice(Math.max(0, cfg[t].stages.length - 2), 0, QUALIFIED_STAGE);
    }
  }
  await write(F.config, cfg);

  const bot = await read(F.bot);
  if (!bot.demo_automotora) bot.demo_automotora = { greeting: '¡Hola! Soy Marcela de Automotora Andes. ¿Qué tipo de vehículo buscas?' };
  if (!bot.demo_clinica) bot.demo_clinica = { greeting: 'Hola, soy el asistente de Clínica Vital. ¿En qué especialidad te atendemos?' };
  await write(F.bot, bot);

  const inv = await read(F.inventory);
  if (!inv.demo_automotora) inv.demo_automotora = [
    { id: 'AND-SUV-001', model: 'SUV 7 plazas 2.0T', stock: 4, price: 24990000 },
    { id: 'AND-SED-002', model: 'Sedán 1.6L', stock: 8, price: 14990000 },
    { id: 'AND-PCK-003', model: 'Camioneta Diésel 4x4', stock: 3, price: 22490000 },
    { id: 'AND-EV-004', model: 'Eléctrico Compacto', stock: 2, price: 19990000 }
  ];
  if (!inv.demo_clinica) inv.demo_clinica = [
    { id: 'VIT-DERM', model: 'Hora Dermatología', stock: 12, price: 45000 },
    { id: 'VIT-GIN', model: 'Hora Ginecología', stock: 9, price: 50000 },
    { id: 'VIT-MG', model: 'Medicina General', stock: 25, price: 32000 }
  ];
  await write(F.inventory, inv);

  const spend = await read(F.spend);
  if (!spend.demo_automotora) spend.demo_automotora = {
    'Meta Ads': 1850000, 'Chileautos': 980000, 'Google Ads': 1420000,
    'Instagram': 540000, 'Landing Page': 0, 'Referido': 0
  };
  if (!spend.demo_clinica) spend.demo_clinica = {
    'Meta Ads': 620000, 'Google Ads': 880000, 'Instagram': 310000, 'Landing Page': 0
  };
  await write(F.spend, spend);
}

// ============================================================================
// ===== AUTH =================================================================
// ============================================================================
const auth = (...roles) => async (req, res, next) => {
  const token = req.header('X-Auth-Token') || req.query.token;
  const sess = sessions.get(token);
  if (!sess) return res.status(401).json({ error: 'No autenticado' });
  if (roles.length && !roles.includes(sess.user.role)) return res.status(403).json({ error: 'Sin permisos' });
  req.user = sess.user;
  req.tenant = sess.tenant;
  next();
};

const filterByRole = (leads, user) =>
  user.role === 'vendedor' ? leads.filter(l => l.assignedTo === user.username) : leads;

app.post('/api/auth/login', async (req, res) => {
  const { username, password, tenant } = req.body || {};
  const t = validTenant(tenant);
  const users = await tRead(F.users, t);
  const u = users.find(x => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = crypto.randomBytes(24).toString('hex');
  const safe = { username: u.username, name: u.name, role: u.role };
  sessions.set(token, { user: safe, tenant: t });
  res.json({ token, user: safe, tenant: t });
});

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(req.header('X-Auth-Token'));
  res.json({ ok: true });
});

app.get('/api/me', auth(), (req, res) => res.json({ user: req.user, tenant: req.tenant }));

// ============================================================================
// ===== LEADS ================================================================
// ============================================================================
app.get('/api/leads', auth(), async (req, res) => {
  const all = await applySlaRules(req.tenant);
  const leads = filterByRole(all, req.user);
  leads.forEach(l => {
    if (!Array.isArray(l.chatHistory)) l.chatHistory = [];
    if (!l.intentSignal) l.intentSignal = 'NONE';
  });
  res.json(leads);
});

app.get('/api/leads/:id', auth(), async (req, res) => {
  await applySlaRules(req.tenant);
  const leads = await tRead(F.leads, req.tenant);
  const l = leads.find(x => x.id == req.params.id);
  if (!l) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role === 'vendedor' && l.assignedTo !== req.user.username)
    return res.status(403).json({ error: 'Sin permisos' });
  res.json(l);
});

app.put('/api/leads/:id', auth(), async (req, res) => {
  const leads = await tRead(F.leads, req.tenant);
  const idx = leads.findIndex(x => x.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role === 'vendedor' && leads[idx].assignedTo !== req.user.username)
    return res.status(403).json({ error: 'Sin permisos' });
  if (req.user.role === 'vendedor') delete req.body.assignedTo;
  leads[idx] = { ...leads[idx], ...req.body, lastInteraction: new Date().toISOString() };
  leads[idx].alertLevel = computeAlertLevel(leads[idx]);
  await tWrite(F.leads, req.tenant, leads);
  res.json(leads[idx]);
});

app.post('/api/leads/:id/bot', auth(), async (req, res) => {
  const leads = await tRead(F.leads, req.tenant);
  const idx = leads.findIndex(x => x.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role === 'vendedor' && leads[idx].assignedTo !== req.user.username)
    return res.status(403).json({ error: 'Sin permisos' });
  leads[idx].botActive = !!req.body.botActive;
  await tWrite(F.leads, req.tenant, leads);
  res.json(leads[idx]);
});

app.post('/api/leads/:id/message', auth('admin', 'vendedor'), async (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content requerido' });
  const leads = await tRead(F.leads, req.tenant);
  const idx = leads.findIndex(x => x.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role === 'vendedor' && leads[idx].assignedTo !== req.user.username)
    return res.status(403).json({ error: 'Sin permisos' });
  leads[idx].chatHistory = leads[idx].chatHistory || [];
  leads[idx].chatHistory.push({ role: 'agent', content, ts: Date.now(), agent: req.user.username });
  leads[idx].botActive = false;
  leads[idx].lastInteraction = new Date().toISOString();
  leads[idx].alertLevel = computeAlertLevel(leads[idx]);
  await tWrite(F.leads, req.tenant, leads);
  res.json(leads[idx]);
});

// ============================================================================
// ===== PIPELINE / DASHBOARD / ANALYTICS =====================================
// ============================================================================
app.get('/api/pipeline', auth(), async (req, res) => {
  const cfg = await tRead(F.config, req.tenant, {});
  const all = await applySlaRules(req.tenant);
  const leads = filterByRole(all, req.user);
  res.json((cfg.stages || []).map(s => ({ stage: s, leads: leads.filter(l => l.status === s) })));
});

app.get('/api/dashboard/kpis', auth('admin'), async (req, res) => {
  const leads = await applySlaRules(req.tenant);
  const now = Date.now();
  const minOf = l => (now - new Date(l.lastInteraction).getTime()) / 60000;
  const nuevos = leads.filter(l => l.status === 'Nuevo');
  const slaFresh    = nuevos.filter(l => minOf(l) <= SLA_FRESH).length;
  const slaRisk     = nuevos.filter(l => (minOf(l) > SLA_FRESH && minOf(l) <= SLA_RISK) || (l.reassigned && minOf(l) <= SLA_RISK)).length;
  const slaCritical = nuevos.filter(l => minOf(l) > SLA_RISK).length;
  const closed = leads.filter(l => l.status === 'Cerrado').length;
  const active = leads.filter(l => !FINAL_STATUSES.has(l.status));
  const qualified = leads.filter(l => l.status === QUALIFIED_STAGE).length;
  const avg = nuevos.length ? Math.round(nuevos.reduce((s, l) => s + minOf(l), 0) / nuevos.length) : 0;
  res.json({
    total: leads.length,
    active: active.length,
    closed,
    qualified,
    slaFresh, slaRisk, slaCritical,
    avgResponseMin: avg,
    conversionRate: leads.length ? ((closed / leads.length) * 100).toFixed(1) : '0.0',
    byStatus: {
      nuevo:       leads.filter(l => l.status === 'Nuevo').length,
      enProceso:   leads.filter(l => l.status === 'En Proceso').length,
      agendado:    leads.filter(l => l.status === 'Agendado').length,
      seguimiento: leads.filter(l => l.status === 'Seguimiento').length,
      calificado:  qualified,
      cerrado:     leads.filter(l => l.status === 'Cerrado').length,
      abandonado:  leads.filter(l => l.status === 'Abandonado').length
    }
  });
});

app.get('/api/dashboard/team', auth('admin'), async (req, res) => {
  const users = await tRead(F.users, req.tenant);
  const leads = await tRead(F.leads, req.tenant);
  const now = Date.now();
  const minOf = l => (now - new Date(l.lastInteraction).getTime()) / 60000;
  const allVendors = [...users.filter(u => u.role === 'vendedor'), { username: 'gerente', name: 'Gerencia' }];
  res.json(allVendors.map(v => {
    const own = leads.filter(l => l.assignedTo === v.username);
    const nuevos = own.filter(l => l.status === 'Nuevo');
    return {
      username: v.username,
      name: v.name,
      total: own.length,
      sla: {
        fresh:    nuevos.filter(l => minOf(l) <= SLA_FRESH).length,
        risk:     nuevos.filter(l => (minOf(l) > SLA_FRESH && minOf(l) <= SLA_RISK) || (l.reassigned && minOf(l) <= SLA_RISK)).length,
        critical: nuevos.filter(l => minOf(l) > SLA_RISK).length
      },
      byStatus: {
        nuevo:       nuevos.length,
        enProceso:   own.filter(l => l.status === 'En Proceso').length,
        agendado:    own.filter(l => l.status === 'Agendado').length,
        seguimiento: own.filter(l => l.status === 'Seguimiento').length,
        calificado:  own.filter(l => l.status === QUALIFIED_STAGE).length,
        cerrado:     own.filter(l => l.status === 'Cerrado').length,
        abandonado:  own.filter(l => l.status === 'Abandonado').length
      },
      leads: own
    };
  }).filter(v => v.total > 0));
});

app.get('/api/analytics/channels', auth('admin'), async (req, res) => {
  const leads = await tRead(F.leads, req.tenant);
  const spend = await tRead(F.spend, req.tenant, {});
  const channels = {};
  for (const l of leads) {
    const ch = l.source || 'Otro';
    if (!channels[ch]) channels[ch] = { channel: ch, leads: 0, sales: 0, spend: spend[ch] || 0, models: {} };
    channels[ch].leads++;
    if (l.status === 'Cerrado') {
      channels[ch].sales++;
      const m = l.model || l.interest || 'No especificado';
      channels[ch].models[m] = (channels[ch].models[m] || 0) + 1;
    }
  }
  const out = Object.values(channels).map(c => {
    let topModel = '—', topCount = 0;
    for (const [m, n] of Object.entries(c.models)) if (n > topCount) { topModel = m; topCount = n; }
    return {
      channel: c.channel,
      spend: c.spend,
      leads: c.leads,
      sales: c.sales,
      topModel,
      topModelCount: topCount,
      cpl: c.leads ? Math.round(c.spend / c.leads) : 0,
      cac: c.sales ? Math.round(c.spend / c.sales) : 0,
      conversion: c.leads ? ((c.sales / c.leads) * 100).toFixed(1) : '0.0'
    };
  }).sort((a, b) => b.spend - a.spend);
  res.json(out);
});

// ============================================================================
// ===== USERS / CONFIG / BOT / INVENTORY =====================================
// ============================================================================
app.get('/api/users', auth('admin'), async (req, res) => {
  const users = await tRead(F.users, req.tenant);
  res.json(users.map(u => ({ username: u.username, name: u.name, role: u.role, status: u.status || (u.role === 'vendedor' ? 'Activo' : null) })));
});

app.get('/api/config', auth(), async (req, res) => res.json(await tRead(F.config, req.tenant, {})));

app.put('/api/config', auth('admin'), async (req, res) => {
  const cur = await tRead(F.config, req.tenant, {});
  const upd = { ...cur, ...req.body };
  await tWrite(F.config, req.tenant, upd);
  res.json(upd);
});

app.get('/api/bot', auth('admin'), async (req, res) => res.json(await tRead(F.bot, req.tenant, {})));
app.put('/api/bot', auth('admin'), async (req, res) => {
  const cur = await tRead(F.bot, req.tenant, {});
  const upd = { ...cur, ...req.body };
  await tWrite(F.bot, req.tenant, upd);
  res.json(upd);
});

app.get('/api/inventory', auth('admin', 'vendedor'), async (req, res) =>
  res.json(await tRead(F.inventory, req.tenant)));

// ============================================================================
// ===== /api/chat (Simulador Web con Marcela JSON) ===========================
// ============================================================================
app.post('/api/chat', async (req, res) => {
  const tenant = validTenant(req.body?.tenant || req.query.tenant);
  const { sessionId, message } = req.body || {};
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId y message requeridos' });

  const leads = await tRead(F.leads, tenant);
  let sess = chatSessions.get(sessionId), captured = false, leadId;

  if (!sess) {
    leadId = Date.now();
    const assigned = await rrNext(tenant);
    const newLead = {
      id: leadId, name: 'Visitante anónimo', phone: 'Pendiente',
      source: 'Chat Web (Simulador)', status: 'Nuevo',
      lastInteraction: new Date().toISOString(),
      interest: message.slice(0, 80), sessionId,
      assignedTo: assigned,
      botActive: true,
      alertLevel: 'none',
      intentSignal: 'NONE',
      chatHistory: []
    };
    leads.unshift(newLead);
    sess = { tenant, leadId, step: 0 };
    chatSessions.set(sessionId, sess);
    captured = true;
  } else {
    leadId = sess.leadId;
    sess.step++;
  }

  const idx = leads.findIndex(l => l.id === leadId);
  leads[idx].chatHistory = leads[idx].chatHistory || [];
  leads[idx].chatHistory.push({ role: 'user', content: message, ts: Date.now() });

  if (leads[idx].botActive !== false) {
    const parsed = await getMarcelaResponse(tenant, leads[idx].chatHistory.slice(0, -1), message);
    leads[idx].chatHistory.push({ role: 'bot', content: parsed.reply, ts: Date.now() });
    leads[idx].lastInteraction = new Date().toISOString();

    aplicarSemaforoAlLead(leads[idx], parsed);
    if (leads[idx].status === 'Nuevo' && sess.step >= 1 && !ACTIVE_STATUSES.has(QUALIFIED_STAGE) === false) {
      // se mantiene 'Nuevo' a menos que Marcela lo califique vía semáforo
    }
    if (sess.step >= 2 && leads[idx].status === 'Nuevo' && leads[idx].intentSignal === 'NONE') {
      leads[idx].status = 'Contactado';
    }

    await tWrite(F.leads, tenant, leads);
    return res.json({
      reply: parsed.reply,
      sessionId,
      leadCaptured: captured,
      leadId,
      intentSignal: leads[idx].intentSignal,
      status: leads[idx].status
    });
  }

  await tWrite(F.leads, tenant, leads);
  res.json({ reply: null, sessionId, leadCaptured: captured, leadId, botPaused: true });
});

// ============================================================================
// ===== WEBHOOK WHATSAPP CLOUD API ===========================================
// ============================================================================
async function sendWhatsAppMessage(to, text) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return console.log('⚠️ Faltan WA_TOKEN o WA_PHONE_ID en Environment');
  try {
    await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } })
    });
  } catch (e) { console.error('❌ Error enviando WA:', e); }
}

// ===== ESCUDO BODY ELITE =====
const SHIELD_KEYWORDS = [
  'body elite', 'bodyelite', 'botox',
  'lipo', 'lipoescultura', 'liposuccion', 'liposucción',
  'estetica', 'estética',
  'masaje', 'masajes',
  'doctora',
  'tratamiento', 'tratamientos',
  'acido', 'ácido', 'hialuronico', 'hialurónico'
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

app.get('/webhook', (req, res) => {
  const verify_token = process.env.WA_VERIFY_TOKEN || 'zara_token_123';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  res.sendStatus(400);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (!body.object) return res.sendStatus(404);

  res.sendStatus(200); // ACK rápido a Meta

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msgObj = value?.messages?.[0];
    if (!msgObj) return;

    const from = msgObj.from;
    const msg_body = msgObj.text ? msgObj.text.body : (msgObj.button?.text || msgObj.interactive?.button_reply?.title || null);
    const contactName = value.contacts ? value.contacts[0].profile.name : 'WhatsApp Lead';

    if (!msg_body) return;

    // ===== ESCUDO BODY ELITE: intercepta antes de OpenAI y antes de persistir =====
    if (isResidualTraffic(msg_body)) {
      console.log('🛡  Escudo Body Elite activado para ' + from + ' → ' + msg_body.slice(0, 80));
      await sendWhatsAppMessage(from, SHIELD_RESPONSE);
      return; // sin OpenAI, sin persistencia
    }

    console.log('💬 [WhatsApp] Recibido de ' + from + ': ' + msg_body);

    const tenant = 'demo_automotora';
    const leadsData = await read(F.leads);
    if (!leadsData[tenant]) leadsData[tenant] = [];

    let idx = leadsData[tenant].findIndex(l =>
      l.phone && l.phone.replace(/\D/g, '').includes(from.replace(/\D/g, ''))
    );

    if (idx === -1) {
      const assigned = await rrNext(tenant) || 'gerente';
      const newLead = {
        id: Date.now(), name: contactName, phone: '+' + from,
        source: 'WhatsApp', status: 'Nuevo',
        lastInteraction: new Date().toISOString(),
        interest: msg_body.slice(0, 80),
        assignedTo: assigned,
        botActive: true, alertLevel: 'none',
        intentSignal: 'NONE',
        chatHistory: []
      };
      leadsData[tenant].unshift(newLead);
      idx = 0;
    }

    leadsData[tenant][idx].chatHistory = leadsData[tenant][idx].chatHistory || [];
    leadsData[tenant][idx].chatHistory.push({ role: 'user', content: msg_body, ts: Date.now() });

    if (leadsData[tenant][idx].botActive !== false) {
      const historyForIA = leadsData[tenant][idx].chatHistory.slice(0, -1);
      const parsed = await getMarcelaResponse(tenant, historyForIA, msg_body);

      leadsData[tenant][idx].chatHistory.push({ role: 'bot', content: parsed.reply, ts: Date.now() });

      // Sincronización de Estados (BLUE/YELLOW → Lead Calificado - Contacto Agendado)
      aplicarSemaforoAlLead(leadsData[tenant][idx], parsed);

      // Si aún era 'Nuevo' y no se calificó, marcamos 'Contactado'
      const userTurns = leadsData[tenant][idx].chatHistory.filter(m => m.role === 'user').length;
      if (userTurns >= 2 && leadsData[tenant][idx].status === 'Nuevo' && leadsData[tenant][idx].intentSignal === 'NONE') {
        leadsData[tenant][idx].status = 'Contactado';
      }

      await sendWhatsAppMessage(from, parsed.reply);
    }

    leadsData[tenant][idx].lastInteraction = new Date().toISOString();
    leadsData[tenant][idx].alertLevel = computeAlertLevel(leadsData[tenant][idx]);

    await write(F.leads, leadsData);
  } catch (e) {
    console.error('Error procesando webhook:', e);
  }
});

// ============================================================================
// ===== STATIC + JOB SLA + LISTEN ============================================
// ============================================================================
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

setInterval(async () => {
  for (const t of TENANTS) {
    try { await applySlaRules(t); } catch (e) { console.error('SLA job error', t, e.message); }
  }
}, 60000);

seed().then(() => app.listen(PORT, () => {
  console.log(`🚀 CRM en http://localhost:${PORT}`);
  console.log(`🔐 Login demo: gerente | vendedor1 | vendedor2 | recepcion (pass: demo)`);
  console.log(`🤖 Marcela JSON activa | 📲 Webhook WA: /webhook | 🛡  Escudo Body Elite ON`);
}));


// ===== INTELIGENCIA ARTIFICIAL ZARA (OpenAI) =====
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getZaraResponse(tenant, history, msg) {
  try {
    const cfg = await tRead(F.config, tenant, {});
    const inv = await tRead(F.inventory, tenant, []);
    
    const prompt = `${cfg.prompt_base || 'Eres una asistente de ventas.'}
    INVENTARIO ACTUAL: ${JSON.stringify(inv)}
    REGLA: Si el cliente pregunta por un modelo, usa los datos del inventario. Se amable y orientada a cerrar la venta.`;

    const messages = [
      { role: "system", content: prompt },
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
      { role: "user", content: msg }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7
    });

    return completion.choices[0].message.content;
  } catch (e) {
    console.error("❌ Error OpenAI:", e);
    return "Lo siento, tuve un pequeño problema técnico. ¿Podrías repetirme eso?";
  }
}
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
const SLA_FRESH    = 10;   // Nuevos < 10m
const SLA_RISK     = 20;   // En Riesgo 10-20m o reasignados
const SLA_CRITICAL = 30;   // Críticos 20-30m
const SLA_REASSIGN = 30;   // Castigo 1: > 30m -> reasignar
const SLA_GERENCIA = 15;   // Castigo 2: > 15m post-reasignación -> gerencia
const ACTIVE_STATUSES = new Set(['Nuevo', 'En Proceso', 'Agendado', 'Seguimiento']);
const FINAL_STATUSES  = new Set(['Cerrado', 'Abandonado']);

const read = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return {}; } };
const write = (f, d) => fs.writeFile(f, JSON.stringify(d, null, 2));
const tRead = async (f, t, fb = []) => { const s = await read(f); return s[t] !== undefined ? s[t] : fb; };
const tWrite = async (f, t, d) => { const s = await read(f); s[t] = d; await write(f, s); };
const validTenant = (t) => TENANTS.includes(t) ? t : TENANTS[0];

// ===== Round-Robin =====
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

// Aplica reasignación SLA + recomputa alertLevel. Devuelve true si hubo cambios.
async function applySlaRules(tenant) {
  const leads = await tRead(F.leads, tenant);
  let changed = false;
  for (const lead of leads) {
    if (FINAL_STATUSES.has(lead.status)) continue;
    const prevAlert = lead.alertLevel || 'none';
    const mins = (Date.now() - new Date(lead.lastInteraction).getTime()) / 60000;

    if (lead.status === 'Nuevo') {
      // Castigo 1: > 30m sin contacto -> reasignar a Fila India, reset timer, pasa a 'risk'
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
      // Castigo 2: > 15m desde reasignación -> asignar a gerencia
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
    { id: 1001, name: 'María González', phone: '+56 9 8765 4321', source: 'Meta Ads', status: 'Calificado', lastInteraction: min(8), interest: 'SUV familiar', assignedTo: 'vendedor1', botActive: true, alertLevel: 'none', model: 'SUV 7 plazas 2.0T', chatHistory: [
      { role: 'user', content: 'Quiero info de SUV para familia de 5' },
      { role: 'bot', content: 'Tenemos modelos 7 plazas con tercera fila. ¿Uso urbano o ruta?' },
      { role: 'user', content: 'Mixto, ciudad y viajes al sur' },
      { role: 'bot', content: 'Te recomiendo el 4x2 turbo. Desde $24.990.000 con bono $1.500.000. ¿Tienes auto de cambio?' }
    ]},
    { id: 1002, name: 'Carlos Rojas', phone: '+56 9 5544 3322', source: 'Google Ads', status: 'Contactado', lastInteraction: min(45), interest: 'Camioneta 4x4', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Camioneta Diésel 4x4', chatHistory: [
      { role: 'user', content: 'Camioneta para trabajo en obra' },
      { role: 'bot', content: 'Diésel 4x4 ideal. ¿Carga y kilómetros mensuales?' }
    ]},
    { id: 1003, name: 'Javiera Muñoz', phone: '+56 9 7788 9900', source: 'Instagram', status: 'Negociación', lastInteraction: min(120), interest: 'Sedán económico', assignedTo: 'vendedor2', botActive: true, alertLevel: 'red', model: 'Sedán 1.6L', chatHistory: [
      { role: 'user', content: 'Sedan economico con financiamiento' },
      { role: 'bot', content: 'Sedán 1.6L desde $180.000 mensuales. ¿Sueldo aproximado?' }
    ]},
    { id: 1004, name: 'Diego Fuentes', phone: '+56 9 2233 4455', source: 'Referido', status: 'Cerrado', lastInteraction: day(1), interest: 'Hatchback', assignedTo: 'vendedor2', botActive: false, alertLevel: 'none', model: 'Sedán 1.6L', chatHistory: [] },
    { id: 1005, name: 'Antonia Pérez', phone: '+56 9 6677 8899', source: 'Meta Ads', status: 'Nuevo', lastInteraction: min(5), interest: 'SUV compacto', assignedTo: 'vendedor1', botActive: true, alertLevel: 'none', model: 'SUV 7 plazas 2.0T', chatHistory: [
      { role: 'user', content: 'Busco SUV chico para ciudad' },
      { role: 'bot', content: 'Compacto desde $14.990.000. ¿Lo usarías sola o con familia?' }
    ]},
    { id: 1006, name: 'Sebastián Vargas', phone: '+56 9 1122 3344', source: 'Landing Page', status: 'Calificado', lastInteraction: min(95), interest: 'Camioneta diésel', assignedTo: 'vendedor2', botActive: true, alertLevel: 'red', model: 'Camioneta Diésel 4x4', chatHistory: [] },
    { id: 1007, name: 'Camila Soto', phone: '+56 9 9988 7766', source: 'Google Ads', status: 'Contactado', lastInteraction: min(38), interest: 'Eléctrico', assignedTo: 'vendedor1', botActive: true, alertLevel: 'yellow', model: 'Eléctrico Compacto', chatHistory: [] },
    { id: 1008, name: 'Tomás Herrera', phone: '+56 9 3322 1100', source: 'Chileautos', status: 'Nuevo', lastInteraction: min(220), interest: 'SUV usado', assignedTo: 'vendedor2', botActive: true, alertLevel: 'red', model: 'SUV 7 plazas 2.0T', chatHistory: [] },
    { id: 1009, name: 'Pablo Riquelme', phone: '+56 9 4455 6677', source: 'Chileautos', status: 'Cerrado', lastInteraction: day(2), interest: 'Camioneta', assignedTo: 'vendedor1', botActive: false, alertLevel: 'none', model: 'Camioneta Diésel 4x4', chatHistory: [] },
    { id: 1010, name: 'Valentina Roa', phone: '+56 9 7799 1122', source: 'Meta Ads', status: 'Cerrado', lastInteraction: day(3), interest: 'SUV familiar', assignedTo: 'vendedor2', botActive: false, alertLevel: 'none', model: 'SUV 7 plazas 2.0T', chatHistory: [] }
  ];
  if (!leads.demo_clinica) leads.demo_clinica = [
    { id: 2001, name: 'Patricia Rivera', phone: '+56 9 3344 5566', source: 'Google Ads', status: 'Calificado', lastInteraction: min(12), interest: 'Dermatología', assignedTo: 'vendedor1', botActive: true, alertLevel: 'none', model: 'Hora Dermatología', chatHistory: [
      { role: 'user', content: 'Hora con dermatólogo, manchas en la cara' },
      { role: 'bot', content: 'Dra. Soto tiene cupos esta semana. ¿Mañana o tarde?' }
    ]},
    { id: 2002, name: 'Roberto Cárcamo', phone: '+56 9 7766 5544', source: 'Meta Ads', status: 'Contactado', lastInteraction: min(50), interest: 'Chequeo preventivo', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Medicina General', chatHistory: [] },
    { id: 2003, name: 'Isidora Lagos', phone: '+56 9 4433 2211', source: 'Landing Page', status: 'Nuevo', lastInteraction: min(180), interest: 'Estética', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Hora Dermatología', chatHistory: [] },
    { id: 2004, name: 'Constanza Mella', phone: '+56 9 5566 7788', source: 'Instagram', status: 'Negociación', lastInteraction: min(85), interest: 'Plan integral', assignedTo: 'vendedor1', botActive: true, alertLevel: 'red', model: 'Hora Ginecología', chatHistory: [] }
  ];
  await write(F.leads, leads);

  const cfg = await read(F.config);
  if (!cfg.demo_automotora) cfg.demo_automotora = {
    businessName: 'Automotora Andes', accentColor: '#1e40af',
    stages: ['Nuevo', 'Contactado', 'Calificado', 'Negociación', 'Cerrado', 'Perdido'],
    prompt_base: 'Eres asesor de Automotora Andes. Califica leads preguntando uso, presupuesto y plazo. Recomienda SUV, sedán, camioneta o eléctrico según contexto.'
  };
  if (!cfg.demo_clinica) cfg.demo_clinica = {
    businessName: 'Clínica Vital', accentColor: '#0d9488',
    stages: ['Nuevo', 'Contactado', 'Agendado', 'Atendido', 'Cerrado', 'Perdido'],
    prompt_base: 'Eres asistente de Clínica Vital. Pregunta motivo, urgencia y especialidad para agendar.'
  };
  await write(F.config, cfg);

  const bot = await read(F.bot);
  if (!bot.demo_automotora) bot.demo_automotora = { greeting: '¡Hola! Bienvenido a Automotora Andes. ¿Qué tipo de vehículo buscas?' };
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

  // Spend mensual por canal
  const spend = await read(F.spend);
  if (!spend.demo_automotora) spend.demo_automotora = {
    'Meta Ads': 1850000,
    'Chileautos': 980000,
    'Google Ads': 1420000,
    'Instagram': 540000,
    'Landing Page': 0,
    'Referido': 0
  };
  if (!spend.demo_clinica) spend.demo_clinica = {
    'Meta Ads': 620000,
    'Google Ads': 880000,
    'Instagram': 310000,
    'Landing Page': 0
  };
  await write(F.spend, spend);
}

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

app.get('/api/leads', auth(), async (req, res) => {
  const all = await applySlaRules(req.tenant);
  const leads = filterByRole(all, req.user);
  leads.forEach(l => { if(!Array.isArray(l.chatHistory)) l.chatHistory = []; });
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

// Toggle bot
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

// Vendedor envía mensaje -> botActive=false
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
  const avg = nuevos.length ? Math.round(nuevos.reduce((s, l) => s + minOf(l), 0) / nuevos.length) : 0;
  res.json({
    total: leads.length,
    active: active.length,
    closed,
    slaFresh,
    slaRisk,
    slaCritical,
    avgResponseMin: avg,
    conversionRate: leads.length ? ((closed / leads.length) * 100).toFixed(1) : '0.0',
    byStatus: {
      nuevo:       leads.filter(l => l.status === 'Nuevo').length,
      enProceso:   leads.filter(l => l.status === 'En Proceso').length,
      agendado:    leads.filter(l => l.status === 'Agendado').length,
      seguimiento: leads.filter(l => l.status === 'Seguimiento').length,
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
        cerrado:     own.filter(l => l.status === 'Cerrado').length,
        abandonado:  own.filter(l => l.status === 'Abandonado').length
      },
      leads: own
    };
  }).filter(v => v.total > 0));
});

// ===== Analytics por canal =====
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

function mockReply(tenant, msg, turn) {
  const m = msg.toLowerCase();
  if (tenant === 'demo_automotora') {
    if (/precio|cuesta|cuanto/.test(m)) return 'Tenemos planes desde $200.000 mensuales. ¿Tu presupuesto y tienes auto de cambio?';
    if (/suv|familia/.test(m)) return 'SUV familiar desde $19.990.000 con bono $1.500.000. ¿Ciudad o ruta principalmente?';
    if (/camioneta|4x4/.test(m)) return 'Línea diésel 4x4 ideal para trabajo. ¿Carga y km mensuales?';
    if (/eléctrico|electrico/.test(m)) return 'Modelos eléctricos con autonomía 450 km. ¿Tienes carga en casa?';
    return turn === 0 ? '¡Hola! ¿Qué uso le darás — familiar, trabajo, ciudad?' : 'Cuéntame más para recomendarte mejor.';
  }
  if (/dermat|piel/.test(m)) return 'Dra. Soto tiene cupos esta semana. ¿Mañana o tarde?';
  if (/urgenc|fiebre/.test(m)) return 'Te derivo a urgencias 24/7. ¿Necesitas ambulancia?';
  if (/precio|costo/.test(m)) return 'Atendemos Isapre, Fonasa y particular. ¿Tu sistema de salud?';
  return turn === 0 ? 'Hola, ¿cuál es el motivo de tu consulta?' : 'Cuéntame más para sugerir el especialista correcto.';
}

app.post('/api/chat', async (req, res) => {
  const tenant = validTenant(req.body?.tenant || req.query.tenant);
  const { sessionId, message } = req.body;
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
  leads[idx].chatHistory.push({ role: 'user', content: message, ts: Date.now() });

  // Bot solo responde si botActive
  if (leads[idx].botActive !== false) {
    const reply = mockReply(tenant, message, sess.step);
    leads[idx].chatHistory.push({ role: 'bot', content: reply, ts: Date.now() });
    leads[idx].lastInteraction = new Date().toISOString();
    if (sess.step >= 2 && leads[idx].status === 'Nuevo') leads[idx].status = 'Contactado';
    await tWrite(F.leads, tenant, leads);
    return res.json({ reply, sessionId, leadCaptured: captured, leadId });
  }

  await tWrite(F.leads, tenant, leads);
  res.json({ reply: null, sessionId, leadCaptured: captured, leadId, botPaused: true });
});



// ===== WEBHOOK WHATSAPP CLOUD API =====
async function sendWhatsAppMessage(to, text) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return console.log("⚠️ Faltan WA_TOKEN o WA_PHONE_ID en Environment");
  try {
    await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } })
    });
  } catch(e) { console.error("❌ Error enviando WA:", e); }
}

app.get('/webhook', (req, res) => {
  const verify_token = 'zara_token_123';
  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post('/webhook', async (req, res) => {
  let body = req.body;
  if (body.object) {
    res.sendStatus(200); // 🚀 Responder rápido a Meta para que no corte
    try {
      if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
        let msgObj = body.entry[0].changes[0].value.messages[0];
        let from = msgObj.from;
        let msg_body = msgObj.text ? msgObj.text.body : null;
        let contactName = body.entry[0].changes[0].value.contacts ? body.entry[0].changes[0].value.contacts[0].profile.name : 'WhatsApp Lead';

        if (!msg_body) return; // Solo texto por ahora

        console.log('💬 [WhatsApp] Recibido de ' + from + ': ' + msg_body);

        const tenant = 'demo_automotora';
        const leadsData = await read(F.leads);
        if (!leadsData[tenant]) leadsData[tenant] = [];

        // Buscar lead por teléfono
        let idx = leadsData[tenant].findIndex(l => l.phone && l.phone.replace(/D/g, '').includes(from));

        if (idx === -1) {
          const assigned = await rrNext(tenant) || 'gerente';
          const newLead = {
            id: Date.now(), name: contactName, phone: '+' + from,
            source: 'WhatsApp', status: 'Nuevo',
            lastInteraction: new Date().toISOString(),
            interest: msg_body.slice(0, 80),
            assignedTo: assigned,
            botActive: true, alertLevel: 'none', chatHistory: []
          };
          leadsData[tenant].unshift(newLead);
          idx = 0;
        }

        // Guardar historial del usuario
        leadsData[tenant][idx].chatHistory = leadsData[tenant][idx].chatHistory || [];
        leadsData[tenant][idx].chatHistory.push({ role: 'user', content: msg_body, ts: Date.now() });

        // Respuesta del Bot
        if (leadsData[tenant][idx].botActive !== false) {
          const step = leadsData[tenant][idx].chatHistory.filter(m => m.role === 'user').length - 1;
          const reply = await getZaraResponse(tenant, leadsData[tenant][idx].chatHistory.slice(0, -1), msg_body);

          leadsData[tenant][idx].chatHistory.push({ role: 'bot', content: reply, ts: Date.now() });
          if (step >= 1 && leadsData[tenant][idx].status === 'Nuevo') leadsData[tenant][idx].status = 'Contactado';

          // 🚀 HABLA ZARA: Disparo de la API a Meta
          await sendWhatsAppMessage(from, reply);
        }

        leadsData[tenant][idx].lastInteraction = new Date().toISOString();
        leadsData[tenant][idx].alertLevel = computeAlertLevel(leadsData[tenant][idx]);

        await write(F.leads, leadsData);
      }
    } catch (e) { console.error('Error procesando webhook:', e); }
  } else {
    res.sendStatus(404);
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Job periódico para forzar reasignación y actualización de alertas
setInterval(async () => {
  for (const t of TENANTS) {
    try { await applySlaRules(t); } catch (e) { console.error('SLA job error', t, e.message); }
  }
}, 60000);

seed().then(() => app.listen(PORT, () => {
  console.log(`CRM en http://localhost:${PORT}`);
  console.log(`Login demo: gerente | vendedor1 | vendedor2 | recepcion (pass: demo)`);
}));

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

let GoogleGenerativeAI = null;
try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (err) {
  console.warn('SDK @google/generative-ai no instalado. Solo Mock disponible.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

const FILES = {
  leads: path.join(DATA_DIR, 'leads.json'),
  config: path.join(DATA_DIR, 'config.json'),
  bot: path.join(DATA_DIR, 'bot.json'),
  pipeline: path.join(DATA_DIR, 'pipeline.json'),
  campaigns: path.join(DATA_DIR, 'campaigns.json')
};

const VALID_TENANTS = ['demo_automotora', 'demo_clinica'];
const DEFAULT_TENANT = 'demo_automotora';

const chatSessions = new Map();

function getTenant(req) {
  const t = req.header('X-Tenant-Id') || req.query.tenant || req.body?.tenant || DEFAULT_TENANT;
  return VALID_TENANTS.includes(t) ? t : DEFAULT_TENANT;
}

async function readStore(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function writeStore(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function readTenant(file, tenant, fallback = []) {
  const store = await readStore(file);
  return store[tenant] !== undefined ? store[tenant] : fallback;
}

async function writeTenant(file, tenant, data) {
  const store = await readStore(file);
  store[tenant] = data;
  await writeStore(file, store);
}

async function seedIfEmpty() {
  const today = new Date();
  const day = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d.toISOString();
  };

  const leadsStore = await readStore(FILES.leads);
  if (!leadsStore.demo_automotora) {
    leadsStore.demo_automotora = [
      { id: 1001, name: 'María González', phone: '+56 9 8765 4321', source: 'Meta Ads - Campaña Verano', status: 'Calificado', lastInteraction: day(0), interest: 'SUV familiar', chatHistory: [
        { role: 'user', content: 'Hola, quiero info de SUV para familia de 5 personas' },
        { role: 'bot', content: '¡Hola María! Tenemos modelos ideales para familias numerosas. Nuestro SUV 7 plazas tiene tercera fila plegable y cámara 360°. ¿Tu uso será principalmente urbano o también ruta?' },
        { role: 'user', content: 'Mixto, vivo en Las Condes pero viajamos al sur 2 veces al año' },
        { role: 'bot', content: 'Perfecto, te recomiendo el modelo 4x2 con motor 2.0 turbo. Excelente consumo en ciudad y potencia para ruta. Precio referencial $24.990.000 con bono de $1.500.000 este mes. ¿Tienes auto de cambio?' }
      ] },
      { id: 1002, name: 'Carlos Rojas', phone: '+56 9 5544 3322', source: 'Google Ads - Búsqueda', status: 'Contactado', lastInteraction: day(0), interest: 'Camioneta 4x4', chatHistory: [
        { role: 'user', content: 'Camioneta para trabajo en obra' },
        { role: 'bot', content: 'Entiendo Carlos, para uso intensivo te recomiendo nuestra línea diésel 4x4. ¿Carga estimada y kilómetros mensuales?' }
      ] },
      { id: 1003, name: 'Javiera Muñoz', phone: '+56 9 7788 9900', source: 'Instagram Orgánico', status: 'Negociación', lastInteraction: day(1), interest: 'Sedán económico', chatHistory: [] },
      { id: 1004, name: 'Diego Fuentes', phone: '+56 9 2233 4455', source: 'Referido', status: 'Cerrado', lastInteraction: day(1), interest: 'Hatchback', chatHistory: [] },
      { id: 1005, name: 'Antonia Pérez', phone: '+56 9 6677 8899', source: 'Meta Ads - Retargeting', status: 'Nuevo', lastInteraction: day(2), interest: 'SUV compacto', chatHistory: [] },
      { id: 1006, name: 'Sebastián Vargas', phone: '+56 9 1122 3344', source: 'Landing Page', status: 'Calificado', lastInteraction: day(2), interest: 'Camioneta diésel', chatHistory: [] },
      { id: 1007, name: 'Camila Soto', phone: '+56 9 9988 7766', source: 'Google Ads - Display', status: 'Contactado', lastInteraction: day(3), interest: 'Eléctrico', chatHistory: [] }
    ];
  }
  if (!leadsStore.demo_clinica) {
    leadsStore.demo_clinica = [
      { id: 2001, name: 'Patricia Rivera', phone: '+56 9 3344 5566', source: 'Google Ads - Búsqueda', status: 'Calificado', lastInteraction: day(0), interest: 'Consulta dermatología', chatHistory: [
        { role: 'user', content: 'Necesito hora con dermatólogo, tengo manchas en la cara' },
        { role: 'bot', content: 'Hola Patricia, gracias por escribirnos. Para evaluación de manchas te sugiero consulta con la Dra. Soto, especialista en dermatología estética. Tenemos disponibilidad esta semana, ¿prefieres mañana o tarde?' }
      ] },
      { id: 2002, name: 'Roberto Cárcamo', phone: '+56 9 7766 5544', source: 'Meta Ads - Salud', status: 'Contactado', lastInteraction: day(0), interest: 'Chequeo preventivo', chatHistory: [] },
      { id: 2003, name: 'Isidora Lagos', phone: '+56 9 4433 2211', source: 'Landing Page', status: 'Nuevo', lastInteraction: day(1), interest: 'Tratamiento estético', chatHistory: [] },
      { id: 2004, name: 'Fernando Aguilar', phone: '+56 9 8899 1122', source: 'Referido', status: 'Cerrado', lastInteraction: day(1), interest: 'Cirugía menor', chatHistory: [] },
      { id: 2005, name: 'Constanza Mella', phone: '+56 9 5566 7788', source: 'Instagram Orgánico', status: 'Negociación', lastInteraction: day(2), interest: 'Plan integral', chatHistory: [] }
    ];
  }
  await writeStore(FILES.leads, leadsStore);

  const configStore = await readStore(FILES.config);
  if (!configStore.demo_automotora) {
    configStore.demo_automotora = {
      businessName: 'Automotora Andes',
      industry: 'automotora',
      currency: 'CLP',
      accentColor: '#2563eb',
      stages: ['Nuevo', 'Contactado', 'Calificado', 'Negociación', 'Cerrado', 'Perdido'],
      prompt_base: `Eres un asesor comercial experto de Automotora Andes, una concesionaria de Chile que vende SUVs, sedanes, camionetas 4x4 y vehículos eléctricos. Tu objetivo es calificar al lead y avanzarlo en el embudo de venta.

INSTRUCCIONES:
- Saluda con cercanía pero profesionalismo, usa el nombre del cliente si lo conoces.
- Haz UNA pregunta a la vez para descubrir necesidades: tipo de uso, presupuesto, plazo de compra, si tiene auto de cambio.
- Recomienda modelos específicos cuando ya tengas contexto. Modelos típicos: SUV 7 plazas (familias), camioneta diésel 4x4 (trabajo/aventura), sedán 1.6L (eficiencia), eléctrico compacto (ciudad).
- Menciona ventajas concretas: financiamiento desde $200.000/mes, bono de cambio, garantía 5 años, test drive sin compromiso.
- Si el cliente da señales de compra, ofrece agendar visita o test drive.
- Respuestas SIEMPRE en máximo 2-3 oraciones, en español de Chile, tono cercano.
- NUNCA inventes precios exactos sin contexto, da rangos referenciales.`
    };
  }
  if (!configStore.demo_clinica) {
    configStore.demo_clinica = {
      businessName: 'Clínica Vital',
      industry: 'clinica',
      currency: 'CLP',
      accentColor: '#0d9488',
      stages: ['Nuevo', 'Contactado', 'Agendado', 'Atendido', 'Cerrado', 'Perdido'],
      prompt_base: `Eres el asistente virtual de Clínica Vital, un centro médico privado en Chile que ofrece consultas de medicina general, dermatología, ginecología, traumatología y medicina estética. Tu objetivo es agendar la hora del paciente.

INSTRUCCIONES:
- Saluda de manera cálida y profesional, usando el nombre si lo conoces.
- Pregunta UNA cosa a la vez: motivo de consulta, urgencia, especialidad requerida, preferencia de horario, datos de contacto.
- Recomienda al especialista adecuado según el motivo. Tienes: Dra. Soto (dermatología), Dr. Pérez (medicina general), Dra. Muñoz (ginecología), Dr. Cabrera (traumatología).
- Si el caso es urgente (fiebre alta, dolor agudo, sangrado), prioriza derivar a urgencias y deriva al canal correspondiente.
- Menciona convenios con isapres y FONASA cuando aplique.
- Respuestas SIEMPRE breves (máx 2-3 oraciones), en español de Chile, tono empático.
- Confirma el agendamiento solo cuando tengas: nombre, teléfono, especialidad y horario tentativo.`
    };
  }
  await writeStore(FILES.config, configStore);

  const botStore = await readStore(FILES.bot);
  if (!botStore.demo_automotora) {
    botStore.demo_automotora = {
      tone: 'cercano',
      greeting: '¡Hola! 👋 Bienvenido a Automotora Andes. ¿Qué tipo de vehículo estás buscando?',
      enabled: true
    };
  }
  if (!botStore.demo_clinica) {
    botStore.demo_clinica = {
      tone: 'profesional',
      greeting: 'Hola, soy el asistente de Clínica Vital. ¿En qué especialidad te gustaría atenderte?',
      enabled: true
    };
  }
  await writeStore(FILES.bot, botStore);

  const campaignsStore = await readStore(FILES.campaigns);
  if (!campaignsStore.demo_automotora) {
    campaignsStore.demo_automotora = [
      { id: 1, name: 'Meta Ads - Campaña Verano', spend: 450000, leads: 38, conversions: 6, channel: 'meta' },
      { id: 2, name: 'Google Ads - Búsqueda', spend: 320000, leads: 24, conversions: 5, channel: 'google' },
      { id: 3, name: 'Meta Ads - Retargeting', spend: 180000, leads: 19, conversions: 3, channel: 'meta' }
    ];
  }
  if (!campaignsStore.demo_clinica) {
    campaignsStore.demo_clinica = [
      { id: 1, name: 'Google Ads - Salud', spend: 280000, leads: 31, conversions: 8, channel: 'google' },
      { id: 2, name: 'Meta Ads - Estética', spend: 150000, leads: 14, conversions: 3, channel: 'meta' }
    ];
  }
  await writeStore(FILES.campaigns, campaignsStore);

  const pipelineStore = await readStore(FILES.pipeline);
  if (!pipelineStore.demo_automotora) pipelineStore.demo_automotora = [];
  if (!pipelineStore.demo_clinica) pipelineStore.demo_clinica = [];
  await writeStore(FILES.pipeline, pipelineStore);
}

async function callGemini(systemPrompt, history, userMessage) {
  if (!GEMINI_API_KEY || !GoogleGenerativeAI) return null;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt
    });
    const geminiHistory = history.map(m => ({
      role: m.role === 'bot' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(userMessage);
    return result.response.text().trim();
  } catch (err) {
    console.warn('Gemini API falló, fallback a Mock:', err.message);
    return null;
  }
}

function mockInteligente(tenant, systemPrompt, history, userMessage) {
  const msg = userMessage.toLowerCase();
  const turn = history.filter(m => m.role === 'user').length;

  if (tenant === 'demo_automotora') {
    if (/precio|cuesta|valor|cuanto|cuánto/.test(msg)) {
      return 'Te entiendo, el precio es clave. Tenemos planes de financiamiento desde $200.000 mensuales con pie del 20%. ¿Qué presupuesto mensual tienes en mente y tienes auto en parte de pago?';
    }
    if (/suv|7 plazas|familia|familiar/.test(msg)) {
      return '¡Excelente elección! Nuestros SUV familiares parten en $19.990.000 con bono de $1.500.000 este mes. ¿Cuántas personas viajarían habitualmente y usas el auto más en ciudad o ruta?';
    }
    if (/camioneta|4x4|pickup|trabajo/.test(msg)) {
      return 'Para uso intensivo de trabajo te recomiendo nuestra línea diésel 4x4. ¿Cuánta carga necesitas mover y kilómetros mensuales aproximados?';
    }
    if (/eléctrico|electrico|híbrido|hibrido|ev/.test(msg)) {
      return 'Buen momento para pasarse a eléctrico, tenemos modelos con autonomía de hasta 450 km y carga rápida. ¿Tienes estacionamiento con punto de carga o lo cargarías en electrolinera?';
    }
    if (/sedán|sedan|económico|economico|hatchback/.test(msg)) {
      return 'Para uso urbano eficiente tenemos sedán 1.6L con consumo de 17 km/L, financiamiento desde $180.000 mensuales. ¿Lo usarías para trabajo, traslados familiares o ambos?';
    }
    if (/test drive|probar|manejar|prueba/.test(msg)) {
      return '¡Genial! Agendamos test drive sin compromiso. ¿Cuál día de esta semana te acomoda y a qué hora? Necesito tu nombre completo y RUT para reservar.';
    }
    if (/cita|visita|hora|agendar|verlo/.test(msg)) {
      return 'Perfecto, podemos agendar tu visita en sucursal Las Condes o Maipú. ¿Cuál te queda más cómoda y qué día tienes disponible esta semana?';
    }
    if (/financia|crédito|credito|cuotas|pie/.test(msg)) {
      return 'Trabajamos con todos los bancos y financieras, aprobación en 24h. Pie desde 20%, hasta 60 cuotas. ¿Te interesa una pre-evaluación crediticia rápida?';
    }
    if (turn === 0 || /hola|buenas|buenos días|consulta/.test(msg)) {
      return '¡Hola! Bienvenido a Automotora Andes. Para recomendarte el vehículo ideal cuéntame: ¿qué uso le darás principalmente — familiar, trabajo, ciudad, viajes?';
    }
    if (turn >= 3) {
      return 'Tengo lo necesario para que un asesor te contacte con propuesta personalizada. ¿Me confirmas tu nombre completo y un horario en que prefieres que te llamemos?';
    }
    return 'Cuéntame un poco más para recomendarte mejor. ¿Tienes algún modelo en mente, o partamos por tu uso principal y presupuesto aproximado?';
  }

  if (tenant === 'demo_clinica') {
    if (/dermat|piel|mancha|acné|acne|lunar/.test(msg)) {
      return 'Para evaluación dermatológica te recomiendo a la Dra. Soto, especialista en dermatología estética. Tiene cupos esta semana. ¿Prefieres mañana o tarde?';
    }
    if (/ginec|control|pap|menstr/.test(msg)) {
      return 'La Dra. Muñoz atiende ginecología con disponibilidad esta semana. ¿Es para control rutinario o tienes alguna consulta específica?';
    }
    if (/trauma|dolor|rodilla|espalda|fractura|hueso/.test(msg)) {
      return 'El Dr. Cabrera es nuestro traumatólogo. Si el dolor es agudo o post-trauma reciente, es urgente que lo veamos. ¿Hace cuánto tiempo tienes la molestia?';
    }
    if (/general|chequeo|preventivo|examen/.test(msg)) {
      return 'Para chequeo preventivo o medicina general puedes ver al Dr. Pérez. Tenemos paquetes de exámenes con convenio Isapre/Fonasa. ¿Tienes preferencia de horario?';
    }
    if (/estética|estetica|botox|relleno|láser|laser|depilac/.test(msg)) {
      return 'Tenemos procedimientos estéticos con la Dra. Soto, primera consulta gratuita para evaluar tratamiento. ¿Qué procedimiento te interesa específicamente?';
    }
    if (/precio|costo|valor|cuanto|cuánto|cobran/.test(msg)) {
      return 'Los valores varían según especialidad y convenio. Atendemos Isapre, Fonasa y particular. ¿Tienes algún sistema de salud para darte el copago exacto?';
    }
    if (/urgenc|grave|fiebre alta|sangra|emergencia/.test(msg)) {
      return 'Si es urgencia médica te derivo de inmediato a nuestra unidad de urgencias 24/7 en Av. Apoquindo 4500. ¿Necesitas que coordine ambulancia o puedes acudir por tus medios?';
    }
    if (/hora|agendar|cita|disponi/.test(msg)) {
      return 'Tenemos cupos esta semana en varias especialidades. Para agendarte, ¿cuál es el motivo de consulta y tu RUT?';
    }
    if (turn === 0 || /hola|buenas|buenos/.test(msg)) {
      return 'Hola, bienvenido/a a Clínica Vital. ¿Cuál es el motivo de tu consulta? Así te derivo al especialista más adecuado.';
    }
    if (turn >= 3) {
      return 'Para confirmar tu hora necesito un par de datos: ¿me indicas tu nombre completo, RUT y un teléfono donde podamos llamarte?';
    }
    return 'Cuéntame un poco más sobre tu motivo de consulta para sugerirte el especialista correcto. ¿Es algo que arrastras hace tiempo o es reciente?';
  }

  return 'Gracias por tu mensaje. ¿Puedes contarme un poco más para ayudarte mejor?';
}

async function generateBotReply(tenant, history, userMessage) {
  const config = await readTenant(FILES.config, tenant, {});
  const systemPrompt = config.prompt_base || 'Eres un asistente comercial cordial.';

  const aiReply = await callGemini(systemPrompt, history, userMessage);
  if (aiReply) return { reply: aiReply, source: 'gemini' };

  return { reply: mockInteligente(tenant, systemPrompt, history, userMessage), source: 'mock' };
}

app.get('/api/tenants', (req, res) => {
  res.json(VALID_TENANTS.map(id => ({
    id,
    label: id.replace('demo_', '').replace(/^./, c => c.toUpperCase())
  })));
});

app.get('/api/dashboard/kpis', async (req, res) => {
  const tenant = getTenant(req);
  const leads = await readTenant(FILES.leads, tenant, []);
  const campaigns = await readTenant(FILES.campaigns, tenant, []);
  const closed = leads.filter(l => l.status === 'Cerrado').length;
  const total = leads.length || 1;
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalLeads = campaigns.reduce((s, c) => s + (c.leads || 0), 0) || 1;
  res.json({
    newLeads: leads.length,
    conversionRate: ((closed / total) * 100).toFixed(1),
    costPerLead: Math.round(totalSpend / totalLeads),
    closedSales: closed
  });
});

app.get('/api/dashboard/chart', async (req, res) => {
  const tenant = getTenant(req);
  const labels = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' }));
  }
  const profiles = {
    demo_automotora: { leads: [12, 19, 15, 22, 28, 24, 31], sales: [2, 4, 3, 5, 7, 6, 8] },
    demo_clinica: { leads: [8, 11, 14, 9, 17, 21, 19], sales: [3, 5, 6, 4, 8, 9, 7] }
  };
  const p = profiles[tenant] || profiles.demo_automotora;
  res.json({ labels, leads: p.leads, sales: p.sales });
});

app.get('/api/leads', async (req, res) => {
  const tenant = getTenant(req);
  res.json(await readTenant(FILES.leads, tenant, []));
});

app.get('/api/leads/:id', async (req, res) => {
  const tenant = getTenant(req);
  const leads = await readTenant(FILES.leads, tenant, []);
  const lead = leads.find(l => l.id == req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  res.json(lead);
});

app.post('/api/leads', async (req, res) => {
  const tenant = getTenant(req);
  const leads = await readTenant(FILES.leads, tenant, []);
  const newLead = {
    id: Date.now(),
    chatHistory: [],
    ...req.body,
    lastInteraction: new Date().toISOString()
  };
  leads.unshift(newLead);
  await writeTenant(FILES.leads, tenant, leads);
  res.json(newLead);
});

app.put('/api/leads/:id', async (req, res) => {
  const tenant = getTenant(req);
  const leads = await readTenant(FILES.leads, tenant, []);
  const idx = leads.findIndex(l => l.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Lead no encontrado' });
  leads[idx] = { ...leads[idx], ...req.body, lastInteraction: new Date().toISOString() };
  await writeTenant(FILES.leads, tenant, leads);
  res.json(leads[idx]);
});

app.get('/api/bot', async (req, res) => {
  const tenant = getTenant(req);
  res.json(await readTenant(FILES.bot, tenant, {}));
});

app.put('/api/bot', async (req, res) => {
  const tenant = getTenant(req);
  const current = await readTenant(FILES.bot, tenant, {});
  const updated = { ...current, ...req.body };
  await writeTenant(FILES.bot, tenant, updated);
  res.json(updated);
});

app.get('/api/pipeline', async (req, res) => {
  const tenant = getTenant(req);
  const config = await readTenant(FILES.config, tenant, {});
  const leads = await readTenant(FILES.leads, tenant, []);
  const stages = config.stages || [];
  res.json(stages.map(s => ({ stage: s, leads: leads.filter(l => l.status === s) })));
});

app.get('/api/campaigns', async (req, res) => {
  const tenant = getTenant(req);
  res.json(await readTenant(FILES.campaigns, tenant, []));
});

app.get('/api/config', async (req, res) => {
  const tenant = getTenant(req);
  res.json(await readTenant(FILES.config, tenant, {}));
});

app.put('/api/config', async (req, res) => {
  const tenant = getTenant(req);
  const current = await readTenant(FILES.config, tenant, {});
  const updated = { ...current, ...req.body };
  await writeTenant(FILES.config, tenant, updated);
  res.json(updated);
});

app.post('/api/chat', async (req, res) => {
  const tenant = getTenant(req);
  const { sessionId, message, name, phone } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId y message son requeridos' });
  }

  let session = chatSessions.get(sessionId);
  let leadCaptured = false;
  let leadId;

  const leads = await readTenant(FILES.leads, tenant, []);

  if (!session) {
    leadId = Date.now();
    const newLead = {
      id: leadId,
      name: name || 'Visitante anónimo',
      phone: phone || 'Pendiente',
      source: 'Chat Web (Simulador)',
      status: 'Nuevo',
      lastInteraction: new Date().toISOString(),
      interest: message.slice(0, 80),
      sessionId,
      chatHistory: []
    };
    leads.unshift(newLead);
    session = { tenant, leadId, step: 0 };
    chatSessions.set(sessionId, session);
    leadCaptured = true;
  } else {
    leadId = session.leadId;
    session.step += 1;
  }

  const idx = leads.findIndex(l => l.id === leadId);
  if (idx === -1) return res.status(500).json({ error: 'Lead no encontrado en BD' });

  if (!Array.isArray(leads[idx].chatHistory)) leads[idx].chatHistory = [];
  leads[idx].chatHistory.push({ role: 'user', content: message, ts: Date.now() });

  const { reply, source } = await generateBotReply(tenant, leads[idx].chatHistory, message);

  leads[idx].chatHistory.push({ role: 'bot', content: reply, ts: Date.now() });
  leads[idx].lastInteraction = new Date().toISOString();
  if (session.step >= 2 && leads[idx].status === 'Nuevo') {
    leads[idx].status = 'Contactado';
  }

  await writeTenant(FILES.leads, tenant, leads);

  res.json({ reply, sessionId, leadCaptured, leadId, source });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

seedIfEmpty().then(() => {
  app.listen(PORT, () => {
    console.log(`CRM running on http://localhost:${PORT}`);
    console.log(`Gemini: ${GEMINI_API_KEY ? 'ACTIVO (' + GEMINI_MODEL + ')' : 'INACTIVO (usando Mock Inteligente)'}`);
  });
});

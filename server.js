'use strict';

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const express  = require('express');
const path     = require('path');
const fs       = require('fs').promises;
const fsSync   = require('fs');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.RENDER ? '/var/data' : path.join(__dirname, 'data');
if (!fsSync.existsSync(DATA)) fsSync.mkdirSync(DATA, { recursive: true });

app.use(express.json({ limit: '2mb' }));

const F = {
  users:     path.join(DATA, 'users.json'),
  leads:     path.join(DATA, 'leads.json'),
  config:    path.join(DATA, 'config.json'),
  bot:       path.join(DATA, 'bot.json'),
  inventory: path.join(DATA, 'inventory.json'),
  rr:        path.join(DATA, 'rr.json'),
  spend:     path.join(DATA, 'spend.json')
};

const TENANTS        = ['demo_automotora', 'demo_clinica'];
const sessions       = new Map();
const chatSessions   = new Map();
const SLA_FRESH      = 10;
const SLA_RISK       = 20;
const SLA_CRITICAL   = 30;
const SLA_REASSIGN   = 30;
const FINAL_STATUSES  = new Set(['Cerrado','Abandonado','Perdido']);
const QUALIFIED_STAGE = 'Lead Calificado - Contacto Agendado';
const VALID_STATUSES  = new Set([
  'Nuevo','En Proceso','Contactado','Calificado','Agendado','Seguimiento',
  'Negociación','Atendido', QUALIFIED_STAGE,'Cerrado','Abandonado','Perdido'
]);

const read   = async f      => { try { return JSON.parse(await fs.readFile(f,'utf8')); } catch { return {}; } };
const write  = (f,d)        => fs.writeFile(f, JSON.stringify(d,null,2));
const tRead  = async (f,t,fb=[]) => { const s=await read(f); return s[t]!==undefined?s[t]:fb; };
const tWrite = async (f,t,d) => { const s=await read(f); s[t]=d; await write(f,s); };
const validTenant = t => TENANTS.includes(t) ? t : TENANTS[0];

// ─── Marcela ─────────────────────────────────────────────────────────────────
function invStr(inv) {
  if (!Array.isArray(inv)||!inv.length) return '(sin inventario)';
  return inv.map(i=>`- [${i.id}] ${i.model}${i.year?' '+i.year:''} | Stock:${i.stock} | $${(i.price||0).toLocaleString('es-CL')}${i.fuel?'|'+i.fuel:''}${i.color?'|'+i.color:''}${i.highlights?'|'+i.highlights:''}`).join('\n');
}

function marcelaSystem(businessName, inventarioStr) {
  return `Eres Marcela, asesora comercial de ${businessName}. Español de Chile, tono cercano y profesional.

INVENTARIO:
${inventarioStr}

REGLAS:
1. Ante consulta de modelo: confirma stock y ofrece 1-2 alternativas similares del inventario.
2. Si detectas interés real, finaliza SIEMPRE con este CTA exacto: "¿Te gustaría que te llame un ejecutivo para darte el mejor precio o coordinar una prueba de manejo? Trabajamos de 09:00 a 20:00 hrs. Dime qué día y a qué hora te acomoda más."
3. Si el cliente propone hora fuera de 09:00-20:00, rechaza y propón día siguiente 09:00.
4. Precios CLP con punto de miles: $24.990.000.
5. Jamás inventes datos fuera del inventario.

RESPONDE ÚNICAMENTE con este JSON (sin markdown):
{"reply":"<texto>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota>","schedule_detected":true|false,"schedule_text":"<hora detectada>"}

SEMÁFORO — BLUE: agenda explícita y concreta. YELLOW: intención tibia. NONE: sin respuesta al CTA.`;
}

function parseJSON(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a===-1||b===-1) return null;
  try { return JSON.parse(s.slice(a,b+1)); } catch { return null; }
}

function fueraHorario(txt) {
  const m = (txt||'').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);
  if (!m) return false;
  let h = parseInt(m[1],10);
  const mer = (m[3]||'').toLowerCase();
  if (mer==='pm'&&h<12) h+=12; if (mer==='am'&&h===12) h=0;
  return h<9||h>=20;
}

async function marcela(tenant, history, msg) {
  try {
    const cfg = (await read(F.config))[tenant]||{};
    const inv = await tRead(F.inventory,tenant,[]);
    const completion = await openai.chat.completions.create({
      model:'gpt-4o-mini', temperature:0.4,
      response_format:{type:'json_object'},
      messages:[
        {role:'system', content:marcelaSystem(cfg.businessName||'la empresa', invStr(inv))},
        ...history.slice(-12).map(h=>({role:h.role==='user'?'user':'assistant',content:h.content})),
        {role:'user', content:msg}
      ]
    });
    let p = parseJSON(completion.choices?.[0]?.message?.content||'');
    if (!p) p={reply:'Disculpa, tuve un error. ¿Repites?',intent_signal:'NONE',intent_reason:'fallback',schedule_detected:false,schedule_text:''};
    if (p.schedule_detected && fueraHorario(p.schedule_text)) {
      p.reply+='\n\n(Nuestro horario es 09:00-20:00 hrs. Te propongo mañana a las 09:00, ¿te acomoda?)';
      p.intent_signal='YELLOW';
    }
    return p;
  } catch(e) {
    console.error('Marcela error:',e.message);
    return {reply:'Lo siento, problema técnico. ¿Podrías repetir?',intent_signal:'NONE',intent_reason:'error',schedule_detected:false,schedule_text:''};
  }
}

function semaforo(lead, p) {
  if (p.intent_signal==='BLUE'||p.intent_signal==='YELLOW') {
    lead.intentSignal=p.intent_signal; lead.status=QUALIFIED_STAGE; lead.scheduleText=p.schedule_text||'';
  } else if (!lead.intentSignal) lead.intentSignal='NONE';
}

// ─── Round Robin ─────────────────────────────────────────────────────────────
async function activeSellers(tenant) {
  const u = await tRead(F.users,tenant);
  return u.filter(x=>x.role==='vendedor'&&(!x.status||x.status==='Activo'));
}
async function rrNext(tenant, exclude=null) {
  const sellers = await activeSellers(tenant);
  if (!sellers.length) return null;
  const pool = exclude ? sellers.filter(s=>s.username!==exclude) : sellers;
  const list = pool.length ? pool : sellers;
  const rr = await read(F.rr);
  const idx = (rr[tenant]||0)%list.length;
  rr[tenant] = (idx+1)%list.length;
  await write(F.rr,rr);
  return list[idx].username;
}

// ─── SLA — sin delegación a gerente ──────────────────────────────────────────
function alertLevel(lead) {
  if (FINAL_STATUSES.has(lead.status)) return 'none';
  if (lead.status!=='Nuevo') return 'none';
  const m = (Date.now()-new Date(lead.lastInteraction).getTime())/60000;
  if (m>SLA_CRITICAL) return 'critical';
  if (m>SLA_RISK||lead.reassigned) return 'risk';
  return 'fresh';
}

async function applySlaRules(tenant) {
  const leads = await tRead(F.leads,tenant);
  let changed = false;
  for (const lead of leads) {
    if (FINAL_STATUSES.has(lead.status)) continue;
    const prev = lead.alertLevel||'none';
    const mins = (Date.now()-new Date(lead.lastInteraction).getTime())/60000;

    if (lead.status==='Nuevo' && mins>SLA_REASSIGN && !lead.reassigned) {
      const next = await rrNext(tenant, lead.assignedTo);
      if (next && next!==lead.assignedTo) {
        lead.assignedTo   = next;
      }
      // Siempre marca como reasignado/crítico; NUNCA fuerza gerente
      lead.reassigned   = true;
      lead.reassignedAt = new Date().toISOString();
      lead.alertLevel   = 'critical';
      changed = true;
      continue;
    }

    const lvl = alertLevel(lead);
    if (lvl!==prev) { lead.alertLevel=lvl; changed=true; }
    if (lead.botActive===undefined) { lead.botActive=true; changed=true; }
  }
  if (changed) await tWrite(F.leads,tenant,leads);
  return leads;
}

// ─── Filtro de fechas ─────────────────────────────────────────────────────────
function parseRange(start, end) {
  let s=null,e=null;
  if (start){const d=new Date(start);if(!isNaN(d)){d.setHours(0,0,0,0);s=d.getTime();}}
  if (end)  {const d=new Date(end);  if(!isNaN(d)){d.setHours(23,59,59,999);e=d.getTime();}}
  return {s,e};
}
function inRange(lead,s,e) {
  if (s===null&&e===null) return true;
  const ts=new Date(lead.lastInteraction||0).getTime();
  return (s===null||ts>=s)&&(e===null||ts<=e);
}

// ─── Seed — Clean Slate ───────────────────────────────────────────────────────
async function seed() {
  const users = await read(F.users);
  if (!users.demo_automotora) users.demo_automotora=[
    {username:'gerente',  password:'demo',name:'Andrés Salas',  role:'admin'},
    {username:'vendedor1',password:'demo',name:'Rodrigo Vidal', role:'vendedor',status:'Activo'},
    {username:'vendedor2',password:'demo',name:'Camila Aravena',role:'vendedor',status:'Activo'},
    {username:'recepcion',password:'demo',name:'Daniela Ortiz', role:'secretaria'}
  ];
  if (!users.demo_clinica) users.demo_clinica=[
    {username:'gerente',  password:'demo',name:'Dr. Hernán Vidal',role:'admin'},
    {username:'vendedor1',password:'demo',name:'Karina Bravo',    role:'vendedor',status:'Activo'},
    {username:'recepcion',password:'demo',name:'Marcela Tapia',   role:'secretaria'}
  ];
  await write(F.users,users);

  // CLEAN SLATE — arrays vacíos al iniciar
  const leads = await read(F.leads);
  if (!leads.demo_automotora) leads.demo_automotora=[];
  if (!leads.demo_clinica)    leads.demo_clinica=[];
  await write(F.leads,leads);

  const cfg = await read(F.config);
  if (!cfg.demo_automotora) cfg.demo_automotora={
    businessName:'Automotora Andes',accentColor:'#3b82f6',
    stages:['Nuevo','En Proceso','Contactado','Calificado',QUALIFIED_STAGE,'Negociación','Agendado','Seguimiento','Cerrado','Abandonado']
  };
  if (!cfg.demo_clinica) cfg.demo_clinica={
    businessName:'Clínica Vital',accentColor:'#0d9488',
    stages:['Nuevo','En Proceso','Contactado','Agendado',QUALIFIED_STAGE,'Atendido','Seguimiento','Cerrado','Abandonado']
  };
  for (const t of TENANTS) {
    if (cfg[t]&&Array.isArray(cfg[t].stages)&&!cfg[t].stages.includes(QUALIFIED_STAGE))
      cfg[t].stages.splice(Math.max(1,cfg[t].stages.length-2),0,QUALIFIED_STAGE);
  }
  await write(F.config,cfg);

  const bot = await read(F.bot);
  if (!bot.demo_automotora) bot.demo_automotora={greeting:'¡Hola! Soy Marcela de Automotora Andes. ¿Qué vehículo buscas?'};
  if (!bot.demo_clinica)    bot.demo_clinica   ={greeting:'Hola, soy el asistente de Clínica Vital. ¿En qué especialidad te atendemos?'};
  await write(F.bot,bot);

  const inv = await read(F.inventory);
  if (!inv.demo_automotora) inv.demo_automotora=[
    {id:'AND-SUV-001',model:'SUV Grand Explorer 7P 2.0T',year:2026,stock:3,price:24990000,color:'Gris Grafito',fuel:'Bencina',highlights:'Techo panorámico, 3 filas, 5★ seguridad.'},
    {id:'AND-SUV-002',model:'SUV Compact Advance 1.5L',  year:2025,stock:5,price:18490000,color:'Blanco Perla',fuel:'Bencina',highlights:'Ciudad, bajo consumo, cámara 360.'},
    {id:'AND-SED-001',model:'Sedán Executive 1.6L',       year:2026,stock:8,price:14990000,color:'Negro Profundo',fuel:'Bencina',highlights:'Desde $190k/mes, entrega inmediata.'},
    {id:'AND-PCK-001',model:'Camioneta Workhorse 4x4 D',  year:2026,stock:4,price:22990000,color:'Rojo Carmín',fuel:'Diésel',highlights:'1 ton carga, tracción integral, turbo.'},
    {id:'AND-EV-001', model:'E-City Compact Eléctrico',   year:2026,stock:2,price:19990000,color:'Verde Mint',fuel:'Eléctrico',highlights:'400km autonomía, carga rápida.'},
    {id:'AND-LR-001', model:'Land Rover Discovery Sport 2.0D Auto',year:2023,stock:1,price:43690000,color:'Blanco',fuel:'Diésel',highlights:'Garantía extendida, 3 filas, premium.'}
  ];
  if (!inv.demo_clinica) inv.demo_clinica=[
    {id:'VIT-DERM',model:'Hora Dermatología',stock:12,price:45000},
    {id:'VIT-GIN', model:'Hora Ginecología', stock:9, price:50000},
    {id:'VIT-MG',  model:'Medicina General', stock:25,price:32000}
  ];
  await write(F.inventory,inv);

  const spend = await read(F.spend);
  if (!spend.demo_automotora) spend.demo_automotora={'Meta Ads':1850000,'Chileautos':980000,'Google Ads':1420000,'Instagram':540000,'Landing Page':0,'Referido':0,'WhatsApp':0};
  if (!spend.demo_clinica)    spend.demo_clinica   ={'Meta Ads':620000,'Google Ads':880000,'Instagram':310000,'Landing Page':0};
  await write(F.spend,spend);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const auth = (...roles) => async (req,res,next) => {
  const token = req.header('X-Auth-Token')||req.query.token;
  const sess  = sessions.get(token);
  if (!sess) return res.status(401).json({error:'No autenticado'});
  if (roles.length&&!roles.includes(sess.user.role)) return res.status(403).json({error:'Sin permisos'});
  req.user=sess.user; req.tenant=sess.tenant; next();
};
const byRole = (leads,user) => user.role==='vendedor' ? leads.filter(l=>l.assignedTo===user.username) : leads;

app.post('/api/auth/login', async (req,res) => {
  const {username,password,tenant}=req.body||{};
  const t=validTenant(tenant);
  const users=await tRead(F.users,t);
  const u=users.find(x=>x.username===username&&x.password===password);
  if (!u) return res.status(401).json({error:'Credenciales incorrectas'});
  const token=crypto.randomBytes(24).toString('hex');
  const safe={username:u.username,name:u.name,role:u.role};
  sessions.set(token,{user:safe,tenant:t});
  res.json({token,user:safe,tenant:t});
});
app.post('/api/auth/logout',(req,res)=>{sessions.delete(req.header('X-Auth-Token'));res.json({ok:true});});
app.get('/api/me',auth(),(req,res)=>res.json({user:req.user,tenant:req.tenant}));

// ─── Leads ────────────────────────────────────────────────────────────────────
app.get('/api/leads', auth(), async (req,res) => {
  const all=await applySlaRules(req.tenant);
  const {s,e}=parseRange(req.query.start,req.query.end);
  let leads=byRole(all,req.user);
  if (s!==null||e!==null) leads=leads.filter(l=>inRange(l,s,e));
  leads.forEach(l=>{
    if (!Array.isArray(l.chatHistory)) l.chatHistory=[];
    if (!Array.isArray(l.notes))       l.notes=[];
    if (!l.intentSignal)               l.intentSignal='NONE';
  });
  res.json(leads);
});

app.get('/api/leads/:id', auth(), async (req,res) => {
  await applySlaRules(req.tenant);
  const leads=await tRead(F.leads,req.tenant);
  const l=leads.find(x=>x.id==req.params.id);
  if (!l) return res.status(404).json({error:'No encontrado'});
  if (req.user.role==='vendedor'&&l.assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  res.json(l);
});

app.patch('/api/leads/:id', auth(), async (req,res) => {
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if (idx===-1) return res.status(404).json({error:'No encontrado'});
  if (req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  const ALLOWED=['status','interest','name','phone','botActive'];
  if (req.user.role!=='vendedor') ALLOWED.push('assignedTo');
  const patch={};
  for (const k of ALLOWED) if (req.body[k]!==undefined) patch[k]=req.body[k];
  if (patch.status!==undefined&&!VALID_STATUSES.has(patch.status)) return res.status(400).json({error:'Status inválido'});
  if (req.body.note&&String(req.body.note).trim()) {
    leads[idx].notes=Array.isArray(leads[idx].notes)?leads[idx].notes:[];
    leads[idx].notes.push({content:String(req.body.note).trim(),author:req.user.name||req.user.username,ts:Date.now()});
  }
  Object.assign(leads[idx],patch);
  leads[idx].lastInteraction=new Date().toISOString();
  leads[idx].alertLevel=alertLevel(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

app.put('/api/leads/:id', auth(), async (req,res) => {
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if (idx===-1) return res.status(404).json({error:'No encontrado'});
  if (req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  if (req.user.role==='vendedor') delete req.body.assignedTo;
  leads[idx]={...leads[idx],...req.body,lastInteraction:new Date().toISOString()};
  leads[idx].alertLevel=alertLevel(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

app.post('/api/leads/:id/bot', auth(), async (req,res) => {
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if (idx===-1) return res.status(404).json({error:'No encontrado'});
  leads[idx].botActive=!!req.body.botActive;
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

app.post('/api/leads/:id/message', auth('admin','vendedor'), async (req,res) => {
  const {content}=req.body||{};
  if (!content) return res.status(400).json({error:'content requerido'});
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if (idx===-1) return res.status(404).json({error:'No encontrado'});
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'agent',content,ts:Date.now(),agent:req.user.username});
  leads[idx].botActive=false;
  leads[idx].lastInteraction=new Date().toISOString();
  leads[idx].alertLevel=alertLevel(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

// ─── Pipeline / Dashboard / Analytics ────────────────────────────────────────
app.get('/api/pipeline', auth(), async (req,res) => {
  const cfg=await tRead(F.config,req.tenant,{});
  const all=await applySlaRules(req.tenant);
  const {s,e}=parseRange(req.query.start,req.query.end);
  let leads=byRole(all,req.user);
  if (s!==null||e!==null) leads=leads.filter(l=>inRange(l,s,e));
  res.json((cfg.stages||[]).map(st=>({stage:st,leads:leads.filter(l=>l.status===st)})));
});

app.get('/api/dashboard/kpis', auth('admin'), async (req,res) => {
  const all=await applySlaRules(req.tenant);
  const {s,e}=parseRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const now=Date.now();
  const minOf=l=>(now-new Date(l.lastInteraction).getTime())/60000;
  const nuevos=leads.filter(l=>l.status==='Nuevo');
  const closed=leads.filter(l=>l.status==='Cerrado').length;
  const qualified=leads.filter(l=>l.status===QUALIFIED_STAGE).length;
  const avg=nuevos.length?Math.round(nuevos.reduce((a,l)=>a+minOf(l),0)/nuevos.length):0;
  res.json({
    total:leads.length, active:leads.filter(l=>!FINAL_STATUSES.has(l.status)).length,
    closed, qualified,
    slaFresh:   nuevos.filter(l=>minOf(l)<=SLA_FRESH).length,
    slaRisk:    nuevos.filter(l=>minOf(l)>SLA_FRESH&&minOf(l)<=SLA_RISK).length,
    slaCritical:nuevos.filter(l=>minOf(l)>SLA_RISK).length,
    avgResponseMin:avg,
    conversionRate:leads.length?((closed/leads.length)*100).toFixed(1):'0.0',
    byStatus:{
      nuevo:      nuevos.length,
      contactado: leads.filter(l=>l.status==='Contactado').length,
      calificado: qualified,
      agendado:   leads.filter(l=>l.status==='Agendado').length,
      negociacion:leads.filter(l=>l.status==='Negociación').length,
      seguimiento:leads.filter(l=>l.status==='Seguimiento').length,
      cerrado:    closed,
      abandonado: leads.filter(l=>l.status==='Abandonado').length
    }
  });
});

app.get('/api/dashboard/team', auth('admin'), async (req,res) => {
  const users=await tRead(F.users,req.tenant);
  const all=await tRead(F.leads,req.tenant);
  const {s,e}=parseRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const now=Date.now();
  const minOf=l=>(now-new Date(l.lastInteraction).getTime())/60000;
  res.json(users.filter(u=>u.role==='vendedor').map(v=>{
    const own=leads.filter(l=>l.assignedTo===v.username);
    const nv=own.filter(l=>l.status==='Nuevo');
    return {
      username:v.username, name:v.name, total:own.length,
      sla:{
        fresh:   nv.filter(l=>minOf(l)<=SLA_FRESH).length,
        risk:    nv.filter(l=>minOf(l)>SLA_FRESH&&minOf(l)<=SLA_RISK).length,
        critical:nv.filter(l=>minOf(l)>SLA_RISK).length
      },
      byStatus:{
        nuevo:      nv.length,
        contactado: own.filter(l=>l.status==='Contactado').length,
        calificado: own.filter(l=>l.status===QUALIFIED_STAGE).length,
        agendado:   own.filter(l=>l.status==='Agendado').length,
        negociacion:own.filter(l=>l.status==='Negociación').length,
        seguimiento:own.filter(l=>l.status==='Seguimiento').length,
        cerrado:    own.filter(l=>l.status==='Cerrado').length,
        abandonado: own.filter(l=>l.status==='Abandonado').length
      },
      leads:own.map(l=>({...l,chatHistory:Array.isArray(l.chatHistory)?l.chatHistory:[],notes:Array.isArray(l.notes)?l.notes:[],intentSignal:l.intentSignal||'NONE'}))
    };
  }).filter(v=>v.total>0));
});

app.get('/api/analytics/channels', auth('admin'), async (req,res) => {
  const all=await tRead(F.leads,req.tenant);
  const {s,e}=parseRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const spend=await tRead(F.spend,req.tenant,{});
  const ch={};
  for (const l of leads) {
    const c=l.source||'Otro';
    if (!ch[c]) ch[c]={channel:c,leads:0,sales:0,spend:spend[c]||0,models:{}};
    ch[c].leads++;
    if (l.status==='Cerrado'){ch[c].sales++;const m=l.model||l.interest||'—';ch[c].models[m]=(ch[c].models[m]||0)+1;}
  }
  res.json(Object.values(ch).map(c=>{
    let top='—',tc=0;
    for (const [m,n] of Object.entries(c.models)) if(n>tc){top=m;tc=n;}
    return {channel:c.channel,spend:c.spend,leads:c.leads,sales:c.sales,topModel:top,
      cpl:c.leads?Math.round(c.spend/c.leads):0,cac:c.sales?Math.round(c.spend/c.sales):0,
      conversion:c.leads?((c.sales/c.leads)*100).toFixed(1):'0.0'};
  }).sort((a,b)=>b.spend-a.spend));
});

// ─── Users / Config / Bot / Inventory ────────────────────────────────────────
app.get('/api/users',     auth('admin'), async (req,res)=>res.json((await tRead(F.users,req.tenant)).map(u=>({username:u.username,name:u.name,role:u.role,status:u.status||null}))));
app.get('/api/config',    auth(),        async (req,res)=>res.json(await tRead(F.config,req.tenant,{})));
app.put('/api/config',    auth('admin'), async (req,res)=>{const u={...await tRead(F.config,req.tenant,{}),...req.body};await tWrite(F.config,req.tenant,u);res.json(u);});
app.get('/api/bot',       auth('admin'), async (req,res)=>res.json(await tRead(F.bot,req.tenant,{})));
app.put('/api/bot',       auth('admin'), async (req,res)=>{const u={...await tRead(F.bot,req.tenant,{}),...req.body};await tWrite(F.bot,req.tenant,u);res.json(u);});
app.get('/api/inventory', auth('admin','vendedor'), async (req,res)=>res.json(await tRead(F.inventory,req.tenant)));

// ─── Chat simulador ───────────────────────────────────────────────────────────
app.post('/api/chat', async (req,res) => {
  const tenant=validTenant(req.body?.tenant||req.query.tenant);
  const {sessionId,message}=req.body||{};
  if (!sessionId||!message) return res.status(400).json({error:'sessionId y message requeridos'});
  const leads=await tRead(F.leads,tenant);
  let sess=chatSessions.get(sessionId), captured=false, leadId;
  if (!sess) {
    leadId=Date.now();
    const assigned=await rrNext(tenant);
    leads.unshift({id:leadId,name:'Visitante anónimo',phone:'Pendiente',source:'Chat Web',status:'Nuevo',
      lastInteraction:new Date().toISOString(),interest:message.slice(0,80),sessionId,
      assignedTo:assigned,botActive:true,alertLevel:'none',intentSignal:'NONE',notes:[],chatHistory:[]});
    sess={tenant,leadId,step:0}; chatSessions.set(sessionId,sess); captured=true;
  } else { leadId=sess.leadId; sess.step++; }
  const idx=leads.findIndex(l=>l.id===leadId);
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'user',content:message,ts:Date.now()});
  if (leads[idx].botActive!==false) {
    const p=await marcela(tenant,leads[idx].chatHistory.slice(0,-1),message);
    leads[idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
    leads[idx].lastInteraction=new Date().toISOString();
    semaforo(leads[idx],p);
    if (sess.step>=2&&leads[idx].status==='Nuevo'&&leads[idx].intentSignal==='NONE') leads[idx].status='Contactado';
    await tWrite(F.leads,tenant,leads);
    return res.json({reply:p.reply,sessionId,leadCaptured:captured,leadId,intentSignal:leads[idx].intentSignal,status:leads[idx].status});
  }
  await tWrite(F.leads,tenant,leads);
  res.json({reply:null,sessionId,leadCaptured:captured,leadId,botPaused:true});
});

// ─── Webhook WhatsApp + Escudo Body Elite ────────────────────────────────────
async function sendWA(to,text) {
  const token=process.env.WA_TOKEN, phoneId=process.env.WA_PHONE_ID;
  if (!token||!phoneId) return;
  try {
    await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`,{
      method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:text}})
    });
  } catch(e){console.error('WA send:',e);}
}

const SHIELD=['body elite','bodyelite','botox','lipo','lipoescultura','liposuccion','estetica','estética','masaje','masajes','doctora','tratamiento','acido hialuronico','hialurónico'];
const SHIELD_RESP='¡Hola! Este número es exclusivo de Automotora Andes. Si buscas a la clínica Body Elite, contáctalos por Instagram. ¡Gracias!';
function isShield(t){if(!t)return false;const n=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return SHIELD.some(k=>n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));}

app.get('/webhook',(req,res)=>{
  const vt=process.env.WA_VERIFY_TOKEN||'zara_token_123';
  if (req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===vt) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req,res) => {
  if (!req.body.object) return res.sendStatus(404);
  res.sendStatus(200);
  try {
    const val=req.body.entry?.[0]?.changes?.[0]?.value;
    const msg=val?.messages?.[0];
    if (!msg) return;
    const from=msg.from;
    const body=msg.text?.body||msg.button?.text||null;
    if (!body) return;
    if (isShield(body)){await sendWA(from,SHIELD_RESP);return;}
    const contactName=val.contacts?.[0]?.profile?.name||'WhatsApp Lead';
    const tenant='demo_automotora';
    const leadsData=await read(F.leads);
    if (!leadsData[tenant]) leadsData[tenant]=[];
    let idx=leadsData[tenant].findIndex(l=>l.phone&&l.phone.replace(/\D/g,'').includes(from.replace(/\D/g,'')));
    if (idx===-1){
      const assigned=await rrNext(tenant)||'vendedor1';
      leadsData[tenant].unshift({id:Date.now(),name:contactName,phone:'+'+from,source:'WhatsApp',status:'Nuevo',
        lastInteraction:new Date().toISOString(),interest:body.slice(0,80),
        assignedTo:assigned,botActive:true,alertLevel:'none',intentSignal:'NONE',notes:[],chatHistory:[]});
      idx=0;
    }
    leadsData[tenant][idx].chatHistory=leadsData[tenant][idx].chatHistory||[];
    leadsData[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    if (leadsData[tenant][idx].botActive!==false){
      const p=await marcela(tenant,leadsData[tenant][idx].chatHistory.slice(0,-1),body);
      leadsData[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
      semaforo(leadsData[tenant][idx],p);
      const ut=leadsData[tenant][idx].chatHistory.filter(m=>m.role==='user').length;
      if (ut>=2&&leadsData[tenant][idx].status==='Nuevo'&&leadsData[tenant][idx].intentSignal==='NONE') leadsData[tenant][idx].status='Contactado';
      await sendWA(from,p.reply);
    }
    leadsData[tenant][idx].lastInteraction=new Date().toISOString();
    leadsData[tenant][idx].alertLevel=alertLevel(leadsData[tenant][idx]);
    await write(F.leads,leadsData);
  } catch(e){console.error('Webhook:',e);}
});

// ─── Static + SLA job + Listen ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
setInterval(async()=>{for(const t of TENANTS){try{await applySlaRules(t);}catch(e){console.error('SLA',t,e.message);}}},60000);
seed().then(()=>app.listen(PORT,()=>{
  console.log(`🚀 FunnelOS en http://localhost:${PORT}`);
  console.log(`🔐 gerente/demo · vendedor1/demo · vendedor2/demo`);
  console.log(`🤖 Marcela JSON · 🛡  Escudo Body Elite · 📅 Filtro fechas · ✅ Clean Slate · 🚫 Sin delegación a gerente`);
}));

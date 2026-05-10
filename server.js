'use strict';
const { OpenAI } = require('openai');
const openai     = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const express    = require('express');
const path       = require('path');
const fs         = require('fs').promises;
const fsSync     = require('fs');
const crypto     = require('crypto');

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
const SLA_GREEN      = 20;
const SLA_YELLOW     = 30;
const FINAL_ST       = new Set(['Cerrado','Abandonado','Perdido']);
const QUAL_STAGE     = 'Lead Calificado - Contacto Agendado';
const VALID_ST       = new Set(['Nuevo','En Proceso','Contactado','Calificado','Agendado',
                                 'Seguimiento','Negociación','Atendido',QUAL_STAGE,
                                 'Cerrado','Abandonado','Perdido']);

const read   = async f        => { try { return JSON.parse(await fs.readFile(f,'utf8')); } catch { return {}; } };
const write  = (f,d)          => fs.writeFile(f, JSON.stringify(d,null,2));
const tRead  = async(f,t,fb=[])=> { const s=await read(f); return s[t]!==undefined?s[t]:fb; };
const tWrite = async(f,t,d)   => { const s=await read(f); s[t]=d; await write(f,s); };
const validT = t => TENANTS.includes(t) ? t : TENANTS[0];

// ─── Marcela ─────────────────────────────────────────────────────────────────
function invStr(inv){
  if(!Array.isArray(inv)||!inv.length) return '(sin inventario)';
  return inv.map(i=>`- [${i.id}] ${i.brand} ${i.model}${i.year?' '+i.year:''} | Stock:${i.stock} | $${(i.price||0).toLocaleString('es-CL')}${i.fuel?'|'+i.fuel:''}${i.highlights?'|'+i.highlights:''}`).join('\n');
}
function marcelaSys(biz,invS){
  return `Eres Marcela, asesora de ${biz}. Español Chile, cercana y profesional.
INVENTARIO:\n${invS}
REGLAS:
1. Ante consulta de modelo: confirma stock y ofrece 1-2 alternativas.
2. Si detectas interés real termina con: "¿Te gustaría que te llame un ejecutivo para darte el mejor precio o coordinar una prueba de manejo? Trabajamos de 09:00 a 20:00 hrs. Dime qué día y a qué hora te acomoda más."
3. Hora fuera 09:00-20:00: propón día siguiente 09:00.
4. Precios CLP con punto de miles. Nunca inventes datos.
RESPONDE SOLO JSON sin markdown:
{"reply":"<texto>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota>","schedule_detected":true|false,"schedule_text":"<hora>"}`;
}
function parseJ(raw){
  if(!raw) return null;
  const s=raw.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a===-1||b===-1) return null;
  try{ return JSON.parse(s.slice(a,b+1)); }catch{ return null; }
}
function fueraH(txt){
  const m=(txt||'').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);
  if(!m) return false;
  let h=parseInt(m[1],10);
  const mer=(m[3]||'').toLowerCase();
  if(mer==='pm'&&h<12) h+=12; if(mer==='am'&&h===12) h=0;
  return h<9||h>=20;
}
async function marcela(tenant,history,msg){
  try{
    const cfg=(await read(F.config))[tenant]||{};
    const inv=await tRead(F.inventory,tenant,[]);
    const completion=await openai.chat.completions.create({
      model:'gpt-4o-mini',temperature:0.4,
      response_format:{type:'json_object'},
      messages:[
        {role:'system',content:marcelaSys(cfg.businessName||'la empresa',invStr(inv))},
        ...history.slice(-12).map(h=>({role:h.role==='user'?'user':'assistant',content:h.content})),
        {role:'user',content:msg}
      ]
    });
    let p=parseJ(completion.choices?.[0]?.message?.content||'');
    if(!p) p={reply:'Disculpa, error técnico. ¿Repites?',intent_signal:'NONE',intent_reason:'fallback',schedule_detected:false,schedule_text:''};
    if(p.schedule_detected&&fueraH(p.schedule_text)){
      p.reply+='\n\n(Nuestro horario es 09:00-20:00. Te propongo mañana a las 09:00, ¿te acomoda?)';
      p.intent_signal='YELLOW';
    }
    return p;
  }catch(e){
    console.error('Marcela:',e.message);
    return{reply:'Problema técnico. ¿Podrías repetir?',intent_signal:'NONE',intent_reason:'error',schedule_detected:false,schedule_text:''};
  }
}
function applySignal(lead,p){
  if(p.intent_signal==='BLUE'||p.intent_signal==='YELLOW'){
    lead.intentSignal=p.intent_signal; lead.status=QUAL_STAGE; lead.scheduleText=p.schedule_text||'';
  } else if(!lead.intentSignal) lead.intentSignal='NONE';
}

// ─── Round Robin ─────────────────────────────────────────────────────────────
async function sellers(tenant){
  const u=await tRead(F.users,tenant);
  return u.filter(x=>x.role==='vendedor'&&(!x.status||x.status==='Activo'));
}
async function rrNext(tenant,exclude=null){
  const sl=await sellers(tenant);
  if(!sl.length) return null;
  const pool=exclude?sl.filter(s=>s.username!==exclude):sl;
  const list=pool.length?pool:sl;
  const rr=await read(F.rr);
  const idx=(rr[tenant]||0)%list.length;
  rr[tenant]=(idx+1)%list.length;
  await write(F.rr,rr);
  return list[idx].username;
}

// ─── SLA ─────────────────────────────────────────────────────────────────────
function calcAlert(lead){
  if(FINAL_ST.has(lead.status)) return 'none';
  if(lead.status!=='Nuevo') return 'none';
  const m=(Date.now()-new Date(lead.lastInteraction).getTime())/60000;
  if(m>SLA_YELLOW) return 'critical';
  if(m>SLA_GREEN)  return 'risk';
  return 'fresh';
}
async function applySlaRules(tenant){
  const leads=await tRead(F.leads,tenant);
  let changed=false;
  for(const lead of leads){
    if(FINAL_ST.has(lead.status)) continue;
    const prev=lead.alertLevel||'none';
    const mins=(Date.now()-new Date(lead.lastInteraction).getTime())/60000;
    if(lead.status==='Nuevo'&&mins>SLA_GREEN&&mins<=SLA_YELLOW&&!lead.reassigned){
      const next=await rrNext(tenant,lead.assignedTo);
      if(next&&next!==lead.assignedTo){
        lead.assignedTo=next; lead.reassigned=true; lead.reassignedAt=new Date().toISOString(); changed=true;
      }
    }
    const lvl=calcAlert(lead);
    if(lvl!==prev){lead.alertLevel=lvl;changed=true;}
    if(lead.botActive===undefined){lead.botActive=true;changed=true;}
  }
  if(changed) await tWrite(F.leads,tenant,leads);
  return leads;
}

// ─── Filtro de fechas ─────────────────────────────────────────────────────────
function parseDateRange(start,end){
  let s=null,e=null;
  if(start){const d=new Date(start);if(!isNaN(d)){d.setHours(0,0,0,0);s=d.getTime();}}
  if(end)  {const d=new Date(end);  if(!isNaN(d)){d.setHours(23,59,59,999);e=d.getTime();}}
  return{s,e};
}
function inRange(lead,s,e){
  if(s===null&&e===null) return true;
  const ts=new Date(lead.lastInteraction||0).getTime();
  return(s===null||ts>=s)&&(e===null||ts<=e);
}

// ─── SEED — Datos de prueba realistas ─────────────────────────────────────────
async function seed(){

  // ── Usuarios ──────────────────────────────────────────────────────────────
  const users=await read(F.users);
  if(!users.demo_automotora) users.demo_automotora=[
    {username:'gerente',  password:'demo',name:'Andrés Salas',  role:'admin'},
    {username:'vendedor1',password:'demo',name:'Rodrigo Vidal', role:'vendedor',status:'Activo'},
    {username:'vendedor2',password:'demo',name:'Camila Aravena',role:'vendedor',status:'Activo'},
    {username:'recepcion',password:'demo',name:'Daniela Ortiz', role:'secretaria'}
  ];
  if(!users.demo_clinica) users.demo_clinica=[
    {username:'gerente',  password:'demo',name:'Dr. Hernán Vidal',role:'admin'},
    {username:'vendedor1',password:'demo',name:'Karina Bravo',    role:'vendedor',status:'Activo'},
    {username:'recepcion',password:'demo',name:'Marcela Tapia',   role:'secretaria'}
  ];
  await write(F.users,users);

  // ── Config ────────────────────────────────────────────────────────────────
  const cfg=await read(F.config);
  if(!cfg.demo_automotora) cfg.demo_automotora={
    businessName:'Automotora Andes',accentColor:'#3b82f6',
    stages:['Nuevo','En Proceso','Contactado','Calificado',QUAL_STAGE,
            'Negociación','Agendado','Seguimiento','Cerrado','Abandonado']
  };
  if(!cfg.demo_clinica) cfg.demo_clinica={
    businessName:'Clínica Vital',accentColor:'#0d9488',
    stages:['Nuevo','En Proceso','Contactado','Agendado',QUAL_STAGE,
            'Atendido','Seguimiento','Cerrado','Abandonado']
  };
  for(const t of TENANTS){
    if(cfg[t]&&Array.isArray(cfg[t].stages)&&!cfg[t].stages.includes(QUAL_STAGE))
      cfg[t].stages.splice(Math.max(1,cfg[t].stages.length-2),0,QUAL_STAGE);
  }
  await write(F.config,cfg);

  // ── Bot ───────────────────────────────────────────────────────────────────
  const bot=await read(F.bot);
  if(!bot.demo_automotora) bot.demo_automotora={greeting:'¡Hola! Soy Marcela de Automotora Andes. ¿Qué vehículo buscas hoy?'};
  if(!bot.demo_clinica)    bot.demo_clinica   ={greeting:'Hola, asistente de Clínica Vital. ¿En qué te podemos ayudar?'};
  await write(F.bot,bot);

  // ── INVENTARIO — 20 vehículos realistas ───────────────────────────────────
  const inv=await read(F.inventory);
  inv.demo_automotora=[
    // SUVs
    {id:'AND-LR-001', brand:'Land Rover', model:'Discovery Sport 2.0D HSE Auto',    year:2023,stock:1,price:43690000,fuel:'Diésel',  color:'Blanco',         highlights:'7 plazas, 4WD, garantía extendida, premium.'},
    {id:'AND-LR-002', brand:'Land Rover', model:'Defender 110 P300 SE',             year:2024,stock:1,price:49990000,fuel:'Bencina', color:'Verde Aintree',   highlights:'Motor 2.0T 300HP, tecnología de última generación.'},
    {id:'AND-TY-001', brand:'Toyota',     model:'RAV4 2.5 Hybrid AWD',              year:2024,stock:3,price:29990000,fuel:'Híbrido', color:'Blanco Perla',    highlights:'Híbrido auto-recargable, tracción total, 222HP.'},
    {id:'AND-TY-002', brand:'Toyota',     model:'Fortuner 2.8 GD-6 SR 4x4',         year:2024,stock:2,price:34990000,fuel:'Diésel',  color:'Gris Oscuro',     highlights:'7 plazas, 4x4 verdadera, ideal para terreno mixto.'},
    {id:'AND-PG-001', brand:'Peugeot',    model:'3008 PureTech 130 EAT8',           year:2024,stock:4,price:18990000,fuel:'Bencina', color:'Rojo Elixir',     highlights:'SUV compacto, caja automática, pantalla 10".'},
    {id:'AND-PG-002', brand:'Peugeot',    model:'5008 BlueHDi 130 EAT8',            year:2023,stock:2,price:22490000,fuel:'Diésel',  color:'Gris Artense',    highlights:'7 plazas, SUV familiar, bajo consumo 5.5L/100km.'},
    {id:'AND-KI-001', brand:'Kia',        model:'Sportage 1.6 T-GDi HEV AWD',       year:2024,stock:3,price:21990000,fuel:'Híbrido', color:'Snow White Pearl','highlights:Híbrido mild 48V, tracción AWD, 180HP.'},
    // Sedanes
    {id:'AND-PG-003', brand:'Peugeot',    model:'408 PureTech 130 EAT8',            year:2024,stock:5,price:16490000,fuel:'Bencina', color:'Negro Perla',     highlights:'Fastback, caja automática 8v, 130HP.'},
    {id:'AND-TY-003', brand:'Toyota',     model:'Corolla 2.0 CVT GR Sport',         year:2024,stock:6,price:15990000,fuel:'Bencina', color:'Rojo Supersónico', highlights:'Sport edition, pantalla 10", Android Auto.'},
    {id:'AND-VW-001', brand:'Volkswagen', model:'Vento 1.6 MSI Highline AT',         year:2024,stock:4,price:14990000,fuel:'Bencina', color:'Plata Reflex',    highlights:'Sedán ejecutivo, caja tiptronic, cuero.'},
    {id:'AND-KI-002', brand:'Kia',        model:'K5 2.5 MPI GT-Line AT',            year:2023,stock:2,price:17990000,fuel:'Bencina', color:'Aurora Black',    highlights:'Sedán premium, control de crucero adaptativo.'},
    // Hatchback
    {id:'AND-PG-004', brand:'Peugeot',    model:'208 PureTech 100 Like AT',         year:2024,stock:8,price:11490000,fuel:'Bencina', color:'Blanco Banquise', highlights:'Económico, caja automática, ideal ciudad.'},
    {id:'AND-PG-005', brand:'Peugeot',    model:'308 PureTech 130 Allure AT',       year:2024,stock:3,price:16990000,fuel:'Bencina', color:'Gris Platinium',  highlights:'Hatchback premium, i-Cockpit, CarPlay.'},
    {id:'AND-TY-004', brand:'Toyota',     model:'Yaris 1.5 XLS CVT',               year:2024,stock:7,price:11990000,fuel:'Bencina', color:'Rojo Frambuesa',  highlights:'Compacto, bajo consumo, 5 años garantía.'},
    {id:'AND-VW-002', brand:'Volkswagen', model:'Polo 1.6 MSI Trendline AT',         year:2024,stock:5,price:12490000,fuel:'Bencina', color:'Blanco Puro',     highlights:'Confiable, seguro 5★ NCAP, conectividad.'},
    // Camionetas
    {id:'AND-TY-005', brand:'Toyota',     model:'Hilux 2.8 TDI SRX AT 4x4',        year:2024,stock:3,price:32990000,fuel:'Diésel',  color:'Blanco',          highlights:'La más vendida, cabina doble, garantía 5 años.'},
    {id:'AND-TY-006', brand:'Toyota',     model:'Hilux 2.8 TDI GR Sport 4x4',       year:2024,stock:1,price:36990000,fuel:'Diésel',  color:'Negro Metálico',  highlights:'Edición especial GR Sport, 204HP, equipamiento top.'},
    {id:'AND-KI-003', brand:'Kia',        model:'Stonic 1.4 MPI LX AT',             year:2024,stock:6,price:12990000,fuel:'Bencina', color:'Azul Stellar',    highlights:'Crossover compacto, económico, conectividad.'},
    // Eléctricos
    {id:'AND-KI-004', brand:'Kia',        model:'EV6 77.4 kWh AWD GT-Line',         year:2024,stock:1,price:39990000,fuel:'Eléctrico',color:'Moonscape',      highlights:'530km autonomía WLTP, carga rápida 800V, AWD.'},
    {id:'AND-PG-006', brand:'Peugeot',    model:'E-208 50 kWh Allure',              year:2024,stock:2,price:19990000,fuel:'Eléctrico',color:'Verde Olivine',   highlights:'362km autonomía, libre restricción, carga 100kW.'}
  ];
  if(!inv.demo_clinica) inv.demo_clinica=[
    {id:'VIT-DERM',brand:'',model:'Hora Dermatología',stock:12,price:45000},
    {id:'VIT-GIN', brand:'',model:'Hora Ginecología', stock:9, price:50000},
    {id:'VIT-MG',  brand:'',model:'Medicina General', stock:25,price:32000}
  ];
  await write(F.inventory,inv);

  // ── SPEND — Gasto mensual por canal ───────────────────────────────────────
  const spend=await read(F.spend);
  spend.demo_automotora={
    'Meta Ads':   1200000,
    'Google Ads':  900000,
    'Chileautos':  600000,
    'WhatsApp':          0,
    'Instagram':   350000,
    'Landing Page':      0,
    'Referido':          0
  };
  if(!spend.demo_clinica) spend.demo_clinica={
    'Meta Ads':620000,'Google Ads':880000,'Instagram':310000,'Landing Page':0
  };
  await write(F.spend,spend);

  // ── LEADS — 20 leads realistas con timestamps de HOY ─────────────────────
  const now   = Date.now();
  const mAgo  = m  => new Date(now - m * 60 * 1000).toISOString();
  const hAgo  = h  => new Date(now - h * 3600 * 1000).toISOString();

  // Helper para chatHistory realista
  const chat = (vehicle, status) => {
    const base = [
      { role:'user',  content:`Hola, me interesa el ${vehicle}. ¿Está disponible?`, ts: now - 7200000 },
      { role:'bot',   content:`¡Hola! Sí, tenemos el ${vehicle} disponible. ¿Te gustaría saber más sobre financiamiento o quieres coordinar una visita?`, ts: now - 7190000 }
    ];
    if(['Contactado','Negociación',QUAL_STAGE,'Cerrado'].includes(status)){
      base.push({role:'user',  content:'Sí, me interesa el financiamiento. ¿Cuál es la cuota mensual?', ts: now - 5400000});
      base.push({role:'bot',   content:`Con pie del 20% la cuota aproximada es de $${Math.floor(Math.random()*200+150)}.000 mensuales a 48 meses. ¿Te gustaría que te llame un ejecutivo para darte el mejor precio o coordinar una prueba de manejo? Trabajamos de 09:00 a 20:00 hrs.`, ts: now - 5390000});
    }
    if([QUAL_STAGE,'Cerrado'].includes(status)){
      base.push({role:'user',  content:'Sí, me llaman hoy a las 15:00 por favor.', ts: now - 3600000});
      base.push({role:'bot',   content:'¡Perfecto! Rodrigo te llamará hoy a las 15:00 hrs. ¡Hasta pronto!', ts: now - 3590000});
    }
    if(status==='Cerrado'){
      base.push({role:'agent', content:'Hola, ya queda lista la escritura. Te esperamos mañana a las 11:00 para la entrega del vehículo. ¡Felicidades!', ts: now - 1800000, agent:'vendedor1'});
    }
    return base;
  };

  const leadsData = await read(F.leads);

  // Siempre reemplaza los leads de demo_automotora con datos frescos
  leadsData.demo_automotora = [

    // ── NUEVO — 5 leads (2 verde, 1 amarillo, 2 rojo) ──────────────────────
    {
      id:10001, name:'Valentina Morales', phone:'+56 9 8123 4567',
      source:'Meta Ads', status:'Nuevo',
      lastInteraction: mAgo(8),  lastClientTs: mAgo(8),
      interest:'Toyota RAV4 Hybrid', model:'AND-TY-001',
      assignedTo:'vendedor1', botActive:true, alertLevel:'fresh',
      intentSignal:'NONE', unread:true, reassigned:false, notes:[], chatHistory:[
        {role:'user',content:'Hola, vi el RAV4 en el anuncio. ¿Tiene tracción total?', ts:now-480000}
      ]
    },
    {
      id:10002, name:'Ignacio Bustamante', phone:'+56 9 7654 3210',
      source:'Google Ads', status:'Nuevo',
      lastInteraction: mAgo(14), lastClientTs: mAgo(14),
      interest:'Peugeot 3008', model:'AND-PG-001',
      assignedTo:'vendedor2', botActive:true, alertLevel:'fresh',
      intentSignal:'NONE', unread:true, reassigned:false, notes:[], chatHistory:[
        {role:'user',content:'¿El Peugeot 3008 tiene descuento por pago al contado?', ts:now-840000}
      ]
    },
    {
      id:10003, name:'Francisca Donoso', phone:'+56 9 9988 1122',
      source:'Chileautos', status:'Nuevo',
      lastInteraction: mAgo(24), lastClientTs: mAgo(24),
      interest:'Toyota Hilux 4x4 SRX', model:'AND-TY-005',
      assignedTo:'vendedor1', botActive:true, alertLevel:'risk',
      intentSignal:'NONE', unread:true, reassigned:true,
      reassignedAt: mAgo(4),
      notes:[], chatHistory:[
        {role:'user',content:'Quiero cotizar la Hilux SRX 4x4 para empresa.', ts:now-1440000}
      ]
    },
    {
      id:10004, name:'Matías Fuentes', phone:'+56 9 6677 8855',
      source:'WhatsApp', status:'Nuevo',
      lastInteraction: mAgo(38), lastClientTs: mAgo(38),
      interest:'Land Rover Discovery Sport', model:'AND-LR-001',
      assignedTo:'vendedor2', botActive:true, alertLevel:'critical',
      intentSignal:'NONE', unread:true, reassigned:false, notes:[], chatHistory:[
        {role:'user',content:'Buenas, tengo interés en el Land Rover Discovery Sport. ¿Tienen stock?', ts:now-2280000}
      ]
    },
    {
      id:10005, name:'Daniela Arce', phone:'+56 9 5544 9900',
      source:'Meta Ads', status:'Nuevo',
      lastInteraction: mAgo(55), lastClientTs: mAgo(55),
      interest:'Kia EV6 Eléctrico', model:'AND-KI-004',
      assignedTo:'vendedor1', botActive:true, alertLevel:'critical',
      intentSignal:'NONE', unread:true, reassigned:false, notes:[], chatHistory:[
        {role:'user',content:'Hola, ¿el EV6 aplica para la franquicia de autos eléctricos?', ts:now-3300000}
      ]
    },

    // ── CONTACTADO — 4 leads ───────────────────────────────────────────────
    {
      id:10006, name:'Roberto Cerda', phone:'+56 9 3344 5566',
      source:'Google Ads', status:'Contactado',
      lastInteraction: hAgo(2), lastClientTs: hAgo(2.5),
      interest:'Toyota Corolla GR Sport', model:'AND-TY-003',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'NONE', unread:false, reassigned:false,
      notes:[{content:'Llamado realizado. Muy interesado, pide cotización formal.',author:'Camila Aravena',ts:now-7000000}],
      chatHistory: chat('Toyota Corolla 2.0 CVT GR Sport','Contactado')
    },
    {
      id:10007, name:'Pamela Rojas', phone:'+56 9 2233 7788',
      source:'Chileautos', status:'Contactado',
      lastInteraction: hAgo(3), lastClientTs: hAgo(3.5),
      interest:'Peugeot 208 Automático', model:'AND-PG-004',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'NONE', unread:false, reassigned:false,
      notes:[{content:'Primera visita agendada para mañana.',author:'Rodrigo Vidal',ts:now-10000000}],
      chatHistory: chat('Peugeot 208 PureTech 100 Like AT','Contactado')
    },
    {
      id:10008, name:'Héctor Muñoz', phone:'+56 9 8899 0011',
      source:'Meta Ads', status:'Contactado',
      lastInteraction: hAgo(4), lastClientTs: hAgo(4.2),
      interest:'Volkswagen Vento Highline', model:'AND-VW-001',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'NONE', unread:false, reassigned:false, notes:[],
      chatHistory: chat('Volkswagen Vento 1.6 Highline AT','Contactado')
    },
    {
      id:10009, name:'Catalina Espinoza', phone:'+56 9 7711 4422',
      source:'WhatsApp', status:'Contactado',
      lastInteraction: hAgo(5), lastClientTs: hAgo(5.3),
      interest:'Toyota Yaris 1.5 XLS', model:'AND-TY-004',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'NONE', unread:false, reassigned:false, notes:[],
      chatHistory: chat('Toyota Yaris 1.5 XLS CVT','Contactado')
    },

    // ── LEAD CALIFICADO - CONTACTO AGENDADO — 4 leads ─────────────────────
    {
      id:10010, name:'Juan Ignacio Pérez', phone:'+56 9 9900 1122',
      source:'Meta Ads', status: QUAL_STAGE,
      lastInteraction: hAgo(1), lastClientTs: hAgo(1.5),
      interest:'Toyota Hilux GR Sport', model:'AND-TY-006',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'BLUE', unread:false, reassigned:false,
      scheduleText:'hoy a las 15:00 hrs',
      notes:[{content:'Confirmó visita hoy 15:00. Trae a su señora.',author:'Rodrigo Vidal',ts:now-3500000}],
      chatHistory: chat('Toyota Hilux 2.8 TDI GR Sport 4x4', QUAL_STAGE)
    },
    {
      id:10011, name:'María José Contreras', phone:'+56 9 8877 3344',
      source:'Google Ads', status: QUAL_STAGE,
      lastInteraction: hAgo(1.5), lastClientTs: hAgo(2),
      interest:'Kia Sportage Hybrid AWD', model:'AND-KI-001',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'BLUE', unread:false, reassigned:false,
      scheduleText:'mañana a las 11:00 hrs',
      notes:[{content:'Llega mañana a las 11. Confirmar con reparto.',author:'Camila Aravena',ts:now-5000000}],
      chatHistory: chat('Kia Sportage 1.6 T-GDi HEV AWD', QUAL_STAGE)
    },
    {
      id:10012, name:'Felipe Soto', phone:'+56 9 6655 4433',
      source:'Chileautos', status: QUAL_STAGE,
      lastInteraction: hAgo(2), lastClientTs: hAgo(2.5),
      interest:'Land Rover Defender 110', model:'AND-LR-002',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'YELLOW', unread:false, reassigned:false,
      scheduleText:'quizás esta semana',
      notes:[{content:'No confirmó fecha exacta. Seguimiento para mañana.',author:'Rodrigo Vidal',ts:now-7200000}],
      chatHistory: chat('Land Rover Defender 110 P300 SE', QUAL_STAGE)
    },
    {
      id:10013, name:'Andrea Vásquez', phone:'+56 9 5566 7788',
      source:'WhatsApp', status: QUAL_STAGE,
      lastInteraction: hAgo(3), lastClientTs: hAgo(3.3),
      interest:'Kia EV6 AWD GT-Line', model:'AND-KI-004',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'BLUE', unread:false, reassigned:false,
      scheduleText:'viernes a las 10:00 hrs',
      notes:[{content:'Test drive confirmado viernes 10am. Preparar EV6 limpio.',author:'Camila Aravena',ts:now-10800000}],
      chatHistory: chat('Kia EV6 77.4 kWh AWD GT-Line', QUAL_STAGE)
    },

    // ── CERRADO — 3 ventas concretadas ─────────────────────────────────────
    {
      id:10014, name:'Sebastián Lagos', phone:'+56 9 4455 6677',
      source:'Meta Ads', status:'Cerrado',
      lastInteraction: hAgo(6), lastClientTs: hAgo(8),
      interest:'Toyota RAV4 Hybrid', model:'AND-TY-001',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'BLUE', unread:false, reassigned:false,
      notes:[{content:'Venta cerrada. Contado. Entrega programada para el jueves.',author:'Rodrigo Vidal',ts:now-20000000}],
      chatHistory: chat('Toyota RAV4 2.5 Hybrid AWD','Cerrado')
    },
    {
      id:10015, name:'Claudia Herrera', phone:'+56 9 3322 5544',
      source:'Google Ads', status:'Cerrado',
      lastInteraction: hAgo(8), lastClientTs: hAgo(10),
      interest:'Peugeot 308 Allure', model:'AND-PG-005',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'BLUE', unread:false, reassigned:false,
      notes:[{content:'Financiamiento aprobado BCI. Firma mañana.',author:'Camila Aravena',ts:now-28000000}],
      chatHistory: chat('Peugeot 308 PureTech 130 Allure AT','Cerrado')
    },
    {
      id:10016, name:'Gustavo Moreno', phone:'+56 9 1122 9988',
      source:'Chileautos', status:'Cerrado',
      lastInteraction: hAgo(10), lastClientTs: hAgo(12),
      interest:'Toyota Hilux 4x4 SRX', model:'AND-TY-005',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'BLUE', unread:false, reassigned:false,
      notes:[{content:'Venta a nombre de empresa. RUT y factura listos.',author:'Rodrigo Vidal',ts:now-35000000}],
      chatHistory: chat('Toyota Hilux 2.8 TDI SRX AT 4x4','Cerrado')
    },

    // ── NEGOCIACIÓN — 2 leads ──────────────────────────────────────────────
    {
      id:10017, name:'Carla Núñez', phone:'+56 9 9911 2233',
      source:'Meta Ads', status:'Negociación',
      lastInteraction: hAgo(4), lastClientTs: hAgo(4.5),
      interest:'Toyota Fortuner 4x4 SR', model:'AND-TY-002',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'YELLOW', unread:false, reassigned:false,
      notes:[{content:'Pide descuento adicional $500k. Consultando con gerente.',author:'Camila Aravena',ts:now-14000000}],
      chatHistory: chat('Toyota Fortuner 2.8 GD-6 SR 4x4','Negociación')
    },
    {
      id:10018, name:'Tomás Araya', phone:'+56 9 8800 9911',
      source:'Google Ads', status:'Negociación',
      lastInteraction: hAgo(6), lastClientTs: hAgo(7),
      interest:'Peugeot 5008 7 Plazas', model:'AND-PG-002',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'YELLOW', unread:false, reassigned:false,
      notes:[{content:'Quiere incluir su Honda en parte de pago. Tasación en curso.',author:'Rodrigo Vidal',ts:now-20000000}],
      chatHistory: chat('Peugeot 5008 BlueHDi 130 EAT8','Negociación')
    },

    // ── ABANDONADO — 2 leads ───────────────────────────────────────────────
    {
      id:10019, name:'Rodrigo Venegas', phone:'+56 9 7766 0011',
      source:'Meta Ads', status:'Abandonado',
      lastInteraction: hAgo(9), lastClientTs: hAgo(11),
      interest:'Kia K5 GT-Line', model:'AND-KI-002',
      assignedTo:'vendedor2', botActive:false, alertLevel:'none',
      intentSignal:'NONE', unread:false, reassigned:false,
      notes:[{content:'Compró en otra automotora. Perdimos por precio.',author:'Camila Aravena',ts:now-30000000}],
      chatHistory:[
        {role:'user',  content:'Hola, busco el K5 GT-Line.', ts:now-39600000},
        {role:'bot',   content:'¡Hola Rodrigo! Sí lo tenemos. ¿Te puedo cotizar?', ts:now-39590000},
        {role:'user',  content:'Ya no gracias, lo encontré más barato en otra parte.', ts:now-32400000}
      ]
    },
    {
      id:10020, name:'Isabel Castillo', phone:'+56 9 6677 3311',
      source:'Chileautos', status:'Abandonado',
      lastInteraction: hAgo(11), lastClientTs: hAgo(13),
      interest:'Volkswagen Polo AT', model:'AND-VW-002',
      assignedTo:'vendedor1', botActive:false, alertLevel:'none',
      intentSignal:'NONE', unread:false, reassigned:false,
      notes:[{content:'No le aprobaron el crédito. Caso cerrado.',author:'Rodrigo Vidal',ts:now-38000000}],
      chatHistory:[
        {role:'user',  content:'Quiero el Polo Automático.', ts:now-46800000},
        {role:'bot',   content:'¡Hola Isabel! Lo tenemos en blanco y gris. ¿Te financiamos?', ts:now-46790000},
        {role:'agent', content:'Hola Isabel, lamentablemente el banco no aprobó el crédito esta vez. Podemos intentar en 6 meses.', ts:now-39600000, agent:'vendedor1'}
      ]
    }
  ];

  // Recalcular alertLevel para todos según timestamp actual
  leadsData.demo_automotora.forEach(l => {
    l.alertLevel = calcAlert(l);
  });

  // Clínica mínima
  if(!leadsData.demo_clinica) leadsData.demo_clinica=[];
  await write(F.leads,leadsData);

  console.log('✅  Seed completado:');
  console.log(`    Inventario: ${inv.demo_automotora.length} vehículos`);
  console.log(`    Leads:      ${leadsData.demo_automotora.length} leads con timestamps de hoy`);
  console.log(`    Spend:      Meta $1.2M | Google $900k | Chileautos $600k`);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const auth=(...roles)=>async(req,res,next)=>{
  const token=req.header('X-Auth-Token')||req.query.token;
  const sess=sessions.get(token);
  if(!sess) return res.status(401).json({error:'No autenticado'});
  if(roles.length&&!roles.includes(sess.user.role)) return res.status(403).json({error:'Sin permisos'});
  req.user=sess.user; req.tenant=sess.tenant; next();
};
const byRole=(leads,user)=>user.role==='vendedor'?leads.filter(l=>l.assignedTo===user.username):leads;

app.post('/api/auth/login',async(req,res)=>{
  const{username,password,tenant}=req.body||{};
  const t=validT(tenant);
  const users=await tRead(F.users,t);
  const u=users.find(x=>x.username===username&&x.password===password);
  if(!u) return res.status(401).json({error:'Credenciales incorrectas'});
  const token=crypto.randomBytes(24).toString('hex');
  const safe={username:u.username,name:u.name,role:u.role};
  sessions.set(token,{user:safe,tenant:t});
  res.json({token,user:safe,tenant:t});
});
app.post('/api/auth/logout',(req,res)=>{sessions.delete(req.header('X-Auth-Token'));res.json({ok:true});});
app.get('/api/me',auth(),(req,res)=>res.json({user:req.user,tenant:req.tenant}));

// ─── Leads ────────────────────────────────────────────────────────────────────
app.get('/api/leads',auth(),async(req,res)=>{
  const all=await applySlaRules(req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  let leads=byRole(all,req.user);
  if(s!==null||e!==null) leads=leads.filter(l=>inRange(l,s,e));
  if(req.query.seller&&req.user.role==='admin') leads=leads.filter(l=>l.assignedTo===req.query.seller);
  leads.forEach(l=>{
    if(!Array.isArray(l.chatHistory)) l.chatHistory=[];
    if(!Array.isArray(l.notes))       l.notes=[];
    if(!l.intentSignal)               l.intentSignal='NONE';
    if(!l.lastClientTs)               l.lastClientTs=l.lastInteraction||new Date(0).toISOString();
  });
  leads.sort((a,b)=>new Date(b.lastClientTs||0)-new Date(a.lastClientTs||0));
  res.json(leads);
});

app.get('/api/leads/:id',auth(),async(req,res)=>{
  await applySlaRules(req.tenant);
  const leads=await tRead(F.leads,req.tenant);
  const l=leads.find(x=>x.id==req.params.id);
  if(!l) return res.status(404).json({error:'No encontrado'});
  if(req.user.role==='vendedor'&&l.assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  res.json(l);
});

app.patch('/api/leads/:id',auth(),async(req,res)=>{
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1) return res.status(404).json({error:'No encontrado'});
  if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  const ALLOWED=['status','interest','name','phone','botActive'];
  if(req.user.role!=='vendedor') ALLOWED.push('assignedTo');
  const patch={};
  for(const k of ALLOWED) if(req.body[k]!==undefined) patch[k]=req.body[k];
  if(patch.status!==undefined&&!VALID_ST.has(patch.status)) return res.status(400).json({error:'Status inválido'});
  if(req.body.note&&String(req.body.note).trim()){
    leads[idx].notes=Array.isArray(leads[idx].notes)?leads[idx].notes:[];
    leads[idx].notes.push({content:String(req.body.note).trim(),author:req.user.name||req.user.username,ts:Date.now()});
  }
  Object.assign(leads[idx],patch);
  leads[idx].lastInteraction=new Date().toISOString();
  leads[idx].unread=false;
  leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

app.put('/api/leads/:id',auth(),async(req,res)=>{
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1) return res.status(404).json({error:'No encontrado'});
  if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  if(req.user.role==='vendedor') delete req.body.assignedTo;
  leads[idx]={...leads[idx],...req.body,lastInteraction:new Date().toISOString()};
  leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

app.post('/api/leads/:id/bot',auth(),async(req,res)=>{
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1) return res.status(404).json({error:'No encontrado'});
  leads[idx].botActive=!!req.body.botActive;
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

app.post('/api/leads/:id/message',auth('admin','vendedor'),async(req,res)=>{
  const{content}=req.body||{};
  if(!content) return res.status(400).json({error:'content requerido'});
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1) return res.status(404).json({error:'No encontrado'});
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'agent',content,ts:Date.now(),agent:req.user.username});
  leads[idx].botActive=false;
  leads[idx].unread=false;
  leads[idx].lastInteraction=new Date().toISOString();
  leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  res.json(leads[idx]);
});

// ─── Dashboard KPIs ───────────────────────────────────────────────────────────
app.get('/api/dashboard/kpis',auth('admin'),async(req,res)=>{
  const all=await applySlaRules(req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const now=Date.now();
  const minOf=l=>(now-new Date(l.lastInteraction).getTime())/60000;
  const nuevos=leads.filter(l=>l.status==='Nuevo');
  const closed=leads.filter(l=>l.status==='Cerrado').length;
  const qualified=leads.filter(l=>l.status===QUAL_STAGE).length;
  const unread=leads.filter(l=>l.unread).length;
  const avg=nuevos.length?Math.round(nuevos.reduce((a,l)=>a+minOf(l),0)/nuevos.length):0;
  res.json({
    total:leads.length,
    active:leads.filter(l=>!FINAL_ST.has(l.status)).length,
    closed, qualified, unread,
    slaFresh:   nuevos.filter(l=>minOf(l)<SLA_GREEN).length,
    slaRisk:    nuevos.filter(l=>minOf(l)>=SLA_GREEN&&minOf(l)<SLA_YELLOW).length,
    slaCritical:nuevos.filter(l=>minOf(l)>=SLA_YELLOW).length,
    avgResponseMin:avg,
    conversionRate:leads.length?((closed/leads.length)*100).toFixed(1):'0.0'
  });
});

// ─── Dashboard Team ───────────────────────────────────────────────────────────
app.get('/api/dashboard/team',auth('admin'),async(req,res)=>{
  const users=await tRead(F.users,req.tenant);
  const all=await tRead(F.leads,req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const now=Date.now();
  const minOf=l=>(now-new Date(l.lastInteraction).getTime())/60000;
  res.json(users.filter(u=>u.role==='vendedor').map(v=>{
    const own=leads.filter(l=>l.assignedTo===v.username);
    const nv=own.filter(l=>l.status==='Nuevo');
    const closed=own.filter(l=>l.status==='Cerrado').length;
    const avgResp=nv.length?Math.round(nv.reduce((a,l)=>a+minOf(l),0)/nv.length):0;
    return{
      username:v.username, name:v.name, total:own.length,
      sla:{
        fresh:   nv.filter(l=>minOf(l)<SLA_GREEN).length,
        risk:    nv.filter(l=>minOf(l)>=SLA_GREEN&&minOf(l)<SLA_YELLOW).length,
        critical:nv.filter(l=>minOf(l)>=SLA_YELLOW).length
      },
      closed, unread:own.filter(l=>l.unread).length,
      convRate:own.length?((closed/own.length)*100).toFixed(1):'0.0',
      avgResponseMin:avgResp,
      byStatus:{
        nuevo:      nv.length,
        contactado: own.filter(l=>l.status==='Contactado').length,
        calificado: own.filter(l=>l.status===QUAL_STAGE).length,
        agendado:   own.filter(l=>l.status==='Agendado').length,
        negociacion:own.filter(l=>l.status==='Negociación').length,
        seguimiento:own.filter(l=>l.status==='Seguimiento').length,
        cerrado:    closed,
        abandonado: own.filter(l=>['Abandonado','Perdido'].includes(l.status)).length
      },
      leads:own.map(l=>({...l,
        chatHistory:Array.isArray(l.chatHistory)?l.chatHistory:[],
        notes:Array.isArray(l.notes)?l.notes:[],
        intentSignal:l.intentSignal||'NONE'
      }))
    };
  }).filter(v=>v.total>0));
});

// ─── Analytics Channels ───────────────────────────────────────────────────────
app.get('/api/analytics/channels',auth('admin'),async(req,res)=>{
  const all=await tRead(F.leads,req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const spend=await tRead(F.spend,req.tenant,{});
  const ch={};
  for(const l of leads){
    const c=l.source||'Otro';
    if(!ch[c]) ch[c]={channel:c,leads:0,sales:0,spend:spend[c]||0,models:{}};
    ch[c].leads++;
    if(l.status==='Cerrado'){
      ch[c].sales++;
      const m=l.model||l.interest||'—';
      ch[c].models[m]=(ch[c].models[m]||0)+1;
    }
  }
  res.json(Object.values(ch).map(c=>{
    let top='—',tc=0;
    for(const[m,n]of Object.entries(c.models)) if(n>tc){top=m;tc=n;}
    const agenda=leads.filter(l=>l.source===c.channel&&
      ['Agendado',QUAL_STAGE].includes(l.status)).length;
    return{
      channel:c.channel, spend:c.spend, leads:c.leads, sales:c.sales, topModel:top,
      cpl:c.leads?Math.round(c.spend/c.leads):0,
      cac:c.sales?Math.round(c.spend/c.sales):0,
      cpa:agenda?Math.round(c.spend/agenda):0,
      conversion:c.leads?((c.sales/c.leads)*100).toFixed(1):'0.0'
    };
  }).sort((a,b)=>b.spend-a.spend));
});

// ─── Pipeline ────────────────────────────────────────────────────────────────
app.get('/api/pipeline',auth(),async(req,res)=>{
  const cfg=await tRead(F.config,req.tenant,{});
  const all=await applySlaRules(req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  let leads=byRole(all,req.user);
  if(s!==null||e!==null) leads=leads.filter(l=>inRange(l,s,e));
  if(req.query.seller&&req.user.role==='admin') leads=leads.filter(l=>l.assignedTo===req.query.seller);
  res.json((cfg.stages||[]).map(st=>({stage:st,leads:leads.filter(l=>l.status===st)})));
});

// ─── Users / Config / Bot / Inventory ────────────────────────────────────────
app.get('/api/users',    auth('admin'),async(req,res)=>res.json((await tRead(F.users,req.tenant)).map(u=>({username:u.username,name:u.name,role:u.role,status:u.status||null}))));
app.get('/api/config',   auth(),       async(req,res)=>res.json(await tRead(F.config,req.tenant,{})));
app.put('/api/config',   auth('admin'),async(req,res)=>{const u={...await tRead(F.config,req.tenant,{}),...req.body};await tWrite(F.config,req.tenant,u);res.json(u);});
app.get('/api/bot',      auth('admin'),async(req,res)=>res.json(await tRead(F.bot,req.tenant,{})));
app.put('/api/bot',      auth('admin'),async(req,res)=>{const u={...await tRead(F.bot,req.tenant,{}),...req.body};await tWrite(F.bot,req.tenant,u);res.json(u);});
app.get('/api/inventory',auth('admin','vendedor'),async(req,res)=>res.json(await tRead(F.inventory,req.tenant)));

// ─── Chat simulador ───────────────────────────────────────────────────────────
app.post('/api/chat',async(req,res)=>{
  const tenant=validT(req.body?.tenant||req.query.tenant);
  const{sessionId,message}=req.body||{};
  if(!sessionId||!message) return res.status(400).json({error:'sessionId y message requeridos'});
  const leads=await tRead(F.leads,tenant);
  let sess=chatSessions.get(sessionId),captured=false,leadId;
  if(!sess){
    leadId=Date.now();
    const assigned=await rrNext(tenant);
    const n=new Date().toISOString();
    leads.unshift({id:leadId,name:'Visitante anónimo',phone:'Pendiente',source:'Chat Web',status:'Nuevo',
      lastInteraction:n,lastClientTs:n,interest:message.slice(0,80),sessionId,
      assignedTo:assigned,botActive:true,alertLevel:'none',intentSignal:'NONE',unread:true,notes:[],chatHistory:[]});
    sess={tenant,leadId,step:0};chatSessions.set(sessionId,sess);captured=true;
  }else{leadId=sess.leadId;sess.step++;}
  const idx=leads.findIndex(l=>l.id===leadId);
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'user',content:message,ts:Date.now()});
  leads[idx].lastClientTs=new Date().toISOString();
  leads[idx].unread=true;
  if(leads[idx].botActive!==false){
    const p=await marcela(tenant,leads[idx].chatHistory.slice(0,-1),message);
    leads[idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
    leads[idx].lastInteraction=new Date().toISOString();
    leads[idx].unread=false;
    applySignal(leads[idx],p);
    if(sess.step>=2&&leads[idx].status==='Nuevo'&&leads[idx].intentSignal==='NONE') leads[idx].status='Contactado';
    await tWrite(F.leads,tenant,leads);
    return res.json({reply:p.reply,sessionId,leadCaptured:captured,leadId,intentSignal:leads[idx].intentSignal,status:leads[idx].status});
  }
  await tWrite(F.leads,tenant,leads);
  res.json({reply:null,sessionId,leadCaptured:captured,leadId,botPaused:true});
});

// ─── Webhook WhatsApp + Escudo ────────────────────────────────────────────────
async function sendWA(to,text){
  const token=process.env.WA_TOKEN,phoneId=process.env.WA_PHONE_ID;
  if(!token||!phoneId) return;
  try{
    await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`,{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:text}})
    });
  }catch(e){console.error('WA:',e);}
}
const SHIELD=['body elite','bodyelite','botox','lipo','lipoescultura','liposuccion','estetica','estética','masaje','masajes','doctora','tratamiento','acido hialuronico'];
const SHIELD_R='¡Hola! Este número es exclusivo de Automotora Andes. Contacta a Body Elite por Instagram. ¡Gracias!';
function isShield(t){
  if(!t) return false;
  const n=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return SHIELD.some(k=>n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));
}
app.get('/webhook',(req,res)=>{
  const vt=process.env.WA_VERIFY_TOKEN||'zara_token_123';
  if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===vt)
    return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook',async(req,res)=>{
  if(!req.body.object) return res.sendStatus(404);
  res.sendStatus(200);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;
    const msg=val?.messages?.[0];
    if(!msg) return;
    const from=msg.from;
    const body=msg.text?.body||msg.button?.text||null;
    if(!body) return;
    if(isShield(body)){await sendWA(from,SHIELD_R);return;}
    const contactName=val.contacts?.[0]?.profile?.name||'WhatsApp Lead';
    const tenant='demo_automotora';
    const ld=await read(F.leads);
    if(!ld[tenant]) ld[tenant]=[];
    let idx=ld[tenant].findIndex(l=>l.phone&&l.phone.replace(/\D/g,'').includes(from.replace(/\D/g,'')));
    if(idx===-1){
      const assigned=await rrNext(tenant)||'vendedor1';
      const n=new Date().toISOString();
      ld[tenant].unshift({id:Date.now(),name:contactName,phone:'+'+from,source:'WhatsApp',status:'Nuevo',
        lastInteraction:n,lastClientTs:n,interest:body.slice(0,80),
        assignedTo:assigned,botActive:true,alertLevel:'none',intentSignal:'NONE',unread:true,notes:[],chatHistory:[]});
      idx=0;
    }
    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];
    ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    ld[tenant][idx].lastClientTs=new Date().toISOString();
    ld[tenant][idx].unread=true;
    if(ld[tenant][idx].botActive!==false){
      const p=await marcela(tenant,ld[tenant][idx].chatHistory.slice(0,-1),body);
      ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
      applySignal(ld[tenant][idx],p);
      ld[tenant][idx].unread=false;
      const ut=ld[tenant][idx].chatHistory.filter(m=>m.role==='user').length;
      if(ut>=2&&ld[tenant][idx].status==='Nuevo'&&ld[tenant][idx].intentSignal==='NONE')
        ld[tenant][idx].status='Contactado';
      await sendWA(from,p.reply);
    }
    ld[tenant][idx].lastInteraction=new Date().toISOString();
    ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
    await write(F.leads,ld);
  }catch(e){console.error('Webhook:',e);}
});

// ─── Static + SLA Job + Listen ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

setInterval(async()=>{
  for(const t of TENANTS){
    try{ await applySlaRules(t); }catch(e){ console.error('SLA',t,e.message); }
  }
},60000);

seed().then(()=>app.listen(PORT,()=>{
  console.log(`🚀  FunnelOS en http://localhost:${PORT}`);
  console.log(`🔐  gerente/demo · vendedor1/demo · vendedor2/demo`);
  console.log(`📊  20 leads · 20 vehículos · SLA Verde/Amarillo/Rojo distribuidos`);
}));

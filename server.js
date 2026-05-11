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

const TENANTS    = ['demo_automotora', 'demo_clinica'];
const sessions   = new Map();
const chatSessions = new Map();
const SLA_GREEN  = 20;
const SLA_YELLOW = 30;
const FINAL_ST   = new Set(['Cerrado','Abandonado','Perdido']);
const QUAL_STAGE = 'Lead Calificado - Contacto Agendado';
const VALID_ST   = new Set(['Nuevo','En Proceso','Contactado','Calificado','Agendado',
                             'Seguimiento','Negociación','Atendido',QUAL_STAGE,
                             'Cerrado','Abandonado','Perdido']);

const read   = async f         => { try { return JSON.parse(await fs.readFile(f,'utf8')); } catch { return {}; } };
const write  = (f,d)           => fs.writeFile(f, JSON.stringify(d,null,2));
const tRead  = async(f,t,fb=[])=> { const s=await read(f); return s[t]!==undefined?s[t]:fb; };
const tWrite = async(f,t,d)    => { const s=await read(f); s[t]=d; await write(f,s); };
const validT = t => TENANTS.includes(t) ? t : TENANTS[0];

function invStr(inv){
  if(!Array.isArray(inv)||!inv.length) return '(sin inventario)';
  return inv.map(i=>`- [${i.id}] ${i.brand||''} ${i.model}${i.year?' '+i.year:''} | Stock:${i.stock} | $${(i.price||0).toLocaleString('es-CL')}${i.cc?'|'+i.cc:''}${i.rendimiento?'|'+i.rendimiento:''}${i.highlights?'|'+i.highlights:''}`).join('\n');
}
function marcelaSys(biz,invS){
  return `Eres Marcela, asesora experta de ventas en ${biz}. Español Chile, cercana, persuasiva y empática. No eres un robot, eres una consultora top.
INVENTARIO:\n${invS}
REGLAS:
1. Valida la elección del cliente. Usa datos como motor, rendimiento o equipamiento para enamorarlo del auto.
2. Si NO hay stock de un modelo, NO digas "no tenemos". Di: "Esa unidad exacta se nos acaba de reservar, pero cuéntame, ¿qué es lo que más te gustaba de ese modelo para buscarte algo perfecto en la sucursal?".
3. Si SÍ hay stock, genera urgencia sutil ("tenemos mucha demanda por este modelo esta semana").
4. Haz preguntas abiertas para perfilar al cliente (uso familiar, trabajo, presupuesto) antes de empujar una llamada.
5. Si detectas intención de compra o ya perfilaste: "¿Te gustaría que un ejecutivo te contacte para darte el mejor precio o agendar un test drive? Trabajamos de 09:00 a 20:00 hrs. Dime qué día y hora prefieres."
6. Hora fuera de 09:00-20:00: propón el día siguiente a las 09:00.
7. Precios en CLP con punto de miles.
RESPONDE SOLO JSON sin markdown:
{"reply":"<texto>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota>","schedule_detected":true|false,"schedule_text":"<hora>"}`;
}
function parseJ(raw){
  if(!raw) return null;
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a===-1||b===-1) return null;
  try{ return JSON.parse(raw.slice(a,b+1)); }catch{ return null; }
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
      model:'gpt-4o-mini',temperature:0.6,
      response_format:{type:'json_object'},
      messages:[
        {role:'system',content:marcelaSys(cfg.businessName||'la empresa',invStr(inv))},
        ...history.slice(-12).map(h=>({role:h.role==='user'?'user':'assistant',content:h.content})),
        {role:'user',content:msg}
      ]
    });
    let p=parseJ(completion.choices?.[0]?.message?.content||'');
    if(!p) p={reply:'Disculpa, error técnico.',intent_signal:'NONE',intent_reason:'fallback',schedule_detected:false,schedule_text:''};
    if(p.schedule_detected&&fueraH(p.schedule_text)){
      p.reply+='\n\n(Nuestro horario es de 09:00 a 20:00. Te propongo mañana a las 09:00, ¿te acomoda?)';
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

async function sendWA(to, text){
  const token   = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if(!token||!phoneId){
    console.log('⚠️ WA_TOKEN no configurado — Simulando msg a',to,':',text.slice(0,60));
    return;
  }
  try{
    const phone = String(to).replace(/\D/g,'');
    if(!phone) return;
    await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`,{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'text',text:{body:text}})
    });
  }catch(e){ console.error('WA send exception:',e.message); }
}

const SHIELD=['body elite','bodyelite','botox','lipo','lipoescultura','liposuccion','estetica','estética','masaje','masajes','doctora','tratamiento','acido hialuronico'];
const SHIELD_R='¡Hola! Este número es exclusivo de Automotora Andes. Contacta a Body Elite por Instagram. ¡Gracias!';
function isShield(t){
  if(!t) return false;
  const n=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return SHIELD.some(k=>n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));
}

async function getSellers(tenant){
  const u=await tRead(F.users,tenant);
  return u.filter(x=>x.role==='vendedor'&&(!x.status||x.status==='Activo'));
}
async function rrNext(tenant,exclude=null){
  const sl=await getSellers(tenant);
  if(!sl.length) return null;
  const pool=exclude?sl.filter(s=>s.username!==exclude):sl;
  const list=pool.length?pool:sl;
  const rr=await read(F.rr);
  const idx=(rr[tenant]||0)%list.length;
  rr[tenant]=(idx+1)%list.length;
  await write(F.rr,rr);
  return list[idx];
}

function calcAlert(lead){
  if(FINAL_ST.has(lead.status)) return 'none';
  const applies = lead.status==='Nuevo' || lead.unread===true;
  if(!applies) return 'none';
  const ref = lead.lastClientTs || lead.lastInteraction;
  if(!ref) return 'none';
  const m = (Date.now()-new Date(ref).getTime())/60000;
  if(m>SLA_YELLOW) return 'critical';
  if(m>SLA_GREEN)  return 'risk';
  return 'fresh';
}

async function applySlaRules(tenant){
  const leads = await tRead(F.leads, tenant);
  const allUsers = await tRead(F.users, tenant);
  let changed = false;
  for(const lead of leads){
    if(FINAL_ST.has(lead.status)) continue;
    const prev = lead.alertLevel||'none';
    if(lead.status==='Nuevo'){
      const ref  = lead.lastClientTs||lead.lastInteraction;
      const mins = ref ? (Date.now()-new Date(ref).getTime())/60000 : 0;
      if(mins>SLA_YELLOW && !lead.reassigned){
        const nextObj = await rrNext(tenant, lead.assignedTo);
        const nextUser = nextObj || null;
        if(nextUser && nextUser.username!==lead.assignedTo){
          lead.assignedTo   = nextUser.username;
          lead.reassigned   = true;
          lead.reassignedAt = new Date().toISOString();
          changed = true;
          if(nextUser.phone){
            sendWA(nextUser.phone, `🚨 REASIGNACIÓN: Se te ha asignado el lead [${lead.name}] porque el vendedor anterior no respondió en 30 min. ¡Atiéndelo ya!`).catch(()=>{});
          }
          const admin = allUsers.find(u=>u.role==='admin');
          if(admin&&admin.phone){
            sendWA(admin.phone, `📢 AVISO GERENCIAL: El lead [${lead.name}] ha sido reasignado a [${nextUser.name||nextUser.username}] por negligencia en el tiempo de respuesta (>30 min).`).catch(()=>{});
          }
        } else {
          lead.reassigned   = true;
          lead.reassignedAt = new Date().toISOString();
          changed = true;
        }
      }
    }
    const lvl = calcAlert(lead);
    if(lvl!==prev){ lead.alertLevel=lvl; changed=true; }
    if(lead.botActive===undefined){ lead.botActive=true; changed=true; }
  }
  if(changed) await tWrite(F.leads, tenant, leads);
  return leads;
}

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

async function seed(){
  const users=await read(F.users);
  if(!users.demo_automotora) users.demo_automotora=[
    {username:'gerente',  password:'demo',name:'Andrés Salas',  role:'admin',     phone:'56912000001',status:'Activo'},
    {username:'vendedor1',password:'demo',name:'Rodrigo Vidal', role:'vendedor',phone:'56912000002',status:'Activo'},
    {username:'vendedor2',password:'demo',name:'Camila Aravena',role:'vendedor',phone:'56912000003',status:'Activo'},
    {username:'recepcion',password:'demo',name:'Daniela Ortiz', role:'secretaria',phone:'56912000004',status:'Activo'}
  ];
  if(!users.demo_clinica) users.demo_clinica=[
    {username:'gerente',  password:'demo',name:'Dr. Hernán Vidal',role:'admin',     phone:'56912000010',status:'Activo'},
    {username:'vendedor1',password:'demo',name:'Karina Bravo',    role:'vendedor',phone:'56912000011',status:'Activo'}
  ];
  await write(F.users,users);

  const cfg=await read(F.config);
  if(!cfg.demo_automotora) cfg.demo_automotora={ businessName:'Automotora Andes',accentColor:'#3b82f6', stages:['Nuevo','En Proceso','Contactado','Calificado',QUAL_STAGE,'Negociación','Agendado','Seguimiento','Cerrado','Abandonado'] };
  if(!cfg.demo_clinica) cfg.demo_clinica={ businessName:'Clínica Vital',accentColor:'#0d9488', stages:['Nuevo','En Proceso','Contactado','Agendado',QUAL_STAGE,'Atendido','Seguimiento','Cerrado','Abandonado'] };
  for(const t of TENANTS){
    if(cfg[t]&&Array.isArray(cfg[t].stages)&&!cfg[t].stages.includes(QUAL_STAGE)) cfg[t].stages.splice(Math.max(1,cfg[t].stages.length-2),0,QUAL_STAGE);
  }
  await write(F.config,cfg);

  const bot=await read(F.bot);
  if(!bot.demo_automotora) bot.demo_automotora={greeting:'¡Hola! Soy Marcela de Automotora Andes. ¿Qué vehículo buscas hoy?'};
  if(!bot.demo_clinica)    bot.demo_clinica   ={greeting:'Hola, asistente de Clínica Vital. ¿En qué te podemos ayudar?'};
  await write(F.bot,bot);

  const inv=await read(F.inventory);
  if(!inv.demo_automotora) inv.demo_automotora=[
    {id:'AND-CH-001',brand:'Chevrolet',model:'Captiva 1.5T PREMIER AT',year:2026,stock:2,price:20990000,fuel:'Bencina',color:'Rojo',cc:'1500cc',rendimiento:'14.5 km/l',highlights:'3 filas, Sunroof, Pantalla 10.4"'},
    {id:'AND-LR-001',brand:'Land Rover',model:'Discovery Sport 2.0D HSE',year:2023,stock:1,price:43690000,fuel:'Diésel',color:'Blanco',cc:'2000cc',rendimiento:'12 km/l',highlights:'7 plazas,4WD,garantía extendida'},
    {id:'AND-TY-001',brand:'Toyota',model:'RAV4 2.5 Hybrid AWD',year:2024,stock:3,price:29990000,fuel:'Híbrido',color:'Blanco Perla',cc:'2500cc',rendimiento:'21 km/l',highlights:'222HP,tracción total'},
    {id:'AND-VW-001',brand:'Volkswagen',model:'Vento 1.6 MSI Highline AT',year:2024,stock:4,price:14990000,fuel:'Bencina',color:'Plata Reflex',cc:'1600cc',rendimiento:'15 km/l',highlights:'Sedán ejecutivo,cuero'}
  ];
  if(!inv.demo_clinica) inv.demo_clinica=[{id:'VIT-DERM',model:'Hora Dermatología',stock:12,price:45000}];
  await write(F.inventory,inv);

  const spend=await read(F.spend);
  if(!spend.demo_automotora) spend.demo_automotora={ 'Meta Ads':1200000,'Google Ads':900000,'Chileautos':600000, 'WhatsApp':0,'Instagram':350000,'Landing Page':0,'Referido':0 };
  if(!spend.demo_clinica) spend.demo_clinica={ 'Meta Ads':620000,'Google Ads':880000,'Instagram':310000,'Landing Page':0 };
  await write(F.spend,spend);

  const leadsDB = await read(F.leads);
  const now  = Date.now();
  const mAgo = m => new Date(now-m*60000).toISOString();
  const hAgo = h => new Date(now-h*3600000).toISOString();
  
  const chatContact = (v) => [
    {role:'user',content:`Hola, me interesa el ${v}.`,ts:now-7200000},
    {role:'bot', content:`¡Hola! Tenemos disponible el ${v}. Es un excelente modelo. ¿Buscas financiamiento?`,ts:now-7190000},
    {role:'user',content:'Me interesa el financiamiento. ¿Cuál es la cuota?',ts:now-5400000},
    {role:'bot', content:'¿Te gustaría que te llame un ejecutivo para darte el mejor precio? Trabajamos de 09:00 a 20:00 hrs.',ts:now-5390000}
  ];
  const chatCalif = (v) => [...chatContact(v),
    {role:'user',content:'Sí, llámenme hoy a las 15:00.',ts:now-3600000},
    {role:'bot', content:'¡Perfecto! Te llamamos hoy a las 15:00 hrs.',ts:now-3590000}
  ];

  leadsDB.demo_automotora = [
    {id:10001,name:'Valentina Morales',phone:'+56912345678',source:'Meta Ads',status:'Nuevo',lastInteraction:mAgo(8),lastClientTs:mAgo(8),interest:'Toyota RAV4 Hybrid',model:'AND-TY-001',assignedTo:'vendedor1',botActive:true,alertLevel:'fresh',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[{role:'user',content:'Hola, vi el RAV4. ¿Tiene tracción total?',ts:now-480000}]},
    {id:10002,name:'Ignacio Bustamante',phone:'+56976543210',source:'Google Ads',status:'Nuevo',lastInteraction:mAgo(14),lastClientTs:mAgo(14),interest:'Chevrolet Captiva',model:'AND-CH-001',assignedTo:'vendedor2',botActive:true,alertLevel:'fresh',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[{role:'user',content:'¿La Captiva tiene descuento al contado?',ts:now-840000}]},
    {id:10003,name:'Francisca Donoso',phone:'+56998811220',source:'Chileautos',status:'Nuevo',lastInteraction:mAgo(24),lastClientTs:mAgo(24),interest:'Toyota Hilux 4x4 SRX',model:'AND-TY-005',assignedTo:'vendedor1',botActive:true,alertLevel:'risk',intentSignal:'NONE',unread:true,reassigned:true,reassignedAt:mAgo(4),notes:[],chatHistory:[{role:'user',content:'Quiero cotizar la Hilux SRX 4x4.',ts:now-1440000}]},
    {id:10004,name:'Matías Fuentes',phone:'+56966778855',source:'WhatsApp',status:'Nuevo',lastInteraction:mAgo(38),lastClientTs:mAgo(38),interest:'Land Rover Discovery Sport',model:'AND-LR-001',assignedTo:'vendedor2',botActive:true,alertLevel:'critical',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[{role:'user',content:'Interés en el Land Rover Discovery. ¿Stock?',ts:now-2280000}]},
    {id:10006,name:'Roberto Cerda',phone:'+56933445566',source:'Google Ads',status:'Contactado',lastInteraction:hAgo(2),lastClientTs:hAgo(2.5),interest:'Toyota Corolla GR Sport',model:'AND-TY-003',assignedTo:'vendedor2',botActive:true,alertLevel:'none',intentSignal:'NONE',unread:false,reassigned:false,notes:[],chatHistory:chatContact('Toyota Corolla 2.0 CVT GR Sport')},
    {id:10007,name:'Pamela Rojas',phone:'+56922337788',source:'Chileautos',status:'Contactado',lastInteraction:hAgo(1),lastClientTs:mAgo(25),interest:'Chevrolet Captiva',model:'AND-CH-001',assignedTo:'vendedor1',botActive:true,alertLevel:'risk',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[...chatContact('Chevrolet Captiva 1.5T'),{role:'user',content:'¿El seguro está incluido en la cuota?',ts:now-1500000}]},
    {id:10008,name:'Héctor Muñoz',phone:'+56988990011',source:'Meta Ads',status:'Contactado',lastInteraction:hAgo(3),lastClientTs:mAgo(45),interest:'Volkswagen Vento Highline',model:'AND-VW-001',assignedTo:'vendedor2',botActive:true,alertLevel:'critical',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[...chatContact('Volkswagen Vento 1.6 Highline AT'),{role:'user',content:'¿Pueden traer el auto al domicilio?',ts:now-2700000}]},
    {id:10010,name:'Juan Ignacio Pérez',phone:'+56999001122',source:'Meta Ads',status:QUAL_STAGE,lastInteraction:hAgo(1),lastClientTs:hAgo(1.5),interest:'Chevrolet Captiva',model:'AND-CH-001',assignedTo:'vendedor1',botActive:true,alertLevel:'none',intentSignal:'BLUE',unread:false,reassigned:false,scheduleText:new Date(now + 86400000).toISOString(),notes:[],chatHistory:chatCalif('Chevrolet Captiva')}
  ];
  leadsDB.demo_automotora.forEach(l=>{ l.alertLevel=calcAlert(l); });
  if(!leadsDB.demo_clinica) leadsDB.demo_clinica=[];
  await write(F.leads, leadsDB);
}

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
  const t=validT(tenant);const users=await tRead(F.users,t);
  const u=users.find(x=>x.username===username&&x.password===password);
  if(!u) return res.status(401).json({error:'Credenciales incorrectas'});
  const token=crypto.randomBytes(24).toString('hex');
  const safe={username:u.username,name:u.name,role:u.role};
  sessions.set(token,{user:safe,tenant:t});
  res.json({token,user:safe,tenant:t});
});
app.post('/api/auth/logout',(req,res)=>{sessions.delete(req.header('X-Auth-Token'));res.json({ok:true});});
app.get('/api/me',auth(),(req,res)=>res.json({user:req.user,tenant:req.tenant}));

app.get('/api/users',auth('admin'),async(req,res)=>{
  const users=await tRead(F.users,req.tenant);
  res.json(users.map(u=>({username:u.username,name:u.name,role:u.role,status:u.status||'Activo',phone:u.phone||''})));
});
app.post('/api/users',auth('admin'),async(req,res)=>{
  const{username,password,name,role,phone,status}=req.body||{};
  if(!username||!name||!role) return res.status(400).json({error:'Datos requeridos faltantes'});
  const users=await tRead(F.users,req.tenant);
  if(users.find(u=>u.username===username)) return res.status(409).json({error:'Usuario ya existe'});
  const newUser={username,password:password||'demo',name,role,phone:phone||'',status:status||'Activo'};
  users.push(newUser);
  await tWrite(F.users,req.tenant,users);
  res.status(201).json({username,name,role,status:newUser.status,phone:newUser.phone});
});
app.put('/api/users/:username',auth('admin'),async(req,res)=>{
  const users=await tRead(F.users,req.tenant);
  const idx=users.findIndex(u=>u.username===req.params.username);
  if(idx===-1) return res.status(404).json({error:'Usuario no encontrado'});
  const{name,role,phone,status,password}=req.body||{};
  if(name)     users[idx].name=name;
  if(role)     users[idx].role=role;
  if(phone!==undefined) users[idx].phone=phone;
  if(status)   users[idx].status=status;
  if(password) users[idx].password=password;
  await tWrite(F.users,req.tenant,users);
  res.json({username:users[idx].username,name:users[idx].name,role:users[idx].role,status:users[idx].status,phone:users[idx].phone||''});
});
app.delete('/api/users/:username',auth('admin'),async(req,res)=>{
  const users=await tRead(F.users,req.tenant);
  const idx=users.findIndex(u=>u.username===req.params.username);
  if(idx===-1) return res.status(404).json({error:'Usuario no encontrado'});
  if(users[idx].role==='admin') return res.status(403).json({error:'No se puede eliminar al admin'});
  users.splice(idx,1);
  await tWrite(F.users,req.tenant,users);
  res.json({ok:true});
});

app.post('/api/demo/fastforward', auth('admin'), async(req,res)=>{
  const leads = await tRead(F.leads, req.tenant);
  for(const l of leads){
    if(l.status === 'Nuevo'){
      const t = Date.now() - 2100000;
      l.lastClientTs = new Date(t).toISOString();
      l.lastInteraction = new Date(t).toISOString();
    }
  }
  await tWrite(F.leads, req.tenant, leads);
  await applySlaRules(req.tenant);
  res.json({ok:true});
});

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
  const ALLOWED=['status','interest','name','phone','botActive','scheduleText'];
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
  if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
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
  if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username) return res.status(403).json({error:'Sin permisos'});
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'agent',content,ts:Date.now(),agent:req.user.username,agentName:req.user.name||req.user.username});
  leads[idx].unread=false;
  leads[idx].lastInteraction=new Date().toISOString();
  leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  const phone=(leads[idx].phone||'').replace(/\D/g,'');
  if(phone) sendWA(phone,content).catch(()=>{});
  res.json(leads[idx]);
});

app.get('/api/dashboard/kpis',auth('admin'),async(req,res)=>{
  const all=await applySlaRules(req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const nuevos=leads.filter(l=>l.status==='Nuevo');
  const closed=leads.filter(l=>l.status==='Cerrado').length;
  const qualified=leads.filter(l=>l.status===QUAL_STAGE).length;
  const now=Date.now();const minOf=l=>(now-new Date(l.lastClientTs||l.lastInteraction).getTime())/60000;
  const avg=nuevos.length?Math.round(nuevos.reduce((a,l)=>a+minOf(l),0)/nuevos.length):0;
  res.json({
    total:leads.length,active:leads.filter(l=>!FINAL_ST.has(l.status)).length,
    closed,qualified,unread:leads.filter(l=>l.unread).length,
    slaFresh:nuevos.filter(l=>l.alertLevel==='fresh').length,
    slaRisk:nuevos.filter(l=>l.alertLevel==='risk').length,
    slaCritical:nuevos.filter(l=>l.alertLevel==='critical').length,
    followFresh:leads.filter(l=>l.status!=='Nuevo'&&l.unread&&l.alertLevel==='fresh').length,
    followRisk:leads.filter(l=>l.status!=='Nuevo'&&l.unread&&l.alertLevel==='risk').length,
    followCritical:leads.filter(l=>l.status!=='Nuevo'&&l.unread&&l.alertLevel==='critical').length,
    avgResponseMin:avg,
    conversionRate:leads.length?((closed/leads.length)*100).toFixed(1):'0.0'
  });
});

app.get('/api/dashboard/team',auth('admin'),async(req,res)=>{
  const users=await tRead(F.users,req.tenant);
  const all=await tRead(F.leads,req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const now=Date.now();const minOf=l=>(now-new Date(l.lastClientTs||l.lastInteraction).getTime())/60000;
  res.json(users.filter(u=>u.role==='vendedor').map(v=>{
    const own=leads.filter(l=>l.assignedTo===v.username);
    const nv=own.filter(l=>l.status==='Nuevo');
    const closed=own.filter(l=>l.status==='Cerrado').length;
    const avgResp=nv.length?Math.round(nv.reduce((a,l)=>a+minOf(l),0)/nv.length):0;
    return{username:v.username,name:v.name,total:own.length,
      sla:{fresh:own.filter(l=>l.alertLevel==='fresh').length,risk:own.filter(l=>l.alertLevel==='risk').length,critical:own.filter(l=>l.alertLevel==='critical').length},
      closed,unread:own.filter(l=>l.unread).length,
      convRate:own.length?((closed/own.length)*100).toFixed(1):'0.0',avgResponseMin:avgResp,
      byStatus:{nuevo:nv.length,contactado:own.filter(l=>l.status==='Contactado').length,calificado:own.filter(l=>l.status===QUAL_STAGE).length,agendado:own.filter(l=>l.status==='Agendado').length,negociacion:own.filter(l=>l.status==='Negociación').length,seguimiento:own.filter(l=>l.status==='Seguimiento').length,cerrado:closed,abandonado:own.filter(l=>['Abandonado','Perdido'].includes(l.status)).length},
      leads:own.map(l=>({...l,chatHistory:Array.isArray(l.chatHistory)?l.chatHistory:[],notes:Array.isArray(l.notes)?l.notes:[],intentSignal:l.intentSignal||'NONE'}))};
  }).filter(v=>v.total>0));
});

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
    if(l.status==='Cerrado'){ch[c].sales++;const m=l.model||l.interest||'—';ch[c].models[m]=(ch[c].models[m]||0)+1;}
  }
  res.json(Object.values(ch).map(c=>{
    let top='—',tc=0;
    for(const[m,n]of Object.entries(c.models))if(n>tc){top=m;tc=n;}
    const agenda=leads.filter(l=>l.source===c.channel&&['Agendado',QUAL_STAGE].includes(l.status)).length;
    return{channel:c.channel,spend:c.spend,leads:c.leads,sales:c.sales,topModel:top,
      cpl:c.leads?Math.round(c.spend/c.leads):0,cac:c.sales?Math.round(c.spend/c.sales):0,
      cpa:agenda?Math.round(c.spend/agenda):0,conversion:c.leads?((c.sales/c.leads)*100).toFixed(1):'0.0'};
  }).sort((a,b)=>b.spend-a.spend));
});

app.get('/api/pipeline',auth(),async(req,res)=>{
  const cfg=await tRead(F.config,req.tenant,{});
  const all=await applySlaRules(req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);
  let leads=byRole(all,req.user);
  if(s!==null||e!==null) leads=leads.filter(l=>inRange(l,s,e));
  if(req.query.seller&&req.user.role==='admin') leads=leads.filter(l=>l.assignedTo===req.query.seller);
  res.json((cfg.stages||[]).map(st=>({stage:st,leads:leads.filter(l=>l.status===st)})));
});

app.get('/api/config',   auth(),        async(req,res)=>res.json(await tRead(F.config,req.tenant,{})));
app.put('/api/config',   auth('admin'), async(req,res)=>{const u={...await tRead(F.config,req.tenant,{}),...req.body};await tWrite(F.config,req.tenant,u);res.json(u);});
app.get('/api/bot',      auth('admin'), async(req,res)=>res.json(await tRead(F.bot,req.tenant,{})));
app.put('/api/bot',      auth('admin'), async(req,res)=>{const u={...await tRead(F.bot,req.tenant,{}),...req.body};await tWrite(F.bot,req.tenant,u);res.json(u);});
app.get('/api/inventory',auth('admin','vendedor'),async(req,res)=>res.json(await tRead(F.inventory,req.tenant)));

async function processHandoff(tenant, lead) {
  const userMsgs = lead.chatHistory.filter(m => m.role === 'user').length;
  if(userMsgs === 3) {
    const users = await tRead(F.users, tenant);
    const seller = users.find(u => u.username === lead.assignedTo);
    if(seller && seller.phone) {
      sendWA(seller.phone, `🔥 ALERTA FUNNEL OS: Tienes un lead caliente (${lead.name}) interesado en: ${lead.interest}. ¡Entra al CRM a revisar su chat!`).catch(()=>{});
    }
  }
}

app.post('/api/chat',async(req,res)=>{
  const tenant=validT(req.body?.tenant||req.query.tenant);
  const{sessionId,message}=req.body||{};
  if(!sessionId||!message) return res.status(400).json({error:'sessionId y message requeridos'});
  const leads=await tRead(F.leads,tenant);
  let sess=chatSessions.get(sessionId),captured=false,leadId;
  if(!sess){
    leadId=Date.now();const assignedObj=await rrNext(tenant);const assigned=assignedObj?.username||'vendedor1';
    const n=new Date().toISOString();
    leads.unshift({id:leadId,name:'Visitante anónimo',phone:'Pendiente',source:'Chat Web',status:'Nuevo',
      lastInteraction:n,lastClientTs:n,interest:message.slice(0,80),sessionId,
      assignedTo:assigned,botActive:true,alertLevel:'none',intentSignal:'NONE',unread:true,notes:[],chatHistory:[]});
    sess={tenant,leadId,step:0};chatSessions.set(sessionId,sess);captured=true;
    if(assignedObj?.phone) sendWA(assignedObj.phone,`🔔 NUEVO LEAD: "${message.slice(0,60)}" — atiéndelo ahora en el CRM.`).catch(()=>{});
  }else{leadId=sess.leadId;sess.step++;}
  const idx=leads.findIndex(l=>l.id===leadId);
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'user',content:message,ts:Date.now()});
  leads[idx].lastClientTs=new Date().toISOString();leads[idx].unread=true;
  if(leads[idx].botActive!==false){
    const p=await marcela(tenant,leads[idx].chatHistory.slice(0,-1),message);
    leads[idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
    leads[idx].lastInteraction=new Date().toISOString();leads[idx].unread=false;
    applySignal(leads[idx],p);
    if(sess.step>=2&&leads[idx].status==='Nuevo'&&leads[idx].intentSignal==='NONE') leads[idx].status='Contactado';
    leads[idx].alertLevel=calcAlert(leads[idx]);
    await processHandoff(tenant, leads[idx]);
    await tWrite(F.leads,tenant,leads);
    return res.json({reply:p.reply,sessionId,leadCaptured:captured,leadId,intentSignal:leads[idx].intentSignal,status:leads[idx].status});
  }
  await tWrite(F.leads,tenant,leads);
  res.json({reply:null,sessionId,leadCaptured:captured,leadId,botPaused:true});
});

app.get('/webhook',(req,res)=>{
  const vt=process.env.WA_VERIFY_TOKEN||'zara_token_123';
  if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===vt) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook',async(req,res)=>{
  if(!req.body.object) return res.sendStatus(404);
  res.sendStatus(200);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;const msg=val?.messages?.[0];
    if(!msg) return;const from=msg.from;
    const body=msg.text?.body||msg.button?.text||null;if(!body) return;
    if(isShield(body)){await sendWA(from,SHIELD_R);return;}
    const contactName=val.contacts?.[0]?.profile?.name||'WhatsApp Lead';
    const tenant='demo_automotora';const ld=await read(F.leads);
    if(!ld[tenant]) ld[tenant]=[];
    let idx=ld[tenant].findIndex(l=>l.phone&&l.phone.replace(/\D/g,'').includes(from.replace(/\D/g,'')));
    if(idx===-1){
      const assignedObj=await rrNext(tenant)||{username:'vendedor1'};
      const n=new Date().toISOString();
      ld[tenant].unshift({id:Date.now(),name:contactName,phone:'+'+from,source:'WhatsApp',status:'Nuevo',
        lastInteraction:n,lastClientTs:n,interest:body.slice(0,80),
        assignedTo:assignedObj.username,botActive:true,alertLevel:'none',intentSignal:'NONE',unread:true,notes:[],chatHistory:[]});
      idx=0;
      if(assignedObj.phone) sendWA(assignedObj.phone,`🔔 NUEVO LEAD WA: ${contactName} — "${body.slice(0,60)}" — atiéndelo ahora.`).catch(()=>{});
    }
    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];
    ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    ld[tenant][idx].lastClientTs=new Date().toISOString();ld[tenant][idx].unread=true;
    if(ld[tenant][idx].botActive!==false){
      const p=await marcela(tenant,ld[tenant][idx].chatHistory.slice(0,-1),body);
      ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
      applySignal(ld[tenant][idx],p);ld[tenant][idx].unread=false;
      const ut=ld[tenant][idx].chatHistory.filter(m=>m.role==='user').length;
      if(ut>=2&&ld[tenant][idx].status==='Nuevo'&&ld[tenant][idx].intentSignal==='NONE') ld[tenant][idx].status='Contactado';
      await processHandoff(tenant, ld[tenant][idx]);
      await sendWA(from,p.reply);
    }
    ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
    await write(F.leads,ld);
  }catch(e){console.error('Webhook:',e);}
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
setInterval(async()=>{for(const t of TENANTS){try{await applySlaRules(t);}catch(e){console.error('SLA',t,e.message);}}},60000);
app.listen(PORT,()=>{
  console.log(`🚀 FunnelOS en http://localhost:${PORT}`);
  seed().catch(console.error);
});

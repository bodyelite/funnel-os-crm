'use strict';
const{OpenAI}=require('openai');
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const express=require('express');
const path=require('path');
const fs=require('fs').promises;
const fsSync=require('fs');
const crypto=require('crypto');
const app=express();
const PORT=process.env.PORT||3000;
const DATA=process.env.RENDER?'/var/data':path.join(__dirname,'data');
if(!fsSync.existsSync(DATA))fsSync.mkdirSync(DATA,{recursive:true});
app.use(express.json({limit:'2mb'}));
const F={users:path.join(DATA,'users.json'),leads:path.join(DATA,'leads.json'),config:path.join(DATA,'config.json'),bot:path.join(DATA,'bot.json'),inventory:path.join(DATA,'inventory.json'),rr:path.join(DATA,'rr.json'),spend:path.join(DATA,'spend.json')};
const TENANTS=['demo_automotora','demo_clinica'];
const sessions=new Map();
const chatSessions=new Map();
const SLA_GREEN=20;
const SLA_YELLOW=50;
const SLA_REASSIGN=30;
const FINAL_ST=new Set(['Cerrado','Abandonado','Perdido']);
const VALID_ST=new Set(['Nuevo','En Proceso','Contactado','Calificado','Agendado','Seguimiento','Negociación','Atendido','Cerrado','Abandonado','Perdido']);
const read=async f=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return{};}};
const write=(f,d)=>fs.writeFile(f,JSON.stringify(d,null,2));
const tRead=async(f,t,fb=[])=>{const s=await read(f);return s[t]!==undefined?s[t]:fb;};
const tWrite=async(f,t,d)=>{const s=await read(f);s[t]=d;await write(f,s);};
const validT=t=>TENANTS.includes(t)?t:TENANTS[0];

function invStr(inv){if(!Array.isArray(inv)||!inv.length)return'(sin inventario)';return inv.map(i=>`- [${i.id}] ${i.brand||''} ${i.model}${i.year?' '+i.year:''} | Stock:${i.stock} | $${(i.price||0).toLocaleString('es-CL')}${i.fuel?'|'+i.fuel:''}${i.highlights?'|'+i.highlights:''}`).join('\n');}

function marcelaSys(biz,invS,notes){
  const notesBlock=notes&&notes.length?`\nNOTAS INTERNAS DEL EQUIPO (úsalas para personalizar):\n${notes.slice(-5).map(n=>`- ${n.author}: ${n.content}`).join('\n')}`:'';
  return`Eres Marcela, top asesora de ventas de ${biz} 🚗✨. Eres cálida, directa, empática y MUY persuasiva. Hablas en español chileno, con frases cortas, emojis naturales y cero rollo.
TU MISIÓN: Enamorar al cliente del auto perfecto y cerrar una visita o llamada.
INVENTARIO DISPONIBLE:\n${invS}${notesBlock}
REGLAS DE ORO:
1. Si preguntan por un modelo: confirma stock y resalta beneficios. IMPORTANTE: Vendemos autos NUEVOS y USADOS. Si piden un usado y tenemos el modelo, ofrécelo con entusiasmo. NUNCA digas que solo vendemos nuevos.
2. Siempre termina con una pregunta que invite a avanzar: visita, test drive o llamada de un ejecutivo.
3. Si detectas intención de compra real, propón: "¿Te llamo un ejecutivo ahora para darte el mejor precio? 😊 Trabajamos hasta las 20:00."
4. Horario fuera de 09:00-20:00: propón "mañana a las 09:00".
5. Precios en CLP con puntos. Nunca inventes datos. Si no sabes, di "déjame confirmarlo con el equipo".
6. Sé breve y conversacional. Máximo 3-4 oraciones por respuesta.
RESPONDE SOLO JSON (sin markdown):
{"reply":"<texto con emojis>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota>","schedule_detected":true|false,"schedule_text":"<hora si aplica>"}`;
}

function parseJ(raw){if(!raw)return null;const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a===-1||b===-1)return null;try{return JSON.parse(raw.slice(a,b+1));}catch{return null;}}
function fueraH(txt){const m=(txt||'').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);if(!m)return false;let h=parseInt(m[1],10);const mer=(m[3]||'').toLowerCase();if(mer==='pm'&&h<12)h+=12;if(mer==='am'&&h===12)h=0;return h<9||h>=20;}

async function marcela(tenant,history,msg,notes){
  try{
    const cfg=(await read(F.config))[tenant]||{};
    const inv=await tRead(F.inventory,tenant,[]);
    const completion=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.5,response_format:{type:'json_object'},messages:[{role:'system',content:marcelaSys(cfg.businessName||'la empresa',invStr(inv),notes||[])},...history.slice(-14).map(h=>({role:h.role==='user'?'user':'assistant',content:h.content})),{role:'user',content:msg}].flat()});
    let p=parseJ(completion.choices?.[0]?.message?.content||'');
    if(!p)p={reply:'¡Perdona! Algo falló 😅 ¿Me repites?',intent_signal:'NONE',intent_reason:'fallback',schedule_detected:false,schedule_text:''};
    if(p.schedule_detected&&fueraH(p.schedule_text)){p.reply+='\n\n(Nuestro horario es 09:00-20:00 ⏰ ¿Te acomoda mañana a las 09:00?)';p.intent_signal='YELLOW';}
    return p;
  }catch(e){console.error('Marcela:',e.message);return{reply:'Tuve un problemita técnico 😅 ¿Puedes repetir?',intent_signal:'NONE',intent_reason:'error',schedule_detected:false,schedule_text:''};}
}

function applySignal(lead,p){
  if(p.intent_signal==='BLUE'||p.intent_signal==='YELLOW'){lead.intentSignal=p.intent_signal;lead.status='Calificado';lead.scheduleText=p.schedule_text||'';}
  else if(!lead.intentSignal)lead.intentSignal='NONE';
}

async function sendWA(to,text){
  const token=process.env.WA_TOKEN,phoneId=process.env.WA_PHONE_ID;
  if(!token||!phoneId){console.log('⚠️ WA no config — para:',to,'msg:',text.slice(0,60));return;}
  try{const phone=String(to).replace(/\D/g,'');if(!phone)return;const res=await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`,{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'text',text:{body:text}})});if(!res.ok)console.error('WA error:',res.status);}catch(e){console.error('WA exc:',e.message);}
}

const SHIELD=['body elite','bodyelite','botox','lipo','lipoescultura','liposuccion','estetica','estética','masaje','masajes','doctora','tratamiento','acido hialuronico'];
const SHIELD_R='¡Hola! Este número es de Automotora Andes 🚗 Para Body Elite ve a su Instagram. ¡Gracias!';
function isShield(t){if(!t)return false;const n=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return SHIELD.some(k=>n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));}

async function getSellers(tenant){const u=await tRead(F.users,tenant);return u.filter(x=>x.role==='vendedor'&&(!x.status||x.status==='Activo'));}
async function rrNext(tenant,exclude=null){const sl=await getSellers(tenant);if(!sl.length)return null;const pool=exclude?sl.filter(s=>s.username!==exclude):sl;const list=pool.length?pool:sl;const rr=await read(F.rr);const idx=(rr[tenant]||0)%list.length;rr[tenant]=(idx+1)%list.length;await write(F.rr,rr);return list[idx];}

function calcAlert(lead){
  if(FINAL_ST.has(lead.status))return'none';
  const applies=lead.status==='Nuevo'||lead.unread===true;
  if(!applies)return'none';
  const ref=lead.lastClientTs||lead.lastInteraction;
  if(!ref)return'none';
  const m=(Date.now()-new Date(ref).getTime())/60000;
  if(m>SLA_YELLOW)return'critical';
  if(m>SLA_GREEN)return'risk';
  return'fresh';
}

async function applySlaRules(tenant){
  const leads=await tRead(F.leads,tenant);
  const allUsers=await tRead(F.users,tenant);
  let changed=false;
  for(const lead of leads){
    if(FINAL_ST.has(lead.status))continue;
    const prev=lead.alertLevel||'none';
    if(lead.status==='Nuevo'){
      const ref=lead.lastClientTs||lead.lastInteraction;
      const mins=ref?(Date.now()-new Date(ref).getTime())/60000:0;
      if(mins>SLA_REASSIGN&&!lead.reassigned){
        const nextObj=await rrNext(tenant,lead.assignedTo);
        if(nextObj&&nextObj.username!==lead.assignedTo){
          lead.assignedTo=nextObj.username;lead.reassigned=true;lead.reassignedAt=new Date().toISOString();changed=true;
          if(nextObj.phone)sendWA(nextObj.phone,`🚨 REASIGNACIÓN: Se te asignó el lead [${lead.name}] porque el vendedor anterior no respondió en 30 min. ¡Atiéndelo ya!`).catch(()=>{});
          const admin=allUsers.find(u=>u.role==='admin');
          if(admin?.phone)sendWA(admin.phone,`📢 AVISO GERENCIAL: El lead [${lead.name}] fue reasignado a [${nextObj.name||nextObj.username}] por negligencia (>30 min).`).catch(()=>{});
        }else{lead.reassigned=true;lead.reassignedAt=new Date().toISOString();changed=true;}
      }
      if(mins>SLA_YELLOW&&!lead.criticalAlertSent){
        lead.criticalAlertSent=true;changed=true;
        const admin=allUsers.find(u=>u.role==='admin');
        if(admin?.phone)sendWA(admin.phone,`🚨 ALERTA CRÍTICA: El lead [${lead.name}] lleva más de 50 min sin atención tras ser reasignado.`).catch(()=>{});
      }
    }
    const lvl=calcAlert(lead);
    if(lvl!==prev){lead.alertLevel=lvl;changed=true;}
    if(lead.botActive===undefined){lead.botActive=true;changed=true;}
  }
  if(changed)await tWrite(F.leads,tenant,leads);
  return leads;
}

function parseDateRange(start,end){let s=null,e=null;if(start){const d=new Date(start);if(!isNaN(d)){d.setHours(0,0,0,0);s=d.getTime();}}if(end){const d=new Date(end);if(!isNaN(d)){d.setHours(23,59,59,999);e=d.getTime();}}return{s,e};}
function inRange(lead,s,e){if(s===null&&e===null)return true;const ts=new Date(lead.lastInteraction||0).getTime();return(s===null||ts>=s)&&(e===null||ts<=e);}

async function seed(){
  const users=await read(F.users);
  if(!users.demo_automotora)users.demo_automotora=[{username:'gerente',password:'demo',name:'Andrés Salas',role:'admin',phone:'56912000001',status:'Activo'},{username:'vendedor1',password:'demo',name:'Rodrigo Vidal',role:'vendedor',phone:'56912000002',status:'Activo'},{username:'vendedor2',password:'demo',name:'Camila Aravena',role:'vendedor',phone:'56912000003',status:'Activo'},{username:'recepcion',password:'demo',name:'Daniela Ortiz',role:'secretaria',phone:'56912000004',status:'Activo'}];
  if(!users.demo_clinica)users.demo_clinica=[{username:'gerente',password:'demo',name:'Dr. Hernán Vidal',role:'admin',phone:'56912000010',status:'Activo'},{username:'vendedor1',password:'demo',name:'Karina Bravo',role:'vendedor',phone:'56912000011',status:'Activo'},{username:'recepcion',password:'demo',name:'Marcela Tapia',role:'secretaria',phone:'56912000012',status:'Activo'}];
  await write(F.users,users);
  const cfg=await read(F.config);
  if(!cfg.demo_automotora)cfg.demo_automotora={businessName:'Automotora Andes',accentColor:'#3b82f6',stages:['Nuevo','En Proceso','Contactado','Calificado','Negociación','Agendado','Seguimiento','Cerrado','Abandonado']};
  if(!cfg.demo_clinica)cfg.demo_clinica={businessName:'Clínica Vital',accentColor:'#0d9488',stages:['Nuevo','En Proceso','Contactado','Agendado','Calificado','Atendido','Seguimiento','Cerrado','Abandonado']};
  await write(F.config,cfg);
  const bot=await read(F.bot);
  if(!bot.demo_automotora)bot.demo_automotora={greeting:'¡Hola! Soy Marcela de Automotora Andes 🚗✨ ¿Qué auto estás buscando?'};
  if(!bot.demo_clinica)bot.demo_clinica={greeting:'Hola 👋 Soy la asistente de Clínica Vital. ¿En qué te puedo ayudar?'};
  await write(F.bot,bot);
  const inv=await read(F.inventory);
  if(!inv.demo_automotora)inv.demo_automotora=[{id:'AND-LR-001',brand:'Land Rover',model:'Discovery Sport 2.0D HSE',year:2023,stock:1,price:43690000,fuel:'Diésel',color:'Blanco',highlights:'7 plazas,4WD,garantía extendida'},{id:'AND-LR-002',brand:'Land Rover',model:'Defender 110 P300 SE',year:2024,stock:1,price:49990000,fuel:'Bencina',color:'Verde Aintree',highlights:'300HP,tecnología top'},{id:'AND-TY-001',brand:'Toyota',model:'RAV4 2.5 Hybrid AWD',year:2024,stock:3,price:29990000,fuel:'Híbrido',color:'Blanco Perla',highlights:'222HP,tracción total'},{id:'AND-TY-002',brand:'Toyota',model:'Fortuner 2.8 GD-6 SR 4x4',year:2024,stock:2,price:34990000,fuel:'Diésel',color:'Gris Oscuro',highlights:'7 plazas,4x4'},{id:'AND-PG-001',brand:'Peugeot',model:'3008 PureTech 130 EAT8',year:2024,stock:4,price:18990000,fuel:'Bencina',color:'Rojo Elixir',highlights:'SUV compacto,pantalla 10"'},{id:'AND-PG-002',brand:'Peugeot',model:'5008 BlueHDi 130 EAT8',year:2023,stock:2,price:22490000,fuel:'Diésel',color:'Gris Artense',highlights:'7 plazas,5.5L/100km'},{id:'AND-KI-001',brand:'Kia',model:'Sportage 1.6 T-GDi HEV AWD',year:2024,stock:3,price:21990000,fuel:'Híbrido',color:'Snow White Pearl',highlights:'180HP,AWD'},{id:'AND-PG-003',brand:'Peugeot',model:'408 PureTech 130 EAT8',year:2024,stock:5,price:16490000,fuel:'Bencina',color:'Negro Perla',highlights:'Fastback,8v auto'},{id:'AND-TY-003',brand:'Toyota',model:'Corolla 2.0 CVT GR Sport',year:2024,stock:6,price:15990000,fuel:'Bencina',color:'Rojo Supersónico',highlights:'Sport,Android Auto'},{id:'AND-VW-001',brand:'Volkswagen',model:'Vento 1.6 MSI Highline AT',year:2024,stock:4,price:14990000,fuel:'Bencina',color:'Plata Reflex',highlights:'Sedán ejecutivo,cuero'},{id:'AND-KI-002',brand:'Kia',model:'K5 2.5 MPI GT-Line AT',year:2023,stock:2,price:17990000,fuel:'Bencina',color:'Aurora Black',highlights:'Premium,crucero adaptativo'},{id:'AND-PG-004',brand:'Peugeot',model:'208 PureTech 100 Like AT',year:2024,stock:8,price:11490000,fuel:'Bencina',color:'Blanco Banquise',highlights:'Económico,ciudad'},{id:'AND-PG-005',brand:'Peugeot',model:'308 PureTech 130 Allure AT',year:2024,stock:3,price:16990000,fuel:'Bencina',color:'Gris Platinium',highlights:'i-Cockpit,CarPlay'},{id:'AND-TY-004',brand:'Toyota',model:'Yaris 1.5 XLS CVT',year:2024,stock:7,price:11990000,fuel:'Bencina',color:'Rojo Frambuesa',highlights:'Compacto,5 años garantía'},{id:'AND-VW-002',brand:'Volkswagen',model:'Polo 1.6 MSI Trendline AT',year:2024,stock:5,price:12490000,fuel:'Bencina',color:'Blanco Puro',highlights:'5★ NCAP,conectividad'},{id:'AND-TY-005',brand:'Toyota',model:'Hilux 2.8 TDI SRX AT 4x4',year:2024,stock:3,price:32990000,fuel:'Diésel',color:'Blanco',highlights:'Cabina doble,garantía 5 años'},{id:'AND-TY-006',brand:'Toyota',model:'Hilux 2.8 TDI GR Sport 4x4',year:2024,stock:1,price:36990000,fuel:'Diésel',color:'Negro Metálico',highlights:'204HP,top'},{id:'AND-KI-003',brand:'Kia',model:'Stonic 1.4 MPI LX AT',year:2024,stock:6,price:12990000,fuel:'Bencina',color:'Azul Stellar',highlights:'Crossover compacto'},{id:'AND-KI-004',brand:'Kia',model:'EV6 77.4 kWh AWD GT-Line',year:2024,stock:1,price:39990000,fuel:'Eléctrico',color:'Moonscape',highlights:'530km,carga 800V'},{id:'AND-PG-006',brand:'Peugeot',model:'E-208 50 kWh Allure',year:2024,stock:2,price:19990000,fuel:'Eléctrico',color:'Verde Olivine',highlights:'362km,libre restricción'}];
  if(!inv.demo_clinica)inv.demo_clinica=[{id:'VIT-DERM',brand:'',model:'Hora Dermatología',stock:12,price:45000},{id:'VIT-GIN',brand:'',model:'Hora Ginecología',stock:9,price:50000},{id:'VIT-MG',brand:'',model:'Medicina General',stock:25,price:32000}];
  await write(F.inventory,inv);
  const spend=await read(F.spend);
  if(!spend.demo_automotora)spend.demo_automotora={'Meta Ads':1200000,'Google Ads':900000,'Chileautos':600000,'WhatsApp':0,'Instagram':350000,'Landing Page':0,'Referido':0};
  if(!spend.demo_clinica)spend.demo_clinica={'Meta Ads':620000,'Google Ads':880000,'Instagram':310000,'Landing Page':0};
  await write(F.spend,spend);
  const leadsDB=await read(F.leads);
  const now=Date.now();
  const mAgo=m=>new Date(now-m*60000).toISOString();
  const hAgo=h=>new Date(now-h*3600000).toISOString();
  const cB=(v)=>[{role:'user',content:`Hola, me interesa el ${v}`,ts:now-7200000},{role:'bot',content:`¡Hola! 😊 Sí, tenemos el ${v}. ¿Te interesa financiamiento o visita?`,ts:now-7190000}];
  const cC=(v)=>[...cB(v),{role:'user',content:'Me interesa el financiamiento',ts:now-5400000},{role:'bot',content:'¡Perfecto! 🚗 ¿Te llamo un ejecutivo para el mejor precio? Trabajamos hasta las 20:00.',ts:now-5390000}];
  const cQ=(v)=>[...cC(v),{role:'user',content:'Sí, llámenme hoy a las 15:00',ts:now-3600000},{role:'bot',content:'¡Listo! Te llamamos hoy a las 15:00 ⏰ ¡Nos vemos!',ts:now-3590000}];
  leadsDB.demo_automotora=[
    {id:10001,name:'Valentina Morales',phone:'+56912345678',source:'Meta Ads',status:'Nuevo',lastInteraction:mAgo(8),lastClientTs:mAgo(8),interest:'Toyota RAV4 Hybrid',model:'AND-TY-001',assignedTo:'vendedor1',botActive:true,alertLevel:'fresh',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[{role:'user',content:'Hola vi el RAV4 ¿tiene tracción total?',ts:now-480000}]},
    {id:10002,name:'Ignacio Bustamante',phone:'+56976543210',source:'Google Ads',status:'Nuevo',lastInteraction:mAgo(14),lastClientTs:mAgo(14),interest:'Peugeot 3008',model:'AND-PG-001',assignedTo:'vendedor2',botActive:true,alertLevel:'fresh',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[{role:'user',content:'¿El 3008 tiene descuento al contado?',ts:now-840000}]},
    {id:10003,name:'Francisca Donoso',phone:'+56998811220',source:'Chileautos',status:'Nuevo',lastInteraction:mAgo(32),lastClientTs:mAgo(32),interest:'Toyota Hilux 4x4 SRX',model:'AND-TY-005',assignedTo:'vendedor1',botActive:true,alertLevel:'risk',intentSignal:'NONE',unread:true,reassigned:true,reassignedAt:mAgo(2),notes:[{content:'Lead reasignado por SLA',author:'Sistema',ts:now-120000}],chatHistory:[{role:'user',content:'Quiero cotizar la Hilux SRX 4x4',ts:now-1920000}]},
    {id:10004,name:'Matías Fuentes',phone:'+56966778855',source:'WhatsApp',status:'Nuevo',lastInteraction:mAgo(55),lastClientTs:mAgo(55),interest:'Land Rover Discovery Sport',model:'AND-LR-001',assignedTo:'vendedor2',botActive:true,alertLevel:'critical',intentSignal:'NONE',unread:true,reassigned:true,criticalAlertSent:true,notes:[],chatHistory:[{role:'user',content:'Me interesa el Land Rover Discovery',ts:now-3300000}]},
    {id:10005,name:'Daniela Arce',phone:'+56955449900',source:'Meta Ads',status:'Nuevo',lastInteraction:mAgo(22),lastClientTs:mAgo(22),interest:'Kia EV6 Eléctrico',model:'AND-KI-004',assignedTo:'vendedor1',botActive:true,alertLevel:'risk',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[{role:'user',content:'¿El EV6 aplica para franquicia eléctrica?',ts:now-1320000}]},
    {id:10006,name:'Roberto Cerda',phone:'+56933445566',source:'Google Ads',status:'Contactado',lastInteraction:hAgo(2),lastClientTs:hAgo(2.5),interest:'Toyota Corolla GR Sport',model:'AND-TY-003',assignedTo:'vendedor2',botActive:true,alertLevel:'none',intentSignal:'NONE',unread:false,reassigned:false,notes:[{content:'Llamado realizado. Muy interesado.',author:'Camila Aravena',ts:now-7000000}],chatHistory:cC('Toyota Corolla GR Sport')},
    {id:10007,name:'Pamela Rojas',phone:'+56922337788',source:'Chileautos',status:'Contactado',lastInteraction:hAgo(1),lastClientTs:mAgo(25),interest:'Peugeot 208 Automático',model:'AND-PG-004',assignedTo:'vendedor1',botActive:true,alertLevel:'risk',intentSignal:'NONE',unread:true,reassigned:false,notes:[{content:'Preguntó por seguro incluido',author:'Rodrigo Vidal',ts:now-1200000}],chatHistory:[...cC('Peugeot 208'),{role:'user',content:'¿El seguro va incluido en la cuota?',ts:now-1500000}]},
    {id:10008,name:'Héctor Muñoz',phone:'+56988990011',source:'Meta Ads',status:'Contactado',lastInteraction:hAgo(3),lastClientTs:mAgo(45),interest:'VW Vento Highline',model:'AND-VW-001',assignedTo:'vendedor2',botActive:true,alertLevel:'critical',intentSignal:'NONE',unread:true,reassigned:false,notes:[],chatHistory:[...cC('Vento Highline'),{role:'user',content:'¿Pueden llevar el auto al domicilio?',ts:now-2700000}]},
    {id:10009,name:'Catalina Espinoza',phone:'+56977114422',source:'WhatsApp',status:'Contactado',lastInteraction:hAgo(5),lastClientTs:hAgo(5.3),interest:'Toyota Yaris XLS',model:'AND-TY-004',assignedTo:'vendedor1',botActive:true,alertLevel:'none',intentSignal:'NONE',unread:false,reassigned:false,notes:[],chatHistory:cC('Toyota Yaris 1.5 XLS CVT')},
    {id:10010,name:'Juan Ignacio Pérez',phone:'+56999001122',source:'Meta Ads',status:'Calificado',lastInteraction:hAgo(1),lastClientTs:hAgo(1.5),interest:'Toyota Hilux GR Sport',model:'AND-TY-006',assignedTo:'vendedor1',botActive:true,alertLevel:'none',intentSignal:'BLUE',unread:false,reassigned:false,scheduleText:'hoy a las 15:00',notes:[{content:'Confirmó visita hoy 15:00.',author:'Rodrigo Vidal',ts:now-3500000}],chatHistory:cQ('Toyota Hilux GR Sport')},
    {id:10011,name:'María José Contreras',phone:'+56988773344',source:'Google Ads',status:'Calificado',lastInteraction:hAgo(2),lastClientTs:mAgo(35),interest:'Kia Sportage HEV',model:'AND-KI-001',assignedTo:'vendedor2',botActive:true,alertLevel:'critical',intentSignal:'BLUE',unread:true,reassigned:false,scheduleText:'mañana 11:00',notes:[{content:'Consulta por seguro en financiamiento',author:'Camila Aravena',ts:now-2000000}],chatHistory:[...cQ('Kia Sportage HEV'),{role:'user',content:'¿Incluyen seguro en el financiamiento?',ts:now-2100000}]},
    {id:10012,name:'Felipe Soto',phone:'+56966554433',source:'Chileautos',status:'Calificado',lastInteraction:hAgo(2),lastClientTs:hAgo(2.5),interest:'Land Rover Defender 110',model:'AND-LR-002',assignedTo:'vendedor1',botActive:true,alertLevel:'none',intentSignal:'YELLOW',unread:false,reassigned:false,scheduleText:'esta semana',notes:[{content:'No confirmó fecha exacta. Seguimiento mañana.',author:'Rodrigo Vidal',ts:now-7200000}],chatHistory:cQ('Land Rover Defender 110')},
    {id:10013,name:'Andrea Vásquez',phone:'+56955667788',source:'WhatsApp',status:'Calificado',lastInteraction:hAgo(3),lastClientTs:hAgo(3.3),interest:'Kia EV6',model:'AND-KI-004',assignedTo:'vendedor2',botActive:true,alertLevel:'none',intentSignal:'BLUE',unread:false,reassigned:false,scheduleText:'viernes 10:00',notes:[{content:'Test drive viernes 10am confirmado',author:'Camila Aravena',ts:now-10800000}],chatHistory:cQ('Kia EV6 GT-Line')},
    {id:10014,name:'Sebastián Lagos',phone:'+56944556677',source:'Meta Ads',status:'Cerrado',lastInteraction:hAgo(6),lastClientTs:hAgo(8),interest:'Toyota RAV4 Hybrid',model:'AND-TY-001',assignedTo:'vendedor1',botActive:false,alertLevel:'none',intentSignal:'BLUE',unread:false,reassigned:false,notes:[{content:'Venta cerrada al contado. Entrega jueves.',author:'Rodrigo Vidal',ts:now-20000000}],chatHistory:cQ('Toyota RAV4 Hybrid')},
    {id:10015,name:'Claudia Herrera',phone:'+56933225544',source:'Google Ads',status:'Cerrado',lastInteraction:hAgo(8),lastClientTs:hAgo(10),interest:'Peugeot 308 Allure',model:'AND-PG-005',assignedTo:'vendedor2',botActive:false,alertLevel:'none',intentSignal:'BLUE',unread:false,reassigned:false,notes:[{content:'Financiamiento BCI aprobado.',author:'Camila Aravena',ts:now-28000000}],chatHistory:cQ('Peugeot 308 Allure')},
    {id:10016,name:'Gustavo Moreno',phone:'+56911229988',source:'Chileautos',status:'Cerrado',lastInteraction:hAgo(10),lastClientTs:hAgo(12),interest:'Toyota Hilux SRX',model:'AND-TY-005',assignedTo:'vendedor1',botActive:false,alertLevel:'none',intentSignal:'BLUE',unread:false,reassigned:false,notes:[{content:'Venta empresa. Factura lista.',author:'Rodrigo Vidal',ts:now-35000000}],chatHistory:cQ('Toyota Hilux SRX')},
    {id:10017,name:'Carla Núñez',phone:'+56999112233',source:'Meta Ads',status:'Negociación',lastInteraction:hAgo(4),lastClientTs:mAgo(22),interest:'Toyota Fortuner 4x4',model:'AND-TY-002',assignedTo:'vendedor2',botActive:true,alertLevel:'risk',intentSignal:'YELLOW',unread:true,reassigned:false,notes:[{content:'Pide descuento $500k. Consultando gerente.',author:'Camila Aravena',ts:now-14000000}],chatHistory:[...cC('Toyota Fortuner'),{role:'user',content:'¿Me dan $500.000 de descuento?',ts:now-1320000}]},
    {id:10018,name:'Tomás Araya',phone:'+56988009911',source:'Google Ads',status:'Negociación',lastInteraction:hAgo(6),lastClientTs:hAgo(7),interest:'Peugeot 5008',model:'AND-PG-002',assignedTo:'vendedor1',botActive:true,alertLevel:'none',intentSignal:'YELLOW',unread:false,reassigned:false,notes:[{content:'Da Honda en parte de pago. Tasación en curso.',author:'Rodrigo Vidal',ts:now-20000000}],chatHistory:cC('Peugeot 5008')},
    {id:10019,name:'Rodrigo Venegas',phone:'+56977660011',source:'Meta Ads',status:'Abandonado',lastInteraction:hAgo(9),lastClientTs:hAgo(11),interest:'Kia K5',model:'AND-KI-002',assignedTo:'vendedor2',botActive:false,alertLevel:'none',intentSignal:'NONE',unread:false,reassigned:false,notes:[{content:'Compró en otra automotora.',author:'Camila Aravena',ts:now-30000000}],chatHistory:[{role:'user',content:'Busco el K5',ts:now-39600000},{role:'bot',content:'¡Lo tenemos! 😊',ts:now-39590000},{role:'user',content:'Ya lo compré en otra parte',ts:now-32400000}]},
    {id:10020,name:'Isabel Castillo',phone:'+56966773311',source:'Chileautos',status:'Abandonado',lastInteraction:hAgo(11),lastClientTs:hAgo(13),interest:'VW Polo AT',model:'AND-VW-002',assignedTo:'vendedor1',botActive:false,alertLevel:'none',intentSignal:'NONE',unread:false,reassigned:false,notes:[{content:'No aprobó el crédito.',author:'Rodrigo Vidal',ts:now-38000000}],chatHistory:[{role:'user',content:'Quiero el Polo AT',ts:now-46800000},{role:'bot',content:'¡Tenemos en blanco y gris! 🤍',ts:now-46790000}]}
  ];
  leadsDB.demo_automotora.forEach(l=>{l.alertLevel=calcAlert(l);});
  if(!leadsDB.demo_clinica)leadsDB.demo_clinica=[];
  await write(F.leads,leadsDB);
}

const auth=(...roles)=>async(req,res,next)=>{
  const token=req.header('X-Auth-Token')||req.query.token;
  const sess=sessions.get(token);
  if(!sess)return res.status(401).json({error:'No autenticado'});
  if(roles.length&&!roles.includes(sess.user.role))return res.status(403).json({error:'Sin permisos'});
  req.user=sess.user;req.tenant=sess.tenant;next();
};
const byRole=(leads,user)=>user.role==='vendedor'?leads.filter(l=>l.assignedTo===user.username):leads;

app.post('/api/auth/login',async(req,res)=>{
  const{username,password,tenant}=req.body||{};const t=validT(tenant);const users=await tRead(F.users,t);
  const u=users.find(x=>x.username===username&&x.password===password);
  if(!u)return res.status(401).json({error:'Credenciales incorrectas'});
  const token=crypto.randomBytes(24).toString('hex');const safe={username:u.username,name:u.name,role:u.role};
  sessions.set(token,{user:safe,tenant:t});res.json({token,user:safe,tenant:t});
});
app.post('/api/auth/logout',(req,res)=>{sessions.delete(req.header('X-Auth-Token'));res.json({ok:true});});
app.get('/api/me',auth(),(req,res)=>res.json({user:req.user,tenant:req.tenant}));

app.get('/api/users',auth('admin'),async(req,res)=>{const users=await tRead(F.users,req.tenant);res.json(users.map(u=>({username:u.username,name:u.name,role:u.role,status:u.status||'Activo',phone:u.phone||''})));});
app.post('/api/users',auth('admin'),async(req,res)=>{const{username,password,name,role,phone,status}=req.body||{};if(!username||!name||!role)return res.status(400).json({error:'username,name,role requeridos'});const users=await tRead(F.users,req.tenant);if(users.find(u=>u.username===username))return res.status(409).json({error:'Ya existe'});const nu={username,password:password||'demo',name,role,phone:phone||'',status:status||'Activo'};users.push(nu);await tWrite(F.users,req.tenant,users);res.status(201).json(nu);});
app.put('/api/users/:username',auth('admin'),async(req,res)=>{const users=await tRead(F.users,req.tenant);const idx=users.findIndex(u=>u.username===req.params.username);if(idx===-1)return res.status(404).json({error:'No encontrado'});const{name,role,phone,status,password}=req.body||{};if(name)users[idx].name=name;if(role)users[idx].role=role;if(phone!==undefined)users[idx].phone=phone;if(status)users[idx].status=status;if(password)users[idx].password=password;await tWrite(F.users,req.tenant,users);res.json(users[idx]);});
app.delete('/api/users/:username',auth('admin'),async(req,res)=>{const users=await tRead(F.users,req.tenant);const idx=users.findIndex(u=>u.username===req.params.username);if(idx===-1)return res.status(404).json({error:'No encontrado'});if(users[idx].role==='admin')return res.status(403).json({error:'No se puede eliminar admin'});users.splice(idx,1);await tWrite(F.users,req.tenant,users);res.json({ok:true});});

app.get('/api/leads',auth(),async(req,res)=>{
  const all=await applySlaRules(req.tenant);const{s,e}=parseDateRange(req.query.start,req.query.end);
  let leads=byRole(all,req.user);if(s!==null||e!==null)leads=leads.filter(l=>inRange(l,s,e));
  if(req.query.seller&&req.user.role==='admin')leads=leads.filter(l=>l.assignedTo===req.query.seller);
  leads.forEach(l=>{if(!Array.isArray(l.chatHistory))l.chatHistory=[];if(!Array.isArray(l.notes))l.notes=[];if(!l.intentSignal)l.intentSignal='NONE';if(!l.lastClientTs)l.lastClientTs=l.lastInteraction||new Date(0).toISOString();});
  leads.sort((a,b)=>new Date(b.lastClientTs||0)-new Date(a.lastClientTs||0));res.json(leads);
});
app.get('/api/leads/:id',auth(),async(req,res)=>{await applySlaRules(req.tenant);const leads=await tRead(F.leads,req.tenant);const l=leads.find(x=>x.id==req.params.id);if(!l)return res.status(404).json({error:'No encontrado'});if(req.user.role==='vendedor'&&l.assignedTo!==req.user.username)return res.status(403).json({error:'Sin permisos'});res.json(l);});
app.patch('/api/leads/:id',auth(),async(req,res)=>{
  const leads=await tRead(F.leads,req.tenant);const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1)return res.status(404).json({error:'No encontrado'});
  if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username)return res.status(403).json({error:'Sin permisos'});
  const ALLOWED=['status','interest','name','phone','botActive'];if(req.user.role!=='vendedor')ALLOWED.push('assignedTo');
  const patch={};for(const k of ALLOWED)if(req.body[k]!==undefined)patch[k]=req.body[k];
  if(patch.status!==undefined&&!VALID_ST.has(patch.status))return res.status(400).json({error:'Status inválido'});
  if(req.body.note&&String(req.body.note).trim()){leads[idx].notes=Array.isArray(leads[idx].notes)?leads[idx].notes:[];leads[idx].notes.push({content:String(req.body.note).trim(),author:req.user.name||req.user.username,ts:Date.now()});}
  Object.assign(leads[idx],patch);
  leads[idx].lastInteraction=new Date().toISOString();leads[idx].unread=false;leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);res.json(leads[idx]);
});
app.put('/api/leads/:id',auth(),async(req,res)=>{const leads=await tRead(F.leads,req.tenant);const idx=leads.findIndex(x=>x.id==req.params.id);if(idx===-1)return res.status(404).json({error:'No encontrado'});if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username)return res.status(403).json({error:'Sin permisos'});if(req.user.role==='vendedor')delete req.body.assignedTo;leads[idx]={...leads[idx],...req.body,lastInteraction:new Date().toISOString()};leads[idx].alertLevel=calcAlert(leads[idx]);await tWrite(F.leads,req.tenant,leads);res.json(leads[idx]);});
app.post('/api/leads/:id/bot',auth(),async(req,res)=>{const leads=await tRead(F.leads,req.tenant);const idx=leads.findIndex(x=>x.id==req.params.id);if(idx===-1)return res.status(404).json({error:'No encontrado'});if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username)return res.status(403).json({error:'Sin permisos'});leads[idx].botActive=!!req.body.botActive;await tWrite(F.leads,req.tenant,leads);res.json(leads[idx]);});
app.post('/api/leads/:id/message',auth('admin','vendedor'),async(req,res)=>{
  const{content}=req.body||{};if(!content)return res.status(400).json({error:'content requerido'});
  const leads=await tRead(F.leads,req.tenant);const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1)return res.status(404).json({error:'No encontrado'});
  if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username)return res.status(403).json({error:'Sin permisos'});
  leads[idx].chatHistory=leads[idx].chatHistory||[];
  leads[idx].chatHistory.push({role:'agent',content,ts:Date.now(),agent:req.user.username,agentName:req.user.name||req.user.username});
  leads[idx].unread=false;leads[idx].lastInteraction=new Date().toISOString();leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);
  const phone=(leads[idx].phone||'').replace(/\D/g,'');if(phone)sendWA(phone,content).catch(()=>{});
  res.json(leads[idx]);
});

app.get('/api/dashboard/kpis',auth('admin'),async(req,res)=>{
  const all=await applySlaRules(req.tenant);const{s,e}=parseDateRange(req.query.start,req.query.end);
  const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const nuevos=leads.filter(l=>l.status==='Nuevo');const closed=leads.filter(l=>l.status==='Cerrado').length;
  const now=Date.now();const minOf=l=>(now-new Date(l.lastClientTs||l.lastInteraction).getTime())/60000;
  const avg=nuevos.length?Math.round(nuevos.reduce((a,l)=>a+minOf(l),0)/nuevos.length):0;
  res.json({total:leads.length,active:leads.filter(l=>!FINAL_ST.has(l.status)).length,closed,qualified:leads.filter(l=>l.status==='Calificado').length,unread:leads.filter(l=>l.unread).length,slaFresh:nuevos.filter(l=>l.alertLevel==='fresh').length,slaRisk:nuevos.filter(l=>l.alertLevel==='risk').length,slaCritical:nuevos.filter(l=>l.alertLevel==='critical').length,followFresh:leads.filter(l=>l.status!=='Nuevo'&&l.unread&&l.alertLevel==='fresh').length,followRisk:leads.filter(l=>l.status!=='Nuevo'&&l.unread&&l.alertLevel==='risk').length,followCritical:leads.filter(l=>l.status!=='Nuevo'&&l.unread&&l.alertLevel==='critical').length,avgResponseMin:avg,conversionRate:leads.length?((closed/leads.length)*100).toFixed(1):'0.0'});
});
app.get('/api/dashboard/team',auth('admin'),async(req,res)=>{
  const users=await tRead(F.users,req.tenant);const all=await tRead(F.leads,req.tenant);
  const{s,e}=parseDateRange(req.query.start,req.query.end);const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  const now=Date.now();const minOf=l=>(now-new Date(l.lastClientTs||l.lastInteraction).getTime())/60000;
  res.json(users.filter(u=>u.role==='vendedor').map(v=>{
    const own=leads.filter(l=>l.assignedTo===v.username);const nv=own.filter(l=>l.status==='Nuevo');const closed=own.filter(l=>l.status==='Cerrado').length;
    const avgResp=nv.length?Math.round(nv.reduce((a,l)=>a+minOf(l),0)/nv.length):0;
    return{username:v.username,name:v.name,total:own.length,sla:{fresh:own.filter(l=>l.alertLevel==='fresh').length,risk:own.filter(l=>l.alertLevel==='risk').length,critical:own.filter(l=>l.alertLevel==='critical').length},closed,unread:own.filter(l=>l.unread).length,convRate:own.length?((closed/own.length)*100).toFixed(1):'0.0',avgResponseMin:avgResp,byStatus:{nuevo:nv.length,contactado:own.filter(l=>l.status==='Contactado').length,calificado:own.filter(l=>l.status==='Calificado').length,agendado:own.filter(l=>l.status==='Agendado').length,negociacion:own.filter(l=>l.status==='Negociación').length,seguimiento:own.filter(l=>l.status==='Seguimiento').length,cerrado:closed,abandonado:own.filter(l=>['Abandonado','Perdido'].includes(l.status)).length},leads:own.map(l=>({...l,chatHistory:Array.isArray(l.chatHistory)?l.chatHistory:[],notes:Array.isArray(l.notes)?l.notes:[],intentSignal:l.intentSignal||'NONE'}))};
  }).filter(v=>v.total>0));
});
app.get('/api/analytics/channels',auth('admin'),async(req,res)=>{
  const all=await tRead(F.leads,req.tenant);const{s,e}=parseDateRange(req.query.start,req.query.end);const leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;const spend=await tRead(F.spend,req.tenant,{});const ch={};
  for(const l of leads){const c=l.source||'Otro';if(!ch[c])ch[c]={channel:c,leads:0,sales:0,spend:spend[c]||0,models:{}};ch[c].leads++;if(l.status==='Cerrado'){ch[c].sales++;const m=l.model||l.interest||'—';ch[c].models[m]=(ch[c].models[m]||0)+1;}}
  res.json(Object.values(ch).map(c=>{let top='—',tc=0;for(const[m,n]of Object.entries(c.models))if(n>tc){top=m;tc=n;}const agenda=leads.filter(l=>l.source===c.channel&&['Agendado','Calificado'].includes(l.status)).length;return{channel:c.channel,spend:c.spend,leads:c.leads,sales:c.sales,topModel:top,cpl:c.leads?Math.round(c.spend/c.leads):0,cac:c.sales?Math.round(c.spend/c.sales):0,cpa:agenda?Math.round(c.spend/agenda):0,conversion:c.leads?((c.sales/c.leads)*100).toFixed(1):'0.0'};}).sort((a,b)=>b.spend-a.spend));
});
app.get('/api/pipeline',auth(),async(req,res)=>{const cfg=await tRead(F.config,req.tenant,{});const all=await applySlaRules(req.tenant);const{s,e}=parseDateRange(req.query.start,req.query.end);let leads=byRole(all,req.user);if(s!==null||e!==null)leads=leads.filter(l=>inRange(l,s,e));if(req.query.seller&&req.user.role==='admin')leads=leads.filter(l=>l.assignedTo===req.query.seller);res.json((cfg.stages||[]).map(st=>({stage:st,leads:leads.filter(l=>l.status===st)})));});
app.get('/api/config',auth(),async(req,res)=>res.json(await tRead(F.config,req.tenant,{})));
app.put('/api/config',auth('admin'),async(req,res)=>{const u={...await tRead(F.config,req.tenant,{}),...req.body};await tWrite(F.config,req.tenant,u);res.json(u);});
app.get('/api/bot',auth('admin'),async(req,res)=>res.json(await tRead(F.bot,req.tenant,{})));
app.put('/api/bot',auth('admin'),async(req,res)=>{const u={...await tRead(F.bot,req.tenant,{}),...req.body};await tWrite(F.bot,req.tenant,u);res.json(u);});
app.get('/api/inventory',auth('admin','vendedor'),async(req,res)=>res.json(await tRead(F.inventory,req.tenant)));

app.post('/api/demo/fastforward',auth('admin'),async(req,res)=>{
  const{leadId,minutes=35}=req.body||{};const leads=await tRead(F.leads,req.tenant);const idx=leads.findIndex(x=>x.id==leadId);if(idx===-1)return res.status(404).json({error:'Lead no encontrado'});
  const ms=minutes*60000;leads[idx].lastClientTs=new Date(new Date(leads[idx].lastClientTs||Date.now()).getTime()-ms).toISOString();leads[idx].lastInteraction=new Date(new Date(leads[idx].lastInteraction||Date.now()).getTime()-ms).toISOString();leads[idx].alertLevel=calcAlert(leads[idx]);await tWrite(F.leads,req.tenant,leads);res.json({ok:true,lead:leads[idx]});
});

app.post('/api/chat',async(req,res)=>{
  const tenant=validT(req.body?.tenant||req.query.tenant);const{sessionId,message}=req.body||{};
  if(!sessionId||!message)return res.status(400).json({error:'sessionId y message requeridos'});
  const leads=await tRead(F.leads,tenant);const allUsers=await tRead(F.users,tenant);
  let sess=chatSessions.get(sessionId),captured=false,leadId;
  if(!sess){
    leadId=Date.now();const assignedObj=await rrNext(tenant);const assigned=assignedObj?.username||'vendedor1';const n=new Date().toISOString();
    leads.unshift({id:leadId,name:'Visitante',phone:'Pendiente',source:'Chat Web',status:'Nuevo',lastInteraction:n,lastClientTs:n,interest:message.slice(0,80),sessionId,assignedTo:assigned,botActive:true,alertLevel:'none',intentSignal:'NONE',unread:true,notes:[],chatHistory:[]});
    sess={tenant,leadId,step:0};chatSessions.set(sessionId,sess);captured=true;
    if(assignedObj?.phone)sendWA(assignedObj.phone,`🔔 NUEVO LEAD: "${message.slice(0,60)}" — atiéndelo en el CRM ahora.`).catch(()=>{});
  }else{leadId=sess.leadId;sess.step++;}
  const idx=leads.findIndex(l=>l.id===leadId);
  leads[idx].chatHistory=leads[idx].chatHistory||[];leads[idx].chatHistory.push({role:'user',content:message,ts:Date.now()});
  leads[idx].unread=true;
  if(leads[idx].botActive!==false){
    const p=await marcela(tenant,leads[idx].chatHistory.slice(0,-1),message,leads[idx].notes);
    leads[idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
    applySignal(leads[idx],p);
    // STATUS SOLO LO CAMBIA UN HUMANO — el bot nunca toca lead.status
    leads[idx].alertLevel=calcAlert(leads[idx]);
    await tWrite(F.leads,tenant,leads);
    return res.json({reply:p.reply,sessionId,leadCaptured:captured,leadId,intentSignal:leads[idx].intentSignal,status:leads[idx].status});
  }
  await tWrite(F.leads,tenant,leads);res.json({reply:null,sessionId,leadCaptured:captured,leadId,botPaused:true});
});

app.get('/webhook',(req,res)=>{const vt=process.env.WA_VERIFY_TOKEN||'zara_token_123';if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===vt)return res.status(200).send(req.query['hub.challenge']);res.sendStatus(403);});
app.post('/webhook',async(req,res)=>{
  if(!req.body.object)return res.sendStatus(404);res.sendStatus(200);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;const msg=val?.messages?.[0];if(!msg)return;
    const from=msg.from;const body=msg.text?.body||msg.button?.text||null;if(!body)return;
    if(isShield(body)){await sendWA(from,SHIELD_R);return;}
    const contactName=val.contacts?.[0]?.profile?.name||'WhatsApp Lead';const tenant='demo_automotora';
    const ld=await read(F.leads);if(!ld[tenant])ld[tenant]=[];
    let idx=ld[tenant].findIndex(l=>l.phone&&l.phone.replace(/\D/g,'').includes(from.replace(/\D/g,'')));
    if(idx===-1){
      const assignedObj=await rrNext(tenant)||{username:'vendedor1'};const n=new Date().toISOString();
      ld[tenant].unshift({id:Date.now(),name:contactName,phone:'+'+from,source:'WhatsApp',status:'Nuevo',lastInteraction:n,lastClientTs:n,interest:body.slice(0,80),assignedTo:assignedObj.username,botActive:true,alertLevel:'none',intentSignal:'NONE',unread:true,notes:[],chatHistory:[]});
      idx=0;if(assignedObj.phone)sendWA(assignedObj.phone,`🔔 NUEVO LEAD WA: ${contactName} — "${body.slice(0,60)}" — atiéndelo ahora.`).catch(()=>{});
    }
    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    ld[tenant][idx].unread=true;
    if(ld[tenant][idx].botActive!==false){
      const p=await marcela(tenant,ld[tenant][idx].chatHistory.slice(0,-1),body,ld[tenant][idx].notes);
      ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});applySignal(ld[tenant][idx],p);
      // STATUS SOLO LO CAMBIA UN HUMANO — el bot nunca toca lead.status
      await sendWA(from,p.reply);
    }
    ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
    await write(F.leads,ld);
  }catch(e){console.error('Webhook:',e);}
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
setInterval(async()=>{for(const t of TENANTS){try{await applySlaRules(t);}catch(e){console.error('SLA',t,e.message);}}},60000);
app.listen(PORT,()=>{console.log(`🚀 FunnelOS :${PORT} | SLA_GREEN=${SLA_GREEN} SLA_REASSIGN=${SLA_REASSIGN} SLA_YELLOW=${SLA_YELLOW}`);seed().catch(console.error);});

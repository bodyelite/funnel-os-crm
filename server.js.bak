'use strict';
const{OpenAI}=require('openai');
const STAFF_TASACION = [
  {name:'Valentina',   phone:'56955145504'},
  {name:'Recepcion',   phone:'56983300262'},
  {name:'Juan Carlos', phone:'56937648536'}
];

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
app.use((req,res,next)=>{res.header('Access-Control-Allow-Origin','*');res.header('Access-Control-Allow-Headers','Content-Type,X-Auth-Token,Authorization');res.header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(200);next();});

const F={users:path.join(DATA,'users.json'),leads:path.join(DATA,'leads.json'),config:path.join(DATA,'config.json'),bot:path.join(DATA,'bot.json'),inventory:path.join(DATA,'inventory.json'),rr:path.join(DATA,'rr.json'),spend:path.join(DATA,'spend.json')};
const TENANTS=['demo_automotora','demo_clinica'];
const sessions=new Map();
const chatSessions=new Map();
const SLA_GREEN=20;
const SLA_YELLOW=50;
const SLA_REASSIGN=30;
const FINAL_ST=new Set(['Cerrado','Abandonado','Perdido']);
const VALID_ST=new Set(['Nuevo','En Proceso','Contactado','Calificado','Agendado','Reservado','Seguimiento','Negociación','Atendido','Cerrado','Abandonado','Perdido']);
const read=async f=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return{};}};
const write=(f,d)=>fs.writeFile(f,JSON.stringify(d,null,2));
const tRead=async(f,t,fb=[])=>{const s=await read(f);return s[t]!==undefined?s[t]:fb;};
const tWrite=async(f,t,d)=>{const s=await read(f);s[t]=d;await write(f,s);};
const validT=t=>TENANTS.includes(t)?t:TENANTS[0];

// ── Vendedores RMG — pool fijo para ruleta ─────────────────
const RMG_VENDORS = [
  {username:'daniela',name:'Daniela Narváez',role:'vendedor',phone:'56900000001',status:'Activo'},
  {username:'carlos', name:'Carlos Fracachan',role:'vendedor',phone:'56900000002',status:'Activo'},
];

// ── Web Scraper Heurístico — rmgautos.cl/usados/ ───────────
const RMG_SCRAPE_URL = 'https://rmgautos.cl/usados/';
const MARCAS_RE = /Toyota|Peugeot|Kia|Volkswagen|Ford|Chevrolet|Hyundai|Nissan|Suzuki|Mazda|Honda|Mitsubishi|Jeep|Land Rover|BMW|Mercedes|Audi|Subaru|Volvo|Chery|MG|BAIC|Renault|Opel|Ram|Ssangyong|Karry|Alfa Romeo|Changan|Citroen|Fiat|Seat|Skoda|Haval|Geely|BYD/gi;
let scrapeCache = { ts: 0, data: '' };

async function scrapeRMG() {
  const now = Date.now();
  if (scrapeCache.data && (now - scrapeCache.ts) < 30 * 60 * 1000) return scrapeCache.data;
  try {
    const r = await fetch(RMG_SCRAPE_URL, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();

    // Extraer links de fichas antes de procesar
    const linkMap = [];
    const linkTagRE = /href="(https:\/\/rmgautos\.cl\/product\/[^"]+)"/gi;
    let lm;
    while ((lm = linkTagRE.exec(html)) !== null) {
      const url = lm[1].replace(/\/$/, '');
      if (!linkMap.includes(url)) linkMap.push(url);
    }

    // Extraer valores de headings con regex simple (una sola linea cada uno en el HTML real)
    // Formato: <h2 class="...">VALOR</h2> o <h6 class="...">LABEL</h6>
    const tokens = [];
    const re2 = /<h2\b[^>]*>([^<]+)<\/h2>/gi;
    const re6 = /<h6\b[^>]*>([^<]+)<\/h6>/gi;

    // Combinar posiciones de h2 y h6 en orden de aparicion
    const matches = [];
    let m;
    while ((m = re2.exec(html)) !== null) matches.push({ pos: m.index, level: 2, text: m[1].trim() });
    while ((m = re6.exec(html)) !== null) matches.push({ pos: m.index, level: 6, text: m[1].trim() });
    matches.sort((a, b) => a.pos - b.pos);
    const toks = matches.filter(t => t.text.length > 0 && t.text.length < 200);

    const parsePrecio = (s) => parseInt((s||'').replace(/\./g,'').replace(',','').replace(/[^\d]/g,''),10)||0;

    const structuredItems = [];
    const autos = [];
    let autoIdx = 0;
    let i = 0;

    while (i < toks.length) {
      // Inicio de auto: h6 "Precio Lista:"
      if (toks[i].level !== 6 || !/precio lista/i.test(toks[i].text)) { i++; continue; }

      let j = i + 1;

      // Precio Lista: siguiente h2 con $
      while (j < toks.length && !(toks[j].level === 2 && toks[j].text.includes('$'))) j++;
      const precioLista = j < toks.length ? parsePrecio(toks[j].text) : 0;
      j++;

      // h6 "Precio Crédito:"
      while (j < toks.length && !/precio cr/i.test(toks[j].text)) j++;
      j++;
      // h2 con $
      while (j < toks.length && !(toks[j].level === 2 && toks[j].text.includes('$'))) j++;
      const precioCredito = j < toks.length ? parsePrecio(toks[j].text) : 0;
      j++;

      if (!precioLista && !precioCredito) { i = j; continue; }

      // Marca: siguiente h2 que matchee MARCAS_RE
      while (j < toks.length && !toks[j].text.match(MARCAS_RE)) j++;
      let marca = '';
      if (j < toks.length) {
        const mm = toks[j].text.match(MARCAS_RE);
        marca = mm ? mm[0].toUpperCase() : toks[j].text.toUpperCase().trim();
        j++;
      }

      // Modelo: siguiente h6 (corto, ej: FOCUS, PARTNER)
      while (j < toks.length && toks[j].level !== 6) j++;
      const modelo = j < toks.length ? toks[j].text.trim() : '';
      j++;

      // Saltar "|"
      while (j < toks.length && toks[j].text.trim() === '|') j++;

      // Versión: h2 que NO sea solo 4 dígitos ni "|" ni $ 
      let version = '';
      if (j < toks.length && toks[j].level === 2 && !/^\d{4}$/.test(toks[j].text) && toks[j].text !== '|' && !toks[j].text.includes('$')) {
        version = toks[j].text.trim();
        j++;
      }

      // Saltar "|"
      while (j < toks.length && toks[j].text.trim() === '|') j++;

      // Año: h2 con exactamente 4 dígitos
      let anno = null;
      if (j < toks.length && /^\d{4}$/.test(toks[j].text.trim())) {
        anno = parseInt(toks[j].text.trim(), 10);
        j++;
      }

      // Saltar "|"
      while (j < toks.length && toks[j].text.trim() === '|') j++;

      // Km: h2 con número puro (sin $, sin letras)
      let km = 0;
      if (j < toks.length && /^[\d.,]+$/.test(toks[j].text.trim()) && !toks[j].text.includes('$')) {
        km = parseInt(toks[j].text.replace(/[.,]/g,''), 10);
        j++;
      }

      // Saltar "|"
      while (j < toks.length && toks[j].text.trim() === '|') j++;

      // Combustible, transmisión, tipo — hasta próximo "Precio Lista" o fin
      let fuel = '', trans = '', tipo = '';
      while (j < toks.length && !/precio lista/i.test(toks[j].text)) {
        const t = toks[j].text.trim();
        if (/^(GASOLINA|DIESEL|DI.SEL|H.BRIDO|EL.CTRICO|BENCINA|HYBRIDO)/i.test(t) && !fuel) fuel = t.toUpperCase();
        if (/^(AUTOM.TICO|MEC.NICO|CVT|DSG|TIPTRONIC)/i.test(t) && !trans) trans = t.toUpperCase();
        if (/^(SUV|HATCHBACK|SED.N|FURG.N|PICKUP|STATION|MINIVAN|COUPE)/i.test(t) && !tipo) tipo = t.toUpperCase();
        j++;
      }

      const cardLink   = linkMap[autoIdx] || 'https://rmgautos.cl/usados/';
      const modeloDisp = (modelo && modelo.toUpperCase() !== marca) ? modelo : '';
      const fullModel  = [marca, modeloDisp, version].filter(Boolean).join(' ');
      const highlights = [anno?'Año '+anno:'', km?km.toLocaleString('es-CL')+' km':'', fuel, trans, tipo].filter(Boolean).join(' · ');

      structuredItems.push({
        id:             'RMG-' + (autoIdx + 1),
        brand:          marca,
        model:          fullModel,
        year:           anno,
        stock:          1,
        price:          precioCredito || precioLista,
        precio_lista:   precioLista,
        precio_credito: precioCredito,
        km:             km ? km.toLocaleString('es-CL') + ' km' : '',
        fuel,
        version,
        tipo,
        transmision:    trans,
        link:           cardLink,
        highlights
      });

      autos.push(
        `- ${fullModel}${anno?' '+anno:''} | ${km?km.toLocaleString('es-CL')+' km':'km n/d'} | Lista: $${precioLista.toLocaleString('es-CL')} | Credito: $${precioCredito.toLocaleString('es-CL')}${fuel?' | '+fuel:''}${trans?' | '+trans:''}`
      );

      autoIdx++;
      i = j;
    }

    if (structuredItems.length === 0) throw new Error('0 autos encontrados en rmgautos.cl');

    scrapeCache = { ts: now, data: [...new Set(autos)].join('\n'), items: structuredItems };
    console.log('[RMG-Scraper v4] ' + structuredItems.length + ' autos OK');
    return scrapeCache.data;
  } catch(e) {
    console.warn('[RMG-Scraper] Error:', e.message, '— usando cache o fallback');
    return scrapeCache.data || '';
  }
}

setInterval(async()=>{try{await scrapeRMG();}catch(e){}}, 30*60*1000);
scrapeRMG().catch(()=>{});

function invStr(inv){if(!Array.isArray(inv)||!inv.length)return'(sin inventario)';return inv.map(i=>`- [${i.id}] ${i.brand||''} ${i.model}${i.year?' '+i.year:''} | Stock:${i.stock} | $${(i.price||0).toLocaleString('es-CL')}${i.fuel?'|'+i.fuel:''}${i.highlights?'|'+i.highlights:''}`).join('\n');}

// ── Prompt camaleónico: nombre del asesor asignado ─────────

function parseJ(raw){if(!raw)return null;const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a===-1||b===-1)return null;try{return JSON.parse(raw.slice(a,b+1));}catch{return null;}}
function fueraH(txt){const m=(txt||'').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);if(!m)return false;let h=parseInt(m[1],10);const min=parseInt(m[2]||'0',10);const mer=(m[3]||'').toLowerCase();if(mer==='pm'&&h<12)h+=12;if(mer==='am'&&h===12)h=0;const total=h*60+min;return total<570||total>=1110;}

async function marcela(tenant, history, msg, notes, assignedName) {
  try {
    await scrapeRMG();
    const invItems = (scrapeCache.items && scrapeCache.items.length) ? scrapeCache.items : [];
    let invS = invItems.length
      ? invItems.map(i => {
          const pl = i.precio_lista ? '$' + i.precio_lista.toLocaleString('es-CL') : '';
          const pc = i.precio_credito ? '$' + i.precio_credito.toLocaleString('es-CL') : '';
          return `- [${i.id}] ${i.brand||''} ${i.model}${i.year?' '+i.year:''}`
            + (i.km ? ` | ${i.km}` : '')
            + (pl ? ` | Lista: ${pl}` : '')
            + (pc ? ` | Crédito: ${pc}` : '')
            + (i.fuel ? ` | ${i.fuel}` : '')
            + (i.transmision ? ` | ${i.transmision}` : '')
            + (i.tipo ? ` | ${i.tipo}` : '')
            + (i.link ? ` | LINK_FICHA: ${i.link}` : '');
        }).join('\n')
      : (scrapeCache.data || '');
    if (!invS) invS = '';

    let botCfg = await tRead(F.bot, tenant, {});
    if (!botCfg || typeof botCfg !== 'object' || Array.isArray(botCfg) || !botCfg.systemPrompt) {
      try {
        const seedBot = JSON.parse(fsSync.readFileSync(path.join(__dirname, 'data', 'bot.json'), 'utf8'));
        if (seedBot && seedBot[tenant] && seedBot[tenant].systemPrompt) {
          botCfg = Object.assign({}, botCfg, seedBot[tenant]);
          await tWrite(F.bot, tenant, botCfg);
          console.log('[marcela] systemPrompt restaurado desde data/bot.json para', tenant);
        }
      } catch(eSeed) {
        console.error('[marcela] No se pudo cargar data/bot.json:', eSeed.message);
      }
    }

    const baseSysPrompt = (botCfg && botCfg.systemPrompt) || 'Eres Marcela, asesora de ventas de Automotora Andes. Responde de forma calida y profesional en espanol chileno.';
    let sysPromptProcessed = baseSysPrompt.replace(/\{nombreIA\}/g, assignedName || 'Cata');
    sysPromptProcessed += '\n\nINVENTARIO DISPONIBLE:\n' + (invS || '(sin inventario disponible temporalmente)');
    if (notes && notes.length) {
      sysPromptProcessed += '\nNOTAS INTERNAS:\n' + notes.slice(-5).map(n => '- ' + n.author + ': ' + n.content).join('\n');
    }
    sysPromptProcessed += '\n\nRESPONDE SOLO EN FORMATO JSON (sin markdown, sin texto adicional):\n{"reply":"<texto con emojis>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota corta>","schedule_detected":true|false,"schedule_text":"<hora si aplica>"}';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sysPromptProcessed },
        ...history.slice(-14).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
        { role: 'user', content: msg }
      ].flat()
    });
    let p = parseJ(completion.choices?.[0]?.message?.content || '');
    if (!p) p = { reply: '\u00a1Perdona! Algo fall\u00f3 \ud83d\ude05 \u00bfMe repites?', intent_signal: 'NONE', intent_reason: 'fallback', schedule_detected: false, schedule_text: '' };
    if (p.schedule_detected && fueraH(p.schedule_text)) { p.reply += '\n\n(Nuestro horario es 09:30-18:30 \u23f0 \u00bfTe acomoda que te contactemos ma\u00f1ana a las 09:30?)'; p.intent_signal = 'YELLOW'; }
    return p;
  } catch(e) {
    console.error('[Marcela ERROR]', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0,5).join('\n'));
    if (e.response) console.error('[OpenAI status]', e.response.status, e.response.data);
    return { reply: 'Tuve un problemita t\u00e9cnico \ud83d\ude05 \u00bfPuedes repetir?', intent_signal: 'NONE', intent_reason: 'error', schedule_detected: false, schedule_text: '' };
  }
}

function esKeywordCalif(texto){
  if(!texto)return false;
  const t=texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  return['credito','pie','seguro','retoma','parte de pago','financiamiento',
    'cuota','mensualidad','bono','leasing','credito automotriz'].some(k=>t.includes(k));
}

function applySignal(lead,p){
  if(p.intent_signal==='BLUE'||p.intent_signal==='YELLOW'){
    lead.intentSignal=p.intent_signal;
    lead.scheduleText=p.schedule_text||'';
  } else if(!lead.intentSignal){
    lead.intentSignal='NONE';
  }
}

async function sendWA(to,text){
  const token=process.env.WA_TOKEN,phoneId=process.env.WA_PHONE_ID;
  if(!token||!phoneId){console.log('⚠️ WA no config — para:',to,'msg:',text.slice(0,60));return;}
  try{const phone=String(to).replace(/\D/g,'');if(!phone)return;const res=await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`,{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'text',text:{body:text}})});if(!res.ok)console.error('WA error:',res.status);}catch(e){console.error('WA exc:',e.message);}
}

const SHIELD=['body elite','bodyelite','botox','lipo','lipoescultura','liposuccion','estetica','estética','masaje','masajes','doctora','tratamiento','acido hialuronico'];
const SHIELD_R='¡Hola! Este número es de Automotora Andes 🚗 Para Body Elite ve a su Instagram. ¡Gracias!';
function isShield(t){if(!t)return false;const n=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return SHIELD.some(k=>n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));}

async function getSellers(tenant) {
  const allUsers = await tRead(F.users, tenant);
  const rmgNames = ['daniela','carlos'];
  const fromDB = allUsers.filter(u => rmgNames.includes(u.username) && u.role === 'vendedor' && (!u.status || u.status === 'Activo'));
  return fromDB.length >= 2 ? fromDB : RMG_VENDORS;
}
async function rrNext(tenant,exclude=null){const sl=await getSellers(tenant);if(!sl.length)return null;const pool=exclude?sl.filter(s=>s.username!==exclude):sl;const list=pool.length?pool:sl;const rr=await read(F.rr);const idx=(rr[tenant]||0)%list.length;rr[tenant]=(idx+1)%list.length;await write(F.rr,rr);return list[idx];}

function calcAlert(lead){
  if(FINAL_ST.has(lead.status))return'none';
  if(lead.status==='Reservado'){
    const ref=lead.reservadoAt||lead.lastInteraction;
    if(!ref)return'none';
    const hrs=(Date.now()-new Date(ref).getTime())/3600000;
    return hrs>72?'critical':hrs>48?'risk':'fresh';
  }
  const applies=lead.status==='Nuevo'||lead.unread===true;
  if(!applies)return'none';
  const ref=(lead.status==='esperando_respuesta_chileautos'||lead.status==='esperando_respuesta_general')?lead.lastInteraction:(lead.lastClientTs||lead.lastInteraction);
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
    if(lead.status==='Reservado'&&!lead.reservadoAlertSent){
      const ref=lead.reservadoAt||lead.lastInteraction;
      const hrs=ref?(Date.now()-new Date(ref).getTime())/3600000:0;
      if(hrs>72){
        lead.reservadoAlertSent=true;changed=true;
        const admin=allUsers.find(u=>u.role==='admin');
        const assignedUser=allUsers.find(u=>u.username===lead.assignedTo)||RMG_VENDORS.find(v=>v.username===lead.assignedTo);
        const msg='🔴 RESERVA VENCIDA (+72h): '+lead.name+'. La reserva lleva más de 3 días. Acción inmediata requerida.';
        if(admin?.phone)sendWA(admin.phone,msg).catch(()=>{});
        if(assignedUser?.phone)sendWA(assignedUser.phone,msg).catch(()=>{});
      }
    }
    if(lead.status==='Nuevo'){
      const ref=(lead.status==='esperando_respuesta_chileautos'||lead.status==='esperando_respuesta_general')?lead.lastInteraction:(lead.lastClientTs||lead.lastInteraction);
      const mins=ref?(Date.now()-new Date(ref).getTime())/60000:0;
      if(mins>SLA_REASSIGN&&!lead.reassigned){
        const nextObj=await rrNext(tenant,lead.assignedTo);
        if(nextObj&&nextObj.username!==lead.assignedTo){
          const aiSumR=lead.ai_summary?' Resumen IA: '+lead.ai_summary:'';
          lead.assignedTo=nextObj.username;lead.reassigned=true;lead.reassignedAt=new Date().toISOString();lead.adminReassignAlertSent=false;changed=true;
          if(nextObj.phone)sendWA(nextObj.phone,'🚨 REASIGNACIÓN: Se te asignó el lead ['+lead.name+'] porque el anterior no respondió en 30 min.'+aiSumR).catch(()=>{});
        }else{lead.reassigned=true;lead.reassignedAt=new Date().toISOString();lead.adminReassignAlertSent=false;changed=true;}
      }
      if(lead.reassigned&&lead.reassignedAt&&lead.unread&&lead.adminReassignAlertSent===false){
        const minsR=(Date.now()-new Date(lead.reassignedAt).getTime())/60000;
        if(minsR>SLA_REASSIGN){
          lead.adminReassignAlertSent=true;changed=true;
          const adminU=allUsers.find(u=>u.role==='admin');
          const aiSumA=lead.ai_summary?' Resumen IA: '+lead.ai_summary:'';
          if(adminU?.phone)sendWA(adminU.phone,'📢 ALERTA ADMIN: ['+lead.name+'] lleva 30+ min sin atención tras reasignación.'+aiSumA).catch(()=>{});
        }
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
  if(!users.demo_automotora){users.demo_automotora=[
    {username:'gerente',password:'demo',name:'Andrés Salas',role:'admin',phone:'56912000001',status:'Activo'},
    {username:'daniela',password:'demo',name:'Daniela Narváez',role:'vendedor',phone:'56900000001',status:'Activo'},
    {username:'carlos', password:'demo',name:'Carlos Fracachan',role:'vendedor',phone:'56900000002',status:'Activo'},
    {username:'recepcion',password:'demo',name:'Daniela Ortiz',role:'secretaria',phone:'56912000004',status:'Activo'}
  ];}else{
    for(const v of RMG_VENDORS){if(!users.demo_automotora.find(u=>u.username===v.username))users.demo_automotora.push(v);}
  }
  if(!users.demo_clinica)users.demo_clinica=[{username:'gerente',password:'demo',name:'Dr. Hernán Vidal',role:'admin',phone:'56912000010',status:'Activo'},{username:'vendedor1',password:'demo',name:'Karina Bravo',role:'vendedor',phone:'56912000011',status:'Activo'},{username:'recepcion',password:'demo',name:'Marcela Tapia',role:'secretaria',phone:'56912000012',status:'Activo'}];
  await write(F.users,users);
  const cfg=await read(F.config);
  if(!cfg.demo_automotora)cfg.demo_automotora={businessName:'RMG Autos',accentColor:'#3b82f6',stages:['Nuevo','En Proceso','Contactado','Calificado','Negociación','Agendado','Reservado','Cerrado','Abandonado']};
  else if(cfg.demo_automotora.stages&&!cfg.demo_automotora.stages.includes('Reservado')){
    const ci=cfg.demo_automotora.stages.indexOf('Cerrado');
    if(ci!==-1)cfg.demo_automotora.stages.splice(ci,0,'Reservado');
    else cfg.demo_automotora.stages.push('Reservado');
  }
  if(!cfg.demo_clinica)cfg.demo_clinica={businessName:'Clínica Vital',accentColor:'#0d9488',stages:['Nuevo','En Proceso','Contactado','Agendado','Calificado','Atendido','Seguimiento','Cerrado','Abandonado']};
  await write(F.config,cfg);
  const bot=await read(F.bot);
  if(!bot.demo_automotora||!bot.demo_automotora.systemPrompt){
    const _botSrc=await new Promise((res,rej)=>{
      try{res(JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'data','bot.json'),'utf8')));}catch(e){res({});}
    });
    bot.demo_automotora=_botSrc.demo_automotora||{greeting:'¡Hola! Soy Marcela de Automotora Andes 🚗✨ ¿Qué auto estás buscando?'};
  }
  if(!bot.demo_clinica)bot.demo_clinica={greeting:'Hola 👋 Soy la asistente de Clínica Vital. ¿En qué te puedo ayudar?'};
  await write(F.bot,bot);
  const inv=await read(F.inventory);
  if(!inv.demo_automotora)inv.demo_automotora=[];
  if(!inv.demo_clinica)inv.demo_clinica=[{id:'VIT-DERM',brand:'',model:'Hora Dermatología',stock:12,price:45000},{id:'VIT-GIN',brand:'',model:'Hora Ginecología',stock:9,price:50000},{id:'VIT-MG',brand:'',model:'Medicina General',stock:25,price:32000}];
  await write(F.inventory,inv);
  const spend=await read(F.spend);
  if(!spend.demo_automotora)spend.demo_automotora={'Meta Ads':1200000,'Google Ads':900000,'Chileautos':600000,'WhatsApp':0,'Instagram':350000,'Landing Page':0,'Referido':0};
  if(!spend.demo_clinica)spend.demo_clinica={'Meta Ads':620000,'Google Ads':880000,'Instagram':310000,'Landing Page':0};
  await write(F.spend,spend);
  const leadsDB=await read(F.leads);
  if(!leadsDB.demo_automotora)leadsDB.demo_automotora=[];
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
  sessions.set(token,{user:safe,tenant:t});res.json({token,user:safe,tenant:t,expires:Date.now()+86400000});
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
  const ALLOWED=['status','interest','name','phone','botActive','nextAction'];if(req.user.role!=='vendedor')ALLOWED.push('assignedTo');
  const patch={};for(const k of ALLOWED)if(req.body[k]!==undefined)patch[k]=req.body[k];
  if(patch.status!==undefined&&!VALID_ST.has(patch.status))return res.status(400).json({error:'Status inválido'});
  if(req.body.note&&String(req.body.note).trim()){leads[idx].notes=Array.isArray(leads[idx].notes)?leads[idx].notes:[];leads[idx].notes.push({content:String(req.body.note).trim(),author:req.user.name||req.user.username,ts:Date.now()});}
  if(patch.status==='Reservado'&&leads[idx].status!=='Reservado')patch.reservadoAt=new Date().toISOString();
  Object.assign(leads[idx],patch);
  leads[idx].lastInteraction=new Date().toISOString();leads[idx].unread=false;leads[idx].alertLevel=calcAlert(leads[idx]);
  await tWrite(F.leads,req.tenant,leads);res.json(leads[idx]);
});
app.put('/api/leads/:id',auth(),async(req,res)=>{const leads=await tRead(F.leads,req.tenant);const idx=leads.findIndex(x=>x.id==req.params.id);if(idx===-1)return res.status(404).json({error:'No encontrado'});if(req.user.role==='vendedor'&&leads[idx].assignedTo!==req.user.username)return res.status(403).json({error:'Sin permisos'});if(req.user.role==='vendedor')delete req.body.assignedTo;leads[idx]={...leads[idx],...req.body,lastInteraction:new Date().toISOString()};leads[idx].alertLevel=calcAlert(leads[idx]);await tWrite(F.leads,req.tenant,leads);res.json(leads[idx]);});

app.post('/api/leads/:id/resumen',auth('admin','vendedor'),async(req,res)=>{
  const leads=await tRead(F.leads,req.tenant);
  const idx=leads.findIndex(x=>x.id==req.params.id);
  if(idx===-1)return res.status(404).json({error:'No encontrado'});
  const lead=leads[idx];

  // [SPRINT5-MULTIMEDIA-BACKEND]
  (async () => {
    try {
      const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (message && lead) {
        if (!lead.media) lead.media = [];
        let changed = false;

        if (message.type === 'image' && message.image) {
          const mediaObj = {
            type: 'image',
            url: message.image.id || message.image.link || '',
            text: message.image.caption || '',
            ts: Date.now()
          };
          lead.media.push(mediaObj);
          lead.chatHistory = lead.chatHistory || [];
          lead.chatHistory.push({ role: 'user', content: `[IMAGEN RECIBIDA] ${mediaObj.text ? '— ' + mediaObj.text : ''}`.trim(), ts: mediaObj.ts });
          changed = true;
        }

        if (message.type === 'audio' && message.audio) {
          const mediaObj = {
            type: 'audio',
            url: message.audio.id || message.audio.link || '',
            text: '[Audio Recibido]',
            ts: Date.now()
          };
          lead.media.push(mediaObj);
          lead.chatHistory = lead.chatHistory || [];
          lead.chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO]`, ts: mediaObj.ts });
          changed = true;
        }
      }
    } catch (e) { console.error('Error procesando multimedia:', e); }
  })();
  const histSnip=(lead.chatHistory||[]).slice(-14).map(m=>(m.role==='user'?'Cliente':m.role==='agent'?'Vendedor':'IA')+': '+m.content).join('\n');
  const notasSnip=(lead.notes||[]).filter(n=>n.author!=='Resumen IA').slice(-5).map(n=>n.author+': '+n.content).join('\n');
  if(!histSnip)return res.status(400).json({error:'Sin historial'});
  try{
    const r=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.4,max_tokens:200,
      messages:[{role:'system',content:'Eres un asistente comercial de automotora. Con el historial de chat y las notas del vendedor, redacta un BRIEFING narrativo de maximo 3 lineas: (1) [Nombre] consulta por [auto especifico]. (2) [Que dijo sobre financiamiento, retoma, fecha o acuerdo]. (3) Sugerencia: [accion concreta para el vendedor ahora]. Espanol directo, sin emojis, sin titulos, solo el parrafo.'},
                {role:'user',content:'NOMBRE: '+lead.name+'\nHISTORIAL:\n'+histSnip+(notasSnip?'\nNOTAS DEL VENDEDOR:\n'+notasSnip:'')}]});
    const resumen=(r.choices?.[0]?.message?.content||'').trim();
    if(!resumen)return res.status(500).json({error:'Sin respuesta de OpenAI'});
    lead.ai_summary=resumen;
    await tWrite(F.leads,req.tenant,leads);
    res.json({ok:true,ai_summary:resumen,lead});
  }catch(e){
    console.error('[resumen-error]',e.message);
    res.status(500).json({error:e.message});
  }
});

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

app.post('/api/force-sla',auth('admin'),async(req,res)=>{
  const leads=await tRead(F.leads,req.tenant);
  const ms=31*60000;let count=0;
  for(const l of leads){
    if(l.status==='Nuevo'){
      l.lastClientTs=new Date(new Date(l.lastClientTs||Date.now()).getTime()-ms).toISOString();
      l.lastInteraction=new Date(new Date(l.lastInteraction||Date.now()).getTime()-ms).toISOString();
      l.alertLevel=calcAlert(l);count++;
    }
  }
  await tWrite(F.leads,req.tenant,leads);
  const updated=await applySlaRules(req.tenant);
  res.json({ok:true,count,leads:updated.filter(l=>l.status==='Nuevo')});
});
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
    if(message.trim().toLowerCase()==='/reset'){leads.splice(idx,1);await tWrite(F.leads,tenant,leads);return res.json({reply:'🔄 Lead eliminado. Listo para nuevo ingreso desde Chileautos.',status:'eliminado',alertLevel:'none'});}
    const assignedUserChat=allUsers.find(u=>u.username===leads[idx].assignedTo)||RMG_VENDORS.find(v=>v.username===leads[idx].assignedTo);
    const assignedNameChat=assignedUserChat?.name||null;
    const p=await marcela(tenant,leads[idx].chatHistory.slice(0,-1),message,leads[idx].notes,assignedNameChat);
    leads[idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});
    applySignal(leads[idx],p);
    if(esKeywordCalif(message)&&!leads[idx].keywordAlertSent){
      leads[idx].keywordAlertSent=true;
      leads[idx].intentSignal='BLUE';
      try{
        const histSnip=leads[idx].chatHistory.slice(-10).map(m=>(m.role==='user'?'Cliente':'Asesor')+': '+m.content).join('\n');
        const notasSnip=(leads[idx].notes||[]).filter(n=>n.author!=='Resumen IA').slice(-3).map(n=>n.author+': '+n.content).join('\n');
        const resComp=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.4,max_tokens:200,messages:[{role:'system',content:'Eres un asistente comercial de automotora. Con el historial de chat y las notas del vendedor, redacta un BRIEFING narrativo de maximo 3 lineas: (1) [Nombre] consulta por [auto especifico]. (2) [Que dijo sobre financiamiento, retoma, fecha o acuerdo]. (3) Sugerencia: [accion concreta para el vendedor ahora]. Espanol directo, sin emojis, sin titulos, solo el parrafo.'},{role:'user',content:'NOMBRE: '+leads[idx].name+'\nHISTORIAL:\n'+histSnip+(notasSnip?'\nNOTAS DEL VENDEDOR:\n'+notasSnip:'')}]});
        const resumenIA=(resComp.choices?.[0]?.message?.content||'').trim()||'Interés detectado en crédito/retoma.';
        leads[idx].ai_summary=resumenIA;
        if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,'✅ Lead Asignado: '+leads[idx].name+'. Resumen IA: '+resumenIA+' — Entra al CRM para cerrar.').catch(()=>{});
      }catch(eIA){
        console.error('[Resumen-Error /chat]', eIA);
        leads[idx].notes.push({content:'🧠 Cliente mencionó crédito/retoma/seguro. (OpenAI falló: '+eIA.message+')',author:'Resumen IA',ts:Date.now()});
        if(assignedUserChat?.phone)sendWA(assignedUserChat.phone,'✅ Lead Asignado: '+leads[idx].name+'. Lee el resumen en la bitácora del CRM.').catch(()=>{});
      }
    }
    if(p.reply&&p.reply.indexOf('rmgautos.cl')!==-1){leads[idx].nextAction={text:'¿Pudiste ver la ficha en el enlace? Fíjate en los detalles del equipamiento 👀 ¿Qué te pareció?',date:new Date(Date.now()+2*60000).toISOString(),createdAt:new Date().toISOString(),delegateToIA:true,iaCompleted:false};}
    leads[idx].alertLevel=calcAlert(leads[idx]);
    await tWrite(F.leads,tenant,leads);
    return res.json({reply:p.reply,sessionId,leadCaptured:captured,leadId,intentSignal:leads[idx].intentSignal,status:leads[idx].status});
  }
  await tWrite(F.leads,tenant,leads);res.json({reply:null,sessionId,leadCaptured:captured,leadId,botPaused:true});
});


app.post('/api/leads/inbound', async (req, res) => {
  try {
    const { tenant='demo_automotora', name, phone='Pendiente', source='Chileautos', interest='', status='esperando_respuesta_chileautos', botActive=false, externalId=null, notes:extraNotes=[] } = req.body;
    const n = new Date().toISOString();
    const leads = await tRead(F.leads, tenant);

    // Deduplicar por externalId (leadId de Chileautos) o por teléfono si no es Pendiente
    let exists = null;
    if (externalId) {
      exists = leads.find(l => l.externalId === externalId);
    } else if (phone && phone !== 'Pendiente') {
      const clean2 = phone.replace(/\D/g,'');
      exists = leads.find(l => l.phone && l.phone.replace(/\D/g,'').includes(clean2));
    }
    if (exists) return res.json({ ok: true, leadId: exists.id, skipped: true });

    const clean = phone !== 'Pendiente' ? phone.replace(/\D/g,'') : '';
    const assignedObj = await rrNext(tenant) || { username: 'vendedor1' };
    const initNotes = [{ content: `Lead recibido desde ${source}. En sala de espera.`, author: 'Bot', ts: Date.now() }];
    const allNotes = [...initNotes, ...extraNotes];
    const lead = {
      id: Date.now(),
      externalId,
      name: name || 'Lead Chileautos',
      phone: clean ? '+' + clean : 'Pendiente',
      source,
      interest,
      status,
      botActive,
      alertLevel: 'none',
      intentSignal: 'NONE',
      unread: true,
      assignedTo: assignedObj.username,
      lastInteraction: n,
      lastClientTs: n,
      notes: allNotes,
      chatHistory: [],
      media: []
    };
    leads.unshift(lead);
    await tWrite(F.leads, tenant, leads);
    if (assignedObj.phone) sendWA(assignedObj.phone, `🔔 NUEVO LEAD CHILEAUTOS asignado a ti. Entra a FunnelOS → Chileautos para verlo.`).catch(()=>{});
    console.log('[INBOUND] Lead creado:', name, phone, status, externalId || '');
    res.json({ ok: true, leadId: lead.id });
  } catch(e) {
    console.error('[INBOUND]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ENDPOINT: Crear lead manual desde el frontend ────────────────────────
app.post('/api/leads/manual', auth('admin','vendedor'), async (req, res) => {
  try {
    const tenant = req.tenant || 'demo_automotora';
    const { nombre, phone='Pendiente', canal='WhatsApp', asignado, interes='', nota='', status='Nuevo' } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
    const n = new Date().toISOString();
    const leads = await tRead(F.leads, tenant);
    if (phone !== 'Pendiente') {
      const clean2 = phone.replace(/\D/g,'');
      const exists = leads.find(l => l.phone && l.phone.replace(/\D/g,'').includes(clean2));
      if (exists) return res.status(400).json({ error: 'Ya existe un lead con ese telefono.' });
    }
    const initNotes = [];
    if (nota) initNotes.push({ content: nota, author: req.user?.username || 'Manual', ts: Date.now() });
    initNotes.push({ content: 'Lead creado manualmente. Canal: ' + canal, author: 'Sistema', ts: Date.now() });
    const lead = {
      id: Date.now(), name: nombre, phone, source: canal, interest: interes,
      status, botActive: status === 'Nuevo',
      alertLevel: 'none', intentSignal: 'NONE', unread: true,
      assignedTo: asignado || req.user?.username || 'vendedor1',
      lastInteraction: n, lastClientTs: new Date(0).toISOString(),
      notes: initNotes, chatHistory: [], media: []
    };
    leads.unshift(lead);
    await tWrite(F.leads, tenant, leads);
    const token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_ID;
    if (token && phoneId && phone !== 'Pendiente') {
      try {
        const phoneClean = phone.replace(/\D/g,'');
        const templateName = process.env.CA_WA_TEMPLATE || 'contacto_chileautos_v1';
        const waRes = await fetch('https://graph.facebook.com/v19.0/' + phoneId + '/messages', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: phoneClean, type: 'template',
            template: { name: templateName, language: { code: 'es' },
              components: [{ type: 'body', parameters: [
                { type: 'text', text: nombre },
                { type: 'text', text: interes || 'vehiculo consultado' }
              ]}]
            }
          })
        });
        const waJson = await waRes.json();
        if (waRes.ok) {
          console.log('[LEAD-MANUAL] Plantilla WA enviada a', phone);
          const leads2 = await tRead(F.leads, tenant);
          const li = leads2.findIndex(l => l.id === lead.id);
          if (li !== -1) {
            leads2[li].chatHistory.push({ role: 'bot', content: '[PLANTILLA WA] Hola ' + nombre + ', te contactamos desde RMG Autos por el ' + (interes||'vehiculo') + '.', ts: Date.now() });
            await tWrite(F.leads, tenant, leads2);
          }
        } else { console.warn('[LEAD-MANUAL] Plantilla no enviada:', JSON.stringify(waJson)); }
      } catch(we) { console.error('[LEAD-MANUAL] WA exc:', we.message); }
    }
    const team = await tRead(F.team, tenant);
    const vend = (team||[]).find(u => u.username === lead.assignedTo);
    if (vend?.phone) sendWA(vend.phone, '\u{1F514} NUEVO LEAD MANUAL [' + canal + ']: ' + nombre + ' asignado a ti en FunnelOS.').catch(()=>{});
    console.log('[LEAD-MANUAL] Creado:', nombre, phone, canal, status);
    res.json({ ok: true, leadId: lead.id });
  } catch(e) {
    console.error('[LEAD-MANUAL]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chileautos/webhook', async (req, res) => {
  try {
    res.sendStatus(200);
    const payload = req.body;
    const tenant = 'demo_automotora';
    const prospect = payload.Prospect || payload.prospect || {};
    const vehicle  = payload.Vehicle  || payload.vehicle  || {};
    const firstName = prospect.FirstName || prospect.firstName || '';
    const lastName  = prospect.LastName  || prospect.lastName  || '';
    const name = (firstName + ' ' + lastName).trim() || 'Lead Chileautos';
    const phones = prospect.PhoneNumbers || prospect.phoneNumbers || [];
    let rawPhone = '';
    if (Array.isArray(phones) && phones.length) {
      const mob = phones.find(p => (p.Type||p.type||'').toLowerCase().includes('mobile')) || phones[0];
      rawPhone = mob.Number || mob.number || mob.Value || mob.value || '';
    }
    const clean = rawPhone.replace(/\D/g,'');
    const phone  = clean ? (clean.startsWith('56') ? '+'+clean : '+56'+clean) : 'Pendiente';
    const vehicleTitle = vehicle.Title || vehicle.title || vehicle.Make && (vehicle.Make+' '+vehicle.Model+' '+(vehicle.Year||'')).trim() || 'Vehículo consultado';
    const externalId = payload.LeadId || payload.leadId || payload.Id || null;
    const n = new Date().toISOString();
    const leads = await tRead(F.leads, tenant);
    const phoneClean = phone.replace(/\D/g,'');
    const existing = leads.findIndex(l => {
      if (externalId && l.externalId === externalId) return true;
      if (phone !== 'Pendiente' && l.phone && l.phone.replace(/\D/g,'').includes(phoneClean)) return true;
      return false;
    });
    if (existing !== -1) {
      const existingLead = leads[existing];
      // Si ya está en sala de espera CA, es multicotizante real
      if (existingLead.status === 'esperando_respuesta_chileautos') {
        leads[existing].isMulticotizante = true;
        leads[existing].interest = vehicleTitle;
        leads[existing].history = leads[existing].history || [];
        leads[existing].history.push({ ts: Date.now(), content: '[SISTEMA] Nueva cotización vía Chileautos: ' + vehicleTitle });
        leads[existing].lastInteraction = n;
        await tWrite(F.leads, tenant, leads);
        console.log('[CA-WEBHOOK] Multicotizante en sala espera actualizado:', name, phone);
        return;
      }
      // Si ya tiene conversación activa (no es sala de espera), registrar en historial
      if (existingLead.chatHistory && existingLead.chatHistory.length > 0) {
        leads[existing].isMulticotizante = true;
        leads[existing].interest = vehicleTitle;
        leads[existing].history = leads[existing].history || [];
        leads[existing].history.push({ ts: Date.now(), content: '[SISTEMA] Nueva cotización vía Chileautos: ' + vehicleTitle });
        leads[existing].lastInteraction = n;
        await tWrite(F.leads, tenant, leads);
        console.log('[CA-WEBHOOK] Multicotizante con chat activo:', name, phone);
        return;
      }
      // Lead existe pero sin conversación → moverlo a sala de espera CA
      leads[existing].status = 'esperando_respuesta_chileautos';
      leads[existing].interest = vehicleTitle;
      leads[existing].source = 'Chileautos';
      leads[existing].externalId = externalId;
      leads[existing].isMulticotizante = false;
      leads[existing].botActive = false;
      leads[existing].lastInteraction = n;
      leads[existing].lastClientTs = new Date(0).toISOString();
      leads[existing].history = [{ ts: Date.now(), content: 'Lead recibido desde Chileautos: ' + vehicleTitle }];
      leads[existing].notes = [{ content: 'Lead recibido desde Chileautos. Vehículo: ' + vehicleTitle, author: 'Bot', ts: Date.now() }];
      leads[existing].chatHistory = [];
      await tWrite(F.leads, tenant, leads);
      console.log('[CA-WEBHOOK] Lead existente movido a sala espera CA:', name, phone);
      // Disparar WA igualmente para este lead
    }
    const assignedObj = await rrNext(tenant) || { username: 'vendedor1' };
    const newLead = {
      id: Date.now(), externalId, name, phone, source: 'Chileautos',
      interest: vehicleTitle, status: 'esperando_respuesta_chileautos',
      botActive: false, isMulticotizante: false, alertLevel: 'none',
      intentSignal: 'NONE', unread: true, assignedTo: assignedObj.username,
      lastInteraction: n, lastClientTs: n,
      history: [{ ts: Date.now(), content: 'Lead recibido desde Chileautos: ' + vehicleTitle }],
      notes: [{ content: 'Lead recibido desde Chileautos. Vehículo: ' + vehicleTitle, author: 'Bot', ts: Date.now() }],
      chatHistory: [], media: []
    };
    leads.unshift(newLead);
    await tWrite(F.leads, tenant, leads);
    const token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_ID;
    if (token && phoneId && phone !== 'Pendiente') {
      try {
        const templateName = process.env.CA_WA_TEMPLATE || 'contacto_chileautos_v1';
        const waRes = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: phoneClean,
            type: 'template',
            template: { name: templateName, language: { code: 'es' },
              components: [{ type: 'body', parameters: [
                { type: 'text', text: firstName || name },
                { type: 'text', text: vehicleTitle }
              ]}]
            }
          })
        });
        const waJson = await waRes.json();
        if (waRes.ok) {
          console.log('[CA-WEBHOOK] ✅ Plantilla WA enviada a', phone, '| template:', templateName);
          const leads2 = await tRead(F.leads, tenant);
          const nIdx = leads2.findIndex(l => l.externalId === externalId || (phone !== 'Pendiente' && l.phone && l.phone.replace(/\D/g,'').includes(phoneClean)));
          if (nIdx !== -1) {
            leads2[nIdx].chatHistory = leads2[nIdx].chatHistory || [];
            leads2[nIdx].chatHistory.push({ role: 'bot', content: `[PLANTILLA WA ENVIADA] Hola ${firstName||name}, te contactamos desde RMG Autos sobre el ${vehicleTitle} que consultaste en Chileautos.`, ts: Date.now() });
            await tWrite(F.leads, tenant, leads2);
          }
        } else {
          console.error('[CA-WEBHOOK] WA error:', JSON.stringify(waJson));
        }
      } catch(we) { console.error('[CA-WEBHOOK] WA exc:', we.message); }
    } else if (phone === 'Pendiente') {
      console.log('[CA-WEBHOOK] Sin teléfono — plantilla WA no enviada');
    }
    if (assignedObj.phone) sendWA(assignedObj.phone, '🔔 NUEVO LEAD CHILEAUTOS: ' + name + ' interesado en ' + vehicleTitle).catch(()=>{});
    console.log('[CA-WEBHOOK] Lead creado:', name, phone, vehicleTitle);
  } catch(e) {
    console.error('[CA-WEBHOOK]', e.message);
  }
});

app.get('/webhook',(req,res)=>{const vt=process.env.WA_VERIFY_TOKEN||'zara_token_123';if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===vt)return res.status(200).send(req.query['hub.challenge']);res.sendStatus(403);});

// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Error: Sin token WA_TOKEN configurado en el servidor');
    
    const uRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    const uData = await uRes.json();
    
    if (!uData.url) {
        console.error('Meta API Error:', uData);
        return res.status(404).send('Error de Meta: ' + JSON.stringify(uData));
    }
    
    const mRes = await fetch(uData.url, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    
    if (!mRes.ok) {
        const errText = await mRes.text();
        return res.status(mRes.status).send('Fallo al descargar archivo de Meta: ' + errText);
    }

    const buffer = await mRes.arrayBuffer();
    const contentType = mRes.headers.get('content-type');
    
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error en Proxy Multimedia:', e);
    res.status(500).send('Error interno en el servidor Node');
  }
});
// --- FIN PROXY ---

app.post('/webhook',async(req,res)=>{
  if(!req.body.object)return res.sendStatus(404);res.sendStatus(200);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;const msg=val?.messages?.[0];if(!msg)return;
    const from=msg.from;let body=msg.text?.body||msg.button?.text||null;

    // --- MULTIMEDIA HANDLER V4 ---
    if (msg.type === 'image' || msg.type === 'audio') {
      const contactName = val.contacts?.[0]?.profile?.name || 'WhatsApp Lead';
      const tenant = 'demo_automotora';
      const ld = await read(F.leads);
      if (!ld[tenant]) ld[tenant] = [];
      let idx = ld[tenant].findIndex(l => l.phone && l.phone.replace(/\D/g, '').includes(from.replace(/\D/g, '')));
      
      if (idx === -1) {
        const assignedObj = await rrNext(tenant) || {username: 'vendedor1'};
        const n = new Date().toISOString();
        ld[tenant].unshift({id: Date.now(), name: contactName, phone: '+' + from, source: 'WhatsApp', status: 'Nuevo', lastInteraction: n, lastClientTs: n, interest: msg.type === 'image' ? '[Foto Recibida]' : '[Audio Recibido]', assignedTo: assignedObj.username, botActive: true, alertLevel: 'none', intentSignal: 'NONE', unread: true, notes: [], chatHistory: [], media: []});
        idx = 0;
      }

      if (!ld[tenant][idx].media) ld[tenant][idx].media = [];
      
      if (msg.type === 'image') {
        const mediaId = msg.image.id;
        const caption = msg.image.caption || '';
        ld[tenant][idx].media.push({ type: 'image', url: mediaId, text: caption, ts: Date.now() });
        body = caption ? `[FOTO RECIBIDA]: ${caption}. Dile amablemente que la agregarás a la evaluación.` : '[FOTO RECIBIDA] El cliente envió una foto. Dile que la recibiste y la agregarás a la evaluación.';
      }

      if (msg.type === 'audio') {
        try {
          const audioId = msg.audio.id;
          const metaUrlRes = await fetch(`https://graph.facebook.com/v19.0/${audioId}`, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
          const metaUrlData = await metaUrlRes.json();
          
          if (metaUrlData.url) {
            const audioRes = await fetch(metaUrlData.url, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
            const arrayBuffer = await audioRes.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuffer);
            
            const { Readable } = require('stream');
            const readableStream = Readable.from(audioBuffer);
            readableStream.path = 'audio.ogg';
            
            const transcriptionRes = await openai.audio.transcriptions.create({ file: readableStream, model: 'whisper-1' });
            const transcription = transcriptionRes.text || '[Sin transcripción]';
            
            body = `[AUDIO TRANSCRITO]: "${transcription}". Responde al cliente considerando esto.`;
            ld[tenant][idx].chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO] 🎤 "${transcription}"`, ts: Date.now() });
          } else {
            throw new Error('URL de audio no encontrada');
          }
        } catch (err) {
          console.error('Error Whisper:', err.message);
          body = '[AUDIO RECIBIDO] El cliente envió una nota de voz, dile que en un momento lo escuchas.';
          ld[tenant][idx].chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO - Transcripción falló]`, ts: Date.now() });
        }
      }
      
      await tWrite(F.leads, tenant, ld[tenant]);
    }
// --- FIN MULTIMEDIA HANDLER V4 ---
    
    if(!body)return;
    if(isShield(body)){await sendWA(from,SHIELD_R);return;}
    const contactName=val.contacts?.[0]?.profile?.name||'WhatsApp Lead';const tenant='demo_automotora';
    const ld=await read(F.leads);if(!ld[tenant])ld[tenant]=[];
    let idx=ld[tenant].findIndex(l=>l.phone&&l.phone.replace(/\D/g,'').includes(from.replace(/\D/g,'')));
    if(idx===-1){
      const assignedObj=await rrNext(tenant)||{username:'vendedor1'};const n=new Date().toISOString();

      // ── Detectar origen portal (Yapo, MercadoLibre, Chileautos WA directo) ──
      let detectedSource = 'WhatsApp';
      let detectedInterest = body.slice(0, 80);
      let portalNote = null;

      const yapoMatch = body.match(/Me interesa el anuncio\s*"([^"]+)"/i);
      const mlMatch   = body.match(/publicaci[oó]n en Mercado Libre[^:\-]*[:\-]?\s*(.{0,60})/i);
      const caMatch   = body.match(/auto en Chileautos[^:\-]*[:\-]?\s*(.{0,60})/i);
      const metaMatch = body.match(/anuncio en Meta|vi su anuncio en Meta|anuncio de RMG en Meta|anuncio RMG Meta/i);

      if (metaMatch) {
        detectedSource   = 'Meta Ads';
        detectedInterest = body.replace(/Hola[,.]?\s*/i, '').slice(0, 80) || 'Consulta desde Meta Ads';
        portalNote = `Lead ingresó desde campaña Meta Ads. Mensaje inicial: ${body.slice(0, 80)}`;
      } else if (yapoMatch) {
        detectedSource   = 'Yapo';
        detectedInterest = yapoMatch[1].trim();
        portalNote = `Lead ingresó desde Yapo. Vehículo consultado: ${detectedInterest}`;
      } else if (mlMatch) {
        detectedSource   = 'MercadoLibre';
        detectedInterest = mlMatch[1].trim() || body.slice(0, 80);
        portalNote = `Lead ingresó desde MercadoLibre. Interés: ${detectedInterest}`;
      } else if (caMatch) {
        detectedSource   = 'Chileautos';
        detectedInterest = caMatch[1].trim() || body.slice(0, 80);
        portalNote = `Lead ingresó desde Chileautos vía WA directo. Interés: ${detectedInterest}`;
      }

      const initNotes = portalNote
        ? [{ content: portalNote, author: 'Sistema', ts: Date.now() }]
        : [];

      ld[tenant].unshift({
        id: Date.now(), name: contactName, phone: '+'+from,
        source: detectedSource, status: 'Nuevo',
        lastInteraction: n, lastClientTs: n,
        interest: detectedInterest,
        assignedTo: assignedObj.username, botActive: true,
        alertLevel: 'none', intentSignal: 'NONE', unread: true,
        notes: initNotes, chatHistory: []
      });
      idx = 0;
      const srcTag = detectedSource !== 'WhatsApp' ? ` [${detectedSource}]` : '';
      if(assignedObj.phone) sendWA(assignedObj.phone, `🔔 NUEVO LEAD WA${srcTag}: ${contactName} — "${detectedInterest.slice(0,60)}" — atiéndelo ahora.`).catch(()=>{});
    }
    if(ld[tenant][idx].status==='esperando_respuesta_chileautos'||ld[tenant][idx].status==='esperando_respuesta_general'){
      const prevSrc = ld[tenant][idx].status==='esperando_respuesta_chileautos' ? 'Chileautos' : (ld[tenant][idx].source||'Canal');
      ld[tenant][idx].status='Nuevo';
      ld[tenant][idx].botActive=true;
      ld[tenant][idx].unread=true;
      ld[tenant][idx].notes=(ld[tenant][idx].notes||[]).concat({content:'✅ Cliente respondió. Activado en embudo desde sala de espera ('+prevSrc+').',author:'Sistema',ts:Date.now()});
      const _au=await tRead(F.users,tenant);
      const _av=_au.find(u=>u.username===ld[tenant][idx].assignedTo)||RMG_VENDORS.find(v=>v.username===ld[tenant][idx].assignedTo);
      if(_av?.phone)sendWA(_av.phone,'\u{1F514} '+prevSrc+': '+ld[tenant][idx].name+' respondio! Ya esta en tu embudo.').catch(()=>{});
    }
    ld[tenant][idx].chatHistory=ld[tenant][idx].chatHistory||[];ld[tenant][idx].chatHistory.push({role:'user',content:body,ts:Date.now()});
    ld[tenant][idx].unread=true;
    if(ld[tenant][idx].botActive!==false){
      if(body.trim().toLowerCase()==='/reset'){ld[tenant].splice(idx,1);await tWrite(F.leads,tenant,ld[tenant]);console.log('[RESET] Lead eliminado para',from,'— listo para nuevo ingreso');return;}
      const allUsersWH=await tRead(F.users,tenant);
      const assignedUserWH=allUsersWH.find(u=>u.username===ld[tenant][idx].assignedTo)||RMG_VENDORS.find(v=>v.username===ld[tenant][idx].assignedTo);
      const assignedNameWH=assignedUserWH?.name||null;
      const p=await marcela(tenant,ld[tenant][idx].chatHistory.slice(0,-1),body,ld[tenant][idx].notes,assignedNameWH);
      ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});applySignal(ld[tenant][idx],p);
      if(p.reply&&p.reply.indexOf('rmgautos.cl')!==-1&&!(ld[tenant][idx].nextAction&&!ld[tenant][idx].nextAction.iaCompleted)){ld[tenant][idx].nextAction={text:'¿Pudiste ver la ficha en el enlace? Fíjate en los detalles del equipamiento 👀 ¿Qué te pareció?',date:new Date(Date.now()+2*60000).toISOString(),createdAt:new Date().toISOString(),delegateToIA:true,iaCompleted:false};}
      if(esKeywordCalif(body)&&!ld[tenant][idx].keywordAlertSent){
        ld[tenant][idx].keywordAlertSent=true;
        ld[tenant][idx].intentSignal='BLUE';
        ld[tenant][idx].notes=Array.isArray(ld[tenant][idx].notes)?ld[tenant][idx].notes:[];
        try{
          const histSnipWH=ld[tenant][idx].chatHistory.slice(-10).map(m=>(m.role==='user'?'Cliente':'Asesor')+': '+m.content).join('\n');
          const resCompWH=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.4,max_tokens:200,messages:[{role:'system',content:'Eres un asistente comercial de automotora. Con el historial de chat y las notas del vendedor, redacta un BRIEFING narrativo de maximo 3 lineas: (1) [Nombre] consulta por [auto especifico]. (2) [Que dijo sobre financiamiento, retoma, fecha o acuerdo]. (3) Sugerencia: [accion concreta para el vendedor ahora]. Espanol directo, sin emojis, sin titulos, solo el parrafo.'},{role:'user',content:'NOMBRE: '+ld[tenant][idx].name+'\nHISTORIAL:\n'+histSnipWH}]});
          const resumenIAWH=(resCompWH.choices?.[0]?.message?.content||'').trim()||'Interés en crédito/retoma detectado.';
          ld[tenant][idx].ai_summary=resumenIAWH;
          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Reasignado: '+ld[tenant][idx].name+'. Resumen IA: '+resumenIAWH+' — Entra al CRM.').catch(()=>{});
        }catch(eIAWH){
          console.error('[Resumen-Error /webhook]', eIAWH);
          ld[tenant][idx].notes.push({content:'🧠 Cliente mencionó crédito/retoma/seguro. (OpenAI falló: '+eIAWH.message+')',author:'Resumen IA',ts:Date.now()});
          if(assignedUserWH?.phone)sendWA(assignedUserWH.phone,'✅ Lead Asignado: '+ld[tenant][idx].name+'. Revisa la bitácora del CRM.').catch(()=>{});
        }
      }
      await sendWA(from,p.reply);
    }
    ld[tenant][idx].lastInteraction=new Date().toISOString();ld[tenant][idx].alertLevel=calcAlert(ld[tenant][idx]);
    await write(F.leads,ld);
  }catch(e){console.error('Webhook:',e);}
});

// ── NUEVO: endpoint para actualizar inventario desde el navegador ──
app.post('/api/inventory/push', async (req, res) => {
  if(req.headers['x-push-key'] !== (process.env.PUSH_KEY||'rmg2025push')) return res.status(401).json({error:'key invalida'});
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Array vacio' });
    const pSign = String.fromCharCode(36);
    const dataStr = items.map(i =>
      '- ' + i.model + (i.year ? ' ' + i.year : '') + (i.km ? ' | ' + i.km : '') +
      ' | ' + pSign + (i.price ? parseInt(i.price).toLocaleString('es-CL') : 'consultar') +
      (i.link ? ' | ' + i.link : '')
    ).join('\n');
    scrapeCache = { ts: Date.now(), data: dataStr, items };
    await tWrite(F.inventory, req.tenant, items);
    console.log('[INV-PUSH] ' + items.length + ' autos actualizados por admin');
    res.json({ ok: true, count: items.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/inventory/scraper',auth('admin','vendedor'),async(req,res)=>{
  let dbInv = await tRead(F.inventory,req.tenant);
  if(!Array.isArray(dbInv)) dbInv = [];
  const webItems = (scrapeCache.items && scrapeCache.items.length) ? scrapeCache.items : [];
  const finalInv = webItems.length > 0 ? webItems : dbInv;
  if (webItems.length > 0) {
    try { await tWrite(F.inventory, req.tenant, webItems); } catch(e) { console.error('[INV-SYNC]', e.message); }
  }
  res.json({ts:scrapeCache.ts, raw:scrapeCache.data||'', structured: finalInv});
});
setInterval(async()=>{
  for(const t of TENANTS){
    try{
      const leads=await tRead(F.leads,t);let changed=false;
      for(const lead of leads){
        if(FINAL_ST.has(lead.status))continue;
        const na=lead.nextAction;
        if(!na||!na.date||!na.text||na.iaCompleted===true)continue;
        if(new Date(na.date)>new Date())continue;
        try{
          const histSnip=(lead.chatHistory||[]).slice(-10).map(m=>(m.role==='user'?'Cliente':m.role==='agent'?'Vendedor':'IA')+': '+m.content).join('\n');
          const comp=await openai.chat.completions.create({model:'gpt-4o-mini',temperature:0.6,max_tokens:160,messages:[{role:'user',content:'Eres asesor de ventas. Redacta mensaje breve de seguimiento en español chileno para WhatsApp (max 3 oraciones, emoji). Instrucción: "'+na.text+'". Historial:\n'+histSnip}]});
          const iaMsg=(comp.choices?.[0]?.message?.content||'').trim();
          if(!iaMsg)continue;
          const phone=(lead.phone||'').replace(/\D/g,'');
          if(phone)await sendWA(phone,iaMsg).catch(()=>{});
          lead.chatHistory=lead.chatHistory||[];
          lead.chatHistory.push({role:'ia_proactiva',content:iaMsg,ts:Date.now(),agentName:'IA Proactiva'});
          na.iaCompleted=true;na.iaCompletedAt=new Date().toISOString();
          lead.lastInteraction=new Date().toISOString();changed=true;
          console.log('[IA-Proactiva] Enviado a '+lead.name);
        }catch(eP){console.error('[IA-Proactiva]',lead.name,eP.message);}
      }
      if(changed)await tWrite(F.leads,t,leads);
    }catch(eT){console.error('[IA-Proactiva-cron]',eT.message);}
  }
},60000);

// ════════════════════════════════════════════════════════════════════════════
// CRON Sprint 3 — Alertas SLA Riesgo (20m) + Retargeting Post-Link (2m)
// Corre cada 30 segundos. Cada lead lleva flags para evitar repeticion.
// ════════════════════════════════════════════════════════════════════════════
setInterval(async () => {
  for (const t of TENANTS) {
    try {
      const leads = await tRead(F.leads, t);
      const users = await tRead(F.users, t);
      let changed = false;

      for (const lead of leads) {
        if (FINAL_ST.has(lead.status)) continue;

        // ─── TAREA 1: Alerta SLA riesgo a los 20 min sin atencion ──────────
        if (lead.status === 'Nuevo' && !lead.reassigned && !lead.riskAlertSent) {
          const ref = lead.lastClientTs || lead.lastInteraction;
          if (ref) {
            const minsSinAtencion = (Date.now() - new Date(ref).getTime()) / 60000;
            if (minsSinAtencion >= 20 && minsSinAtencion < 30) {
              const assigned = users.find(u => u.username === lead.assignedTo)
                            || RMG_VENDORS.find(v => v.username === lead.assignedTo);
              if (assigned && assigned.phone) {
                const msg = '🚨 ALERTA: El lead [' + lead.name + '] lleva 20 min sin atención. '
                          + 'Te quedan 10 min antes de que el sistema lo reasigne.';
                sendWA(assigned.phone, msg).catch(() => {});
                console.log('[SLA-Risk] Alerta 20m enviada a', assigned.username, 'por lead', lead.name);
              }
              lead.riskAlertSent = true;
              changed = true;
            }
          }
        }

        // ─── TAREA 2: Retargeting Post-Link a los 2 min sin respuesta ──────
        if (lead.botActive === true && !lead.followUpSent && Array.isArray(lead.chatHistory) && lead.chatHistory.length) {
          // Buscar el ULTIMO mensaje del bot que contiene rmgautos.cl
          let lastLinkTs = null;
          for (let i = lead.chatHistory.length - 1; i >= 0; i--) {
            const m = lead.chatHistory[i];
            if ((m.role === 'bot' || m.role === 'ia_proactiva') && m.content && m.content.indexOf('rmgautos.cl') !== -1) {
              lastLinkTs = m.ts || null;
              break;
            }
            if (m.role === 'user') break; // si el ultimo es del user, no hay link sin respuesta
          }
          if (lastLinkTs) {
            const last = lead.chatHistory[lead.chatHistory.length - 1];
            const isLastFromBot = last.role === 'bot' || last.role === 'ia_proactiva';
            const minsDesdeLink = (Date.now() - lastLinkTs) / 60000;
            if (isLastFromBot && minsDesdeLink >= 2) {
              const phone = (lead.phone || '').replace(/\D/g, '');
              if (phone) {
                const followUp = '¿Pudiste ver la ficha en el enlace? 👀 Fíjate en el equipamiento, ¡es lo que más preguntan! ¿Qué te pareció?';
                sendWA(phone, followUp).catch(() => {});
                lead.chatHistory.push({ role: 'ia_proactiva', content: followUp, ts: Date.now(), agentName: 'Retargeting Bot' });
                lead.lastInteraction = new Date().toISOString();
                lead.followUpSent = true;
                changed = true;
                console.log('[Retargeting] Follow-up enviado a', lead.name);
              }
            }
          }
        }
      }

      if (changed) await tWrite(F.leads, t, leads);
    } catch (e) {
      console.error('[Sprint3-Cron]', t, e.message);
    }
  }
}, 30000);

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
setInterval(async()=>{for(const t of TENANTS){try{await applySlaRules(t);}catch(e){console.error('SLA',t,e.message);}}},60000);

// ── SPRINT 4: Tasación Request ──────────────────────────────────────────────
app.post('/api/tasacion/request', async (req, res) => {
  try {
    const { leadId, tenant = 'default' } = req.body;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    const ti = lead.tradeIn || {};
    const texto = `📋 SOLICITUD DE TASACIÓN:\nLead: ${lead.name}\n` +
      `Vehículo en retoma: ${ti.make || '?'} ${ti.model || '?'} ${ti.year || '?'}\n` +
      `Color: ${ti.color || '?'}\nPor favor evaluar y registrar oferta en el CRM.`;

    for (const staff of STAFF_TASACION) {
      await sendWA(staff.phone, texto);
    }
    res.json({ ok: true, notified: STAFF_TASACION.length });
  } catch (err) {
    console.error('/api/tasacion/request error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ── SPRINT 4: Tasación Offer ─────────────────────────────────────────────────
app.post('/api/tasacion/offer', async (req, res) => {
  try {
    const { leadId, offerAmount, tenant = 'default' } = req.body;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    if (!lead.tradeIn) lead.tradeIn = { make:'', model:'', year:'', color:'', status:'Pendiente', offer:0 };
    lead.tradeIn.offer = Number(offerAmount);
    lead.tradeIn.status = 'Evaluado';

    await tWrite(F.leads, tenant, leads);

    const fmt = new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(lead.tradeIn.offer);
    if (lead.assignedTo) {
      const users = await tRead(F.users, tenant, []);
      const vendedor = users.find(u => u.name === lead.assignedTo || u.id === lead.assignedTo);
      if (vendedor && vendedor.phone) {
        const msg = `✅ TASACIÓN LISTA\nLead: ${lead.name}\n` +
          `Retoma: ${lead.tradeIn.make} ${lead.tradeIn.model} ${lead.tradeIn.year}\n` +
          `Oferta taller: ${fmt}\nYa puedes cerrar la venta.`;
        await sendWA(vendedor.phone, msg);
      }
    }
    res.json({ ok: true, offer: lead.tradeIn.offer, status: lead.tradeIn.status });
  } catch (err) {
    console.error('/api/tasacion/offer error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ── SPRINT 4: PATCH tradeIn fields ──────────────────────────────────────────
app.patch('/api/leads/:id/tradein', async (req, res) => {
  try {
    const { tenant = 'default' } = req.query;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    if (!lead.tradeIn) lead.tradeIn = { make:'', model:'', year:'', color:'', status:'Pendiente', offer:0 };
    const { make, model, year, color } = req.body;
    if (make  !== undefined) lead.tradeIn.make  = make;
    if (model !== undefined) lead.tradeIn.model = model;
    if (year  !== undefined) lead.tradeIn.year  = year;
    if (color !== undefined) lead.tradeIn.color = color;

    await tWrite(F.leads, tenant, leads);
    res.json({ ok: true, tradeIn: lead.tradeIn });
  } catch (err) {
    console.error('/api/leads/:id/tradein PATCH error:', err);
    res.status(500).json({ error: err.message });
  }
});



app.listen(PORT,()=>{console.log(`🚀 FunnelOS :${PORT} | SLA_GREEN=${SLA_GREEN} SLA_REASSIGN=${SLA_REASSIGN} SLA_YELLOW=${SLA_YELLOW}`);seed().catch(console.error);});

// --- PARCHE: AUTO-RESETEO DE CLAVES ---
setTimeout(async () => {
  try {
    for (let t of TENANTS) {
      let usrs = await tRead(F.users, t);
      if (usrs && Array.isArray(usrs)) {
        usrs.forEach(u => u.password = 'demo');
        await tWrite(F.users, t, usrs);
        console.log('✅ Claves reseteadas a "demo".');
      }
    }
  } catch(e) { console.log('Error en parche', e); }
}, 3000);

// --- PARCHE: MIGRAR LEADS A VENDEDORES REALES ---
setTimeout(async () => {
  try {
    let leads = await tRead(F.leads, 'demo_automotora');
    let changed = false;
    if (leads && Array.isArray(leads)) {
      leads.forEach(l => {
        if (l.assignedTo === 'vendedor1') { l.assignedTo = 'daniela'; changed = true; }
        if (l.assignedTo === 'vendedor2') { l.assignedTo = 'carlos'; changed = true; }
      });
      if (changed) {
        await tWrite(F.leads, 'demo_automotora', leads);
        console.log('✅ Leads asignados a Daniela y Carlos.');
      }
    }
  } catch(e) { console.log('Error en parche migración', e); }
}, 4000);
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
  if (scrapeCache.items && scrapeCache.items.length && (now - scrapeCache.ts) < 30 * 60 * 1000) return scrapeCache.data;
  const pSign = String.fromCharCode(36);
  const base = 'https://rmgautos.cl';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const MARCAS = /Toyota|Peugeot|Kia|Volkswagen|Ford|Chevrolet|Hyundai|Nissan|Suzuki|Mazda|Honda|Mitsubishi|Jeep|Land Rover|BMW|Mercedes|Audi|Subaru|Volvo|Chery|MG|BAIC|Renault|Opel|Ram|Ssangyong|Karry|Alfa Romeo|Changan|Citroen|Fiat|Seat|Skoda|Haval|Geely|BYD/gi;

  function cleanStr(s) {
    return (s||'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#0*39;/g,"'").replace(/&[a-z]{1,6};/g,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  }
  function parsePrice(s) {
    const m = (s||'').match(/(\d{1,3})[.,](\d{3})[.,](\d{3})/);
    if (m) return parseInt(m[1]+m[2]+m[3]);
    const m2 = (s||'').match(/(\d{2,3})[.,](\d{3})\b/);
    if (m2) { const v = parseInt(m2[1]+m2[2]); return v >= 500 ? v*1000 : 0; }
    return 0;
  }
  function parseKm(s) {
    const m = (s||'').match(/(\d{1,3})[.,](\d{3})\s*(?:km|kms|kil)/i);
    if (m) return (parseInt(m[1])*1000+parseInt(m[2])).toLocaleString('es-CL')+' km';
    const m2 = (s||'').match(/\b(\d{4,6})\s*(?:km|kms)/i);
    if (m2) return parseInt(m2[1]).toLocaleString('es-CL')+' km';
    return '';
  }
  function parseYear(s) {
    const m = (s||'').match(/\b(201[0-9]|202[0-5])\b/);
    return m ? m[1] : '';
  }
  function isJunk(item) {
    if (!item || !item.model || item.model.length < 3) return true;
    if (/feed|rss|wp-|sitemap|page|categor|shop|cart|tag\b/i.test(item.model)) return true;
    if (item.price === 0 && !item.km) return true;
    return false;
  }
  function slugParse(href) {
    return (href||'').replace(/.*\/usados\//,'').replace(/\/$/,'').replace(/-/g,' ').trim();
  }
  function makeLine(i) {
    return '- '+i.model+(i.year?' '+i.year:'')+(i.km?' | '+i.km:'')+
      ' | '+pSign+(i.price ? i.price.toLocaleString('es-CL') : 'consultar')+
      (i.link?' | '+i.link:'');
  }

  const items = [];

  try {
    // ESTRATEGIA 1: WP REST API productos
    try {
      const wpR = await fetch(base+'/wp-json/wp/v2/product?per_page=100&status=publish&_fields=title,link,slug,excerpt,meta', {
        signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA }
      });
      if (wpR.ok) {
        const posts = await wpR.json();
        if (Array.isArray(posts) && posts.length > 0) {
          for (const p of posts) {
            const title = cleanStr(p.title?.rendered||'');
            const marcaM = title.match(MARCAS);
            if (!marcaM) continue;
            const body = cleanStr(p.excerpt?.rendered||'');
            const price = parsePrice(body) || parsePrice(JSON.stringify(p.meta||{}));
            const item = {
              id: 'WEB-'+items.length, brand: marcaM[0],
              model: title, year: parseYear(title+' '+body) ? parseInt(parseYear(title+' '+body)) : null,
              price: price, km: parseKm(body), stock: 1,
              link: p.link||'', highlights: parseKm(body)||'Ver ficha en rmgautos.cl'
            };
            if (title.length > 2 && !(/feed|rss|page/i.test(title))) items.push(item);
          }
        }
      }
    } catch(_) {}

    // ESTRATEGIA 2: HTML con links /product/
    if (items.length === 0) {
      const res = await fetch(RMG_SCRAPE_URL, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'es-CL,es;q=0.9' }
      });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const html = await res.text();

      let zone = html
        .replace(/<head[\s\S]*?<\/head>/i, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '');

      const seen = new Set();
      const conocemeRE = /href=["']((?:https?:\/\/rmgautos\.cl)?\/product\/[^"'#?]{3,80}\/?)"[^>]*>\s*(?:CON[OÓ]CEME|VER|DETALLE)/gi;
      let lm;
      while ((lm = conocemeRE.exec(zone)) !== null && items.length < 60) {
        const href = lm[1].startsWith('http') ? lm[1] : base+lm[1];
        if (seen.has(href)) continue;
        seen.add(href);
        const ctx = zone.slice(Math.max(0, lm.index - 4000), lm.index + 50);
        const seg = ctx.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
        const marcaM = seg.match(MARCAS);
        if (!marcaM) continue;
        const marca = marcaM[0].toUpperCase();
        const precio = parsePrice(seg);
        const anno = parseYear(seg);
        const kmRE = /\b(\d{1,3}[.,]\d{3})\b/g;
        let km = '';
        let kmMatch;
        while ((kmMatch = kmRE.exec(seg)) !== null) {
          const val = parseInt(kmMatch[1].replace(/[.,]/g,''));
          if (val > 500 && val < 999999 && val.toString() !== anno) { km = val.toLocaleString('es-CL')+' km'; break; }
        }
        const h6M = ctx.match(/<h6[^>]*>([^<]{2,40})<\/h6>/i);
        const modeloRaw = h6M ? cleanStr(h6M[1]) : '';
        const h2s = [...ctx.matchAll(/<h2[^>]*>([^<]{2,60})<\/h2>/gi)];
        let version = '';
        for (const hm of h2s) {
          const t = cleanStr(hm[1]);
          if (!t.match(MARCAS) && !parsePrice(t) && !parseYear(t) && t !== '|' && t.length > 2) { version = t; break; }
        }
        const fuelM = seg.match(/\b(GASOLINA|BENCINA|DIESEL|DI[EÉ]SEL|EL[EÉ]CTRICO|H[IÍ]BRIDO|GAS)\b/i);
        const fuel = fuelM ? fuelM[1] : '';
        const isVendido = /VENDIDO/i.test(seg);
        const modelo = [marca, modeloRaw, version].filter(Boolean).join(' ').trim();
        const item = {
          id: 'WEB-'+items.length, brand: marca,
          model: modelo.length > 2 ? modelo : marca,
          year: anno ? parseInt(anno) : null,
          price: isVendido ? 0 : precio, km: km, stock: isVendido ? 0 : 1, link: href,
          highlights: [fuel, km, anno, isVendido ? 'VENDIDO' : ''].filter(Boolean).join(' | ')
        };
        if (item.model.length < 2 || /feed|rss|wp-|sitemap|categor/i.test(item.model)) continue;
        items.push(item);
      }

      // Fallback: cualquier link /product/
      if (items.length === 0) {
        const prodRE = /href=["']((?:https?:\/\/rmgautos\.cl)?\/product\/[^"'#?]{3,80}\/?)["']/gi;
        while ((lm = prodRE.exec(zone)) !== null && items.length < 60) {
          const href = lm[1].startsWith('http') ? lm[1] : base+lm[1];
          if (seen.has(href)) continue;
          seen.add(href);
          const ctx = zone.slice(Math.max(0, lm.index-100), lm.index+3000);
          const seg = ctx.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
          const marcaM = seg.match(MARCAS);
          if (!marcaM) continue;
          const marca = marcaM[0];
          const anno = parseYear(seg);
          const precio = parsePrice(seg);
          const kmM = seg.match(/\b(\d{1,3}[.,]\d{3})\b/);
          const km = kmM ? parseInt(kmM[1].replace(/[.,]/g,'')) > 500 ? parseInt(kmM[1].replace(/[.,]/g,'')).toLocaleString('es-CL')+' km' : '' : '';
          const h6M = ctx.match(/<h6[^>]*>([^<]{2,40})<\/h6>/i);
          const modelo = marca + (h6M ? ' '+cleanStr(h6M[1]) : '') + (anno ? ' '+anno : '');
          if (!modelo || modelo.length < 2 || /feed|rss|sitemap/i.test(modelo)) continue;
          items.push({ id:'WEB-'+items.length, brand:marca, model:modelo, year:anno?parseInt(anno):null, price:precio, km:km, stock:1, link:href, highlights:km||'Ver en rmgautos.cl' });
        }
      }

      if (items.length === 0) throw new Error('0 autos extraidos del HTML');
    }

    const unique = [...new Map(items.map(it => [it.link||it.model, it])).values()];
    const dataStr = unique.map(i =>
      '- '+i.model+(i.year?' '+i.year:'')+(i.km?' | '+i.km:'')+
      ' | '+(i.stock===0?'VENDIDO':pSign+(i.price?i.price.toLocaleString('es-CL'):'consultar'))+
      (i.link?' | '+i.link:'')
    ).join('\n');
    scrapeCache = { ts: now, data: dataStr, items: unique };
    console.log('[RMG-Scraper] '+unique.length+' autos capturados');
    return scrapeCache.data;

  } catch(e) {
    console.warn('[RMG-Scraper] Error:', e.message);
    return scrapeCache.data || '';
  }
}
setInterval(async()=>{try{await scrapeRMG();}catch(e){}}, 30*60*1000);
scrapeRMG().catch(()=>{});

function invStr(inv){if(!Array.isArray(inv)||!inv.length)return'(sin inventario)';return inv.map(i=>`- [${i.id}] ${i.brand||''} ${i.model}${i.year?' '+i.year:''} | Stock:${i.stock} | $${(i.price||0).toLocaleString('es-CL')}${i.fuel?'|'+i.fuel:''}${i.highlights?'|'+i.highlights:''}`).join('\n');}

// ── Prompt camaleónico: nombre del asesor asignado ─────────
function marcelaSys(biz, invS, notes, assignedName) {
  const nombreIA = assignedName || 'Marcela';
  biz = biz || 'RMG Autos';
  const notesBlock = notes && notes.length
    ? `\nNOTAS INTERNAS (úsalas para personalizar):\n${notes.slice(-5).map(n => `- ${n.author}: ${n.content}`).join('\n')}`
    : '';
  const inv = (invS && invS !== '(sin inventario)') ? invS : '(inventario no disponible temporalmente)';
  return `Eres ${nombreIA}, asesor/a de ventas de ${biz} 🚗
Tu nombre es ${nombreIA}. Preséntate siempre con ese nombre. Eres cálido/a, empático/a y profesional. Hablas en español chileno con frases cortas y emojis naturales.

FLUJO CONSULTIVO OBLIGATORIO — sigue este orden SIN saltarte pasos:
PASO 1 — VERIFICAR STOCK: Si el cliente menciona un auto, búscalo en el INVENTARIO. Si existe, confirma disponibilidad y da precio. Si no, dile que lo consultas.
PASO 2 — MÉTODO DE PAGO: Pregunta amablemente: ¿Piensa pagar al crédito o al contado?
PASO 3 — RETOMA: Pregunta si tiene auto para entregar en parte de pago.
  - Si el auto de retoma es anterior a 2012: NO lo descartes. Di que "el ejecutivo en sucursal lo tasa al momento de la visita".
PASO 4 — VISITA: Solo DESPUÉS de los pasos anteriores, si el cliente propone fecha, confírmala con entusiasmo.

INVENTARIO DISPONIBLE:
${inv}${notesBlock}

REGLAS ESTRICTAS:
1. NUNCA pidas test drive ni visita en el primer mensaje. Primero indaga.
2. NUNCA inventes precios ni modelos fuera del inventario.
3. Precios en CLP con puntos (ej: $11.490.000).
4. Máximo 3 oraciones por respuesta. Termina siempre con UNA sola pregunta.
5. Fuera de horario 09:00-20:00: propón "mañana a las 09:00".
6. Si el cliente da datos de crédito/retoma, di que le conectarás con un ejecutivo.

RESPONDE SOLO JSON (sin markdown):
{"reply":"<texto>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota>","schedule_detected":true|false,"schedule_text":"<hora si aplica>"}`;
}

function parseJ(raw){if(!raw)return null;const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a===-1||b===-1)return null;try{return JSON.parse(raw.slice(a,b+1));}catch{return null;}}
function fueraH(txt){const m=(txt||'').match(/(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|hrs?|h)?/i);if(!m)return false;let h=parseInt(m[1],10);const mer=(m[3]||'').toLowerCase();if(mer==='pm'&&h<12)h+=12;if(mer==='am'&&h===12)h=0;return h<9||h>=20;}

async function marcela(tenant, history, msg, notes, assignedName) {
  try {
    const cfg = (await read(F.config))[tenant] || {};
    let invS = scrapeCache.data || await scrapeRMG();
    if (!invS) invS = '';
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: marcelaSys(cfg.businessName || 'RMG Autos', invS, notes || [], assignedName) },
        ...history.slice(-14).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
        { role: 'user', content: msg }
      ].flat()
    });
    let p = parseJ(completion.choices?.[0]?.message?.content || '');
    if (!p) p = { reply: '¡Perdona! Algo falló 😅 ¿Me repites?', intent_signal: 'NONE', intent_reason: 'fallback', schedule_detected: false, schedule_text: '' };
    if (p.schedule_detected && fueraH(p.schedule_text)) { p.reply += '\n\n(Nuestro horario es 09:00-20:00 ⏰ ¿Te acomoda mañana a las 09:00?)'; p.intent_signal = 'YELLOW'; }
    return p;
  } catch(e) {
    console.error('Marcela:', e.message);
    return { reply: 'Tuve un problemita técnico 😅 ¿Puedes repetir?', intent_signal: 'NONE', intent_reason: 'error', schedule_detected: false, schedule_text: '' };
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
      const ref=lead.lastClientTs||lead.lastInteraction;
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
  if(!bot.demo_automotora)bot.demo_automotora={greeting:'¡Hola! Soy Marcela de Automotora Andes 🚗✨ ¿Qué auto estás buscando?'};
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
    if(message.trim().toLowerCase()==='/reset'){leads[idx].chatHistory=[];leads[idx].intentSignal='NONE';leads[idx].keywordAlertSent=false;leads[idx].notes=(leads[idx].notes||[]).concat({content:'🔄 Historial reseteado por comando',author:'Sistema',ts:Date.now()});await tWrite(F.leads,tenant,leads);return res.json({reply:'🔄 Memoria borrada. ¡Empecemos de cero! 🚗',status:leads[idx].status});}
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
      if(body.trim().toLowerCase()==='/reset'){ld[tenant][idx].chatHistory=[];ld[tenant][idx].intentSignal='NONE';ld[tenant][idx].keywordAlertSent=false;ld[tenant][idx].notes=(ld[tenant][idx].notes||[]).concat({content:'🔄 Historial reseteado por comando',author:'Sistema',ts:Date.now()});await tWrite(F.leads,tenant,ld[tenant]);await sendWA(from,'🔄 Memoria borrada. ¡Empecemos de cero! 🚗');return;}
      const allUsersWH=await tRead(F.users,tenant);
      const assignedUserWH=allUsersWH.find(u=>u.username===ld[tenant][idx].assignedTo)||RMG_VENDORS.find(v=>v.username===ld[tenant][idx].assignedTo);
      const assignedNameWH=assignedUserWH?.name||null;
      const p=await marcela(tenant,ld[tenant][idx].chatHistory.slice(0,-1),body,ld[tenant][idx].notes,assignedNameWH);
      ld[tenant][idx].chatHistory.push({role:'bot',content:p.reply,ts:Date.now()});applySignal(ld[tenant][idx],p);
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
app.post('/api/inventory/push', auth('admin'), async (req, res) => {
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
  res.json({ts:scrapeCache.ts, raw:scrapeCache.data||'', structured: finalInv});
});
setInterval(async()=>{
  for(const t of TENANTS){
    try{
      const leads=await tRead(F.leads,t);let changed=false;
      for(const lead of leads){
        if(FINAL_ST.has(lead.status))continue;
        const na=lead.nextAction;
        if(!na||!na.date||!na.delegateToIA||na.iaCompleted)continue;
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
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
setInterval(async()=>{for(const t of TENANTS){try{await applySlaRules(t);}catch(e){console.error('SLA',t,e.message);}}},60000);
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
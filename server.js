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
  if (scrapeCache.items && scrapeCache.items.length > 5 && (now - scrapeCache.ts) < 30 * 60 * 1000) return scrapeCache.data;
  
  const base = 'https://rmgautos.cl';
  // ATACAMOS LA PORTADA: Aquí los autos están precargados y no bloqueados por JS
  const urlsToTry = [base + '/', base + '/usados/', base + '/shop/'];
  const items = [];
  const pSign = String.fromCharCode(36);
  const MARCAS_RE = /Toyota|Peugeot|Kia|Volkswagen|Ford|Chevrolet|Hyundai|Nissan|Suzuki|Mazda|Honda|Mitsubishi|Jeep|Land Rover|BMW|Mercedes|Audi|Subaru|Volvo|Chery|MG|BAIC|Renault|Opel|Ram|Ssangyong|Karry|Alfa Romeo|Changan|Citroen|Fiat|Seat|Skoda|Haval|Geely|BYD/gi;

  for (const url of urlsToTry) {
    if (items.length > 5) break; 
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' }
      });
      if (!r.ok) continue;
      const html = await r.text();
      
      const linkRegex = /href=["']((?:https?:\/\/rmgautos\.cl)?\/product\/[^"'#?]+)[\/"']/gi;
      let match;
      const seenLinks = new Set();
      
      while ((match = linkRegex.exec(html)) !== null) {
        let link = match[1];
        if (!link.startsWith('http')) link = base + link;
        if (seenLinks.has(link)) continue;
        seenLinks.add(link);
        
        // Extraemos 2000 caracteres antes del botón CONÓCEME para agarrar toda la tarjeta
        const ctx = html.slice(Math.max(0, match.index - 2000), match.index + 500);
        const cleanText = ctx.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        
        const brandM = cleanText.match(MARCAS_RE);
        if (!brandM) continue;
        const brand = brandM[0].toUpperCase();
        
        const priceM = cleanText.match(/Cr[eé]dito.*?\$?\s*(\d{1,3}(?:\.\d{3}){1,2})/i) 
                    || cleanText.match(/Lista.*?\$?\s*(\d{1,3}(?:\.\d{3}){1,2})/i)
                    || cleanText.match(/\$\s*(\d{1,3}(?:\.\d{3}){1,2})/);
        const price = priceM ? parseInt(priceM[1].replace(/\./g, '')) : 0;
        if (price < 1000000) continue; 
        
        const yearM = cleanText.match(/\b(201[0-9]|202[0-5])\b/);
        const year = yearM ? parseInt(yearM[1]) : null;
        if (!year) continue; 
        
        const kmM = cleanText.match(/\b(\d{1,3}\.\d{3})\b/g);
        let km = '';
        if (kmM) {
          for (let k of kmM) {
            let val = parseInt(k.replace(/\./g, ''));
            if (val > 100 && val < 999999 && val !== year && val !== price) {
              km = val.toLocaleString('es-CL') + ' km';
              break;
            }
          }
        }
        
        const fuelM = cleanText.match(/(GASOLINA|DIESEL|DI[EÉ]SEL|HYBRIDO|H[IÍ]BRIDO|EL[EÉ]CTRICO)/i);
        const fuel = fuelM ? fuelM[1].toUpperCase().replace('HYBRIDO', 'HÍBRIDO') : '';
        
        const transM = cleanText.match(/(AUTOM[AÁ]TICO|MEC[AÁ]NICO)/i);
        const trans = transM ? transM[1].toUpperCase() : '';
        
        let model = brand;
        const modelRegex = new RegExp(brand + '[^a-z0-9]*([a-z0-9\s\-\|\.]+?)\s*' + year, 'i');
        const modelMatch = cleanText.match(modelRegex);
        if (modelMatch && modelMatch[1].length > 1) {
            model = brand + ' ' + modelMatch[1].replace(/\|/g, '-').replace(/\s{2,}/g, ' ').trim();
        } else {
            const slug = link.split('/product/')[1].replace(/\/$/, '').replace(/-/g, ' ').toUpperCase();
            model = brand + ' ' + slug;
        }
        
        const isVendido = /VENDIDO/i.test(cleanText);
        
        items.push({
          id: 'WEB-' + items.length,
          brand,
          model: model.replace(/\s+/g, ' ').trim(),
          year,
          price: isVendido ? 0 : price,
          km,
          stock: isVendido ? 0 : 1,
          link,
          highlights: [fuel, trans, km, isVendido ? 'VENDIDO' : ''].filter(Boolean).join(' | ')
        });
      }
    } catch (e) {
      console.error('[RMG-Fetch Error]', url, e.message);
    }
  }

  if (items.length === 0) throw new Error('0 autos capturados de todas las rutas');

  const unique = [...new Map(items.map(it => [it.link, it])).values()];
  const dataStr = unique.map(i => 
    '- ' + i.model + (i.year ? ' ' + i.year : '') + 
    ' | ' + (i.highlights || 'Ver detalles') + 
    ' | ' + (i.stock === 0 ? 'VENDIDO' : pSign + (i.price ? i.price.toLocaleString('es-CL') : 'consultar')) + 
    ' | Link: ' + i.link
  ).join('\n');
  
  scrapeCache = { ts: now, data: dataStr, items: unique };
  console.log('[RMG-Scraper] REAL: ' + unique.length + ' autos capturados en vivo desde RMG');
  return dataStr;
}
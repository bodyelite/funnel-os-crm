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
  if (scrapeCache.items && scrapeCache.items.length && (now - scrapeCache.ts) < 30 * 60 * 1000) return scrapeCache.data;
  const pSign = String.fromCharCode(36);
  const base = 'https://rmgautos.cl';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const MARCAS = /Toyota|Peugeot|Kia|Volkswagen|Ford|Chevrolet|Hyundai|Nissan|Suzuki|Mazda|Honda|Mitsubishi|Jeep|Land Rover|BMW|Mercedes|Audi|Subaru|Volvo|Chery|MG|BAIC|Renault|Opel|Ram|Ssangyong|Karry|Alfa Romeo|Changan|Citroen|Fiat|Seat|Skoda|Haval|Geely|BYD/gi;

  function clean(s) {
    return (s||'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').replace(/&[a-z]+;/g,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  }
  function parsePrice(s) {
    const m = (s||'').match(/(\d{1,3})[.,](\d{3})[.,](\d{3})/);
    if (m) return parseInt(m[1]+m[2]+m[3]);
    return 0;
  }
  function parseKm(s) {
    const m = (s||'').match(/\b(\d{1,3})[.,](\d{3})\b/);
    if (m) { const v = parseInt(m[1])*1000+parseInt(m[2]); if (v > 100 && v < 1000000) return v.toLocaleString('es-CL')+' km'; }
    const m2 = (s||'').match(/\b(\d{4,6})\b/);
    if (m2) { const v = parseInt(m2[1]); if (v > 100 && v < 1000000) return v.toLocaleString('es-CL')+' km'; }
    return '';
  }
  function parseYear(s) {
    const m = (s||'').match(/\b(201[0-9]|202[0-5])\b/);
    return m ? m[1] : '';
  }

  const items = [];

  try {
    try {
      const wpR = await fetch(base+'/wp-json/wp/v2/product?per_page=100&status=publish&_fields=title,link,slug,excerpt,meta', {
        signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA }
      });
      if (wpR.ok) {
        const posts = await wpR.json();
        if (Array.isArray(posts) && posts.length > 0) {
          for (const p of posts) {
            const title = clean(p.title?.rendered||'');
            const marcaM = title.match(MARCAS);
            if (!marcaM) continue;
            const body = clean(p.excerpt?.rendered||'');
            const price = parsePrice(body) || parsePrice(JSON.stringify(p.meta||{}));
            const item = {
              id: 'WEB-'+items.length, brand: marcaM[0],
              model: title, year: parseYear(title+' '+body) ? parseInt(parseYear(title+' '+body)) : null,
              price: price, km: parseKm(body), stock: 1,
              link: p.link||'', highlights: parseKm(body)||'Ver ficha en rmgautos.cl'
            };
            if (title.length > 2 && !(/feed|rss|page/i.test(title))) items.push(item);
          }
          if (items.length > 0) {
            console.log('[RMG-Scraper] '+items.length+' autos via WP REST API');
          }
        }
      }
    } catch(_) {}

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
          if (val > 500 && val < 999999 && val.toString() !== anno) {
            km = val.toLocaleString('es-CL')+' km';
            break;
          }
        }

        const h2M = ctx.match(new RegExp('<h[26][^>]*>\\s*('+marca+'[^<]{0,5})<', 'i'));
        const h6M = ctx.match(/<h6[^>]*>([^<]{2,40})<\/h6>/i);
        const modeloRaw = h6M ? clean(h6M[1]) : '';

        const h2s = [...ctx.matchAll(/<h2[^>]*>([^<]{2,60})<\/h2>/gi)];
        let version = '';
        for (const hm of h2s) {
          const t = clean(hm[1]);
          if (!t.match(MARCAS) && !parsePrice(t) && !parseYear(t) && t !== '|' && t.length > 2) {
            version = t; break;
          }
        }

        const fuelM = seg.match(/\b(GASOLINA|BENCINA|DIESEL|DI[EÉ]SEL|EL[EÉ]CTRICO|H[IÍ]BRIDO|GAS|NAFTA)\b/i);
        const fuel = fuelM ? fuelM[1] : '';

        const isVendido = /VENDIDO/i.test(seg);
        const modelo = [marca, modeloRaw, version].filter(Boolean).join(' ').trim();

        const item = {
          id: 'WEB-'+items.length,
          brand: marca,
          model: modelo.length > 2 ? modelo : marca,
          year: anno ? parseInt(anno) : null,
          price: isVendido ? 0 : precio,
          km: km,
          stock: isVendido ? 0 : 1,
          link: href,
          highlights: [fuel, km, anno, isVendido ? 'VENDIDO' : ''].filter(Boolean).join(' | ')
        };

        if (item.model.length < 2) continue;
        if (/feed|rss|wp-|sitemap|categor/i.test(item.model)) continue;
        items.push(item);
      }

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
          const modelo = marca + (h6M ? ' '+clean(h6M[1]) : '') + (anno ? ' '+anno : '');
          if (!modelo || modelo.length < 2 || /feed|rss|sitemap/i.test(modelo)) continue;
          items.push({ id:'WEB-'+items.length, brand:marca, model:modelo, year:anno?parseInt(anno):null, price:precio, km:km, stock:1, link:href, highlights:km||'Ver en rmgautos.cl' });
        }
      }

      if (items.length === 0) throw new Error('0 autos extraídos del HTML');
      console.log('[RMG-Scraper] '+items.length+' autos via HTML parsing (/product/ links)');
    }

    const unique = [...new Map(items.map(it => [it.link||it.model, it])).values()];
    const dataStr = unique.map(i =>
      '- '+i.model+(i.year?' '+i.year:'')+(i.km?' | '+i.km:'')+
      ' | '+(i.stock===0?'VENDIDO':pSign+(i.price?i.price.toLocaleString('es-CL'):'consultar'))+
      (i.link?' | '+i.link:'')
    ).join('\n');

    scrapeCache = { ts: now, data: dataStr, items: unique };
    return scrapeCache.data;

  } catch(e) {
    console.warn('[RMG-Scraper] Error:', e.message);
    return scrapeCache.data || '';
  }
}
require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const puppeteer = require('puppeteer');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const fs = require('fs');
const path = require('path');

const {
  IMAP_USER, IMAP_PASS, IMAP_HOST, IMAP_PORT,
  CHILEAUTOS_USER, CHILEAUTOS_PASS,
  WA_TOKEN, WA_PHONE_ID,
  CHILEAUTOS_ACTIVO,
  CRM_API_URL, CRM_API_TOKEN
} = process.env;

const MEMORY_FILE = path.join(__dirname, '.processed_leads.json');

function loadMemory() {
  try { return new Set(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function saveMemory(set) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify([...set].slice(-500)), 'utf8');
}
const processed = loadMemory();
function alreadyProcessed(id) { return processed.has(id); }
function markProcessed(id) { processed.add(id); saveMemory(processed); }

function extractLeadUrl(html, text) {
  const patterns = [
    /href="(https?:\/\/[^"]*chileautos\.cl[^"]*lead[^"]*)"/i,
    /href="(https?:\/\/[^"]*chileautos\.cl[^"]*enquir[^"]*)"/i,
    /href="(https?:\/\/[^"]*chileautos\.cl[^"]*contact[^"]*)"/i,
    /href="(https?:\/\/[^"]*chileautos\.cl[^"]{10,})"/i,
  ];
  for (const re of patterns) {
    const m = (html || '').match(re);
    if (m) return m[1];
  }
  const found = (text || '').match(/(https?:\/\/[^\s]*chileautos\.cl[^\s]*)/gi);
  return found?.length ? found[0] : null;
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function scrapeChileautos(leadUrl) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--ignore-certificate-errors'
    ]
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (['image', 'font'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  try {
    let loginOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto('https://www.chileautos.cl/account/login', { waitUntil: 'networkidle2', timeout: 30000 });
        loginOk = true;
        break;
      } catch (e) {
        console.error(`[SCRAPER] Login goto intento ${attempt}/3:`, e.message);
        if (attempt < 3) await delay(2000);
      }
    }
    if (!loginOk) throw new Error('No se pudo cargar la página de login después de 3 intentos');

    await page.type('#UserName', CHILEAUTOS_USER, { delay: 60 });
    await page.type('#Password', CHILEAUTOS_PASS, { delay: 60 });
    await Promise.all([
      page.click('button[type=submit]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
    ]);

    let leadOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(leadUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        leadOk = true;
        break;
      } catch (e) {
        console.error(`[SCRAPER] Lead goto intento ${attempt}/3:`, e.message);
        if (attempt < 3) await delay(2000);
      }
    }
    if (!leadOk) throw new Error('No se pudo cargar la URL del lead después de 3 intentos');

    await page.waitForSelector('body', { timeout: 10000 });

    const data = await page.evaluate(() => {
      const getText = (sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.innerText?.trim()) return el.innerText.trim();
        }
        return null;
      };
      const nombre = getText(['.buyer-name','.contact-name','[data-testid="buyer-name"]','h2.name','.lead-name','.enquiry-name']);
      const rawPhone = getText(['.buyer-phone','.contact-phone','[data-testid="buyer-phone"]','.phone-number','a[href^="tel:"]','.phone']);
      const vehiculo = getText(['.vehicle-title','.car-title','[data-testid="vehicle-title"]','h1.title','.listing-title','.enquiry-vehicle']);
      return { nombre, phone: rawPhone ? rawPhone.replace(/\D/g, '') : null, vehiculo };
    });

    await browser.close();
    return data;
  } catch (e) {
    await browser.close();
    throw e;
  }
}

async function sendWhatsApp(phone, nombre, vehiculo) {
  const clean = phone.replace(/\D/g, '');
  const to = clean.startsWith('56') ? clean : '56' + clean;
  const res = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'contacto_chileautos_v1',
        language: { code: 'es' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: nombre }, { type: 'text', text: vehiculo }] }]
      }
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error('WA error: ' + JSON.stringify(json));
  console.log(`[WA] ✅ Enviado a ${to} | ${nombre} | ${vehiculo}`);
  return json;
}

async function crearLeadCRM(nombre, telefono, vehiculo) {
  if (!CRM_API_URL) { console.log('[CRM] CRM_API_URL no definida, omitiendo.'); return; }
  const clean = telefono.replace(/\D/g, '');
  const phone = clean.startsWith('56') ? clean : '56' + clean;
  try {
    const res = await fetch(`${CRM_API_URL}/api/leads/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CRM_API_TOKEN ? { Authorization: `Bearer ${CRM_API_TOKEN}` } : {})
      },
      body: JSON.stringify({
        tenant: 'demo_automotora',
        name: nombre,
        phone: '+' + phone,
        source: 'Chileautos',
        interest: vehiculo,
        status: 'esperando_respuesta_chileautos',
        botActive: false
      })
    });
    const json = await res.json();
    console.log(`[CRM] ✅ Lead en sala de espera: ${nombre} | +${phone}`);
    return json;
  } catch (e) {
    console.error('[CRM] ❌ Error:', e.message);
  }
}

async function processEmail(mail) {
  if (CHILEAUTOS_ACTIVO !== 'true') return;
  const messageId = mail.messageId || null;
  if (!messageId) { console.log('[SKIP] Sin Message-ID'); return; }
  if (alreadyProcessed(messageId)) { console.log('[SKIP] Ya procesado:', messageId); return; }

  const from = (mail.from?.text || '').toLowerCase();
  const html = mail.html || '';
  const text = mail.text || '';
  const isChileautos = from.includes('chileautos') || html.toLowerCase().includes('chileautos') || text.toLowerCase().includes('chileautos');
  if (!isChileautos) { return; }

  const leadUrl = extractLeadUrl(html, text);
  if (!leadUrl) { console.log('[SKIP] Sin URL de lead'); markProcessed(messageId); return; }
  console.log('[URL]', leadUrl);

  let nombre, phone, vehiculo;
  try {
    ({ nombre, phone, vehiculo } = await scrapeChileautos(leadUrl));
  } catch (e) {
    console.error('[SCRAPER] Error:', e.message);
    return;
  }

  if (!phone) { console.log('[SKIP] Sin teléfono'); markProcessed(messageId); return; }
  nombre = nombre || 'Cliente';
  vehiculo = vehiculo || 'vehículo consultado';

  await crearLeadCRM(nombre, phone, vehiculo);
  await sendWhatsApp(phone, nombre, vehiculo);
  markProcessed(messageId);
  console.log('[OK] Procesado:', messageId);
}

function fetchEmails(imap, n = 10) {
  imap.search(['ALL'], (err, results) => {
    if (err || !results?.length) return;
    const f = imap.fetch(results.slice(-n), { bodies: '' });
    f.on('message', (msg) => {
      msg.on('body', (stream) => {
        simpleParser(stream, async (err, parsed) => {
          if (err) return;
          try { await processEmail(parsed); } catch (e) { console.error('[ERROR]', e.message); }
        });
      });
    });
  });
}

function startImap() {
  const imap = new Imap({
    user: IMAP_USER, password: IMAP_PASS,
    host: IMAP_HOST || 'imap.gmail.com',
    port: parseInt(IMAP_PORT || '993'),
    tls: true, tlsOptions: { rejectUnauthorized: false }
  });
  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err) => {
      if (err) throw err;
      console.log('[IMAP] ✅ Conectado:', IMAP_USER);
      fetchEmails(imap, 10);
      imap.on('mail', () => { console.log('[IMAP] 📨 Nuevo correo'); fetchEmails(imap, 5); });
    });
  });
  imap.once('error', (e) => { console.error('[IMAP]', e.message); setTimeout(startImap, 10000); });
  imap.once('end', () => { console.log('[IMAP] Desconectado. Reconectando...'); setTimeout(startImap, 5000); });
  imap.connect();
}

(async () => {
  console.log('[RPA] Interceptor v3 | ACTIVO:', CHILEAUTOS_ACTIVO);
  const { execSync } = require('child_process');
  try {
    execSync('npm list imap mailparser puppeteer node-fetch dotenv 2>/dev/null || npm install imap mailparser puppeteer node-fetch dotenv --save', { stdio: 'inherit' });
  } catch (e) {}
  startImap();
})();

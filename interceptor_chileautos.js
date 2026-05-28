require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const fs = require('fs');
const path = require('path');

const {
  IMAP_USER, IMAP_PASS, IMAP_HOST, IMAP_PORT,
  CRM_API_URL,
  CHILEAUTOS_ACTIVO
} = process.env;

const MEMORY_FILE = path.join(__dirname, '.processed_leads.json');
const CP_BASE = 'https://cp.chileautos.cl/crm/timeline';

function loadMemory() {
  try { return new Set(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function saveMemory(set) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify([...set].slice(-1000)), 'utf8');
}
const processed = loadMemory();

function extractLeadLink(html, text) {
  const combined = (html || '') + ' ' + (text || '');
  const patterns = [
    /https?:\/\/[^\s"']+cp\.chileautos\.cl\/crm\/timeline\/[^\s"'<>]+/gi,
    /https?:\/\/[^\s"']+awstrack\.me\/[^\s"'<>]+cp\.chileautos[^\s"'<>]+/gi,
    /href="([^"]*chileautos[^"]*timeline[^"]*)"/gi,
  ];
  for (const re of patterns) {
    const m = combined.match(re);
    if (m && m[0]) {
      let url = m[0].replace(/^href="/, '').replace(/"$/, '');
      // Resolver redirects de awstrack
      if (url.includes('awstrack')) {
        const decoded = decodeURIComponent(url.replace(/^.*L0\//, '').split('/')[0]);
        if (decoded.includes('chileautos')) url = decoded;
      }
      return url;
    }
  }
  return null;
}

function extractIds(url) {
  // URL formato: .../crm/timeline/{leadId}/{dealerId}
  const m = url.match(/timeline\/([a-f0-9-]{36})\/([a-f0-9-]{36})/i);
  if (m) return { leadId: m[1], dealerId: m[2] };
  // Intentar extraer solo leadId
  const m2 = url.match(/timeline\/([a-f0-9-]{36})/i);
  if (m2) return { leadId: m2[1], dealerId: null };
  return null;
}

async function crearLeadFunnelOS(leadId, dealerId, panelUrl) {
  if (!CRM_API_URL) { console.log('[CRM] CRM_API_URL no definida'); return; }
  try {
    const res = await fetch(`${CRM_API_URL}/api/leads/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant: 'demo_automotora',
        name: 'Lead Chileautos',
        phone: 'Pendiente',
        source: 'Chileautos',
        interest: '🔗 ' + panelUrl,
        status: 'esperando_respuesta_chileautos',
        botActive: false,
        externalId: leadId,
        notes: [{
          content: `📋 Nuevo lead de Chileautos.\n🔗 Ver ficha en panel: ${panelUrl}\n📌 Lead ID: ${leadId}${dealerId ? '\n🏢 Dealer ID: ' + dealerId : ''}`,
          author: 'Bot Chileautos',
          ts: Date.now()
        }]
      })
    });
    const json = await res.json();
    if (json.skipped) {
      console.log('[CRM] Lead ya existía, omitido.');
    } else {
      console.log(`[CRM] ✅ Lead creado en Sala de Espera | ID: ${json.leadId}`);
    }
    return json;
  } catch (e) {
    console.error('[CRM] ❌ Error:', e.message);
  }
}

async function processEmail(mail) {
  if (CHILEAUTOS_ACTIVO !== 'true') return;

  const messageId = mail.messageId || null;
  if (!messageId) { console.log('[SKIP] Sin Message-ID'); return; }
  if (processed.has(messageId)) { console.log('[SKIP] Ya procesado:', messageId); return; }

  const from = (mail.from?.text || '').toLowerCase();
  const subject = (mail.subject || '').toLowerCase();
  const html = mail.html || '';
  const text = mail.text || '';

  const isChileautos = from.includes('chileautos') ||
    subject.includes('chileautos') ||
    html.toLowerCase().includes('chileautos') ||
    text.toLowerCase().includes('chileautos');

  if (!isChileautos) return;

  console.log('[CORREO] Chileautos detectado:', mail.subject);

  const rawLink = extractLeadLink(html, text);
  if (!rawLink) {
    console.log('[SKIP] No se encontró link de panel');
    processed.add(messageId);
    saveMemory(processed);
    return;
  }

  console.log('[LINK]', rawLink);

  const ids = extractIds(rawLink);
  if (!ids) {
    console.log('[SKIP] No se pudieron extraer IDs del link');
    processed.add(messageId);
    saveMemory(processed);
    return;
  }

  console.log('[IDs] Lead:', ids.leadId, '| Dealer:', ids.dealerId);

  // Construir URL limpia al panel
  const panelUrl = ids.dealerId
    ? `${CP_BASE}/${ids.leadId}/${ids.dealerId}`
    : rawLink;

  await crearLeadFunnelOS(ids.leadId, ids.dealerId, panelUrl);

  processed.add(messageId);
  saveMemory(processed);
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
          try { await processEmail(parsed); }
          catch (e) { console.error('[ERROR]', e.message); }
        });
      });
    });
  });
}

function startImap() {
  const imap = new Imap({
    user: IMAP_USER,
    password: IMAP_PASS,
    host: IMAP_HOST || 'imap.gmail.com',
    port: parseInt(IMAP_PORT || '993'),
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  });

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err) => {
      if (err) throw err;
      console.log('[IMAP] ✅ Conectado:', IMAP_USER);
      fetchEmails(imap, 20);
      imap.on('mail', () => {
        console.log('[IMAP] 📨 Nuevo correo recibido');
        fetchEmails(imap, 5);
      });
    });
  });

  imap.once('error', (e) => {
    console.error('[IMAP ERROR]', e.message);
    setTimeout(startImap, 10000);
  });

  imap.once('end', () => {
    console.log('[IMAP] Desconectado. Reconectando en 5s...');
    setTimeout(startImap, 5000);
  });

  imap.connect();
}

(async () => {
  console.log('════════════════════════════════════════');
  console.log('  Chileautos → FunnelOS | Sala de Espera');
  console.log('  ACTIVO:', CHILEAUTOS_ACTIVO);
  console.log('  CRM:', CRM_API_URL);
  console.log('════════════════════════════════════════');

  const { execSync } = require('child_process');
  try {
    execSync(
      'npm list imap mailparser node-fetch dotenv 2>/dev/null || npm install imap mailparser node-fetch dotenv --save',
      { stdio: 'inherit' }
    );
  } catch (e) {}

  startImap();
})();

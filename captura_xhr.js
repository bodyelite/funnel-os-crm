require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const stealth   = require('puppeteer-extra-plugin-stealth');
const fs        = require('fs');
puppeteer.use(stealth());

const COOKIE = process.env.CA_COOKIE;
const LEAD_URL = 'https://cp.chileautos.cl/crm/timeline/9507a35a-5a42-4eba-91d9-62baf62f5285/9e51c7be-434d-3739-a658-f7babf8fcd8e';

(async () => {
  const cookieObjects = COOKIE.split('; ').map(pair => {
    const eqIdx = pair.indexOf('=');
    return { name: pair.slice(0,eqIdx).trim(), value: pair.slice(eqIdx+1), domain: 'cp.chileautos.cl', path: '/', secure: true };
  });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const calls = [];

  page.on('response', async (res) => {
    const url  = res.url();
    const ct   = res.headers()['content-type'] || '';
    if (!url.includes('chileautos') && !url.includes('carsales')) return;
    if (url.includes('.js') || url.includes('.css') || url.includes('.png')) return;
    try {
      const body = await res.text();
      const isJson = ct.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[');
      if (isJson && body.length > 10) {
        calls.push({ url, status: res.status(), body: body.slice(0,3000) });
        console.log(`[${res.status()}] ${url}`);
        console.log(body.slice(0,400), '\n');
      }
    } catch(e) {}
  });

  await page.setCookie(...cookieObjects);
  console.log('Navegando al lead...');
  try {
    await page.goto(LEAD_URL, { waitUntil: 'networkidle0', timeout: 45000 });
  } catch(e) {
    console.log('Timeout (normal en SPA), continuando...');
  }
  await new Promise(r => setTimeout(r, 10000));
  fs.writeFileSync('xhr_calls.json', JSON.stringify(calls, null, 2));
  console.log('\n✅ XHR calls capturadas:', calls.length);
  await browser.close();
})().catch(e => console.error('ERROR:', e.message));

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(stealth());

const COOKIE = `csncidcf=20270E32-790D-415F-A13E-98F1CBCC4A0A; CSN.SSO.Portal.Authentication.Cookie=P4bulEc-KyP4pNawe-6i6bARgXG0tn_BkFtBThodZXlnjS7q0UEkZ-P0QVYeEZaXoG9Xp1DDoI3bJ0O0XWrsitz4PKiNnPr2oO444I6uXzDdfZZIcbjvk8ye1nrvKZGGCCLvGVOCX4WQAtYED2MmL8J8CNTLY06CBsHJXGN-QNwp_WC8TVC8xQZUnsVkrgEnr1h3iHk3n2CO2pb2J2U9N_rIKIlZIHAk8R-1MrQUpMwgg6f7nVj37iPUPXtJQU_6Nfe_KuA4CGRYswfJ3fei6pvLQzV8Nmhv0eB5FhvDIhugHYhjO2vfs6vLJIXqi5dYDLA-3j3_Wpk2prj1KVZ5OdUH9ZxXFmFXXzCELJ7DJOXy82DfDXa9G2rnLCwccvHs4dGNDdc53pmf9cg6jF39zSX6rCYbpsxYkjCnhekKkMUmqg7o9edmxcNrFz9d3Jj0Lcvg6fODs8ZtsbAp-hUnyH_wmECzXNQ7MAcE95DV6WT0NCI-REI0tZVc16qVcbAKUIkKeZnEHube4FE8EQz_Dhp4nVYvnHQmvo4KcVABPElvj4GcmRsTzGVPVEnElhXcvnpeFBiuzozaM9NZDUmJouFlb2ap8U2mLbF9s4E8EvycEXq3ZVIWQSKtyOsbvK0EhB7JdO5SULWoa8G_W6_YhF90bRdpreWVivFD1XKIYohX-qJo_tfh0LKbu5gQHSu-ii9yk2kA6jWTP60Dmhgr5WHKLwDRx_fMWlD4BkZiPot3AykNHrh5rLPcXqlIVWpnO9-GBLBWRH9i9pT205xA_WLPhlp5nuinRHMUWnO6N8ftUg626DrPfRsNdokXPCvFLCw1JwKCL-mHDqLCeACzvrlRWUG4qHU5_wqcYrGl37HP9yb9ORbxRhjClqiFKjF1HLNVHDodd9_0-b19OOzoLxt4BcIjEJyGi-ubR4NTGRCjGq9I98uiIBL0CvA1RjFi1dcVzpUEju3rD079Vag4CdaKBhDIG8cMdXdvMi1fG123okr3FM--Y7sKWDgnalZmHnUE4pojK11Y8w_kVsIgiIAMQqlSNsHMW88g54JgDBpCtwSfQ__irIK7d2ivE9MHPjpO-EiELDPn1hrIKwkVLCIx4SU4586VMwV6FGOW5PAw_DYEDhPU28B6nyXsmY7TAhC2mJRCxeahRuEthlgNJ817xzdAQhDKQKlsyO4467zmm79QkiOd55UcV13Lvao1uTaBOhzwJMKht2B9ySnYtzGzCxzFVOk0MEmCahrMnUwbQfMCuzEJelAVZclmfeXRkSu1PcFQrFUdGLLeCTC7VFJ4ehVIWwNj4bIMweqLPGhi1EDsa-rLxiqrpnm2B3GrWZ_-xXWLESk-nuqGz49LUtZoFzAk5AX39NAJGnXZHQDKKQw01ft9ElkM6PVZf9dzOJ2GmiMGJkWxJcJMsqSL_p_GH_k1jfhfoKIR3s_GLgSRQ3mGfGAxnxItvDcCiUasEtCPw6_g9rzSX_FeJKBG1ms_u0e4deDkvPJp7GfhkTDDLcWQkjqKbz-LeXVxDCLge_xXGf1zq0rWIr-YSPaOsTlXbgNCpkcdLqlHxsRRX-Q; datadome=QVpuMQeOVqYIHaeruU9a23jOAdhS1oKOS_xsEZ5xxWJ8kaTuNSaoFodJTuYxJW5759vSW8InxkM6OFQ4hrdon6SENJQlc6fwLrNcwS2p9EJ1Imf0dRysDy0bwuF8kYH2`;

const LEAD_URL = 'https://cp.chileautos.cl/crm/timeline/9507a35a-5a42-4eba-91d9-62baf62f5285/9e51c7be-434d-3739-a658-f7babf8fcd8e';

(async () => {
  const cookieObjects = COOKIE.split('; ').map(pair => {
    const eqIdx = pair.indexOf('=');
    return { name: pair.slice(0, eqIdx).trim(), value: pair.slice(eqIdx+1), domain: 'cp.chileautos.cl', path: '/', secure: true };
  });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const apiCalls = [];

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('application/json') && url.includes('chileautos')) {
      try {
        const body = await response.text();
        apiCalls.push({ url, status: response.status(), body: body.slice(0, 2000) });
        console.log(`[API] ${response.status()} ${url}`);
        console.log(`      ${body.slice(0, 300)}\n`);
      } catch(e) {}
    }
  });

  await page.setCookie(...cookieObjects);
  await page.goto(LEAD_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 8000));

  fs.writeFileSync('api_calls.json', JSON.stringify(apiCalls, null, 2));
  console.log('\n✅ Total API calls capturadas:', apiCalls.length);
  console.log('Guardadas en api_calls.json');

  await browser.close();
})().catch(e => console.error('ERROR:', e.message));

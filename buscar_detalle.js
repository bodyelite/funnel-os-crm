require('dotenv').config();
const fetch = (...a) => import('node-fetch').then(({default: f}) => f(...a));

const COOKIE = process.env.CA_COOKIE;
const DEALER = '9e51c7be-434d-3739-a658-f7babf8fcd8e';
const LEAD   = '9507a35a-5a42-4eba-91d9-62baf62f5285';

const h = {
  'cookie': COOKIE,
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'es-CL,es;q=0.9',
  'x-requested-with': 'XMLHttpRequest',
  'referer': `https://cp.chileautos.cl/crm/timeline/${LEAD}/${DEALER}`
};

const endpoints = [
  `https://cp.chileautos.cl/xapi/customers/pendingLeads/${DEALER}?groupName=notAttended&detail=true`,
  `https://cp.chileautos.cl/xapi/customers/pendingLeads/${DEALER}?groupName=notAttended&page=0&size=10`,
  `https://cp.chileautos.cl/xapi/customers/pendingLeads/${DEALER}/notAttended`,
  `https://cp.chileautos.cl/xapi/customers/pendingLeads/${DEALER}/notAttended?page=0&size=10`,
  `https://cp.chileautos.cl/xapi/customers/leads/${DEALER}?groupName=notAttended`,
  `https://cp.chileautos.cl/xapi/customers/leads/${DEALER}`,
  `https://cp.chileautos.cl/xapi/customers/crm/${DEALER}/leads`,
  `https://cp.chileautos.cl/xapi/customers/crm/${DEALER}/leads?page=0&size=10`,
  `https://cp.chileautos.cl/xapi/crm/${DEALER}/pendingLeads`,
  `https://cp.chileautos.cl/xapi/crm/${DEALER}/pendingLeads?groupName=notAttended`,
  `https://cp.chileautos.cl/xapi/crm/pendingLeads/${DEALER}`,
  `https://cp.chileautos.cl/xapi/crm/pendingLeads/${DEALER}?groupName=notAttended&detail=true`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/crm/leads`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/crm/leads?status=notAttended`,
  `https://cp.chileautos.cl/xapi/v2/customers/pendingLeads/${DEALER}`,
  `https://cp.chileautos.cl/xapi/v2/customers/pendingLeads/${DEALER}?groupName=notAttended`,
  `https://cp.chileautos.cl/xapi/v2/crm/leads/${DEALER}`,
  `https://cp.chileautos.cl/xapi/v2/customers/${DEALER}/leads`,
];

(async () => {
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: h });
      const text = await r.text();
      const isJson = !text.includes('<!doctype') && (text.startsWith('{') || text.startsWith('['));
      if (r.status === 200 && isJson) {
        console.log(`\n✅ [200] ${url}`);
        console.log(text.slice(0, 1000));
      } else {
        process.stdout.write(`[${r.status}] `);
      }
    } catch(e) {
      process.stdout.write(`[ERR] `);
    }
  }
  console.log('\nDone');
})();

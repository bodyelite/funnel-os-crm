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
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/leads?page=0&size=10`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/leads?page=1&size=10`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/lead/${LEAD}`,
  `https://cp.chileautos.cl/xapi/customers/lead/${LEAD}`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/timeline/${LEAD}`,
  `https://cp.chileautos.cl/xapi/customers/timeline/${LEAD}/${DEALER}`,
  `https://cp.chileautos.cl/xapi/crm/customers/${DEALER}/lead/${LEAD}`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/conversations?leadId=${LEAD}`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/leads/notAttended`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/leads/notAttended?page=0&size=10`,
  `https://cp.chileautos.cl/xapi/customers/pendingLeads/${DEALER}?groupName=notAttended`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/pendingLeads/detail`,
  `https://cp.chileautos.cl/xapi/crm/leads?dealer=${DEALER}`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/enquiries`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/enquiries?page=0&size=10`,
];

(async () => {
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: h });
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      const isJson = ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[');
      if (r.status === 200 && isJson && !text.includes('<!doctype')) {
        console.log(`\n✅ [${r.status}] ${url}`);
        console.log(text.slice(0, 800));
      } else {
        console.log(`[${r.status}] ${url}`);
      }
    } catch(e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
})();

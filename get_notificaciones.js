require('dotenv').config();
const fetch = (...a) => import('node-fetch').then(({default:f})=>f(...a));

const COOKIE = process.env.CA_COOKIE;
const DEALER = '9e51c7be-434d-3739-a658-f7babf8fcd8e';

const h = {
  'cookie': COOKIE,
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'application/json',
  'referer': 'https://cp.chileautos.cl/crm'
};

const endpoints = [
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/notifications`,
  `https://cp.chileautos.cl/xapi/customers/notifications/${DEALER}`,
  `https://cp.chileautos.cl/xapi/notifications/${DEALER}`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/alerts`,
  `https://cp.chileautos.cl/xapi/v2/customers/${DEALER}/notifications`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/leads/recent`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/contacts`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/contacts?page=0&size=10`,
  `https://cp.chileautos.cl/xapi/customers/contacts/${DEALER}`,
  `https://cp.chileautos.cl/xapi/customers/${DEALER}/conversations?page=0&size=5`,
];

(async()=>{
  for(const url of endpoints){
    try{
      const r = await fetch(url,{headers:h});
      const text = await r.text();
      const isJson = !text.includes('<!doctype') && (text.startsWith('{') || text.startsWith('['));
      if(r.status===200 && isJson){
        console.log(`\n✅ [200] ${url}`);
        console.log(text.slice(0,1000));
      } else {
        process.stdout.write(`[${r.status}] `);
      }
    }catch(e){ process.stdout.write(`[ERR] `); }
  }
  console.log('\nDone');
})();

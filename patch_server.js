const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server.js');
let code = fs.readFileSync(filePath, 'utf8');

let count = 0;

// Fix 1: form.getHeaders() en send-media
const f1 = `headers: { Authorization: 'Bearer ' + token },\n      body: form`;
const r1 = `headers: { ...form.getHeaders(), Authorization: 'Bearer ' + token },\n      body: form`;
if (code.includes(f1)) { code = code.replace(f1, r1); count++; console.log('✅ Fix 1: form.getHeaders()'); }
else console.log('⚠️  Fix 1 no encontrado');

// Fix 2: language es_LA → es + components con params
const f2 = `    const components = [];\n    const lang = req.body.language || 'es_LA';`;
const r2 = `    const components = [];
    if (params && params.length) {
      components.push({
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: String(p) }))
      });
    }
    const lang = req.body.language || 'es';`;
if (code.includes(f2)) { code = code.replace(f2, r2); count++; console.log('✅ Fix 2: language + components'); }
else console.log('⚠️  Fix 2 no encontrado');

fs.writeFileSync(filePath, code, 'utf8');
console.log(`\nListo — ${count} fix(es) aplicados en ${filePath}`);

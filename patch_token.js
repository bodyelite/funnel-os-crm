const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

let count = 0;

// Fix 1: uploadWAMedia
const f1 = `  const token = localStorage.getItem('token');\n  const btn = document.getElementById('waFile').nextElementSibling;`;
const r1 = `  const token = S.token;\n  const btn = document.getElementById('waFile').nextElementSibling;`;
if (html.includes(f1)) { html = html.replace(f1, r1); count++; console.log('✅ Fix 1: uploadWAMedia'); }
else console.log('⚠️  Fix 1 no encontrado (puede que ya esté aplicado)');

// Fix 2: sendContacto4
const f2 = `    const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');`;
const r2 = `    const token = S.token;`;
if (html.includes(f2)) { html = html.replace(f2, r2); count++; console.log('✅ Fix 2: sendContacto4'); }
else console.log('⚠️  Fix 2 no encontrado (puede que ya esté aplicado)');

// Fix 3: enviarPlantillaSaludo3
const f3 = `  const token = localStorage.getItem('token');\n  fetch('/api/leads/' + S.mid + '/send-template', {`;
const r3 = `  const token = S.token;\n  fetch('/api/leads/' + S.mid + '/send-template', {`;
if (html.includes(f3)) { html = html.replace(f3, r3); count++; console.log('✅ Fix 3: enviarPlantillaSaludo3'); }
else console.log('⚠️  Fix 3 no encontrado (puede que ya esté aplicado)');

fs.writeFileSync(filePath, html, 'utf8');
console.log(`\nListo — ${count} fix(es) aplicados en ${filePath}`);

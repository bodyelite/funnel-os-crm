const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');
let n = 0;

// Fix 1: PATCH tradein con auth + todos los campos + nota historial
const F1 = `app.patch('/api/leads/:id/tradein', async (req, res) => {
  try {
    const { tenant = 'default' } = req.query;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id === req.params.id);`;
const R1 = `app.patch('/api/leads/:id/tradein', auth('admin','vendedor'), async (req, res) => {
  try {
    const tenant = req.tenant;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => String(l.id) === String(req.params.id));`;
if(code.includes(F1)){code=code.replace(F1,R1);n++;console.log('✅ Fix 1: PATCH tradein auth');}
else console.log('⚠️ Fix 1 ya aplicado');

// Fix 2: guardar km, plate, version en tradein
const F2 = `    const { make, model, year, color } = req.body;
    if (make  !== undefined) lead.tradeIn.make  = make;
    if (model !== undefined) lead.tradeIn.model = model;
    if (year  !== undefined) lead.tradeIn.year  = year;
    if (color !== undefined) lead.tradeIn.color = color;

    await tWrite(F.leads, tenant, leads);
    res.json({ ok: true, tradeIn: lead.tradeIn });`;
const R2 = `    const { make, model, year, color, plate, km, version } = req.body;
    if (make    !== undefined) lead.tradeIn.make    = make;
    if (model   !== undefined) lead.tradeIn.model   = model;
    if (year    !== undefined) lead.tradeIn.year    = year;
    if (color   !== undefined) lead.tradeIn.color   = color;
    if (plate   !== undefined) lead.tradeIn.plate   = plate;
    if (km      !== undefined) lead.tradeIn.km      = km;
    if (version !== undefined) lead.tradeIn.version = version;
    lead.notes = Array.isArray(lead.notes) ? lead.notes : [];
    lead.notes.push({ content: \`🚗 Datos retoma: \${make||'?'} \${model||'?'} \${year||'?'} | Patente: \${plate||'?'} | Km: \${km||'?'} | Versión: \${version||'?'} | Color: \${color||'?'}\`, author: req.user?.name||'Sistema', ts: Date.now() });
    await tWrite(F.leads, tenant, leads);
    res.json({ ok: true, tradeIn: lead.tradeIn });`;
if(code.includes(F2)){code=code.replace(F2,R2);n++;console.log('✅ Fix 2: campos completos tradein');}
else console.log('⚠️ Fix 2 ya aplicado');

// Fix 3: tasacion/request con auth + tenant correcto + mensaje completo
const F3 = `app.post('/api/tasacion/request', async (req, res) => {
  try {
    const { leadId, tenant = 'demo_automotora' } = req.body;`;
const R3 = `app.post('/api/tasacion/request', auth('admin','vendedor'), async (req, res) => {
  try {
    const tenant = req.tenant;
    const { leadId } = req.body;`;
if(code.includes(F3)){code=code.replace(F3,R3);n++;console.log('✅ Fix 3: tasacion/request auth');}
else console.log('⚠️ Fix 3 ya aplicado');

// Fix 4: mensaje completo en request
const F4 = `    const texto = \`📋 SOLICITUD DE TASACIÓN:\\nLead: \${lead.name}\\nVehículo en retoma: \${ti.make || '?'} \${ti.model || '?'} \${ti.year || '?'}\\nColor/Patente: \${ti.color || '?'}\\nPor favor evaluar y registrar oferta en el CRM.\`;`;
const R4 = `    const texto = \`📋 SOLICITUD DE TASACIÓN\\n👤 Cliente: \${lead.name}\\n📱 Tel: \${lead.phone||'?'}\\n\\n🚗 Vehículo en retoma:\\n• Marca/Modelo: \${ti.make||'?'} \${ti.model||'?'}\\n• Año: \${ti.year||'?'}\\n• Patente: \${ti.plate||'?'}\\n• Color: \${ti.color||'?'}\\n• Km: \${ti.km||'?'}\\n• Versión: \${ti.version||'?'}\\n\\nPor favor evaluar y registrar la oferta en el CRM.\`;`;
if(code.includes(F4)){code=code.replace(F4,R4);n++;console.log('✅ Fix 4: mensaje completo request');}
else console.log('⚠️ Fix 4 ya aplicado');

// Fix 5: tasacion/offer con auth + tenant correcto
const F5 = `app.post('/api/tasacion/offer', async (req, res) => {
  try {
    const { leadId, offerAmount, tenant = 'demo_automotora' } = req.body;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => l.id == leadId);`;
const R5 = `app.post('/api/tasacion/offer', auth('admin'), async (req, res) => {
  try {
    const tenant = req.tenant;
    const { leadId, offerAmount } = req.body;
    const leads = await tRead(F.leads, tenant, []);
    const lead = leads.find(l => String(l.id) == String(leadId));`;
if(code.includes(F5)){code=code.replace(F5,R5);n++;console.log('✅ Fix 5: tasacion/offer auth');}
else console.log('⚠️ Fix 5 ya aplicado');

fs.writeFileSync(file, code, 'utf8');
console.log(`\n✅ ${n} fix(es) aplicados`);

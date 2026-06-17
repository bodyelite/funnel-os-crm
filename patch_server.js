const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');
let count = 0;

// Fix 1: ruta /tmp-media con Content-Type correcto
const F1 = `app.use(express.static(path.join(__dirname,'public')));`;
const R1 = `app.use(express.static(path.join(__dirname,'public')));
app.get('/tmp-media/:name', (req, res) => {
  const fp = require('path').join('/tmp', req.params.name);
  if (!fsSync.existsSync(fp)) return res.status(404).send('Not found');
  const ext = fp.split('.').pop().toLowerCase();
  const mimeMap = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', mp4:'video/mp4', mov:'video/quicktime', pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const mime = mimeMap[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.sendFile(fp);
});`;

if (code.includes(F1) && !code.includes('/tmp-media/:name')) {
  code = code.replace(F1, R1); count++;
  console.log('✅ Fix 1: ruta /tmp-media con Content-Type');
} else console.log('⚠️  Fix 1 ya aplicado');

// Fix 2: URL con extensión real
const F2 = `    // Servir el archivo temporalmente como URL pública
    const tmpName = req.file.filename || path.basename(req.file.path);
    const publicUrl = (process.env.RENDER_EXTERNAL_URL || 'https://body-elite-giftcards.onrender.com') + '/tmp-media/' + tmpName;`;

const R2 = `    // Servir el archivo temporalmente como URL pública
    const tmpName = req.file.filename || path.basename(req.file.path);
    const mimeToExt = {'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','application/pdf':'pdf','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx'};
    const ext = mimeToExt[req.file.mimetype] || 'bin';
    const namedPath = req.file.path + '.' + ext;
    fsSync.renameSync(req.file.path, namedPath);
    req.file.path = namedPath;
    const publicUrl = (process.env.RENDER_EXTERNAL_URL || 'https://body-elite-giftcards.onrender.com') + '/tmp-media/' + tmpName + '.' + ext;`;

if (code.includes(F2)) {
  code = code.replace(F2, R2); count++;
  console.log('✅ Fix 2: URL con extensión real');
} else console.log('⚠️  Fix 2 no encontrado');

fs.writeFileSync(file, code, 'utf8');
console.log(`\nListo — ${count} fix(es) aplicados`);

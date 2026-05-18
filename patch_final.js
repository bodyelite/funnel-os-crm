'use strict';
const fs   = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, 'server.js');
const HTML   =  path.join(__dirname, 'public', 'index.html');

function patch(file, label, oldStr, newStr) {
  let src = fs.readFileSync(file, 'utf8');
  const idx = src.indexOf(oldStr);
  if (idx === -1) {
    console.error('❌  FALLO [' + label + ']: bloque no encontrado en ' + path.basename(file));
    process.exit(1);
  }
  fs.writeFileSync(file, src.slice(0, idx) + newStr + src.slice(idx + oldStr.length), 'utf8');
  console.log('✅  [' + label + ']');
}

1
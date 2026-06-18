const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

// Fix 1: processedMsgIds
const F1 = `const botDebounce = new Map();`;
const R1 = `const botDebounce = new Map();\nconst processedMsgIds = new Set();`;
if(code.includes(F1)&&!code.includes('processedMsgIds')){code=code.replace(F1,R1);console.log('✅ Fix 1: processedMsgIds');}
else console.log('⚠️ Fix 1 ya aplicado');

// Fix 2: deduplicación por msg.id
const F2 = `      if(botDebounce.has(from)) clearTimeout(botDebounce.get(from).timer);
      const acc = botDebounce.get(from) || { messages: [] };
      acc.timer = setTimeout(async () => {
        botDebounce.delete(from);`;
const R2 = `      if(msg?.id && processedMsgIds.has(msg.id)){console.log('[WH-DUP] Duplicado ignorado:',msg.id);return;}
      if(msg?.id){processedMsgIds.add(msg.id);setTimeout(()=>processedMsgIds.delete(msg.id),60000);}
      if(botDebounce.has(from)) clearTimeout(botDebounce.get(from).timer);
      const acc = botDebounce.get(from) || { messages: [] };
      acc.timer = setTimeout(async () => {
        botDebounce.delete(from);`;
if(code.includes(F2)){code=code.replace(F2,R2);console.log('✅ Fix 2: deduplicación msg.id');}
else console.log('⚠️ Fix 2 ya aplicado');

fs.writeFileSync(file, code, 'utf8');
console.log('✅ server.js guardado');

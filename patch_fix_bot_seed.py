# -*- coding: utf-8 -*-
# patch_fix_bot_seed.py
# PROBLEMA: seed() inicializa bot.demo_automotora con solo {greeting},
# sin systemPrompt. En Render /var/data/bot.json ya tiene ese objeto
# incompleto, por lo que la condicion !bot.demo_automotora es false y
# nunca lo sobreescribe — marcela() recibe systemPrompt=undefined → catch.
# SOLUCION: reemplazar la condicion por una que siempre escriba el
# systemPrompt completo desde bot.json (que ya tiene el texto correcto).

import sys, subprocess

SRV = 'server.js'
src = open(SRV, 'r', encoding='utf-8').read()

OLD = (
  "const bot=await read(F.bot);\n"
  "  if(!bot.demo_automotora)bot.demo_automotora={greeting:'\u00a1Hola! Soy Marcela de Automotora Andes \U0001f697\u2728 \u00bfQu\u00e9 auto est\u00e1s buscando?'};\n"
  "  if(!bot.demo_clinica)bot.demo_clinica={greeting:'Hola \U0001f44b Soy la asistente de Cl\u00ednica Vital. \u00bfEn qu\u00e9 te puedo ayudar?'};\n"
  "  await write(F.bot,bot);"
)

NEW = (
  "const bot=await read(F.bot);\n"
  "  if(!bot.demo_automotora||!bot.demo_automotora.systemPrompt){\n"
  "    const _botSrc=await new Promise((res,rej)=>{\n"
  "      try{res(JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'data','bot.json'),'utf8')));}catch(e){res({});}\n"
  "    });\n"
  "    bot.demo_automotora=_botSrc.demo_automotora||{greeting:'\u00a1Hola! Soy Marcela de Automotora Andes \U0001f697\u2728 \u00bfQu\u00e9 auto est\u00e1s buscando?'};\n"
  "  }\n"
  "  if(!bot.demo_clinica)bot.demo_clinica={greeting:'Hola \U0001f44b Soy la asistente de Cl\u00ednica Vital. \u00bfEn qu\u00e9 te puedo ayudar?'};\n"
  "  await write(F.bot,bot);"
)

if OLD not in src:
    print('FALLO — bloque seed/bot no encontrado'); sys.exit(1)

src = src.replace(OLD, NEW, 1)
open(SRV, 'w', encoding='utf-8').write(src)
print('OK [seed bot.demo_automotora siempre escribe systemPrompt]')

r = subprocess.run(['node','--check', SRV], capture_output=True, text=True)
if r.returncode != 0:
    print('ERROR SINTAXIS:\n'+r.stderr); sys.exit(1)
print('Sintaxis OK')
print()
print('git add server.js && git commit -m "fix: seed fuerza systemPrompt desde bot.json en Render" && git push')

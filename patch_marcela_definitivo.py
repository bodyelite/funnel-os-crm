# -*- coding: utf-8 -*-
# patch_marcela_definitivo.py
# CAUSA RAIZ: marcela() llama a OpenAI con response_format json_object.
# OpenAI exige que el prompt contenga la palabra "JSON". Cuando bot.json en
# /var/data esta incompleto (sin systemPrompt) el prompt enviado no contiene
# "JSON" -> OpenAI responde 400 -> cae al catch -> "Tuve un problemita tecnico".
#
# FIX DEFINITIVO:
#   1. Auto-heal: si botCfg.systemPrompt esta vacio, lee data/bot.json del repo
#      y lo persiste en /var/data para futuras llamadas.
#   2. Prompt resiliente: SIEMPRE concatena la instruccion JSON al final del
#      prompt, aunque bot.json este corrupto. OpenAI nunca podra fallar por
#      esta razon.
#   3. Fallback hardcoded: si todo falla, usa un systemPrompt minimo en codigo.
#   4. Logging detallado: catch ahora imprime el stack y el error de OpenAI
#      para que cualquier futuro problema sea diagnosticable en Render logs.

import sys, subprocess

SRV = 'server.js'
src = open(SRV, 'r', encoding='utf-8').read()

s = src.find('async function marcela(tenant, history, msg, notes, assignedName) {')
e = src.find('\nfunction esKeywordCalif(texto)')
if s == -1 or e == -1:
    print('FALLO — anchors no encontrados'); sys.exit(1)

NEW = r"""async function marcela(tenant, history, msg, notes, assignedName) {
  try {
    let invS = scrapeCache.data || await scrapeRMG();
    if (!invS) invS = '';

    let botCfg = await tRead(F.bot, tenant, {});
    if (!botCfg || typeof botCfg !== 'object' || Array.isArray(botCfg) || !botCfg.systemPrompt) {
      try {
        const seedBot = JSON.parse(fsSync.readFileSync(path.join(__dirname, 'data', 'bot.json'), 'utf8'));
        if (seedBot && seedBot[tenant] && seedBot[tenant].systemPrompt) {
          botCfg = Object.assign({}, botCfg, seedBot[tenant]);
          await tWrite(F.bot, tenant, botCfg);
          console.log('[marcela] systemPrompt restaurado desde data/bot.json para', tenant);
        }
      } catch(eSeed) {
        console.error('[marcela] No se pudo cargar data/bot.json:', eSeed.message);
      }
    }

    const baseSysPrompt = (botCfg && botCfg.systemPrompt) || 'Eres Marcela, asesora de ventas de Automotora Andes. Responde de forma calida y profesional en espanol chileno.';
    let sysPromptProcessed = baseSysPrompt.replace(/\{nombreIA\}/g, assignedName || 'Marcela');
    sysPromptProcessed += '\n\nINVENTARIO DISPONIBLE:\n' + (invS || '(sin inventario disponible temporalmente)');
    if (notes && notes.length) {
      sysPromptProcessed += '\nNOTAS INTERNAS:\n' + notes.slice(-5).map(n => '- ' + n.author + ': ' + n.content).join('\n');
    }
    sysPromptProcessed += '\n\nRESPONDE SOLO EN FORMATO JSON (sin markdown, sin texto adicional):\n{"reply":"<texto con emojis>","intent_signal":"NONE"|"BLUE"|"YELLOW","intent_reason":"<nota corta>","schedule_detected":true|false,"schedule_text":"<hora si aplica>"}';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sysPromptProcessed },
        ...history.slice(-14).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
        { role: 'user', content: msg }
      ].flat()
    });
    let p = parseJ(completion.choices?.[0]?.message?.content || '');
    if (!p) p = { reply: '\u00a1Perdona! Algo fall\u00f3 \ud83d\ude05 \u00bfMe repites?', intent_signal: 'NONE', intent_reason: 'fallback', schedule_detected: false, schedule_text: '' };
    if (p.schedule_detected && fueraH(p.schedule_text)) { p.reply += '\n\n(Nuestro horario es 09:30-18:30 \u23f0 \u00bfTe acomoda que te contactemos ma\u00f1ana a las 09:30?)'; p.intent_signal = 'YELLOW'; }
    return p;
  } catch(e) {
    console.error('[Marcela ERROR]', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0,5).join('\n'));
    if (e.response) console.error('[OpenAI status]', e.response.status, e.response.data);
    return { reply: 'Tuve un problemita t\u00e9cnico \ud83d\ude05 \u00bfPuedes repetir?', intent_signal: 'NONE', intent_reason: 'error', schedule_detected: false, schedule_text: '' };
  }
}
"""

src = src[:s] + NEW + src[e:]
open(SRV, 'w', encoding='utf-8').write(src)
print('OK — marcela() blindada')

r = subprocess.run(['node','--check', SRV], capture_output=True, text=True)
if r.returncode != 0:
    print('ERROR SINTAXIS:\n'+r.stderr); sys.exit(1)
print('Sintaxis Node.js OK')
print()
print('git add server.js && git commit -m "fix definitivo: marcela auto-heal + JSON guarantee" && git push')

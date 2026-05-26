# -*- coding: utf-8 -*-
import sys, subprocess

SRV = 'server.js'

src = open(SRV, 'r', encoding='utf-8').read()

# ── P1: eliminar marcelaSys completa ─────────────────────────────────────────
s1 = src.find('function marcelaSys(')
e1 = src.find('\nfunction parseJ(')
if s1 == -1 or e1 == -1:
    print('FALLO [P1] — anchors marcelaSys no encontrados'); sys.exit(1)
src = src[:s1] + src[e1:]
print('OK [P1 marcelaSys eliminada]')

# ── P2: refactorizar marcela() con tRead asíncrono ───────────────────────────
s2 = src.find('async function marcela(tenant, history, msg, notes, assignedName) {')
e2 = src.find('\nfunction esKeywordCalif(texto)')
if s2 == -1 or e2 == -1:
    print('FALLO [P2] — anchors marcela no encontrados'); sys.exit(1)

NEW_MARCELA = (
"async function marcela(tenant, history, msg, notes, assignedName) {\n"
"  try {\n"
"    let invS = scrapeCache.data || await scrapeRMG();\n"
"    if (!invS) invS = '';\n"
"    const botCfg = await tRead(F.bot, tenant, {});\n"
"    const systemPrompt = botCfg.systemPrompt || '';\n"
"    let sysPromptProcessed = systemPrompt.replace(/{nombreIA}/g, assignedName || 'Marcela');\n"
"    sysPromptProcessed += '\\n\\nINVENTARIO DISPONIBLE:\\n' + invS;\n"
"    if (notes && notes.length) {\n"
"      sysPromptProcessed += `\\nNOTAS INTERNAS:\\n${notes.slice(-5).map(n => `- ${n.author}: ${n.content}`).join('\\n')}`;\n"
"    }\n"
"    const completion = await openai.chat.completions.create({\n"
"      model: 'gpt-4o-mini',\n"
"      temperature: 0.5,\n"
"      response_format: { type: 'json_object' },\n"
"      messages: [\n"
"        { role: 'system', content: sysPromptProcessed },\n"
"        ...history.slice(-14).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),\n"
"        { role: 'user', content: msg }\n"
"      ].flat()\n"
"    });\n"
"    let p = parseJ(completion.choices?.[0]?.message?.content || '');\n"
"    if (!p) p = { reply: '\u00a1Perdona! Algo fall\u00f3 \U0001f605 \u00bfMe repites?', intent_signal: 'NONE', intent_reason: 'fallback', schedule_detected: false, schedule_text: '' };\n"
"    if (p.schedule_detected && fueraH(p.schedule_text)) { p.reply += '\\n\\n(Nuestro horario es 09:30-18:30 \u23f0 \u00bfTe acomoda que te contactemos ma\u00f1ana a las 09:30?)'; p.intent_signal = 'YELLOW'; }\n"
"    return p;\n"
"  } catch(e) {\n"
"    console.error('Marcela:', e.message);\n"
"    return { reply: 'Tuve un problemita t\u00e9cnico \U0001f605 \u00bfPuedes repetir?', intent_signal: 'NONE', intent_reason: 'error', schedule_detected: false, schedule_text: '' };\n"
"  }\n"
"}\n"
)

src = src[:s2] + NEW_MARCELA + src[e2:]
print('OK [P2 marcela refactorizada con tRead]')

open(SRV, 'w', encoding='utf-8').write(src)

r = subprocess.run(['node', '--check', SRV], capture_output=True, text=True)
if r.returncode != 0:
    print('ERROR SINTAXIS:\n' + r.stderr); sys.exit(1)
print('Sintaxis OK')
print('\n2/2 OK')
print('git add server.js data/bot.json && git commit -m "refactor: cerebro dinamico asincrono via tRead + bot.json" && git push')

import os
import re

# --- 1. BACKEND SERVER.JS ---
with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# A) Cambiamos "const" por "let" para poder engañar a Marcela
src = re.sub(r'const\s+body\s*=\s*msg\.text\?\.body\|\|msg\.button\?\.text\|\|null;', 'let body=msg.text?.body||msg.button?.text||null;', src)

# B) Reemplazo 100% exacto cortando el texto
start_marker = "// --- MULTIMEDIA HANDLER ---"
end_marker = "// --- FIN MULTIMEDIA HANDLER ---"

if start_marker in src and end_marker in src:
    start_idx = src.find(start_marker)
    end_idx = src.find(end_marker) + len(end_marker)
    
    new_logic = """
    // --- MULTIMEDIA HANDLER V3 ---
    if (msg.type === 'image' || msg.type === 'audio') {
      // Engañamos a Marcela dándole un texto artificial en vez del archivo
      body = msg.type === 'image' ? '[FOTO RECIBIDA] El cliente acaba de enviar una foto o documento. Dile amablemente que la recibiste y que la agregarás a la evaluación.' : '[AUDIO RECIBIDO] El cliente acaba de enviar una nota de voz. Dile que la recibiste y que en un instante le respondes.';
      
      const contactName = val.contacts?.[0]?.profile?.name || 'WhatsApp Lead';
      const tenant = 'demo_automotora';
      const ld = await read(F.leads);
      if (!ld[tenant]) ld[tenant] = [];
      let idx = ld[tenant].findIndex(l => l.phone && l.phone.replace(/\\D/g, '').includes(from.replace(/\\D/g, '')));
      
      if (idx === -1) {
        const assignedObj = await rrNext(tenant) || {username: 'vendedor1'};
        const n = new Date().toISOString();
        ld[tenant].unshift({id: Date.now(), name: contactName, phone: '+' + from, source: 'WhatsApp', status: 'Nuevo', lastInteraction: n, lastClientTs: n, interest: msg.type === 'image' ? '[Foto Recibida]' : '[Audio Recibido]', assignedTo: assignedObj.username, botActive: true, alertLevel: 'none', intentSignal: 'NONE', unread: true, notes: [], chatHistory: [], media: []});
        idx = 0;
      }

      if (!ld[tenant][idx].media) ld[tenant][idx].media = [];
      const mediaId = msg.type === 'image' ? msg.image.id : msg.audio.id;
      ld[tenant][idx].media.push({ type: msg.type, url: mediaId, text: '', ts: Date.now() });
      await tWrite(F.leads, tenant, ld[tenant]);
      
      // ATENCIÓN: Al no poner "return" aquí, dejamos que el código siga hacia la IA
    }
    // --- FIN MULTIMEDIA HANDLER V3 ---
    """
    src = src[:start_idx] + new_logic.strip() + src[end_idx:]
    print("✅ Backend: Webhook reparado. Marcela está lista para responder.")
else:
    print("⚠️ ¡Ojo! No se encontró el bloque multimedia original.")

# C) Inyectar Proxy Meta
proxy = """
// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Sin token WA_TOKEN configurado');
    
    const uRes = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const uData = await uRes.json();
    if (!uData.url) return res.status(404).send('Media no encontrada en Meta');
    
    const mRes = await fetch(uData.url, { headers: { 'Authorization': `Bearer ${token}` } });
    const buffer = await mRes.arrayBuffer();
    res.set('Content-Type', mRes.headers.get('content-type'));
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error en Proxy:', e);
    res.status(500).send('Error interno');
  }
});
"""
if "// --- PROXY DE MEDIA META ---" not in src:
    src = src.replace('app.listen(', proxy + '\napp.listen(')
    print("✅ Backend: Túnel con Meta creado.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)


# --- 2. FRONTEND INDEX.HTML ---
with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Redirigir las URLs para que pasen por nuestro servidor en vez de ir a Meta
html = html.replace(
    "const imgUrl = item.url.startsWith('http') ? item.url : 'https://via.placeholder.com/150?text=Ver+Imagen';",
    "const imgUrl = item.url.startsWith('http') ? item.url : '/api/media/' + item.url;"
)
html = html.replace(
    "const audioUrl = item.url.startsWith('http') ? item.url : '';",
    "const audioUrl = item.url.startsWith('http') ? item.url : '/api/media/' + item.url;"
)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("✅ Frontend: Archivos multimedia enlazados al servidor local.")

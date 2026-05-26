import re

# --- BACKEND SERVER.JS ---
with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Arrancamos de raíz el bloque viejo y metemos el nuevo
old_block_regex = re.compile(r'const body=msg\.text\?\.body.*?// --- FIN MULTIMEDIA HANDLER ---.*?if\(!body\)return;', re.DOTALL)

new_block = """
    let body=msg.text?.body||msg.button?.text||null;

    // --- MULTIMEDIA HANDLER V2 ---
    if (msg.type === 'image' && msg.image) body = '[FOTO RECIBIDA] El cliente acaba de enviar una foto o documento. Dile amablemente que la recibiste y que la agregarás a su ficha para que un tasador la revise.';
    if (msg.type === 'audio' && msg.audio) body = '[AUDIO RECIBIDO] El cliente acaba de enviar una nota de voz. Dile que la recibiste y que en un instante le respondes.';

    if (msg.type === 'image' || msg.type === 'audio') {
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
    }
    // --- FIN MULTIMEDIA HANDLER V2 ---
    if(!body)return;
"""

if old_block_regex.search(src):
    src = old_block_regex.sub(new_block.strip(), src)
    print("✅ Backend: Webhook actualizado a V2 (Marcela ahora responde).")
else:
    print("⚠️ No se encontró el bloque antiguo, inyectando de emergencia...")
    # Solo por si acaso
    src = src.replace("const body=msg.text?.body||msg.button?.text||null;", new_block.strip())

# 2. Inyectamos el Proxy de Meta
proxy = """
// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Sin token WA_TOKEN');
    const uRes = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const uData = await uRes.json();
    if (!uData.url) return res.status(404).send('Media no encontrada');
    const mRes = await fetch(uData.url, { headers: { 'Authorization': `Bearer ${token}` } });
    const buffer = await mRes.arrayBuffer();
    res.set('Content-Type', mRes.headers.get('content-type'));
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error Proxy:', e);
    res.status(500).send('Error interno');
  }
});
"""
if "// --- PROXY DE MEDIA META ---" not in src:
    src = src.replace('app.listen(', proxy + '\napp.listen(')
    print("✅ Backend: Proxy de Meta inyectado.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)


# --- FRONTEND INDEX.HTML ---
with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Actualizamos las URLs para que pasen por el proxy
html = re.sub(r"const imgUrl = item\.url\.startsWith\('http'\) \? item\.url : '[^']+';", "const imgUrl = item.url.startsWith('http') ? item.url : '/api/media/' + item.url;", html)
html = re.sub(r"const audioUrl = item\.url\.startsWith\('http'\) \? item\.url : '[^']*';", "const audioUrl = item.url.startsWith('http') ? item.url : '/api/media/' + item.url;", html)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("✅ Frontend: Enlaces multimedia redirigidos al servidor.")

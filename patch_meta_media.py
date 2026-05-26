import re

# --- BACKEND SERVER.JS ---
with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Cambiamos la constante por let para poder sobreescribir el texto cuando llegue multimedia
src = src.replace("const body=msg.text?.body||msg.button?.text||null;", "let body=msg.text?.body||msg.button?.text||null;")

# 2. Reemplazamos el parche ciego anterior por el que activa a la IA
old_handler = re.compile(r'// --- MULTIMEDIA HANDLER ---.*?// --- FIN MULTIMEDIA HANDLER ---', re.DOTALL)
new_handler = """
    // --- MULTIMEDIA HANDLER ---
    if (msg.type === 'image' && msg.image) body = '[FOTO RECIBIDA]: El cliente acaba de enviar una imagen o documento. Dile amablemente que la recibiste y que la agregarás a la evaluación.';
    if (msg.type === 'audio' && msg.audio) body = '[AUDIO RECIBIDO]: El cliente acaba de enviar una nota de voz. Dile que lo estás escuchando y que en un instante le respondes.';

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
      
      // MÁGIA: No hacemos "return" aquí. Dejamos que el mensaje fluya hacia abajo.
      // Así Marcela recibe la instrucción invisible de la variable 'body' que definimos arriba y te responde.
    }
    // --- FIN MULTIMEDIA HANDLER ---
"""
src = old_handler.sub(new_handler.strip(), src)

# 3. Construimos el puente para descargar el archivo de Meta usando tu WA_TOKEN
proxy = """
// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    
    // Sacamos tu token directo del entorno de Render
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Sin token configurado en Render');
    
    // 1. Le pedimos a Meta la URL real del archivo
    const uRes = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const uData = await uRes.json();
    if (!uData.url) return res.status(404).send('Media no encontrada en Meta');
    
    // 2. Descargamos el binario de los servidores de Meta
    const mRes = await fetch(uData.url, { headers: { 'Authorization': `Bearer ${token}` } });
    const buffer = await mRes.arrayBuffer();
    
    // 3. Lo devolvemos al CRM para que lo muestre
    res.set('Content-Type', mRes.headers.get('content-type'));
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error en Proxy Multimedia:', e);
    res.status(500).send('Error interno');
  }
});
"""
if "// --- PROXY DE MEDIA META ---" not in src:
    src = src.replace('app.listen(', proxy + '\napp.listen(')

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

# --- FRONTEND INDEX.HTML ---
with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Le decimos a las imágenes y audios que pasen por el túnel que acabamos de crear en el backend
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

print("✅ Parche Meta Media aplicado. El bot responde y las fotos se descargarán.")

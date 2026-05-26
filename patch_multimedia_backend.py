import re
import subprocess
import sys

SERVER_FILE = "server.js"

with open(SERVER_FILE, 'r', encoding='utf-8') as f:
    content = f.read()

# Verificamos idempotencia para no duplicar código
if "// --- MULTIMEDIA HANDLER ---" in content:
    print("✅ El Backend ya tiene inyectado el soporte multimedia.")
    sys.exit(0)

# Buscamos la línea destructiva original en el webhook
pattern = r"(const body=msg\.text\?\.body\|\|msg\.button\?\.text\|\|null;)(if\(!body\)return;)"

# Inyectamos la lógica multimedia justo en medio
MULTIMEDIA_LOGIC = """
    // --- MULTIMEDIA HANDLER ---
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
        if (assignedObj.phone) sendWA(assignedObj.phone, `🔔 NUEVO LEAD WA: ${contactName} envió un ${msg.type === 'image' ? 'imagen' : 'audio'}`).catch(()=>{});
      }

      if (!ld[tenant][idx].media) ld[tenant][idx].media = [];
      ld[tenant][idx].chatHistory = ld[tenant][idx].chatHistory || [];

      if (msg.type === 'image' && msg.image) {
        const mediaObj = { type: 'image', url: msg.image.id || msg.image.link || 'https://via.placeholder.com/150?text=Ver+Imagen', text: msg.image.caption || '', ts: Date.now() };
        ld[tenant][idx].media.push(mediaObj);
        ld[tenant][idx].chatHistory.push({ role: 'user', content: `[IMAGEN RECIBIDA] ${mediaObj.text ? '— ' + mediaObj.text : ''}`.trim(), ts: mediaObj.ts });
      }

      if (msg.type === 'audio' && msg.audio) {
        const mediaObj = { type: 'audio', url: msg.audio.id || msg.audio.link || '', text: '[Audio Recibido]', ts: Date.now() };
        ld[tenant][idx].media.push(mediaObj);
        ld[tenant][idx].chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO]`, ts: mediaObj.ts });
      }

      ld[tenant][idx].unread = true;
      ld[tenant][idx].lastClientTs = new Date().toISOString();
      await tWrite(F.leads, tenant, ld[tenant]);
      return res.sendStatus(200); // Salimos temprano para no procesar como texto
    }
    // --- FIN MULTIMEDIA HANDLER ---
    """

# Aplicamos el reemplazo
m = re.search(pattern, content)
if m:
    # Reemplazamos la captura original metiendo nuestro bloque en el medio
    new_content = content[:m.start()] + m.group(1) + "\n" + MULTIMEDIA_LOGIC + "\n    " + m.group(2) + content[m.end():]
    
    with open(SERVER_FILE, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("✅ Cirugía de Backend completada. El Webhook ahora ataja fotos y audios.")
else:
    print("❌ No se encontró el punto de anclaje exacto en el Webhook.")


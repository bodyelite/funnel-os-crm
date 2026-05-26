import subprocess
import sys
import os

SERVER_FILE = "server.js"
FRONTEND_FILE = "public/index.html"

OLD_BACKEND = "// --- MULTIMEDIA HANDLER V3 ---"
OLD_BACKEND_END = "// --- FIN MULTIMEDIA HANDLER V3 ---"

NEW_BACKEND = """// --- MULTIMEDIA HANDLER V4 ---
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
      
      if (msg.type === 'image') {
        const mediaId = msg.image.id;
        const caption = msg.image.caption || '';
        ld[tenant][idx].media.push({ type: 'image', url: mediaId, text: caption, ts: Date.now() });
        body = caption ? `[FOTO RECIBIDA]: ${caption}. Dile amablemente que la agregarás a la evaluación.` : '[FOTO RECIBIDA] El cliente envió una foto. Dile que la recibiste y la agregarás a la evaluación.';
      }

      if (msg.type === 'audio') {
        try {
          const audioId = msg.audio.id;
          const metaUrlRes = await fetch(`https://graph.facebook.com/v19.0/${audioId}`, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
          const metaUrlData = await metaUrlRes.json();
          
          if (metaUrlData.url) {
            const audioRes = await fetch(metaUrlData.url, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
            const arrayBuffer = await audioRes.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuffer);
            
            const { Readable } = require('stream');
            const readableStream = Readable.from(audioBuffer);
            readableStream.path = 'audio.ogg';
            
            const transcriptionRes = await openai.audio.transcriptions.create({ file: readableStream, model: 'whisper-1' });
            const transcription = transcriptionRes.text || '[Sin transcripción]';
            
            body = `[AUDIO TRANSCRITO]: "${transcription}". Responde al cliente considerando esto.`;
            ld[tenant][idx].chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO] 🎤 "${transcription}"`, ts: Date.now() });
          } else {
            throw new Error('URL de audio no encontrada');
          }
        } catch (err) {
          console.error('Error Whisper:', err.message);
          body = '[AUDIO RECIBIDO] El cliente envió una nota de voz, dile que en un momento lo escuchas.';
          ld[tenant][idx].chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO - Transcripción falló]`, ts: Date.now() });
        }
      }
      
      await tWrite(F.leads, tenant, ld[tenant]);
    }
// --- FIN MULTIMEDIA HANDLER V4 ---"""

OLD_FRONTEND_START = "function renderMediaGallery(lead) {"

NEW_FRONTEND = """function renderMediaGallery(lead) {
  const anchor = document.getElementById('tradein-section') || document.querySelector('.cchat');
  if (!anchor) return;
  const existing = document.getElementById('media-gallery-section');
  if (existing) existing.remove();

  const items = (lead.media || []).filter(function(item) { return item.type === 'image'; });
  if (!items.length) return;

  let html = '<div id="media-gallery-section" style="margin-top:12px;padding:14px;background:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;">';
  html += '<strong style="font-size:12px;color:#334155;display:block;margin-bottom:10px;">📷 Galería de Fotos</strong>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:10px;">';

  items.forEach(function(item) {
    const imgUrl = (item.url && item.url.startsWith('http')) ? item.url : '/api/media/' + item.url;
    html += '<div style="position:relative;aspect-ratio:1/1;overflow:hidden;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;" onclick="window.open(\\''+imgUrl+'\\',\\'_blank\\')">';
    html += '<img src="' + imgUrl + '" alt="Imagen" '
         + 'style="width:100%;height:100%;object-fit:cover;display:block;transition:transform 0.2s" '
         + 'onmouseover="this.style.transform=\\'scale(1.1)\\'" onmouseout="this.style.transform=\\'scale(1)\\'" '
         + 'onerror="this.parentElement.style.display=\\'none\\'">';
    if (item.text) {
      html += '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);'
           + 'color:#fff;font-size:9px;padding:3px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
           + item.text + '</div>';
    }
    html += '</div>';
  });

  html += '</div></div>';
  anchor.insertAdjacentHTML('afterend', html);
}"""

def read_file(path):
    with open(path, "r", encoding="utf-8") as f: return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f: f.write(content)

def patch_backend():
    content = read_file(SERVER_FILE)
    if "MULTIMEDIA HANDLER V4" in content:
        print("✅ Backend ya contiene V4.")
        return

    start_idx = content.find(OLD_BACKEND)
    if start_idx == -1:
        print("❌ No se encontró V3 en server.js")
        sys.exit(1)

    end_marker_idx = content.find(OLD_BACKEND_END, start_idx)
    end_idx = end_marker_idx + len(OLD_BACKEND_END)
    old_block = content[start_idx:end_idx]
    
    content = content.replace(old_block, NEW_BACKEND, 1)
    write_file(SERVER_FILE, content)
    print("✅ Backend parcheado a V4 (Con rescate de Lead y OpenAI Whisper).")

def patch_frontend():
    content = read_file(FRONTEND_FILE)
    if "📷 Galería de Fotos" in content:
        print("✅ Frontend ya contiene la galería V4.")
        return

    start_idx = content.find(OLD_FRONTEND_START)
    if start_idx == -1:
        print("❌ No se encontró renderMediaGallery en index.html")
        sys.exit(1)

    depth = 0
    end_idx = start_idx
    i = start_idx
    while i < len(content):
        if content[i] == '{': depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                end_idx = i + 1
                break
        i += 1

    old_function = content[start_idx:end_idx]
    content = content.replace(old_function, NEW_FRONTEND, 1)
    write_file(FRONTEND_FILE, content)
    print("✅ Frontend parcheado: Galería de imágenes limpia inyectada.")

patch_backend()
patch_frontend()

print("\n[CHECK] Ejecutando: node --check server.js")
result = subprocess.run(["node", "--check", SERVER_FILE], capture_output=True, text=True)
if result.returncode == 0:
    print("[OK] server.js: sintaxis válida ✓")
else:
    print("[ERROR] server.js tiene errores:")
    print(result.stderr)
    sys.exit(1)

import re
import os
import subprocess
import sys

# --- BACKEND LOGIC (Del Obrero, validada) ---
BACKEND_INJECTION = r"""
  // [SPRINT5-MULTIMEDIA-BACKEND]
  (async () => {
    try {
      const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (message && lead) {
        if (!lead.media) lead.media = [];
        let changed = false;

        if (message.type === 'image' && message.image) {
          const mediaObj = {
            type: 'image',
            url: message.image.id || message.image.link || '',
            text: message.image.caption || '',
            ts: Date.now()
          };
          lead.media.push(mediaObj);
          lead.chatHistory = lead.chatHistory || [];
          lead.chatHistory.push({ role: 'user', content: `[IMAGEN RECIBIDA] ${mediaObj.text ? '— ' + mediaObj.text : ''}`.trim(), ts: mediaObj.ts });
          changed = true;
        }

        if (message.type === 'audio' && message.audio) {
          const mediaObj = {
            type: 'audio',
            url: message.audio.id || message.audio.link || '',
            text: '[Audio Recibido]',
            ts: Date.now()
          };
          lead.media.push(mediaObj);
          lead.chatHistory = lead.chatHistory || [];
          lead.chatHistory.push({ role: 'user', content: `[AUDIO RECIBIDO]`, ts: mediaObj.ts });
          changed = true;
        }
      }
    } catch (e) { console.error('Error procesando multimedia:', e); }
  })();
"""

# --- FRONTEND LOGIC (Fuerza Bruta Ninja) ---
FRONTEND_INJECTION = """
<script>
// [SPRINT5-MULTIMEDIA-FRONTEND]
function renderMediaGallery(lead) {
  const anchor = document.getElementById('tradein-section') || document.querySelector('.cchat');
  if (!anchor) return;
  if (document.getElementById('media-gallery-section')) document.getElementById('media-gallery-section').remove();
  
  const items = lead.media || [];
  if (!items.length) return;

  let html = '<div id="media-gallery-section" style="margin-top:12px;padding:14px;background:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;">';
  html += '<strong style="font-size:12px;color:#334155;display:block;margin-bottom:10px;">📎 Archivos Adjuntos (Fotos / Audios)</strong>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:10px;">';

  items.forEach(function(item) {
    if (item.type === 'image') {
      // Si la URL es un ID de Meta, normalmente requiere una llamada a la API, 
      // pero asumimos que el webhook provee un link temporal o manejamos la vista.
      const imgUrl = item.url.startsWith('http') ? item.url : 'https://via.placeholder.com/150?text=Ver+Imagen';
      html += `<a href="${imgUrl}" target="_blank" title="Clic para ampliar"><img src="${imgUrl}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;cursor:pointer;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'"></a>`;
    } else if (item.type === 'audio') {
      const audioUrl = item.url.startsWith('http') ? item.url : '';
      html += `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:4px 10px;display:flex;align-items:center;gap:6px;"><span style="font-size:16px;">🎤</span><audio controls src="${audioUrl}" style="height:25px;width:160px;"></audio></div>`;
    }
  });
  html += '</div></div>';
  anchor.insertAdjacentHTML('afterend', html);
}

// Bucle infalible: revisa si la ficha está abierta y dibuja las fotos
setInterval(() => {
   const leadId = typeof S !== 'undefined' ? S.mid : null;
   if(leadId && (document.getElementById('tradein-section') || document.querySelector('.cchat')) && !document.getElementById('media-gallery-section')) {
       const lead = (S.leads || []).find(x => x.id == leadId);
       if(lead && lead.media && lead.media.length > 0) {
           renderMediaGallery(lead);
       }
   }
}, 800);
</script>
"""

def patch_backend():
    with open('server.js', 'r', encoding='utf-8') as f:
        content = f.read()
    if "// [SPRINT5-MULTIMEDIA-BACKEND]" in content:
        print("✅ Backend ya estaba parcheado.")
        return
    
    # Inyectar después de asignar 'lead' en el endpoint webhook
    pattern = re.compile(r'((?:const|let|var)\s+lead\s*=\s*(?:await\s+)?[^\n]+\n(?=[\s\S]{0,600}?(?:chatHistory|req\.body|whatsapp|webhook)))', re.DOTALL)
    m = pattern.search(content)
    if m:
        content = content[:m.end()] + BACKEND_INJECTION + content[m.end():]
    else:
        # Fallback si no encuentra el ancla exacta
        content += "\n" + BACKEND_INJECTION

    with open('server.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ Backend parcheado exitosamente.")

def patch_frontend():
    with open('public/index.html', 'r', encoding='utf-8') as f:
        content = f.read()
    if "// [SPRINT5-MULTIMEDIA-FRONTEND]" in content:
        print("✅ Frontend ya estaba parcheado.")
        return
    
    content = content.replace('</body>', FRONTEND_INJECTION + '\n</body>')
    with open('public/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ Frontend parcheado (Modo Ninja).")

patch_backend()
patch_frontend()
subprocess.run(["node", "--check", "server.js"])

import re
import os

# --- 1. FRONTEND: Quitar invisibilidad ---
with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Cambiamos el comportamiento de error para que muestre un cuadro rojo
html = html.replace(
    "onerror=\"this.parentElement.style.display='none'\"",
    "onerror=\"this.onerror=null; this.src='https://via.placeholder.com/150?text=Error+Meta'; this.style.border='2px solid red';\""
)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

# --- 2. BACKEND: Proxy v19.0 con reporte de errores ---
with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

proxy_regex = re.compile(r'// --- PROXY DE MEDIA META ---.*?// --- FIN PROXY ---', re.DOTALL)
new_proxy = """// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Error: Sin token WA_TOKEN configurado en el servidor');
    
    // Usamos v19.0 igual que en los audios
    const uRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    const uData = await uRes.json();
    
    if (!uData.url) {
        console.error('Meta API Error:', uData);
        return res.status(404).send('Error de Meta: ' + JSON.stringify(uData));
    }
    
    const mRes = await fetch(uData.url, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    
    if (!mRes.ok) {
        const errText = await mRes.text();
        return res.status(mRes.status).send('Fallo al descargar archivo de Meta: ' + errText);
    }

    const buffer = await mRes.arrayBuffer();
    const contentType = mRes.headers.get('content-type');
    
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error en Proxy Multimedia:', e);
    res.status(500).send('Error interno en el servidor Node');
  }
});
// --- FIN PROXY ---"""

if proxy_regex.search(src):
    src = proxy_regex.sub(new_proxy, src)
    print("✅ Proxy de backend actualizado a v19.0 con reporte de errores.")
else:
    print("⚠️ No se encontró el proxy. Revisa el código.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

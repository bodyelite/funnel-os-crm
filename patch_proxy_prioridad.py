import re

with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Borramos cualquier rastro del proxy viejo en el fondo del archivo
src = re.sub(r'// --- PROXY DE MEDIA META ---.*?// --- FIN PROXY ---', '', src, flags=re.DOTALL)

# 2. Preparamos el proxy definitivo
proxy_code = """
// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Error: Sin token WA_TOKEN configurado en el servidor');
    
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
// --- FIN PROXY ---
"""

# 3. Lo inyectamos bien arriba, justo antes del webhook
if "app.post('/webhook'" in src:
    src = src.replace("app.post('/webhook'", proxy_code + "\napp.post('/webhook'")
    print("✅ Proxy movido a la línea frontal de rutas (antes del webhook).")
else:
    # Plan B extremo por si acaso
    src = src.replace("const app = express();", "const app = express();\n" + proxy_code)
    print("✅ Proxy inyectado justo después de declarar express.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

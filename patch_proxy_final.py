import re

with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Reemplazamos el proxy viejo por uno a prueba de balas
old_proxy_regex = re.compile(r'// --- PROXY DE MEDIA META ---.*?// --- PROXY DE MEDIA META ---' if src.count('// --- PROXY DE MEDIA META ---') > 1 else r'// --- PROXY DE MEDIA META ---.*?(?=app\.listen)', re.DOTALL)

new_proxy = """
// --- PROXY DE MEDIA META ---
app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    if (!mediaId || mediaId === 'undefined') return res.status(400).send('ID invalido');
    
    const token = process.env.WA_TOKEN;
    if (!token) return res.status(500).send('Sin token WA_TOKEN configurado');
    
    // 1. Obtener URL temporal de descarga desde Meta
    const uRes = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    const uData = await uRes.json();
    if (!uData.url) return res.status(404).send('Media no encontrada en Meta');
    
    // 2. Descargar el archivo real
    const mRes = await fetch(uData.url, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    
    if (!mRes.ok) return res.status(mRes.status).send('Fallo al descargar de Meta');

    const buffer = await mRes.arrayBuffer();
    const contentType = mRes.headers.get('content-type');
    
    // 3. Forzar headers para que el navegador sepa qué es
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cachear por 24h
    res.setHeader('Access-Control-Allow-Origin', '*'); // Evitar problemas de CORS
    
    // Enviar el buffer crudo
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error en Proxy Multimedia:', e);
    res.status(500).send('Error interno');
  }
});
// --- FIN PROXY ---
"""

if old_proxy_regex.search(src):
    src = old_proxy_regex.sub(new_proxy.strip() + "\n", src)
    print("✅ Backend: Proxy de Meta actualizado y reforzado.")
else:
    print("⚠️ No se encontró el proxy viejo. Insertando nuevo...")
    src = src.replace('app.listen(', new_proxy + '\napp.listen(')

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)


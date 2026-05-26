import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Buscamos la funcion completa y la pisamos
pattern = re.compile(r'function renderMediaGallery\(lead\) \{.*?anchor\.insertAdjacentHTML\(\'afterend\', html\);\s*\}', re.DOTALL)

new_func = """function renderMediaGallery(lead) {
  const anchor = document.getElementById('tradein-section') || document.querySelector('.cchat');
  if (!anchor) return;
  const existing = document.getElementById('media-gallery-section');
  if (existing) existing.remove();

  const items = (lead.media || []).filter(function(item) { return item.type === 'image'; });
  if (!items.length) return;

  let html = '<div id="media-gallery-section" style="margin-top:12px;padding:14px;background:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;">';
  html += '<strong style="font-size:12px;color:#334155;display:block;margin-bottom:10px;">📷 Galería de Fotos</strong>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:10px;">';

  items.forEach(function(item) {
    const imgUrl = (item.url && item.url.startsWith('http')) ? item.url : '/api/media/' + item.url;
    html += '<div style="position:relative;width:90px;height:90px;border-radius:6px;border:2px solid #cbd5e1;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;" onclick="window.open(\\''+imgUrl+'\\',\\'_blank\\')">';
    html += '<img src="' + imgUrl + '" title="Clic para ver detalle o error" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null; this.src=\\'https://via.placeholder.com/90/fee2e2/ef4444?text=VER+ERROR\\';">';
    html += '</div>';
  });

  html += '</div></div>';
  anchor.insertAdjacentHTML('afterend', html);
}"""

if pattern.search(html):
    html = pattern.sub(new_func, html)
    print("✅ Frontend: Capa de invisibilidad destruida.")
else:
    print("⚠️ No se encontró renderMediaGallery.")

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

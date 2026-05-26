import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    src = f.read()

# Buscamos la instrucción antigua que fallaba
pattern = r"const anchor = document\.querySelector\('\.modal-body'\).*?if\s*\(anchor\)\s*anchor\.insertAdjacentHTML\('beforeend',\s*html\);"

# La reemplazamos por el anclaje inteligente que busca el botón "Guardar cambios"
new_logic = """
        let anchor = document.querySelector('.modal-body') || document.querySelector('.modal-content');
        if (!anchor) {
          const btns = Array.from(document.querySelectorAll('button'));
          const btnGuardar = btns.find(b => b.textContent.includes('Guardar cambios') || b.textContent.includes('Generar'));
          if (btnGuardar) anchor = btnGuardar.parentElement.parentElement;
        }
        if (!anchor) anchor = document.body; // Fallback extremo para que aparezca sí o sí
        if (anchor) anchor.insertAdjacentHTML('beforeend', html);
"""

src_new = re.sub(pattern, new_logic, src, flags=re.DOTALL)

if src != src_new:
    with open('public/index.html', 'w', encoding='utf-8') as f:
        f.write(src_new)
    print("✅ ¡Cazado! Anclaje corregido para que encuentre la ficha sí o sí.")
else:
    print("⚠️ No se pudo reemplazar. Avisame si sale este error.")

import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Cambiamos el ancla de la columna derecha (.ca2) a la columna izquierda del chat (.cchat)
src = re.sub(r"document\.querySelector\('\.ca2'\)[^;]*;", "document.querySelector('.cchat');", src)

# 2. Cambiamos la inyección para que se ponga al final (debajo del chat) en vez de arriba
src = src.replace("insertAdjacentHTML('afterbegin', html)", "insertAdjacentHTML('beforeend', html)")

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(src)

print("✅ Cirugía estética completada. Panel movido debajo del chat.")

import re

with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# Buscamos la línea exacta que concatena (guarda) las notas viejas
pattern = re.compile(r'ld\[tenant\]\[idx\]\.notes\s*=\s*\(ld\[tenant\]\[idx\]\.notes\s*\|\|\s*\[\]\)\.concat\(\{content:\'🔄[^\']+\',author:\'Sistema\',ts:Date\.now\(\)\}\);')

if pattern.search(src):
    # La reemplazamos por un array nuevo que SOLO contenga el aviso de reseteo
    src = pattern.sub("ld[tenant][idx].notes = [{content:'🔄 Ficha limpia. Historial reseteado a cero.',author:'Sistema',ts:Date.now()}];", src)
    print("✅ Cirugía perfecta: El comando /reset ahora elimina las notas internas viejas.")
else:
    print("⚠️ No se encontro por regex. Intentando reemplazo de texto bruto...")
    viejo = "ld[tenant][idx].notes=(ld[tenant][idx].notes||[]).concat({content:'🔄 Historial reseteado por comando',author:'Sistema',ts:Date.now()});"
    nuevo = "ld[tenant][idx].notes=[{content:'🔄 Ficha limpia. Historial reseteado a cero.',author:'Sistema',ts:Date.now()}];"
    src = src.replace(viejo, nuevo)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

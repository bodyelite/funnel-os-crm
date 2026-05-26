with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# Buscamos una línea exacta y segura dentro de tu bloque de /reset
ancla = "ld[tenant][idx].lastClientTs=_rn;"

if ancla in src:
    # Le inyectamos el vaciado de media justo después
    src = src.replace(ancla, ancla + " ld[tenant][idx].media = [];")
    print("✅ Cirugía Láser: El comando /reset ahora vacía la galería de fotos de forma segura.")
else:
    print("⚠️ No se encontró el ancla para el reset.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

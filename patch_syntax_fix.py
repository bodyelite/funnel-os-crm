import re

with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# La basura exacta que dejó el regex defectuoso
garbage = "});await tWrite(F.leads,tenant,ld[tenant]);await sendWA(from,'🔄 Memoria borrada. ¡Empecemos de cero! 🚗');return;}"

if garbage in src:
    src = src.replace(garbage, "")
    print("✅ Cirugía exitosa: Basura sintáctica eliminada con precisión.")
else:
    # Fallback con regex por si hay espacios distintos
    pattern = re.compile(r'\}\);\s*await\s+tWrite\(F\.leads,tenant,ld\[tenant\]\);\s*await\s+sendWA\(from,\'🔄 Memoria borrada\. ¡Empecemos de cero! 🚗\'\);\s*return;\}', re.DOTALL)
    if pattern.search(src):
        src = pattern.sub("", src)
        print("✅ Cirugía exitosa: Basura eliminada mediante patrón.")
    else:
        print("⚠️ No se encontró la basura. Revisa a mano.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

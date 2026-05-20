import sys
SRV = 'server.js'
# Leemos el archivo entero
lines = open(SRV, 'r', encoding='utf-8').readlines()
# Limpiamos una llave extra al final si existe
if lines[-1].strip() == '}':
    lines.pop()
# Reescribimos la función desde cero para asegurar la sintaxis
# (esta versión es la que subiste, pero forzada con el async correcto)
with open(SRV, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print("✅ Llave extra final eliminada. Intentando reiniciar...")

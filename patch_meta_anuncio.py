#!/usr/bin/env python3
"""
Patch: mejora el detector de Meta Ads en server.js
- Captura marca/modelo/año del texto del anuncio
- Etiqueta source='Meta Ads' + interest='<vehículo del anuncio>'
Idempotente: si ya está aplicado, no hace nada.
"""
import re, sys, shutil, os

SERVER = "server.js"

if not os.path.exists(SERVER):
    print("ERROR: no encuentro server.js en este directorio.")
    sys.exit(1)

with open(SERVER, "r", encoding="utf-8") as f:
    src = f.read()

if "Lead Meta Ads — Anuncio:" in src or "Lead Meta Ads - Anuncio:" in src:
    print("✓ El patch ya está aplicado. Nada que hacer.")
    sys.exit(0)

# Bloque viejo (el que está hoy en producción)
OLD = """      if (metaMatch) {
        detectedSource   = 'Meta Ads';
        detectedInterest = body.replace(/Hola[,.]?\\s*/i, '').slice(0, 80) || 'Consulta desde Meta Ads';
        portalNote = `Lead ingresó desde campaña Meta Ads. Mensaje inicial: ${body.slice(0, 80)}`;
      } else if (yapoMatch) {"""

# Bloque nuevo: extrae el vehículo del texto del anuncio
NEW = """      if (metaMatch) {
        detectedSource   = 'Meta Ads';
        // Extraer el vehículo específico del anuncio desde el texto del mensaje
        // Formatos esperados: "vi el Opel Mokka GS Line 2024 en su anuncio de Meta"
        let vehMeta = '';
        const vm = body.match(/(?:vi el|vi la|interesa el|interesa la|por el|por la|el|la)\\s+([A-Za-zÁÉÍÓÚáéíóúÑñ0-9][^,.\\n]*?)(?:\\s+en su anuncio|\\s+en el anuncio|\\s+de Meta|\\s+por Meta|\\s+y me interesa|$)/i);
        if (vm && vm[1]) vehMeta = vm[1].trim();
        // Limpiar colas genéricas
        vehMeta = vehMeta.replace(/\\b(en su anuncio|de meta|por meta|y me interesa un auto|y me interesa)\\b/gi, '').trim();
        detectedInterest = vehMeta && vehMeta.length > 2 ? vehMeta : 'Consulta desde Meta Ads';
        portalNote = `Lead Meta Ads — Anuncio: ${detectedInterest}. Mensaje inicial: ${body.slice(0, 120)}`;
      } else if (yapoMatch) {"""

if OLD not in src:
    print("ERROR: no encontré el bloque esperado del detector Meta en server.js.")
    print("Puede que el archivo ya haya cambiado. Revisa manualmente la sección 'if (metaMatch)'.")
    sys.exit(2)

src = src.replace(OLD, NEW)

# Backup
shutil.copy(SERVER, SERVER + ".bak")
with open(SERVER, "w", encoding="utf-8") as f:
    f.write(src)

print("✓ Patch aplicado correctamente.")
print("✓ Backup guardado en server.js.bak")
print("  Ahora el detector captura el vehículo del anuncio Meta y lo guarda en 'interest'.")

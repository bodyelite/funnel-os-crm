#!/usr/bin/env python3
import sys

SERVER = 'server.js'

with open(SERVER, 'r', encoding='utf-8') as f:
    src = f.read()

# ── PATCH: Agregar detector Meta Ads en el webhook ──────────────────────────
OLD = """      const yapoMatch = body.match(/Me interesa el anuncio\\s*"([^"]+)"/i);
      const mlMatch   = body.match(/publicaci[oó]n en Mercado Libre[^:\\-]*[:\\-]?\\s*(.{0,60})/i);
      const caMatch   = body.match(/auto en Chileautos[^:\\-]*[:\\-]?\\s*(.{0,60})/i);

      if (yapoMatch) {
        detectedSource   = 'Yapo';
        detectedInterest = yapoMatch[1].trim();
        portalNote = `Lead ingresó desde Yapo. Vehículo consultado: ${detectedInterest}`;
      } else if (mlMatch) {
        detectedSource   = 'MercadoLibre';
        detectedInterest = mlMatch[1].trim() || body.slice(0, 80);
        portalNote = `Lead ingresó desde MercadoLibre. Interés: ${detectedInterest}`;
      } else if (caMatch) {
        detectedSource   = 'Chileautos';
        detectedInterest = caMatch[1].trim() || body.slice(0, 80);
        portalNote = `Lead ingresó desde Chileautos vía WA directo. Interés: ${detectedInterest}`;
      }"""

NEW = """      const yapoMatch = body.match(/Me interesa el anuncio\\s*"([^"]+)"/i);
      const mlMatch   = body.match(/publicaci[oó]n en Mercado Libre[^:\\-]*[:\\-]?\\s*(.{0,60})/i);
      const caMatch   = body.match(/auto en Chileautos[^:\\-]*[:\\-]?\\s*(.{0,60})/i);
      const metaMatch = body.match(/anuncio en Meta|vi su anuncio en Meta|anuncio de RMG en Meta|anuncio RMG Meta/i);

      if (metaMatch) {
        detectedSource   = 'Meta Ads';
        detectedInterest = body.replace(/Hola[,.]?\\s*/i, '').slice(0, 80) || 'Consulta desde Meta Ads';
        portalNote = `Lead ingresó desde campaña Meta Ads. Mensaje inicial: ${body.slice(0, 80)}`;
      } else if (yapoMatch) {
        detectedSource   = 'Yapo';
        detectedInterest = yapoMatch[1].trim();
        portalNote = `Lead ingresó desde Yapo. Vehículo consultado: ${detectedInterest}`;
      } else if (mlMatch) {
        detectedSource   = 'MercadoLibre';
        detectedInterest = mlMatch[1].trim() || body.slice(0, 80);
        portalNote = `Lead ingresó desde MercadoLibre. Interés: ${detectedInterest}`;
      } else if (caMatch) {
        detectedSource   = 'Chileautos';
        detectedInterest = caMatch[1].trim() || body.slice(0, 80);
        portalNote = `Lead ingresó desde Chileautos vía WA directo. Interés: ${detectedInterest}`;
      }"""

if OLD not in src:
    print('❌ FALLO: Anchor no encontrado en server.js')
    sys.exit(1)

count = src.count(OLD)
if count > 1:
    print(f'⚠️  El anchor aparece {count} veces — aplicando solo la primera')

src = src.replace(OLD, NEW, 1)

with open(SERVER, 'w', encoding='utf-8') as f:
    f.write(src)

print('✅ Patch aplicado: detector Meta Ads agregado en webhook')
print('✅ Keyword detectada: "anuncio en Meta" / "anuncio de RMG en Meta" / "vi su anuncio en Meta"')

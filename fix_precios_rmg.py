#!/usr/bin/env python3
import subprocess
import sys
import os

SERVER_FILE = "server.js"

OLD_SCRAPER = """async function scrapeRMG() {
  const now = Date.now();
  if (scrapeCache.data && (now - scrapeCache.ts) < 30 * 60 * 1000) return scrapeCache.data;
  try {
    const r = await fetch(RMG_SCRAPE_URL, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RMG-CRM-Bot/1.0)' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const autos = [];
    const precioRE = /\\$\\s*(\\d{1,2}[.,]\\d{3}[.,]\\d{3})/g;
    const annoRE = /\\b(201\\d|202[0-5])\\b/g;
    const bloqueRE = /<(?:article|div|li)[^>]*class="[^"]*(?:car|vehicle|product|listing|post|item)[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:article|div|li)>/gi;
    let bloque;
    while ((bloque = bloqueRE.exec(html)) !== null && autos.length < 40) {
      const seg = bloque[1].replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
      const marcaM = seg.match(MARCAS_RE);
      if (!marcaM) continue;
      const marca = marcaM[0];
      const annoM = seg.match(/\\b(201\\d|202[0-5])\\b/);
      const anno = annoM ? annoM[0] : '';
      const precioM = seg.match(/\\$\\s*(\\d{1,2}[.,]\\d{3}[.,]\\d{3})/);
      const precio = precioM ? '$' + precioM[1] : '(consultar)';
      const kmM = seg.match(/(\\d{2,3}[.,]\\d{3})\\s*(?:km|kms)/i) || seg.match(/(\\d{4,6})\\s*km/i);
      const km = kmM ? kmM[1].replace(/\\./g,'') + ' km' : '';
      const modRE = new RegExp(marca + '\\\\s+([A-Za-z0-9\\\\s]{2,25}?)\\\\s+(?:' + (anno||'\\\\d{4}') + '|\\\\$)', 'i');
      const modM = seg.match(modRE); const modelo = modM ? modM[1].trim().split(/\\s+/).slice(0,4).join(' ') : '';
      autos.push(('- ' + marca + ' ' + modelo + ' ' + anno + ' | ' + (km||'km no indicado') + ' | ' + precio).replace(/\\s{2,}/g,' ').trim());
    }
    if (autos.length < 3) {
      const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
      plainText.split(/(?=\\$\\d)/).forEach(tok => {
        if (autos.length >= 30) return;
        const pM = tok.match(/\\$\\s*(\\d{1,2}[.,]\\d{3}[.,]\\d{3})/); if (!pM) return;
        const mM = tok.match(MARCAS_RE); if (!mM) return;
        const aM = tok.match(/\\b(201\\d|202[0-5])\\b/);
        autos.push(('- ' + mM[0] + ' ' + (aM?aM[0]:'') + ' | ' + '$' + pM[1]).trim());
      });
    }
    if (autos.length === 0) throw new Error('0 autos encontrados');
    scrapeCache = { ts: now, data: [...new Set(autos)].join('\\n') };
    console.log('[RMG-Scraper] ' + autos.length + ' autos capturados de rmgautos.cl');
    return scrapeCache.data;
  } catch(e) {
    console.warn('[RMG-Scraper] Error:', e.message, '— fallback INV_HARDCODED');
    return scrapeCache.data || '';
  }
}"""

NEW_SCRAPER = """async function scrapeRMG() {
  const now = Date.now();
  if (scrapeCache.data && (now - scrapeCache.ts) < 30 * 60 * 1000) return scrapeCache.data;
  try {
    const r = await fetch(RMG_SCRAPE_URL, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RMG-CRM-Bot/2.0)' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const autos = [];

    // Estrategia principal: extraer bloques entre etiquetas de precio lista y crédito
    // La web usa el patrón: "Precio Lista:" ## $X.XXX.XXX "Precio Crédito:" ## $X.XXX.XXX
    const bloqueCardRE = /Precio Lista:[\\s\\S]*?\\$([\\d.,]+)[\\s\\S]*?Precio Cr[eé]dito:[\\s\\S]*?\\$([\\d.,]+)[\\s\\S]*?(?=Precio Lista:|CONÓCEME|$)/gi;
    let matchCard;
    const htmlFlat = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ');

    // Iterar cada bloque de auto detectando ambos precios secuencialmente
    const cardSplitRE = /(?=Precio Lista:)/gi;
    const cards = htmlFlat.split(cardSplitRE).slice(1);

    cards.forEach(card => {
      if (autos.length >= 50) return;

      // Precio Lista (primer precio en el bloque)
      const listaM = card.match(/Precio Lista:\\s*\\$?\\s*([\\d.,]+)/i);
      // Precio Crédito (segundo precio en el bloque)
      const creditoM = card.match(/Precio Cr[eé]dito:\\s*\\$?\\s*([\\d.,]+)/i);

      const precioLista   = listaM   ? '$' + listaM[1].trim()   : '(consultar)';
      const precioCredito = creditoM ? '$' + creditoM[1].trim() : '(consultar)';

      // Marca
      const marcaM = card.match(MARCAS_RE);
      if (!marcaM) return;
      const marca = marcaM[0].toUpperCase();

      // Año
      const annoM = card.match(/\\b(201\\d|202[0-5])\\b/);
      const anno = annoM ? annoM[0] : '';

      // Kilometraje
      const kmM = card.match(/(\\d{1,3}[.,]\\d{3})\\s*(?:km|kms)/i) || card.match(/(\\d{4,6})\\s*(?:km|kms)/i);
      const km = kmM ? kmM[1].replace(/\\./g, '').replace(',', '.') + ' km' : '';

      // Modelo: texto entre marca y año (máx 5 palabras)
      const modRE = new RegExp(marca + '\\\\s+([A-Za-z0-9\\\\s]{2,35}?)(?:\\\\s+' + (anno || '\\\\d{4}') + '|\\\\s+\\\\$|Precio)', 'i');
      const modM = card.match(modRE);
      const modelo = modM ? modM[1].trim().split(/\\s+/).slice(0, 5).join(' ') : '';

      const linea = `- ${marca} ${modelo} ${anno} | ${km || 'km no indicado'} | Lista: ${precioLista} | Crédito: ${precioCredito}`;
      autos.push(linea.replace(/\\s{2,}/g, ' ').trim());
    });

    // Fallback si la estrategia principal no rinde resultados
    if (autos.length < 3) {
      console.warn('[RMG-Scraper] Fallback activado: extracción por pares de precio');
      const pairRE = /\\$([\\d.,]{5,12})[\\s\\S]{0,200}?\\$([\\d.,]{5,12})/g;
      let pair;
      let pairIdx = 0;
      while ((pair = pairRE.exec(htmlFlat)) !== null && autos.length < 30) {
        const segment = htmlFlat.slice(Math.max(0, pair.index - 200), pair.index + 300);
        const mM = segment.match(MARCAS_RE);
        if (!mM) continue;
        const aM = segment.match(/\\b(201\\d|202[0-5])\\b/);
        autos.push(`- ${mM[0].toUpperCase()} ${aM ? aM[0] : ''} | Lista: $${pair[1]} | Crédito: $${pair[2]}`.replace(/\\s{2,}/g,' ').trim());
        pairIdx++;
      }
    }

    if (autos.length === 0) throw new Error('0 autos encontrados en rmgautos.cl');
    scrapeCache = { ts: now, data: [...new Set(autos)].join('\\n') };
    console.log('[RMG-Scraper] ' + autos.length + ' autos capturados con Precio Lista + Crédito');
    return scrapeCache.data;
  } catch(e) {
    console.warn('[RMG-Scraper] Error:', e.message, '— usando caché o fallback');
    return scrapeCache.data || '';
  }
}"""


def read_file(path):
    if not os.path.exists(path):
        print(f"[ERROR] No se encontró: {path}")
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def patch_scraper():
    content = read_file(SERVER_FILE)

    if "Lista: ${precioLista}" in content or "Precio Lista + Crédito" in content:
        print("[SKIP] scrapeRMG() ya tiene soporte de precio lista + crédito (idempotencia OK).")
        return

    # Intentar reemplazo exacto primero
    if OLD_SCRAPER in content:
        content = content.replace(OLD_SCRAPER, NEW_SCRAPER, 1)
        write_file(SERVER_FILE, content)
        print("[OK] scrapeRMG() reemplazado exactamente.")
        return

    # Fallback: buscar por firma de función y reemplazar hasta el cierre
    start_marker = "async function scrapeRMG() {"
    start_idx = content.find(start_marker)
    if start_idx == -1:
        print("[ERROR] No se encontró 'async function scrapeRMG()' en server.js")
        sys.exit(1)

    # Encontrar cierre balanceado de la función
    depth = 0
    i = start_idx
    end_idx = -1
    while i < len(content):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                end_idx = i + 1
                break
        i += 1

    if end_idx == -1:
        print("[ERROR] No se pudo determinar el cierre de scrapeRMG().")
        sys.exit(1)

    old_fn = content[start_idx:end_idx]
    content = content.replace(old_fn, NEW_SCRAPER, 1)
    write_file(SERVER_FILE, content)
    print("[OK] scrapeRMG() reemplazado por búsqueda de firma + cierre balanceado.")

def validate_syntax():
    print("\n[CHECK] node --check server.js")
    result = subprocess.run(["node", "--check", SERVER_FILE], capture_output=True, text=True)
    if result.returncode == 0:
        print("[OK] Sintaxis válida ✓")
    else:
        print("[ERROR] Errores de sintaxis en server.js:")
        print(result.stderr)
        sys.exit(1)

if __name__ == "__main__":
    print("=" * 60)
    print("  FIX scrapeRMG() — Precio Lista + Precio Crédito")
    print("=" * 60)
    patch_scraper()
    validate_syntax()
    print("\n[DONE] Patch aplicado. El inventario ahora captura ambos precios.")
    print("       Reinicia el servidor para que el scraper se ejecute de nuevo.")

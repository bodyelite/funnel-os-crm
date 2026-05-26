#!/usr/bin/env python3
import re
import subprocess
import sys
import os

SERVER_FILE = "server.js"
FRONTEND_FILE = "public/index.html"

# ─────────────────────────────────────────────
# MARKERS (idempotencia)
# ─────────────────────────────────────────────
MARKER_BACKEND  = "// [SPRINT5-MULTIMEDIA-BACKEND]"
MARKER_FRONTEND = "// [SPRINT5-MULTIMEDIA-FRONTEND]"

# ─────────────────────────────────────────────
# CÓDIGO A INYECTAR — BACKEND
# ─────────────────────────────────────────────
BACKEND_INJECTION = r"""
  // [SPRINT5-MULTIMEDIA-BACKEND]
  // --- Multimedia handler (images & audio) ---
  (async () => {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      if (!lead.media) lead.media = [];

      if (message.type === 'image' && message.image) {
        const mediaObj = {
          type: 'image',
          url: message.image.id || message.image.link || '',
          text: message.image.caption || '',
          ts: Date.now()
        };
        lead.media.push(mediaObj);
        lead.chatHistory = lead.chatHistory || [];
        lead.chatHistory.push({
          role: 'user',
          content: `[IMAGEN RECIBIDA] ${mediaObj.text ? '— ' + mediaObj.text : ''}`.trim(),
          ts: mediaObj.ts
        });
      }

      if (message.type === 'audio' && message.audio) {
        let transcription = '[Sin transcripción]';
        try {
          if (typeof openai !== 'undefined' && openai?.audio?.transcriptions) {
            // Requiere haber descargado el buffer del audio previamente
            // transcription = await openai.audio.transcriptions.create({ file: audioBuffer, model: 'whisper-1' });
          }
        } catch (_) {}
        const mediaObj = {
          type: 'audio',
          url: message.audio.id || message.audio.link || '',
          text: transcription,
          ts: Date.now()
        };
        lead.media.push(mediaObj);
        lead.chatHistory = lead.chatHistory || [];
        lead.chatHistory.push({
          role: 'user',
          content: `[AUDIO RECIBIDO] ${transcription}`,
          ts: mediaObj.ts
        });
      }
    }
  })();
  // --- Fin Multimedia handler ---
"""

# ─────────────────────────────────────────────
# CÓDIGO A INYECTAR — FRONTEND
# ─────────────────────────────────────────────
FRONTEND_INJECTION = r"""
  // [SPRINT5-MULTIMEDIA-FRONTEND]
  function renderMediaGallery(lead) {
    const anchor = document.getElementById('tradein-section');
    if (!anchor) return;
    if (document.getElementById('media-gallery-section')) {
      document.getElementById('media-gallery-section').remove();
    }
    const items = lead.media || [];
    if (!items.length) return;

    let html = '<div id="media-gallery-section" style="margin-top:12px;padding:10px;background:#f8f9fa;border-radius:8px;">';
    html += '<strong style="font-size:13px;">📎 Multimedia recibido</strong><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">';

    items.forEach(function(item) {
      if (item.type === 'image') {
        html += '<div style="position:relative;">';
        html += '<img src="' + (item.url || '') + '" alt="Imagen" '
             + 'style="max-width:120px;max-height:120px;border-radius:6px;object-fit:cover;border:1px solid #ddd;" '
             + 'onerror="this.style.display=\'none\'">';
        if (item.text) {
          html += '<p style="font-size:10px;color:#555;margin:2px 0 0;">' + item.text + '</p>';
        }
        html += '</div>';
      } else if (item.type === 'audio') {
        html += '<div style="min-width:200px;">';
        html += '<audio controls src="' + (item.url || '') + '" style="width:100%;height:32px;"></audio>';
        if (item.text && item.text !== '[Sin transcripción]') {
          html += '<p style="font-size:10px;color:#555;margin:2px 0 0;">🗒 ' + item.text + '</p>';
        }
        html += '</div>';
      }
    });

    html += '</div></div>';
    anchor.insertAdjacentHTML('afterend', html);
  }
  // --- Fin Media Gallery ---
"""

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def read_file(path):
    if not os.path.exists(path):
        print(f"[ERROR] Archivo no encontrado: {path}")
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def already_patched(content, marker):
    return marker in content

# ─────────────────────────────────────────────
# PATCH BACKEND — server.js
# ─────────────────────────────────────────────
def patch_backend():
    content = read_file(SERVER_FILE)

    if already_patched(content, MARKER_BACKEND):
        print("[SKIP] Backend ya parchado (idempotencia OK).")
        return

    # Estrategia 1: buscar bloque app.post que procese req.body (webhook WhatsApp / /api/chat)
    # Inyectar justo después de que se resuelve/obtiene el objeto `lead`
    # Ancla: primera línea que asigne `lead` dentro de un app.post con req.body
    pattern1 = re.compile(
        r'(app\.post\s*\([^)]*\)\s*,?\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[^}]*?'
        r'(?:const|let|var)\s+lead\s*=\s*[^\n]+\n)',
        re.DOTALL
    )

    # Estrategia 2: ancla más simple — primera asignación de `lead` en cualquier app.post
    pattern2 = re.compile(
        r'((?:const|let|var)\s+lead\s*=\s*(?:await\s+)?[^\n]+\n'
        r'(?=[\s\S]{0,600}?(?:chatHistory|req\.body|whatsapp|webhook)))',
        re.DOTALL
    )

    # Estrategia 3: ancla al bloque genérico de procesamiento de mensaje dentro de app.post
    pattern3 = re.compile(
        r'(app\.post\s*\([\'"][^\'"]*/(?:webhook|api/chat|message)[^\'"]*[\'"]\s*,)',
        re.IGNORECASE
    )

    matched = False

    m = pattern2.search(content)
    if m:
        insert_pos = m.end()
        content = content[:insert_pos] + BACKEND_INJECTION + content[insert_pos:]
        matched = True
        print("[OK] Backend parcheado (estrategia 2: asignación de lead).")

    if not matched:
        # Estrategia de fallback: inyectar al principio del primer handler app.post
        pattern_fallback = re.compile(
            r'(app\.post\s*\([^,]+,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)',
            re.DOTALL
        )
        m2 = pattern_fallback.search(content)
        if m2:
            insert_pos = m2.end()
            content = content[:insert_pos] + "\n" + BACKEND_INJECTION + content[insert_pos:]
            matched = True
            print("[OK] Backend parcheado (estrategia fallback: primer app.post).")

    if not matched:
        print("[WARN] No se encontró ancla en server.js. Inyectando al final del archivo.")
        content = content + "\n" + BACKEND_INJECTION

    write_file(SERVER_FILE, content)

# ─────────────────────────────────────────────
# PATCH FRONTEND — public/index.html
# ─────────────────────────────────────────────
def patch_frontend():
    content = read_file(FRONTEND_FILE)

    if already_patched(content, MARKER_FRONTEND):
        print("[SKIP] Frontend ya parchado (idempotencia OK).")
        return

    # Ancla: función renderModal (buscar su cierre `}` o interior)
    # Inyectar la función renderMediaGallery justo ANTES del cierre de renderModal
    # y añadir su llamada dentro de renderModal al final del body de la función.

    # Paso 1: inyectar definición de renderMediaGallery antes de renderModal
    pattern_before_render = re.compile(
        r'(function\s+renderModal\s*\([^)]*\)\s*\{)',
        re.IGNORECASE
    )

    m = pattern_before_render.search(content)
    if m:
        insert_pos = m.start()
        content = content[:insert_pos] + FRONTEND_INJECTION + "\n  " + content[insert_pos:]
        print("[OK] Frontend: función renderMediaGallery inyectada antes de renderModal.")
    else:
        # Fallback: inyectar antes del cierre de </script>
        pattern_script_close = re.compile(r'(</script\s*>)', re.IGNORECASE)
        m2 = pattern_script_close.search(content)
        if m2:
            insert_pos = m2.start()
            content = content[:insert_pos] + FRONTEND_INJECTION + "\n" + content[insert_pos:]
            print("[OK] Frontend: función inyectada antes de </script> (fallback).")
        else:
            print("[WARN] No se encontró ancla en index.html. Inyectando al final.")
            content += "\n<script>\n" + FRONTEND_INJECTION + "\n</script>\n"

    # Paso 2: inyectar llamada a renderMediaGallery(lead) dentro de renderModal
    # Buscar el cierre de renderModal y añadir la llamada antes de él
    CALL_MARKER = "// [SPRINT5-MEDIA-CALL]"
    if CALL_MARKER not in content:
        call_injection = f"\n    {CALL_MARKER}\n    if (lead) renderMediaGallery(lead);\n  "
        # Buscar la última llave de cierre de renderModal
        pattern_render_body = re.compile(
            r'(function\s+renderModal\s*\([^)]*\)\s*\{[\s\S]*?)(^\s*\})',
            re.MULTILINE
        )
        m3 = pattern_render_body.search(content)
        if m3:
            insert_pos = m3.start(2)
            content = content[:insert_pos] + call_injection + content[insert_pos:]
            print("[OK] Frontend: llamada a renderMediaGallery inyectada en renderModal.")
        else:
            print("[WARN] No se pudo inyectar llamada a renderMediaGallery dentro de renderModal.")

    write_file(FRONTEND_FILE, content)

# ─────────────────────────────────────────────
# VALIDACIÓN SINTAXIS node --check
# ─────────────────────────────────────────────
def validate_syntax():
    print("\n[CHECK] Ejecutando: node --check server.js")
    result = subprocess.run(
        ["node", "--check", SERVER_FILE],
        capture_output=True,
        text=True
    )
    if result.returncode == 0:
        print("[OK] server.js: sintaxis válida ✓")
    else:
        print("[ERROR] server.js tiene errores de sintaxis:")
        print(result.stderr)
        sys.exit(1)

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  SPRINT 5 — Patch Multimedia (imágenes + audios)")
    print("=" * 55)

    patch_backend()
    patch_frontend()
    validate_syntax()

    print("\n[DONE] Patch completado exitosamente.")

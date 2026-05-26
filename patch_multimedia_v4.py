#!/usr/bin/env python3
import subprocess
import sys
import os

SERVER_FILE = "server.js"
FRONTEND_FILE = "public/index.html"

OLD_BACKEND = """// --- MULTIMEDIA HANDLER V3 ---"""
OLD_BACKEND_END = """// --- FIN MULTIMEDIA HANDLER V3 ---"""

NEW_BACKEND = """// --- MULTIMEDIA HANDLER V4 ---
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      if (!lead.media) lead.media = [];

      if (message.type === 'image' && message.image) {
        const imageId = message.image.id || '';
        const caption = message.image.caption || '';
        lead.media.push({ type: 'image', url: imageId, text: caption, ts: Date.now() });
        body = caption ? `[IMAGEN RECIBIDA]: ${caption}` : '[IMAGEN RECIBIDA]';
      }

      if (message.type === 'audio' && message.audio) {
        try {
          const audioId = message.audio.id;
          const metaUrlRes = await fetch(
            `https://graph.facebook.com/v19.0/${audioId}`,
            { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } }
          );
          const metaUrlData = await metaUrlRes.json();
          const audioUrl = metaUrlData.url;

          const audioRes = await fetch(audioUrl, {
            headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` }
          });
          const arrayBuffer = await audioRes.arrayBuffer();
          const audioBuffer = Buffer.from(arrayBuffer);

          const { Readable } = require('stream');
          const readableStream = Readable.from(audioBuffer);
          readableStream.path = 'audio.ogg';

          const transcriptionRes = await openai.audio.transcriptions.create({
            file: readableStream,
            model: 'whisper-1'
          });
          const transcription = transcriptionRes.text || '[Sin transcripción]';

          lead.chatHistory = lead.chatHistory || [];
          lead.chatHistory.push({
            role: 'user',
            content: `[AUDIO RECIBIDO] ${transcription}`,
            ts: Date.now()
          });

          body = `[AUDIO TRANSCRITO]: ${transcription}`;
        } catch (err) {
          console.error('[MULTIMEDIA V4] Error transcribiendo audio:', err.message);
          body = '[AUDIO RECIBIDO — error en transcripción]';
        }
      }
    }
// --- FIN MULTIMEDIA HANDLER V4 ---"""

OLD_FRONTEND_START = "function renderMediaGallery(lead) {"

NEW_FRONTEND = """function renderMediaGallery(lead) {
    const anchor = document.getElementById('tradein-section');
    if (!anchor) return;
    const existing = document.getElementById('media-gallery-section');
    if (existing) existing.remove();

    const items = (lead.media || []).filter(function(item) { return item.type === 'image'; });
    if (!items.length) return;

    let html = '<div id="media-gallery-section" style="margin-top:12px;padding:12px;background:#f8f9fa;border-radius:8px;">';
    html += '<strong style="font-size:13px;display:block;margin-bottom:8px;">📷 Imágenes recibidas</strong>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:10px;">';

    items.forEach(function(item) {
      html += '<div style="position:relative;aspect-ratio:1/1;overflow:hidden;border-radius:6px;border:1px solid #ddd;background:#fff;">';
      html += '<img src="' + (item.url || '') + '" alt="Imagen" '
           + 'style="width:100%;height:100%;object-fit:cover;display:block;" '
           + 'onerror="this.parentElement.style.display=\'none\'">';
      if (item.text) {
        html += '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.5);'
             + 'color:#fff;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
             + item.text + '</div>';
      }
      html += '</div>';
    });

    html += '</div></div>';
    anchor.insertAdjacentHTML('afterend', html);
  }"""


def read_file(path):
    if not os.path.exists(path):
        print(f"[ERROR] Archivo no encontrado: {path}")
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def patch_backend():
    content = read_file(SERVER_FILE)

    if "MULTIMEDIA HANDLER V4" in content:
        print("[SKIP] Backend ya contiene V4 (idempotencia OK).")
        return

    start_idx = content.find(OLD_BACKEND)
    if start_idx == -1:
        print("[ERROR] No se encontró el marcador '// --- MULTIMEDIA HANDLER V3 ---' en server.js")
        sys.exit(1)

    end_marker_idx = content.find(OLD_BACKEND_END, start_idx)
    if end_marker_idx == -1:
        print("[ERROR] No se encontró el marcador '// --- FIN MULTIMEDIA HANDLER V3 ---' en server.js")
        sys.exit(1)

    end_idx = end_marker_idx + len(OLD_BACKEND_END)
    old_block = content[start_idx:end_idx]
    content = content.replace(old_block, NEW_BACKEND, 1)

    write_file(SERVER_FILE, content)
    print("[OK] Backend parcheado: MULTIMEDIA HANDLER V3 → V4.")


def patch_frontend():
    content = read_file(FRONTEND_FILE)

    if "grid-template-columns:repeat(auto-fill" in content:
        print("[SKIP] Frontend ya contiene la galería V4 (idempotencia OK).")
        return

    start_idx = content.find(OLD_FRONTEND_START)
    if start_idx == -1:
        print("[ERROR] No se encontró 'function renderMediaGallery(lead) {' en index.html")
        sys.exit(1)

    depth = 0
    end_idx = start_idx
    i = start_idx
    while i < len(content):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                end_idx = i + 1
                break
        i += 1

    if end_idx == start_idx:
        print("[ERROR] No se pudo determinar el cierre de renderMediaGallery.")
        sys.exit(1)

    old_function = content[start_idx:end_idx]
    content = content.replace(old_function, NEW_FRONTEND, 1)

    write_file(FRONTEND_FILE, content)
    print("[OK] Frontend parcheado: renderMediaGallery actualizada con galería visual.")


def validate_syntax():
    print("\n[CHECK] Ejecutando: node --check server.js")
    result = subprocess.run(["node", "--check", SERVER_FILE], capture_output=True, text=True)
    if result.returncode == 0:
        print("[OK] server.js: sintaxis válida ✓")
    else:
        print("[ERROR] server.js tiene errores de sintaxis:")
        print(result.stderr)
        sys.exit(1)


if __name__ == "__main__":
    print("=" * 55)
    print("  SPRINT 5 — Patch Multimedia V4")
    print("=" * 55)
    patch_backend()
    patch_frontend()
    validate_syntax()
    print("\n[DONE] Patch completado exitosamente.")

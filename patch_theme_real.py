import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Borramos la cagada anterior
html = re.sub(r'<style id="zara-corporate-theme">.*?</style>', '', html, flags=re.DOTALL)

corporate_css = """
<style id="zara-corporate-theme">
  /* Redefinición de variables base */
  :root {
    --bg: #f1f5f9 !important;
    --ac: #2563eb !important;
  }
  
  body, html { background-color: var(--bg) !important; }

  /* Sidebar (.sb) - Estilo Dark Corporate SaaS */
  .sb {
    background: #0f172a !important;
    border-right: 1px solid #1e293b !important;
  }
  .sb h1 { 
    background: none !important; 
    -webkit-text-fill-color: #f8fafc !important; 
    color: #f8fafc !important; 
  }
  .sb .who { color: #94a3b8 !important; }
  .sb nav button { color: #cbd5e1 !important; border-radius: 8px !important; }
  .sb nav button:hover { background: #1e293b !important; color: #ffffff !important; }
  .sb nav button.active { 
    background: #2563eb !important; 
    color: #ffffff !important; 
    box-shadow: none !important; 
  }
  .sb .lout { color: #94a3b8 !important; border-color: #334155 !important; }
  .sb .lout:hover { background: #1e293b !important; color: #fff !important; }

  /* Tarjetas y Contenedores (.sb2, .fc, .tc, .tb, etc) */
  .sb2, .fc, .tc, .cfs, .tb, .xe, .ct, .pt, .kbc, .inv-card, .kpi-card {
    background: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 12px !important;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03) !important;
  }

  /* Inputs, Selects, Textareas */
  input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]), select, textarea {
    background-color: #f8fafc !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 8px !important;
    transition: all 0.2s ease !important;
  }
  input:focus, select:focus, textarea:focus {
    outline: none !important;
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
    background-color: #ffffff !important;
  }

  /* Botones de acción principal (.bp, .snb, .pm) */
  .bp, .snb, .pm, button[style*="background:var(--ac)"] {
    background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%) !important;
    border: none !important;
    border-radius: 8px !important;
    color: #ffffff !important;
    box-shadow: 0 4px 6px -1px rgba(37,99,235,0.2) !important;
    transition: transform 0.2s, box-shadow 0.2s !important;
  }
  .bp:hover, .snb:hover, .pm:hover {
    transform: translateY(-1px) !important;
  }

  /* Modal de Ficha (.mo) */
  .mo {
    border-radius: 16px !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
    border: 1px solid #cbd5e1 !important;
  }
  
  /* Cajas de Chat y Paneles Internos */
  .cchat, #tradein-section, #media-gallery-section, .ca2 > div {
    background: #ffffff !important;
    border-radius: 12px !important;
    border: 1px solid #e2e8f0 !important;
  }
  .cbx { background: #f8fafc !important; border-color: #e2e8f0 !important; }
</style>
"""

if re.search(r'</body>', html, re.IGNORECASE):
    html = re.sub(r'</body>', corporate_css + '\n</body>', html, count=1, flags=re.IGNORECASE)
else:
    html += corporate_css

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

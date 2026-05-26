import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(r'<style id="zara-corporate-theme">.*?</style>', '', html, flags=re.DOTALL)

corporate_css = """
<style id="zara-corporate-theme">
  body, html { 
    background-color: #f1f5f9 !important; 
    color: #1e293b !important;
    -webkit-font-smoothing: antialiased !important;
  }
  
  .card, .modal-content, .panel, [class*="bg-white"], [style*="background: white"], [style*="background:#fff"], [style*="background-color: white"] {
    background-color: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 12px !important;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03) !important;
  }

  input[type="text"], input[type="number"], input[type="date"], textarea, select, .form-control {
    background-color: #f8fafc !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 8px !important;
    color: #0f172a !important;
    transition: all 0.2s ease !important;
  }
  input:focus, textarea:focus, select:focus, .form-control:focus {
    outline: none !important;
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
    background-color: #ffffff !important;
  }

  button, .btn {
    border-radius: 8px !important;
    transition: all 0.2s ease !important;
    border: none !important;
  }
  button:hover, .btn:hover { 
    transform: translateY(-1px) !important; 
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1) !important; 
  }
  
  button[style*="#20c997"], .btn-success, button[style*="background: #20c997"] {
    background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%) !important;
    color: #ffffff !important;
  }
  button[style*="#17a2b8"], .btn-info {
    background: linear-gradient(135deg, #0f172a 0%, #334155 100%) !important;
    color: #ffffff !important;
  }
  button[style*="#8b5cf6"] {
    background: linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%) !important;
    color: #ffffff !important;
  }

  .sidebar, [style*="background: #343a40"], [style*="background:#343a40"], .bg-dark {
    background-color: #0f172a !important;
    border-right: 1px solid #1e293b !important;
  }
  .sidebar a, .sidebar div, .bg-dark a { color: #f8fafc !important; }

  #tradein-section, #media-gallery-section, .cchat {
    border-radius: 12px !important;
    border: 1px solid #e2e8f0 !important;
    background: #ffffff !important;
  }
  .cchat { background: #f8fafc !important; }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
  ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
</style>
"""

if re.search(r'</body>', html, re.IGNORECASE):
    html = re.sub(r'</body>', corporate_css + '\n</body>', html, count=1, flags=re.IGNORECASE)
    print("Tema corporativo inyectado al final del documento (Prioridad Máxima).")
else:
    html += corporate_css
    print("Tema corporativo inyectado (Fallback).")

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

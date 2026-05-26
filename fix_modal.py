import sys

path = 'public/index.html'
try:
    with open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    
    old_line = "const ti = lead.tradeIn || {};"
    new_line = "const modalId = typeof id !== 'undefined' ? id : null; const lead = typeof l !== 'undefined' ? l : S.leads.find(x => x.id == modalId); if(!lead) return; const ti = lead.tradeIn || {};"
    
    if old_line in src:
        src = src.replace(old_line, new_line)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(src)
        print("✅ Variable 'lead' definida y reparada en el HTML.")
    else:
        print("⚠️ No se encontró la línea con el error. Si hiciste el rollback, corre 'python3 patch_tasacion.py' de nuevo y luego vuelve a correr este comando.")
except Exception as e:
    print(f"Error: {e}")

import re
import os

with open('server.js', 'r', encoding='utf-8') as f:
    src = f.read()

# Buscamos la línea exacta del reset antiguo y la pisamos con la versión nuclear
# El original decía: ...ld[tenant][idx].lastClientTs=_rn;ld[tenant][idx].notes=(ld[tenant][idx].notes||[]).concat({content:'🔄 Historial reseteado por comando',author:'Sistema',ts:Date.now()});...

old_reset_pattern = re.compile(r'if\s*\(body\.trim\(\)\.toLowerCase\(\)\s*===\s*\'/reset\'\)\s*\{[^\}]+\}')

new_reset = """if(body.trim().toLowerCase()==='/reset'){
    const _rn=new Date().toISOString();
    ld[tenant][idx].chatHistory=[];
    ld[tenant][idx].intentSignal='NONE';
    ld[tenant][idx].keywordAlertSent=false;
    ld[tenant][idx].status='Nuevo';
    ld[tenant][idx].alertLevel='none';
    ld[tenant][idx].unread=true;
    ld[tenant][idx].reassigned=false;
    ld[tenant][idx].reassignedAt=null;
    ld[tenant][idx].adminReassignAlertSent=false;
    ld[tenant][idx].riskAlertSent=false;
    ld[tenant][idx].followUpSent=false;
    ld[tenant][idx].nextAction=null;
    ld[tenant][idx].ai_summary='';
    ld[tenant][idx].lastInteraction=_rn;
    ld[tenant][idx].lastClientTs=_rn;
    
    // AQUÍ ESTÁ LA MAGIA NUCLEAR:
    ld[tenant][idx].media = []; // Borra toda la galería de fotos
    ld[tenant][idx].notes = [{content:'🔄 Ficha reseteada a cero por comando /reset',author:'Sistema',ts:Date.now()}]; // Borra las notas viejas y deja solo el aviso
    
    // Si queremos borrar también los datos del auto en retoma (opcional, pero útil)
    if (ld[tenant][idx].tradeIn) {
        ld[tenant][idx].tradeIn = {make:'', model:'', year:'', color:'', status:'Pendiente', offer:0};
    }

    await tWrite(F.leads,tenant,ld[tenant]);
    await sendWA(from,'🔄 Memoria y ficha borradas. ¡Empecemos de cero! 🚗');
    return;
}"""

if old_reset_pattern.search(src):
    src = old_reset_pattern.sub(new_reset, src)
    print("✅ Backend: Comando /reset actualizado a nivel Nuclear.")
else:
    print("⚠️ No se encontró el bloque /reset original.")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(src)

const fs = require('fs');

console.log('Iniciando parcheo quirúrgico...');

let server = fs.readFileSync('server.js', 'utf8');

if (!server.includes('/api/leads/bulk-delete')) {
    server = server.replace(
        "app.delete('/api/leads/wipe',auth('admin')",
        "app.post('/api/leads/bulk-delete',auth('admin'),async(req,res)=>{const ids=req.body.ids||[];if(!ids.length)return res.status(400).json({error:'vacio'});let leads=await tRead(F.leads,req.tenant);const before=leads.length;leads=leads.filter(l=>!ids.includes(l.id));await tWrite(F.leads,req.tenant,leads);res.json({ok:true,deleted:before-leads.length});});\n\napp.delete('/api/leads/wipe',auth('admin')"
    );
}

server = server.replace(
    /for\s*\(\s*const\s*staff\s*of\s*STAFF_TASACION\s*\)\s*\{\s*await\s*sendWA\(staff\.phone,\s*texto\);\s*\}/g,
    "const users = await tRead(F.users, tenant, []);\n    const admins = users.filter(u => u.role === 'admin' && u.status === 'Activo');\n    for (const admin of admins) {\n      if (admin.phone) await sendWA(admin.phone, texto);\n    }"
);

fs.writeFileSync('server.js', server);
console.log('✔ server.js blindado');

let html = fs.readFileSync('public/index.html', 'utf8');

html = html.replace(/updateNotifBadges\(\);/g, 'checkNotifications();');
html = html.replace(/html,body\{overflow-x:hidden;width:100%\}/g, 'html,body{width:100%;overflow-x:clip}');

if (!html.includes('btnBulkDelete')) {
    html = html.replace(
        '<button id="btnNuevoLead"',
        '<button id="btnBulkDelete" onclick="bulkDelete()" style="display:none;background:var(--bd2);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;margin-right:10px">🗑 Borrar Seleccionados</button>\n<button id="btnNuevoLead"'
    );

    html = html.replace(
        "const gc='grid-template-columns:8px 8px 11px 1.3fr .9fr 1.1fr .85fr .85fr 1.2fr .75fr';",
        "const gc='grid-template-columns:22px 8px 8px 11px 1.3fr .9fr 1.1fr .85fr .85fr 1.2fr .75fr';"
    );

    html = html.replace(
        "const hd=`<div class=\"tr2 hd\" style=\"${gc}\"><div></div><div></div><div></div>",
        "const hd=`<div class=\"tr2 hd\" style=\"${gc}\"><div></div><div></div><div></div><div></div>"
    );

    html = html.replace(
        "const rows = leads.length ? leads.map(l=>`<div class=\"tr2\" style=\"${gc}\" data-id=\"${l.id}\">${l.unread?'<div class=\"ud\"></div>':'<div></div>'}",
        "const isAdmin = S.user && S.user.role === 'admin';\n  const rows = leads.length ? leads.map(l=>`<div class=\"tr2\" style=\"${gc}\" data-id=\"${l.id}\">${isAdmin ? '<div style=\"display:flex;align-items:center;justify-content:center\"><input type=\"checkbox\" class=\"blk-chk\" value=\"'+l.id+'\" style=\"accent-color:var(--bd2);cursor:pointer;width:14px;height:14px\" onclick=\"event.stopPropagation()\"></div>' : '<div></div>'}${l.unread?'<div class=\"ud\"></div>':'<div></div>'}"
    );

    html = html.replace(
        '</body>',
        `<script>
function bulkDelete() {
  const checks = document.querySelectorAll('.blk-chk:checked');
  const ids = Array.from(checks).map(c => Number(c.value));
  if(!ids.length) return toast('Selecciona al menos un lead', true);
  if(!confirm('¿Borrar ' + ids.length + ' leads de forma permanente?')) return;
  api('POST', '/api/leads/bulk-delete', {ids}).then(r => {
    toast('✅ Borrados: ' + r.deleted);
    refresh();
  }).catch(e => toast(e.message, true));
}
setInterval(()=>{
  const btn = document.getElementById('btnBulkDelete');
  if(btn) btn.style.display = (S.user && S.user.role === 'admin') ? 'inline-flex' : 'none';
}, 1000);
</script>\n</body>`
    );
}

fs.writeFileSync('public/index.html', html);
console.log('✔ public/index.html actualizado');
console.log('¡Parches aplicados a la perfección!');

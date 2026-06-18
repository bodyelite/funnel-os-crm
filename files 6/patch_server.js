const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

const F1 = `app.get('/api/dashboard/kpis',auth('admin'),async(req,res)=>{`;
const R1 = `app.get('/api/dashboard/vendedor',auth('admin','vendedor'),async(req,res)=>{
  const all=await applySlaRules(req.tenant);const{s,e}=parseDateRange(req.query.start,req.query.end);
  let leads=(s!==null||e!==null)?all.filter(l=>inRange(l,s,e)):all;
  if(req.user.role==='vendedor') leads=leads.filter(l=>l.assignedTo===req.user.username);
  const nuevos=leads.filter(l=>l.status==='Nuevo');const closed=leads.filter(l=>l.status==='Cerrado').length;
  const now=Date.now();const minOf=l=>(now-new Date(l.lastClientTs||l.lastInteraction).getTime())/60000;
  const avgResp=nuevos.length?Math.round(nuevos.reduce((a,l)=>a+minOf(l),0)/nuevos.length):0;
  res.json({total:leads.length,active:leads.filter(l=>!FINAL_ST.has(l.status)).length,closed,unread:leads.filter(l=>l.unread).length,sla:{fresh:nuevos.filter(l=>l.alertLevel==='fresh').length,risk:nuevos.filter(l=>l.alertLevel==='risk').length,critical:nuevos.filter(l=>l.alertLevel==='critical').length,reassigned:leads.filter(l=>l.reassigned).length},avgResponseMin:avgResp,convRate:leads.length?((closed/leads.length)*100).toFixed(1):'0.0',byStatus:{nuevo:nuevos.length,contactado:leads.filter(l=>l.status==='Contactado').length,calificado:leads.filter(l=>l.status==='Calificado').length,agendado:leads.filter(l=>l.status==='Agendado').length,negociacion:leads.filter(l=>l.status==='Negociación').length,seguimiento:leads.filter(l=>l.status==='Seguimiento').length,cerrado:closed,perdido:leads.filter(l=>['Abandonado','Perdido'].includes(l.status)).length}});
});
app.get('/api/dashboard/kpis',auth('admin'),async(req,res)=>{`;

if(!code.includes('/api/dashboard/vendedor')){code=code.replace(F1,R1);console.log('✅ Endpoint dashboard/vendedor');}
else console.log('⚠️ Ya existe');
fs.writeFileSync(file,code,'utf8');
console.log('✅ server.js guardado');

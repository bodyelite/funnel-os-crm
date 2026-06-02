#!/usr/bin/env python3
import os, shutil

HTML = "public/index.html"
if not os.path.exists(HTML):
    print("ERROR: public/index.html no encontrado")
    raise SystemExit(1)

with open(HTML, "r", encoding="utf-8") as f:
    html = f.read()

shutil.copy(HTML, HTML + ".bak_notif")
changes = []

# ═══════════════════════════════════════════════════════════════
# FIX COMPLETO DEL SISTEMA DE NOTIFICACIONES
# ═══════════════════════════════════════════════════════════════

OLD_NOTIF = """// ── R5: Sonido y badge notificaciones por usuario ──────────────
let _lastUnread = 0;
let _audioCtx = null;

function getMyUnreadCount(){
  if(!S.leads||!S.user)return 0;
  return S.leads.filter(l=>{
    if(!l.unread)return false;
    if(S.user.role==='vendedor')return l.assignedTo===S.user.username;
    return true; // admin ve todos
  }).length;
}

function playNotifSound(){
  try{
    if(!_audioCtx)_audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const ctx=_audioCtx;
    // Simula el "ding" de WhatsApp: dos tonos cortos
    const times=[[0,.08,800,.3],[.1,.08,1000,.2]];
    times.forEach(([start,dur,freq,vol])=>{
      const o=ctx.createOscillator();
      const g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.type='sine';o.frequency.value=freq;
      g.gain.setValueAtTime(0,ctx.currentTime+start);
      g.gain.linearRampToValueAtTime(vol,ctx.currentTime+start+0.01);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+start+dur);
      o.start(ctx.currentTime+start);
      o.stop(ctx.currentTime+start+dur+0.05);
    });
  }catch(e){}
}

function updateBadge(count){
  // Actualizar titulo de pestaña
  const base='RMG CRM';
  document.title=count>0?`(${count}) ${base}`:base;
  // Badge en botón de Leads del sidebar
  const leadsBtn=document.querySelector('.sb nav button[data-view="leads"]');
  if(leadsBtn){
    let badge=leadsBtn.querySelector('.notif-badge');
    if(count>0){
      if(!badge){
        badge=document.createElement('span');
        badge.className='notif-badge';
        badge.style.cssText='background:#ef4444;color:#fff;border-radius:50%;font-size:10px;font-weight:700;padding:1px 5px;margin-left:6px;min-width:18px;text-align:center;display:inline-block;line-height:16px';
        leadsBtn.appendChild(badge);
      }
      badge.textContent=count>99?'99+':count;
    }else{
      if(badge)badge.remove();
    }
  }
  // PWA badge API si disponible
  if('setAppBadge' in navigator){
    if(count>0)navigator.setAppBadge(count).catch(()=>{});
    else navigator.clearAppBadge().catch(()=>{});
  }
}

function checkNotifications(){
  const count=getMyUnreadCount();
  if(count>_lastUnread){
    playNotifSound();
  }
  updateBadge(count);
  _lastUnread=count;
}

// Activar sonido con primer click (política de navegadores)
document.addEventListener('click',function initAudio(){
  try{_audioCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}
  document.removeEventListener('click',initAudio);
},{once:true});
// ── fin R5 ────────────────────────────────────────────────────"""

NEW_NOTIF = """// ── SISTEMA DE NOTIFICACIONES RMG ─────────────────────────────
let _lastUnreadIds = new Set();
let _audioCtx = null;
let _audioReady = false;
let _notifPollTimer = null;

// Inicializar AudioContext con el primer gesto del usuario
function initAudioCtx(){
  if(_audioReady)return;
  try{
    _audioCtx = new(window.AudioContext||window.webkitAudioContext)();
    if(_audioCtx.state==='suspended')_audioCtx.resume();
    _audioReady = true;
  }catch(e){ console.warn('[Audio]',e); }
}
['click','touchstart','keydown'].forEach(ev=>{
  document.addEventListener(ev, initAudioCtx, {once:false, passive:true});
});

function playNotifSound(){
  initAudioCtx();
  if(!_audioCtx||!_audioReady)return;
  try{
    if(_audioCtx.state==='suspended')_audioCtx.resume();
    // Tono doble estilo WhatsApp
    [[0, 0.09, 830, 0.35],[0.12, 0.09, 1050, 0.28]].forEach(([start,dur,freq,vol])=>{
      const o = _audioCtx.createOscillator();
      const g = _audioCtx.createGain();
      o.connect(g); g.connect(_audioCtx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      const t = _audioCtx.currentTime;
      g.gain.setValueAtTime(0, t+start);
      g.gain.linearRampToValueAtTime(vol, t+start+0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t+start+dur);
      o.start(t+start); o.stop(t+start+dur+0.05);
    });
  }catch(e){ console.warn('[Sound]',e); }
}

function getMyUnreads(){
  if(!S.leads||!S.user) return [];
  return S.leads.filter(l=>{
    if(!l.unread) return false;
    if(S.user.role==='vendedor') return l.assignedTo===S.user.username;
    return true;
  });
}

function updateBadge(count){
  // Título de pestaña
  document.title = count>0 ? `(${count}) RMG CRM` : 'RMG CRM';

  // Badge en TODOS los botones del sidebar que correspondan
  ['leads','dashboard'].forEach(view=>{
    const btn = document.querySelector(`.sb nav button[data-view="${view}"]`);
    if(!btn) return;
    let badge = btn.querySelector('.notif-badge');
    if(count>0 && view==='leads'){
      if(!badge){
        badge = document.createElement('span');
        badge.className = 'notif-badge';
        badge.style.cssText = [
          'background:#ef4444','color:#fff','border-radius:999px',
          'font-size:10px','font-weight:700','padding:2px 6px',
          'margin-left:5px','min-width:18px','height:18px',
          'text-align:center','display:inline-flex','align-items:center',
          'justify-content:center','line-height:1','flex-shrink:0',
          'box-shadow:0 0 0 2px var(--p)','animation:badgePulse 2s infinite'
        ].join(';');
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'space-between';
        btn.appendChild(badge);
      }
      badge.textContent = count>99?'99+':String(count);
    } else {
      if(badge) badge.remove();
    }
  });

  // Favicon badge (cambia el favicon dinámicamente)
  try{
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    // Fondo dark
    ctx.fillStyle = '#0f172a';
    ctx.roundRect(0,0,32,32,6);
    ctx.fill();
    // Texto RMG
    ctx.fillStyle = '#D4A843';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('RMG', 16, 22);
    if(count>0){
      // Badge rojo
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(26, 6, 7, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px Arial';
      ctx.fillText(count>9?'9+':String(count), 26, 9);
    }
    let link = document.querySelector("link[rel~='icon']");
    if(!link){ link=document.createElement('link'); link.rel='icon'; document.head.appendChild(link); }
    link.href = canvas.toDataURL();
  }catch(e){}

  // PWA Badge API
  if('setAppBadge' in navigator){
    count>0 ? navigator.setAppBadge(count).catch(()=>{}) : navigator.clearAppBadge().catch(()=>{});
  }
}

function checkNotifications(){
  const unreads = getMyUnreads();
  const count = unreads.length;
  const currentIds = new Set(unreads.map(l=>l.id+'_'+l.lastClientTs));

  // Detectar mensajes NUEVOS que no estaban antes
  const hasNew = [...currentIds].some(id=>!_lastUnreadIds.has(id));
  if(hasNew && _lastUnreadIds.size>0){
    playNotifSound();
    // Vibración en móvil
    if('vibrate' in navigator) navigator.vibrate([200,100,200]);
    // Notificación del sistema si hay permiso
    showPushNotif(unreads.filter(l=>{
      const k=l.id+'_'+l.lastClientTs;
      return !_lastUnreadIds.has(k);
    }));
  }
  _lastUnreadIds = currentIds;
  updateBadge(count);
}

function showPushNotif(newLeads){
  if(Notification.permission!=='granted') return;
  if(document.visibilityState==='visible') return; // solo si app en background
  newLeads.slice(0,3).forEach(l=>{
    const lastMsg = (l.chatHistory||[]).filter(m=>m.role==='user').slice(-1)[0];
    const body = lastMsg?.content?.slice(0,80)||'Nuevo mensaje';
    try{
      new Notification('RMG CRM — '+l.name,{
        body,
        icon:'/icon-192.svg',
        badge:'/icon-192.svg',
        tag:'lead-'+l.id,
        renotify:true,
        silent:false,
      });
    }catch(e){}
  });
}

// Pedir permiso de notificaciones al hacer login
function requestNotifPermission(){
  if('Notification' in window && Notification.permission==='default'){
    Notification.requestPermission().then(p=>{
      console.log('[Notif] Permiso:',p);
    });
  }
}

// CSS animación badge
(function injectBadgeCSS(){
  const s=document.createElement('style');
  s.textContent=`
    @keyframes badgePulse{
      0%,100%{box-shadow:0 0 0 2px var(--p),0 0 0 3px #ef4444}
      50%{box-shadow:0 0 0 2px var(--p),0 0 0 5px rgba(239,68,68,.3)}
    }
    .notif-badge{transition:transform .2s}
    .notif-badge:not(:empty){transform:scale(1)}
  `;
  document.head.appendChild(s);
})();
// ── fin sistema notificaciones ─────────────────────────────────"""

if OLD_NOTIF in html:
    html = html.replace(OLD_NOTIF, NEW_NOTIF)
    changes.append("FIX: sistema notificaciones reescrito completo")
else:
    # Si no encuentra el bloque exacto, insertar antes del cierre del último script
    if 'playNotifSound' in html:
        print("WARN: bloque notificaciones anterior encontrado pero no exacto — reemplazando por búsqueda parcial")
        import re
        html = re.sub(
            r'// ── R5: Sonido.*?// ── fin R5 ────+',
            NEW_NOTIF,
            html,
            flags=re.DOTALL
        )
        changes.append("FIX: notificaciones reemplazadas por regex")
    else:
        # No existe — insertar
        html = html.replace(
            'function installApp(){',
            NEW_NOTIF + '\nfunction installApp(){'
        )
        changes.append("FIX: notificaciones insertadas fresh")

# Llamar requestNotifPermission al entrar a la app
OLD_ENTER_APP = "async function enterApp(){$('lv').style.display='none';$('av').style.display='grid';"
NEW_ENTER_APP = "async function enterApp(){$('lv').style.display='none';$('av').style.display='grid';requestNotifPermission();"
if OLD_ENTER_APP in html:
    html = html.replace(OLD_ENTER_APP, NEW_ENTER_APP)
    changes.append("FIX: pide permiso notificaciones al entrar")
else:
    print("WARN: enterApp no encontrado exacto")

# Polling más agresivo: 4 segundos en vez de 8
OLD_POLL = "S.pollTimer=setInterval(refresh,8000);"
NEW_POLL = "S.pollTimer=setInterval(refresh,4000);"
if OLD_POLL in html:
    html = html.replace(OLD_POLL, NEW_POLL)
    changes.append("FIX: polling reducido a 4 segundos")
else:
    print("WARN: pollTimer no encontrado")

with open(HTML, "w", encoding="utf-8") as f:
    f.write(html)

print("\n✅ Patch aplicado:")
for c in changes:
    print(f"  ✓ {c}")
print(f"\n📁 Backup: {HTML}.bak_notif")

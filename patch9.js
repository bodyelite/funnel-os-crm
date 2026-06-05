const fs = require('fs');

console.log('Iniciando cirugia fina para Web Push en iOS...');

const swCode = `self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(clients.claim()); });

self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        let isFocused = false;
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].visibilityState === 'visible') {
            isFocused = true; break;
          }
        }
        if (!isFocused) {
          return self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon-192.svg',
            badge: '/icon-192.svg',
            vibrate: [200, 100, 200],
            data: { url: '/' }
          });
        }
      })
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) { client = clientList[i]; }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});`;

fs.writeFileSync('public/sw.js', swCode);
console.log('✔ public/sw.js creado (Modo Fantasma)');

let html = fs.readFileSync('public/index.html', 'utf8');

html = html.replace(/Promise\.reject\('SW Desactivado por Gerencia'\)/g, "navigator.serviceWorker.register('/sw.js')");

const nukeCacheOld = `// Matar cualquier Service Worker que ya este instalado en los celulares de los vendedores
if('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for(let reg of regs) { reg.unregister(); console.log('SW aniquilado'); }
  });
}`;
const swCleanInit = `// Inicializar Service Worker Limpio
if('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    reg.update();
    console.log('SW Limpio Instalado');
  });
}`;
html = html.replace(nukeCacheOld, swCleanInit);

const oldReqNotifRegex = /function requestNotifPermission\(\)\{[\s\S]*?Notification\.requestPermission\(\);\s*\}/;

const newReqNotif = `function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
}
async function requestNotifPermission(){
  if(typeof Notification!=='undefined' && Notification.permission==='default'){
    await Notification.requestPermission();
  }
  if(typeof Notification!=='undefined' && Notification.permission==='granted' && 'serviceWorker' in navigator){
    navigator.serviceWorker.ready.then(async reg => {
      try {
        let sub = await reg.pushManager.getSubscription();
        if(!sub){
           const r = await fetch('/api/push/vapid-public-key', {headers:{'X-Auth-Token':S.token}});
           if(!r.ok) return;
           const d = await r.json();
           const convertedVapidKey = urlBase64ToUint8Array(d.publicKey);
           sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedVapidKey });
        }
        if(S.token) api('POST', '/api/push/subscribe', { subscription: sub }).catch(()=>{});
      } catch(e) { console.log('Push sub error', e); }
    });
  }
}`;

if (oldReqNotifRegex.test(html)) {
    html = html.replace(oldReqNotifRegex, newReqNotif);
}

fs.writeFileSync('public/index.html', html);
console.log('✔ public/index.html actualizado (Suscripcion Push Inyectada)');
console.log('¡Cirugia finalizada!');

const CACHE='rmg-crm-v3';
const ASSETS=['/','/index.html','/icon-192.svg','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||e.request.url.includes('/api/'))return;e.respondWith(fetch(e.request).then(res=>{const c=res.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));return res;}).catch(()=>caches.match(e.request)));});
self.addEventListener('push',e=>{
  let data={title:'RMG CRM',body:'Nuevo mensaje',count:1};
  try{data=e.data.json();}catch(_){}
  e.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.svg',badge:'/icon-192.svg',tag:'rmg-lead',renotify:true,silent:false,vibrate:[200,100,200],data:{count:data.count||1}}).then(()=>navigator.setAppBadge?navigator.setAppBadge(data.count||1).catch(()=>{}):Promise.resolve()));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if(c.url.includes(self.location.origin)){c.focus();c.postMessage({type:'NOTIF_CLICK'});return;}}return clients.openWindow('/');}));
});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='CLEAR_BADGE'&&navigator.clearAppBadge)navigator.clearAppBadge().catch(()=>{});});

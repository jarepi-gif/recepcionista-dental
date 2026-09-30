'use strict';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let data;try{data=event.data.json();}catch{return;}
  const url=new URL(data.url||'/bandeja',self.location.origin);
  if(url.origin!==self.location.origin||url.pathname!=='/bandeja')return;
  await self.registration.showNotification(data.title||'Nuevo mensaje en Thera',{body:data.body||'Abre la bandeja para revisar.',tag:data.eventId||'thera-inbox',renotify:true,silent:false,vibrate:[250,120,250],data:{url:url.href},requireInteraction:true});
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients)if(new URL(client.url).pathname==='/bandeja')client.postMessage({type:'thera-inbound',eventId:data.eventId});
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();event.waitUntil((async()=>{
    const url=new URL(event.notification.data?.url||'/bandeja',self.location.origin);if(url.origin!==self.location.origin||url.pathname!=='/bandeja')return;
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(c=>new URL(c.url).pathname==='/bandeja');
    if(client){await client.navigate(url.href);await client.focus();}else await self.clients.openWindow(url.href);
  })());
});

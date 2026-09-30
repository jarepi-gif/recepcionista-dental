const crypto=require('node:crypto');
const DEVICE_PREFIX='thera-device-';
function validateSubscription(subscription) {
  const endpoint=new URL(subscription?.endpoint||'');
  const host=endpoint.hostname;
  if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.port || !['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host) && !host.endsWith('.notify.windows.com'))throw new Error('Proveedor de avisos no permitido');
  if(!/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys?.p256dh||'')||!/^[A-Za-z0-9_-]{16,40}$/.test(subscription.keys?.auth||''))throw new Error('Suscripción inválida');
  return {endpoint:endpoint.href,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
}
function deviceKey(endpoint){return DEVICE_PREFIX+crypto.createHash('sha256').update(endpoint).digest('hex');}
function createPushService(client,origin,pushOverride) {
  const push=pushOverride||require('web-push');
  const documents=client.sync.v1.services('default').documents;
  let keyPromise;
  async function keys() {
    if(!keyPromise)keyPromise=(async()=>{
      try{return (await documents('thera-vapid-keys-v1').fetch()).data;}
      catch(e){if(e.status!==404)throw e;const generated=push.generateVAPIDKeys();try{return (await documents.create({uniqueName:'thera-vapid-keys-v1',data:generated})).data;}catch(createError){if(createError.status!==409)throw createError;return (await documents('thera-vapid-keys-v1').fetch()).data;}}
    })().catch(e=>{keyPromise=null;throw e;});
    return keyPromise;
  }
  async function subscribe(value) {
    const subscription=validateSubscription(value);const data={subscription,active:true,createdAt:new Date().toISOString()};
    try{await documents.create({uniqueName:deviceKey(subscription.endpoint),data});}catch(e){if(e.status!==409)throw e;await documents(deviceKey(subscription.endpoint)).update({data});}
    return subscription;
  }
  async function send(payload) {
    const devices=(await documents.list({limit:1000})).filter(d=>d.uniqueName?.startsWith(DEVICE_PREFIX)&&d.data.active);
    if(!devices.length)return {devices:0,accepted:0};const vapid=await keys();
    const results=await Promise.allSettled(devices.map(async device=>{
      try{return await push.sendNotification(device.data.subscription,JSON.stringify(payload),{vapidDetails:{subject:'mailto:jarepi@gmail.com',...vapid},TTL:86400,urgency:'high',timeout:8000});}
      catch(error){if([404,410].includes(error.statusCode))await documents(device.uniqueName).update({data:{...device.data,active:false}});throw error;}
    }));
    return {devices:devices.length,accepted:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length};
  }
  async function notifyInbound(body) {
    const eventId=String(body.MessageSid||'');if(!/^SM[a-fA-F0-9]{32}$/.test(eventId))return {skipped:true};
    const claim='thera-push-event-'+eventId;
    try{await documents.create({uniqueName:claim,data:{state:'pending'},ttl:172800});}catch(e){if(e.status!==409)throw e;return {duplicate:true};}
    const result=await send({title:'Nuevo mensaje en Thera',body:'Abre la conversación para atender al paciente.',eventId,url:origin+'/bandeja?phone='+encodeURIComponent(body.From)});
    await documents(claim).update({data:{state:result.accepted?'accepted':'no_delivery',...result}});
    return result;
  }
  return {keys,subscribe,send,notifyInbound};
}
module.exports={createPushService,validateSubscription,deviceKey};

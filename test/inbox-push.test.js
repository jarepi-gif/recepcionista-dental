const {test}=require('node:test');const assert=require('node:assert/strict');
const {createPushService,validateSubscription}=require('../inbox-push');
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}};
function fixture(){
 const rows=new Map();const documents=name=>({fetch:async()=>{if(!rows.has(name))throw {status:404};return rows.get(name);},update:async({data})=>{const value={...rows.get(name),data};rows.set(name,value);return value;}});
 documents.create=async({uniqueName,data})=>{if(rows.has(uniqueName))throw {status:409};const row={uniqueName,data};rows.set(uniqueName,row);return row;};documents.list=async()=>[...rows.values()];
 return {client:{sync:{v1:{services:()=>({documents})}}},rows};
}
test('push subscriptions restrict endpoints to real notification providers',()=>{
 assert.equal(validateSubscription(subscription).endpoint,subscription.endpoint);
 assert.throws(()=>validateSubscription({...subscription,endpoint:'https://127.0.0.1/internal'}));
 assert.throws(()=>validateSubscription({...subscription,endpoint:'http://fcm.googleapis.com/test'}));
});
test('registered devices receive only one push per inbound message with a private conversation link',async()=>{
 const f=fixture();let delivered=0,payload;const push={generateVAPIDKeys:()=>({publicKey:'public',privateKey:'private'}),sendNotification:async(_,data)=>{delivered++;payload=JSON.parse(data);return {statusCode:201};}};
 const service=createPushService(f.client,'https://example.com',push);await service.subscribe(subscription);
 const body={MessageSid:'SM'+'a'.repeat(32),From:'whatsapp:+525500000001',Body:'Mensaje sensible'};
 assert.equal((await service.notifyInbound(body)).accepted,1);assert.equal((await service.notifyInbound(body)).duplicate,true);assert.equal(delivered,1);
 assert.match(payload.url,/\/bandeja\?phone=/);assert.doesNotMatch(payload.body,/Mensaje sensible/);
 const restored=createPushService(f.client,'https://example.com',push);assert.deepEqual(await restored.keys(),await service.keys());
});
test('expired notification subscriptions are disabled without affecting other devices',async()=>{
 const f=fixture();const push={generateVAPIDKeys:()=>({publicKey:'public',privateKey:'private'}),sendNotification:async()=>{throw {statusCode:410};}};
 const service=createPushService(f.client,'https://example.com',push);await service.subscribe(subscription);const result=await service.send({title:'Prueba'});assert.equal(result.failed,1);
 assert.equal((await service.send({title:'Otra prueba'})).devices,0);
});

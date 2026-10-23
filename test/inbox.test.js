const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const twilio=require('twilio');
const {InboxStore,installInbox,phoneNumber}=require('../inbox');

function fakeClient(){
  const records=new Map();let conflict=false;
  const documents=name=>({fetch:async()=>{if(!records.has(name))throw {status:404};return structuredClone(records.get(name));},update:async({ifMatch,data})=>{const existing=records.get(name);if(conflict){conflict=false;existing.revision='2';existing.data.mode='human';throw {status:412};}if(ifMatch && ifMatch!==existing.revision)throw {status:412};const next={...existing,data,revision:String(Number(existing.revision)+1)};records.set(name,next);return structuredClone(next);}});
  documents.create=async({uniqueName,data})=>{if(records.has(uniqueName))throw {status:409};const doc={uniqueName,data,revision:'1'};records.set(uniqueName,doc);return structuredClone(doc);};documents.list=async()=>[...records.values()].map(structuredClone);
  return {client:{sync:{v1:{services:()=>({documents})}}},conflict:()=>{conflict=true;}};
}
test('phone validation excludes arbitrary resource paths',()=>{assert.equal(phoneNumber('+525579113424'),'whatsapp:+525579113424');assert.throws(()=>phoneNumber('../../'));});
test('human takeover persists after store recreation and incoming messages',async()=>{const fake=fakeClient();const a=new InboxStore(fake.client);await a.inbound({From:'+525500000001',Body:'Hola',ProfileName:'Paciente'});await a.mutate('+525500000001',d=>({...d,mode:'human'}));const b=new InboxStore(fake.client);await b.inbound({From:'+525500000001',Body:'Otro mensaje'});assert.equal(await b.mode('+525500000001'),'human');assert.equal((await b.ensure('+525500000001')).data.name,'Paciente');});
test('concurrent inbound metadata update preserves human takeover via CAS',async()=>{const fake=fakeClient();const store=new InboxStore(fake.client);await store.ensure('+525500000001');fake.conflict();await store.inbound({From:'+525500000001',Body:'Hola'});assert.equal(await store.mode('+525500000001'),'human');});
test('private API rejects unauthenticated requests, signed webhook validation binds URL',async()=>{
  const app=express();app.use(express.json());const env={INBOX_ENABLED:'true',INBOX_SECRET:'test-secret-at-least-thirty-two-characters',TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'test-auth',TWILIO_WHATSAPP_NUMBER:'+525579113424',INBOX_PUBLIC_URL:'https://example.com'};
  const inbox=installInbox(app,env);const server=await new Promise((resolve,reject)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.on('error',reject);});try{const url='http://127.0.0.1:'+server.address().port;
    const denied=await fetch(url+'/api/inbox/conversations');assert.equal(denied.status,401);
    const bad=await fetch(url+'/api/inbox/session',{method:'POST',headers:{'content-type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({password:env.INBOX_SECRET})});assert.equal(bad.status,401);
    const login=await fetch(url+'/api/inbox/session',{method:'POST',headers:{'content-type':'application/json',Origin:'https://example.com'},body:JSON.stringify({password:env.INBOX_SECRET})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
    const csrf=await fetch(url+'/api/inbox/mode',{method:'POST',headers:{'content-type':'application/json',Cookie:cookie.split(';')[0],Origin:'https://evil.example'},body:'{}'});assert.equal(csrf.status,403);
    const body={From:'whatsapp:+525500000001',Body:'Hola'};const signature=twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,'https://example.com/whatsapp',body);assert.equal(inbox.validate({body,originalUrl:'/whatsapp',headers:{'x-twilio-signature':signature}}),true);assert.equal(inbox.validate({body,originalUrl:'/wrong',headers:{'x-twilio-signature':signature}}),false);
  }finally{server.close();}
});

const envForTest={INBOX_ENABLED:'true',INBOX_SECRET:'test-secret-at-least-thirty-two-characters',TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'test-auth',TWILIO_WHATSAPP_NUMBER:'+525579113424',INBOX_PUBLIC_URL:'https://example.com'};
test('Aura rechecks persisted human takeover immediately before replying',async()=>{
  const fake=fakeClient(),app=express(),inbox=installInbox(app,envForTest,fake.client);const phone='whatsapp:+525500000001';await inbox.store.ensure(phone);
  await inbox.store.mutate(phone,data=>({...data,mode:'human'}));let xml='';const res={type(){return this;},send(body){xml=body;}};
  await inbox.respond({body:{From:phone}},res,'No debe salir');assert.doesNotMatch(xml,/<Message/);
  await inbox.store.mutate(phone,data=>({...data,mode:'aura'}));await inbox.respond({body:{From:phone}},res,'Respuesta de Aura');assert.match(xml,/Respuesta de Aura/);
});
test('human sends enforce window, takeover and durable deduplication',async()=>{
  const fake=fakeClient();let sends=0;fake.client.messages={list:async()=>[],create:async()=>{sends++;return {sid:'SM'+'a'.repeat(32),status:'queued'};}};
  const app=express();app.use(express.json());const inbox=installInbox(app,envForTest,fake.client);const phone='whatsapp:+525500000001';await inbox.store.inbound({From:phone,Body:'Hola'});
  const server=await new Promise((resolve,reject)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.on('error',reject);});
  try {const base='http://127.0.0.1:'+server.address().port+'/api/inbox/';const login=await fetch(base+'session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({password:envForTest.INBOX_SECRET})});
    const headers={'Content-Type':'application/json',Origin:'https://example.com','X-Inbox-Request':'1',Cookie:login.headers.get('set-cookie').split(';')[0]};
    const send=()=>fetch(base+'send',{method:'POST',headers,body:JSON.stringify({phone,body:'Hola, soy el Dr. Jaime',requestId:'a'.repeat(32)})});
    assert.equal((await send()).status,409);assert.equal(sends,0);
    await inbox.store.mutate(phone,d=>({...d,mode:'human',lastInbound:new Date(Date.now()-25*3600000).toISOString()}));assert.equal((await send()).status,409);assert.equal(sends,0);
    await inbox.store.mutate(phone,d=>({...d,lastInbound:new Date().toISOString()}));assert.equal((await send()).status,200);assert.equal(sends,1);assert.equal((await send()).status,409);assert.equal(sends,1);
  }finally{server.close();}
});

test('manual template requires human mode, consent and live approval; prevents duplicates without reopening window',async()=>{
 const fake=fakeClient(),{BODY,NAME}=require('../inbox-human-template');let approval='pending',sends=0;
 const contents=()=>({approvalFetch:()=>({fetch:async()=>({whatsapp:{status:approval}})})});
 contents.list=async()=>[{sid:'HX'+'a'.repeat(32),friendlyName:NAME,types:{'twilio/text':{body:BODY}}}];
 fake.client.content={v1:{contents}};fake.client.messages={create:async input=>{assert.equal(input.contentSid,'HX'+'a'.repeat(32));assert.equal(input.body,undefined);sends++;return {sid:'SM'+'b'.repeat(32),status:'queued'};}};
 const app=express();app.use(express.json());const inbox=installInbox(app,envForTest,fake.client),phone='whatsapp:+525500000001';
 await inbox.store.inbound({From:phone,MessageSid:'SMold',Body:'Hola'});
 const old=new Date(Date.now()-48*3600000).toISOString();await inbox.store.mutate(phone,d=>({...d,lastInbound:old}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
 const base='http://127.0.0.1:'+server.address().port+'/api/inbox/';
 assert.equal((await fetch(base+'human-template')).status,401);
 const login=await fetch(base+'session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({password:envForTest.INBOX_SECRET})});
 const headers={'Content-Type':'application/json',Origin:'https://example.com','X-Inbox-Request':'1',Cookie:login.headers.get('set-cookie').split(';')[0]};
 const send=(requestId='a'.repeat(32))=>fetch(base+'human-template/send',{method:'POST',headers,body:JSON.stringify({phone,requestId})});
 assert.equal((await send()).status,409);
 await inbox.store.mutate(phone,d=>({...d,mode:'human'}));assert.equal((await send()).status,409);
 await inbox.store.mutate(phone,d=>({...d,commercial:{whatsappFollowupConsent:{evidence:'Permiso real recibido'}}}));assert.equal((await send()).status,409);assert.equal(sends,0);
 approval='approved';await inbox.store.mutate(phone,d=>({...d,commercial:{...d.commercial,doNotContact:true}}));assert.equal((await send()).status,409);
 await inbox.store.mutate(phone,d=>({...d,commercial:{...d.commercial,doNotContact:false}}));
 assert.equal((await send()).status,200);assert.equal(sends,1);
 assert.equal((await send('b'.repeat(32))).status,409);assert.equal(sends,1);
 const data=(await inbox.store.ensure(phone)).data;assert.equal(data.mode,'human');assert.equal(data.lastInbound,old);assert.ok(data.humanSids.includes('SM'+'b'.repeat(32)));
 }finally{inbox.recovery.stop();server.close();}
});

test('manual template never retries uncertain provider sends',async()=>{
 const {install,BODY,NAME}=require('../inbox-human-template'),fake=fakeClient(),store=new InboxStore(fake.client);let sends=0;
 const contents=()=>({approvalFetch:()=>({fetch:async()=>({whatsapp:{status:'approved'}})})});contents.list=async()=>[{sid:'HX'+'a'.repeat(32),friendlyName:NAME,types:{'twilio/text':{body:BODY}}}];fake.client.content={v1:{contents}};fake.client.messages={list:async()=>[],create:async()=>{sends++;throw new Error('timeout');}};
 const phone='whatsapp:+525500000001';await store.mutate(phone,d=>({...d,mode:'human',lastInboundSid:'SMold',commercial:{whatsappFollowupConsent:{evidence:'Permiso'}}}));
 let handler;install({app:{get(){},post(path,fn){if(path.endsWith('/send'))handler=fn;}},route:fn=>fn,client:fake.client,store,from:'whatsapp:+525579113424',locked:async(_,fn)=>fn(),phoneNumber});
 const res={status(code){this.code=code;return this;},json(){}};
 await assert.rejects(handler({body:{phone,requestId:'a'.repeat(32)}},res),/timeout/);
 await handler({body:{phone,requestId:'b'.repeat(32)}},res);assert.equal(res.code,409);assert.equal(sends,1);
});

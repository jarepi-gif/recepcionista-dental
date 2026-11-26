'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {InboxStore,key}=require('../inbox');const {reconcile}=require('../inbox-window');const {createRecovery}=require('../recovery');
const phone='whatsapp:+525500000001',now=new Date('2026-11-26T18:00:00Z');
function fixture(data){
 const records=new Map([[key(phone),{uniqueName:key(phone),revision:'1',data:{phone,mode:'aura',lastInbound:'2026-11-26T17:00:00Z',lastInboundSid:'inbound',...data}}],['thera-recovery-settings-v1',{data:{enabled:true}}]]);
 let reads=0,updates=0,sends=0,conflict=null,claimHook=null;
 const documents=name=>({fetch:async()=>{if(name===key(phone))reads++;if(!records.has(name))throw {status:404};return structuredClone(records.get(name));},update:async({data,ifMatch})=>{updates++;let current=records.get(name);if(conflict){const hook=conflict;conflict=null;hook(current);current.revision=String(Number(current.revision)+1);}if(ifMatch&&ifMatch!==current.revision)throw {status:412};const next={...current,revision:String(Number(current.revision||0)+1),data};records.set(name,next);return structuredClone(next);}});
 documents.create=async({uniqueName,data})=>{if(records.has(uniqueName))throw {status:409};if(claimHook&&uniqueName.startsWith('thera-recovery-send-'))claimHook(records.get(key(phone)));const doc={uniqueName,revision:'1',data};records.set(uniqueName,doc);return structuredClone(doc);};
 documents.list=async()=>[...records.values()].map(x=>structuredClone(x));
 const client={sync:{v1:{services:()=>({documents})}},messages:Object.assign(()=>({fetch:async()=>({status:'read'})}),{create:async()=>{sends++;return {sid:'outbound',status:'queued'};}})};
 const store=new InboxStore(client);
 return {store,records,client,counts:()=>({reads,updates,sends}),conflict:hook=>{conflict=hook;},claim:hook=>{claimHook=hook;},data:()=>records.get(key(phone)).data};
}
test('window repair reuses its fetched revision: one read, one conditional update',async()=>{
 const f=fixture({mode:'human',lastInbound:'2026-11-24T17:00:00Z'});await reconcile(f.store,phone,[{from:phone,status:'received',sid:'latest',dateSent:now}],+now);
 assert.deepEqual(f.counts(),{reads:1,updates:1,sends:0});assert.equal(f.data().mode,'human');assert.equal(f.data().lastInboundSid,'latest');
});
test('stale revision refetches and preserves human takeover and newer inbound',async()=>{
 const f=fixture({});const snapshot={document:await f.store.ensure(phone)};f.conflict(doc=>{doc.data.mode='human';doc.data.lastInboundSid='newer';});
 await f.store.mutate(phone,d=>({...d,preview:'updated'}),snapshot);assert.equal(f.data().mode,'human');assert.equal(f.data().lastInboundSid,'newer');assert.equal(snapshot.document.revision,'3');assert.equal(f.counts().reads,2);
 await f.store.mutate(phone,d=>({...d,lastReviewedInbound:d.lastInbound}),snapshot);assert.equal(f.counts().reads,2);
});
test('snapshot for another phone cannot be used to overwrite the target',async()=>{
 const f=fixture({});await f.store.mutate(phone,d=>({...d,preview:'ok'}),{document:{uniqueName:key('whatsapp:+525500000002'),revision:'1',data:{mode:'human'}}});assert.equal(f.counts().reads,1);assert.equal(f.data().mode,'aura');
});
function recovery(f){return createRecovery({client:f.client,store:f.store,from:'whatsapp:+525500000009',env:{},push:{send:async()=>{}},locked:(_,fn)=>fn()});}
test('due follow-up sends once, rechecks state and reuses update revisions',async()=>{
 const f=fixture({recovery:{status:'queued',dueAt:'2026-11-26T17:30:00Z',origin:'agreed',baselineInboundSid:'inbound'}}),r=recovery(f);
 try{await r.tick(now);assert.equal(f.data().recovery.status,'sent');assert.deepEqual(f.counts(),{reads:2,updates:3,sends:1});await r.tick(now);assert.equal(f.counts().sends,1);}finally{r.stop();}
});
test('human takeover immediately before follow-up prevents patient send',async()=>{
 const f=fixture({recovery:{status:'queued',dueAt:'2026-11-26T17:30:00Z',baselineInboundSid:'inbound'}}),r=recovery(f);f.claim(doc=>{doc.data.mode='human';doc.revision='2';});
 try{await r.tick(now);assert.equal(f.counts().sends,0);assert.equal(f.data().mode,'human');assert.equal(f.data().recovery.status,'cancelled');}finally{r.stop();}
});
test('takeover during conditional sending update also prevents patient send',async()=>{
 const f=fixture({recovery:{status:'queued',dueAt:'2026-11-26T17:30:00Z',baselineInboundSid:'inbound'}}),r=recovery(f);f.conflict(doc=>{doc.data.mode='human';});
 try{await r.tick(now);assert.equal(f.counts().sends,0);assert.equal(f.data().mode,'human');assert.equal(f.data().recovery.status,'cancelled');}finally{r.stop();}
});
test('inbound follow-up enrollment reuses its fresh revision',async()=>{
 const f=fixture({commercial:{classification:'prospect'}}),r=recovery(f);try{await r.onInbound(phone);assert.equal(f.counts().reads,1);assert.equal(f.data().recovery.status,'queued');assert.equal(f.data().recovery.baselineInboundSid,'inbound');}finally{r.stop();}
});
test('uncertain provider response is never automatically resent',async()=>{
 const f=fixture({recovery:{status:'queued',dueAt:'2026-11-26T17:30:00Z'}});let attempts=0;f.client.messages.create=async()=>{attempts++;throw {code:20429};};const r=recovery(f);
 try{await r.tick(now);assert.equal(f.data().recovery.status,'uncertain');await r.tick(now);assert.equal(attempts,1);}finally{r.stop();}
});
for(const [name,data] of [['human',{mode:'human'}],['opt-out',{commercial:{doNotContact:true}}],['waiting',{recovery:{status:'queued',dueAt:'2026-11-27T18:00:00Z'}}],['outside window',{lastInbound:'2026-11-24T17:00:00Z'}]])test(name+' follow-up remains blocked',async()=>{
 const f=fixture({recovery:{status:'queued',dueAt:'2026-11-26T17:30:00Z'},...data}),r=recovery(f);try{await r.tick(now);assert.equal(f.counts().sends,0);}finally{r.stop();}
});

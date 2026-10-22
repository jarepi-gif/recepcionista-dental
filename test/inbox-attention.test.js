const {test}=require('node:test');
const assert=require('node:assert/strict');
const {flags,createAttention}=require('../inbox-attention');
const time='2026-10-22T18:00:00.000Z';
test('reading a conversation removes unread but keeps an unanswered request pending',()=>{
 const data={lastInbound:time};assert.deepEqual(flags(data),{unread:true,pending:true,unknown:false});
 data.lastReviewedInbound=time;assert.deepEqual(flags(data),{unread:false,pending:true,unknown:false});
 assert.deepEqual(flags(data,{time:'2026-10-22T18:01:00Z'}),{unread:false,pending:false,unknown:false});
 data.lastInbound='2026-10-22T18:02:00Z';assert.equal(flags(data,{time:'2026-10-22T18:01:00Z'}).pending,true);assert.equal(flags(data).unread,true);
});
test('Aura response does not resolve an explicit pending human handoff; incomplete history stays unknown',()=>{
 const data={lastInbound:time,commercial:{handoff:{status:'pending'}}};assert.equal(flags(data,{time:'2026-10-22T18:01:00Z'}).pending,true);
 assert.deepEqual(flags({lastInbound:time},null,false),{unread:true,pending:false,unknown:true});
 assert.deepEqual(flags({}),{unread:false,pending:false,unknown:false});
});
test('outbound index excludes failed and queued messages, canonicalizes Mexico numbers and caches results',async()=>{
 let calls=0;const rows=[{phone:'whatsapp:+5215500000001',lastInbound:time},{phone:'whatsapp:+5215500000002',lastInbound:time}];
 const client={messages:{list:async()=>{calls++;return [{to:'whatsapp:+525500000001',status:'delivered',dateSent:new Date('2026-10-22T18:01:00Z')},{to:rows[1].phone,status:'failed',dateSent:new Date('2026-10-22T18:01:00Z')},{to:rows[1].phone,status:'queued',dateCreated:new Date('2026-10-22T18:02:00Z')}];}}};
 const attention=createAttention({client,store:{list:async()=>rows},from:'whatsapp:+525579113424'});
 const list=await attention.list();assert.equal(list[0].attention.pending,false);assert.equal(list[1].attention.pending,true);await attention.list();assert.equal(calls,1);
});
test('review acknowledges only the viewed snapshot and never hides a newer inbound message',async()=>{
 let data={lastInbound:'2026-10-22T18:02:00Z'};
 const attention=createAttention({client:{},store:{mutate:async(_,fn)=>(data=fn(data))},from:''});
 await attention.review('phone',time);assert.equal(flags(data).unread,true);
 await attention.review('phone','2026-10-22T18:02:00Z');assert.equal(flags(data).unread,false);
 await attention.review('phone',time);assert.equal(data.lastReviewedInbound,'2026-10-22T18:02:00.000Z');
 await assert.rejects(attention.review('phone','2099-01-01'),/inválida/);
});

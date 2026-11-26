'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const twilio=require('twilio');
const {installUsage,runProcess,middleware}=require('../sync-usage');
const uri='https://sync.twilio.com/v1/Services/default/Documents/private-patient-id';
test('usage separates concurrent processes, failures and methods without storing private data',async()=>{
 const lines=[],failure=new Error('private error'),client={request:async opts=>{await new Promise(r=>setImmediate(r));if(opts.method==='DELETE')throw failure;return {statusCode:200,body:'private body'};}};
 const usage=installUsage(client,{sink:line=>lines.push(line)});
 try{
  await Promise.all([runProcess('aura.inbound',()=>client.request({uri,method:'GET',data:{phone:'private phone'}})),runProcess('inbox.send',()=>client.request({uri,method:'POST'})),runProcess('recovery.tick',()=>assert.rejects(client.request({uri,method:'DELETE'}),e=>e===failure))]);
  await client.request({uri:'https://api.twilio.com/private',method:'GET'});
  usage.flush();const report=JSON.parse(lines[0].slice('AURA_SYNC_USAGE '.length));
  assert.deepEqual(report.rows.map(r=>[r.process,r.operation,r.sdkRequests,r.errors]).sort(),[['aura.inbound','documents.fetch',1,0],['inbox.send','documents.update',1,0],['recovery.tick','documents.delete',1,1]]);
  assert.doesNotMatch(lines[0],/private|phone|https|token/i);usage.flush();assert.equal(lines.length,1);
 }finally{usage.stop();}
});
test('real Twilio SDK pagination is counted per page and preserves results',async()=>{
 let calls=0;const client=twilio('AC'+'0'.repeat(32),'test',{httpClient:{request:async()=>{calls++;return {statusCode:200,body:{documents:[{sid:'ET'+String(calls).repeat(32),unique_name:'test'+calls,data:{mode:'human'},revision:'1'}],meta:{next_page_url:calls===1?'https://sync.twilio.com/v1/Services/default/Documents?PageToken=private':null}}};}}});
 const lines=[],usage=installUsage(client,{sink:x=>lines.push(x)});
 try{const rows=await runProcess('inbox.list',()=>client.sync.v1.services('default').documents.list({limit:1000}));assert.equal(rows.length,2);assert.equal(rows[0].data.mode,'human');usage.flush();assert.equal(JSON.parse(lines[0].slice(16)).rows[0].sdkRequests,2);}finally{usage.stop();}
});
test('sink failure and synchronous request errors preserve application behavior',async()=>{
 const error=new Error('network'),client={request(){throw error;}},original=client.request;
 const usage=installUsage(client,{sink(){throw new Error('logging unavailable');}});
 assert.equal(installUsage(client),usage);assert.throws(()=>client.request({uri,method:'GET'}),e=>e===error);assert.doesNotThrow(()=>usage.flush());usage.stop();assert.equal(client.request,original);
});
test('middleware uses fixed process labels rather than request identifiers',async()=>{
 const lines=[],client={request:async()=>({statusCode:503})},usage=installUsage(client,{sink:x=>lines.push(x)});
 try{await middleware({path:'/api/inbox/messages'},null,()=>client.request({uri,method:'GET'}));usage.flush();const row=JSON.parse(lines[0].slice(16)).rows[0];assert.equal(row.process,'inbox.messages');assert.equal(row.errors,1);}finally{usage.stop();}
});

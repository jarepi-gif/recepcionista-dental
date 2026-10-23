const {test}=require('node:test'),assert=require('node:assert/strict');
const {eligible,install}=require('../inbox-phone-consent');const before='2026-10-19T00:00:00-06:00';
test('bulk scope excludes boundary, new chats, refusals and known nonprospects',()=>{assert.equal(eligible({lastInbound:'2026-10-18T23:59:59-06:00'},before),true);for(const c of [{lastInbound:before},{lastInbound:'bad'},{lastInbound:'2026-10-20'},{lastInbound:'2026-10-18',commercial:{doNotContact:true}},{lastInbound:'2026-10-18',commercial:{followUp:{status:'declined'}}},...['test','supplier','duplicate'].map(classification=>({lastInbound:'2026-10-18',commercial:{classification}}))])assert.equal(eligible(c,before),false);});
test('bulk permission sets human mode atomically, stops queued recovery and preserves prior evidence',async()=>{
 let row={phone:'whatsapp:+525500000001',name:'Paciente',lastInbound:'2026-10-18',mode:'aura',commercial:{handoff:{status:'pending'}},recovery:{status:'queued'}};let handler;
 install({app:{post(path,fn){if(path.endsWith('/apply'))handler=fn;}},route:fn=>fn,locked:async(_,fn)=>fn(),store:{list:async()=>[row],mutate:async(_,fn)=>(row=fn(row))}});
 let response;const res={status(){return this;},json(value){response=value;}};
 await handler({body:{before:'2026-10-19',phones:[row.phone],confirmed:true}},res);assert.equal(response.updated,1);assert.equal(row.mode,'human');assert.equal(row.recovery.status,'human');assert.equal(row.commercial.whatsappFollowupConsent.source,'owner_reported_phone_call');const evidence=row.commercial.whatsappFollowupConsent;
 await handler({body:{before:'2026-10-19',phones:[row.phone],confirmed:true}},res);assert.deepEqual(row.commercial.whatsappFollowupConsent,evidence);
});

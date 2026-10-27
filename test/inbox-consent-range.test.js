const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {ID,START,END,AUDIT,inRange,apply}=require('../inbox-consent-range-20261026');
const key=p=>'thera-inbox-'+crypto.createHash('sha256').update(p).digest('hex').slice(0,32);
test('range includes local October 19 through 26, excluding boundaries outside it',()=>{
 assert.equal(inRange({lastInbound:START}),true);assert.equal(inRange({lastInbound:'2026-10-26T23:59:59-06:00'}),true);
 for(const lastInbound of ['2026-10-18T23:59:59-06:00',END,'bad'])assert.equal(inRange({lastInbound}),false);
});
test('confirmed range freezes membership, preserves permission and refusals, and never grants again after completion',async()=>{
 const rows=[
 {phone:'one',lastInbound:START,mode:'aura',commercial:{handoff:{status:'pending'}},recovery:{status:'queued'}},
 {phone:'two',lastInbound:START,mode:'human',commercial:{whatsappFollowupConsent:{evidence:'Prior permission'}}},
 ...[{doNotContact:true},{followUp:{status:'declined'}},{classification:'test'},{classification:'supplier'},{classification:'duplicate'}].map((commercial,i)=>({phone:'excluded'+i,lastInbound:START,commercial})),
 {phone:'older',lastInbound:'2026-10-18',mode:'aura'}, {phone:'newer',lastInbound:END,mode:'aura'}];
 const records=new Map(rows.map(data=>[key(data.phone),{revision:'1',data:structuredClone(data)}]));let writes=0;
 const documents=name=>({fetch:async()=>{if(!records.has(name))throw {status:404};return structuredClone(records.get(name));},update:async({data})=>{writes++;const doc={revision:'2',data:structuredClone(data)};records.set(name,doc);return doc;}});
 documents.create=async({uniqueName,data})=>{const doc={revision:'1',data};records.set(uniqueName,doc);return doc;};
 const {NAME,BODY}=require('../inbox-human-template');const contents=()=>({approvalFetch:()=>({fetch:async()=>({whatsapp:{status:'approved'}})})});contents.list=async()=>[{sid:'HXtest',friendlyName:NAME,types:{'twilio/text':{body:BODY}}}];
 const store={documents,list:async()=>rows,client:{content:{v1:{contents}}}};
 const result=await apply(store);assert.equal(result.matched,7);assert.equal(result.updated,2);assert.equal(result.excluded,5);assert.equal(result.manualReady,2);assert.equal(result.patientMessagesSent,0);
 const one=records.get(key('one')).data;assert.equal(one.mode,'human');assert.equal(one.recovery.status,'human');assert.equal(one.commercial.handoff.status,'in_progress');assert.equal(one.commercial.whatsappFollowupConsent.source,'owner_reported_phone_call');assert.ok(one.consentCorrections[ID]);assert.equal(records.get(key('two')).data.commercial.whatsappFollowupConsent.evidence,'Prior permission');assert.equal(records.get(key('older')).data.mode,'aura');assert.equal(records.get(key('newer')).data.mode,'aura');
 delete records.get(key('one')).data.commercial.whatsappFollowupConsent;
 rows.push({phone:'later',lastInbound:START});const previousWrites=writes;
 const repeated=await apply(store);assert.equal(repeated.previouslyCompleted,true);assert.equal(writes,previousWrites);assert.equal(records.get(key('one')).data.commercial.whatsappFollowupConsent,undefined);assert.equal(records.get(AUDIT).data.targets.length,7);
});

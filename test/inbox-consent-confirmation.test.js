const {test}=require('node:test'),assert=require('node:assert/strict');
const {apply,ID,TARGETS}=require('../inbox-consent-confirmation-20261026');
test('owner confirmation updates only two existing contacts, preserves mode/evidence and never reapplies',async()=>{
 const records=new Map(TARGETS.map((t,i)=>[t.key,{revision:'1',data:{phone:'existing-'+i,mode:'human',commercial:i?{whatsappFollowupConsent:{evidence:'Existing permission'}}:{}}}]));
 records.set('unrelated',{data:{mode:'aura',commercial:{}}});let writes=0;
 const documents=key=>({fetch:async()=>structuredClone(records.get(key)),update:async({data})=>{writes++;const doc={revision:'2',data};records.set(key,doc);return doc;}});
 const result=await apply(documents);assert.equal(writes,2);assert.equal(result[0].data.mode,'human');assert.equal(result[0].data.commercial.whatsappFollowupConsent.source,'owner_reported_phone_call');assert.equal(result[1].data.commercial.whatsappFollowupConsent.evidence,'Existing permission');assert.deepEqual(records.get('unrelated').data,{mode:'aura',commercial:{}});
 delete records.get(TARGETS[0].key).data.commercial.whatsappFollowupConsent;
 await apply(documents);assert.equal(writes,2);assert.ok(records.get(TARGETS[0].key).data.consentCorrections[ID]);assert.equal(records.get(TARGETS[0].key).data.commercial.whatsappFollowupConsent,undefined);
});
test('correction skips missing contacts, refusals and known nonprospects',async()=>{
 for(const commercial of [{doNotContact:true},{followUp:{status:'declined'}},{classification:'test'},{classification:'supplier'},{classification:'duplicate'}]){
 const documents=key=>({fetch:async()=>{if(key===TARGETS[1].key)throw {status:404};return {data:{commercial}};},update:async()=>{throw Error('must not update');}});
 const r=await apply(documents);assert.equal(r[0].result,'excluded');assert.equal(r[1].result,'not_found');
 }
});

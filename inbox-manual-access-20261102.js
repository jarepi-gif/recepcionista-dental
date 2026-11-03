'use strict';
const crypto=require('node:crypto');
const ID='owner-manual-template-access-20261102-from-31';
const START='2026-10-31T00:00:00-06:00',END='2026-11-03T00:00:00-06:00';
const AUDIT='thera-manual-access-batch-'+ID;
const inRange=d=>Date.parse(d.lastInbound)>=Date.parse(START)&&Date.parse(d.lastInbound)<Date.parse(END);
const excluded=d=>{const c=d.commercial||{};return c.doNotContact||c.followUp?.status==='declined'||['test','supplier','duplicate'].includes(c.classification);};
const key=phone=>'thera-inbox-'+crypto.createHash('sha256').update(phone).digest('hex').slice(0,32);
async function apply(store,now=new Date()){
 const documents=store.documents,stamp=now.toISOString();let audit;
 try{audit=await documents(AUDIT).fetch();}catch(e){
  if(e.status!==404)throw e;
  const targets=[...new Set((await store.list()).filter(inRange).map(d=>key(d.phone)))];
  try{audit=await documents.create({uniqueName:AUDIT,data:{id:ID,start:START,end:END,createdAt:stamp,targets}});}
  catch(e){if(e.status!==409)throw e;audit=await documents(AUDIT).fetch();}
 }
 if(audit.data.completedAt)return {...audit.data.summary,previouslyCompleted:true};
 const summary={matched:audit.data.targets.length,updated:0,alreadyProcessed:0,excluded:0,notFound:0,manualReady:0,awaitingReply:0,patientMessagesSent:0};
 const template=await require('./inbox-human-template').status(store.client);summary.template=template.status;
 for(const target of audit.data.targets){
  let result;
  for(let attempt=0;attempt<5;attempt++){
   let doc;try{doc=await documents(target).fetch();}catch(e){if(e.status!==404)throw e;summary.notFound++;break;}
   const d=doc.data,c=d.commercial||{};
   if(!inRange(d)||excluded(d)){summary.excluded++;break;}
   if(d.manualAccessUpdates?.[ID]){summary.alreadyProcessed++;result=d;break;}
   const next={...d,mode:'human',recovery:d.recovery?{...d.recovery,status:'human'}:d.recovery,
    commercial:{...c,manualTemplateAccess:{enabled:true,source:'owner_requested_manual_access',recordedAt:stamp,recordedBy:'Dr. Jaime Reyes',batchId:ID},handoff:c.handoff?{...c.handoff,status:'in_progress',handledAt:stamp}:c.handoff},
    manualAccessUpdates:{...d.manualAccessUpdates,[ID]:{recordedAt:stamp,recordedBy:'Dr. Jaime Reyes'}}};
   try{await documents(target).update({ifMatch:doc.revision,data:next});result=(await documents(target).fetch()).data;summary.updated++;break;}
   catch(e){if(e.status!==412||attempt===4)throw e;}
  }
  if(result){
   const awaiting=result.humanTemplate?.sid&&result.humanTemplate.baselineInboundSid===(result.lastInboundSid||null);
   if(awaiting)summary.awaitingReply++;
   if(template.status==='approved'&&!awaiting&&!require('./inbox-human-template').blocked(result,{consentConfirmed:true}))summary.manualReady++;
  }
 }
 await documents(AUDIT).update({data:{...audit.data,completedAt:new Date().toISOString(),summary}});
 return summary;
}
async function run(inbox,log=console.log){if(inbox.enabled)log('Manual template access '+JSON.stringify({id:ID,...await apply(inbox.store)}));}
module.exports={ID,START,END,AUDIT,inRange,excluded,apply,run};


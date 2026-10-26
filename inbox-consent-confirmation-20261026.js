'use strict';
// One-time data correction explicitly confirmed by the owner on 2026-10-26.
// Only existing conversations are updated. No messages or mode changes.
const ID='owner-phone-confirmation-20261026-two-contacts';
const TARGETS=[
 {key:'thera-inbox-47d97010ae35fb60e916f90b9b27e368',label:'Tony'},
 {key:'thera-inbox-7a5052759bf3c5115ef5d653d7d0cd4e',label:'contacto emoji'}
];
async function apply(documents,now=new Date()){
 const results=[];
 for(const target of TARGETS){
  for(let attempt=0;attempt<5;attempt++){
   let doc;
   try{doc=await documents(target.key).fetch();}catch(e){if(e.status!==404)throw e;results.push({label:target.label,result:'not_found'});break;}
   const data=doc.data,c=data.commercial||{};
   if(c.doNotContact||c.followUp?.status==='declined'||['test','supplier','duplicate'].includes(c.classification)){
    results.push({label:target.label,result:'excluded'});break;
   }
   if(data.consentCorrections?.[ID]){results.push({label:target.label,result:'already_recorded',data});break;}
   const stamp=now.toISOString();
   const consent=c.whatsappFollowupConsent?.evidence?c.whatsappFollowupConsent:{
    evidence:'El Dr. Jaime Reyes confirmó el 26 de octubre de 2026 que este contacto autorizó por llamada telefónica continuar su consulta por WhatsApp. Fecha y hora de la llamada no especificadas.',
    source:'owner_reported_phone_call',recordedAt:stamp,recordedBy:'Dr. Jaime Reyes',scope:'Seguimiento humano de la consulta por WhatsApp',confirmationId:ID
   };
   const next={...data,commercial:{...c,whatsappFollowupConsent:consent},consentCorrections:{...data.consentCorrections,[ID]:{recordedAt:stamp,recordedBy:'Dr. Jaime Reyes'}}};
   try{const updated=await documents(target.key).update({ifMatch:doc.revision,data:next});results.push({label:target.label,result:'recorded',data:updated.data});break;}
   catch(e){if(e.status!==412||attempt===4)throw e;}
  }
 }
 return results;
}
async function run(inbox,log=console.log){
 if(!inbox.enabled)return;
 const results=await apply(inbox.store.documents);
 const template=await require('./inbox-human-template').status(inbox.store.client);
 const {blocked}=require('./inbox-human-template');
 for(const {label,result,data} of results)log('Phone consent correction '+JSON.stringify({id:ID,contact:label,result,template:template.status,manualReady:Boolean(data&&template.status==='approved'&&!blocked(data))}));
}
module.exports={ID,TARGETS,apply,run};

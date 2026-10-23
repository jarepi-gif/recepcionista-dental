'use strict';
function eligible(c,before){const x=c.commercial||{};return Number.isFinite(Date.parse(c.lastInbound))&&Date.parse(c.lastInbound)<Date.parse(before)&&!x.doNotContact&&x.followUp?.status!=='declined'&&!['test','supplier','duplicate'].includes(x.classification);}
function install({app,route,store,locked}){
 const validate=body=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(body.before||''))throw new Error('Fecha inválida.');const before=body.before+'T00:00:00-06:00';if(!Number.isFinite(Date.parse(before)))throw new Error('Fecha inválida.');return before;};
 app.post('/api/inbox/phone-consent/preview',route(async(req,res)=>{let before;try{before=validate(req.body);}catch(e){return res.status(400).json({error:e.message});}const all=await store.list(),rows=all.filter(c=>eligible(c,before));res.json({before,count:rows.length,contacts:rows.map(c=>({phone:c.phone,name:c.name||'Nombre por confirmar'}))});}));
 app.post('/api/inbox/phone-consent/apply',route(async(req,res)=>{
  let before;try{before=validate(req.body);}catch(e){return res.status(400).json({error:e.message});}
  if(req.body.confirmed!==true||!Array.isArray(req.body.phones)||req.body.phones.length>1000)return res.status(400).json({error:'Confirma los contactos y sus permisos telefónicos.'});
  const phones=[...new Set(req.body.phones)],known=new Set((await store.list()).filter(c=>eligible(c,before)).map(c=>c.phone));let updated=0,skipped=0;const contacts=[];
  for(const phone of phones){if(!known.has(phone)){skipped++;continue;}
   await locked(phone,async()=>{let changed=false;const result=await store.mutate(phone,data=>{
    if(!eligible(data,before))return data;
    const c=data.commercial||{},stamp=new Date().toISOString();changed=true;
    return {...data,mode:'human',recovery:data.recovery?{...data.recovery,status:'human'}:data.recovery,commercial:{...c,handoff:c.handoff?{...c.handoff,status:'in_progress',handledAt:stamp}:c.handoff,whatsappFollowupConsent:c.whatsappFollowupConsent?.evidence?c.whatsappFollowupConsent:{evidence:'El Dr. Jaime Reyes confirma que '+(data.name||'este contacto')+' autorizó por llamada telefónica continuar el contacto por WhatsApp. Registro basado en su declaración colectiva para los chats anteriores al '+req.body.before+'; fecha y hora de la llamada no especificadas.',scope:'Seguimiento humano de la consulta por WhatsApp',recordedAt:stamp,recordedBy:'Dr. Jaime Reyes',source:'owner_reported_phone_call',batchBefore:before}}};
   });if(changed){updated++;contacts.push({name:result.name||'Nombre por confirmar',phone:result.phone});}else skipped++;});
  }
  res.json({updated,skipped,contacts,message:'Permisos registrados. Atención humana activa; no se enviaron mensajes.'});
 }));
}
module.exports={install,eligible};

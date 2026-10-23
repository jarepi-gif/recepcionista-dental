'use strict';
const crypto=require('node:crypto');
const NAME='thera_human_followup_v1';
const BODY='Hola, te saluda el equipo de Thera Dental Clinic. Retomamos tu consulta pendiente para atenderte personalmente por este chat. ¿Deseas que continuemos? Si prefieres no recibir seguimiento, responde NO.';
let preparing;
async function status(client,store=null){
 const rows=await client.content.v1.contents.list({limit:1000});
 const content=rows.find(c=>c.friendlyName===NAME&&c.types?.['twilio/text']?.body===BODY);
 let primary={status:'not_configured',body:BODY};
 if(content){let approval;try{approval=await client.content.v1.contents(content.sid).approvalFetch().fetch();}catch(e){if(e.status!==404)throw e;}primary={sid:content.sid,status:String(approval?.whatsapp?.status||'unsubmitted').toLowerCase(),body:BODY};}
 if(primary.status==='approved'||!store)return primary;
 // Reuse only the configured, exact recovery text, with current provider approval.
 try{
  const settings=(await store.documents('thera-recovery-settings-v1').fetch()).data;
  if(!/^HX[a-f0-9]{32}$/i.test(settings.contentSid||''))return primary;
  const fallback=await client.content.v1.contents(settings.contentSid).fetch();
  const body=fallback.types?.['twilio/text']?.body;
  if(body!==require('./recovery').BODY)return primary;
  const approved=await client.content.v1.contents(settings.contentSid).approvalFetch().fetch();
  if(String(approved.whatsapp?.status).toLowerCase()==='approved')return {sid:settings.contentSid,status:'approved',body,source:'recovery',humanTemplateStatus:primary.status};
 }catch(e){if(e.status!==404)throw e;}
 return primary;
}
async function prepare(client){
 if(preparing)return preparing;
 preparing=(async()=>{
  let current=await status(client);
  if(!current.sid){const content=await client.content.v1.contents.create({friendly_name:NAME,language:'es_MX',types:{'twilio/text':{body:BODY}}});current={sid:content.sid,status:'unsubmitted'};}
  if(current.status==='unsubmitted')await client.content.v1.contents(current.sid).approvalCreate.create({name:NAME,category:'MARKETING'});
  return status(client);
 })();try{return await preparing;}finally{preparing=null;}
}
function blocked(data){
 if(data.mode!=='human')return 'Toma la conversación antes de retomar el contacto.';
 const c=data.commercial||{};
 if(c.doNotContact||c.followUp?.status==='declined')return 'Este contacto rechazó el seguimiento.';
 if(!c.whatsappFollowupConsent?.evidence)return 'Registra en la ficha la evidencia del permiso recibido para seguimiento por WhatsApp.';
 return null;
}
function install({app,route,client,store,from,locked,phoneNumber}){
 app.get('/api/inbox/human-template',route(async(req,res)=>res.json(await status(client,store))));
 app.post('/api/inbox/human-template/prepare',route(async(req,res)=>res.json(await prepare(client))));
 app.post('/api/inbox/human-template/send',route(async(req,res)=>{
  const phone=phoneNumber(req.body.phone),requestId=String(req.body.requestId||'');
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(requestId))return res.status(400).json({error:'Identificador de envío inválido.'});
  await locked(phone,async()=>{
   let data=(await store.ensure(phone)).data;let reason=blocked(data);
   if(reason)return res.status(409).json({error:reason});
   const template=await status(client,store);
   if(template.status!=='approved')return res.status(409).json({error:'La plantilla de atención humana todavía no está aprobada. Estado: '+template.status});
   data=(await store.ensure(phone)).data;reason=blocked(data);
   if(reason)return res.status(409).json({error:reason});
   // One attempt per inbound message, durable even when the provider response is uncertain.
   const claim='thera-human-template-'+crypto.createHash('sha256').update(phone+'|'+String(data.lastInboundSid||data.lastInbound||'none')).digest('hex');
   try{await store.documents.create({uniqueName:claim,data:{phone,state:'pending',requestId,contentSid:template.sid}});}
   catch(e){if(e.status!==409)throw e;return res.status(409).json({error:'Ya se intentó retomar este contacto. Revisa el historial y espera su respuesta antes de repetir.'});}
   const message=await client.messages.create({from,to:phone,contentSid:template.sid});
   await store.mutate(phone,d=>({...d,humanSids:[...(d.humanSids||[]),message.sid].slice(-100),preview:template.body.slice(0,160),humanTemplate:{sid:message.sid,status:message.status,sentAt:new Date().toISOString(),baselineInboundSid:data.lastInboundSid||null}}));
   await store.documents(claim).update({data:{phone,state:message.status,sid:message.sid,requestId}});
   res.json({sid:message.sid,status:message.status});
  });
 }));
}
module.exports={install,status,prepare,blocked,NAME,BODY};

'use strict';
const crypto=require('node:crypto');
const workflow=require('./attention-workflow');
const {inboundTreatment}=require('./commercial-alerts');
const SETTINGS='thera-recovery-settings-v1';
const BODY='Hola, somos Thera Dental Clinic. Retomamos tu consulta pendiente. ¿Deseas que te ayudemos a coordinar tu valoración en Interlomas por este chat? El Dr. Jaime Reyes revisará la disponibilidad antes de confirmar. Si prefieres no recibir seguimiento, responde NO.';
const canonical=p=>String(p||'').replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52');
function businessHours(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));const m=Number(p.hour)*60+Number(p.minute);return p.weekday!=='Sun'&&m>=660&&m<(p.weekday==='Sat'?900:1080);}
function assess(conversation,messages,doctor){
 const c=conversation.commercial||{},inbound=messages.filter(m=>m.from===conversation.phone),text=workflow.normalize(inbound.map(m=>m.body||'').join('\n'));
 const excluded=['test','supplier','duplicate'].includes(c.classification)||canonical(conversation.phone)===canonical(doctor)||/distribuidor autorizado|terminales punto de venta|cofepris|mantenimiento de sus equipos|soy proveedor|mensaje de prueba|paciente prueba|prueba tecnica/.test(text);
 if(excluded)return {eligible:false,reason:'Prueba, proveedor, duplicado o responsable'};
 if(c.doNotContact||/no me contacten|no quiero mensajes|dejen de escribirme|no me escriban|no gracias|mo gracias/.test(text))return {eligible:false,reason:'No desea seguimiento'};
 if(c.canAttend==='no'||/me (?:queda|keda).*?(?:lejos|retirado)|esta muy lejos|no puedo acudir/.test(text))return {eligible:false,reason:'Traslado no viable'};
 if(c.appointment?.status==='confirmed'||c.attendance==='attended'||/ya (?:tengo|tenemos) (?:una )?cita|ya (?:agende|agendamos)|ya me atendieron/.test(text))return {eligible:false,reason:'Cita o atención existente; revisar agenda'};
 if(conversation.mode==='human')return {eligible:false,reason:'Atención humana en curso'};
 if(!inbound.length)return {eligible:false,reason:'Sin conversación verificable'};
 const latest=inbound.slice().sort((a,b)=>new Date(b.dateCreated)-new Date(a.dateCreated))[0];
 const need=inbound.map(m=>inboundTreatment(m.body)).filter(t=>t!=='Por confirmar').at(-1)||c.need||null;
 return {eligible:Boolean(need||/informacion|valoracion|cita|precio|costo|diente|muela|caries|encia/.test(text)),reason:'Consulta pendiente',need,lastInbound:new Date(latest.dateCreated).toISOString(),lastInboundSid:latest.sid};
}
function decision(data,now,settings,template){
 const c=data.commercial||{},r=data.recovery;
 if(!r||r.status!=='queued')return 'idle';
 if(c.doNotContact||c.followUp?.status==='declined'||['test','supplier','duplicate'].includes(c.classification)||c.canAttend==='no')return 'excluded';
 if(c.appointment?.status==='confirmed')return 'confirmed';
 if(data.mode==='human')return 'human';
 if(Date.parse(r.dueAt)>+now||!businessHours(now))return 'waiting';
 if(!settings.enabled)return 'paused';
 if(data.lastInbound&&+now-Date.parse(data.lastInbound)>=0&&+now-Date.parse(data.lastInbound)<24*3600000-60000)return 'session';
 if(!c.whatsappFollowupConsent?.evidence)return 'needs_consent';
 if(!template?.sid||template.status!=='approved')return 'needs_template';
 return 'template';
}
function summarize(rows,now=new Date()){
 const cases=rows.filter(x=>x.recovery&&!['test','supplier','duplicate'].includes(x.commercial?.classification));
 const sent=cases.filter(x=>x.recovery.sid||x.recovery.firstSid),responded=cases.filter(x=>x.recovery.respondedAt);
 const confirmed=cases.filter(x=>x.recovery.respondedAt&&x.commercial?.appointment?.status==='confirmed');
 return {asOf:now.toISOString(),enrolled:cases.length,sent:sent.length,delivered:sent.filter(x=>x.recovery.deliveredEver||['delivered','read'].includes(x.recovery.deliveryStatus)).length,responded:responded.length,confirmedAfterResponse:confirmed.length,attended:confirmed.filter(x=>x.commercial?.attendance==='attended').length,collectedMXN:confirmed.reduce((sum,x)=>sum+(x.commercial?.payments||[]).filter(p=>Date.parse(p.recordedAt)>=Date.parse(x.recovery.respondedAt)).reduce((s,p)=>s+p.amount,0),0),cases:cases.map(x=>({name:x.name||'Nombre por confirmar',phoneLast4:canonical(x.phone).slice(-4),status:x.recovery.status,blockedReason:x.recovery.blockedReason||null,deliveryStatus:x.recovery.deliveryStatus||null,respondedAt:x.recovery.respondedAt||null,appointmentStatus:x.commercial?.appointment?.status||'none',owner:x.commercial?.owner||workflow.OWNER})),scope:'Sólo cohortes inscritas. Citas y cobros requieren registro del responsable; no demuestra atribución causal ni verifica el banco.'};
}
function createRecovery({client,store,from,env,push,locked}){
 const docs=store.documents;let running=false,lastReport=0;
 async function settings(){try{return (await docs(SETTINGS).fetch()).data;}catch(e){if(e.status===404)return {enabled:false};throw e;}}
 async function templateStatus(s){if(!s.contentSid)return {status:'not_configured'};const approval=await client.content.v1.contents(s.contentSid).approvalFetch().fetch();return {sid:s.contentSid,status:String(approval.whatsapp?.status||'unknown').toLowerCase()};}
 async function configure(input){
  const old=await settings(),data={...old};if(input.enabled!==undefined)data.enabled=input.enabled===true;
  if(input.contentSid){if(!/^HX[a-f0-9]{32}$/i.test(input.contentSid))throw new Error('Plantilla inválida');const content=await client.content.v1.contents(input.contentSid).fetch();const body=content.types?.['twilio/text']?.body;if(body!==BODY)throw new Error('La plantilla debe coincidir exactamente con el mensaje de recuperación aprobado');data.contentSid=input.contentSid;const status=await templateStatus(data);if(status.status!=='approved')throw new Error('La plantilla todavía no está aprobada');}
  data.updatedAt=new Date().toISOString();try{await docs(SETTINGS).update({data});}catch(e){if(e.status!==404)throw e;await docs.create({uniqueName:SETTINGS,data});}return data;
 }
 async function history(phone){return (await Promise.all([client.messages.list({from:phone,to:from,limit:100}),client.messages.list({from,to:phone,limit:100})])).flat();}
 async function enroll(phone,manual=false){
  const before=(await store.ensure(phone)).data;if(before.recovery)return before;
  const facts=assess(before,await history(phone),env.THERA_ALERT_RECIPIENT);if(!facts.eligible)return {...before,notEnrolledReason:facts.reason};
  return store.mutate(phone,data=>data.recovery?data:{...data,lastInbound:facts.lastInbound,lastInboundSid:facts.lastInboundSid,commercial:{...workflow.initial(),...data.commercial,classification:'prospect',owner:data.commercial?.owner||workflow.OWNER,need:data.commercial?.need||facts.need},recovery:{status:'queued',dueAt:workflow.nextServiceDeadline(new Date(),0),enrolledAt:new Date().toISOString(),baselineInboundSid:facts.lastInboundSid,origin:manual?'historical_review':'automatic',attempts:0}});
 }
 async function enrollRecent(){let enrolled=0,excluded=0;const seen=new Set();for(const row of await store.list()){
  if(!row.lastInbound)continue;
  const normalized=canonical(row.phone);if(seen.has(normalized)){excluded++;continue;}seen.add(normalized);
  const result=await enroll(row.phone,true);if(result.recovery)enrolled++;else excluded++;
 }return {enrolled,excluded};}
 async function notifyOwner(row,eventId){
  const claim='thera-recovery-owner-'+crypto.createHash('sha256').update(eventId).digest('hex');
  try{await docs.create({uniqueName:claim,data:{state:'pending'}});}catch(e){if(e.status===409)return;throw e;}
  const result=await require('./commercial-alerts').sendCommercialAlert({event:'HUMAN_HANDOFF_REQUIRED',patient:row.name||'Nombre por confirmar',patientPhone:row.phone,treatment:row.commercial?.need||'Valoración por coordinar',action:`Ver conversación: ${new URL(env.INBOX_PUBLIC_URL).origin}/bandeja?phone=${encodeURIComponent(row.phone)}`},{env,client});
  await docs(claim).update({data:{state:result.status,sid:result.sid||null}});
  await push.send({title:'Seguimiento de Thera pendiente',body:'Hay un caso asignado que requiere atención en la bandeja.',eventId:claim,url:new URL(env.INBOX_PUBLIC_URL).origin+'/bandeja'});
 }
 async function tick(now=new Date()){
  if(running)return;running=true;
  try{
   const s=await settings();if(!s.enabled)return;const template=await templateStatus(s);
   for(const row of await store.list()){
    const c=row.commercial||{};
    // An agreed follow-up is durable, and is never silently rescheduled or repeated.
    if(c.followUp?.status==='agreed'&&(!row.recovery||(['queued','responded'].includes(row.recovery.status)&&row.recovery.followUpDueAt!==c.followUp.dueAt))){await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:'queued',sid:null,sentAt:null,deliveryStatus:null,dueAt:c.followUp.dueAt,followUpDueAt:c.followUp.dueAt,enrolledAt:now.toISOString(),baselineInboundSid:d.lastInboundSid,origin:'agreed',attempts:0}}));}
    await locked(row.phone,async()=>{
     let data=(await store.ensure(row.phone)).data,r=data.recovery;
     const appointment=data.commercial?.appointment;
     if(appointment?.status==='confirmed'&&Date.parse(appointment.at)>+now&&appointment.confirmedBy&&appointment.evidence&&data.confirmationNotice?.appointmentAt!==appointment.at&&businessHours(now)){
      if(!data.lastInbound||+now-Date.parse(data.lastInbound)>=24*3600000-60000){await store.mutate(row.phone,d=>({...d,confirmationNotice:{status:'needs_template',appointmentAt:null,pendingAppointmentAt:appointment.at}}));}
      else{
       const claim='thera-appointment-notice-'+crypto.createHash('sha256').update(canonical(row.phone)+'|'+appointment.at).digest('hex');
       try{
        await docs.create({uniqueName:claim,data:{state:'pending',phone:row.phone}});
        // Manual verification in the inbox is required; patient statements alone never reach this path.
        const when=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'full',timeStyle:'short'}).format(new Date(appointment.at));
        const body=`Tu cita en Thera Dental Clinic está confirmada para el ${when}. El ${appointment.confirmedBy} registró la confirmación en agenda. Te esperamos en Plaza Centtral Interlomas, planta baja, local 11. Si necesitas cambiarla, escríbenos por este chat.`;
        const m=await client.messages.create({from,to:row.phone,body});
        await docs(claim).update({data:{state:m.status,sid:m.sid}});
        await store.mutate(row.phone,d=>({...d,confirmationNotice:{status:m.status,sid:m.sid,appointmentAt:appointment.at}}));
       }catch(e){await store.mutate(row.phone,d=>({...d,confirmationNotice:{status:'uncertain',appointmentAt:appointment.at,errorCode:e.code||null}}));}
      }
     }
     if(data.commercial?.handoff?.status==='pending'&&Date.parse(data.commercial.handoff.dueAt)<=+now&&businessHours(now))await notifyOwner(data,'handoff-'+canonical(data.phone)+'-'+data.commercial.handoff.requestedAt);
     if(!r)return;
     if(r.sid&&r.responseForSid!==r.sid&&data.lastInboundSid!==r.baselineInboundSid&&Date.parse(data.lastInbound)>Date.parse(r.sentAt)){
      data=await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:'responded',respondedAt:d.recovery.respondedAt||d.lastInbound,latestResponseAt:d.lastInbound,responseForSid:r.sid,responseSid:d.lastInboundSid},commercial:{...d.commercial,handoff:['completed','in_progress'].includes(d.commercial?.handoff?.status)?d.commercial.handoff:{...d.commercial?.handoff,status:'pending',owner:d.commercial?.owner||workflow.OWNER,requestedAt:now.toISOString(),dueAt:workflow.nextServiceDeadline(now)}}}));
      r=data.recovery; // The inbound webhook already sends the doctor's existing alert.
     }
     if(r.sid&&!['read','failed','undelivered'].includes(r.deliveryStatus)){
      const m=await client.messages(r.sid).fetch();data=await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,deliveryStatus:m.status,deliveredEver:d.recovery.deliveredEver||['delivered','read'].includes(m.status),errorCode:m.errorCode||null,price:m.price||null,priceUnit:m.priceUnit||null}}));r=data.recovery;
     }
     const action=decision(data,now,s,template);
     if(['excluded','confirmed','human'].includes(action)){await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:action}}));return;}
     if(['needs_consent','needs_template'].includes(action)){
      if(r.blockedReason!==action)await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,blockedReason:action}}));return;
     }
     if(!['session','template'].includes(action))return;
     const claim='thera-recovery-send-'+crypto.createHash('sha256').update(canonical(row.phone)+'|'+(r.origin==='agreed'?r.dueAt:'initial')).digest('hex');
     try{await docs.create({uniqueName:claim,data:{state:'pending',phone:row.phone}});}catch(e){if(e.status!==409)throw e;await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:'uncertain',blockedReason:'Envío ya reclamado; revisar antes de reenviar'}}));return;}
     await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:'sending'}}));
     try{const message=await client.messages.create({from,to:row.phone,...(action==='template'?{contentSid:template.sid}:{body:BODY})});
      await docs(claim).update({data:{state:message.status,sid:message.sid,phone:row.phone}});
      await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:'sent',sid:message.sid,firstSid:d.recovery.firstSid||message.sid,sentAt:new Date().toISOString(),baselineInboundSid:data.lastInboundSid,deliveryStatus:message.status,blockedReason:null,attempts:1},preview:BODY.slice(0,160)}));
     }catch(e){await store.mutate(row.phone,d=>({...d,recovery:{...d.recovery,status:'uncertain',blockedReason:'Twilio no confirmó el envío; no se reintenta automáticamente',errorCode:e.code||null}}));}
    });
   }
   if(+now-lastReport>=3600000){const report=summarize(await store.list(),now);console.log('AURA_RECOVERY_REPORT '+JSON.stringify(report));lastReport=+now;}
  }catch(e){console.error('Aura recovery:',e.code||e.status||'error');}finally{running=false;}
 }
 async function onInbound(phone){const s=await settings();if(!s.enabled)return;const data=(await store.ensure(phone)).data,c=data.commercial;
  if(data.recovery?.status==='queued'&&['automatic','historical_review'].includes(data.recovery.origin)){await store.mutate(phone,d=>({...d,recovery:{...d.recovery,dueAt:workflow.nextServiceDeadline(new Date(Date.parse(d.lastInbound)+4*3600000),0),baselineInboundSid:d.lastInboundSid}}));return;}
  if(data.recovery||!c||c.classification!=='prospect'||c.doNotContact||c.canAttend==='no'||c.appointment?.status==='confirmed'||data.mode==='human')return;
  await store.mutate(phone,d=>({...d,recovery:{status:'queued',dueAt:workflow.nextServiceDeadline(new Date(Date.parse(d.lastInbound)+4*3600000),0),enrolledAt:new Date().toISOString(),baselineInboundSid:d.lastInboundSid,origin:'automatic',attempts:0}}));
 }
 const interval=setInterval(()=>tick(),60000);interval.unref();
 return {settings,templateStatus,configure,enroll,enrollRecent,tick,onInbound,report:async()=>summarize(await store.list()),stop:()=>clearInterval(interval),BODY};
}
module.exports={createRecovery,assess,decision,summarize,businessHours,canonical,BODY};

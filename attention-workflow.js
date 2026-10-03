'use strict';
const {classifyAuraIntent,extractPatientFullName,isFullName}=require('./aura-cro-policy');
const {inboundTreatment}=require('./commercial-alerts');
const {extractInboundAttribution}=require('./ximgrowthos-sync');
const OWNER='Dr. Jaime Reyes';
const VERSION='attention-v2-20261003';
const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const yes=v=>/^(?:si|sí|claro|de acuerdo|esta bien|está bien|adelante|por favor|si por favor|sí por favor|perfecto|ok)[.!\s]*$/i.test(String(v||'').trim());
const no=v=>/^(?:no|no gracias|no por ahora|no me contacten)[.!\s]*$/i.test(String(v||'').trim());
function mexicoParts(now=new Date()) {
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(now);
 return Object.fromEntries(p.map(x=>[x.type,x.value]));
}
function nextServiceDeadline(now=new Date(),minutes=10){
 const p=mexicoParts(now);const start=11*60,end=p.weekday==='Sat'?15*60:18*60,minute=+p.hour*60+(+p.minute);
 if(p.weekday!=='Sun'&&minute>=start&&minute+minutes<=end)return new Date(+now+minutes*60000).toISOString();
 // Next clinic opening, not a promise of a patient appointment.
 const day=new Date(`${p.year}-${p.month}-${p.day}T00:00:00-06:00`);
 if(p.weekday!=='Sun'&&minute<start)return new Date(+day+11*3600000).toISOString();
 do{day.setUTCDate(day.getUTCDate()+1);}while(mexicoParts(day).weekday==='Sun');
 return new Date(+day+11*3600000).toISOString();
}
function nextDayDate(now=new Date(),days=1){const p=mexicoParts(now);const d=new Date(`${p.year}-${p.month}-${p.day}T12:00:00-06:00`);d.setUTCDate(d.getUTCDate()+days);const x=mexicoParts(d);return `${x.year}-${x.month}-${x.day}`;}
function appointmentPreference(text){
 const n=normalize(text);const day=n.match(/\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)?.[1];
 const after=day?n.slice(n.indexOf(day)+day.length):n;
 const time=after.match(/(?:^|\s)([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)?(?=\s|$|[.,])/);
 return {day:day||null,time:time?`${time[1]}${time[2]?':'+time[2]:''}${time[3]?' '+time[3]:''}`:null};
}
function initial(){return {version:VERSION,classification:'unverified',source:{channel:'unknown',verified:false},canAttend:'unknown',owner:OWNER,need:null,teeth:null,appointment:{status:'none'},followUp:null,payments:[],events:[]};}
function updateInbound(previous,body,history=[],now=new Date()){
 const c={...initial(),...previous,source:{...initial().source,...previous?.source},appointment:{status:'none',...previous?.appointment},events:[...(previous?.events||[])],payments:[...(previous?.payments||[])]};
 if(body.MessageSid&&c.lastInboundSid===body.MessageSid)return c;
 const text=String(body.Body||''),n=normalize(text),last=history.filter(x=>x.role==='assistant').at(-1)?.content||'';
 if(!previous){
  for(const h of history.filter(x=>x.role==='user')){
   const treatment=inboundTreatment(h.content);if(treatment!=='Por confirmar')c.need=treatment;
   const count=normalize(h.content).match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d{1,2})\s+(?:dientes?|piezas?|muelas?|implantes?)\b/);
   if(count)c.teeth=({un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9})[count[1]]||Number(count[1]);
  }
 }
 c.lastInboundSid=body.MessageSid;c.updatedAt=now.toISOString();
 if(/\b(?:esto es una prueba|prueba tecnica|mensaje de prueba|test tecnico)\b/.test(n))c.classification='test';
 if(/\b(?:distribuidor autorizado|soy proveedor|ofrezco servicios|revision normativa ante cofepris|terminales punto de venta)\b/.test(n))c.classification='supplier';
 const attr=extractInboundAttribution(text);if(attr.intakeReference)c.source={...c.source,reference:attr.intakeReference};if(attr.intakeToken)c.source={...c.source,intakeToken:attr.intakeToken};
 if(body.ReferralSourceId){c.source={...c.source,channel:'meta_ads',verified:true,adId:String(body.ReferralSourceId).slice(0,100),body:String(body.ReferralBody||'').slice(0,3000),headline:String(body.ReferralHeadline||'').slice(0,500),url:String(body.ReferralSourceUrl||'').slice(0,1500),clickId:String(body.ReferralCtwaClid||'').slice(0,1000),evidence:'Twilio referral',receivedAt:now.toISOString()};}
 const treatment=inboundTreatment(text);if(treatment!=='Por confirmar')c.need=treatment;
 const count=n.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d{1,2})\s+(?:dientes?|piezas?|muelas?|implantes?)\b/);
 if(count)c.teeth=({un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9})[count[1]]||Number(count[1]);
 if(/\b(?:mi esposa|mi esposo|mi mama|mi papa|mi madre|mi padre|mi hija|mi hijo)\b/.test(n)){c.thirdParty=true;if(!previous?.thirdParty)c.patientName=null;}
 const name=extractPatientFullName(text,true);if(name&&isFullName(name)){if(c.thirdParty)c.patientName=name;else c.patientName=name;}
 if(/\b(?:me (?:keda|queda) (?:muy )?(?:lejos|retirado)|no puedo (?:ir|acudir|trasladarme))\b/.test(n))c.canAttend='no';
 else if(/\b(?:si puedo (?:ir|acudir)|puedo acudir|puedo trasladarme)\b/.test(n)||(c.awaiting==='attendance'&&yes(text)))c.canAttend='yes';
 else if(c.awaiting==='attendance'&&no(text))c.canAttend='no';
 if(/\b(?:no me contacten|no quiero mensajes|dejen de escribirme|no me escriban)\b/.test(n)||/^(?:stop|baja|cancelar seguimiento)$/.test(n)||(no(text)&&/no recibir seguimiento/i.test(last))){c.doNotContact=true;c.followUp=c.followUp?{...c.followUp,status:'declined'}:null;}
 if(c.followUp?.status==='proposed'){
  if(yes(text)&&/seguimiento|te contacte|continue contigo/.test(normalize(last))&&/por este chat|por este whatsapp/.test(normalize(last))){c.followUp={...c.followUp,status:'agreed',agreedAt:now.toISOString(),evidenceSid:body.MessageSid};c.whatsappFollowupConsent={evidence:body.MessageSid,scope:'Seguimiento de la consulta por WhatsApp',grantedAt:now.toISOString()};c.awaiting=null;}
  else if(no(text)){c.followUp={...c.followUp,status:'declined'};c.awaiting=null;}
 }
 if(c.awaiting==='whatsapp_followup_permission'&&/autorizas que aura/.test(normalize(last))&&yes(text)){c.whatsappFollowupConsent={evidence:body.MessageSid,scope:'Seguimiento de la consulta por WhatsApp',grantedAt:now.toISOString()};c.awaiting=null;}
 if(c.awaiting==='whatsapp_followup_permission'&&/autorizas que aura/.test(normalize(last))&&no(text)){c.doNotContact=true;c.awaiting=null;c.whatsappFollowupConsent=null;}
 const priceQuestion=/\b(?:precio|costo|cuanto|incluye|anticipo|abono|descuenta)\b/.test(n);
 const accept=c.followUp?.evidenceSid!==body.MessageSid&&yes(text)&&/\b(?:agendar|cita|valoraci[oó]n)\b/i.test(last)&&c.awaiting!=='attendance';
 const preference=appointmentPreference(text);
 const scheduling=classifyAuraIntent(text)==='INTENCION_DE_AGENDAR'||accept||(name&&preference.day&&preference.time&&!/cancel|reprogram/.test(n))||((preference.day||preference.time)&&/d[ií]a.*horario|horario.*prefier/i.test(last)&&!priceQuestion)||(c.appointment.status==='pending'&&!priceQuestion&&(name||preference.day||preference.time));
 if(scheduling&&c.appointment.status!=='confirmed'&&!c.doNotContact&&c.canAttend!=='no'&&!['test','supplier'].includes(c.classification)){
  c.appointment={...c.appointment,status:'pending',requestedAt:c.appointment.requestedAt||now.toISOString(),day:preference.day||c.appointment.day,time:preference.time||c.appointment.time};
  c.handoff={status:c.handoff?.status==='in_progress'?'in_progress':'pending',owner:c.owner||OWNER,requestedAt:c.handoff?.requestedAt||now.toISOString(),dueAt:c.handoff?.dueAt||nextServiceDeadline(now)};
  if(!c.events.some(e=>e.type==='appointment_requested'))c.events.push({type:'appointment_requested',at:now.toISOString(),sid:body.MessageSid});
 }
 if(c.classification==='unverified'&&(c.need||scheduling))c.classification='prospect';
 return c;
}
function packageText(k){const p=k.paquete_basico_inicial;return `El Paquete Básico Inicial tiene un valor de ${p.precio_texto}. Corresponde a la cita de valoración; no es el precio del implante ni de la rehabilitación.\n\nNos permite valorar tu caso de forma profesional, obtener un diagnóstico odontológico y diseñar un plan personalizado.\n\nIncluye:\n${p.incluye.map(x=>'* '+x).join('\n')}\n\nEl tratamiento se presupuesta por separado después del diagnóstico.`;}
function workflowResponse(c,text,history,k,now=new Date()){
 const n=normalize(text);const prior=history.filter(x=>x.role==='assistant').map(x=>x.content).join('\n');
 if(!c.packageExplained&&/Integraci[oó]n de historia cl[ií]nica/i.test(prior)&&/1[,.]500/.test(prior))c.packageExplained=true;
 const explicitPackage=/\b(?:valoracion|consulta|paquete)\b/.test(n)&&/\b(?:precio|costo|cuanto|incluye)\b/.test(n);
 const confusion=/1[,.]?500/.test(n)&&/\b(?:implante|implantes|tratamiento|rehabilitacion|completo)\b/.test(n);
 const location=/\b(?:donde|direccion|ubicacion|ubicados|ubican|ubicada|mapa|como llegar|sucursal|cuernavaca|nogales)\b/.test(n);
 const price=/\b(?:precio|cuanto|costo|sale|cuestan)\b/.test(n);
 if(['test','supplier'].includes(c.classification))return null;
 if(c.followUp?.status==='agreed'&&c.followUp.evidenceSid===c.lastInboundSid&&yes(text))return `Gracias. Soy Aura y continuaré el seguimiento por este chat el ${c.followUp.date}. El ${c.followUp.owner} es el responsable de verificar la agenda y confirmar tu cita. Si necesitas cambiar el seguimiento, avísame aquí.`;
 if(c.doNotContact)return 'Entendido. Registré que no deseas recibir seguimiento. Si necesitas ayuda en otro momento, puedes escribirnos por este chat.';
 if(c.whatsappFollowupConsent?.evidence===c.lastInboundSid&&yes(text))return 'Gracias. Soy Aura y continuaré contigo por este WhatsApp para resolver dudas y acompañarte hasta la confirmación de tu cita. El Dr. Jaime verificará la disponibilidad real en agenda.';
 if(location){c.locationShared=true;c.awaiting='attendance';return `Estamos en Plaza Centtral Interlomas, planta baja, local 11, Blvd. Palmas Hills 1, Villa de las Palmas, Estado de México.\nMapa de la dirección: ${k.clinica.mapa_url}\nNuestra sede está en Interlomas. ¿Te es posible acudir a esta ubicación?`;}
 if(c.canAttend==='no')return 'Entiendo; gracias por decirnos. Nuestra sede está en Interlomas. No continuaré con una solicitud de cita si el traslado no te resulta viable. Si quieres revisar alguna duda, podemos resolverla por aquí.';
 if(explicitPackage||confusion){const repeat=c.packageExplained&&!confusion&&!/incluye/.test(n);c.packageExplained=true;c.priceMisunderstanding=confusion||c.priceMisunderstanding;return (repeat?'El Paquete Básico Inicial cuesta $1,500 MXN y corresponde a la valoración; el tratamiento se presupuesta por separado.':packageText(k))+'\n\n¿Te es posible acudir a Interlomas?';}
 if(/\b(?:anticipo|abono|descuenta|toman como|volver a pagar)\b/.test(n)){c.policyQuestion=true;c.handoff={status:'pending',owner:c.owner,requestedAt:now.toISOString(),dueAt:nextServiceDeadline(now)};return 'El Paquete Básico Inicial corresponde a la valoración. No tengo una condición confirmada que permita asegurar que se descuente del tratamiento o cuánto tiempo conserve vigencia. El Dr. Jaime revisará esa condición y te responderá por este chat.';}
 if(price&&c.need==='Implantes dentales'&&c.teeth===2){const first=!c.packageExplained;c.packageExplained=true;return (first?packageText(k)+'\n\n':'')+'Para dos dientes no tengo un precio específico aprobado. No sería correcto asignarte el paquete de tres a cuatro dientes. El Dr. Jaime deberá valorar la solución y confirmar el presupuesto.';}
 if(price&&c.need==='Implantes dentales'&&c.teeth===1){const p=k.precios_publicados.rehabilitacion_implante_un_diente;const first=!c.packageExplained;c.packageExplained=true;return (first?packageText(k)+'\n\n':'')+`La referencia publicada para un diente es ${p.precio_texto}: un implante monofásico y una corona de grapheno o zirconio, sujeto a valoración. El equipo debe confirmar las condiciones de la valoración incluida en ese plan; no asumiré descuentos ni anticipos.\n¿Te es posible acudir a Interlomas?`;}
 if(/\b(?:comentar|consultar|hablar)\b.*\b(?:familia|esposa|esposo)\b|\b(?:manana les confirmo|proxima semana.*(?:aviso|dia)|les aviso la proxima semana)\b/.test(n)&&!c.doNotContact&&c.appointment.status!=='confirmed'){
  const days=/proxima semana/.test(n)?7:1;const target=nextDayDate(now,days);const dueAt=nextServiceDeadline(new Date(`${target}T11:00:00-06:00`),0);const parts=mexicoParts(new Date(dueAt));const date=`${parts.year}-${parts.month}-${parts.day}`;c.followUp={status:'proposed',date,dueAt,owner:c.owner||OWNER,proposedAt:now.toISOString()};c.awaiting='followup';
  return `Por supuesto, puedes revisarlo con calma. ¿Autorizas que yo, Aura, continúe contigo por este WhatsApp el ${date} para resolver dudas y ayudarte a coordinar tu cita? El Dr. Jaime verificará la agenda antes de confirmarla.`;
 }
 if(c.appointment.status==='pending'&&!price&&!explicitPackage){
  const missing=[];if(!c.patientName)missing.push(c.thirdParty?'el nombre completo de la persona que acudirá':'tu nombre completo');if(!c.appointment.day&&!c.appointment.time)missing.push('el día y horario que prefieres');else {if(!c.appointment.day)missing.push('el día que prefieres');if(!c.appointment.time)missing.push('el horario que prefieres');}
  let reply=missing.length?`Con gusto. Para completar la solicitud, compárteme únicamente ${missing.join(' y ')}.`:`Gracias${c.patientName?', '+c.patientName:''}. Recibí tus datos y tu preferencia: ${c.appointment.day} a las ${c.appointment.time}.`;
  if(!c.locationShared){reply+=' Nuestra sede está en Interlomas, Plaza Centtral.';}
  const first=!c.packageExplained;c.packageExplained=true;
  let permission='';if(!missing.length&&!c.whatsappFollowupConsent&&!c.followupPermissionAsked){c.followupPermissionAsked=true;c.awaiting='whatsapp_followup_permission';permission=' ¿Autorizas que Aura te dé seguimiento por este WhatsApp hasta confirmar la cita? Puedes decir NO si no deseas seguimiento.';}
  return (first?packageText(k)+'\n\n':'')+reply+' La solicitud está pendiente de confirmación. Soy Aura y te acompañaré por este chat; el Dr. Jaime verificará la disponibilidad real en agenda.'+permission;
 }
 if(/^(?:¡?hola!?[., ]*)?(?:quiero|quisiera) (?:mas )?informacion[.! ]*$/.test(n)&&!c.need){c.locationShared=true;return `Hola, con gusto te orientamos. Estamos en Plaza Centtral Interlomas, planta baja, local 11.\nMapa de nuestra dirección: ${k.clinica.mapa_url}\n¿Qué tratamiento o necesidad dental te gustaría consultar?`;}
 if(c.awaiting==='attendance'&&yes(text)){c.awaiting=null;return 'Gracias. Podemos coordinar la valoración por este chat. ¿Qué día y horario prefieres? El Dr. Jaime verificará disponibilidad antes de confirmar la cita.';}
 return null;
}
function instructions(c,k){return `CONTEXTO PERSISTENTE DE ATENCIÓN (datos declarados, no diagnóstico): ${JSON.stringify(c)}\nREGLAS PRIORITARIAS DE ATENCIÓN:\n- Responde primero a la pregunta concreta. Conserva tratamiento y número de dientes ya declarados. No repitas menús ni preguntes datos conocidos. Un teléfono ya está disponible; no exijas correo. Si es para otra persona, distingue al interlocutor del paciente.\n- Al inicio, menciona Interlomas brevemente; comparte mapa si solicitan ubicación: ${k.clinica.mapa_url}. Pregunta si puede acudir, sin inferirlo del prefijo telefónico. No afirmes que existe sucursal fuera de Interlomas.\n- $1,500 es la valoración, nunca el precio de implantes. Primera explicación completa del paquete: los nueve componentes y precio; no los recortes. Tratamiento aparte.\n- Precios sólo de la base aprobada, del caso exacto. Dos dientes no equivalen al paquete de 3–4. No sumes paquetes ni inventes financiamiento, anticipos, descuentos o vigencia de valoración.\n- Un paciente que dice haber pagado o agendado no prueba un cobro ni una confirmación: pide al responsable verificar; no cambies esos estados.\n- No diagnostiques ni atribuyas superioridad universal a un material; el doctor indica la solución. No repitas promesas clínicas del anuncio.\n- No hay agenda integrada: NO ofrezcas horas disponibles ni confirmes citas. Recoge sólo datos faltantes y explica pendiente de confirmación por el Dr. Jaime. No redirijas a otro WhatsApp.\n- Si existe cita confirmada, atiende dudas sin volver a capturarla. Si no desea mensajes, no ofrezcas seguimiento. Los seguimientos sólo se registran al aceptar una propuesta concreta. No afirmes que llamaste, agendaste, enviaste alertas o registraste datos no incluidos en este contexto.\n- No termines con “cuando decidas, avísanos” como único siguiente paso. Si el contexto no contiene un seguimiento propuesto, pregunta cuándo desea que el Dr. Jaime continúe; no declares que quedó registrado. Una pregunta por respuesta y tono profesional, cálido, sin presión ni frases publicitarias vacías.`;}
function recordResponse(c,reply,k){const n={...c};if(k.paquete_basico_inicial.incluye.every(x=>reply.includes(x)))n.packageExplained=true;if(reply.includes(k.clinica.mapa_url))n.locationShared=true;return n;}
function validateManual(previous,input,now=new Date()){
 const c={...initial(),...previous,payments:[...(previous?.payments||[])],events:[...(previous?.events||[])]};
 const allowedClass=['unverified','prospect','test','supplier','duplicate'];if(input.classification!==undefined){if(!allowedClass.includes(input.classification))throw new Error('Clasificación inválida');c.classification=input.classification;}
 if(input.canAttend!==undefined){if(!['unknown','yes','no'].includes(input.canAttend))throw new Error('Asistencia posible inválida');c.canAttend=input.canAttend;}
 for(const key of ['owner','need','sourceNote','lossReason'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>1000)throw new Error('Dato inválido');c[key]=input[key].trim();}
 if(input.whatsappConsentEvidence){if(typeof input.whatsappConsentEvidence!=='string'||input.whatsappConsentEvidence.length>1000)throw new Error('Evidencia de consentimiento inválida');c.whatsappFollowupConsent={evidence:input.whatsappConsentEvidence.trim(),scope:'Seguimiento de la consulta por WhatsApp',recordedAt:now.toISOString(),recordedBy:c.owner||OWNER};}
 if(input.followUpDate){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-06:00$/.test(input.followUpDate)||!Number.isFinite(Date.parse(input.followUpDate)))throw new Error('Fecha de seguimiento inválida');if(!String(input.followUpEvidence||'').trim())throw new Error('Indica el acuerdo del paciente');c.followUp={status:'agreed',dueAt:input.followUpDate,date:input.followUpDate.slice(0,10),owner:c.owner||OWNER,evidence:String(input.followUpEvidence).slice(0,1000),recordedAt:now.toISOString()};}
 if(input.followUpDone&&c.followUp)c.followUp={...c.followUp,status:'completed',completedAt:now.toISOString()};
 if(input.appointmentAt){if(!Number.isFinite(Date.parse(input.appointmentAt))||!String(input.appointmentEvidence||'').trim())throw new Error('Una cita confirmada requiere fecha y comprobación de agenda');c.appointment={...c.appointment,status:'confirmed',at:input.appointmentAt,evidence:String(input.appointmentEvidence).slice(0,1000),confirmedBy:c.owner||OWNER,confirmedAt:now.toISOString()};c.events.push({type:'appointment_confirmed',at:now.toISOString(),appointmentAt:input.appointmentAt});if(c.handoff)c.handoff={...c.handoff,status:'completed'};}
 if(input.attendance!==undefined){if(!['unknown','attended','no_show'].includes(input.attendance))throw new Error('Estado de asistencia inválido');c.attendance=input.attendance;}
 if(input.treatmentAccepted!==undefined){if(typeof input.treatmentAccepted!=='boolean')throw new Error('Aceptación inválida');c.treatmentAccepted=input.treatmentAccepted;}
 if(input.payment){const p=input.payment;if(!Number.isFinite(p.amount)||p.amount<=0||p.currency!=='MXN'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!String(p.reference||'').trim())throw new Error('El cobro requiere importe positivo, fecha y comprobante');if(!c.payments.some(x=>x.reference===p.reference))c.payments.push({amount:p.amount,currency:'MXN',date:p.date,reference:String(p.reference).slice(0,300),recordedAt:now.toISOString(),recordedBy:c.owner||OWNER});}
 c.version=VERSION;c.updatedAt=now.toISOString();if(Buffer.byteLength(JSON.stringify(c),'utf8')>14000)throw new Error('La ficha llegó al límite de almacenamiento; no se guardaron cambios. Solicita ampliar el registro de cobros.');return c;
}
function metrics(conversations){const all=conversations.map(x=>x.commercial).filter(Boolean);const eligible=all.filter(x=>x.classification==='prospect');return {classified:all.length,excluded:all.filter(x=>['test','supplier','duplicate'].includes(x.classification)).length,unverified:all.filter(x=>x.classification==='unverified').length,prospects:eligible.length,verifiedMeta:eligible.filter(x=>x.source?.verified&&x.source.channel==='meta_ads').length,canAttend:eligible.filter(x=>x.canAttend==='yes').length,requested:eligible.filter(x=>x.appointment?.requestedAt).length,confirmed:eligible.filter(x=>x.appointment?.status==='confirmed').length,attended:eligible.filter(x=>x.attendance==='attended').length,accepted:eligible.filter(x=>x.treatmentAccepted===true).length,collectedMXN:eligible.reduce((s,x)=>s+(x.payments||[]).reduce((a,p)=>a+p.amount,0),0),scope:'Sólo fichas comerciales registradas; no reconstruye resultados históricos ni verifica comprobantes bancarios.'};}
module.exports={VERSION,OWNER,normalize,yes,no,initial,updateInbound,workflowResponse,instructions,recordResponse,validateManual,metrics,nextServiceDeadline,nextDayDate,packageText,appointmentPreference};

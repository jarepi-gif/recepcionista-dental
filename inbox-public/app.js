'use strict';
const $=id=>document.getElementById(id);
const linkedPhone=new URLSearchParams(location.search).get('phone');
let attentionFilter='all';
let conversations=[], selected=null, busy=false, loading=false, sending=false, requestId=null, draftPhone=null, lastFingerprint='', timer;
function notice(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('notice').hidden=true,7000);}
async function api(path,options={}){
  const response=await fetch('/api/inbox/'+path,{...options,headers:{'Content-Type':'application/json','X-Inbox-Request':'1',...options.headers}});
  const data=await response.json();if(!response.ok){if(response.status===401){$('login').hidden=false;$('workspace').hidden=true;}throw new Error(data.error||'No se pudo conectar.');}return data;
}
const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
function date(value){return value?new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';}
function renderPatients(){
  const query=$('search').value.toLowerCase();$('patients').replaceChildren();const filtered=conversations.filter(c=>(c.name+' '+c.phone).toLowerCase().includes(query)).filter(c=>attentionFilter==='all'||c.attention?.[attentionFilter]);$('count').textContent=conversations.length+' conversaciones';
  $('unread-count').textContent=conversations.filter(c=>c.attention?.unread).length;
  $('pending-count').textContent=conversations.filter(c=>c.attention?.pending).length;
  if(!filtered.length){const p=document.createElement('p');p.textContent=conversations.length?'No hay conversaciones que coincidan con este filtro.':'Sin conversaciones. Usa “Recuperar recientes” para cargar el historial disponible de Twilio.';$('patients').append(p);}
  for(const c of filtered){const button=document.createElement('button');button.className='patient'+(selected===c.phone?' active':'');const strong=document.createElement('strong');strong.textContent=c.name||c.phone.replace('whatsapp:','');const p=document.createElement('p');p.textContent=c.preview||'Abrir conversación';const small=document.createElement('small');small.textContent=(c.mode==='human'?'Atención humana · ':'Aura · ')+date(c.lastInbound);if(c.mode==='human')small.className='tag';const pending=c.commercial?.handoff;const follow=c.commercial?.followUp;if(pending?.status==='pending')small.textContent+=' · Solicitud pendiente'+(Date.parse(pending.dueAt)<Date.now()?' · Fuera de objetivo':'');if(follow?.status==='agreed')small.textContent+=' · Seguimiento '+date(follow.dueAt);const indicators=document.createElement('span');indicators.className='chat-indicators';
  for(const [state,label] of [['unread','Sin leer'],['pending','Por atender'],['unknown','Por revisar']]){if(c.attention?.[state]){const badge=document.createElement('span');badge.className='chat-indicator '+state;badge.textContent=label;indicators.append(badge);}}
  button.append(strong,indicators,p,small);button.onclick=()=>openConversation(c.phone);$('patients').append(button);}
}
async function openConversation(phone){
  if(sending)return notice('Espera a que termine el envío.');
  if(draftPhone!==phone){if($('body').value && !confirm('¿Descartar el mensaje sin enviar?'))return;$('body').value='';requestId=null;draftPhone=phone;}
  selected=phone;lastFingerprint='';document.body.classList.add('chat-open');$('empty').hidden=true;$('conversation').hidden=false;$('messages').replaceChildren();$('body').disabled=true;$('send').disabled=true;renderPatients();await refreshMessages();
}
async function refreshMessages(){
  const phone=selected;if(!phone)return;const data=await api('messages?phone='+encodeURIComponent(phone));if(phone!==selected)return;
  const c=data.conversation;
  if(!document.hidden&&$('messages').getClientRects().length&&c.lastInbound&&Date.parse(c.lastReviewedInbound||0)<Date.parse(c.lastInbound)){
    const reviewed=await post('review',{phone,lastInbound:c.lastInbound});c.lastReviewedInbound=reviewed.conversation.lastReviewedInbound;
    if(phone===selected){const item=conversations.find(x=>x.phone===phone);if(item){item.lastReviewedInbound=c.lastReviewedInbound;if(item.attention)item.attention.unread=Date.parse(item.lastInbound)>Date.parse(c.lastReviewedInbound);}renderPatients();}
  }
  if(phone!==selected)return;
  renderAdOrigin(c);renderHumanContact(c,data.canSend);renderRecoveryCase(c);renderCommercial(c);$('patient-name').textContent=c.name||'Paciente';$('patient-phone').textContent=c.phone.replace('whatsapp:','');$('mode-badge').textContent=c.mode==='human'?'Atención humana':'Aura activa';$('mode-description').textContent=c.mode==='human'?'Aura está pausada. Tus respuestas salen desde el WhatsApp oficial.':'Aura responde automáticamente. Toma el control para atender al paciente.';$('take').hidden=c.mode==='human';$('resume').hidden=c.mode!=='human';
  const canSend=c.mode==='human'&&data.canSend&&!sending;$('body').disabled=c.mode!=='human'||sending;$('send').disabled=!canSend;$('body').placeholder=c.mode==='human'?'Escribe tu respuesta…':'Toma la conversación para responder';$('send-hint').textContent=!data.canSend?'Último mensaje del paciente: '+date(c.lastInbound)+'. Puedes preparar tu respuesta aquí. Para enviarla, WhatsApp requiere primero una plantilla y la respuesta del paciente. Revisa las opciones de atención humana que aparecen arriba.':c.mode==='human'?'Atención humana activa · Aura está pausada':'Toma la conversación para habilitar la respuesta manual.';
  const fingerprint=JSON.stringify(data.messages);if(fingerprint===lastFingerprint)return;lastFingerprint=fingerprint;const box=$('messages');const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<100;const initial=!box.childNodes.length;box.replaceChildren();
  if(!data.messages.length){const p=document.createElement('p');p.textContent='No hay mensajes disponibles en Twilio para este paciente.';box.append(p);}
  for(const m of data.messages){const div=document.createElement('article');div.className='message'+(m.actor==='patient'?'':' out');const actor=document.createElement('span');actor.className='actor';actor.textContent=m.actor==='patient'?'Paciente':m.actor==='human'?'Dr. Jaime / Equipo':'Aura / Automatización';const p=document.createElement('p');p.textContent=m.body||'['+m.media+' archivo(s) recibido(s)]';const small=document.createElement('small');const statuses={queued:'En cola',sent:'Enviado',delivered:'Entregado',read:'Leído',failed:'Fallido',undelivered:'No entregado',received:'Recibido',sending:'Enviando'};small.textContent=date(m.time)+' · '+(statuses[m.status]||m.status)+(m.errorCode?' · Error '+m.errorCode:'');div.append(actor,p,small);for(let index=0;index<m.media;index++){const a=document.createElement('a');a.href='/api/inbox/media?sid='+encodeURIComponent(m.sid)+'&index='+index;a.textContent='Descargar archivo '+(index+1);a.style.display='block';div.append(a);}box.append(div);}if(atBottom||initial)box.scrollTop=box.scrollHeight;
}
async function refresh(){if(loading||document.hidden||$('workspace').hidden)return;loading=true;try{const data=await api('conversations');conversations=data.conversations;if(typeof checkIncomingAvisos==='function')checkIncomingAvisos(conversations);renderPatients();await refreshMessages();$('connection').textContent='Actualizado '+new Date().toLocaleTimeString('es-MX');}catch(e){$('connection').textContent='Sin conexión · reintentando';notice(e.message);}finally{loading=false;}}
$('search').oninput=renderPatients;
$('login-form').onsubmit=async e=>{e.preventDefault();try{await post('session',{password:$('password').value});$('password').value='';$('login').hidden=true;$('workspace').hidden=false;await refresh();if(linkedPhone)await openConversation(linkedPhone);}catch(error){$('login-error').textContent=error.message;}};
$('logout').onclick=async()=>{try{await post('logout',{});selected=null;conversations=[];$('patients').replaceChildren();$('messages').replaceChildren();$('body').value='';$('workspace').hidden=true;$('login').hidden=false;}catch(e){notice(e.message);}};
$('back').onclick=()=>document.body.classList.remove('chat-open');
async function setMode(mode){if(busy||!selected)return;if(mode==='aura'&&!confirm('¿Devolver esta conversación a Aura? Responderá automáticamente al próximo mensaje del paciente.'))return;busy=true;$('take').disabled=true;$('resume').disabled=true;try{await post('mode',{phone:selected,mode});await refreshMessages();await refresh();}catch(e){notice(e.message);}finally{busy=false;$('take').disabled=false;$('resume').disabled=false;}}
$('take').onclick=()=>setMode('human');$('resume').onclick=()=>setMode('aura');
$('body').oninput=()=>{requestId=null;};
$('reply').onsubmit=async e=>{e.preventDefault();if(sending||!selected||!$('body').value.trim())return;sending=true;$('send').disabled=true;$('body').disabled=true;requestId=requestId||crypto.randomUUID();const phone=selected;try{const result=await post('send',{phone,body:$('body').value,requestId});$('body').value='';requestId=null;notice('Twilio aceptó el mensaje. Estado: '+result.status);await refreshMessages();}catch(error){notice(error.message);}finally{sending=false;await refreshMessages().catch(()=>{});}};
$('recover').onclick=async()=>{if(busy)return;busy=true;$('recover').disabled=true;try{const data=await post('recover',{});notice('Se recuperaron '+data.recovered+' conversaciones recientes.');await refresh();}catch(e){notice(e.message);}finally{busy=false;$('recover').disabled=false;}};
(async()=>{try{const access=new URLSearchParams(location.hash.slice(1)).get('access');if(access){history.replaceState(null,'','/bandeja'+location.search);await post('session',{password:access});}await api('conversations');$('workspace').hidden=false;await refresh();if(linkedPhone)await openConversation(linkedPhone);}catch{$('login').hidden=false;}setInterval(refresh,10000);})();

let commercialPhone=null,commercialDirty=false;
function renderCommercial(conversation){
 const c=conversation.commercial||{};const phone=conversation.phone;
 const pending=c.handoff?.status==='pending';
 $('commercial-status').textContent='Origen: '+(c.source?.verified?c.source.channel+' · '+(c.source.adId||''):'Por verificar')+' · Cita: '+(c.appointment?.status==='confirmed'?'Confirmada':c.appointment?.status==='pending'?'Solicitud pendiente':'Sin cita registrada')+(pending?' · Responsable: '+(c.handoff.owner||'Dr. Jaime Reyes')+' · Objetivo: '+date(c.handoff.dueAt):'')+(c.followUp?' · Seguimiento: '+c.followUp.status+' '+date(c.followUp.dueAt):'')+' · Cobros registrados: $'+(c.payments||[]).reduce((s,p)=>s+p.amount,0).toFixed(2)+' MXN';
 if(commercialPhone===phone&&commercialDirty)return;
 commercialPhone=phone;commercialDirty=false;
 $('contact-class').value=c.classification||'unverified';$('can-attend').value=c.canAttend||'unknown';$('commercial-owner').value=c.owner||'Dr. Jaime Reyes';$('commercial-need').value=c.need||'';$('source-note').value=c.sourceNote||'';$('loss-reason').value=c.lossReason||'';$('attendance').value=c.attendance||'unknown';$('treatment-accepted').checked=Boolean(c.treatmentAccepted);
 // These fields add evidence; do not silently submit old confirmations again.
 for(const id of ['followup-at','followup-evidence','appointment-at','appointment-evidence','payment-amount','payment-date','payment-reference','whatsapp-consent'])$(id).value='';$('followup-done').checked=false;
}
$('commercial-form').addEventListener('input',()=>commercialDirty=true);
$('commercial-form').onsubmit=async e=>{e.preventDefault();if(!selected)return;const phone=selected;$('save-commercial').disabled=true;
 try{const input={phone,classification:$('contact-class').value,canAttend:$('can-attend').value,owner:$('commercial-owner').value,need:$('commercial-need').value,sourceNote:$('source-note').value,lossReason:$('loss-reason').value,attendance:$('attendance').value,treatmentAccepted:$('treatment-accepted').checked,followUpDone:$('followup-done').checked};
 if($('whatsapp-consent').value.trim())input.whatsappConsentEvidence=$('whatsapp-consent').value.trim();
 if($('followup-at').value){input.followUpDate=$('followup-at').value+':00-06:00';input.followUpEvidence=$('followup-evidence').value;}
 if($('appointment-at').value){input.appointmentAt=$('appointment-at').value+':00-06:00';input.appointmentEvidence=$('appointment-evidence').value;}
 if($('payment-amount').value)input.payment={amount:Number($('payment-amount').value),currency:'MXN',date:$('payment-date').value,reference:$('payment-reference').value};
 await post('commercial',input);commercialDirty=false;notice(input.appointmentAt?'Cita registrada. Aura comunicará la confirmación si la ventana de WhatsApp está abierta.':'Ficha guardada.');await refreshMessages();await refresh();
 }catch(error){notice(error.message);}finally{$('save-commercial').disabled=false;}
};
$('commercial-summary').onclick=async()=>{try{const m=await api('commercial-summary');$('summary-results').hidden=false;$('summary-results').textContent='Prospectos clasificados: '+m.prospects+' · Meta verificado: '+m.verifiedMeta+' · Pueden acudir: '+m.canAttend+' · Solicitudes: '+m.requested+' · Citas confirmadas: '+m.confirmed+' · Asistieron: '+m.attended+' · Tratamientos aceptados: '+m.accepted+' · Cobros: $'+m.collectedMXN.toFixed(2)+' MXN · Excluidos: '+m.excluded+' · Por verificar: '+m.unverified+'. '+m.scope;}catch(error){notice(error.message);}};

const recoveryLabels={queued:'Pendiente',sent:'Enviado; esperando respuesta',responded:'Respondió; continuar hasta confirmar agenda',confirmed:'Cita confirmada',excluded:'Excluido',human:'A cargo del responsable',uncertain:'Envío incierto; revisar',sending:'Procesando'};
const blockedLabels={needs_consent:'Falta permiso registrado para seguimiento fuera de 24 horas',needs_template:'Falta plantilla aprobada de recuperación'};
function renderRecoveryCase(c){const r=c.recovery;$('recovery-case-status').textContent=r?'Recuperación: '+(recoveryLabels[r.status]||r.status)+' · '+(blockedLabels[r.blockedReason]||r.blockedReason||'')+' · Responsable: '+(c.commercial?.owner||'Dr. Jaime Reyes'):'';}
async function showRecovery(){const data=await api('recovery');const m=data.report;$('recovery-status').textContent=(data.settings.enabled?'Seguimiento automático activo':'Seguimiento automático pausado')+' · Plantilla: '+data.template.status;$('recovery-results').textContent='Inscritos: '+m.enrolled+' · Enviados: '+m.sent+' · Entregados/leídos: '+m.delivered+' · Respondieron: '+m.responded+' · Citas tras respuesta: '+m.confirmedAfterResponse+' · Asistencias: '+m.attended+' · Cobros registrados: $'+m.collectedMXN.toFixed(2)+' MXN\n'+m.cases.map(c=>c.name+' (…'+c.phoneLast4+') — '+(recoveryLabels[c.status]||c.status)+(c.blockedReason?' · '+(blockedLabels[c.blockedReason]||c.blockedReason):'')+' · '+c.owner).join('\n')+'\n'+m.scope;}
async function recoveryAction(path,input={}){if(busy)return;busy=true;try{const result=await post('recovery/'+path,input);notice(result.notEnrolledReason||'Recuperación actualizada.');await showRecovery();await refresh();}catch(e){notice(e.message);}finally{busy=false;}}
$('recovery-report').onclick=()=>showRecovery().catch(e=>notice(e.message));
$('recovery-enable').onclick=()=>recoveryAction('settings',{enabled:true});
$('recovery-pause').onclick=()=>recoveryAction('settings',{enabled:false});
$('recovery-recent').onclick=()=>recoveryAction('recent');
$('recovery-run').onclick=()=>recoveryAction('run');
$('recovery-enroll').onclick=()=>selected&&recoveryAction('enroll',{phone:selected});

let humanTemplate=null,humanConversation=null,humanRequestId=null,humanDraftPhone=null,humanTemplateCheckedAt=0,humanCanSend=false;
function renderHumanContact(c,canSend){
 humanConversation=c;humanCanSend=canSend;
 if(humanDraftPhone!==c.phone){humanDraftPhone=c.phone;humanRequestId=null;humanTemplateCheckedAt=0;$('human-template-request').textContent='';}
 $('human-contact').hidden=Boolean(canSend);
 if(!canSend){$('human-contact').open=true;if((!humanTemplate||Date.now()-humanTemplateCheckedAt>=30000)&&!$('human-template-check').disabled)checkHumanTemplate();}
 const consent=c.commercial?.whatsappFollowupConsent?.evidence;
 const refused=c.commercial?.doNotContact||c.commercial?.followUp?.status==='declined';
 const awaiting=c.humanTemplate?.sid&&c.humanTemplate.baselineInboundSid===(c.lastInboundSid||null);
 $('human-template-send').disabled=sending||c.mode!=='human'||!consent||refused||awaiting||humanTemplate?.status!=='approved';
 $('human-template-hint').textContent=refused?'Este contacto rechazó el seguimiento.':awaiting?'Plantilla ya enviada. Espera la respuesta del paciente; Aura sigue pausada.':c.mode!=='human'?'Pulsa Tomar conversación para atenderlo tú.':!consent?'Falta el permiso de este contacto. En Ficha comercial y seguimiento registra la evidencia real del permiso para continuar por WhatsApp, recibido por llamada telefónica o por mensaje.':humanTemplate?.status==='approved'?'Plantilla aprobada y lista para envío manual. Pulsa Enviar plantilla de atención humana.':'La aprobación se consulta automáticamente; también puedes pulsar Consultar plantilla.';
}
async function checkHumanTemplate(prepare=false,retry=false){
 $('human-template-check').disabled=true;$('human-template-prepare').disabled=true;
 try{humanTemplate=prepare?await post('human-template/prepare',{retry}):await api('human-template');humanTemplateCheckedAt=Date.now();
 const labels={approved:'Aprobada',pending:'Pendiente de aprobación',received:'Recibida para revisión',rejected:'Rechazada',unsubmitted:'Sin enviar a revisión',not_configured:'Sin configurar',paused:'Pausada',disabled:'Deshabilitada'};
 $('human-template-status').textContent=humanTemplate.source==='recovery'?'Plantilla de recuperación aprobada disponible para envío manual. El texto menciona a Aura, pero la conversación permanece a tu cargo.':'Plantilla de atención humana: '+(labels[humanTemplate.status]||humanTemplate.status);
 $('human-template-preview').textContent='Plantilla: '+humanTemplate.body;
 $('human-template-prepare').hidden=!['not_configured','unsubmitted','pending','received','rejected'].includes(humanTemplate.status);
 $('human-template-prepare').textContent=['pending','received','rejected'].includes(humanTemplate.status)?'Volver a solicitar aprobación':'Solicitar aprobación de plantilla';
 if(prepare){const request=humanTemplate.approvalRequest;$('human-template-request').textContent=request?(request.accepted?'El proveedor aceptó la solicitud de revisión. Aún requiere aprobación para enviar.':'El proveedor no aceptó el reintento'+(request.providerCode?' ('+request.providerCode+')':'')+': '+request.reason):'La plantilla conserva su estado actual; no se envió otra solicitud.';}
 if(humanConversation)renderHumanContact(humanConversation,humanCanSend);
 }catch(e){humanTemplate=null;$('human-template-send').disabled=true;notice(e.message);}finally{$('human-template-check').disabled=false;$('human-template-prepare').disabled=false;}
}
$('human-template-check').onclick=()=>checkHumanTemplate();
$('human-contact').ontoggle=()=>{if($('human-contact').open&&!humanTemplate)checkHumanTemplate();};
$('human-template-prepare').onclick=()=>checkHumanTemplate(true,['pending','received','rejected'].includes(humanTemplate?.status));
$('human-template-send').onclick=async()=>{
 if(sending||!selected||$('human-template-send').disabled)return;
 const phone=selected;
 if(!confirm('¿Enviar este mensaje de atención humana a '+$('patient-name').textContent+' ('+$('patient-phone').textContent+')?\n\n'+humanTemplate.body))return;
 sending=true;$('human-template-send').disabled=true;humanRequestId=humanRequestId||crypto.randomUUID();
 try{const result=await post('human-template/send',{phone,requestId:humanRequestId});humanRequestId=null;notice('Plantilla aceptada por WhatsApp ('+result.status+'). Aura sigue pausada; espera la respuesta para escribir libremente.');}
 catch(e){notice(e.message);}finally{sending=false;await refreshMessages().catch(()=>{});}
};

$('attention-filter').onchange=()=>{attentionFilter=$('attention-filter').value;renderPatients();};

let consentPreview=null;
$('phone-consent-preview').onclick=async()=>{
 if(busy)return;busy=true;$('phone-consent-apply').hidden=true;
 try{const before=$('phone-consent-before').value;const result=await post('phone-consent/preview',{before});consentPreview={before,phones:result.contacts.map(c=>c.phone)};$('phone-consent-results').textContent=result.count+' contactos elegibles. Se excluyen rechazos, pruebas, proveedores y duplicados.\n'+result.contacts.map(c=>c.name+' (…'+c.phone.slice(-4)+')').join('\n');$('phone-consent-apply').hidden=!result.count;}
 catch(e){consentPreview=null;notice(e.message);}finally{busy=false;}
};
$('phone-consent-before').onchange=()=>{consentPreview=null;$('phone-consent-apply').hidden=true;};
$('phone-consent-apply').onclick=async()=>{
 if(busy||!consentPreview)return;
 if(!confirm('¿Confirmas que estos '+consentPreview.phones.length+' contactos autorizaron por llamada el seguimiento por WhatsApp? Se registrará tu declaración y se activará atención humana, sin enviar mensajes.'))return;
 busy=true;$('phone-consent-apply').disabled=true;
 try{const result=await post('phone-consent/apply',{...consentPreview,confirmed:true});$('phone-consent-results').textContent=result.updated+' contactos habilitados para atención humana. '+result.skipped+' omitidos. No se enviaron mensajes.\n'+result.contacts.map(c=>c.name+' (…'+c.phone.slice(-4)+')').join('\n');consentPreview=null;$('phone-consent-apply').hidden=true;await refresh();}
 catch(e){notice(e.message);}finally{busy=false;$('phone-consent-apply').disabled=false;}
};

function renderAdOrigin(conversation){
 const box=$('ad-origin'),commercial=conversation.commercial||{},source=commercial.initialAdSource||commercial.source||{};
 box.replaceChildren();
 const title=document.createElement('strong');
 title.textContent=source.verified&&source.adId?'Promocional que originó la conversación':'Promocional de origen: no identificado';box.append(title);
 if(source.verified&&source.adId){
  const headline=document.createElement('p');headline.textContent=source.headline||'Anuncio o publicación de Meta';box.append(headline);
  if(source.body){const text=document.createElement('p');text.className='ad-copy';text.textContent=source.body;box.append(text);}
  const evidence=document.createElement('small');evidence.textContent='Referencia recibida de WhatsApp · ID: '+source.adId+(source.receivedAt?' · '+date(source.receivedAt):'');box.append(evidence);
  try{const url=new URL(source.url);if(['https:','http:'].includes(url.protocol)){const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Ver promocional original';box.append(link);}}catch{}
 }else{
  const text=document.createElement('p');text.textContent='No hay datos del promocional registrados para este chat. El saludo «¡Hola! Quiero más información» no identifica el anuncio.';box.append(text);
  if(source.reference){const reference=document.createElement('small');reference.textContent='Referencia THERA recibida: '+source.reference+' · Promocional por verificar';box.append(reference);}
 }
 if(commercial.sourceNote){const note=document.createElement('small');note.textContent='Nota de origen registrada: '+commercial.sourceNote;box.append(note);}
}

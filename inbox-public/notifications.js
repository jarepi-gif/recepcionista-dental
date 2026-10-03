'use strict';
let noticeAudio=null;
let webAvisos=localStorage.getItem('thera-avisos')==='on';
const notifiedMessages=new Set();
const inboxBaselines=new Map();
function pulsePhone(eventId){
  if(!webAvisos||document.hidden||notifiedMessages.has(eventId))return;
  notifiedMessages.add(eventId);if(notifiedMessages.size>200)notifiedMessages.delete(notifiedMessages.values().next().value);
  navigator.vibrate?.([250,120,250]);
  document.body.classList.remove('message-flash');void document.body.offsetWidth;document.body.classList.add('message-flash');
  if(noticeAudio?.state==='running'){
    for(const [delay,frequency] of [[0,880],[0.22,660]]){const oscillator=noticeAudio.createOscillator(),gain=noticeAudio.createGain();oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0.12,noticeAudio.currentTime+delay);gain.gain.exponentialRampToValueAtTime(0.001,noticeAudio.currentTime+delay+0.18);oscillator.connect(gain);gain.connect(noticeAudio.destination);oscillator.start(noticeAudio.currentTime+delay);oscillator.stop(noticeAudio.currentTime+delay+0.2);}
  }
}
function checkIncomingAvisos(conversations){
  for(const conversation of conversations){const c=conversation.commercial;const task=c?.followUp?.status==='agreed'?c.followUp:c?.handoff?.status==='pending'?c.handoff:null;if(task?.dueAt&&Date.parse(task.dueAt)<Date.now())pulsePhone('task-'+conversation.phone+'-'+task.dueAt);const sid=conversation.lastInboundSid;if(!sid)continue;const previous=inboxBaselines.get(conversation.phone);if(previous&&previous!==sid)pulsePhone(sid);else if(!previous&&inboxBaselines.size&&new Date(conversation.lastInbound)>new Date(Date.now()-20000))pulsePhone(sid);inboxBaselines.set(conversation.phone,sid);}
}
function applicationKey(value){const bytes=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(bytes,c=>c.charCodeAt(0));}
const alertsButton=document.getElementById('activate-avisos');
alertsButton.onclick=async()=>{
  alertsButton.disabled=true;
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(Audio){noticeAudio=noticeAudio||new Audio();noticeAudio.resume().then(()=>pulsePhone('sound-test-'+Date.now())).catch(()=>{});}
    const permission=('Notification'in window)?Notification.requestPermission():Promise.resolve('unsupported');
    webAvisos=true;localStorage.setItem('thera-avisos','on');if(!noticeAudio)pulsePhone('sound-test-'+Date.now());
    const result=await permission;
    if(result!=='granted'||!('serviceWorker'in navigator)||!('PushManager'in window)){notice('Sonido y aviso visual activados con la página abierta. Permite las notificaciones en Chrome para recibir avisos en segundo plano.');alertsButton.textContent='Probar avisos';return;}
    await navigator.serviceWorker.register('/inbox-sw.js',{scope:'/'});
    const registration=await navigator.serviceWorker.ready;
    const key=await api('push-key');const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(key.publicKey)});
    await post('push-subscription',{subscription:subscription.toJSON()});
    const sent=await post('push-test',{});alertsButton.textContent='Probar avisos';
    notice(sent.accepted?'Avisos activados. Revisa que Chrome tenga sonido y vibración permitidos en tu celular.':'Se guardó este celular, pero el aviso de prueba no fue aceptado. Pulsa Probar avisos para reintentar.');
  }catch(error){notice(error.message||'No fue posible activar los avisos.');}
  finally{alertsButton.disabled=false;}
};
document.addEventListener('pointerdown',()=>{if(webAvisos){const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){noticeAudio=noticeAudio||new Audio();noticeAudio.resume().catch(()=>{});}}},{passive:true});
if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='thera-inbound'){pulsePhone(event.data.eventId);refresh();}});
if(webAvisos)alertsButton.textContent='Activar / probar avisos';

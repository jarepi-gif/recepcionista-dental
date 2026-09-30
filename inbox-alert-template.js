const SETTINGS='thera-alert-template-v2';
const NAME='thera_inbox_attention_v2';
const BODY='THERA | Solicitud de atención\n\nContacto: {{1}}\nTratamiento: {{2}}\nEstado: {{3}}\n\nAbre la conversación para atender la solicitud y coordinar la cita: {{4}}\n\nEl paciente continúa en el WhatsApp oficial de Thera.';
let preparing;
async function templateStatus(client) {
  try {
    const setting=await client.sync.v1.services('default').documents(SETTINGS).fetch();
    if(!setting.data.sid)return {status:'not_configured'};
    const approval=await client.content.v1.contents(setting.data.sid).approvalFetch().fetch();
    return {sid:setting.data.sid,status:String(approval.whatsapp?.status||'unknown').toLowerCase(),rejectionReason:approval.whatsapp?.rejection_reason||''};
  } catch(e) {if(e.status===404)return {status:'not_configured'};throw e;}
}
async function prepareTemplate(client) {
  if(preparing)return preparing;
  preparing=(async()=>{
    const current=await templateStatus(client);if(current.sid)return current;
    const contents=await client.content.v1.contents.list({limit:1000});
    let content=contents.find(c=>c.friendlyName===NAME);
    if(!content)content=await client.content.v1.contents.create({friendly_name:NAME,language:'es_MX',variables:{1:'Contacto de prueba | WhatsApp: +525500000000',2:'Valoración dental',3:'Solicitud de valoración',4:'https://recepcionista-dental.onrender.com/bandeja?phone=whatsapp%3A%2B525500000000'},types:{'twilio/text':{body:BODY}}});
    let approval;
    try {approval=await client.content.v1.contents(content.sid).approvalFetch().fetch();}catch(e){if(e.status!==404)throw e;}
    if(!approval?.whatsapp?.status || String(approval.whatsapp.status).toLowerCase()==='unsubmitted') await client.content.v1.contents(content.sid).approvalCreate.create({name:NAME,category:'UTILITY'});
    const documents=client.sync.v1.services('default').documents;
    try {await documents.create({uniqueName:SETTINGS,data:{sid:content.sid}});}catch(e){if(e.status!==409)throw e;await documents(SETTINGS).update({data:{sid:content.sid}});}
    return templateStatus(client);
  })();
  try{return await preparing;}finally{preparing=null;}
}
module.exports={templateStatus,prepareTemplate,BODY};

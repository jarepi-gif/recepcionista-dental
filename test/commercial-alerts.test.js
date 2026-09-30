const test = require('node:test');
const assert = require('node:assert/strict');
const { alertConfig, alertEventFor, resolveCommercialAlertEvent, patientContactDetails, sendCommercialAlert,inboundInterestEvent,inboundTreatment } = require('../commercial-alerts');

const env = { TWILIO_ACCOUNT_SID:'ACtest', TWILIO_AUTH_TOKEN:'secret', TWILIO_WHATSAPP_NUMBER:'+5210000000000', THERA_ALERT_RECIPIENT:'+5256000000000', THERA_ALERT_CONTENT_SID:'HXtest' };

test('informational treatment inquiries alert independently from scheduling and name detection',()=>{
  const {extractPatientFullName,classifyAuraIntent}=require('../aura-cro-policy');
  for(const message of ['Hola quiero informacion sobre implante','Me interesa un implante dental','JR Hola quiero mas informacion','Resinas esteticas','Carillas','Coronas dentales','Costos']) {
    assert.equal(inboundInterestEvent(message),'LEAD_INTEREST');assert.equal(extractPatientFullName(message,true),null);assert.equal(classifyAuraIntent(message),'INFORMACION_GENERAL');
  }
  assert.equal(inboundTreatment('Hola quiero informacion sobre implante'),'Implantes dentales');
  assert.equal(inboundTreatment('Resinas esteticas'),'Resinas estéticas');
  assert.equal(inboundInterestEvent('Gracias'),null);assert.equal(inboundInterestEvent('María López'),null);
  assert.equal(inboundInterestEvent('Quiero agendar una valoración'),null);
});

test('maps commercial states without alerting normal conversations', () => {
  assert.equal(alertEventFor({patientState:'NORMAL'}), null);
  assert.equal(alertEventFor({patientState:'VALUATION_REQUESTED'}), 'VALUATION_REQUESTED');
  assert.equal(alertEventFor({patientState:'HANDOFF_PENDING_CONFIRMATION'}), 'INTENCION_DE_AGENDAR');
  assert.equal(alertEventFor({humanHandoffRequired:true}), 'HUMAN_HANDOFF_REQUIRED');
});

test('keeps an Aura scheduling intent alertable when Xim has not advanced state', () => {
  assert.equal(
    resolveCommercialAlertEvent({patientState:'NORMAL'}, 'INTENCION_DE_AGENDAR', null),
    'INTENCION_DE_AGENDAR'
  );
  assert.equal(
    resolveCommercialAlertEvent({patientState:'UNKNOWN'}, 'OTRO', 'INTENCION_DE_AGENDAR'),
    'INTENCION_DE_AGENDAR'
  );
  assert.equal(resolveCommercialAlertEvent({patientState:'NORMAL'}, 'OTRO', null), null);
});

test('uses an isolated alert recipient and approved content SID', async () => {
  let payload;
  const client={messages:{create:async(value)=>(payload=value,{sid:'SMtest',status:'accepted'})}};
  const result=await sendCommercialAlert({event:'VALUATION_REQUESTED',patient:'Nombre Apellido',patientPhone:'whatsapp:+5215554536779',treatment:'Diseño de Sonrisa'}, {env,client});
  assert.equal(result.sid,'SMtest');
  assert.equal(payload.to,'whatsapp:+5256000000000');
  assert.equal(payload.from,'whatsapp:+5210000000000');
  assert.equal(payload.contentSid,'HXtest');
  const variables=JSON.parse(payload.contentVariables);
  assert.equal(variables['1'],'Nombre Apellido | WhatsApp: +525554536779');
});

test('formats the patient name and WhatsApp number for the commercial alert', () => {
  assert.equal(
    patientContactDetails('María López', 'whatsapp:+525512345678'),
    'María López | WhatsApp: +525512345678'
  );
  assert.equal(patientContactDetails('', ''), 'Nombre por confirmar | WhatsApp: número por confirmar');
});

test('fails closed when alert configuration is incomplete', () => {
  assert.throws(()=>alertConfig({}),/not configured/);
});

test('approved inbox template preserves doctor recipient and patient-specific conversation link',async()=>{
  let payload;
  const client={
    sync:{v1:{services:()=>({documents:()=>({fetch:async()=>({data:{sid:'HXinbox'}})})})}},
    content:{v1:{contents:()=>({approvalFetch:()=>({fetch:async()=>({whatsapp:{status:'approved'}})})})}},
    messages:{create:async value=>(payload=value,{sid:'SMtest'})}
  };
  const link='https://recepcionista-dental.onrender.com/bandeja?phone=whatsapp%3A%2B525500000000';
  await sendCommercialAlert({event:'VALUATION_REQUESTED',patient:'Nombre por confirmar',patientPhone:'+525500000000',action:link},{env:{...env,INBOX_ENABLED:'true'},client});
  assert.equal(payload.to,'whatsapp:+5256000000000');assert.equal(payload.contentSid,'HXinbox');assert.equal(JSON.parse(payload.contentVariables)['4'],link);
});

test('pending inbox approval keeps the existing approved alert operational',async()=>{
  let payload;
  const client={sync:{v1:{services:()=>({documents:()=>({fetch:async()=>({data:{sid:'HXpending'}})})})}},content:{v1:{contents:()=>({approvalFetch:()=>({fetch:async()=>({whatsapp:{status:'pending'}})})})}},messages:{create:async value=>(payload=value,{sid:'SMtest'})}};
  await sendCommercialAlert({event:'VALUATION_REQUESTED',patientPhone:'+525500000000',action:'https://recepcionista-dental.onrender.com/bandeja?phone=patient'},{env:{...env,INBOX_ENABLED:'true'},client});
  assert.equal(payload.contentSid,'HXtest');assert.match(JSON.parse(payload.contentVariables)['4'],/bandeja/);
});

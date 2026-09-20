const test = require('node:test');
const assert = require('node:assert/strict');
const { alertConfig, alertEventFor, patientContactDetails, sendCommercialAlert } = require('../commercial-alerts');

const env = { TWILIO_ACCOUNT_SID:'ACtest', TWILIO_AUTH_TOKEN:'secret', TWILIO_WHATSAPP_NUMBER:'+5210000000000', THERA_ALERT_RECIPIENT:'+5256000000000', THERA_ALERT_CONTENT_SID:'HXtest' };

test('maps commercial states without alerting normal conversations', () => {
  assert.equal(alertEventFor({patientState:'NORMAL'}), null);
  assert.equal(alertEventFor({patientState:'VALUATION_REQUESTED'}), 'VALUATION_REQUESTED');
  assert.equal(alertEventFor({patientState:'HANDOFF_PENDING_CONFIRMATION'}), 'INTENCION_DE_AGENDAR');
  assert.equal(alertEventFor({humanHandoffRequired:true}), 'HUMAN_HANDOFF_REQUIRED');
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
  assert.equal(variables['1'],'Nombre Apellido\nWhatsApp: +525554536779\nResponder: https://wa.me/525554536779');
});

test('formats the patient name and WhatsApp number for the commercial alert', () => {
  assert.equal(
    patientContactDetails('María López', 'whatsapp:+525512345678'),
    'María López\nWhatsApp: +525512345678\nResponder: https://wa.me/525512345678'
  );
  assert.equal(patientContactDetails('', ''), 'Nombre por confirmar\nWhatsApp: número por confirmar');
});

test('fails closed when alert configuration is incomplete', () => {
  assert.throws(()=>alertConfig({}),/not configured/);
});

const twilio = require('twilio');

const ALERTABLE_STATES = new Set([
  'LEAD_HOT',
  'INTENCION_DE_AGENDAR',
  'VALUATION_REQUESTED',
  'HANDOFF_PENDING_CONFIRMATION',
  'HUMAN_HANDOFF_REQUIRED'
]);

function alertEventFor(syncResult = {}) {
  if (syncResult.humanHandoffRequired) return 'HUMAN_HANDOFF_REQUIRED';
  if (syncResult.patientState === 'HANDOFF_PENDING_CONFIRMATION') return 'INTENCION_DE_AGENDAR';
  if (syncResult.patientState === 'VALUATION_REQUESTED') return 'VALUATION_REQUESTED';
  return null;
}

function resolveCommercialAlertEvent(syncResult = {}, auraIntent, pendingEvent) {
  return alertEventFor(syncResult)
    || (auraIntent === 'INTENCION_DE_AGENDAR' ? 'INTENCION_DE_AGENDAR' : null)
    || pendingEvent
    || null;
}

function alertConfig(env = process.env) {
  const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER', 'THERA_ALERT_RECIPIENT', 'THERA_ALERT_CONTENT_SID'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Commercial alerts are not configured: ${missing.join(', ')}`);
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') ? env.TWILIO_WHATSAPP_NUMBER : `whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`,
    to: env.THERA_ALERT_RECIPIENT.startsWith('whatsapp:') ? env.THERA_ALERT_RECIPIENT : `whatsapp:${env.THERA_ALERT_RECIPIENT}`,
    contentSid: env.THERA_ALERT_CONTENT_SID
  };
}

function patientContactDetails(patient, patientPhone) {
  const name = String(patient || '').trim() || 'Nombre por confirmar';
  let digits = String(patientPhone || '').replace(/\D/g, '');

  // Twilio can still send Mexican mobile numbers in the legacy +521 format.
  // wa.me requires the current +52 format without the extra mobile prefix.
  if (/^521\d{10}$/.test(digits)) digits = `52${digits.slice(3)}`;

  if (!digits) return `${name} | WhatsApp: número por confirmar`;
  const internationalPhone = `+${digits}`;
  return `${name} | WhatsApp: ${internationalPhone}`;
}

async function sendCommercialAlert(input, options = {}) {
  if (!ALERTABLE_STATES.has(input.event)) throw new Error('Unsupported commercial alert event');
  const config = alertConfig(options.env);
  const client = options.client || twilio(config.accountSid, config.authToken);
  return client.messages.create({
    from: config.from,
    to: config.to,
    contentSid: config.contentSid,
    contentVariables: JSON.stringify({
      1: patientContactDetails(input.patient, input.patientPhone),
      2: input.treatment || 'Por confirmar',
      3: input.event,
      4: input.action || 'Abrir XimGrowthOS para continuar'
    })
  });
}

module.exports = {
  ALERTABLE_STATES,
  alertConfig,
  alertEventFor,
  resolveCommercialAlertEvent,
  patientContactDetails,
  sendCommercialAlert
};

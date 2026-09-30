require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const fs = require('fs');
const { installInbox } = require('./inbox');
const { appendMessage } = require('./conversation-history');
const { extractInboundAttribution, shouldSyncInboundLead, syncInboundLead } = require('./ximgrowthos-sync');
const { isCommercialOutboundEligible, patientStateInstruction } = require('./outbound-eligibility');
const { resolveCommercialAlertEvent, sendCommercialAlert, inboundInterestEvent, inboundTreatment } = require('./commercial-alerts');
const { classifyAuraIntent, extractPatientFullName, hotLeadResponse, resolvePatientDisplayName, isInformationRequest, keepOfficialChat, isFullName, cleanNameHistory } = require('./aura-cro-policy');
const { sendOpenAiLeadConversion } = require('./openai-ads-conversion');

const app = express();
const historialConversaciones = {};
const alertedMessageSids = new Set();
const patientFullNames = new Map();
const awaitingFullName = new Set();
const pendingCommercialAlerts = new Map();
const activeTestConversations = new Map();
const TEST_CONVERSATION_TTL_MS = 15 * 60 * 1000;

const knowledge = JSON.parse(fs.readFileSync('./knowledge.json', 'utf8'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const { suppliedAppointmentResponse } = require('./aura-cro-policy');
const inbox = installInbox(app);
async function replyAura(req, res, text) {
  if (inbox.enabled && !req.auraDiagnostic) return inbox.respond(req, res, keepOfficialChat(text));
  const response = new twilio.twiml.MessagingResponse();
  response.message(keepOfficialChat(text));
  return res.type('text/xml').send(response.toString());
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function handleWhatsApp(req, res) {
  if (inbox.enabled && !req.auraDiagnostic) {
    if (!inbox.validate(req)) return res.sendStatus(403);
    try {
      const conversation = await inbox.store.inbound(req.body);
      inbox.notifyInbound(req.body).catch(error=>console.error('Error de aviso al celular:',error.code||error.status||'error'));
      if (conversation.nameVerified && isFullName(conversation.name)) patientFullNames.set(req.body.From, conversation.name);
      if (conversation.mode === 'human') {
        try { await inbox.alertInbound(req.body,{event:'HUMAN_HANDOFF_REQUIRED',patient:conversation.name}); }
        catch(error){console.error('Error de alerta durante atención humana:',error.code||error.status||'error');}
        return res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
      }
    } catch (error) {
      console.error('Inbox inbound unavailable:', error.code || error.status);
      return res.sendStatus(503);
    }
  }
  try {
    const mensaje = req.body.Body;
    const numero = req.body.From;
    const patientDisplayName = resolvePatientDisplayName(req.body.ProfileName);
    const auraIntent = classifyAuraIntent(mensaje);
    const wasAwaitingFullName = awaitingFullName.has(numero);
    // A reply containing only a full name must remain recognizable after a
    // Render restart, even when the in-memory "awaiting" flag was lost.
    const suppliedFullName = extractPatientFullName(mensaje, true);
    if (suppliedFullName) {
      patientFullNames.set(numero, suppliedFullName);
      if (inbox.enabled && !req.auraDiagnostic) await inbox.store.mutate(numero, data => ({ ...data, name: suppliedFullName, nameVerified: true }));
      awaitingFullName.delete(numero);
    }
    const verifiedFullName = suppliedFullName || patientFullNames.get(numero);

if (inbox.enabled && !req.auraDiagnostic) {
  historialConversaciones[numero] = await inbox.context(numero, req.body.MessageSid);
}
if (!historialConversaciones[numero]) {
  historialConversaciones[numero] = [];
}

historialConversaciones[numero] = appendMessage(
  historialConversaciones[numero],
  'user',
  mensaje
);

// El alta en XimGrowthOS no interrumpe la atención de Aura si el CRM no responde.
let crmState = { patientState: 'UNKNOWN', commercialSuppression: true, humanHandoffRequired: false };
try {
  if (req.auraDiagnostic) {
    crmState = { patientState: 'VALUATION_REQUESTED', commercialSuppression: false, humanHandoffRequired: false };
  } else {
  const attribution = extractInboundAttribution(mensaje);
  const activeTestUntil = activeTestConversations.get(numero) || 0;
  const activeTestConversation = activeTestUntil > Date.now();
  if (activeTestUntil && !activeTestConversation) activeTestConversations.delete(numero);

  if (shouldSyncInboundLead({
    activeTestConversation,
    intakeToken: attribution.intakeToken,
    intakeReference: attribution.intakeReference
  })) {
    crmState = await syncInboundLead({
      eventId: req.body.MessageSid,
      conversationId: numero,
      phone: numero,
      displayName: suppliedFullName || patientFullNames.get(numero) || patientDisplayName,
      text: attribution.text,
      intakeToken: attribution.intakeToken,
      intakeReference: attribution.intakeReference,
      receivedAt: new Date().toISOString()
    });
    if (crmState.isTest) {
      activeTestConversations.set(numero, Date.now() + TEST_CONVERSATION_TTL_MS);
    }
    if (crmState.openAiAdsConversion) {
      try {
        await sendOpenAiLeadConversion({
          eventId: req.body.MessageSid,
          occurredAt: new Date(),
          oppref: crmState.openAiAdsConversion.oppref,
          sourceUrl: crmState.openAiAdsConversion.sourceUrl
        });
        console.log('Conversión de OpenAI Ads aceptada:', req.body.MessageSid);
      } catch (conversionError) {
        console.error('Error enviando conversión a OpenAI Ads:', conversionError.message);
      }
    }
  } else {
    crmState = {
      patientState: 'HANDOFF_PENDING_CONFIRMATION',
      commercialSuppression: true,
      humanHandoffRequired: false,
      isTest: true
    };
  }
  }
} catch (syncError) {
  console.error('Error sincronizando con XimGrowthOS:', syncError.message);
}

// Aura's own intent classification is an independent commercial signal. Keep
// the alert pending even if Xim is temporarily unavailable or returns a state
// that has not yet advanced, then deliver it as soon as the name is available.
const informationRequest = isInformationRequest(mensaje);
if (informationRequest) pendingCommercialAlerts.delete(numero);
const detectedAlertEvent = inboundInterestEvent(mensaje) || (informationRequest ? null : resolveCommercialAlertEvent(
  crmState,
  auraIntent,
  pendingCommercialAlerts.get(numero)
));
if (detectedAlertEvent) pendingCommercialAlerts.set(numero, detectedAlertEvent);
const alertEvent = pendingCommercialAlerts.get(numero);

// XimGrowthOS can legitimately report a duplicate while recovering a
// previously persisted webhook. The commercial handoff must still be
// delivered unless this running Aura process already sent it for the same
// Twilio MessageSid. Await Twilio so acceptance/failure is observable.
if (!req.auraDiagnostic && alertEvent && !alertedMessageSids.has(req.body.MessageSid)) {
  try {
    const alertInput = {
      event: alertEvent,
      patient: verifiedFullName || patientDisplayName,
      patientPhone: numero,
      treatment: inboundTreatment(mensaje),
      action: inbox.enabled ? `Ver conversación: ${process.env.INBOX_PUBLIC_URL}/bandeja?phone=${encodeURIComponent(numero)}` : 'Abrir XimGrowthOS para continuar'
    };
    const alertMessage = inbox.enabled ? await inbox.alertInbound(req.body,alertInput) : await sendCommercialAlert(alertInput);
    alertedMessageSids.add(req.body.MessageSid);
    pendingCommercialAlerts.delete(numero);
    console.log('Alerta comercial aceptada por Twilio:', alertMessage.sid, alertMessage.status || 'accepted');
  } catch (alertError) {
    console.error('Error enviando alerta comercial:', alertError.message);
  }
}

// El historial se limita por turnos para conservar contexto sin elevar el consumo.
    console.log('Mensaje recibido:', mensaje);
    console.log('De:', numero);

    const receivedAppointment = suppliedAppointmentResponse(mensaje, verifiedFullName);
    if (receivedAppointment) {
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', receivedAppointment);
      return await replyAura(req, res, receivedAppointment);
    }

    if (auraIntent === 'INTENCION_DE_AGENDAR' && !patientFullNames.has(numero)) {
      awaitingFullName.add(numero);
      const texto = 'Con gusto te ayudamos a continuar con tu valoración. Para registrar correctamente tu solicitud, ¿me compartes tu nombre completo, por favor?';
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', texto);
      return await replyAura(req, res, texto);
    }

    if (suppliedFullName && !informationRequest && (wasAwaitingFullName || ['VALUATION_REQUESTED','INTENCION_DE_AGENDAR'].includes(detectedAlertEvent))) {
      const texto = `Gracias, ${suppliedFullName}. Registré tu nombre y tu solicitud. Coordinaremos tu valoración aquí mismo. ¿Qué día y horario prefieres? Nuestro equipo te confirmará la disponibilidad por este chat.`;
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', texto);
      return await replyAura(req, res, texto);
    }

    if (auraIntent === 'INTENCION_DE_AGENDAR' && crmState.patientState !== 'APPOINTMENT_SCHEDULED' && !crmState.humanHandoffRequired) {
      const texto = hotLeadResponse(mensaje);
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', texto);
      return await replyAura(req, res, texto);
    }

    const respuestaClaude = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 888,
    system: `Eres Aura, parte del equipo de atención de Thera Dental Clinic.

Nombre completo confirmado del paciente: ${verifiedFullName || 'No confirmado; no interpretes saludos ni consultas como nombres y no reutilices nombres erróneos de mensajes anteriores.'}

${patientStateInstruction(crmState)}

Tu trabajo es atender pacientes por WhatsApp de forma cálida, profesional y natural, como lo haría una asistente dental con experiencia dentro de la clínica.

No hables como robot, no suenes genérica y no uses frases demasiado artificiales como “estoy aquí para ayudarte” en exceso. Responde como una persona real: clara, amable, segura y profesional.

Cuida estrictamente la ortografía, acentos, puntuación y redacción. No uses abreviaturas raras, errores de escritura ni frases incompletas.

Responde en español, con mensajes breves, completos y fáciles de leer por WhatsApp.

En respuestas normales, no excedas 700 caracteres.

EXCEPCIÓN ABSOLUTA:
Cuando sea la primera vez que expliques el Paquete Básico Inicial, puedes exceder los 700 caracteres. En ese caso, la prioridad máxima es incluir el mensaje obligatorio completo, con todos los puntos de la lista y el precio de $1,500 MXN.

Nunca recortes, resumas ni acortes el Paquete Básico Inicial cuando sea la primera explicación.

Solo resume información larga cuando NO se trate de la primera explicación del Paquete Básico Inicial.

Tu objetivo principal es orientar al paciente, resolver sus dudas y llevarlo de manera natural hacia una cita de valoración en Thera Dental Clinic.

Nunca inventes diagnósticos, precios, resultados, tiempos de tratamiento ni información médica. Nunca prometas resultados estéticos o clínicos. Si no cuentas con información suficiente, invita al paciente a realizar una valoración profesional.

ORDEN DE PRIORIDAD OBLIGATORIO:

1. INTENCION_DE_AGENDAR explícita: avanzar inmediatamente con una respuesta breve y solicitar únicamente día u horario. Esta ruta se resuelve antes de invocar el modelo.
2. Pregunta explícita sobre contenido o precio de la valoración/Paquete Básico Inicial: explicar el paquete completo.
3. Interés exploratorio en un tratamiento: orientar sin diagnosticar y explicar el primer paso cuando aporte valor.
4. Información general.

REGLA DEL PAQUETE BÁSICO INICIAL:

En Thera Dental Clinic, la cita de valoración se llama “Paquete Básico Inicial”.

Cuando el paciente pregunte explícitamente qué incluye la valoración o el Paquete Básico Inicial, pregunte su precio/costo, o necesite esa explicación porque todavía está evaluando, y no se le haya explicado durante la conversación actual, usa el MENSAJE OBLIGATORIO completo.

No agregues ninguna explicación antes del MENSAJE OBLIGATORIO.
No respondas primero sobre el tratamiento.
No resumas el MENSAJE OBLIGATORIO.
No omitas el precio.
No omitas ningún punto de la lista.
No cambies el orden de la lista.
No cambies las palabras de la lista.
No sustituyas esta explicación por una versión corta.
Cuando aplique esta regla del paquete, no respondas solamente sobre el tratamiento sin incluir antes el MENSAJE OBLIGATORIO completo.

La explicación del paquete no debe bloquear ni retrasar una intención explícita de agendar. No repitas lista, precio ni explicación clínica extensa si el paciente ya pidió cita, valoración, reserva, disponibilidad u horario y no preguntó por esos detalles.

MENSAJE OBLIGATORIO:

Para poder recomendarte el tratamiento adecuado, primero es necesario realizar el Paquete Básico Inicial. Este nos permite valorar tu caso de forma profesional, obtener un diagnóstico odontológico y diseñar un plan de tratamiento personalizado.

El Paquete Básico Inicial incluye:

* Valoración profesional.
* Limpieza dental (profilaxis).
* Aplicación de flúor.
* Fotografías intraorales y extraorales para el análisis del caso.
* Escáner digital 3D de la boca.
* Radiografía intraoral digital.
* Integración de historia clínica.
* Diagnóstico odontológico profesional.
* Plan de tratamiento personalizado de acuerdo con las necesidades del paciente.

El Paquete Básico Inicial tiene un valor de $1,500 MXN.

Después de enviar el MENSAJE OBLIGATORIO completo, agrega máximo una frase breve relacionada con el tratamiento que preguntó el paciente.

Si el paciente ya recibió esta explicación completa durante la conversación actual, no vuelvas a repetir toda la lista a menos que pregunte qué incluye, pida el precio, muestre confusión o solicite que se lo repitas.

Si ya se explicó antes, usa una referencia breve como:
“Como te comentaba, primero realizamos el Paquete Básico Inicial para valorar tu caso correctamente.”

Cuando el paciente muestre interés, no le pidas que “te cuente más sobre él” ni uses frases abiertas que alarguen innecesariamente la conversación.

Mantén siempre un tono profesional, cálido y confiable. Debes sonar como alguien real del equipo de Thera Dental Clinic: amable, segura, paciente y enfocada en ayudar.

Evita sonar insistente. No presiones al paciente. Guíalo con seguridad hacia la valoración, explicando que es el primer paso correcto para recibir un diagnóstico y un plan personalizado.

REGLA PRIORITARIA PARA AGENDAR CITAS:

La cita se coordina por este mismo WhatsApp oficial. No redirijas al paciente al WhatsApp personal del Dr. Jaime ni a otro número. No incluyas enlaces para abandonar esta conversación, aunque aparezcan en mensajes anteriores.

Captura la solicitud, nombre completo, tratamiento de interés y preferencia de día y horario. Si el paciente ya compartió un dato, no lo vuelvas a preguntar. El equipo atiende la solicitud en esta misma conversación y confirma la cita después de verificar disponibilidad.

No inventes disponibilidad ni confirmes una cita por tu cuenta. No menciones Dentalink ni detalles de la plataforma. Cuando el paciente solicite una cita, explica brevemente que la coordinaremos aquí mismo y que el equipo confirmará el horario por este chat.

INFORMACIÓN OFICIAL DE THERA DENTAL CLINIC:
Utiliza la siguiente información como fuente principal para responder dudas sobre tratamientos, precios publicados, ubicación, servicios, preguntas frecuentes y contacto.

${JSON.stringify(knowledge, null, 2)}

Regla importante:
Si la información no aparece en esta base de conocimiento, no la inventes. En ese caso, invita al paciente a agendar su Paquete Básico Inicial o indica que el equipo de Thera puede confirmarlo directamente.

Responde siempre en español de forma natural y conversacional, como una persona real atendiendo WhatsApp.`,
      messages: historialConversaciones[numero]
    });

    const texto = keepOfficialChat(respuestaClaude.content[0].text);

    historialConversaciones[numero] = appendMessage(
      historialConversaciones[numero],
      'assistant',
      texto
    );

    return await replyAura(req, res, texto);

  } catch (error) {
    console.error('Error con Claude:', error.message);

    try { return await replyAura(req, res, 'Hola, soy Aura de Thera Dental Clinic. En un momento te apoyamos 🦷'); }
    catch (replyError) { return res.sendStatus(503); }
  }
}
app.post('/whatsapp', handleWhatsApp);
if (inbox.enabled) app.post('/api/inbox/check-response', async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message || message.length > 1000) return res.status(400).json({error:'Mensaje de prueba inválido.'});
  const id = 'diagnostic:' + require('node:crypto').randomUUID();
  const testReq = {auraDiagnostic:true, body:{Body:message, From:id, MessageSid:id, ProfileName:''}};
  historialConversaciones[id] = cleanNameHistory([
    {role:'user',content:'JR Hola quiero mas informacion'},
    {role:'assistant',content:'Gracias, JR Hola quiero mas informacion. Registré tu nombre y tu solicitud.'}
  ]);
  let status=200;
  let xml='';
  const testRes = {type(){return this;},status(value){status=value;return this;},send(value){xml=String(value);return this;},sendStatus(value){status=value;return this;}};
  try {
    await handleWhatsApp(testReq,testRes);
    return res.status(status).json({diagnostic:true,name:extractPatientFullName(message,true),intent:classifyAuraIntent(message),responseXml:xml,patientMessagesSent:0});
  } catch(error) {return res.status(503).json({error:'No se pudo completar la prueba de Aura.'});}
  finally {delete historialConversaciones[id];patientFullNames.delete(id);awaitingFullName.delete(id);pendingCommercialAlerts.delete(id);activeTestConversations.delete(id);alertedMessageSids.delete(id);}
});

app.get('/', (req, res) => {
  res.send('Recepcionista Dental IA funcionando');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    inboxEnabled: inbox.enabled,
    inboxVersion: '1.0.0',
    nameDetectionVersion: '2.1.0',
    schedulingChannel: 'official-whatsapp',
    alertsVersion: 'interest-and-web-push-v1',
    attributionParser: 'thera-reference-v1',
    ximgrowthosConfigured: Boolean(
      process.env.XIMGROWTHOS_INBOUND_URL && process.env.AURA_WEBHOOK_SECRET
    ),
    openAiAdsConversionsConfigured: Boolean(
      (process.env.OPENAI_ADS_CONVERSIONS_API_KEY || process.env.OPENAI_ADS_CONVERSION_API_KEY) &&
      process.env.OPENAI_ADS_PIXEL_ID
    )
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor corriendo en puerto 3000');
});

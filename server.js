require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const fs = require('fs');
const { appendMessage } = require('./conversation-history');
const { addTreatmentToTransferLink } = require('./transfer-link');
const { extractInboundAttribution, syncInboundLead } = require('./ximgrowthos-sync');
const { isCommercialOutboundEligible, patientStateInstruction } = require('./outbound-eligibility');
const { alertEventFor, sendCommercialAlert } = require('./commercial-alerts');
const { classifyAuraIntent, extractPatientFullName, hotLeadResponse, resolvePatientDisplayName } = require('./aura-cro-policy');

const app = express();
const historialConversaciones = {};
const alertedMessageSids = new Set();
const patientFullNames = new Map();
const awaitingFullName = new Set();
const pendingCommercialAlerts = new Map();

const knowledge = JSON.parse(fs.readFileSync('./knowledge.json', 'utf8'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.post('/whatsapp', async (req, res) => {
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
      awaitingFullName.delete(numero);
    }
    const verifiedFullName = suppliedFullName || patientFullNames.get(numero);

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
let detectedAlertEvent = null;
try {
  const attribution = extractInboundAttribution(mensaje);
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
  detectedAlertEvent = alertEventFor(crmState);
  if (detectedAlertEvent) pendingCommercialAlerts.set(numero, detectedAlertEvent);
  const alertEvent = detectedAlertEvent || pendingCommercialAlerts.get(numero);
  // XimGrowthOS can legitimately report a duplicate while recovering a
  // previously persisted webhook. The commercial handoff must still be
  // delivered unless this running Aura process already sent it for the same
  // Twilio MessageSid. Await Twilio so acceptance/failure is observable.
  if (alertEvent && verifiedFullName && !alertedMessageSids.has(req.body.MessageSid)) {
    try {
      const alertMessage = await sendCommercialAlert({
        event: alertEvent,
        patient: verifiedFullName,
        patientPhone: numero,
        treatment: 'Por confirmar',
        action: 'Abrir XimGrowthOS para continuar'
      });
      alertedMessageSids.add(req.body.MessageSid);
      pendingCommercialAlerts.delete(numero);
      console.log('Alerta comercial aceptada por Twilio:', alertMessage.sid, alertMessage.status || 'accepted');
    } catch (alertError) {
      console.error('Error enviando alerta comercial:', alertError.message);
    }
  }
} catch (syncError) {
  console.error('Error sincronizando con XimGrowthOS:', syncError.message);
}

// El historial se limita por turnos para conservar contexto sin elevar el consumo.
    console.log('Mensaje recibido:', mensaje);
    console.log('De:', numero);

    if (auraIntent === 'INTENCION_DE_AGENDAR' && !patientFullNames.has(numero)) {
      awaitingFullName.add(numero);
      const texto = 'Con gusto te ayudamos a continuar con tu valoración. Para registrar correctamente tu solicitud, ¿me compartes tu nombre completo, por favor?';
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', texto);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(texto);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    if (suppliedFullName && (wasAwaitingFullName || detectedAlertEvent) && pendingCommercialAlerts.has(numero) === false) {
      const texto = `Gracias, ${suppliedFullName}. Registré tu nombre y tu solicitud. Para confirmar disponibilidad y horario con el Dr. Jaime Reyes, escríbele aquí: https://wa.me/525664676808?text=Hola%2C%20me%20gustar%C3%ADa%20agendar%20una%20cita%20en%20Thera%20Dental%20Clinic.`;
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', texto);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(texto);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    if (auraIntent === 'INTENCION_DE_AGENDAR' && crmState.patientState !== 'APPOINTMENT_SCHEDULED' && !crmState.humanHandoffRequired) {
      const texto = hotLeadResponse(mensaje);
      historialConversaciones[numero] = appendMessage(historialConversaciones[numero], 'assistant', texto);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(texto);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    const respuestaClaude = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 888,
    system: `Eres Aura, parte del equipo de atención de Thera Dental Clinic.

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

Mientras no exista integración activa con Dentalink, Aura no debe capturar ni confirmar citas directamente.

Cuando el paciente muestre intención clara de agendar una cita, consultar disponibilidad, apartar horario, reservar, confirmar una valoración, preguntar “¿cuándo puedo ir?”, “¿tienen espacio?”, “quiero cita”, “quiero valoración” o cualquier frase similar, debes compartir obligatoriamente el enlace del WhatsApp del Dr. Jaime en esa misma respuesta.

No esperes a que el paciente proporcione datos para mandar el enlace.

No inventes disponibilidad.
No confirmes horarios.
No confirmes citas.
No menciones Dentalink ni digas que falta una integración.

La confirmación de disponibilidad y horario se realiza directamente por WhatsApp con el Dr. Jaime.

El enlace obligatorio para agendar es:
https://wa.me/525664676808?text=Hola%2C%20me%20gustar%C3%ADa%20agendar%20una%20cita%20en%20Thera%20Dental%20Clinic.

Cuando compartas el enlace, puedes decir de forma natural que para agilizar el proceso puede escribirle al Dr. Jaime mencionando su nombre, el tratamiento que le interesa y el día u horario que le gustaría.

Ejemplo correcto:
“Perfecto, con gusto podemos ayudarte a coordinar tu cita. Para confirmar disponibilidad y horario, lo más práctico es escribir directamente al WhatsApp del Dr. Jaime Reyes: https://wa.me/525664676808?text=Hola%2C%20me%20gustar%C3%ADa%20agendar%20una%20cita%20en%20Thera%20Dental%20Clinic.

Para que puedan apoyarte más rápido, puedes mencionarle tu nombre, el tratamiento que te interesa y el día u horario que te gustaría.”

No mandes al paciente al Dr. Jaime desde el primer mensaje si solo está pidiendo información general. Pero en cuanto muestre intención clara de agendar, avanzar, consultar disponibilidad o apartar una cita, comparte el enlace obligatoriamente.

INFORMACIÓN OFICIAL DE THERA DENTAL CLINIC:
Utiliza la siguiente información como fuente principal para responder dudas sobre tratamientos, precios publicados, ubicación, servicios, preguntas frecuentes y contacto.

${JSON.stringify(knowledge, null, 2)}

Regla importante:
Si la información no aparece en esta base de conocimiento, no la inventes. En ese caso, invita al paciente a agendar su Paquete Básico Inicial o indica que el equipo de Thera puede confirmarlo directamente.

Responde siempre en español de forma natural y conversacional, como una persona real atendiendo WhatsApp.`,
      messages: historialConversaciones[numero]
    });

    const texto = isCommercialOutboundEligible(crmState)
      ? addTreatmentToTransferLink(respuestaClaude.content[0].text, historialConversaciones[numero])
      : respuestaClaude.content[0].text;

    historialConversaciones[numero] = appendMessage(
      historialConversaciones[numero],
      'assistant',
      texto
    );

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(texto);

    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('Error con Claude:', error.message);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Hola, soy Aura de Thera Dental Clinic. En un momento te apoyamos 🦷');

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.get('/', (req, res) => {
  res.send('Recepcionista Dental IA funcionando');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    attributionParser: 'thera-reference-v1',
    ximgrowthosConfigured: Boolean(
      process.env.XIMGROWTHOS_INBOUND_URL && process.env.AURA_WEBHOOK_SECRET
    )
  });
});

app.listen(3000, () => {
  console.log('Servidor corriendo en puerto 3000');
});

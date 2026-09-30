const HOT_LEAD_PATTERNS = [
  /\bquiero\s+(?:agendar|reservar|apartar)\b/,
  /\bquiero\s+(?:una\s+)?(?:cita|valoracion|consulta)\b/,
  /\b(?:que|cuales)\s+horarios?\s+tienen\b/,
  /\b(?:puedo|podria)\s+ir\s+(?:hoy|manana|el\s+\w+)\b/,
  /\b(?:agendar|reservar|apartar)\s+(?:una\s+)?(?:cita|valoracion|consulta)\b/,
];

const PACKAGE_INFORMATION_PATTERNS = [
  /\bque\s+incluye\b.*\b(?:valoracion|paquete)\b/,
  /\b(?:valoracion|paquete)\b.*\bque\s+incluye\b/,
  /\b(?:cuanto\s+cuesta|precio|costo|1[,.]?500)\b.*\b(?:valoracion|paquete)\b/,
  /\b(?:valoracion|paquete)\b.*\b(?:cuanto\s+cuesta|precio|costo|1[,.]?500)\b/,
];

const INVALID_PATIENT_NAMES = [
  /^dr\.?\s+jaime(?:\s+reyes)?$/,
  /^jaime\s+reyes$/,
  /^thera(?:\s+dental\s+clinic)?$/,
  /\b(?:admin|administrador|recepcion|aura|prueba|test|interno)\b/,
];

const PATIENT_NAME_FALLBACK = 'Contacto de WhatsApp — nombre por confirmar';

function isFullName(value) {
  const text = String(value || '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || text.length > 120) return false;
  if (containsConversationWords(text)) return false;
  return words.every((word) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]{2,}$/.test(word));
}

function containsConversationWords(text) {
  return /\b(?:hola|buenos|buenas|gracias|gusto|quiero|quisiera|deseo|necesito|gustaria|informacion|informes|precio|costo|cuanto|agendar|cita|valoracion|consulta|interesa|interesan|carilla|carillas|implante|implantes|dental|dentales|blanqueamiento|ortodoncia|limpieza|sonrisa|tratamiento|ayuda|soy|llamo|nombre|tengo|puedo|podria|como|favor|manana|horario|tarde|tardes|dias|noches)\b/.test(normalize(text));
}

function cleanNameHistory(history) {
  return history.filter(message=>{
    if(message.role!=='assistant')return true;
    const name=String(message.content||'').match(/^Gracias,\s*(.*?)\.\s*Registr[eé] tu nombre/iu)?.[1];
    return !name || isFullName(name);
  });
}

function isInformationRequest(message) {
  return classifyAuraIntent(message) !== 'INTENCION_DE_AGENDAR'
    && /\b(?:informacion|informes|precio|precios|costo|costos|opciones|incluye|consiste)\b/.test(normalize(message));
}

function extractPatientFullName(message, acceptPlainName = false) {
  const text = String(message || '').trim();
  const introduced = text.match(/\b(?:soy|me llamo|mi nombre es)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+){1,5})/i)?.[1]
    ?.replace(/\s+(?:y|quiero|deseo|para)\s.*$/i, '')
    .trim();
  if (isFullName(introduced)) return introduced;
  if (acceptPlainName && isFullName(text)) return text;
  return null;
}

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s.,:?¿!¡$]/g, ' ').replace(/\s+/g, ' ').trim();
}

function classifyAuraIntent(message) {
  const text = normalize(message);
  if (HOT_LEAD_PATTERNS.some((pattern) => pattern.test(text))) return 'INTENCION_DE_AGENDAR';
  if (PACKAGE_INFORMATION_PATTERNS.some((pattern) => pattern.test(text))) return 'EXPLICACION_PAQUETE_BASICO';
  return 'INFORMACION_GENERAL';
}

function hotLeadResponse(message) {
  const text = normalize(message);
  const day = text.match(/\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)?.[1];
  const time = text.match(/\b(?:a\s+las?\s+)?(\d{1,2}(?::\d{2})?)\s*(a\s*\.?\s*m\s*\.?|p\s*\.?\s*m\s*\.?)?/);
  const confirmation = 'Coordinaremos tu cita aquí mismo. Nuestro equipo confirmará la disponibilidad por este chat.';

  if (day && time) {
    const requestedDay = day === 'manana' ? 'mañana' : day === 'miercoles' ? 'miércoles' : day === 'sabado' ? 'sábado' : day;
    const period = time[2] ? (/^p/.test(time[2]) ? 'p. m.' : 'a. m.') : '';
    const requestedTime = `${time[1]}${period ? ` ${period}` : ''}`;
    return `Gracias. Registré tu preferencia para el ${requestedDay} a las ${requestedTime}. ${confirmation}`;
  }
  if (day) {
    const requestedDay = day === 'manana' ? 'mañana' : day === 'miercoles' ? 'miércoles' : day === 'sabado' ? 'sábado' : day;
    const dayPhrase = requestedDay === 'mañana' ? 'mañana' : `el ${requestedDay}`;
    return `Gracias. ¿Qué horario prefieres ${dayPhrase}? ${confirmation}`;
  }
  return `¡Claro! ¿Qué día y horario prefieres para tu valoración de Diseño de Sonrisa? ${confirmation}`;
}

function keepOfficialChat(response) {
  const text = String(response || '');
  if (/wa\.me\/52(?:1)?5664676808|(?:\+?52\s*)?(?:56[\s.-]*6467[\s.-]*6808)/i.test(text)) {
    return 'Podemos coordinar tu valoración aquí mismo. Compártenos tu nombre completo y el día y horario que prefieres; nuestro equipo te confirmará la disponibilidad por este chat.';
  }
  return text;
}

function resolvePatientDisplayName(displayName) {
  const candidate = String(displayName ?? '').trim();
  if (!candidate) return PATIENT_NAME_FALLBACK;
  const normalized = normalize(candidate);
  return INVALID_PATIENT_NAMES.some((pattern) => pattern.test(normalized)) ? PATIENT_NAME_FALLBACK : candidate;
}

module.exports = {
  PATIENT_NAME_FALLBACK,
  classifyAuraIntent,
  extractPatientFullName,
  hotLeadResponse,
  isFullName,
  isInformationRequest,
  keepOfficialChat,
  containsConversationWords,
  cleanNameHistory,
  resolvePatientDisplayName
};

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

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s.,?¿!¡$]/g, ' ').replace(/\s+/g, ' ').trim();
}

function classifyAuraIntent(message) {
  const text = normalize(message);
  if (HOT_LEAD_PATTERNS.some((pattern) => pattern.test(text))) return 'INTENCION_DE_AGENDAR';
  if (PACKAGE_INFORMATION_PATTERNS.some((pattern) => pattern.test(text))) return 'EXPLICACION_PAQUETE_BASICO';
  return 'INFORMACION_GENERAL';
}

function hotLeadResponse(message) {
  if (/\bmanana\b/.test(normalize(message))) {
    return '¡Claro! Con gusto coordinamos tu valoración de Diseño de Sonrisa en THERA. ¿Qué horario te acomoda mañana?';
  }
  return '¡Claro! Con gusto coordinamos tu valoración de Diseño de Sonrisa en THERA. ¿Qué día te gustaría acudir?';
}

function resolvePatientDisplayName(displayName) {
  const candidate = String(displayName ?? '').trim();
  if (!candidate) return PATIENT_NAME_FALLBACK;
  const normalized = normalize(candidate);
  return INVALID_PATIENT_NAMES.some((pattern) => pattern.test(normalized)) ? PATIENT_NAME_FALLBACK : candidate;
}

module.exports = { PATIENT_NAME_FALLBACK, classifyAuraIntent, hotLeadResponse, resolvePatientDisplayName };

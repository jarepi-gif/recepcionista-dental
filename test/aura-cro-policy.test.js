const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PATIENT_NAME_FALLBACK, classifyAuraIntent, extractPatientFullName, hotLeadResponse, resolvePatientDisplayName, isInformationRequest, keepOfficialChat } = require('../aura-cro-policy');

test('A: intención explícita recibe avance breve', () => {
  const message = 'Quiero agendar una valoración.';
  assert.equal(classifyAuraIntent(message), 'INTENCION_DE_AGENDAR');
  const response = hotLeadResponse(message);
  assert.match(response, /Qué día y horario prefieres/);
  assert.doesNotMatch(response, /wa\.me|5664676808/);
  assert.match(response, /aquí mismo/);
  assert.doesNotMatch(response, /\$1,500|incluye|escáner|radiografía/i);
});

test('B: contenido y precio conservan la regla completa del paquete', () => {
  assert.equal(classifyAuraIntent('¿Qué incluye la valoración de $1,500?'), 'EXPLICACION_PAQUETE_BASICO');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const required of ['Valoración profesional.', 'Escáner digital 3D de la boca.', 'Plan de tratamiento personalizado', '$1,500 MXN.']) {
    assert.match(server, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('C: pregunta exploratoria sigue la ruta informativa', () => {
  assert.equal(classifyAuraIntent('Me interesan las carillas, ¿qué opciones tienen?'), 'INFORMACION_GENERAL');
});

test('D: agenda mañana tiene prioridad y pide sólo horario', () => {
  const message = 'Quiero agendar mañana.';
  assert.equal(classifyAuraIntent(message), 'INTENCION_DE_AGENDAR');
  assert.match(hotLeadResponse(message), /Qué horario prefieres mañana/);
  assert.doesNotMatch(hotLeadResponse(message), /wa\.me|5664676808/);
  assert.match(hotLeadResponse(message), /aquí mismo/);
});

test('E: día y hora se reconocen sin repetir una pregunta contestada', () => {
  const message = 'Quiero agendar mi valoración el jueves a las 4:00 p. m.';
  assert.equal(classifyAuraIntent(message), 'INTENCION_DE_AGENDAR');
  const response = hotLeadResponse(message);
  assert.match(response, /Registré tu preferencia para el jueves a las 4:00 p\. m\./);
  assert.doesNotMatch(response, /Qué día te gustaría/);
  assert.doesNotMatch(response, /wa\.me|5664676808/);
  assert.match(response, /aquí mismo/);
});

test('F: displayName interno usa fallback seguro', () => {
  assert.equal(resolvePatientDisplayName('Dr. Jaime Reyes'), PATIENT_NAME_FALLBACK);
  assert.equal(resolvePatientDisplayName('THERA Dental Clinic'), PATIENT_NAME_FALLBACK);
  assert.equal(resolvePatientDisplayName('Cuenta de prueba'), PATIENT_NAME_FALLBACK);
  assert.equal(resolvePatientDisplayName('María López'), 'María López');
});

test('G: obtiene el nombre completo declarado por el paciente', () => {
  assert.equal(extractPatientFullName('Soy Jaime Augusto Reyes Pinzón y quiero agendar'), 'Jaime Augusto Reyes Pinzón');
  assert.equal(extractPatientFullName('Mi nombre es María López'), 'María López');
  assert.equal(extractPatientFullName('María López', true), 'María López');
  assert.equal(extractPatientFullName('Jaime Augusto Reyes Pinzón', true), 'Jaime Augusto Reyes Pinzón');
  assert.equal(extractPatientFullName('Jaime', true), null);
});

test('H: consultas y saludos no se registran como nombre completo', () => {
  for (const text of ['JR Hola quiero mas informacion', 'Hola quiero más información', 'Quiero agendar una cita', 'Buenas tardes', 'Me interesan las carillas', 'Mucho gusto', 'Soy nuevo quiero informacion']) {
    assert.equal(extractPatientFullName(text,true),null,text);
  }
});

test('I: intención informativa actual no se confunde con agenda histórica', () => {
  assert.equal(isInformationRequest('JR Hola quiero mas informacion'),true);
  assert.equal(isInformationRequest('Soy María López y quiero información'),true);
  assert.equal(extractPatientFullName('Soy María López y quiero información',true),'María López');
  assert.equal(isInformationRequest('Quiero información y agendar una valoración'),false);
  assert.equal(isInformationRequest('María López'),false);
});

test('J: respuestas con el número personal se sustituyen por coordinación en chat oficial',()=>{
  const response=keepOfficialChat('Escríbele aquí https://wa.me/525664676808?text=Hola');
  assert.doesNotMatch(response,/wa\.me|5664676808/);assert.match(response,/aquí mismo/);
  assert.equal(keepOfficialChat('Con gusto, coordinamos la cita por aquí.'),'Con gusto, coordinamos la cita por aquí.');
});

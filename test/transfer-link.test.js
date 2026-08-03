const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addTreatmentToTransferLink,
  buildTransferLink,
  findTreatment
} = require('../transfer-link');

test('finds the treatment in the patient conversation', () => {
  const history = [
    { role: 'user', content: 'Me interesa el Diseño de Sonrisa' },
    { role: 'assistant', content: '¿Te gustaría agendar?' },
    { role: 'user', content: 'Sí' }
  ];

  assert.equal(findTreatment(history), 'Diseño de Sonrisa');
  assert.match(
    decodeURIComponent(buildTransferLink(history)),
    /Tratamiento de interés: Diseño de Sonrisa\./
  );
});

test('replaces the scheduling link with one that includes the treatment', () => {
  const history = [{ role: 'user', content: 'Quiero valoración para implantes' }];
  const response = 'Agenda aquí: https://wa.me/525664676808?text=Hola%2C%20quiero%20agendar.';
  const result = addTreatmentToTransferLink(response, history);

  assert.match(decodeURIComponent(result), /Tratamiento de interés: Implantes\./);
  assert.doesNotMatch(result, /quiero%20agendar\./);
});

test('marks the treatment as pending when the patient has not specified one', () => {
  const history = [{ role: 'user', content: 'Quiero una cita' }];

  assert.match(
    decodeURIComponent(buildTransferLink(history)),
    /Tratamiento de interés: Por confirmar\./
  );
});

const TRANSFER_NUMBER = '525664676808';

const TREATMENTS = [
  ['diseno de sonrisa', 'Diseño de Sonrisa'],
  ['implante', 'Implantes'],
  ['carilla', 'Carillas'],
  ['blanqueamiento', 'Blanqueamiento'],
  ['corona', 'Coronas'],
  ['limpieza', 'Limpieza dental'],
  ['resina', 'Resinas'],
  ['ortodoncia', 'Ortodoncia'],
  ['rehabilitacion', 'Rehabilitación dental']
];

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findTreatment(history) {
  const patientMessages = history
    .filter((message) => message.role === 'user')
    .map((message) => normalize(message.content))
    .reverse();

  for (const message of patientMessages) {
    for (const [keyword, label] of TREATMENTS) {
      if (message.includes(keyword)) {
        return label;
      }
    }
  }

  return 'Por confirmar';
}

function buildTransferLink(history) {
  const treatment = findTreatment(history);
  const message = `Hola, me gustaría agendar una cita en Thera Dental Clinic. Tratamiento de interés: ${treatment}.`;

  return `https://wa.me/${TRANSFER_NUMBER}?text=${encodeURIComponent(message)}`;
}

function addTreatmentToTransferLink(response, history) {
  if (!response.includes(`https://wa.me/${TRANSFER_NUMBER}`)) {
    return response;
  }

  return response.replace(
    new RegExp(`https://wa\\.me/${TRANSFER_NUMBER}\\?text=[^\\s]+`, 'g'),
    buildTransferLink(history)
  );
}

module.exports = {
  addTreatmentToTransferLink,
  buildTransferLink,
  findTreatment
};

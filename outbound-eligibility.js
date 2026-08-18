function normalizePatientState(syncResult = {}) {
  const patientState = syncResult.patientState || 'NORMAL';
  return {
    patientState,
    commercialSuppression: Boolean(syncResult.commercialSuppression) ||
      patientState === 'APPOINTMENT_SCHEDULED' || patientState === 'HANDOFF_PENDING_CONFIRMATION',
    humanHandoffRequired: Boolean(syncResult.humanHandoffRequired)
  };
}

function isCommercialOutboundEligible(syncResult = {}) {
  return !normalizePatientState(syncResult).commercialSuppression;
}

function patientStateInstruction(syncResult = {}) {
  const state = normalizePatientState(syncResult);
  if (state.patientState === 'APPOINTMENT_SCHEDULED') {
    return `ESTADO CRM AUTORITATIVO: PATIENT_STATE=APPOINTMENT_SCHEDULED.
Responde normalmente dudas entrantes sobre cita, ubicación, preparación o información administrativa.
No ofrezcas otra valoración, no intentes agendar de nuevo y no inicies recuperación comercial.
${state.humanHandoffRequired ? 'La persona solicita cambiar, cancelar o reprogramar: confirma que el responsable humano continuará la gestión. HUMAN_HANDOFF_REQUIRED.' : ''}`;
  }
  if (state.patientState === 'HANDOFF_PENDING_CONFIRMATION') {
    return `ESTADO CRM AUTORITATIVO: HANDOFF_PENDING_CONFIRMATION.
El seguimiento comercial está pausado. Responde la duda entrante sin volver a ofrecer valoración ni repetir el enlace de agenda.`;
  }
  if (state.commercialSuppression) {
    return `ESTADO CRM AUTORITATIVO: NO DISPONIBLE.
Responde únicamente la necesidad entrante. No ofrezcas valoración, no repitas enlaces de agenda y no inicies recuperación comercial hasta recuperar el estado persistido.`;
  }
  return 'ESTADO CRM AUTORITATIVO: seguimiento comercial permitido; conserva las reglas clínicas y de agenda vigentes.';
}

module.exports = { normalizePatientState, isCommercialOutboundEligible, patientStateInstruction };

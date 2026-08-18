const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePatientState, isCommercialOutboundEligible, patientStateInstruction } = require('../outbound-eligibility');

test('1 normal lead permits commercial outbound', () => assert.equal(isCommercialOutboundEligible({ patientState: 'NORMAL' }), true));
test('2 valuation requested behaves normally', () => assert.equal(isCommercialOutboundEligible({ patientState: 'VALUATION_REQUESTED' }), true));
test('3 handoff pending pauses commercial outbound', () => assert.equal(isCommercialOutboundEligible({ patientState: 'HANDOFF_PENDING_CONFIRMATION' }), false));
test('4 scheduled valuation blocks commercial outbound', () => assert.equal(isCommercialOutboundEligible({ patientState: 'APPOINTMENT_SCHEDULED' }), false));
test('5 explicit commercial suppression blocks outbound', () => assert.equal(isCommercialOutboundEligible({ commercialSuppression: true }), false));
test('6 scheduled patient inbound remains answerable without reselling', () => {
  const prompt = patientStateInstruction({ patientState: 'APPOINTMENT_SCHEDULED' });
  assert.match(prompt, /Responde normalmente/); assert.match(prompt, /No ofrezcas otra valoración/);
});
test('7 reschedule requests require human handoff', () => assert.match(patientStateInstruction({ patientState: 'APPOINTMENT_SCHEDULED', humanHandoffRequired: true }), /HUMAN_HANDOFF_REQUIRED/));
test('8 repeated eligibility checks are deterministic', () => {
  const state = { patientState: 'HANDOFF_PENDING_CONFIRMATION' };
  assert.equal(isCommercialOutboundEligible(state), isCommercialOutboundEligible(state));
});
test('9 persisted Maria state blocks outbound without sending', () => {
  const state = normalizePatientState({ patientState: 'APPOINTMENT_SCHEDULED', commercialSuppression: true });
  assert.equal(state.commercialSuppression, true); assert.equal(isCommercialOutboundEligible(state), false);
});
test('CRM unavailable fails closed for commercial outbound but keeps inbound guidance', () => {
  const state = { patientState: 'UNKNOWN', commercialSuppression: true };
  assert.equal(isCommercialOutboundEligible(state), false);
  assert.match(patientStateInstruction(state), /Responde únicamente la necesidad entrante/);
});

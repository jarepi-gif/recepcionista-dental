const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendMessage,
  MAX_HISTORY_MESSAGES
} = require('../conversation-history');

test('preserves the assistant question before a short confirmation', () => {
  let history = [];

  history = appendMessage(history, 'user', 'Quiero una valoración');
  history = appendMessage(history, 'assistant', '¿Te gustaría agendar tu cita?');
  history = appendMessage(history, 'user', 'Sí');

  assert.deepEqual(history, [
    { role: 'user', content: 'Quiero una valoración' },
    { role: 'assistant', content: '¿Te gustaría agendar tu cita?' },
    { role: 'user', content: 'Sí' }
  ]);
});

test('limits history and always starts with a user message', () => {
  let history = [];

  for (let turn = 0; turn < 10; turn += 1) {
    history = appendMessage(history, 'user', `user-${turn}`);
    history = appendMessage(history, 'assistant', `assistant-${turn}`);
  }

  assert.ok(history.length <= MAX_HISTORY_MESSAGES);
  assert.equal(history[0].role, 'user');
  assert.equal(history.at(-1).content, 'assistant-9');
});

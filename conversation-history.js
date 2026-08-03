const MAX_HISTORY_MESSAGES = 14;

function appendMessage(history, role, content) {
  const nextHistory = [
    ...history,
    { role, content: content || '' }
  ];

  const trimmed = nextHistory.slice(-MAX_HISTORY_MESSAGES);

  while (trimmed.length > 0 && trimmed[0].role !== 'user') {
    trimmed.shift();
  }

  return trimmed;
}

module.exports = {
  appendMessage,
  MAX_HISTORY_MESSAGES
};

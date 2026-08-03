const crypto = require('crypto');

async function syncInboundLead(message, options = {}) {
  const endpoint = options.endpoint || process.env.XIMGROWTHOS_INBOUND_URL;
  const secret = options.secret || process.env.AURA_WEBHOOK_SECRET;
  const fetchImpl = options.fetchImpl || fetch;

  if (!endpoint || !secret) {
    throw new Error('XimGrowthOS sync is not configured');
  }

  const body = JSON.stringify(message);
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-aura-signature': signature
    },
    body,
    signal: AbortSignal.timeout(4000)
  });

  if (!response.ok) {
    throw new Error(`XimGrowthOS sync failed (${response.status})`);
  }

  return response.json();
}

module.exports = { syncInboundLead };

const crypto = require('crypto');

const XIM_TOKEN_PATTERN = /\[XIM:([0-9a-f-]{36})\]/i;
const THERA_REFERENCE_PATTERN = /\bReferencia\s+THERA:\s*([a-z0-9]{8,64})\b/i;

function extractInboundAttribution(message = '') {
  const originalText = String(message ?? '');
  const ximMatch = originalText.match(XIM_TOKEN_PATTERN);
  const theraMatch = originalText.match(THERA_REFERENCE_PATTERN);
  const intakeToken = ximMatch?.[1] || null;
  const intakeReference = theraMatch?.[1]?.toUpperCase() || null;
  const cleanText = originalText
    .replace(XIM_TOKEN_PATTERN, ' ')
    .replace(THERA_REFERENCE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { intakeToken, intakeReference, text: cleanText };
}

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

module.exports = { extractInboundAttribution, syncInboundLead };

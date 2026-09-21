const OPENAI_ADS_ENDPOINT = 'https://bzr.openai.com/v1/events';

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeSourceUrl(value) {
  const sourceUrl = required(value, 'OpenAI Ads source URL');
  const parsed = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('OpenAI Ads source URL must use HTTP(S)');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function buildLeadCreatedEvent({ eventId, occurredAt, oppref, sourceUrl }) {
  const timestamp = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(timestamp.getTime())) throw new Error('OpenAI Ads event timestamp is invalid');
  return {
    id: required(eventId, 'OpenAI Ads event ID'),
    type: 'lead_created',
    timestamp_ms: timestamp.getTime(),
    oppref: required(oppref, 'OpenAI Ads oppref'),
    source_url: normalizeSourceUrl(sourceUrl),
    action_source: 'web',
    data: { type: 'customer_action' }
  };
}

async function sendOpenAiLeadConversion(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const apiKey = required(
    env.OPENAI_ADS_CONVERSIONS_API_KEY || env.OPENAI_ADS_CONVERSION_API_KEY,
    'OpenAI Ads conversions API key'
  );
  const pixelId = required(env.OPENAI_ADS_PIXEL_ID, 'OpenAI Ads pixel ID');
  const payload = {
    validate_only: Boolean(options.validateOnly),
    integration_source: 'thera_aura',
    events: [buildLeadCreatedEvent(input)]
  };
  const response = await fetchImpl(`${OPENAI_ADS_ENDPOINT}?pid=${encodeURIComponent(pixelId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000)
  });
  if (!response.ok) {
    const detail = String(await response.text()).slice(0, 300);
    throw new Error(`OpenAI Ads conversion failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

module.exports = { buildLeadCreatedEvent, sendOpenAiLeadConversion };

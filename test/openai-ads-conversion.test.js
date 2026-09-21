const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLeadCreatedEvent, sendOpenAiLeadConversion } = require('../openai-ads-conversion');

test('builds a deduplicable attributed lead_created event', () => {
  const input = { eventId: 'SM123', occurredAt: '2026-09-20T18:00:00.000Z', oppref: 'opaque-click-reference', sourceUrl: 'https://theradentalclinic.com/diseno-sonrisa-pro/?campaign=sensitive#form' };
  const event = buildLeadCreatedEvent(input);
  assert.equal(event.id, 'SM123');
  assert.equal(event.type, 'lead_created');
  assert.equal(event.oppref, 'opaque-click-reference');
  assert.equal(event.source_url, 'https://theradentalclinic.com/diseno-sonrisa-pro/');
  assert.equal(event.action_source, 'web');
  assert.deepEqual(event.data, { type: 'customer_action' });
  assert.equal(buildLeadCreatedEvent(input).id, event.id);
});

test('posts the server event with conversion credentials', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ accepted: 1 }) };
  };
  const result = await sendOpenAiLeadConversion({ eventId: 'SM456', occurredAt: '2026-09-20T18:01:00Z', oppref: 'ref', sourceUrl: 'https://theradentalclinic.com/diseno-sonrisa-pro/' }, {
    env: { OPENAI_ADS_CONVERSIONS_API_KEY: 'secret', OPENAI_ADS_PIXEL_ID: 'pixel' }, fetchImpl
  });
  assert.equal(request.url, 'https://bzr.openai.com/v1/events?pid=pixel');
  assert.equal(request.options.headers.authorization, 'Bearer secret');
  assert.equal(JSON.parse(request.options.body).events[0].type, 'lead_created');
  assert.deepEqual(result, { accepted: 1 });
});

test('fails closed without attribution or configuration', async () => {
  const base = { eventId: 'SM789', occurredAt: new Date(), sourceUrl: 'https://theradentalclinic.com/' };
  assert.throws(() => buildLeadCreatedEvent(base), /oppref/);
  await assert.rejects(() => sendOpenAiLeadConversion({ ...base, oppref: 'ref' }, { env: {} }), /API key/);
});

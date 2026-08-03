const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { syncInboundLead } = require('../ximgrowthos-sync');

test('signs and sends an inbound message to XimGrowthOS', async () => {
  const message = {
    eventId: 'SM123',
    phone: 'whatsapp:+525512345678',
    text: 'Quiero Diseño de Sonrisa',
    receivedAt: '2026-08-03T18:00:00.000Z'
  };
  let request;
  const result = await syncInboundLead(message, {
    endpoint: 'https://example.test/api/integrations/aura/inbound',
    secret: 'test-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, json: async () => ({ received: true }) };
    }
  });

  const expected = crypto.createHmac('sha256', 'test-secret')
    .update(request.options.body).digest('hex');
  assert.equal(request.url, 'https://example.test/api/integrations/aura/inbound');
  assert.equal(request.options.headers['x-aura-signature'], `sha256=${expected}`);
  assert.deepEqual(result, { received: true });
});

test('fails closed when the integration secret is missing', async () => {
  await assert.rejects(
    syncInboundLead({}, { endpoint: 'https://example.test/inbound', secret: '' }),
    /not configured/
  );
});

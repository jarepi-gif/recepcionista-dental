const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { extractInboundAttribution, syncInboundLead } = require('../ximgrowthos-sync');


test('extracts the current THERA reference from the WhatsApp message', () => {
  assert.deepEqual(
    extractInboundAttribution('Quiero agendar una valoración. Referencia THERA: 2371DB1A5B06'),
    {
      intakeToken: null,
      intakeReference: '2371DB1A5B06',
      text: 'Quiero agendar una valoración.'
    }
  );
});

test('keeps compatibility with the legacy XIM UUID token', () => {
  assert.deepEqual(
    extractInboundAttribution('Hola [XIM:10000000-0000-4000-8000-000000000001]'),
    {
      intakeToken: '10000000-0000-4000-8000-000000000001',
      intakeReference: null,
      text: 'Hola'
    }
  );
});

test('returns a clean message when no attribution token exists', () => {
  assert.deepEqual(extractInboundAttribution('Quiero información'), {
    intakeToken: null,
    intakeReference: null,
    text: 'Quiero información'
  });
});

test('signs and sends an inbound message to XimGrowthOS', async () => {
  const message = {
    eventId: 'SM123',
    phone: 'whatsapp:+525512345678',
    text: 'Quiero Diseño de Sonrisa',
    intakeToken: '10000000-0000-4000-8000-000000000001',
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
